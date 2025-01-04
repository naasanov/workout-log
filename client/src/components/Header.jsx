import styles from "../styles/Header.module.scss";
import { Link } from "react-router-dom";
import { useUser } from "../context/UserProvider";
import Logout from "./Logout";

function Header() {
  const { user } = useUser();
  return (
    <header className={styles.header}>
      <Link to="/">
        <span className={styles.title}>Workout Log</span>
      </Link>
      <div className={styles.authLinks}>
        {user == null
          ? (
            <>
              <Link to="/sign-up" className={styles.transparentButton}>Sign Up</Link>
              <Link to="/sign-in" className={styles.solidButton}>Sign In</Link>
            </>
          )
          : <Logout />
        }
      </div>
    </header>
  );
}

export default Header;