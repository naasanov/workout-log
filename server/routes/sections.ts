import { ResultSetHeader, RowDataPacket } from 'mysql2';
import { Router } from 'express';
import pool from '../database';
import handleSqlError from '../utils/handleSqlError';
import SqlError from '../utils/sqlErrors';
const { NULL_ERROR, PARSE_ERROR, DUPLICATE_ERROR } = SqlError;

const router = Router();

// GET many
router.get('/:userId', async (req, res): Promise<any> => {
    let data: RowDataPacket[];
    const userId = req.params.userId;

    try {
        const [userExists] = await pool.query(`
            SELECT 1 FROM users
            WHERE user_id = ?
            LIMIT 1
        `, [userId])
        if (!userExists) {
            return res.send(404).json({ message: `User with id ${userId} does not exist` });
        }
    } catch (error) {
        return handleSqlError(error, res);
    }

    try {
        [data] = await pool.query<RowDataPacket[]>(`
            SELECT section_id, label
            FROM sections
            WHERE user_id = ?
        `, [userId])
    }
    catch (error) {
        return handleSqlError(error, res);
    }

    res.status(200).json({
        data,
        message: `Successfully retrieved all sections for user with id ${userId}`
    })
})

// GET one
router.get('/:sectionId', async (req, res): Promise<any> => {
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
        return handleSqlError(error, res);
    }

    if (!data) {
        return res.status(404).json({ message: `Section with id ${sectionId} not found`});
    }

    res.status(200).json({
        data,
        message: `Successfully retrieved section with id ${sectionId}`
    })
})

// POST
router.post('/:userId', async (req, res): Promise<any> => {
    type ReqBody = { label: string };
    const { label }: ReqBody = req.body;
    const userId = req.params.userId;
    let result: ResultSetHeader;
    
    if (!label) {
        return res.send(400).json({ message: 'Request body must include a label'});
    }
    
    try {
        [result] = await pool.query<ResultSetHeader>(`
            INSERT INTO sections
            VALUES (?, ?)
        `, [userId, label])
    }
    catch (error) {
        return handleSqlError(error, res, {
            [NULL_ERROR]: [400, "Label and user id cannot be null"],
        })
    }

    const sectionId = result.insertId;
    res.send(200).json({
        data: { sectionId },
        message: `Successfullly created section`
    })
})

// PATCH
router.patch('/:sectionId', async (req, res): Promise<any> => {
    const sectionId: string = req.params.sectionId;
    if ('section_id' in req.body) {
        return res.status(403).json({ message: "Forbidden" });
    }

    let data: ResultSetHeader;
    try {
        [data] = await pool.query<ResultSetHeader>(`
            UPDATE sections
            SET ?
            WHERE section_id = ?
            `, [req.body, sectionId]
        )
    } catch (error) {
        return handleSqlError(error, res, {
            [PARSE_ERROR]: [400, "Request body must only include label"],
            [NULL_ERROR]: [400, "Request body parameters cannot be null"],
        })
    }

    if (data.affectedRows === 0) {
        return res.status(404).json({ message: `No section with id ${sectionId}`});
    }

    res.status(200).send({ message: `Successfully updated section with id ${sectionId}` });
})

// DELETE
router.delete('/:sectionId', async (req, res): Promise<any> => {
    const sectionId = req.params.sectionId;
    
    let data: ResultSetHeader;
    try {
        [data] = await pool.query<ResultSetHeader>(`
            DELETE FROM sections
            WHERE section_id = ?
            `, [sectionId]
        )
    } catch (error) {
        return handleSqlError(error, res);
    }

    if (data.affectedRows === 0) {
        return res.status(404).json({ message: `No section found with id ${sectionId}`});
    }

    res.status(200).send({ message: `Successfully deleted user with id ${sectionId}` });
})

export default router;