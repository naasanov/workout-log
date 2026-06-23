import { PoolConnection } from 'mysql2/promise';
import pool from '../database';

/**
 * Runs a callback inside a MySQL transaction.
 * Acquires a connection, begins a transaction, then calls the callback.
 * Commits on success, rolls back on any throw, and always releases the connection.
 * @param callback Function that receives the connection and performs queries on it.
 * @returns The resolved value of the callback.
 */
async function withTransaction<T>(callback: (conn: PoolConnection) => Promise<T>): Promise<T> {
    const conn = await pool.getConnection();
    await conn.beginTransaction();
    try {
        const result = await callback(conn);
        await conn.commit();
        return result;
    } catch (error) {
        await conn.rollback();
        throw error;
    } finally {
        conn.release();
    }
}

export default withTransaction;
