import { ResultSetHeader, RowDataPacket } from 'mysql2';
import { Router } from 'express';
import pool from '../database';
import handleSqlError from '../utils/handleSqlError';
import { validateId } from '../utils/validation';
import { parseISO } from 'date-fns';
import { authenticateToken } from './auth';
import { User } from '../types';

const router = Router();
router.use(authenticateToken);

// GET all entries for the authenticated user
router.get('/', async (req, res): Promise<any> => {
    const { uuid }: User = res.locals.user;

    let data: RowDataPacket[];
    try {
        [data] = await pool.query<RowDataPacket[]>(`
            SELECT id, weight, date
            FROM body_weight
            WHERE user_uuid = UUID_TO_BIN(?)
            ORDER BY date ASC
        `, [uuid]);
    } catch (error) {
        return handleSqlError(error, res);
    }

    res.status(200).json({
        data,
        message: `Successfully retrieved body weight entries`
    });
});

// POST a new entry
router.post('/', async (req, res): Promise<any> => {
    const { uuid }: User = res.locals.user;
    const { weight, date } = req.body;

    if (weight == null || typeof weight !== 'number' || weight <= 0) {
        return res.status(400).json({ message: 'weight must be a positive number' });
    }

    const parsedDate = date ? new Date(parseISO(date)) : new Date();

    let result: ResultSetHeader;
    try {
        [result] = await pool.query<ResultSetHeader>(`
            INSERT INTO body_weight (user_uuid, weight, date)
            VALUES (UUID_TO_BIN(?), ?, ?)
        `, [uuid, weight, parsedDate]);
    } catch (error) {
        return handleSqlError(error, res);
    }

    res.status(201).json({
        data: { id: result.insertId },
        message: `Successfully logged body weight`
    });
});

// DELETE an entry (only if it belongs to the user)
router.delete('/:id', async (req, res): Promise<any> => {
    const { uuid }: User = res.locals.user;
    const id = req.params.id;
    if (!validateId(id, res)) return;

    let data: ResultSetHeader;
    try {
        [data] = await pool.query<ResultSetHeader>(`
            DELETE FROM body_weight
            WHERE id = ? AND user_uuid = UUID_TO_BIN(?)
        `, [id, uuid]);
    } catch (error) {
        return handleSqlError(error, res);
    }

    if (data.affectedRows === 0) {
        return res.status(404).json({ message: `No body weight entry with id ${id} found for this user` });
    }

    res.status(200).json({ message: `Successfully deleted body weight entry with id ${id}` });
});

export default router;
