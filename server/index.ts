import express, { Express, Request, Response } from "express";
import dotenv from "dotenv";
import cors from "cors";

dotenv.config()

const app: Express = express();
app.use(express.json())
app.use(express.urlencoded({ extended: false }))

app.use(cors({
    credentials: true,
    origin: "*",
    optionsSuccessStatus: 200
}))

app.get('/', (req: Request, res: Response) => {
    res.send("Express + TS Server");
})

const port = process.env.PORT || 4000;
app.listen(port, () => {
    console.log(`[server]: Server running on port ${port}`)
})