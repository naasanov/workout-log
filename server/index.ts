import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import users from './routes/users';

dotenv.config()

const app = express();
app.use(express.json())
app.use(express.urlencoded({ extended: false }))

app.use(cors({
    credentials: true,
    origin: "*",
    optionsSuccessStatus: 200
}))

app.use('/users', users);

app.get('/', (req, res) => {
    res.send("running correctly")
})

const port = process.env.PORT || 4000;
app.listen(port, () => {
    console.log(`[server]: Server running on port ${port}`)
})