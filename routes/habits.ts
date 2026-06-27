import { ResultSetHeader, RowDataPacket } from 'mysql2';
import { Router } from 'express';
import pool from '../database';
import handleSqlError from '../utils/handleSqlError';
import { authenticateToken } from './auth';
import { User } from '../types';

const router = Router();
router.use(authenticateToken);

// ─── Habits registry CRUD ──────────────────────────────────────────────────────

// GET /habits — list all habits for the user (ordered by ordering, then created_at)
router.get('/', async (req, res): Promise<any> => {
    const { uuid }: User = res.locals.user;

    let data: RowDataPacket[];
    try {
        [data] = await pool.query<RowDataPacket[]>(`
            SELECT id, name, ordering, created_at
            FROM habits
            WHERE user_uuid = UUID_TO_BIN(?)
            ORDER BY ordering ASC, created_at ASC
        `, [uuid]);
    } catch (error) {
        return handleSqlError(error, res);
    }

    res.status(200).json({ data, message: 'Successfully retrieved habits' });
});

// POST /habits — create a new habit
router.post('/', async (req, res): Promise<any> => {
    const { uuid }: User = res.locals.user;
    const { name } = req.body as { name?: string };

    if (!name || typeof name !== 'string' || !name.trim()) {
        return res.status(400).json({ message: 'name is required' });
    }
    const trimmed = name.trim().slice(0, 100);

    // Determine next ordering value
    let maxRow: RowDataPacket[];
    try {
        [maxRow] = await pool.query<RowDataPacket[]>(`
            SELECT COALESCE(MAX(ordering), -1) AS maxOrd
            FROM habits
            WHERE user_uuid = UUID_TO_BIN(?)
        `, [uuid]);
    } catch (error) {
        return handleSqlError(error, res);
    }
    const nextOrd = ((maxRow[0]?.maxOrd as number) ?? -1) + 1;

    let result: ResultSetHeader;
    try {
        [result] = await pool.query<ResultSetHeader>(`
            INSERT INTO habits (user_uuid, name, ordering)
            VALUES (UUID_TO_BIN(?), ?, ?)
        `, [uuid, trimmed, nextOrd]);
    } catch (error: any) {
        if (error?.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ message: `Habit "${trimmed}" already exists` });
        }
        return handleSqlError(error, res);
    }

    res.status(201).json({
        data: { id: result.insertId, name: trimmed, ordering: nextOrd },
        message: `Habit "${trimmed}" created`
    });
});

// PATCH /habits/:id — rename a habit (also renames its tallies)
router.patch('/:id', async (req, res): Promise<any> => {
    const { uuid }: User = res.locals.user;
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ message: 'Invalid habit id' });

    const { name } = req.body as { name?: string };
    if (!name || typeof name !== 'string' || !name.trim()) {
        return res.status(400).json({ message: 'name is required' });
    }
    const newName = name.trim().slice(0, 100);

    // Look up the old name so we can rename tallies
    let rows: RowDataPacket[];
    try {
        [rows] = await pool.query<RowDataPacket[]>(`
            SELECT name FROM habits
            WHERE id = ? AND user_uuid = UUID_TO_BIN(?)
        `, [id, uuid]);
    } catch (error) {
        return handleSqlError(error, res);
    }
    if (rows.length === 0) {
        return res.status(404).json({ message: 'Habit not found' });
    }
    const oldName: string = rows[0].name;

    // Rename in registry
    let result: ResultSetHeader;
    try {
        [result] = await pool.query<ResultSetHeader>(`
            UPDATE habits SET name = ?
            WHERE id = ? AND user_uuid = UUID_TO_BIN(?)
        `, [newName, id, uuid]);
    } catch (error: any) {
        if (error?.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ message: `Habit "${newName}" already exists` });
        }
        return handleSqlError(error, res);
    }
    if (result.affectedRows === 0) {
        return res.status(404).json({ message: 'Habit not found' });
    }

    // Rename all tallies for this user+old-name to the new name
    try {
        await pool.query<ResultSetHeader>(`
            UPDATE habit_tallies SET habit_name = ?
            WHERE user_uuid = UUID_TO_BIN(?) AND habit_name = ?
        `, [newName, uuid, oldName]);
    } catch (error) {
        console.error('Failed to rename habit tallies:', error);
    }

    res.status(200).json({ data: { id, name: newName }, message: `Habit renamed to "${newName}"` });
});

// DELETE /habits/:id — delete a habit and all its tallies
router.delete('/:id', async (req, res): Promise<any> => {
    const { uuid }: User = res.locals.user;
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ message: 'Invalid habit id' });

    // Look up name so we can delete tallies
    let rows: RowDataPacket[];
    try {
        [rows] = await pool.query<RowDataPacket[]>(`
            SELECT name FROM habits
            WHERE id = ? AND user_uuid = UUID_TO_BIN(?)
        `, [id, uuid]);
    } catch (error) {
        return handleSqlError(error, res);
    }
    if (rows.length === 0) {
        return res.status(404).json({ message: 'Habit not found' });
    }
    const habitName: string = rows[0].name;

    // Delete tallies first
    try {
        await pool.query<ResultSetHeader>(`
            DELETE FROM habit_tallies
            WHERE user_uuid = UUID_TO_BIN(?) AND habit_name = ?
        `, [uuid, habitName]);
    } catch (error) {
        return handleSqlError(error, res);
    }

    // Delete from registry
    try {
        await pool.query<ResultSetHeader>(`
            DELETE FROM habits
            WHERE id = ? AND user_uuid = UUID_TO_BIN(?)
        `, [id, uuid]);
    } catch (error) {
        return handleSqlError(error, res);
    }

    res.status(200).json({ message: `Habit "${habitName}" and its tallies deleted` });
});

