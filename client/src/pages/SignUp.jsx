import { useState, useEffect } from "react";
import { useUser } from "../context/UserProvider";
import { Link, useNavigate } from "react-router-dom";
import Header from "../components/Header";
import api, { signup } from "../api/api";
import styles from "../styles/SignIn.module.scss";

function SignIn() {
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [emailErr, setEmailErr] = useState(false);
    const [pwdErr, setPwdErr] = useState(false);
    const [message, setMessage] = useState("")
    const { setUser } = useUser();
    const navigate = useNavigate();

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
        setMessage("");

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

        let res;
        try {
            await signup(email, password);
            res = await api.get('/users')
        }
        catch (error) {
            if (error.response?.status === 409) {
                return setMessage('Account with this email already exists')
            }
            else {
                return setMessage("Internal Server Error");
            }
        }

        setUser(res.data.data);
        navigate('/');
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
                            <input
                                className={emailErr ? styles.error : null}
                                value={email}
                                onChange={e => setEmail(e.target.value)}
                                type="text"
                                id="email"
                                name="email"
                                autoComplete="username"
                            />
                            {emailErr && <span>Please enter your email.</span>}
                        </div>
                        <div className={styles.input}>
                            <label htmlFor="password">Password</label>
                            <input
                                className={pwdErr ? styles.error : null}
                                value={password}
                                onChange={e => setPassword(e.target.value)}
                                type="password"
                                id="password"
                                name="password"
                                autoComplete="new-password"
                            />
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