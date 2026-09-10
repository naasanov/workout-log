// Variations data access -- the single place that touches the `variations`
// and `variation_history` tables. Called by routes/variations.ts and
// (later) directly by the AI agent feature, which needs exercise history
// over a date window for context.
// Variations are owned transitively: variation -> movement -> section ->
// user. Every lookup here confirms that chain via a join.
import { ResultSetHeader, RowDataPacket } from 'mysql2';
import { parseISO } from 'date-fns';
import pool from '../../database';
import withTransaction from '../../utils/withTransaction';

export type VariationSummary = {
    id: number;
    label: string;
    weight: number | null;
    reps: number;
    date: Date | string;
    notes: string | null;
};
export type VariationBatchRow = VariationSummary & { movement_id: number };
export type HistoryEntry = { weight: number | null; reps: number; date: Date | string };

/** True if variationId is owned (via its movement/section chain) by uuid. */
export async function ownsVariation(uuid: string, variationId: string): Promise<boolean> {
    const [rows] = await pool.query<RowDataPacket[]>(`
        SELECT 1 FROM variations v
        JOIN movements m ON m.movement_id = v.movement_id
        JOIN sections s ON s.section_id = m.section_id
        WHERE v.variation_id = ? AND s.user_uuid = UUID_TO_BIN(?)
    `, [variationId, uuid]);
    return rows.length > 0;
}

/**
 * Insert a variation under movementId. weight/reps are always bound
 * positionally, so an omitted reps sends a literal SQL NULL (mysql2's
 * handling of a JS `undefined` bind param) which throws against the
 * NOT NULL column -- preserved intentionally; see tests/workouts.test.js.
 */
export async function createVariation(
    movementId: string,
    label: string,
    weight: number | undefined,
    reps: number | undefined,
    date: Date,
): Promise<number> {
    const [result] = await pool.query<ResultSetHeader>(`
        INSERT INTO variations (movement_id, label, weight, reps, date)
        VALUES (?, ?, ?, ?, ?)
    `, [movementId, label, weight, reps, date]);
    return result.insertId;
}

/** True only if every id in movementIds is owned by uuid (checked all-or-nothing). */
export async function allMovementsOwned(uuid: string, movementIds: string[]): Promise<boolean> {
    const [owned] = await pool.query<RowDataPacket[]>(`
        SELECT m.movement_id FROM movements m
        JOIN sections s ON s.section_id = m.section_id
        WHERE m.movement_id IN (?) AND s.user_uuid = UUID_TO_BIN(?)
    `, [movementIds, uuid]);
    return owned.length === movementIds.length;
}

/** Variations for a batch of movements, each row tagged with its movement_id. */
export async function listVariationsByMovementIds(movementIds: string[]): Promise<VariationBatchRow[]> {
    const [rows] = await pool.query<RowDataPacket[]>(`
        SELECT movement_id, variation_id as id, label, weight, reps, date, notes
        FROM variations
        WHERE movement_id IN (?)
    `, [movementIds]);
    return rows as VariationBatchRow[];
}

/** All variations for a single movement. Callers must verify ownership (ownsMovement) first. */
export async function listVariationsForMovement(movementId: string): Promise<VariationSummary[]> {
    const [rows] = await pool.query<RowDataPacket[]>(`
        SELECT variation_id as id, label, weight, reps, date, notes
        FROM variations
        WHERE movement_id = ?
    `, [movementId]);
    return rows as VariationSummary[];
}

/** Single variation, scoped to uuid via its movement/section chain. Null if not found / not owned. */
export async function getVariationById(uuid: string, variationId: string): Promise<VariationSummary | null> {
    const [[data]] = await pool.query<RowDataPacket[]>(`
        SELECT v.variation_id as id, v.label, v.weight, v.reps, v.date, v.notes
        FROM variations v
        JOIN movements m ON m.movement_id = v.movement_id
        JOIN sections s ON s.section_id = m.section_id
        WHERE v.variation_id = ? AND s.user_uuid = UUID_TO_BIN(?)
    `, [variationId, uuid]);
    return (data as VariationSummary | undefined) ?? null;
}

// A bare 'YYYY-MM-DD' string, with no time component.
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Parse an ISO date/datetime string as an exact instant. A bare 'YYYY-MM-DD'
 * value is anchored to UTC midnight rather than date-fns's parseISO (which
 * treats a bare date as midnight in the SERVER's local time zone) -- a range
 * boundary parsed from an API query param shouldn't shift with wherever this
 * process happens to be deployed.
 */
function parseBound(value: string): Date {
    return DATE_ONLY_RE.test(value) ? new Date(`${value}T00:00:00.000Z`) : parseISO(value);
}

