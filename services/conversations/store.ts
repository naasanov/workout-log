// Conversation persistence for the AI chat, unlinked from any specific date.
// A conversation can span an arbitrarily long stretch of time; "starting a
// new chat" archives whichever conversation was previously active rather
// than deleting it, and a user has at most one active conversation at a
// time (see migrations/023_conversations.sql's active_slot column for how
// that invariant is enforced at the DB level).
//
// All writes are best-effort where they sit on the hot chat path (message
// append) -- callers should not let a persistence failure break the stream.
import { RowDataPacket, ResultSetHeader } from 'mysql2';
import pool from '../../database';

// How long an archived conversation is kept before a retention job may purge
// it. Continuing a chat clears its expiry; archiving it again restarts the clock.
export const ARCHIVE_EXPIRY_DAYS = 30;

// Tool part types whose stored input/output is pure noise -- a production
// incident found 2,114 stored tool-calculator parts alone with no UI ever
// reading them back. Dropped at write time rather than trimmed later.
const DROPPED_TOOL_TYPES = new Set(['tool-calculator', 'tool-convert_to_grams']);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Part = any;

export interface Conversation {
  id: number;
  title: string | null;
  active: boolean;
  archived_at: string | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
}

/** A stored chat message row as returned to the client. */
export interface StoredChatMessage {
  id: number;
  message_id: string;
  role: 'user' | 'assistant' | 'system';
  parts: Part[];
  interrupted: boolean;
  created_at: string;
}

/**
 * A stored proposal resolution row as returned to the client. `kind` is a
 * free-form resource tag (e.g. 'entry', 'custom_food', 'section',
 * 'body_weight_entry.delete') rather than a closed union -- one resolution
 * mechanism now covers proposals from any resource, not just nutrition's
 * original two kinds. See migrations/024_generalize_proposal_kind.sql.
 *
 * `result` is whatever structured outcome the client's write produced --
 * typically `{ id }` for a single mutation, or an array of one such object
 * per item for a confirmed batch (see services/agent/tools/mutations.ts and
 * migrations/025_proposal_resolution_result.sql). Null for a denial, or for
 * a write with nothing worth echoing back.
 */
export interface ProposalResolutionRow {
  tool_call_id: string;
  kind: string;
  status: 'confirmed' | 'denied';
  display_name: string | null;
  // Optional (rather than required-but-nullable) so the legacy date-keyed
  // reader in services/nutrition/transcripts.ts -- which never selects this
  // column -- keeps satisfying this type without itself being touched here.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  result?: any;
}

