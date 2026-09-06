import { Router } from 'express';
import handleSqlError from '../utils/handleSqlError';
import { validateId, validateLabel } from '../utils/validation';
import SqlError from '../utils/sqlErrors';
const { NO_REFERENCE_ERROR, WRONG_VALUE_ERROR } = SqlError;
import { authenticateToken } from "./auth";
import { User } from '../types';
import * as store from '../services/workouts';

const router = Router();
router.use(authenticateToken);

// Movements are owned transitively: movement -> section -> user. Without confirming that
// chain a valid token can reach another user's data by guessing sequential ids. Callers
// report a 404 rather than a 403 so ids stay unenumerable.

// POST
router.post('/:sectionId', async (req, res): Promise<any> => {
    const label = req.body.label;
    const sectionId = req.params.sectionId;

    if (!validateId(sectionId, res) || !validateLabel(label, res)) return;

    const { uuid }: User = res.locals.user;
    try {
        if (!await store.ownsSection(uuid, sectionId)) {
            return res.status(404).json({ message: `Section with id ${sectionId} not found` });
        }
    } catch (error) {
        return handleSqlError(error, res);
    }

    let movementId: number;
    try {
        movementId = await store.createMovement(sectionId, label);
    } catch (error) {
        return handleSqlError(error, res, {
            [NO_REFERENCE_ERROR]: [404, `Section with id ${sectionId} not found`],
        });
    }

    res.status(201).json({
        data: { movementId },
        message: `Successfullly created movement with id ${movementId}`
    })
})

// GET many
router.get('/section/:sectionId', async (req, res): Promise<any> => {
    const sectionId = req.params.sectionId;
    if (!validateId(sectionId, res)) return;

    const { uuid }: User = res.locals.user;
    try {
        if (!await store.ownsSection(uuid, sectionId)) {
            return res.status(404).json({ message: `Section with id ${sectionId} does not exist` });
        }
    } catch (error) {
        return handleSqlError(error, res);
    }

    let data: store.MovementSummary[];
    try {
        data = await store.listMovementsForSection(sectionId);
    }
    catch (error) {
        return handleSqlError(error, res);
    }

    res.status(200).json({
        data,
        message: `Successfully retrieved all movements for section with id ${sectionId}`
    })
})

// GET one
router.get('/movement/:movementId', async (req, res): Promise<any> => {
    const movementId = req.params.movementId;
    if (!validateId(movementId, res)) return;

    const { uuid }: User = res.locals.user;
    let data: store.MovementSummary | null;
    try {
        data = await store.getMovementById(uuid, movementId);
    }
    catch (error) {
        return handleSqlError(error, res);
    }

    if (!data) {
        return res.status(404).json({ message: `movement with id ${movementId} not found` });
    }

    res.status(200).json({
        data,
        message: `Successfully retrieved movement with id ${movementId}`
    })
})

// PATCH
router.patch('/:movementId', async (req, res): Promise<any> => {
    const movementId: string = req.params.movementId;
    const label = req.body.label;
    if (!validateId(movementId, res) || !validateLabel(label, res)) return;

    const { uuid }: User = res.locals.user;
    let updated: boolean;
    try {
        updated = await store.updateMovement(uuid, movementId, label);
    } catch (error) {
        return handleSqlError(error, res)
    }

    if (!updated) {
        return res.status(404).json({ message: `No movement with id ${movementId}` });
    }

    res.status(200).json({ message: `Successfully updated movement with id ${movementId}` });
})

// DELETE
router.delete('/:movementId', async (req, res): Promise<any> => {
    const movementId = req.params.movementId;
    if (!validateId(movementId, res)) return;

    const { uuid }: User = res.locals.user;
    let deleted: boolean;
    try {
        deleted = await store.deleteMovement(uuid, movementId);
    } catch (error) {
        return handleSqlError(error, res, {
            [WRONG_VALUE_ERROR]: [400, "Request parameter movement id must be an integer"]
        });
    }

    if (!deleted) {
        return res.status(404).json({ message: `No movement found with id ${movementId}` });
    }

    res.status(200).json({ message: `Successfully deleted movement with id ${movementId}` });
})

export default router;
