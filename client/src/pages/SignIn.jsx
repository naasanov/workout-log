import { useState, useEffect } from "react";
import { useUser } from "../context/UserProvider";
import { Link, useNavigate } from "react-router-dom";
import Header from "../components/Header";
import styles from "../styles/Authentication.module.scss";
import { login } from "../api/authApi";

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

    let loggedUser;
    try {
      loggedUser = await login(email, password);
    }
    catch (error) {
      return setMessage("Internal Server Error");
    }

    setUser(loggedUser);
    navigate('/');
  }

  return (
    <>
      <Header />
      <div className={styles.signin}>
        <span>Sign in to your workout log</span>
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
                autoComplete="current-password"
              />
              {pwdErr && <span>Please enter your password.</span>}
            </div>
            <div className={styles.message}>
              <span>{message}</span>
            </div>
            <div className={styles.button}>
              <button type="submit">Log in</button>
              <span>Don't have an account? <Link to="/sign-up">Sign Up</Link></span>
            </div>
          </form>
        </div>
      </div>
    </>
  )
}

export default SignIn;