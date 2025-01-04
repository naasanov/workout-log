import express from "express";
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
    origin: process.env.FRONTEND_URL || "http://localhost:3000",
    optionsSuccessStatus: 200
}))

app.use('/auth', auth);
app.use('/users', users);
app.use('/sections', sections);
app.use('/movements', movements);
app.use('/variations', variations);

app.get('/', (req, res) => {
    res.send("running")
})

const port = process.env.PORT || 4000;
app.listen(port, () => {
    console.log(`[server]: Server running on port ${port}`)
})