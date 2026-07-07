import { LayoutGrid, Plus } from 'lucide-react';
import styles from '../styles/TabsEmptyState.module.scss';
import { DEFAULT_ORDER, TAB_LABELS } from '../config/tabs';

/**
 * TabsEmptyState (#110) — shown in <main> when a logged-in user has no tabs
 * enabled (a fresh account, or after disabling all tools). Explains the
 * available tools and prompts the user to add one, opening the nav drawer's
 * tab-manager in edit mode via `onAddTools`.
 */
function TabsEmptyState({ onAddTools }) {
  return (
    <div className={styles.wrapper}>
      <div className={styles.iconCircle} aria-hidden="true">
        <LayoutGrid size={28} style={{ display: 'block' }} />
      </div>
      <h2 className={styles.heading}>No tools enabled</h2>
      <p className={styles.subtext}>
        Pick the tools you want to use and set their order. The first tool is your
        home screen.
      </p>
      <ul className={styles.toolList}>
        {DEFAULT_ORDER.map((tab) => (
          <li key={tab} className={styles.toolChip}>{TAB_LABELS[tab]}</li>
        ))}
      </ul>
      <button type="button" className={styles.cta} onClick={onAddTools}>
        <Plus size={18} aria-hidden="true" style={{ display: 'block' }} />
        Add tools
      </button>
    </div>
  );
}

export default TabsEmptyState;
