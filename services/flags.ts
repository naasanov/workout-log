// Per-account feature flags — currently just UNC dining (migrations/018_unc_dining.sql).
// Flags are read on every nutrition-chat turn (services/nutrition/agent.ts) to decide
// which tools to register, so a lookup failure must degrade to "feature off" rather
// than breaking chat — never throw out of getUserFlags.
import { RowDataPacket, ResultSetHeader } from 'mysql2';
import pool from '../database';

export type UserFlags = {
  unc_dining: boolean;
};

const ALL_FLAGS_OFF: UserFlags = { unc_dining: false };

/**
 * Read a user's feature flags. Never throws — on any DB error (including a
 * missing/unknown user) this returns all-false, so a flag lookup failure
 * degrades to "feature off" rather than surfacing an error to chat.
 */
export async function getUserFlags(userUuid: string): Promise<UserFlags> {
  try {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT unc_dining_enabled FROM users WHERE user_uuid = UUID_TO_BIN(?)`,
      [userUuid],
    );
    if (rows.length === 0) return ALL_FLAGS_OFF;
    return { unc_dining: !!rows[0].unc_dining_enabled };
  } catch (err) {
    console.error('[flags] failed to read user flags:', err);
    return ALL_FLAGS_OFF;
  }
}

// Maps a UserFlags key to its backing column. Single-entry today, but keeps the
// PATCH-by-email path (setUserFlag) generic as more flags are added.
const FLAG_COLUMNS: Record<keyof UserFlags, string> = {
  unc_dining: 'unc_dining_enabled',
};

/**
 * Set one flag for the user with this email (the admin route looks accounts up by
 * email, not uuid — see routes/nutrition.ts's owner-only usage view for the same
 * pattern). Returns false if no such user exists; throws on a genuine DB error
 * since a failed WRITE (unlike a read) should surface to the caller.
 */
export async function setUserFlag(
  email: string,
  flag: keyof UserFlags,
  enabled: boolean,
): Promise<boolean> {
  const column = FLAG_COLUMNS[flag];
  const [result] = await pool.query<ResultSetHeader>(
    `UPDATE users SET ${column} = ? WHERE email = ?`,
    [enabled, email],
  );
  return result.affectedRows > 0;
}