function toConversation(row: RowDataPacket): Conversation {
  return {
    id: row.id as number,
    title: (row.title as string | null) ?? null,
    active: row.archived_at === null,
    archived_at: row.archived_at ? String(row.archived_at) : null,
    expires_at: row.expires_at ? String(row.expires_at) : null,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

/**
 * Truncate a message's text down to a conversation title. Trims whitespace
 * first so a title never starts/ends mid-blank-space, and marks truncation
 * with an ellipsis rather than silently cutting a word in half.
 */
export function deriveTitle(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  return trimmed.length > 80 ? `${trimmed.slice(0, 80).trimEnd()}…` : trimmed;
}

/** The first plain-text part's text in a UIMessage parts array, if any. */
function firstText(parts: Part[]): string | null {
  if (!Array.isArray(parts)) return null;
  const part = parts.find((p) => p && typeof p === 'object' && p.type === 'text' && typeof p.text === 'string');
  return part ? (part.text as string) : null;
}

/**
 * Drop tool parts whose payload is worthless to keep (calculator and unit
 * conversion calls -- see DROPPED_TOOL_TYPES above). The UI already hides
 * these part types, so nothing downstream ever reads the dropped data.
 */
function dropWorthlessToolParts(parts: Part[]): Part[] {
  if (!Array.isArray(parts)) return parts;
  return parts.filter((part) => !(part && typeof part === 'object' && DROPPED_TOOL_TYPES.has(part.type)));
}

/**
 * Archive whichever conversation is currently active for a user, if any.
 * Sets an expiry so a later retention pass can eventually purge it. No-op
 * when the user has no active conversation.
 */
async function archiveActiveConversation(userUuid: string): Promise<void> {
  await pool.query(
    `UPDATE conversations
     SET archived_at = NOW(), expires_at = DATE_ADD(NOW(), INTERVAL ? DAY)
     WHERE user_uuid = UUID_TO_BIN(?) AND archived_at IS NULL`,
    [ARCHIVE_EXPIRY_DAYS, userUuid],
  );
}

/**
 * Start a new conversation for a user, archiving their current active one
 * first. At most one active conversation per user is a DB-enforced
 * invariant (active_slot's unique index), not just an application check.
 */
export async function createConversation(userUuid: string): Promise<number> {
  await archiveActiveConversation(userUuid);
  const [result] = await pool.query<ResultSetHeader>(
    `INSERT INTO conversations (user_uuid) VALUES (UUID_TO_BIN(?))`,
    [userUuid],
  );
  return result.insertId;
}

/** List a user's conversations, most recently updated first. */
export async function listConversations(userUuid: string): Promise<Conversation[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, title, archived_at, expires_at, created_at, updated_at
     FROM conversations
     WHERE user_uuid = UUID_TO_BIN(?)
     ORDER BY updated_at DESC`,
    [userUuid],
  );
  return rows.map(toConversation);
}

async function getMessages(conversationId: number): Promise<StoredChatMessage[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, message_id, role, parts, interrupted, created_at
     FROM chat_messages WHERE conversation_id = ? ORDER BY id ASC`,
    [conversationId],
  );
  return rows.map((row) => ({
    id: row.id as number,
    message_id: row.message_id as string,
    role: row.role as 'user' | 'assistant' | 'system',
    parts: JSON.parse(row.parts as string),
    interrupted: Boolean(row.interrupted),
    created_at: row.created_at as string,
  }));
}

/** Fetch one conversation (scoped to its owner) together with its messages, or null if not found/not owned. */
export async function getConversation(
  userUuid: string,
  conversationId: number,
): Promise<{ conversation: Conversation; messages: StoredChatMessage[] } | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, title, archived_at, expires_at, created_at, updated_at
     FROM conversations WHERE id = ? AND user_uuid = UUID_TO_BIN(?)`,
    [conversationId, userUuid],
  );
  if (rows.length === 0) return null;
  const messages = await getMessages(conversationId);
  return { conversation: toConversation(rows[0]), messages };
}

/** Archive a conversation the user owns. No-op if already archived or not found/owned. */
export async function archiveConversation(userUuid: string, conversationId: number): Promise<void> {
  await pool.query(
    `UPDATE conversations
     SET archived_at = NOW(), expires_at = DATE_ADD(NOW(), INTERVAL ? DAY)
     WHERE id = ? AND user_uuid = UUID_TO_BIN(?) AND archived_at IS NULL`,
    [ARCHIVE_EXPIRY_DAYS, conversationId, userUuid],
  );
}

/**
 * Make an archived conversation active again, resetting its expiry.
 * Archives whichever conversation is currently active first, so the
 * one-active-conversation invariant holds even when continuing a
 * conversation other than the one presently active.
 */
export async function continueConversation(userUuid: string, conversationId: number): Promise<void> {
  await archiveActiveConversation(userUuid);
  await pool.query(
    `UPDATE conversations SET archived_at = NULL, expires_at = NULL
     WHERE id = ? AND user_uuid = UUID_TO_BIN(?)`,
    [conversationId, userUuid],
  );
}

/** Permanently delete a conversation the user owns, and everything filed under it. */
export async function deleteConversation(userUuid: string, conversationId: number): Promise<void> {
  await pool.query(
    `DELETE FROM chat_messages WHERE conversation_id = ? AND user_uuid = UUID_TO_BIN(?)`,
    [conversationId, userUuid],
  );
  await pool.query(
    `DELETE FROM proposal_resolutions WHERE conversation_id = ? AND user_uuid = UUID_TO_BIN(?)`,
    [conversationId, userUuid],
  );
  await pool.query(
    `DELETE FROM conversations WHERE id = ? AND user_uuid = UUID_TO_BIN(?)`,
    [conversationId, userUuid],
  );
}

/**
 * Append a message to a conversation. `date` is accepted only for the
 * legacy per-day callers in services/nutrition/transcripts.ts -- a
 * conversation created directly (not resolved from a date) has none, and
 * the row's date column is left NULL. Returns the inserted row id, or null
 * on failure.
 */
export async function appendMessage(
  userUuid: string,
  conversationId: number,
  messageId: string,
  role: 'user' | 'assistant' | 'system',
  parts: Part[],
  date: string | null = null,
): Promise<number | null> {
  try {
    const safeParts = dropWorthlessToolParts(JSON.parse(JSON.stringify(parts)));
    const [result] = await pool.query<ResultSetHeader>(
      `INSERT INTO chat_messages (user_uuid, date, conversation_id, message_id, role, parts)
       VALUES (UUID_TO_BIN(?), ?, ?, ?, ?, ?)`,
      [userUuid, date, conversationId, messageId, role, JSON.stringify(safeParts)],
    );

    // Bump recency on every message, and set the title once from the
    // conversation's first user message (COALESCE leaves an existing title
    // untouched).
    if (role === 'user') {
      const text = firstText(safeParts);
      const title = text ? deriveTitle(text) : null;
      await pool.query(
        `UPDATE conversations SET updated_at = NOW(), title = COALESCE(title, ?) WHERE id = ?`,
        [title, conversationId],
      );
    } else {
      await pool.query(`UPDATE conversations SET updated_at = NOW() WHERE id = ?`, [conversationId]);
    }

    return result.insertId;
  } catch (err) {
    console.error('[conversations] appendMessage failed:', err);
    return null;
  }
}

/** Mark a message row as interrupted (e.g. client disconnected before onFinish). Swallows errors. */
export async function markInterrupted(rowId: number): Promise<void> {
  try {
    await pool.query(`UPDATE chat_messages SET interrupted = 1 WHERE id = ?`, [rowId]);
  } catch (err) {
    console.error('[conversations] markInterrupted failed:', err);
  }
}

/**
 * Parse a JSON column value defensively: mysql2 returns a native JSON column
 * already parsed, but guard against a driver that hands back the raw string
 * (mirrors services/tabPreferences.ts's parseTabArray for the same reason).
 */
function parseJsonColumn(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

/**
 * Fetch every proposal resolution recorded for a conversation, oldest first.
 * Returns [] on any error.
 */
export async function getResolutions(conversationId: number): Promise<ProposalResolutionRow[]> {
  try {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT tool_call_id, kind, status, display_name, result
       FROM proposal_resolutions WHERE conversation_id = ? ORDER BY id ASC`,
      [conversationId],
    );
    return rows.map((row) => ({
      tool_call_id: row.tool_call_id as string,
      kind: row.kind as string,
      status: row.status as 'confirmed' | 'denied',
      display_name: (row.display_name as string | null) ?? null,
      result: parseJsonColumn(row.result),
    }));
  } catch (err) {
    console.error('[conversations] getResolutions failed:', err);
    return [];
  }
}

