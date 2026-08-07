import { ResultSetHeader, RowDataPacket } from 'mysql2';
import { Router } from 'express';
import pool from '../database';
import handleSqlError from '../utils/handleSqlError';
import withTransaction from '../utils/withTransaction';
import { validateId, validateVariation } from '../utils/validation';
import { parseISO } from "date-fns";
import SqlError from '../utils/sqlErrors';
const { NO_REFERENCE_ERROR } = SqlError;
import { authenticateToken } from "./auth";
import { User } from '../types';

const router = Router();
router.use(authenticateToken);

// Variations are owned transitively: variation -> movement -> section -> user. Every route
// must confirm that chain, otherwise a valid token can read or edit another user's data by
// guessing sequential ids. Callers report a 404 rather than a 403 so ids stay unenumerable.
async function ownsMovement(uuid: string, movementId: string): Promise<boolean> {
    const [rows] = await pool.query<RowDataPacket[]>(`
        SELECT 1 FROM movements m
        JOIN sections s ON s.section_id = m.section_id
        WHERE m.movement_id = ? AND s.user_uuid = UUID_TO_BIN(?)
    `, [movementId, uuid]);
    return rows.length > 0;
}

async function ownsVariation(uuid: string, variationId: string): Promise<boolean> {
    const [rows] = await pool.query<RowDataPacket[]>(`
        SELECT 1 FROM variations v
        JOIN movements m ON m.movement_id = v.movement_id
        JOIN sections s ON s.section_id = m.section_id
        WHERE v.variation_id = ? AND s.user_uuid = UUID_TO_BIN(?)
    `, [variationId, uuid]);
    return rows.length > 0;
}

// POST
router.post('/:movementId', async (req, res): Promise<any> => {
    const movementId = req.params.movementId;
    if (!validateId(movementId, res)) return; 

    if (!("label" in req.body)) {
        return res.status(400).json({ message: `Request body must include label`})
    }
    if (!validateVariation(req.body, res)) return;
    req.body.date = req.body.date && new Date(parseISO(req.body.date));
    const { label, weight, reps, date } = req.body;

    const { uuid }: User = res.locals.user;
    try {
        if (!await ownsMovement(uuid, movementId)) {
            return res.status(404).json({ message: `Movement with id ${movementId} not found` });
        }
    } catch (error) {
        return handleSqlError(error, res);
    }

    let result: ResultSetHeader;
    try {
        [result] = await pool.query<ResultSetHeader>(`
            INSERT INTO variations (movement_id, label, weight, reps, date)
            VALUES (?, ?, ?, ?, ?)
            `, [movementId, label, weight, reps, date ?? new Date()])
        }
    catch (error) {
        return handleSqlError(error, res, {
            [NO_REFERENCE_ERROR]: [404, `Movement with id ${movementId} not found`],
        })
    }
    
    const variationId = result.insertId;
    res.status(201).json({
        data: { variationId },
        message: `Successfullly created variation with id ${variationId}`
    })
})

// GET many, batched across movements so a section loads in one request instead of one per movement
const MAX_BATCH_IDS = 200;

router.get('/movements', async (req, res): Promise<any> => {
    const idsParam = typeof req.query.ids === 'string' ? req.query.ids : '';
    // Deduped so the ownership count check below stays exact
    const ids = [...new Set(idsParam.split(',').map(id => id.trim()).filter(Boolean))];

    if (ids.length === 0) {
        return res.status(400).json({ message: `Query parameter ids must be a comma separated list of movement ids` });
    }
    if (ids.length > MAX_BATCH_IDS) {
        return res.status(400).json({ message: `Query parameter ids must contain at most ${MAX_BATCH_IDS} movement ids` });
    }
    if (!ids.every(id => /^\d+$/.test(id))) {
        return res.status(400).json({ message: `Query parameter ids must contain only numeric movement ids` });
    }

    const { uuid }: User = res.locals.user;
    let rows: RowDataPacket[];
    try {
        const [owned] = await pool.query<RowDataPacket[]>(`
            SELECT m.movement_id FROM movements m
            JOIN sections s ON s.section_id = m.section_id
            WHERE m.movement_id IN (?) AND s.user_uuid = UUID_TO_BIN(?)
        `, [ids, uuid])
        // All-or-nothing: a partial response would confirm which ids exist for someone else
        if (owned.length !== ids.length) {
            return res.status(404).json({ message: `One or more requested movements not found` });
        }

        [rows] = await pool.query<RowDataPacket[]>(`
            SELECT movement_id, variation_id as id, label, weight, reps, date
            FROM variations
            WHERE movement_id IN (?)
        `, [ids])
    }
    catch (error) {
        return handleSqlError(error, res);
    }

    // Every requested id gets an entry so callers can tell "no variations" from "not requested"
    const data: Record<string, Omit<RowDataPacket, 'movement_id'>[]> = {};
    for (const id of ids) {
        data[id] = [];
    }
    for (const { movement_id, ...variation } of rows) {
        data[movement_id]?.push(variation);
    }

    res.status(200).json({
        data,
        message: `Successfully retrieved all variations for ${ids.length} movement(s)`
    })
})

