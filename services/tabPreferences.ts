// Tab-preferences data access (#110) — the single place that touches the
// tab_preferences table. Scoped per user via `WHERE user_uuid = UUID_TO_BIN(?)`.
// enabled_tabs is stored as an ordered JSON array of tab keys; element[0] is the
// user's homepage. A missing row means "no preferences yet" → empty list, which
// the client renders as the new-account empty state.
//
// known_tabs records every tab key this user has ever been offered. A key in
// TAB_KEYS but missing from known_tabs is genuinely new and gets adopted
// (appended, enabled) the first time it's read; a key missing from enabled_tabs
// but present in known_tabs was deliberately disabled and stays that way. The
// merge is computed and persisted inside getTabPreferences (read-time, not
// deferred to the next PUT), so a brand-new tab reaches a user's enabled list
// on their very next visit even if they never open the preferences UI again.
import { RowDataPacket } from 'mysql2';
import pool from '../database';
import { TAB_KEYS, TabKey } from '../schemas/tabPreferences';

function parseTabArray(value: unknown): TabKey[] {
  // mysql2 returns JSON columns already parsed; guard against a driver that
  // hands back a string just in case.
  const arr = typeof value === 'string' ? JSON.parse(value) : value;
  return Array.isArray(arr) ? (arr as TabKey[]) : [];
}

/** Read the user's ordered enabled tabs. Returns [] when no row exists. */
export async function getTabPreferences(userUuid: string): Promise<TabKey[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT enabled_tabs, known_tabs
     FROM tab_preferences
     WHERE user_uuid = UUID_TO_BIN(?)`,
    [userUuid],
  );
  if (rows.length === 0) return [];

  const enabledTabs = parseTabArray(rows[0].enabled_tabs);
  const knownTabs = parseTabArray(rows[0].known_tabs);

  const newTabs = TAB_KEYS.filter((key) => !knownTabs.includes(key));
  if (newTabs.length === 0) return enabledTabs;

  const mergedEnabled = [...enabledTabs, ...newTabs];
  const mergedKnown = [...knownTabs, ...newTabs];
  await pool.query(
    `UPDATE tab_preferences
     SET enabled_tabs = CAST(? AS JSON), known_tabs = CAST(? AS JSON)
     WHERE user_uuid = UUID_TO_BIN(?)`,
    [JSON.stringify(mergedEnabled), JSON.stringify(mergedKnown), userUuid],
  );
  return mergedEnabled;
}

/** Upsert the user's ordered enabled tabs; returns the stored list. */
export async function putTabPreferences(
  userUuid: string,
  enabledTabs: TabKey[],
): Promise<TabKey[]> {
  // A first-time row's known_tabs starts as every currently canonical tab key:
  // saving preferences means the user was shown (and chose among) all of them.
  // known_tabs is left untouched on an existing row -- that bookkeeping is
  // getTabPreferences's job, not this one's.
  await pool.query(
    `INSERT INTO tab_preferences (user_uuid, enabled_tabs, known_tabs)
     VALUES (UUID_TO_BIN(?), CAST(? AS JSON), CAST(? AS JSON))
     ON DUPLICATE KEY UPDATE enabled_tabs = VALUES(enabled_tabs)`,
    [userUuid, JSON.stringify(enabledTabs), JSON.stringify(TAB_KEYS)],
  );
  return getTabPreferences(userUuid);
}
