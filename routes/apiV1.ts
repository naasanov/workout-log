import { randomBytes } from 'crypto';
import { ResultSetHeader, RowDataPacket } from 'mysql2';
import { Router } from 'express';
import { parseISO } from 'date-fns';
import pool from '../database';
import handleSqlError from '../utils/handleSqlError';
import { validateId, validateLabel, validateVariation } from '../utils/validation';
import { authenticateApiKey, hashApiKey } from '../middleware/apiKey';
import { authenticateToken } from './auth';
import SqlError from '../utils/sqlErrors';
const { NO_REFERENCE_ERROR, WRONG_VALUE_ERROR } = SqlError;

const router = Router();

// ---------------------------------------------------------------------------
// API Key management — JWT auth (owner manages their own keys)
// ---------------------------------------------------------------------------

router.post('/keys', authenticateToken, async (req, res): Promise<any> => {
    const { uuid } = res.locals.user;
    const { label } = req.body;

    const rawKey = randomBytes(32).toString('hex');
    const keyHash = hashApiKey(rawKey);

    let result: ResultSetHeader;
    try {
        [result] = await pool.query<ResultSetHeader>(`
            INSERT INTO api_keys (key_hash, label, user_uuid)
            VALUES (?, ?, UUID_TO_BIN(?))
        `, [keyHash, label ?? null, uuid]);
    } catch (error) {
        return handleSqlError(error, res);
    }

    res.status(201).json({
        data: { id: result.insertId, key: rawKey, label: label ?? null },
        message: "API key created. Store the key securely — it will not be shown again."
    });
});

router.get('/keys', authenticateToken, async (req, res): Promise<any> => {
    const { uuid } = res.locals.user;

    let data: RowDataPacket[];
    try {
        [data] = await pool.query<RowDataPacket[]>(`
            SELECT id, label, created_at, last_used_at
            FROM api_keys
            WHERE user_uuid = UUID_TO_BIN(?)
            ORDER BY created_at DESC
        `, [uuid]);
    } catch (error) {
        return handleSqlError(error, res);
    }

    res.status(200).json({ data, message: "Successfully retrieved API keys" });
});

router.delete('/keys/:id', authenticateToken, async (req, res): Promise<any> => {
    const { uuid } = res.locals.user;
    const keyId = req.params.id;
    if (!validateId(keyId, res)) return;

    let data: ResultSetHeader;
    try {
        [data] = await pool.query<ResultSetHeader>(`
            DELETE FROM api_keys
            WHERE id = ? AND user_uuid = UUID_TO_BIN(?)
        `, [keyId, uuid]);
    } catch (error) {
        return handleSqlError(error, res);
    }

    if (data.affectedRows === 0) {
        return res.status(404).json({ message: `No API key with id ${keyId} found for this user` });
    }

    res.status(200).json({ message: `Successfully revoked API key with id ${keyId}` });
});

// ---------------------------------------------------------------------------
// All routes below require API key auth
// ---------------------------------------------------------------------------

router.use(authenticateApiKey);

// ---------------------------------------------------------------------------
// Workouts (sections)
// ---------------------------------------------------------------------------

router.get('/workouts', async (req, res): Promise<any> => {
    const { uuid } = res.locals.user;

    let data: RowDataPacket[];
    try {
        [data] = await pool.query<RowDataPacket[]>(`
            SELECT section_id as id, label
            FROM sections
            WHERE user_uuid = UUID_TO_BIN(?)
        `, [uuid]);
    } catch (error) {
        return handleSqlError(error, res);
    }

    res.status(200).json({ data, message: "Successfully retrieved workouts" });
});

router.post('/workouts', async (req, res): Promise<any> => {
    const { uuid } = res.locals.user;
    const { name } = req.body;
    if (!validateLabel(name, res)) return;

    let result: ResultSetHeader;
    try {
        [result] = await pool.query<ResultSetHeader>(`
            INSERT INTO sections (user_uuid, label)
            VALUES (UUID_TO_BIN(?), ?)
        `, [uuid, name]);
    } catch (error) {
        return handleSqlError(error, res);
    }

    res.status(201).json({
        data: { id: result.insertId },
        message: `Successfully created workout with id ${result.insertId}`
    });
});

router.delete('/workouts/:id', async (req, res): Promise<any> => {
    const workoutId = req.params.id;
    if (!validateId(workoutId, res)) return;

    let data: ResultSetHeader;
    try {
        [data] = await pool.query<ResultSetHeader>(`
            DELETE FROM sections WHERE section_id = ?
        `, [workoutId]);
    } catch (error) {
        return handleSqlError(error, res, {
            [WRONG_VALUE_ERROR]: [400, "Workout id must be a positive integer"]
        });
    }

    if (data.affectedRows === 0) {
        return res.status(404).json({ message: `No workout with id ${workoutId}` });
    }

    res.status(200).json({ message: `Successfully deleted workout with id ${workoutId}` });
});

// ---------------------------------------------------------------------------
// Movements
// ---------------------------------------------------------------------------

