import { Router, Request, Response } from "express";
import { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import pool from '../database';
import { getSqlError } from '../utils/helperFunctions';
import sqlErrors from '../utils/sqlErrors';
const { NULL_ERROR, PARSE_ERROR, DUPLICATE_ERROR, FIELD_ERROR } = sqlErrors;

const router = Router();

// TODO: Add error handling
// Create
router.post('/', async (req: Request, res: Response) => {
    type ReqBody = { email: string, password: string };
    const { email, password }: ReqBody = req.body;

    if (!email || !password) {
        res.status(400).json({ message: "Missing email and/or password in request body" })
    }

    try {
        await pool.query<ResultSetHeader>(`
            INSERT INTO users (email, password)
            VALUES (?, ?)
            `, [email, password]
        )
    } catch (error) {
        console.log(error);
        const sqlError = getSqlError(error);
        if (!sqlError) {
            res.status(500).json({ message: "Internal server error" });
        }
        else if (sqlError.code === NULL_ERROR) {
            res.status(400).json({ message: "Email or password cannot be null" })
        }
        else {
            res.status(500).json({ message: "Internal server error" });
        }
        return;
    }

    res.status(200).json({ message: "Successfully created new user" });
});

// Read
router.get('/', async (req: Request, res: Response) => {
    let result: RowDataPacket[];
    try {
        [result] = await pool.query<RowDataPacket[]>(`SELECT * FROM users`);
    } catch (error) {
        console.log(error);
        res.status(500).json({ message: "Internal server error" });
        return;
    }   

    res.status(200).json({
        data: result,
        message: "Successfully retrieved all users"
    });
})

router.get('/:id', async (req: Request, res: Response) => {
    const id: string = req.params.id;

    let result: RowDataPacket;
    try {
        [[result]] = await pool.query<RowDataPacket[]>(`
            SELECT * FROM users
            WHERE uuid = ?
            `, [id]
        )
    } catch (error) {
        console.log(error);
        res.status(500).json({ message: "Internal server error" });
        return;
    }

    if (!result) {
        res.status(404).json({ message: `No user found with id ${id}`});
        return;
    }

    res.status(200).json({
        data: result,
        message: `Successfully retrieved user with id ${id}`
    })
})

// Update
router.patch('/:id', async (req: Request, res: Response) => {
    const id: string = req.params.id;
    
    if ('uuid' in req.body || 'idusers' in req.body) {
        res.status(403).json({ message: "Forbidden" });
        return;
    }

    let result: ResultSetHeader;
    try {
        [result] = await pool.query<ResultSetHeader>(`
            UPDATE users
            SET ?
            WHERE uuid = ?
            `, [req.body, id]
        )
    } catch (error) {
        console.log(error);
        const sqlError = getSqlError(error);
        if (!sqlError) {
            res.status(500).json({ message: "Internal server error" });
        }
        else if (sqlError.code === PARSE_ERROR || sqlError.code === FIELD_ERROR) {
            res.status(400).json({ message: "Request body must only include email and/or password" });
        }
        else if (sqlError.code === NULL_ERROR) {
            res.status(400).json({ message: "Request body parameters cannot be null" })
        }
        else if (sqlError.code === DUPLICATE_ERROR) {
            res.status(409).json({ message: "User with this email already exists" })
        }
        else {
            res.status(500).json({ message: "Internal server error" });
        }
        return;
    }

    if (result.affectedRows === 0) {
        res.status(404).json({ message: `No user with id ${id}`});
        return;
    }

    res.status(200).send({
        message: `Successfully updated user with id ${id}`
    });
})

// Delete
router.delete('/:id', async (req: Request, res: Response) => {
    const id: string = req.params.id;
    
    let result: ResultSetHeader;
    try {
        [result] = await pool.query<ResultSetHeader>(`
            DELETE FROM users
            WHERE uuid = ?
            `, [id]
        )
    } catch (error) {
        console.log(error)
        res.status(500).json({ message: "Internal server error" });
        return;
    }

    if (result.affectedRows === 0) {
        res.status(404).json({ message: `No user found with id ${id}`});
        return;
    }

    res.status(200).send({
        message: `Successfully deleted user with id ${id}`
    });
})

export default router;