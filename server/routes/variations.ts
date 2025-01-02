import { ResultSetHeader, RowDataPacket } from 'mysql2';
import { Router } from 'express';
import pool from '../database';
import handleSqlError from '../utils/handleSqlError';
import { validateId, validateVariation } from '../utils/validation';
import { parseISO } from "date-fns";
import SqlError from '../utils/sqlErrors';
const { NO_REFERENCE_ERROR } = SqlError;

const router = Router();

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

    let result: ResultSetHeader;
    try {
        [result] = await pool.query<ResultSetHeader>(`
            INSERT INTO variations (movement_id, label, weight, reps, date)
            VALUES (?, ?, ?, ?, ?)
            `, [movementId, label, weight, reps, date])
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

// GET many
router.get('/movement/:movementId', async (req, res): Promise<any> => {
    const movementId = req.params.movementId;
    if (!validateId(movementId, res)) return;
    
    let data: RowDataPacket[];
    try {
        const [movementExists] = await pool.query<RowDataPacket[]>(`
            SELECT 1 FROM movements
            WHERE movement_id = ?
        `, [movementId])
        if (movementExists.length === 0) {
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
    
    let data: RowDataPacket;
    try {
        [[data]] = await pool.query<RowDataPacket[]>(`
            SELECT variation_id as id, label, weight, reps, date
            FROM variations
            WHERE variation_id = ?
        `, [variationId]);
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

    res.status(200).json({ message: `Successfully updated ${Object.keys(req.body).join(', ')} of variation with id ${variationId}` });
})

// DELETE
router.delete('/:variationId', async (req, res): Promise<any> => {
    const variationId = req.params.variationId;
    if (!validateId(variationId, res)) return;

    let data: ResultSetHeader;
    try {
        [data] = await pool.query<ResultSetHeader>(`
            DELETE FROM variations
            WHERE variation_id = ?
            `, [variationId]
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