import { ResultSetHeader, RowDataPacket } from 'mysql2';
import { NextFunction, Router, Response, Request } from 'express';
import pool from '../database';
import handleSqlError from '../utils/handleSqlError';
import bcrpyt from 'bcrypt';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import { User } from "../types";
import SqlError from '../utils/sqlErrors';
const { DUPLICATE_ERROR } = SqlError;
dotenv.config();
const router = Router();

router.post('/login', async (req, res): Promise<any> => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: "Request body must include email and password" });
  }

  // deletes any tokens that are already associated with the user
  try {
    await pool.query<ResultSetHeader>(`
        DELETE t FROM tokens t
        LEFT JOIN users u ON u.user_uuid = t.user_uuid
        WHERE u.email = ?
    `, [email])
  } catch (error) {
    return handleSqlError(error, res);
  }

  let data: RowDataPacket;
  try {
    [[data]] = await pool.query<RowDataPacket[]>(`
            SELECT BIN_TO_UUID(user_uuid) as uuid, password, email
            FROM users
            WHERE users.email = ?
        `, [email])
    if (!data || !await bcrpyt.compare(password, data.password)) {
      return res.status(401).json({ message: "Unautorized" });
    }
  }
  catch (error) {
    return handleSqlError(error, res);
  }

  const accessToken = generateAccessToken({ uuid: data.uuid });
  const refreshToken = jwt.sign({ uuid: data.uuid }, process.env.REFRESH_TOKEN_SECRET!);
  try {
    await pool.query<ResultSetHeader>(`
            INSERT INTO tokens (user_uuid, token, expires_at)
            VALUES (UUID_TO_BIN(?), ?, DATE_ADD(NOW(), INTERVAL 7 DAY))
        `, [data.uuid, refreshToken])
  } catch (error) {
    return handleSqlError(error, res);
  }

  res.cookie("refreshToken", refreshToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: "strict",
    path: "/",
    maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
  })

  res.status(201).json({
    message: "Logged in successfully",
    data: {
      accessToken,
      refreshToken,
      user: {
        uuid: data.uuid,
        email: data.email
      }
    }
  })
})

router.post('/signup', async (req, res): Promise<any> => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: "Request body must include email and password" });
  }

  const hashedPassword = await bcrpyt.hash(password, 10);
  let data: RowDataPacket;
  try {
    await pool.query<ResultSetHeader>(`
      INSERT INTO users (email, password)
      VALUES (?, ?)
    `, [email, hashedPassword]);
    [[data]] = await pool.query<RowDataPacket[]>(`
      SELECT BIN_TO_UUID(user_uuid) as uuid, email FROM users
      WHERE email = ?
    `, [email])
  } catch (error) {
    return handleSqlError(error, res, {
      [DUPLICATE_ERROR]: [409, `User with email ${email} already exists`]
    })
  }

  const accessToken = generateAccessToken({ uuid: data.uuid });
  const refreshToken = jwt.sign({ uuid: data.uuid }, process.env.REFRESH_TOKEN_SECRET!);
  try {
    await pool.query<ResultSetHeader>(`
            INSERT INTO tokens (user_uuid, token, expires_at)
            VALUES (UUID_TO_BIN(?), ?, DATE_ADD(NOW(), INTERVAL 7 DAY))
        `, [data.uuid, refreshToken])
  } catch (error) {
    return handleSqlError(error, res);
  }

  res.cookie("refreshToken", refreshToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: "strict",
    path: "/",
    maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
  })

  res.status(201).json({
    message: "User successfully created",
    data: {
      accessToken,
      refreshToken,
      user: {
        uuid: data.uuid,
        email: data.email
      }
    }
  })
})

router.post('/token', async (req, res): Promise<any> => {
  const refreshToken: string = req.cookies?.refreshToken;
  if (!refreshToken) {
    return res.status(401).json({ message: "Refresh token required" });
  }

  let result: RowDataPacket;
  try {
    [[result]] = await pool.query<RowDataPacket[]>(`
      SELECT token, expires_at FROM tokens
      WHERE token = ?
    `, [refreshToken])
  } catch (error) {
    return handleSqlError(error, res);
  }

  if (!result) {
    return res.status(401).json({ message: "Unauthorized refresh token" })
  }
  else if (new Date(result.expires_at) < new Date()) {
    return res.status(401).json({ message: "Refresh token expired" });
  }

  jwt.verify(refreshToken, process.env.REFRESH_TOKEN_SECRET!, (err, user) => {
    if (err) {
      return res.status(403).json({ message: "Forbidden refresh token. Did not pass verification" });
    }
    const { uuid } = user as User;
    const accessToken = generateAccessToken({ uuid });
    res.status(201).json({
      message: "Successfully created access token",
      data: { accessToken }
    })
  })
})

router.delete('/logout', async (req, res): Promise<any> => {
  const refreshToken: string = req.cookies.refreshToken;
  if (!refreshToken) {
    return res.status(401).json({ message: "Refresh token required" });
  }

  let data: ResultSetHeader;
  try {
    [data] = await pool.query<ResultSetHeader>(`
      DELETE FROM tokens
      WHERE token = ?
    `, [refreshToken])
  } catch (error) {
    return handleSqlError(error, res);
  }

  if (data.affectedRows === 0) {
    return res.status(404).json({ message: "Refresh token not found" });
  }

  res.clearCookie('refreshToken', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: "strict",
    path: "/",
  })

  res.status(200).json({ message: "Successfully logged out" });
})

function generateAccessToken(user: User): string {
  return jwt.sign(user, process.env.ACCESS_TOKEN_SECRET!, { expiresIn: '15s' });
}

export function authenticateToken(req: Request, res: Response, next: NextFunction): any {
  const authHeader = req.headers['authorization'];
  const token = authHeader?.split(' ')[1];
  if (token == null) {
    return res.status(401).json({ message: "Unauthorized: access token required" });
  }
  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET!, (err, user) => {
    if (err) {
      return res.status(403).json({ message: "Forbidden access token" });
    }
    res.locals.user = user as User;
    next();
  })
}

export default router;