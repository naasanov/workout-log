import { Router } from "express";
import { ResultSetHeader, RowDataPacket } from "mysql2";
import pool from '../database';
import handleSqlError from '../utils/handleSqlError';
import SqlError from '../utils/sqlErrors';
import bcrypt from 'bcrypt';
const { NULL_ERROR, PARSE_ERROR, DUPLICATE_ERROR } = SqlError;
import { authenticateToken } from "./auth";
import { User } from "../types";

const router = Router();
router.use(authenticateToken);

// Create
router.post('/', async (req, res): Promise<any> => {
    type ReqBody = { email: string, password: string };
    const { email, password }: ReqBody = req.body;

    if (!email || !password) {
        return res.status(400).json({ message: "Missing email and/or password in request body" });
    }

    if (Object.keys(req.body).length !== 2) {
        return res.status(400).json({ message: "Body must only include email and password" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    let result: RowDataPacket;
    try {
        await pool.query<ResultSetHeader>(`
            INSERT INTO users (email, password)
            VALUES (?, ?);
            `, [email, hashedPassword]
        );

        [[result]] = await pool.query<RowDataPacket[]>(`
            SELECT BIN_TO_UUID(user_uuid) AS uuid
            FROM users
            WHERE email = ?;
        `, [email])
    } catch (error) {
        return handleSqlError(error, res, {
            [DUPLICATE_ERROR]: [409, "User with this email already exists"]
        })
    }

    res.status(201).json({
        message: "Successfully created new user",
        data: { uuid: result.uuid }
    });
});

// Read
router.get('/', async (req, res): Promise<any> => {
    const { uuid }: User = res.locals.user;

    let data: RowDataPacket;
    try {
        [[data]] = await pool.query<RowDataPacket[]>(`
            SELECT BIN_TO_UUID(user_uuid) AS uuid, email, password 
            FROM users
            WHERE user_uuid = UUID_TO_BIN(?);
        `, [uuid])
    } catch (error) {
        return handleSqlError(error, res)
    }

    if (!data) {
        return res.status(404).json({ message: `No user found with uuid ${uuid}` });
    }

    res.status(200).json({
        data,
        message: `Successfully retrieved user with uuid ${uuid}`
    })
})

router.get('/all', async (req, res): Promise<any> => {
    let data: RowDataPacket[];
    try {
        [data] = await pool.query<RowDataPacket[]>(`
            SELECT BIN_TO_UUID(user_uuid) AS user_uuid, email, password
            FROM users;
        `);
    } catch (error) {
        return handleSqlError(error, res)
    }
    res.status(200).json({
        data,
        message: "Successfully retrieved all users"
    });
})

router.get('/email/:email', async (req, res): Promise<any> => {
    const email = req.params.email;
    const password = req.body.password;

    if (!password) {
        return res.status(400).json({ message: "Request body must include a password" })
    }

    let data: RowDataPacket;
    try {
        [[data]] = await pool.query<RowDataPacket[]>(`
            SELECT BIN_TO_UUID(user_uuid) AS uuid, email, password 
            FROM users
            WHERE email = ? AND password = ?;
        `, [email, password])
    }
    catch (error) {
        return handleSqlError(error, res, {
            fallback: [500, "Some error (error handling not fully implemented yet)"]
        });
    }

    if (!data) {
        return res.status(404).json({ message: `No user found with email ${email}` });
    }

    res.status(200).json({
        data,
        message: `Successfully retrieved user with email ${email}`
    });
})

router.get('/uuid/:uuid', async (req, res): Promise<any> => {
    const uuid: string = req.params.uuid;

    let data: RowDataPacket;
    try {
        [[data]] = await pool.query<RowDataPacket[]>(`
            SELECT BIN_TO_UUID(user_uuid) AS uuid, email, password 
            FROM users
            WHERE user_uuid = UUID_TO_BIN(?);
        `, [uuid])
    } catch (error) {
        return handleSqlError(error, res)
    }

    if (!data) {
        return res.status(404).json({ message: `No user found with uuid ${uuid}` });
    }

    res.status(200).json({
        data,
        message: `Successfully retrieved user with uuid ${uuid}`
    })
})

// Update
router.patch('/', async (req, res): Promise<any> => {
    const { uuid }: User = res.locals.user;
    if ('user_uuid' in req.body) {
        return res.status(400).json({ message: "Field not allowed" });
    }

    let data: ResultSetHeader;
    try {
        [data] = await pool.query<ResultSetHeader>(`
            UPDATE users
            SET ?
            WHERE user_uuid = UUID_TO_BIN(?)
            `, [req.body, uuid]
        )
    } catch (error) {
        return handleSqlError(error, res, {
            [PARSE_ERROR]: [400, "Request body must only include email and/or password"],
            [NULL_ERROR]: [400, "Request body parameters cannot be null"],
            [DUPLICATE_ERROR]: [409, "User with this email already exists"],
        })
    }

    if (data.affectedRows === 0) {
        return res.status(404).json({ message: `No user with uuid ${uuid}` });
    }

    res.status(200).send({ message: `Successfully updated user with uuid ${uuid}` });
})

// Delete
router.delete('/:uuid', async (req, res): Promise<any> => {
    const uuid: string = req.params.uuid;

    let data: ResultSetHeader;
    try {
        [data] = await pool.query<ResultSetHeader>(`
            DELETE FROM users
            WHERE user_uuid = UUID_TO_BIN(?)
            `, [uuid]
        )
    } catch (error) {
        return handleSqlError(error, res)
    }

    if (data.affectedRows === 0) {
        return res.status(404).json({ message: `No user found with uuid ${uuid}` });
    }

    res.status(200).send({
        message: `Successfully deleted user with uuid ${uuid}`
    });
})

export default router;