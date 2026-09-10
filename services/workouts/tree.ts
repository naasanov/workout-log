// The whole sections -> movements -> variations tree for one user in a single
// query, so the agent can match reported lifts against every existing record
// without one list call per section and per exercise.
import { RowDataPacket } from 'mysql2';
import pool from '../../database';

export type TreeVariation = { id: number; label: string; weight: number | null; reps: number; date: Date | string };
export type TreeMovement = { id: number; label: string; variations: TreeVariation[] };
export type TreeSection = { id: number; label: string; movements: TreeMovement[] };

/** Every section owned by uuid with its exercises and their variations, in insertion order. */
export async function getWorkoutTree(uuid: string): Promise<TreeSection[]> {
    const [rows] = await pool.query<RowDataPacket[]>(`
        SELECT
            s.section_id, s.label AS section_label,
            m.movement_id, m.label AS movement_label,
            v.variation_id, v.label AS variation_label, v.weight, v.reps, v.date
        FROM sections s
        LEFT JOIN movements m ON m.section_id = s.section_id
        LEFT JOIN variations v ON v.movement_id = m.movement_id
        WHERE s.user_uuid = UUID_TO_BIN(?)
        ORDER BY s.section_id, m.movement_id, v.variation_id
    `, [uuid]);

    const sections = new Map<number, TreeSection>();
    const movements = new Map<number, TreeMovement>();
    for (const row of rows) {
        let section = sections.get(row.section_id);
        if (!section) {
            section = { id: row.section_id, label: row.section_label, movements: [] };
            sections.set(row.section_id, section);
        }
        if (row.movement_id === null) continue;
        let movement = movements.get(row.movement_id);
        if (!movement) {
            movement = { id: row.movement_id, label: row.movement_label, variations: [] };
            movements.set(row.movement_id, movement);
            section.movements.push(movement);
        }
        if (row.variation_id === null) continue;
        movement.variations.push({
            id: row.variation_id,
            label: row.variation_label,
            weight: row.weight,
            reps: row.reps,
            date: row.date,
        });
    }
    return [...sections.values()];
}
