import { ChevronDown } from 'lucide-react';
import styles from '../styles/CollapseButton.module.scss';

type CollapseButtonProps = {
  // A freshly-added section has no `showItems` yet, so callers can pass
  // that straight through; undefined renders the same as false (closed).
  isOpen: boolean | undefined;
  onClick: () => void;
  label?: string;
};

/** Reusable collapse/expand toggle button with animated chevron. */
function CollapseButton({ isOpen, onClick, label }: CollapseButtonProps) {
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
