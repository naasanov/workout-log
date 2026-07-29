// Chat transcript persistence for the nutrition AI agent.
// Stores AI SDK UIMessage objects (parts-based) keyed by (user_uuid, date).
// All writes are best-effort — callers should not let failures break the stream.
import { RowDataPacket, ResultSetHeader } from 'mysql2';
import pool from '../../database';

/** A stored chat message row as returned to the client. */
export interface StoredChatMessage {
  id: number;
  message_id: string;
  role: 'user' | 'assistant' | 'system';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  parts: any[];
  interrupted: boolean;
  created_at: string;
}

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
 * Append a message to the transcript. Returns the inserted row id, or null on failure.
 * Uses JSON.parse(JSON.stringify(...)) to strip any non-serialisable values.
 */
export async function appendMessage(
  userUuid: string,
  date: string,
  messageId: string,
  role: 'user' | 'assistant' | 'system',
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  parts: any[],
): Promise<number | null> {
  try {
    const safeParts = JSON.parse(JSON.stringify(parts));
    const [result] = await pool.query<ResultSetHeader>(
      `INSERT INTO chat_messages (user_uuid, date, message_id, role, parts)
       VALUES (UUID_TO_BIN(?), ?, ?, ?, ?)`,
      [userUuid, date, messageId, role, JSON.stringify(safeParts)],
    );
    return result.insertId;
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
  try {
    await pool.query(
      `UPDATE chat_messages SET interrupted = 1 WHERE id = ?`,
      [rowId],
    );
  } catch (err) {
    console.error('[transcripts] markInterrupted failed:', err);
  }
}

/**
 * Delete all messages for a user+date. Returns the number of rows deleted.
 */
export async function clearTranscript(
  userUuid: string,
  date: string,
): Promise<number> {
  try {
    const [result] = await pool.query<ResultSetHeader>(
      `DELETE FROM chat_messages WHERE user_uuid = UUID_TO_BIN(?) AND date = ?`,
      [userUuid, date],
    );
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
// races).
// ---------------------------------------------------------------------------

/** A stored proposal resolution row as returned to the client. */
export interface ProposalResolutionRow {
  tool_call_id: string;
  kind: 'entry' | 'custom_food';
  status: 'confirmed' | 'denied';
  display_name: string | null;
}

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
    await pool.query(
      `INSERT INTO proposal_resolutions (user_uuid, date, tool_call_id, kind, status, display_name)
       VALUES (UUID_TO_BIN(?), ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE kind = VALUES(kind), status = VALUES(status), display_name = VALUES(display_name)`,
      [userUuid, date, toolCallId, kind, status, displayName],
    );
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
