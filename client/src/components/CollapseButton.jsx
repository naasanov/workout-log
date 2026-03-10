import openDropdown from '../assets/dropdown_open.svg';
import styles from '../styles/CollapseButton.module.scss';

/**
 * Reusable collapse/expand toggle button with animated chevron.
 * @param {boolean} isOpen - Whether the section is expanded
 * @param {function} onClick - Click handler
 * @param {string} [label] - Accessible label (default: "Toggle")
 */
function CollapseButton({ isOpen, onClick, label }) {
  return (
    <button
      type="button"
      className={styles.btn}
      onClick={onClick}
      aria-label={label ?? (isOpen ? 'Collapse' : 'Expand')}
    >
      <img
        src={openDropdown}
        alt="toggle"
        className={isOpen ? styles.open : styles.closed}
      />
    </button>
  );
}

export default CollapseButton;
