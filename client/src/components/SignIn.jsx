import { useState } from "react";
import { useUser } from "./UserProvider";
import Header from "./Header";
import axios from "axios";

const URL = "http://localhost:4000"
function SignIn() {
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [message, setMessage] = useState("")
    const { setUser } = useUser();
    
    const handleSubmit = async (e) => {
        e.preventDefault();
        let user;
        try {
            user = await axios.get(`${URL}/users/${email}`, {
                password
            })
        }
        catch (error) {
            switch (error.response?.status) {
                default:
                    setMessage("Internal Server Error");
            }
            return;
        }

        if (user) {
            setUser(user);
        }
    }

    return (
        <>
            <Header />
            <form onSubmit={handleSubmit}>
                <label htmlFor="email">Email</label>
                <input value={email} onChange={e => setEmail(e.target.value)} type="text" id="email" />
                <label htmlFor="password">Password</label>
                <input value={password} onChange={e => setPassword(e.target.value)} type="password" id="password" />
                <button type="submit">Login</button>
            </form>
            <span>{message}</span>
        </>
    )
}

export default SignIn;