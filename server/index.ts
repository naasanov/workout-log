import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import mysql from "mysql2";
import users from './routes/users';
import { Pool } from "mysql2/typings/mysql/lib/Pool";

dotenv.config()

const app = express();
app.use(express.json())
app.use(express.urlencoded({ extended: false }))

app.use(cors({
    credentials: true,
    origin: "*",
    optionsSuccessStatus: 200
}))

const pool: Pool = mysql.createPool({
    host: process.env.HOST,
    user: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
});

app.use((req, res, next) => {
    req.pool = pool;
    next();
});

app.get('/', (req, res) => {
    res.send("Express + TS Server");
})

app.use('/users', users);

const port = process.env.PORT || 4000;
app.listen(port, () => {
    console.log(`[server]: Server running on port ${port}`)
})