import { useState, useEffect } from "react";
import { useUser } from "../context/UserProvider";
import { Link } from "react-router-dom";
import Header from "../components/Header";
import axios from "axios";
import styles from "../styles/SignIn.module.scss";

const URL = "http://localhost:4000"
function SignIn() {
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [emailErr, setEmailErr] = useState(false);
    const [pwdErr, setPwdErr] = useState(false);
    const [message, setMessage] = useState("")
    const { setUser } = useUser();

    useEffect(() => {
        if (email.trim() !== "") {
            setEmailErr(false);
        }
        if (password.trim() !== "") {
            setPwdErr(false);
        }
    }, [email, password])

    const handleSubmit = async (e) => {
        e.preventDefault();
        setMessage("")

        let error = false;
        if (email.trim() === "") {
            setEmailErr(true);
            error = true;
        }
        if (password.trim() === "") {
            setPwdErr(true);
            error = true;
        }
        if (error) return;

        let user;
        try {
            user = await axios.get(`${URL}/users/${email}`, {
                password
            })
        }
        catch (error) {
            setMessage("Internal Server Error");
            return;
        }

        if (user) setUser(user);
    }

    return (
        <>
            <Header />
            <div className={styles.signin}>
                <span>Make an account</span>
                <div>
                    <form onSubmit={handleSubmit}>
                        <div className={styles.input}>
                            <label htmlFor="email">Email</label>
                            <input className={emailErr && styles.error} value={email} onChange={e => setEmail(e.target.value)} type="text" id="email" />
                            {emailErr && <span>Please enter your email.</span>}
                        </div>
                        <div className={styles.input}>
                            <label htmlFor="password">Password</label>
                            <input className={pwdErr && styles.error} value={password} onChange={e => setPassword(e.target.value)} type="password" id="password" />
                            {pwdErr && <span>Please enter your password.</span>}
                        </div>
                        <div className={styles.message}>
                            <span>{message}</span>
                        </div>
                        <div className={styles.button}>
                            <button type="submit">Sign Up</button>
                            <span>Already have an account? <Link to='/sign-in'>Sign In</Link></span>
                        </div>
                    </form>
                </div>
            </div>
        </>
    )
}

export default SignIn;