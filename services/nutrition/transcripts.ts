// Legacy (user_uuid, date)-keyed chat transcript API for routes/nutrition.ts.
// Chat identity now lives in services/conversations/store.ts as a
// conversation_id, unlinked from any date -- this module is a thin bridge
// that resolves each date to "that day's conversation" so routes/nutrition.ts
// (owned by a later wave) keeps working unmodified. All writes are
// best-effort -- callers should not let failures break the stream.
import { RowDataPacket, ResultSetHeader } from 'mysql2';
import pool from '../../database';
import * as conversations from '../conversations/store';

export type StoredChatMessage = conversations.StoredChatMessage;
export type ProposalResolutionRow = conversations.ProposalResolutionRow;

/**
 * Fetch all messages for a user+date, ordered by creation time.
 * Returns an empty array when the table is empty or on any error.
 */
export async function getTranscript(
  userUuid: string,
  date: string,
): Promise<StoredChatMessage[]> {
  try {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT id, message_id, role, parts, interrupted, created_at
       FROM chat_messages
       WHERE user_uuid = UUID_TO_BIN(?) AND date = ?
       ORDER BY id ASC`,
      [userUuid, date],
    );
    return rows.map((row) => ({
      id: row.id as number,
      message_id: row.message_id as string,
      role: row.role as 'user' | 'assistant' | 'system',
      parts: JSON.parse(row.parts as string),
      interrupted: Boolean(row.interrupted),
      created_at: row.created_at as string,
    }));
  } catch {
    return [];
  }
}

/**
 * Append a message to the day's transcript. Resolves (user_uuid, date) to
 * that day's conversation -- creating one, and archiving whatever
 * conversation was previously active, the first time a date is seen. Returns
 * the inserted row id, or null on failure.
 */
export async function appendMessage(
  userUuid: string,
  date: string,
  messageId: string,
  role: 'user' | 'assistant' | 'system',
  parts: conversations.StoredChatMessage['parts'],
): Promise<number | null> {
  try {
    const conversationId = await conversations.getOrCreateConversationForDate(userUuid, date);
    return await conversations.appendMessage(userUuid, conversationId, messageId, role, parts, date);
  } catch (err) {
    console.error('[transcripts] appendMessage failed:', err);
    return null;
  }
}

/**
 * Mark a message row as interrupted (e.g. client disconnected before onFinish).
 * Silently swallows errors.
 */
export async function markInterrupted(rowId: number): Promise<void> {
  return conversations.markInterrupted(rowId);
}

/**
 * Delete all messages for a user+date, and the now-empty conversation they
 * lived in (the legacy per-day model gives each date its own conversation).
 * Returns the number of message rows deleted.
 */
export async function clearTranscript(
  userUuid: string,
  date: string,
): Promise<number> {
  try {
    const [convRows] = await pool.query<RowDataPacket[]>(
      `SELECT DISTINCT conversation_id FROM chat_messages
       WHERE user_uuid = UUID_TO_BIN(?) AND date = ? AND conversation_id IS NOT NULL`,
      [userUuid, date],
    );

    const [result] = await pool.query<ResultSetHeader>(
      `DELETE FROM chat_messages WHERE user_uuid = UUID_TO_BIN(?) AND date = ?`,
      [userUuid, date],
    );

    for (const row of convRows) {
      const conversationId = row.conversation_id as number;
      const [[{ count }]] = await pool.query<RowDataPacket[]>(
        `SELECT COUNT(*) as count FROM chat_messages WHERE conversation_id = ?`,
        [conversationId],
      );
      if (count === 0) {
        await pool.query(
          `DELETE FROM conversations WHERE id = ? AND user_uuid = UUID_TO_BIN(?)`,
          [conversationId, userUuid],
        );
      }
    }

    return result.affectedRows;
  } catch (err) {
    console.error('[transcripts] clearTranscript failed:', err);
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Proposal resolutions (#186) — server-side record of accept/deny state for
// propose_entry / propose_custom_food cards, keyed by (user_uuid, date,
// tool_call_id). This is what makes an accepted proposal stay "Logged: <name>"
// after the transcript is refetched from the DB (previously only localStorage
// remembered this, so it was lost across devices / cleared storage / reload
// races). The canonical, conversation-keyed versions of these functions live
// in services/conversations/store.ts; this module keeps the date-keyed shape
// routes/nutrition.ts still calls.
// ---------------------------------------------------------------------------

/**
 * Fetch all proposal resolutions for a user+date.
 * Returns an empty array on any error — callers must not let this break the chat.
 */
export async function getResolutions(
  userUuid: string,
  date: string,
): Promise<ProposalResolutionRow[]> {
  try {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT tool_call_id, kind, status, display_name
       FROM proposal_resolutions
       WHERE user_uuid = UUID_TO_BIN(?) AND date = ?`,
      [userUuid, date],
    );
    return rows.map((row) => ({
      tool_call_id: row.tool_call_id as string,
      kind: row.kind as 'entry' | 'custom_food',
      status: row.status as 'confirmed' | 'denied',
      display_name: (row.display_name as string | null) ?? null,
    }));
  } catch (err) {
    console.error('[transcripts] getResolutions failed:', err);
    return [];
  }
}

/**
 * Record (or overwrite) a proposal's resolution. Upsert on the
 * (user_uuid, date, tool_call_id) unique key so a duplicate write for the
 * same toolCallId is idempotent. Best-effort — swallows errors so a failed
 * write never breaks the chat UI.
 */
export async function saveResolution(
  userUuid: string,
  date: string,
  toolCallId: string,
  kind: 'entry' | 'custom_food',
  status: 'confirmed' | 'denied',
  displayName: string | null,
): Promise<void> {
  try {
    const conversationId = await conversations.getOrCreateConversationForDate(userUuid, date);
    await conversations.saveResolution(userUuid, conversationId, toolCallId, kind, status, displayName, date);
  } catch (err) {
    console.error('[transcripts] saveResolution failed:', err);
  }
}

/**
 * Delete all proposal resolutions for a user+date. Mirrors clearTranscript —
 * called from the same DELETE /chat/transcript route so a cleared chat doesn't
 * leave orphaned resolution rows that could reattach to a future toolCallId
 * collision (astronomically unlikely, but keeps the table tidy).
 */
export async function clearResolutions(
  userUuid: string,
  date: string,
): Promise<void> {
  try {
    await pool.query(
      `DELETE FROM proposal_resolutions WHERE user_uuid = UUID_TO_BIN(?) AND date = ?`,
      [userUuid, date],
    );
  } catch (err) {
    console.error('[transcripts] clearResolutions failed:', err);
  }
}
