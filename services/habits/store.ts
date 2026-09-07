// Habits data access -- the single place that touches the habits / habit_tallies
// tables. Called by BOTH routes/habits.ts and (later) the agent tools.
//
// habit_tallies joins the habits registry by `habit_name`, not by id (see
// migrations/005_habit_tallies.sql and 011_habits_registry.sql). The tally
// functions below never check the habits registry -- they operate on
// whatever name they're given, registered or not, matching prior behavior.
//
// habit_tallies.date is a DATE column with no dateStrings option configured
// on the pool, so callers reading `date` back get a JS Date, not a string --
// callers here return rows as-is rather than normalizing that.
import { ResultSetHeader, RowDataPacket } from 'mysql2';
import pool from '../../database';

export interface HabitRow {
  id: number;
  name: string;
  ordering: number;
  ignore_empty_days: number;
  created_at: string;
}

export interface TallyRow {
  id: number;
  habit_name: string;
  date: unknown;
  count: number;
  range_start: string | null;
  range_end: string | null;
}

export interface TallyDateRange {
  from?: string;
  to?: string;
}

export interface TallyUpsertResult {
  created: boolean;
  data: {
    id: number;
    date: string;
    count: number;
    range_start: string;
    range_end: string;
  };
}

export interface TallyUpdateFields {
  count?: number;
  range_start?: string | null;
  range_end?: string | null;
}

/** List all habits for a user, ordered by ordering then created_at. */
export async function listHabits(userUuid: string): Promise<HabitRow[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, name, ordering, ignore_empty_days, created_at
     FROM habits
     WHERE user_uuid = UUID_TO_BIN(?)
     ORDER BY ordering ASC, created_at ASC`,
    [userUuid],
  );
  return rows as HabitRow[];
}

/**
 * Create a habit at the next ordering slot. Uses MAX(ordering)+1, not
 * COUNT(*), so a gap left by a deleted habit is not backfilled.
 * Throws (error.code === 'ER_DUP_ENTRY') if the name is already taken by this user.
 */
export async function createHabit(
  userUuid: string,
  name: string,
): Promise<{ id: number; name: string; ordering: number }> {
  const [maxRow] = await pool.query<RowDataPacket[]>(
    `SELECT COALESCE(MAX(ordering), -1) AS maxOrd
     FROM habits
     WHERE user_uuid = UUID_TO_BIN(?)`,
    [userUuid],
  );
  const nextOrd = ((maxRow[0]?.maxOrd as number) ?? -1) + 1;

  const [result] = await pool.query<ResultSetHeader>(
    `INSERT INTO habits (user_uuid, name, ordering)
     VALUES (UUID_TO_BIN(?), ?, ?)`,
    [userUuid, name, nextOrd],
  );

  return { id: result.insertId, name, ordering: nextOrd };
}

/** Toggle ignore_empty_days for a habit. Returns false if not found / not owned. */
export async function setIgnoreEmptyDays(
  userUuid: string,
  id: number,
  ignoreEmptyDays: boolean,
): Promise<boolean> {
  const [result] = await pool.query<ResultSetHeader>(
    `UPDATE habits SET ignore_empty_days = ?
     WHERE id = ? AND user_uuid = UUID_TO_BIN(?)`,
    [ignoreEmptyDays ? 1 : 0, id, userUuid],
  );
  return result.affectedRows > 0;
}

/**
 * Rename a habit and best-effort cascade the rename to its tallies.
 * The tally UPDATE can collide with habit_tallies' UNIQUE(user_uuid,
 * habit_name, date) when a same-date tally already exists under the target
 * name -- that failure is swallowed (console.error only) so the registry
 * rename still succeeds while that one date is left stranded under the old name.
 * Returns null if the habit isn't found / owned. Throws (ER_DUP_ENTRY) if
 * newName is already used by this user's registry.
 */
export async function renameHabit(
  userUuid: string,
  id: number,
  newName: string,
): Promise<{ id: number; name: string } | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT name FROM habits
     WHERE id = ? AND user_uuid = UUID_TO_BIN(?)`,
    [id, userUuid],
  );
  if (rows.length === 0) return null;
  const oldName: string = rows[0].name;

  const [result] = await pool.query<ResultSetHeader>(
    `UPDATE habits SET name = ?
     WHERE id = ? AND user_uuid = UUID_TO_BIN(?)`,
    [newName, id, userUuid],
  );
  if (result.affectedRows === 0) return null;

  try {
    await pool.query<ResultSetHeader>(
      `UPDATE habit_tallies SET habit_name = ?
       WHERE user_uuid = UUID_TO_BIN(?) AND habit_name = ?`,
      [newName, userUuid, oldName],
    );
  } catch (error) {
    console.error('Failed to rename habit tallies:', error);
  }

  return { id, name: newName };
}

/**
 * Delete a habit and the tallies matching its CURRENT name only -- tallies
 * left under a name the habit was previously renamed from (or never
 * registered as) are untouched. Returns the deleted name, or null if the
 * habit isn't found / owned.
 */
