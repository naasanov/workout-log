import { ChevronDown } from 'lucide-react';
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
      <ChevronDown
        size={16}
        className={isOpen ? styles.open : styles.closed}
        aria-hidden="true"
      />
    </button>
  );
}

export default CollapseButton;
