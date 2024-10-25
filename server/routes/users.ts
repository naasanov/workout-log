import { Router, Request, Response } from "express";
import { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import pool from '../database';

const router = Router();

// TODO: Add error handling
// Create
router.post('/', async (req: Request, res: Response) => {
    type ReqBody = { email: string, password: string };
    const { email, password }: ReqBody = req.body;

    const [result] = await pool.query<ResultSetHeader>(`
        INSERT INTO users (email, password)
        VALUES (?, ?)
        `, [email, password]
    )

    res.status(200).json({
        message: "Successfully created new user"
    });
});

// Read
router.get('/', async (req: Request, res: Response) => {
    const [result] = await pool.query<RowDataPacket[]>(`SELECT * FROM users`);
    res.status(200).json({
        data: result,
        message: "Successfully retrieved all users"
    });
})

router.get('/:id', async (req: Request, res: Response) => {
    const id: string = req.params.id;
    const [[result]] = await pool.query<RowDataPacket[]>(`
        SELECT * FROM users
        WHERE uuid = ?
        `, [id]
    )
    res.status(200).json({
        data: result,
        message: `Successfully retrieved user with id ${id}`
    })
})

// Update
router.patch('/:id', async (req: Request, res: Response) => {
    const id: string = req.params.id;
    const [result] = await pool.query<ResultSetHeader>(`
        UPDATE users
        SET ?
        WHERE uuid = ?
        `, [req.body, id]
    )
    res.status(200).send({
        message: `Successfully updated user with id ${id}`
    });
})

// Delete
router.delete('/:id', async (req: Request, res: Response) => {
    const id: string = req.params.id;
    const [result] = await pool.query<ResultSetHeader>(`
        DELETE FROM users
        WHERE uuid = ?
        `, [id]
    )
    res.status(200).send({
        message: `Successfully deleted user with id ${id}`
    });
})

export default router;