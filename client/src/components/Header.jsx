import HeaderStyles from "../styles/Header.module.scss";
import icon from "../assets/profile.svg";
import { Link } from "react-router-dom";
import { useUser } from "../context/UserProvider";

function Header() {
  const { user } = useUser();
  return (
    <header className={HeaderStyles.header}>
      <Link to="/">
        <span className={HeaderStyles.title}>Workout Log</span>
      </Link>
      <span style={{ color: "white" }}>user: {user?.email ?? "none"}</span>
      <Link to="/sign-in">
        <img src={icon} className={HeaderStyles.icon} alt="profile" />
      </Link>
    </header>
  );
}

export default Header;