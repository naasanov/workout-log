// Tab-preferences data access (#110) — the single place that touches the
// tab_preferences table. Scoped per user via `WHERE user_uuid = UUID_TO_BIN(?)`.
// enabled_tabs is stored as an ordered JSON array of tab keys; element[0] is the
// user's homepage. A missing row means "no preferences yet" → empty list, which
// the client renders as the new-account empty state.
import { RowDataPacket } from 'mysql2';
import pool from '../database';
import { TabKey } from '../schemas/tabPreferences';

/** Read the user's ordered enabled tabs. Returns [] when no row exists. */
export async function getTabPreferences(userUuid: string): Promise<TabKey[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT enabled_tabs
     FROM tab_preferences
     WHERE user_uuid = UUID_TO_BIN(?)`,
    [userUuid],
  );
  if (rows.length === 0) return [];
  const value = rows[0].enabled_tabs;
  // mysql2 returns JSON columns already parsed; guard against a driver that
  // hands back a string just in case.
  const arr = typeof value === 'string' ? JSON.parse(value) : value;
  return Array.isArray(arr) ? (arr as TabKey[]) : [];
}

/** Upsert the user's ordered enabled tabs; returns the stored list. */
export async function putTabPreferences(
  userUuid: string,
  enabledTabs: TabKey[],
): Promise<TabKey[]> {
  await pool.query(
    `INSERT INTO tab_preferences (user_uuid, enabled_tabs)
     VALUES (UUID_TO_BIN(?), CAST(? AS JSON))
     ON DUPLICATE KEY UPDATE enabled_tabs = VALUES(enabled_tabs)`,
    [userUuid, JSON.stringify(enabledTabs)],
  );
  return getTabPreferences(userUuid);
}
