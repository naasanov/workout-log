import HeaderStyles from "../styles/Header.module.scss";
import icon from "../assets/profile.svg"

function Header() {
  return (
    <header className={HeaderStyles.header}>
      <span className={HeaderStyles.title}>Workout Log</span>
      <img src={icon} className={HeaderStyles.icon} alt="profile" />
    </header>
  );
}

export default Header;