import mysql from "mysql2";
import dotenv from "dotenv";
dotenv.config();

const pool = process.env.JAWSDB_URL !== undefined
    ? mysql.createPool(process.env.JAWSDB_URL).promise()
    : mysql.createPool({
        host: process.env.DB_HOST,
        user: process.env.DB_USERNAME,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME
    }).promise();

export default pool;