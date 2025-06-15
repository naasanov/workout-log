import { ResultSetHeader, RowDataPacket } from 'mysql2';
import { Router } from 'express';
import pool from '../database';
import handleSqlError from '../utils/handleSqlError';
import { validateLabel, validateId, validateSection } from '../utils/validation';
import SqlError from '../utils/sqlErrors';
const { WRONG_TYPE_ERROR, NO_REFERENCE_ERROR, TOO_LONG_ERROR, WRONG_VALUE_ERROR } = SqlError;
import { authenticateToken } from "./auth";
import { User } from '../types';

const router = Router();
router.use(authenticateToken);

// POST
router.post('/', async (req, res): Promise<any> => {
    const { uuid }: User = res.locals.user;
    const label = req.body.label;
    if (!validateLabel(label, res)) return;

    let result: ResultSetHeader;
    try {
        [result] = await pool.query<ResultSetHeader>(`
            INSERT INTO sections (user_uuid, label)
            VALUES (UUID_TO_BIN(?), ?)
            `, [uuid, label])
        }
    catch (error) {
        return handleSqlError(error, res, {
            [WRONG_TYPE_ERROR]: [400, "Request parameter must be a 36 character, hyphen separated uuid"],
            [NO_REFERENCE_ERROR]: [404, `User with uuid ${uuid} not found`],
            [TOO_LONG_ERROR]: [400, `Label must not exceed 50 characters`]
        })
    }
    
    const sectionId = result.insertId;
    res.status(201).json({
        data: { sectionId },
        message: `Successfullly created section with id ${sectionId}`
    })
})

// GET many
router.get('/user', async (req, res): Promise<any> => {
    const { uuid }: User = res.locals.user;
    
    let data: RowDataPacket[];
    try {
        const [userExists] = await pool.query<RowDataPacket[]>(`
            SELECT 1 FROM users
            WHERE user_uuid = UUID_TO_BIN(?)
        `, [uuid])
        if (userExists.length === 0) {
            return res.status(404).json({ message: `User with id ${uuid} does not exist` });
        }
    } catch (error) {
        return handleSqlError(error, res, {
            [WRONG_TYPE_ERROR]: [400, "Request parameter must be a 36 character, hyphen separated uuid"]
        });
    }

    try {
        [data] = await pool.query<RowDataPacket[]>(`
            SELECT 
                section_id as id, 
                label,
                CAST(is_open AS BOOLEAN) AS showItems
            FROM sections
            WHERE user_uuid = UUID_TO_BIN(?)
        `, [uuid])
    }
    catch (error) {
        return handleSqlError(error, res);
    }

    res.status(200).json({
        data,
        message: `Successfully retrieved all sections for user with id ${uuid}`
    })
})

// GET one
router.get('/section/:sectionId', async (req, res): Promise<any> => {
    const sectionId = req.params.sectionId;
    if (!validateId(sectionId)) return;
    
    let data: RowDataPacket;
    try {
        [[data]] = await pool.query<RowDataPacket[]>(`
            SELECT section_id as id, label
            FROM sections
            WHERE section_id = ?
        `, [sectionId]);
    }
    catch (error) {
        return handleSqlError(error, res);
    }

    if (!data) {
        return res.status(404).json({ message: `Section with id ${sectionId} not found` });
    }

    res.status(200).json({
        data,
        message: `Successfully retrieved section with id ${sectionId}`
    })
})

// PATCH
router.patch('/:sectionId', async (req, res): Promise<any> => {
    const sectionId = req.params.sectionId;
    if (!validateId(sectionId, res)) return;

    const allowedFields = ['label', 'is_open'];
    const invalidFields = Object.keys(req.body).filter(key => !allowedFields.includes(key));
    if (invalidFields.length > 0) {
        return res.status(400).json({
            message: `Invalid fields: ${invalidFields.join(', ')}. Allowed fields are: ${allowedFields.join(', ')}.`
        });
    }
    if (!validateSection(req.body, res)) return;

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
            [WRONG_VALUE_ERROR]: [400, "Request parameter section id must be an integer"]
        })
    }

    if (data.affectedRows === 0) {
        return res.status(404).json({ message: `No section with id ${sectionId}` });
    }

    res.status(200).json({ message: `Successfully updated section with id ${sectionId}` });
})

// DELETE
router.delete('/:sectionId', async (req, res): Promise<any> => {
    const sectionId = req.params.sectionId;
    if (!validateId(sectionId, res)) return;

    let data: ResultSetHeader;
    try {
        [data] = await pool.query<ResultSetHeader>(`
            DELETE FROM sections
            WHERE section_id = ?
            `, [sectionId]
        )
    } catch (error) {
        return handleSqlError(error, res, {
            [WRONG_VALUE_ERROR]: [400, "Request parameter section id must be an integer"]
        });
    }

    if (data.affectedRows === 0) {
        return res.status(404).json({ message: `No section found with id ${sectionId}` });
    }

    res.status(200).json({ message: `Successfully deleted section with id ${sectionId}` });
})

export default router;