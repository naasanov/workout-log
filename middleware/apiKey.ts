import { createHash } from 'crypto';
import { NextFunction, Request, Response } from 'express';
import pool from '../database';
import { RowDataPacket } from 'mysql2';

export function hashApiKey(rawKey: string): string {
    return createHash('sha256').update(rawKey).digest('hex');
}

export async function authenticateApiKey(req: Request, res: Response, next: NextFunction): Promise<any> {
    const rawKey = (req.headers['x-api-key'] as string) || (req.query.apiKey as string);
    if (!rawKey) {
        return res.status(401).json({ message: "Unauthorized: API key required (X-API-Key header or apiKey query param)" });
    }

    const keyHash = hashApiKey(rawKey);

    let row: RowDataPacket;
    try {
        [[row]] = await pool.query<RowDataPacket[]>(`
            SELECT id, BIN_TO_UUID(user_uuid) as uuid
            FROM api_keys
            WHERE key_hash = ?
        `, [keyHash]);
    } catch (error) {
        return res.status(500).json({ message: "Internal server error" });
    }

    if (!row) {
        return res.status(401).json({ message: "Unauthorized: invalid API key" });
    }

    // update last_used_at best-effort
    pool.query(`UPDATE api_keys SET last_used_at = NOW() WHERE id = ?`, [row.id]).catch(() => {});

    res.locals.user = { uuid: row.uuid };
    next();
}