// GET many
router.get('/movement/:movementId', async (req, res): Promise<any> => {
    const movementId = req.params.movementId;
    if (!validateId(movementId, res)) return;
    
    const { uuid }: User = res.locals.user;
    let data: RowDataPacket[];
    try {
        if (!await ownsMovement(uuid, movementId)) {
            return res.status(404).json({ message: `movement with id ${movementId} not found` });
        }
    } catch (error) {
        return handleSqlError(error, res);
    }

    try {
        [data] = await pool.query<RowDataPacket[]>(`
            SELECT variation_id as id, label, weight, reps, date
            FROM variations
            WHERE movement_id = ?
        `, [movementId])
    }
    catch (error) {
        return handleSqlError(error, res);
    }

    res.status(200).json({
        data,
        message: `Successfully retrieved all variations for movement with id ${movementId}`
    })
})

// GET one
router.get('/variation/:variationId', async (req, res): Promise<any> => {
    const variationId = req.params.variationId;
    if (!validateId(variationId, res)) return;
    
    const { uuid }: User = res.locals.user;
    let data: RowDataPacket;
    try {
        [[data]] = await pool.query<RowDataPacket[]>(`
            SELECT v.variation_id as id, v.label, v.weight, v.reps, v.date
            FROM variations v
            JOIN movements m ON m.movement_id = v.movement_id
            JOIN sections s ON s.section_id = m.section_id
            WHERE v.variation_id = ? AND s.user_uuid = UUID_TO_BIN(?)
        `, [variationId, uuid]);
    }
    catch (error) {
        return handleSqlError(error, res);
    }

    if (!data) {
        return res.status(404).json({ message: `variation with id ${variationId} not found` });
    }

    res.status(200).json({
        data,
        message: `Successfully retrieved variation with id ${variationId}`
    })
})

// GET history
router.get('/history/:variationId', async (req, res): Promise<any> => {
    const variationId = req.params.variationId;
    if (!validateId(variationId, res)) return;

    const { uuid }: User = res.locals.user;
    let data: RowDataPacket[];
    try {
        if (!await ownsVariation(uuid, variationId)) {
            return res.status(404).json({ message: `variation with id ${variationId} not found` });
        }

        [data] = await pool.query<RowDataPacket[]>(`
            SELECT weight, reps, date
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
})

// PATCH
router.patch('/:variationId', async (req, res): Promise<any> => {
    // req.body should be in the form { label?: string, weight?: number, reps?: number, date?: Date };
    const variationId: string = req.params.variationId;
    if (!validateId(variationId, res)) return;

    const allowedFields = ['label', 'weight', 'reps', 'date'];
    const invalidFields = Object.keys(req.body).filter(key => !allowedFields.includes(key));
    if (invalidFields.length > 0) {
        return res.status(400).json({
            message: `Invalid fields: ${invalidFields.join(', ')}. Allowed fields are: ${allowedFields.join(', ')}.`
        });
    }
    if (!validateVariation(req.body, res)) return;
    if (req.body.date) {
        req.body.date = new Date(parseISO(req.body.date));
    }

    const { uuid }: User = res.locals.user;
    try {
        if (!await ownsVariation(uuid, variationId)) {
            return res.status(404).json({ message: `No variation with id ${variationId}` });
        }
    } catch (error) {
        return handleSqlError(error, res);
    }

    let data: ResultSetHeader;
    try {
        [data] = await pool.query<ResultSetHeader>(`
            UPDATE variations
            SET ?
            WHERE variation_id = ?
            `, [req.body, variationId]
        )
    } catch (error) {
        return handleSqlError(error, res)
    }

    if (data.affectedRows === 0) {
        return res.status(404).json({ message: `No variation with id ${variationId}` });
    }

    if ('weight' in req.body || 'reps' in req.body) {
        const historyDate = req.body.date ?? new Date();
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
                const repsEqual = (latest?.reps ?? null) === (current.reps ?? null);
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

    res.status(200).json({ message: `Successfully updated ${Object.keys(req.body).join(', ')} of variation with id ${variationId}` });
})

// DELETE
router.delete('/:variationId', async (req, res): Promise<any> => {
    const variationId = req.params.variationId;
    if (!validateId(variationId, res)) return;

    const { uuid }: User = res.locals.user;
    let data: ResultSetHeader;
    try {
        [data] = await pool.query<ResultSetHeader>(`
            DELETE v FROM variations v
            JOIN movements m ON m.movement_id = v.movement_id
            JOIN sections s ON s.section_id = m.section_id
            WHERE v.variation_id = ? AND s.user_uuid = UUID_TO_BIN(?)
            `, [variationId, uuid]
        )
    } catch (error) {
        return handleSqlError(error, res);
    }

    if (data.affectedRows === 0) {
        return res.status(404).json({ message: `No variation found with id ${variationId}` });
    }

    res.status(200).json({ message: `Successfully deleted variation with id ${variationId}` });
})

export default router;