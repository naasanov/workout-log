import { ResultSetHeader, RowDataPacket } from 'mysql2';
import { Router } from 'express';
import pool from '../database';
import handleSqlError from '../utils/handleSqlError';
import { validateId, validateLabel } from '../utils/validation';
import SqlError from '../utils/sqlErrors';
const { NO_REFERENCE_ERROR, WRONG_VALUE_ERROR } = SqlError;

const router = Router();

// POST
router.post('/:sectionId', async (req, res): Promise<any> => {
    const label = req.body.label;
    const sectionId = req.params.sectionId;

    if (!validateId(sectionId, res) || !validateLabel(label, res)) return;

    let result: ResultSetHeader;
    try {
        [result] = await pool.query<ResultSetHeader>(`
            INSERT INTO movements (section_id, label)
            VALUES (?, ?)
            `, [sectionId, label])
        }
    catch (error) {
        return handleSqlError(error, res, {
            [NO_REFERENCE_ERROR]: [404, `Section with id ${sectionId} not found`],
        })
    }
    
    const movementId = result.insertId;
    res.status(201).json({
        data: { movementId },
        message: `Successfullly created movement with id ${movementId}`
    })
})

// GET many
router.get('/section/:sectionId', async (req, res): Promise<any> => {
    const sectionId = req.params.sectionId;
    if (!validateId(sectionId, res)) return;
    
    let data: RowDataPacket[];
    try {
        const [sectionExists] = await pool.query<RowDataPacket[]>(`
            SELECT 1 FROM sections
            WHERE section_id = ?
        `, [sectionId])
        if (sectionExists.length === 0) {
            return res.status(404).json({ message: `Section with id ${sectionId} does not exist` });
        }
    } catch (error) {
        return handleSqlError(error, res);
    }

    try {
        [data] = await pool.query<RowDataPacket[]>(`
            SELECT movement_id, label
            FROM movements
            WHERE section_id = ?
        `, [sectionId])
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
    
    let data: RowDataPacket;
    try {
        [[data]] = await pool.query<RowDataPacket[]>(`
            SELECT movement_id, label
            FROM movements
            WHERE movement_id = ?
        `, [movementId]);
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

    let data: ResultSetHeader;
    try {
        [data] = await pool.query<ResultSetHeader>(`
            UPDATE movements
            SET label = ?
            WHERE movement_id = ?
            `, [label, movementId]
        )
    } catch (error) {
        return handleSqlError(error, res)
    }

    if (data.affectedRows === 0) {
        return res.status(404).json({ message: `No movement with id ${movementId}` });
    }

    res.status(200).json({ message: `Successfully updated movement with id ${movementId}` });
})

// DELETE
router.delete('/:movementId', async (req, res): Promise<any> => {
    const movementId = req.params.movementId;
    if (!validateId(movementId, res)) return;

    let data: ResultSetHeader;
    try {
        [data] = await pool.query<ResultSetHeader>(`
            DELETE FROM movements
            WHERE movement_id = ?
            `, [movementId]
        )
    } catch (error) {
        return handleSqlError(error, res, {
            [WRONG_VALUE_ERROR]: [400, "Request parameter movement id must be an integer"]
        });
    }

    if (data.affectedRows === 0) {
        return res.status(404).json({ message: `No movement found with id ${movementId}` });
    }

    res.status(200).json({ message: `Successfully deleted movement with id ${movementId}` });
})

export default router;