// ─── Tally endpoints (keyed by habit name — unchanged) ─────────────────────────

// GET all rows for a habit (sorted descending by date)
router.get('/:habitName', async (req, res): Promise<any> => {
    const { uuid }: User = res.locals.user;
    const { habitName } = req.params;

    let data: RowDataPacket[];
    try {
        [data] = await pool.query<RowDataPacket[]>(`
            SELECT id, habit_name, date, count, range_start, range_end
            FROM habit_tallies
            WHERE user_uuid = UUID_TO_BIN(?) AND habit_name = ?
            ORDER BY date DESC
        `, [uuid, habitName]);
    } catch (error) {
        return handleSqlError(error, res);
    }

    res.status(200).json({
        data,
        message: `Successfully retrieved habit tallies for ${habitName}`
    });
});

// POST a tally for today — upserts: creates with count=1 or increments count and pushes range_end
router.post('/:habitName/tally', async (req, res): Promise<any> => {
    const { uuid }: User = res.locals.user;
    const { habitName } = req.params;
    // Client sends its local time so we store the correct local date/time
    const { localTime, localDate } = req.body as { localTime?: string; localDate?: string };

    // Validate localTime is HH:mm
    const timeValue = localTime && /^\d{2}:\d{2}$/.test(localTime) ? localTime : null;
    // Validate localDate is YYYY-MM-DD
    const dateValue = localDate && /^\d{4}-\d{2}-\d{2}$/.test(localDate) ? localDate : null;

    // Fallback: use current UTC time/date if client values missing (should rarely happen)
    const now = new Date();
    const fallbackDate = now.toISOString().slice(0, 10);
    const fallbackTime = now.toTimeString().slice(0, 5);

    const todayDate = dateValue ?? fallbackDate;
    const currentTime = timeValue ?? fallbackTime;

    let data: RowDataPacket[];
    try {
        [data] = await pool.query<RowDataPacket[]>(`
            SELECT id, count, range_start, range_end
            FROM habit_tallies
            WHERE user_uuid = UUID_TO_BIN(?) AND habit_name = ? AND date = ?
        `, [uuid, habitName, todayDate]);
    } catch (error) {
        return handleSqlError(error, res);
    }

    if (data.length === 0) {
        // No row for today — insert with count=1 and range_start=range_end=currentTime
        let result: ResultSetHeader;
        try {
            [result] = await pool.query<ResultSetHeader>(`
                INSERT INTO habit_tallies (user_uuid, habit_name, date, count, range_start, range_end)
                VALUES (UUID_TO_BIN(?), ?, ?, 1, ?, ?)
            `, [uuid, habitName, todayDate, currentTime, currentTime]);
        } catch (error) {
            return handleSqlError(error, res);
        }

        return res.status(201).json({
            data: {
                id: result.insertId,
                date: todayDate,
                count: 1,
                range_start: currentTime,
                range_end: currentTime
            },
            message: `Tally added for ${habitName} on ${todayDate}`
        });
    } else {
        // Row exists — increment count and push range_end forward
        const existing = data[0];
        const newCount = existing.count + 1;
        try {
            await pool.query<ResultSetHeader>(`
                UPDATE habit_tallies
                SET count = ?, range_end = ?
                WHERE id = ?
            `, [newCount, currentTime, existing.id]);
        } catch (error) {
            return handleSqlError(error, res);
        }

        return res.status(200).json({
            data: {
                id: existing.id,
                date: todayDate,
                count: newCount,
                range_start: existing.range_start,
                range_end: currentTime
            },
            message: `Tally incremented for ${habitName} on ${todayDate}`
        });
    }
});

// PATCH a specific date — update count and/or range_start/range_end
router.patch('/:habitName/:date', async (req, res): Promise<any> => {
    const { uuid }: User = res.locals.user;
    const { habitName, date } = req.params;

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return res.status(400).json({ message: 'date must be in YYYY-MM-DD format' });
    }

    const { count, range_start, range_end } = req.body as {
        count?: number;
        range_start?: string | null;
        range_end?: string | null;
    };

    if (count !== undefined && (typeof count !== 'number' || count < 0 || !Number.isInteger(count))) {
        return res.status(400).json({ message: 'count must be a non-negative integer' });
    }

    // Build update fields
    const fields: string[] = [];
    const values: any[] = [];

    if (count !== undefined) {
        fields.push('count = ?');
        values.push(count);
    }
    if (range_start !== undefined) {
        fields.push('range_start = ?');
        values.push(range_start);
    }
    if (range_end !== undefined) {
        fields.push('range_end = ?');
        values.push(range_end);
    }

    if (fields.length === 0) {
        return res.status(400).json({ message: 'No fields to update' });
    }

    values.push(uuid, habitName, date);

    let result: ResultSetHeader;
    try {
        [result] = await pool.query<ResultSetHeader>(`
            UPDATE habit_tallies
            SET ${fields.join(', ')}
            WHERE user_uuid = UUID_TO_BIN(?) AND habit_name = ? AND date = ?
        `, values);
    } catch (error) {
        return handleSqlError(error, res);
    }

    if (result.affectedRows === 0) {
        return res.status(404).json({ message: `No tally found for ${habitName} on ${date}` });
    }

    res.status(200).json({ message: `Successfully updated tally for ${habitName} on ${date}` });
});

export default router;
