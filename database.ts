import mysql from "mysql2";
import dotenv from "dotenv";
dotenv.config();

// JawsDB's free plan caps the account at 10 concurrent connections. mysql2 defaults to a
// pool of 10, so a busy web dyno can claim every slot and starve the release-phase
// migration, which fails the deploy. Leave headroom for it and for one-off dynos.
const connectionLimit = process.env.DB_POOL_LIMIT
    ? parseInt(process.env.DB_POOL_LIMIT)
    : 5;

const pool = process.env.JAWSDB_URL !== undefined
    ? mysql.createPool({ uri: process.env.JAWSDB_URL, connectionLimit }).promise()
    : mysql.createPool({
        host: process.env.DB_HOST,
        port: process.env.DB_PORT ? parseInt(process.env.DB_PORT) : 3306,
        user: process.env.DB_USERNAME,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        connectionLimit
    }).promise();

export default pool;