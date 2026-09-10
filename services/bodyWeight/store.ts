// Body-weight data access. Called by routes/bodyWeight.ts and (later) the
// agent tools directly, which is why the SQL lives here rather than inline
// in the route.
import { RowDataPacket, ResultSetHeader } from 'mysql2';
import { parseISO } from 'date-fns';
import pool from '../../database';

/** A single body-weight log entry as stored in the `body_weight` table. */
export type BodyWeightEntry = {
  id: number;
  weight: number;
  date: Date;
};

const BARE_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * `date` is DATETIME, so a bare 'YYYY-MM-DD' `to` value must mean "through
 * the end of that calendar day", not midnight at its start. Such a value
 * resolves to the START of the NEXT day and is applied with an EXCLUSIVE
 * `<` comparison, so any entry logged later that day is still included. A
 * full ISO datetime string is an exact instant, applied inclusively (`<=`).
 */
function resolveTo(to: string): { value: Date; operator: '<' | '<=' } {
  if (BARE_DATE.test(to)) {
    const startOfDay = parseISO(to);
    return { value: new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000), operator: '<' };
  }
  return { value: parseISO(to), operator: '<=' };
}

/**
 * List a user's body-weight entries ordered by date ascending.
 * `from` is an inclusive lower bound (`>=`) at whatever instant it parses
 * to -- a bare date already means the start of that day, which needs no
 * special-casing. `to` is resolved by resolveTo above. Omitting both
 * filters returns every row, matching the route's original unfiltered
 * behavior.
 */
export async function listEntries(
  userUuid: string,
  from?: string,
  to?: string,
): Promise<BodyWeightEntry[]> {
  const conditions = ['user_uuid = UUID_TO_BIN(?)'];
  const params: unknown[] = [userUuid];

  if (from) {
    conditions.push('date >= ?');
    params.push(parseISO(from));
  }
  if (to) {
    const { value, operator } = resolveTo(to);
    conditions.push(`date ${operator} ?`);
    params.push(value);
  }

  const [data] = await pool.query<RowDataPacket[]>(
    `SELECT id, weight, date
     FROM body_weight
     WHERE ${conditions.join(' AND ')}
     ORDER BY date ASC`,
    params,
  );
  return data as BodyWeightEntry[];
}

/** Insert a new body-weight entry; returns the new row's id. */
export async function createEntry(
  userUuid: string,
  weight: number,
  date: Date,
): Promise<number> {
  const [result] = await pool.query<ResultSetHeader>(
    `INSERT INTO body_weight (user_uuid, weight, date)
     VALUES (UUID_TO_BIN(?), ?, ?)`,
    [userUuid, weight, date],
  );
  return result.insertId;
}

/** Delete an entry scoped to the user. Returns false if not found / not owned. */
export async function deleteEntry(userUuid: string, id: number): Promise<boolean> {
  const [result] = await pool.query<ResultSetHeader>(
    `DELETE FROM body_weight
     WHERE id = ? AND user_uuid = UUID_TO_BIN(?)`,
    [id, userUuid],
  );
  return result.affectedRows > 0;
}

/**
 * Update weight and/or date on an entry, scoped to the user, with merge
 * semantics: a field left out of `fields` keeps its stored value, matching
 * putGoals in services/nutrition/store.ts. Returns false if no row matched
 * (not found / not owned) or if `fields` has nothing to write.
 */
export async function updateEntry(
  userUuid: string,
  id: number,
  fields: { weight?: number; date?: Date },
): Promise<boolean> {
  const setClauses: string[] = [];
  const values: unknown[] = [];

  if (fields.weight !== undefined) {
    setClauses.push('weight = ?');
    values.push(fields.weight);
  }
  if (fields.date !== undefined) {
    setClauses.push('date = ?');
    values.push(fields.date);
  }
  if (setClauses.length === 0) return false;

  values.push(id, userUuid);
  const [result] = await pool.query<ResultSetHeader>(
    `UPDATE body_weight
     SET ${setClauses.join(', ')}
     WHERE id = ? AND user_uuid = UUID_TO_BIN(?)`,
    values,
  );
  return result.affectedRows > 0;
}