router.get('/movements', async (req, res): Promise<any> => {
    const workoutId = req.query.workoutId as string;
    if (!workoutId) {
        return res.status(400).json({ message: "Query parameter workoutId is required" });
    }
    if (!validateId(workoutId, res)) return;

    let data: RowDataPacket[];
    try {
        [data] = await pool.query<RowDataPacket[]>(`
            SELECT m.movement_id as id, m.label
            FROM movements m
            INNER JOIN sections s ON s.section_id = m.section_id
            WHERE m.section_id = ? AND s.user_uuid = UUID_TO_BIN(?)
        `, [workoutId, res.locals.user.uuid]);
    } catch (error) {
        return handleSqlError(error, res);
    }

    res.status(200).json({ data, message: `Successfully retrieved movements for workout ${workoutId}` });
});

router.post('/movements', async (req, res): Promise<any> => {
    const { name, workoutId } = req.body;
    if (!validateLabel(name, res)) return;
    if (!workoutId || !validateId(String(workoutId), res)) return;

    let result: ResultSetHeader;
    try {
        [result] = await pool.query<ResultSetHeader>(`
            INSERT INTO movements (section_id, label)
            VALUES (?, ?)
        `, [workoutId, name]);
    } catch (error) {
        return handleSqlError(error, res, {
            [NO_REFERENCE_ERROR]: [404, `Workout with id ${workoutId} not found`]
        });
    }

    res.status(201).json({
        data: { id: result.insertId },
        message: `Successfully created movement with id ${result.insertId}`
    });
});

router.delete('/movements/:id', async (req, res): Promise<any> => {
    const movementId = req.params.id;
    if (!validateId(movementId, res)) return;

    let data: ResultSetHeader;
    try {
        [data] = await pool.query<ResultSetHeader>(`
            DELETE FROM movements WHERE movement_id = ?
        `, [movementId]);
    } catch (error) {
        return handleSqlError(error, res, {
            [WRONG_VALUE_ERROR]: [400, "Movement id must be a positive integer"]
        });
    }

    if (data.affectedRows === 0) {
        return res.status(404).json({ message: `No movement with id ${movementId}` });
    }

    res.status(200).json({ message: `Successfully deleted movement with id ${movementId}` });
});

// ---------------------------------------------------------------------------
// Variations
// ---------------------------------------------------------------------------

router.get('/variations', async (req, res): Promise<any> => {
    const movementId = req.query.movementId as string;
    if (!movementId) {
        return res.status(400).json({ message: "Query parameter movementId is required" });
    }
    if (!validateId(movementId, res)) return;

    let data: RowDataPacket[];
    try {
        [data] = await pool.query<RowDataPacket[]>(`
            SELECT v.variation_id as id, v.label, v.weight, v.reps, v.date
            FROM variations v
            INNER JOIN movements m ON m.movement_id = v.movement_id
            INNER JOIN sections s ON s.section_id = m.section_id
            WHERE v.movement_id = ? AND s.user_uuid = UUID_TO_BIN(?)
        `, [movementId, res.locals.user.uuid]);
    } catch (error) {
        return handleSqlError(error, res);
    }

    res.status(200).json({ data, message: `Successfully retrieved variations for movement ${movementId}` });
});

router.post('/variations', async (req, res): Promise<any> => {
    const { label, weight, reps, movementId } = req.body;
    if (!validateLabel(label, res)) return;
    if (!movementId || !validateId(String(movementId), res)) return;

    const body = { label, weight, reps };
    if (!validateVariation(body, res)) return;

    let result: ResultSetHeader;
    try {
        [result] = await pool.query<ResultSetHeader>(`
            INSERT INTO variations (movement_id, label, weight, reps)
            VALUES (?, ?, ?, ?)
        `, [movementId, label, weight ?? null, reps ?? 0]);
    } catch (error) {
        return handleSqlError(error, res, {
            [NO_REFERENCE_ERROR]: [404, `Movement with id ${movementId} not found`]
        });
    }

    res.status(201).json({
        data: { id: result.insertId },
        message: `Successfully created variation with id ${result.insertId}`
    });
});

router.patch('/variations/:id', async (req, res): Promise<any> => {
    const variationId = req.params.id;
    if (!validateId(variationId, res)) return;

    const allowedFields = ['label', 'weight', 'reps', 'date'];
    const invalidFields = Object.keys(req.body).filter(key => !allowedFields.includes(key));
    if (invalidFields.length > 0) {
        return res.status(400).json({
            message: `Invalid fields: ${invalidFields.join(', ')}. Allowed: ${allowedFields.join(', ')}.`
        });
    }
    if (!validateVariation(req.body, res)) return;
    if (req.body.date) {
        req.body.date = new Date(parseISO(req.body.date));
    }

    let data: ResultSetHeader;
    try {
        [data] = await pool.query<ResultSetHeader>(`
            UPDATE variations SET ? WHERE variation_id = ?
        `, [req.body, variationId]);
    } catch (error) {
        return handleSqlError(error, res);
    }

    if (data.affectedRows === 0) {
        return res.status(404).json({ message: `No variation with id ${variationId}` });
    }

    if ('weight' in req.body && req.body.weight != null) {
        const historyDate = req.body.date ?? new Date();
        pool.query<ResultSetHeader>(`
            INSERT INTO variation_history (variation_id, weight, date)
            VALUES (?, ?, ?)
        `, [variationId, req.body.weight, historyDate]).catch(() => {});
    }

    res.status(200).json({ message: `Successfully updated variation with id ${variationId}` });
});

