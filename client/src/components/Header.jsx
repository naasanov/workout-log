import HeaderStyles from "../styles/Header.module.scss";
import icon from "../assets/profile.svg";
import { Link } from "react-router-dom";

function Header() {
  return (
    <header className={HeaderStyles.header}>
      <span className={HeaderStyles.title}>Workout Log</span>
      <Link to="/sign-in">
        <img src={icon} className={HeaderStyles.icon} alt="profile" />
      </Link>
    </header>
  );
}

export default Header;