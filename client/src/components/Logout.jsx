import useApi from "../api/api";
import { useUser } from "../context/UserProvider";
import styles from "../styles/Header.module.scss";

function Logout() {
  const { setUser } = useUser();
  const { logout } = useApi();
  const handleLogout = async () => {
    try {
      await logout();
      setUser(null);
    } catch (error) {
      return console.error(error.response?.data?.message, error);
    }
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