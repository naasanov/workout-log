import { Router, Request, Response } from "express";
import { ResultSetHeader } from "mysql2/promise";
import { Pool } from "mysql2/promise";

const router = Router();

// Create
router.post('/', async (req: Request, res: Response) => {
    type ReqBody = { email: string, password: string };
    const { email, password }: ReqBody = req.body;

    const pool: Pool = req.pool;

    const [result] = await pool.query<ResultSetHeader>(`
        INSERT INTO users (email, password)
        VALUES (?, ?)
        `, [email, password]
    )

    const id = result.insertId;

    console.log(result)
    res.status(200).send()
});

// Read

// Update

// Delete


export default router;