/**
 * Record (or overwrite) a proposal's resolution for a conversation. `date`
 * mirrors appendMessage's -- only the legacy per-day callers supply one.
 * The upsert key stays (user_uuid, date, tool_call_id) for legacy rows;
 * a dateless conversation instead relies on conversation_id + tool_call_id
 * being unique in practice (one proposal card per toolCallId per chat).
 *
 * `result` is an arbitrary JSON-serializable value describing what the
 * confirmed write actually did (e.g. `{ id: 42 }`, or an array of those for
 * a batch) -- see ProposalResolutionRow's doc comment. Left null for a
 * denial or when the caller has nothing structured to report.
 */
export async function saveResolution(
  userUuid: string,
  conversationId: number,
  toolCallId: string,
  kind: string,
  status: 'confirmed' | 'denied',
  displayName: string | null,
  date: string | null = null,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  result: any = null,
): Promise<void> {
  const resultJson = result === null || result === undefined ? null : JSON.stringify(result);
  try {
    if (date !== null) {
      await pool.query(
        `INSERT INTO proposal_resolutions (user_uuid, date, conversation_id, tool_call_id, kind, status, display_name, result)
         VALUES (UUID_TO_BIN(?), ?, ?, ?, ?, ?, ?, CAST(? AS JSON))
         ON DUPLICATE KEY UPDATE kind = VALUES(kind), status = VALUES(status), display_name = VALUES(display_name), result = VALUES(result), conversation_id = VALUES(conversation_id)`,
        [userUuid, date, conversationId, toolCallId, kind, status, displayName, resultJson],
      );
      return;
    }
    // Dateless (conversation-first) path: no legacy unique key applies, so
    // upsert by hand against (conversation_id, tool_call_id) instead.
    const [existing] = await pool.query<RowDataPacket[]>(
      `SELECT id FROM proposal_resolutions WHERE conversation_id = ? AND tool_call_id = ?`,
      [conversationId, toolCallId],
    );
    if (existing.length > 0) {
      await pool.query(
        `UPDATE proposal_resolutions SET kind = ?, status = ?, display_name = ?, result = CAST(? AS JSON) WHERE id = ?`,
        [kind, status, displayName, resultJson, existing[0].id],
      );
    } else {
      await pool.query(
        `INSERT INTO proposal_resolutions (user_uuid, conversation_id, tool_call_id, kind, status, display_name, result)
         VALUES (UUID_TO_BIN(?), ?, ?, ?, ?, ?, CAST(? AS JSON))`,
        [userUuid, conversationId, toolCallId, kind, status, displayName, resultJson],
      );
    }
  } catch (err) {
    console.error('[conversations] saveResolution failed:', err);
  }
}

/** Delete all proposal resolutions recorded for a conversation. Swallows errors. */
export async function clearResolutions(conversationId: number): Promise<void> {
  try {
    await pool.query(`DELETE FROM proposal_resolutions WHERE conversation_id = ?`, [conversationId]);
  } catch (err) {
    console.error('[conversations] clearResolutions failed:', err);
  }
}

/**
 * Bridge for legacy per-day callers (services/nutrition/transcripts.ts):
 * find the conversation already used for a user's exact (user_uuid, date),
 * or start a new one if this is the first message ever sent on that date.
 * Starting a new conversation here archives whatever was previously active
 * for the user -- exactly the "new day, new chat" rhythm the product wants,
 * so no separate code path is needed for it.
 */
export async function getOrCreateConversationForDate(userUuid: string, date: string): Promise<number> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT conversation_id FROM chat_messages
     WHERE user_uuid = UUID_TO_BIN(?) AND date = ? AND conversation_id IS NOT NULL
     LIMIT 1`,
    [userUuid, date],
  );
  if (rows.length > 0 && rows[0].conversation_id !== null) {
    return rows[0].conversation_id as number;
  }
  return createConversation(userUuid);
}
