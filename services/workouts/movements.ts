// Movements data access -- the single place that touches the `movements`
// table. Called by routes/movements.ts, routes/variations.ts (for the
// ownership chain), and (later) directly by the AI agent feature.
// Movements are owned transitively: movement -> section -> user. Every
// lookup here confirms that chain via a join, otherwise a valid token could
// reach another user's data by guessing sequential ids.
import { ResultSetHeader, RowDataPacket } from 'mysql2';
import pool from '../../database';
import withTransaction from '../../utils/withTransaction';

export type MovementSummary = { id: number; label: string };

/** True if movementId is owned (via its section) by uuid. */
export async function ownsMovement(uuid: string, movementId: string): Promise<boolean> {
    const [rows] = await pool.query<RowDataPacket[]>(`
        SELECT 1 FROM movements m
        JOIN sections s ON s.section_id = m.section_id
        WHERE m.movement_id = ? AND s.user_uuid = UUID_TO_BIN(?)
    `, [movementId, uuid]);
    return rows.length > 0;
}

/**
 * Insert a movement under sectionId plus its default "Variation" row, in one
 * transaction. The default variation's INSERT omits weight/reps entirely so
 * their column defaults (NULL, 0) apply -- contrast with
 * variations.createVariation, whose INSERT always lists reps positionally.
 */
export async function createMovement(sectionId: string, label: string): Promise<number> {
    return withTransaction(async (conn) => {
        const [result] = await conn.query<ResultSetHeader>(`
            INSERT INTO movements (section_id, label)
            VALUES (?, ?)
        `, [sectionId, label]);
        const id = result.insertId;
        await conn.query<ResultSetHeader>(`
            INSERT INTO variations (movement_id, label)
            VALUES (?, ?)
        `, [id, "Variation"]);
        return id;
    });
}

/** All movements in a section. Callers must verify ownership (ownsSection) first. */
export async function listMovementsForSection(sectionId: string): Promise<MovementSummary[]> {
    const [rows] = await pool.query<RowDataPacket[]>(`
        SELECT movement_id as id, label
        FROM movements
        WHERE section_id = ?
    `, [sectionId]);
    return rows as MovementSummary[];
}

/** Single movement (id + label), scoped to uuid via its section. Null if not found / not owned. */
export async function getMovementById(uuid: string, movementId: string): Promise<MovementSummary | null> {
    const [[data]] = await pool.query<RowDataPacket[]>(`
        SELECT m.movement_id as id, m.label
        FROM movements m
        JOIN sections s ON s.section_id = m.section_id
        WHERE m.movement_id = ? AND s.user_uuid = UUID_TO_BIN(?)
    `, [movementId, uuid]);
    if (!data) return null;
    return { id: data.id as number, label: data.label as string };
}

/**
 * Update a movement's label. Returns false both when movementId isn't owned
 * by uuid and when the UPDATE affects no rows -- both cases map to the same
 * 404 in the route, so callers don't need to distinguish them.
 */
export async function updateMovement(uuid: string, movementId: string, label: string): Promise<boolean> {
    if (!(await ownsMovement(uuid, movementId))) return false;
    const [result] = await pool.query<ResultSetHeader>(`
        UPDATE movements
        SET label = ?
        WHERE movement_id = ?
    `, [label, movementId]);
    return result.affectedRows > 0;
}

/** Delete a movement owned by uuid (the join enforces ownership). Returns whether a row was affected. */
export async function deleteMovement(uuid: string, movementId: string): Promise<boolean> {
    const [result] = await pool.query<ResultSetHeader>(`
        DELETE m FROM movements m
        JOIN sections s ON s.section_id = m.section_id
        WHERE m.movement_id = ? AND s.user_uuid = UUID_TO_BIN(?)
    `, [movementId, uuid]);
    return result.affectedRows > 0;
}
