import { logout } from "../api/authApi";
import { useUser } from "../context/UserProvider";
import styles from "../styles/Header.module.scss";

function Logout() {
  const { setUser } = useUser();
  const handleLogout = async () => {
    await logout();
    setUser(null);
  }

  return (
    <span
      className={styles.transparentButton}
      onClick={handleLogout}
    >
      Logout
    </span>
  )
}

export default Logout;