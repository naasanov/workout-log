import { ResultSetHeader, RowDataPacket } from 'mysql2';
import { Router } from 'express';
import pool from '../database';
import handleSqlError from '../utils/handleSqlError';
import SqlError from '../utils/sqlErrors';
const { NULL_ERROR, PARSE_ERROR, DUPLICATE_ERROR } = SqlError;

const router = Router();

// GET many
router.get('/:userId', async (req, res) => {
    let data: RowDataPacket[];
    const userId = req.params.userId;

    try {
        const [userExists] = await pool.query(`
            SELECT 1 FROM users
            WHERE user_id = ?
            LIMIT 1
        `, [userId])
        if (!userExists) {
            res.send(404).json({ message: `User with id ${userId} does not exist` });
            return;
        }
    } catch (error) {
        handleSqlError(error, res);
        return;
    }

    try {
        [data] = await pool.query<RowDataPacket[]>(`
            SELECT section_id, label
            FROM sections
            WHERE user_id = ?
        `, [userId])
    }
    catch (error) {
        handleSqlError(error, res);
        return;
    }

    res.status(200).json({
        data,
        message: `Successfully retrieved all sections for user with id ${userId}`
    })
})

// GET one
router.get('/:sectionId', async (req, res) => {
    let data: RowDataPacket;
    const sectionId = req.params.sectionId;

    try {
        [[data]] = await pool.query<RowDataPacket[]>(`
            SELECT section_id, label
            FROM sections
            WHERE section_id = ?
        `, [sectionId]);
    }
    catch (error) {
        handleSqlError(error, res);
        return;
    }

    if (!data) {
        res.status(404).json({ message: `Section with id ${sectionId} not found`});
        return;
    }

    res.status(200).json({
        data,
        message: `Successfully retrieved section with id ${sectionId}`
    })
})

// POST
router.post('/:userId', async (req, res) => {
    type ReqBody = { label: string };
    const { label }: ReqBody = req.body;
    const userId = req.params.userId;
    let result: ResultSetHeader;
    
    if (!label) {
        res.send(400).json({ message: 'Request body must include a label'});
        return;
    }
    
    try {
        [result] = await pool.query<ResultSetHeader>(`
            INSERT INTO sections
            VALUES (?, ?)
        `, [userId, label])
    }
    catch (error) {
        handleSqlError(error, res, {
            [NULL_ERROR]: [400, "Label and user id cannot be null"],
        })
        return;
    }

    const sectionId = result.insertId;
    res.send(200).json({
        data: { sectionId },
        message: `Successfullly created section`
    })
})

// PATCH
router.patch('/:sectionId', async (req, res) => {
    
})

// DELETE
router.delete('/:sectionId', async (req, res) => {
    
})

export default router;