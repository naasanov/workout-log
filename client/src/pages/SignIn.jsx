import { useState, useEffect } from "react";
import { useUser } from "../context/UserProvider";
import { Link, useNavigate } from "react-router-dom";
import Header from "../components/Header";
import styles from "../styles/Authentication.module.scss";
import { login } from "../api/authApi";

function SignIn() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [emailMessage, setEmailMessage] = useState(null);
  const [pwdMessage, setPwdMessage] = useState(null);
  const [message, setMessage] = useState("")
  const { setUser } = useUser();
  const navigate = useNavigate();

  useEffect(() => {
    if (email.trim() !== "") {
      setEmailMessage(null);
    }
    if (password.trim() !== "") {
      setPwdMessage(null);
    }
  }, [email, password])

  const validateEmail = () => {
    if (email.trim() === "") {
      setEmailMessage("Please enter an email");
      return false;
    }
    else if (!/^[\w-.]+@([\w-]+\.)+[\w-]{2,4}$/.test(email)) {
      setEmailMessage("Please enter a valid email");
      return false;
    }
    return true;
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    setMessage("")

    let error = false;
    if (!validateEmail()) {
      error = true;
    }
    if (password.trim() === "") {
      setPwdMessage("Please enter a password");
      error = true;
    }
    if (error) return;

    let loggedUser;
    try {
      loggedUser = await login(email, password);
    }
    catch (error) {
      if (error.response?.status === 401) {
        return setMessage("Incorrect email or password");
      }
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
          <form onSubmit={handleSubmit} method="post" >
            <div className={styles.input}>
              <label htmlFor="email">Email</label>
              <input
                className={emailMessage ? styles.error : null}
                value={email}
                onChange={e => setEmail(e.target.value)}
                type="text"
                id="email"
                name="email"
                autoComplete="username"
              />
              {emailMessage && <span>{emailMessage}</span>}
            </div>
            <div className={styles.input}>
              <label htmlFor="password">Password</label>
              <input
                className={pwdMessage ? styles.error : null}
                value={password}
                onChange={e => setPassword(e.target.value)}
                type="password"
                id="password"
                name="password"
                autoComplete="current-password"
              />
              {pwdMessage && <span>{pwdMessage}</span>}
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