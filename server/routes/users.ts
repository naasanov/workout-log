import { Router, Request, Response } from "express";
import { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import pool from '../database';
import handleSqlError from '../utils/handleSqlError';
import SqlError from '../utils/sqlErrors';
const { NULL_ERROR, PARSE_ERROR, DUPLICATE_ERROR, FIELD_ERROR } = SqlError;

const router = Router();

// TODO: Add error handling
// Create
router.post('/', async (req: Request, res: Response) => {
    type ReqBody = { email: string, password: string };
    const { email, password }: ReqBody = req.body;

    if (!email || !password) {
        res.status(400).json({ message: "Missing email and/or password in request body" });
        return;
    }

    if (Object.keys(req.body).length !== 2) {
        res.status(400).json({ message: "Body must only include eamil and password"});
        return;
    }

    try {
        await pool.query<ResultSetHeader>(`
            INSERT INTO users (email, password)
            VALUES (?, ?)
            `, [email, password]
        )
    } catch (error) {
        handleSqlError(error, res, {
            [NULL_ERROR]: [400, "Email or password cannot be null"],
            [DUPLICATE_ERROR]: [409, "User with this email already exists"]
        })
        return;
    }

    res.status(200).json({ message: "Successfully created new user" });
});

// Read
router.get('/', async (req: Request, res: Response) => {
    let data: RowDataPacket[];
    try {
        [data] = await pool.query<RowDataPacket[]>(`SELECT * FROM users`);
    } catch (error) {
        console.log(error);
        res.status(500).json({ message: "Internal server error" });
        return;
    }   

    res.status(200).json({
        data,
        message: "Successfully retrieved all users"
    });
})

router.get('/:id', async (req: Request, res: Response) => {
    const id: string = req.params.id;

    let data: RowDataPacket;
    try {
        [[data]] = await pool.query<RowDataPacket[]>(`
            SELECT * FROM users
            WHERE uuid = ?
            `, [id]
        )
    } catch (error) {
        handleSqlError(error, res)
        return;
    }

    if (!data) {
        res.status(404).json({ message: `No user found with id ${id}`});
        return;
    }

    res.status(200).json({
        data,
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

    let data: ResultSetHeader;
    try {
        [data] = await pool.query<ResultSetHeader>(`
            UPDATE users
            SET ?
            WHERE uuid = ?
            `, [req.body, id]
        )
    } catch (error) {
        handleSqlError(error, res, {
            [PARSE_ERROR]: [400, "Request body must only include email and/or password"],
            [NULL_ERROR]: [400, "Request body parameters cannot be null"],
            [DUPLICATE_ERROR]: [409, "User with this email already exists"],
        })
        return;
    }

    if (data.affectedRows === 0) {
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
    
    let data: ResultSetHeader;
    try {
        [data] = await pool.query<ResultSetHeader>(`
            DELETE FROM users
            WHERE uuid = ?
            `, [id]
        )
    } catch (error) {
        handleSqlError(error, res)
        return;
    }

    if (data.affectedRows === 0) {
        res.status(404).json({ message: `No user found with id ${id}`});
        return;
    }

    res.status(200).send({
        message: `Successfully deleted user with id ${id}`
    });
})

export default router;