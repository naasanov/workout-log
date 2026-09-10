// Sections data access -- the single place that touches the `sections` table.
// Called by routes/sections.ts and (later) directly by the AI agent feature.
// Sections are the top-level owned resource: every query here scopes by
// user_uuid directly rather than through a join.
import { ResultSetHeader, RowDataPacket } from 'mysql2';
import pool from '../../database';

export type SectionSummary = { id: number; label: string; showItems: boolean };
export type SectionDetail = { id: number; label: string };

/** True if a user row exists for this uuid. */
export async function userExists(uuid: string): Promise<boolean> {
    const [rows] = await pool.query<RowDataPacket[]>(`
        SELECT 1 FROM users
        WHERE user_uuid = UUID_TO_BIN(?)
    `, [uuid]);
    return rows.length > 0;
}

/** Insert a new section owned by uuid. Returns the new section_id. */
export async function createSection(uuid: string, label: string): Promise<number> {
    const [result] = await pool.query<ResultSetHeader>(`
        INSERT INTO sections (user_uuid, label)
        VALUES (UUID_TO_BIN(?), ?)
    `, [uuid, label]);
    return result.insertId;
}

/** All sections owned by uuid, with is_open normalized from 0/1 to a JS boolean. */
export async function listSectionsForUser(uuid: string): Promise<SectionSummary[]> {
    const [rows] = await pool.query<RowDataPacket[]>(`
        SELECT
            section_id as id,
            label,
            is_open AS showItems
        FROM sections
        WHERE user_uuid = UUID_TO_BIN(?)
    `, [uuid]);
    return rows.map((row) => ({
        id: row.id as number,
        label: row.label as string,
        showItems: row.showItems === 1,
    }));
}

/** Single section (id + label), scoped to uuid. Null if not found / not owned. */
export async function getSectionById(uuid: string, sectionId: string): Promise<SectionDetail | null> {
    const [[data]] = await pool.query<RowDataPacket[]>(`
        SELECT section_id as id, label
        FROM sections
        WHERE section_id = ? AND user_uuid = UUID_TO_BIN(?)
    `, [sectionId, uuid]);
    if (!data) return null;
    return { id: data.id as number, label: data.label as string };
}

/** True if sectionId is owned by uuid. Used to enforce the movement -> section -> user chain. */
export async function ownsSection(uuid: string, sectionId: string): Promise<boolean> {
    const [rows] = await pool.query<RowDataPacket[]>(`
        SELECT 1 FROM sections
        WHERE section_id = ? AND user_uuid = UUID_TO_BIN(?)
    `, [sectionId, uuid]);
    return rows.length > 0;
}

/** Apply a partial field update (SET ?) to a section owned by uuid. Returns whether a row was affected. */
export async function updateSection(uuid: string, sectionId: string, fields: Record<string, unknown>): Promise<boolean> {
    const [result] = await pool.query<ResultSetHeader>(`
        UPDATE sections
        SET ?
        WHERE section_id = ? AND user_uuid = UUID_TO_BIN(?)
    `, [fields, sectionId, uuid]);
    return result.affectedRows > 0;
}

/** Delete a section owned by uuid. Returns whether a row was affected. */
export async function deleteSection(uuid: string, sectionId: string): Promise<boolean> {
    const [result] = await pool.query<ResultSetHeader>(`
        DELETE FROM sections
        WHERE section_id = ? AND user_uuid = UUID_TO_BIN(?)
    `, [sectionId, uuid]);
    return result.affectedRows > 0;
}
