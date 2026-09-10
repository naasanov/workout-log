import { Router } from 'express';
import handleSqlError from '../utils/handleSqlError';
import { authenticateToken } from './auth';
import { User } from '../types';
import * as store from '../services/habits/store';

const router = Router();
router.use(authenticateToken);

// ─── Habits registry CRUD ──────────────────────────────────────────────────────

// GET /habits — list all habits for the user (ordered by ordering, then created_at)
router.get('/', async (req, res): Promise<any> => {
    const { uuid }: User = res.locals.user;

    try {
        const data = await store.listHabits(uuid);
        return res.status(200).json({ data, message: 'Successfully retrieved habits' });
    } catch (error) {
        return handleSqlError(error, res);
    }
});

// POST /habits — create a new habit
router.post('/', async (req, res): Promise<any> => {
    const { uuid }: User = res.locals.user;
    const { name } = req.body as { name?: string };

    if (!name || typeof name !== 'string' || !name.trim()) {
        return res.status(400).json({ message: 'name is required' });
    }
    const trimmed = name.trim().slice(0, 100);

    try {
        const created = await store.createHabit(uuid, trimmed);
        return res.status(201).json({
            data: created,
            message: `Habit "${trimmed}" created`
        });
    } catch (error: any) {
        if (error?.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ message: `Habit "${trimmed}" already exists` });
        }
        return handleSqlError(error, res);
    }
});

// PATCH /habits/:id — update a habit (rename or toggle ignore_empty_days)
router.patch('/:id', async (req, res): Promise<any> => {
    const { uuid }: User = res.locals.user;
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ message: 'Invalid habit id' });

    const { name, ignore_empty_days } = req.body as { name?: string; ignore_empty_days?: boolean };

    // ── Branch: update ignore_empty_days ──────────────────────────────────────
    if (ignore_empty_days !== undefined) {
        if (typeof ignore_empty_days !== 'boolean') {
            return res.status(400).json({ message: 'ignore_empty_days must be a boolean' });
        }

        try {
            const found = await store.setIgnoreEmptyDays(uuid, id, ignore_empty_days);
            if (!found) {
                return res.status(404).json({ message: `Habit ${id} not found` });
            }
            return res.status(200).json({ message: 'Updated' });
        } catch (error) {
            return handleSqlError(error, res);
        }
    }

    // ── Branch: rename ─────────────────────────────────────────────────────────
    if (!name || typeof name !== 'string' || !name.trim()) {
        return res.status(400).json({ message: 'name is required' });
    }
    const newName = name.trim().slice(0, 100);

    try {
        const renamed = await store.renameHabit(uuid, id, newName);
        if (!renamed) {
            return res.status(404).json({ message: 'Habit not found' });
        }
        return res.status(200).json({ data: renamed, message: `Habit renamed to "${renamed.name}"` });
    } catch (error: any) {
        if (error?.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ message: `Habit "${newName}" already exists` });
        }
        return handleSqlError(error, res);
    }
});

// DELETE /habits/:id — delete a habit and all its tallies
router.delete('/:id', async (req, res): Promise<any> => {
    const { uuid }: User = res.locals.user;
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ message: 'Invalid habit id' });

    try {
        const deletedName = await store.deleteHabit(uuid, id);
        if (!deletedName) {
            return res.status(404).json({ message: 'Habit not found' });
        }
        return res.status(200).json({ message: `Habit "${deletedName}" and its tallies deleted` });
    } catch (error) {
        return handleSqlError(error, res);
    }
});

// ─── Tally endpoints (keyed by habit name — unchanged) ─────────────────────────

// GET all rows for a habit (sorted descending by date). Optional ?from=&to=
// (both YYYY-MM-DD, inclusive) filter the date range for agent-tool callers;
// omitting both returns every tally, matching prior behavior exactly.
router.get('/:habitName', async (req, res): Promise<any> => {
    const { uuid }: User = res.locals.user;
    const { habitName } = req.params;
    const { from, to } = req.query as { from?: string; to?: string };

    if (from !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(from)) {
        return res.status(400).json({ message: 'from must be in YYYY-MM-DD format' });
    }
    if (to !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
        return res.status(400).json({ message: 'to must be in YYYY-MM-DD format' });
    }

    try {
        const data = await store.listTallies(uuid, habitName, { from, to });
        return res.status(200).json({
            data,
            message: `Successfully retrieved habit tallies for ${habitName}`
        });
    } catch (error) {
        return handleSqlError(error, res);
    }
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

    try {
        const result = await store.upsertTally(uuid, habitName, todayDate, currentTime);
        if (result.created) {
            return res.status(201).json({
                data: result.data,
                message: `Tally added for ${habitName} on ${todayDate}`
            });
        }
        return res.status(200).json({
            data: result.data,
            message: `Tally incremented for ${habitName} on ${todayDate}`
        });
    } catch (error) {
        return handleSqlError(error, res);
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

    if (count === undefined && range_start === undefined && range_end === undefined) {
        return res.status(400).json({ message: 'No fields to update' });
    }

    try {
        const updated = await store.updateTally(uuid, habitName, date, { count, range_start, range_end });
        if (!updated) {
            return res.status(404).json({ message: `No tally found for ${habitName} on ${date}` });
        }
        return res.status(200).json({ message: `Successfully updated tally for ${habitName} on ${date}` });
    } catch (error) {
        return handleSqlError(error, res);
    }
});

// DELETE a specific date's tally (registry not checked, matching the other
// tally endpoints). Two path segments here can never collide with the
// single-segment DELETE /:id registry route above.
router.delete('/:habitName/:date', async (req, res): Promise<any> => {
    const { uuid }: User = res.locals.user;
    const { habitName, date } = req.params;

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return res.status(400).json({ message: 'date must be in YYYY-MM-DD format' });
    }

    try {
        const deleted = await store.deleteTally(uuid, habitName, date);
        if (!deleted) {
            return res.status(404).json({ message: `No tally found for ${habitName} on ${date}` });
        }
        return res.status(200).json({ message: `Successfully deleted tally for ${habitName} on ${date}` });
    } catch (error) {
        return handleSqlError(error, res);
    }
});

export default router;