router.delete('/variations/:id', async (req, res): Promise<any> => {
    const variationId = req.params.id;
    if (!validateId(variationId, res)) return;

    let data: ResultSetHeader;
    try {
        [data] = await pool.query<ResultSetHeader>(`
            DELETE FROM variations WHERE variation_id = ?
        `, [variationId]);
    } catch (error) {
        return handleSqlError(error, res, {
            [WRONG_VALUE_ERROR]: [400, "Variation id must be a positive integer"]
        });
    }

    if (data.affectedRows === 0) {
        return res.status(404).json({ message: `No variation with id ${variationId}` });
    }

    res.status(200).json({ message: `Successfully deleted variation with id ${variationId}` });
});

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

router.get('/history/:variationId', async (req, res): Promise<any> => {
    const variationId = req.params.variationId;
    if (!validateId(variationId, res)) return;

    let data: RowDataPacket[];
    try {
        [data] = await pool.query<RowDataPacket[]>(`
            SELECT weight, date
            FROM variation_history
            WHERE variation_id = ?
            ORDER BY date ASC
        `, [variationId]);
    } catch (error) {
        return handleSqlError(error, res);
    }

    res.status(200).json({
        data,
        message: `Successfully retrieved history for variation with id ${variationId}`
    });
});

// ---------------------------------------------------------------------------
// Summary — structured overview for AI consumption
// ---------------------------------------------------------------------------

router.get('/summary', async (req, res): Promise<any> => {
    const { uuid } = res.locals.user;

    let sections: RowDataPacket[];
    let movements: RowDataPacket[];
    let variations: RowDataPacket[];
    let history: RowDataPacket[];

    try {
        [sections] = await pool.query<RowDataPacket[]>(`
            SELECT section_id as id, label
            FROM sections
            WHERE user_uuid = UUID_TO_BIN(?)
        `, [uuid]);

        if (sections.length === 0) {
            return res.status(200).json({ data: [], message: "No workouts found" });
        }

        const sectionIds = sections.map(s => s.id);

        [movements] = await pool.query<RowDataPacket[]>(`
            SELECT movement_id as id, section_id as workoutId, label
            FROM movements
            WHERE section_id IN (?)
        `, [sectionIds]);

        if (movements.length === 0) {
            const data = sections.map(s => ({ ...s, movements: [] }));
            return res.status(200).json({ data, message: "Summary retrieved" });
        }

        const movementIds = movements.map(m => m.id);

        [variations] = await pool.query<RowDataPacket[]>(`
            SELECT variation_id as id, movement_id as movementId, label, weight, reps, date
            FROM variations
            WHERE movement_id IN (?)
        `, [movementIds]);

        if (variations.length > 0) {
            const variationIds = variations.map(v => v.id);
            [history] = await pool.query<RowDataPacket[]>(`
                SELECT variation_id as variationId, weight, date
                FROM variation_history
                WHERE variation_id IN (?)
                ORDER BY date DESC
            `, [variationIds]);
        } else {
            history = [];
        }
    } catch (error) {
        return handleSqlError(error, res);
    }

    // Group history by variationId (already sorted DESC — most recent first)
    const historyByVariation: Record<number, { weight: number; date: string }[]> = {};
    for (const h of history!) {
        if (!historyByVariation[h.variationId]) historyByVariation[h.variationId] = [];
        historyByVariation[h.variationId].push({ weight: h.weight, date: h.date });
    }

    // Group variations by movementId
    const variationsByMovement: Record<number, any[]> = {};
    for (const v of variations!) {
        if (!variationsByMovement[v.movementId]) variationsByMovement[v.movementId] = [];
        const recentHistory = (historyByVariation[v.id] ?? []).slice(0, 10);
        variationsByMovement[v.movementId].push({
            id: v.id,
            label: v.label,
            currentWeight: v.weight,
            currentReps: v.reps,
            lastUpdated: v.date,
            recentHistory
        });
    }

    // Group movements by sectionId
    const movementsBySection: Record<number, any[]> = {};
    for (const m of movements!) {
        if (!movementsBySection[m.workoutId]) movementsBySection[m.workoutId] = [];
        movementsBySection[m.workoutId].push({
            id: m.id,
            label: m.label,
            variations: variationsByMovement[m.id] ?? []
        });
    }

    const data = sections.map(s => ({
        id: s.id,
        label: s.label,
        movements: movementsBySection[s.id] ?? []
    }));

    res.status(200).json({ data, message: "Summary retrieved successfully" });
});

export default router;
