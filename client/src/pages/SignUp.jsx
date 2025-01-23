import { useState, useEffect } from "react";
import { useUser } from "../context/UserProvider";
import { Link, useNavigate } from "react-router-dom";
import Header from "../components/Header";
import styles from "../styles/Authentication.module.scss";
import { signup } from "../api/authApi";
import clientApi from "../api/clientApi";

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

  /** Password requirements:
   * - At least 8 characters
   * - At least one uppercase letter
   * - At least one lowercase letter
   * - At least one number
   * - At lesat one symbol
   */
  const validatePassword = () => {
    let msg = null;
    if (password.trim() === "") {
      msg = "Please enter a password";
    }
    else if (password.trim().length < 8) {
      msg = "Password must be at least 8 characters";
    }
    else if (!/[A-Z]/.test(password)) {
      msg = "Password must include an uppercase letter";
    }
    else if (!/[a-z]/.test(password)) {
      msg = "Password must include a lowercase letter";
    }
    else if (!/\d/.test(password)) {
      msg = "Password must include a number";
    }
    else if (!/[^\w\s]/.test(password)) {
      msg = "Password must include a symbol";
    }
    if (msg !== null) {
      setPwdMessage(msg);
      return false;
    }
    return true;
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    setMessage("");

    const emailValid = validateEmail();
    const passwordValid = validatePassword();
    if (!emailValid || !passwordValid) {
      return;
    }

    let res;
    try {
      await signup(email, password);
      res = await clientApi.get('/users')
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
                autoComplete="new-password"
              />
              {pwdMessage && <span>{pwdMessage}</span>}
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