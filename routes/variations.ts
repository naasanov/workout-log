import { Router } from 'express';
import handleSqlError from '../utils/handleSqlError';
import { validateId, validateVariation, isValidISO } from '../utils/validation';
import { parseISO } from "date-fns";
import SqlError from '../utils/sqlErrors';
const { NO_REFERENCE_ERROR } = SqlError;
import { authenticateToken } from "./auth";
import { User } from '../types';
import * as store from '../services/workouts';

const router = Router();
router.use(authenticateToken);

// Variations are owned transitively: variation -> movement -> section -> user. Every route
// must confirm that chain, otherwise a valid token can read or edit another user's data by
// guessing sequential ids. Callers report a 404 rather than a 403 so ids stay unenumerable.

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
        if (!await store.ownsMovement(uuid, movementId)) {
            return res.status(404).json({ message: `Movement with id ${movementId} not found` });
        }
    } catch (error) {
        return handleSqlError(error, res);
    }

    let variationId: number;
    try {
        variationId = await store.createVariation(movementId, label, weight, reps, date ?? new Date());
    }
    catch (error) {
        return handleSqlError(error, res, {
            [NO_REFERENCE_ERROR]: [404, `Movement with id ${movementId} not found`],
        })
    }

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
    let rows: store.VariationBatchRow[];
    try {
        // All-or-nothing: a partial response would confirm which ids exist for someone else
        if (!await store.allMovementsOwned(uuid, ids)) {
            return res.status(404).json({ message: `One or more requested movements not found` });
        }

        rows = await store.listVariationsByMovementIds(ids);
    }
    catch (error) {
        return handleSqlError(error, res);
    }

    // Every requested id gets an entry so callers can tell "no variations" from "not requested"
    const data: Record<string, Omit<store.VariationBatchRow, 'movement_id'>[]> = {};
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
    try {
        if (!await store.ownsMovement(uuid, movementId)) {
            return res.status(404).json({ message: `movement with id ${movementId} not found` });
        }
    } catch (error) {
        return handleSqlError(error, res);
    }

    let data: store.VariationSummary[];
    try {
        data = await store.listVariationsForMovement(movementId);
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
    let data: store.VariationSummary | null;
    try {
        data = await store.getVariationById(uuid, variationId);
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

// GET history, optionally bounded to an inclusive [from, to] range (both ISO 8601 date/datetime strings)
router.get('/history/:variationId', async (req, res): Promise<any> => {
    const variationId = req.params.variationId;
    if (!validateId(variationId, res)) return;

    const from = typeof req.query.from === 'string' ? req.query.from : undefined;
    const to = typeof req.query.to === 'string' ? req.query.to : undefined;
    if (from !== undefined && !isValidISO(from)) {
        return res.status(400).json({ message: 'from must be an ISO 8601 formatted date string' });
    }
    if (to !== undefined && !isValidISO(to)) {
        return res.status(400).json({ message: 'to must be an ISO 8601 formatted date string' });
    }

    const { uuid }: User = res.locals.user;
    let data: store.HistoryEntry[];
    try {
        if (!await store.ownsVariation(uuid, variationId)) {
            return res.status(404).json({ message: `variation with id ${variationId} not found` });
        }

        data = await store.getHistory(variationId, from, to);
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

    const allowedFields = ['label', 'weight', 'reps', 'date', 'notes'];
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
        if (!await store.ownsVariation(uuid, variationId)) {
            return res.status(404).json({ message: `No variation with id ${variationId}` });
        }
    } catch (error) {
        return handleSqlError(error, res);
    }

    let updated: boolean;
    try {
        updated = await store.updateVariationFields(variationId, req.body);
    } catch (error) {
        return handleSqlError(error, res)
    }

    if (!updated) {
        return res.status(404).json({ message: `No variation with id ${variationId}` });
    }

    if ('weight' in req.body || 'reps' in req.body) {
        const historyDate = req.body.date ?? new Date();
        await store.appendHistoryIfChanged(variationId, historyDate);
    }

    res.status(200).json({ message: `Successfully updated ${Object.keys(req.body).join(', ')} of variation with id ${variationId}` });
})

// DELETE
router.delete('/:variationId', async (req, res): Promise<any> => {
    const variationId = req.params.variationId;
    if (!validateId(variationId, res)) return;

    const { uuid }: User = res.locals.user;
    let deleted: boolean;
    try {
        deleted = await store.deleteVariation(uuid, variationId);
    } catch (error) {
        return handleSqlError(error, res);
    }

    if (!deleted) {
        return res.status(404).json({ message: `No variation found with id ${variationId}` });
    }

    res.status(200).json({ message: `Successfully deleted variation with id ${variationId}` });
})

export default router;