export async function deleteHabit(userUuid: string, id: number): Promise<string | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT name FROM habits
     WHERE id = ? AND user_uuid = UUID_TO_BIN(?)`,
    [id, userUuid],
  );
  if (rows.length === 0) return null;
  const habitName: string = rows[0].name;

  await pool.query<ResultSetHeader>(
    `DELETE FROM habit_tallies
     WHERE user_uuid = UUID_TO_BIN(?) AND habit_name = ?`,
    [userUuid, habitName],
  );

  await pool.query<ResultSetHeader>(
    `DELETE FROM habits
     WHERE id = ? AND user_uuid = UUID_TO_BIN(?)`,
    [id, userUuid],
  );

  return habitName;
}

/**
 * List tallies for a habit name, sorted by date descending. The registry is
 * never consulted -- any name, registered or not, returns whatever rows exist.
 * `range.from`/`range.to` are optional inclusive YYYY-MM-DD bounds (`date >=
 * from` / `date <= to`, mirroring recentEntries' inclusive cutoff in
 * services/nutrition/store.ts); omitting both matches prior behavior exactly.
 */
export async function listTallies(
  userUuid: string,
  habitName: string,
  range?: TallyDateRange,
): Promise<TallyRow[]> {
  const conditions = ['user_uuid = UUID_TO_BIN(?)', 'habit_name = ?'];
  const params: unknown[] = [userUuid, habitName];

  if (range?.from) {
    conditions.push('date >= ?');
    params.push(range.from);
  }
  if (range?.to) {
    conditions.push('date <= ?');
    params.push(range.to);
  }

  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, habit_name, date, count, range_start, range_end
     FROM habit_tallies
     WHERE ${conditions.join(' AND ')}
     ORDER BY date DESC`,
    params,
  );
  return rows as TallyRow[];
}

/**
 * Upsert today's tally for a habit name (registry not checked): on first
 * call for the date, inserts count=1 with range_start=range_end=time; on
 * subsequent calls, increments count and pushes range_end forward while
 * leaving range_start untouched (read back from the existing row).
 */
export async function upsertTally(
  userUuid: string,
  habitName: string,
  date: string,
  time: string,
): Promise<TallyUpsertResult> {
  const [existingRows] = await pool.query<RowDataPacket[]>(
    `SELECT id, count, range_start, range_end
     FROM habit_tallies
     WHERE user_uuid = UUID_TO_BIN(?) AND habit_name = ? AND date = ?`,
    [userUuid, habitName, date],
  );

  if (existingRows.length === 0) {
    const [result] = await pool.query<ResultSetHeader>(
      `INSERT INTO habit_tallies (user_uuid, habit_name, date, count, range_start, range_end)
       VALUES (UUID_TO_BIN(?), ?, ?, 1, ?, ?)`,
      [userUuid, habitName, date, time, time],
    );

    return {
      created: true,
      data: { id: result.insertId, date, count: 1, range_start: time, range_end: time },
    };
  }

  const existing = existingRows[0];
  const newCount = existing.count + 1;
  await pool.query<ResultSetHeader>(
    `UPDATE habit_tallies
     SET count = ?, range_end = ?
     WHERE id = ?`,
    [newCount, time, existing.id],
  );

  return {
    created: false,
    data: {
      id: existing.id,
      date,
      count: newCount,
      range_start: existing.range_start,
      range_end: time,
    },
  };
}

/**
 * Update count/range_start/range_end for a habit_name+date (registry not
 * checked). Only fields present on `fields` are written; `range_start`/
 * `range_end` pass through unvalidated, including explicit null. Caller must
 * ensure at least one field is set. Returns false if no row matched.
 */
export async function updateTally(
  userUuid: string,
  habitName: string,
  date: string,
  fields: TallyUpdateFields,
): Promise<boolean> {
  const setClauses: string[] = [];
  const values: unknown[] = [];

  if (fields.count !== undefined) {
    setClauses.push('count = ?');
    values.push(fields.count);
  }
  if (fields.range_start !== undefined) {
    setClauses.push('range_start = ?');
    values.push(fields.range_start);
  }
  if (fields.range_end !== undefined) {
    setClauses.push('range_end = ?');
    values.push(fields.range_end);
  }
  if (setClauses.length === 0) return false;

  values.push(userUuid, habitName, date);
  const [result] = await pool.query<ResultSetHeader>(
    `UPDATE habit_tallies
     SET ${setClauses.join(', ')}
     WHERE user_uuid = UUID_TO_BIN(?) AND habit_name = ? AND date = ?`,
    values,
  );
  return result.affectedRows > 0;
}

/**
 * Delete a single tally row for a habit_name+date, scoped to the user
 * (registry not checked, matching every other tally function here).
 * Returns false if no matching row exists.
 */
export async function deleteTally(
  userUuid: string,
  habitName: string,
  date: string,
): Promise<boolean> {
  const [result] = await pool.query<ResultSetHeader>(
    `DELETE FROM habit_tallies
     WHERE user_uuid = UUID_TO_BIN(?) AND habit_name = ? AND date = ?`,
    [userUuid, habitName, date],
  );
  return result.affectedRows > 0;
}
