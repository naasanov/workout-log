import { Router } from 'express';
import handleSqlError from '../utils/handleSqlError';
import { validateId } from '../utils/validation';
import { parseISO } from 'date-fns';
import { authenticateToken } from './auth';
import { User } from '../types';
import * as store from '../services/bodyWeight/store';

const router = Router();
router.use(authenticateToken);

// GET all entries for the authenticated user, optionally bounded to a date range
router.get('/', async (req, res): Promise<any> => {
    const { uuid }: User = res.locals.user;
    const from = req.query.from as string | undefined;
    const to = req.query.to as string | undefined;

    try {
        const data = await store.listEntries(uuid, from, to);
        return res.status(200).json({
            data,
            message: `Successfully retrieved body weight entries`
        });
    } catch (error) {
        return handleSqlError(error, res);
    }
});

// POST a new entry
router.post('/', async (req, res): Promise<any> => {
    const { uuid }: User = res.locals.user;
    const { weight, date } = req.body;

    if (weight == null || typeof weight !== 'number' || weight <= 0) {
        return res.status(400).json({ message: 'weight must be a positive number' });
    }

    const parsedDate = date ? new Date(parseISO(date)) : new Date();

    try {
        const id = await store.createEntry(uuid, weight, parsedDate);
        return res.status(201).json({
            data: { id },
            message: `Successfully logged body weight`
        });
    } catch (error) {
        return handleSqlError(error, res);
    }
});

// DELETE an entry (only if it belongs to the user)
router.delete('/:id', async (req, res): Promise<any> => {
    const { uuid }: User = res.locals.user;
    const id = req.params.id;
    if (!validateId(id, res)) return;

    try {
        const deleted = await store.deleteEntry(uuid, Number(id));
        if (!deleted) {
            return res.status(404).json({ message: `No body weight entry with id ${id} found for this user` });
        }
        return res.status(200).json({ message: `Successfully deleted body weight entry with id ${id}` });
    } catch (error) {
        return handleSqlError(error, res);
    }
});

export default router;
