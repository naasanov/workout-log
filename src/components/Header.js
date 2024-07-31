import HeaderStyles from "../styles/Header.module.scss";

function Header() {
  return (
    <header className={HeaderStyles.header}>
      <span className={HeaderStyles.title}>Workout Log</span>
      <i className={HeaderStyles.icon}></i>
    </header>
  );
}

export default Header;