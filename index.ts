import express from "express";
import path from 'path';
import dotenv from "dotenv";
import cors from "cors";
import cookieParser from "cookie-parser";

import users from './routes/users';
import sections from './routes/sections';
import movements from './routes/movements';
import variations from './routes/variations';
import auth from './routes/auth';

dotenv.config();

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(cors({
    credentials: true,
    origin: process.env.FRONTEND_URL || "http://localhost:4000",
    optionsSuccessStatus: 200
}))
app.use(express.static(path.join(__dirname, "..", "client", "build")))

app.use('/api/auth', auth);
app.use('/api/users', users);
app.use('/api/sections', sections);
app.use('/api/movements', movements);
app.use('/api/variations', variations);

app.get('/api', (req, res) => {
    res.send("running");
})

app.get("*", (req, res) => {
    console.log("get client");
    res.sendFile(path.join(__dirname, "..", "client", "build", "index.html"));
});

const port = process.env.PORT || 4000;
app.listen(port, () => {
    console.log(`[server]: Server running on port ${port}`)
})