/**
 * variation_history for one variation, ordered oldest-first, optionally
 * bounded to a [from, to] window. When neither bound is given this is
 * identical to the unbounded query the route always used.
 *
 * Both bounds are inclusive. `from` needs no special handling: a bare date
 * parses to UTC midnight, already the earliest instant of that day, so a
 * plain `>=` is correct whether or not a time was given. `to` is different --
 * variation_history.date is a DATETIME, so a bare `to` date compared with a
 * plain `<=` would exclude later rows from that same UTC day. To keep
 * "to: '2024-01-15'" meaning "through the end of Jan 15 UTC", a date-only
 * `to` is bumped forward exactly one day and compared with `<` instead; a
 * `to` that already carries a time component is compared as an exact
 * inclusive cutoff with `<=`.
 */
export async function getHistory(variationId: string, from?: string, to?: string): Promise<HistoryEntry[]> {
    const conditions = ['variation_id = ?'];
    const params: unknown[] = [variationId];

    if (from) {
        conditions.push('date >= ?');
        params.push(parseBound(from));
    }
    if (to) {
        if (DATE_ONLY_RE.test(to)) {
            conditions.push('date < ?');
            params.push(new Date(parseBound(to).getTime() + ONE_DAY_MS));
        } else {
            conditions.push('date <= ?');
            params.push(parseBound(to));
        }
    }

    const [rows] = await pool.query<RowDataPacket[]>(`
        SELECT weight, reps, date
        FROM variation_history
        WHERE ${conditions.join(' AND ')}
        ORDER BY date ASC
    `, params);
    return rows as HistoryEntry[];
}

/** Apply a partial field update (SET ?) to a variation. Returns whether a row was affected. */
export async function updateVariationFields(variationId: string, fields: Record<string, unknown>): Promise<boolean> {
    const [result] = await pool.query<ResultSetHeader>(`
        UPDATE variations
        SET ?
        WHERE variation_id = ?
    `, [fields, variationId]);
    return result.affectedRows > 0;
}

/**
 * Best-effort append to variation_history after a weight/reps-touching
 * PATCH. Compares the variation's post-update weight/reps against the most
 * recent existing history row (not pre-PATCH values); inserts a baseline
 * row when no history exists yet, even if nothing actually changed. Never
 * inserts when the variation has no weight (a history point needs a weight
 * to be plottable), or when values match the latest row. Runs in a
 * transaction and swallows all errors -- callers must not fail the PATCH
 * response over history logging.
 */
export async function appendHistoryIfChanged(variationId: string, historyDate: Date): Promise<void> {
    try {
        await withTransaction(async (conn) => {
            const [[current]] = await conn.query<RowDataPacket[]>(`
                SELECT weight, reps FROM variations
                WHERE variation_id = ?
            `, [variationId]);
            if (!current || current.weight == null) {
                // A history point needs a weight to be plottable.
                return;
            }

            const [latestHistory] = await conn.query<RowDataPacket[]>(`
                SELECT weight, reps FROM variation_history
                WHERE variation_id = ?
                ORDER BY date DESC, history_id DESC
                LIMIT 1
            `, [variationId]);
            const latest = latestHistory.length > 0 ? latestHistory[0] : null;
            // Legacy history rows predate reps tracking and have reps IS NULL;
            // variations.reps is NOT NULL DEFAULT 0, so treat null and 0 as
            // the same "no reps recorded" value to avoid a spurious history
            // row on the first edit after a variation with old history rows.
            const repsEqual = (latest?.reps ?? 0) === (current.reps ?? 0);
            const weightEqual = latest !== null && latest.weight === current.weight;
            const unchanged = latest !== null && weightEqual && repsEqual;
            if (!unchanged) {
                await conn.query<ResultSetHeader>(`
                    INSERT INTO variation_history (variation_id, weight, reps, date)
                    VALUES (?, ?, ?, ?)
                `, [variationId, current.weight, current.reps ?? null, historyDate]);
            }
        });
    } catch (_) {
        // history logging is best-effort; don't fail the request
    }
}

/** Delete a variation owned by uuid (the join enforces ownership). Returns whether a row was affected. */
export async function deleteVariation(uuid: string, variationId: string): Promise<boolean> {
    const [result] = await pool.query<ResultSetHeader>(`
        DELETE v FROM variations v
        JOIN movements m ON m.movement_id = v.movement_id
        JOIN sections s ON s.section_id = m.section_id
        WHERE v.variation_id = ? AND s.user_uuid = UUID_TO_BIN(?)
    `, [variationId, uuid]);
    return result.affectedRows > 0;
}
