import { useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { X } from 'lucide-react';
import styles from '../styles/NavDrawer.module.scss';

const TABS = {
  WORKOUTS: 'workouts',
  BODY_WEIGHT: 'body-weight',
  HABITS: 'habits',
  NUTRITION: 'nutrition',
};

const TAB_LABELS = {
  [TABS.WORKOUTS]: 'Workouts',
  [TABS.BODY_WEIGHT]: 'Body Weight',
  [TABS.HABITS]: 'Habits',
  [TABS.NUTRITION]: 'Nutrition',
};

const VALID_TABS = new Set(Object.values(TABS));

/**
 * NavDrawer — left slide-out navigation panel.
 *
 * Props:
 *   open      {boolean}  whether the drawer is visible
 *   onClose   {function} called when user requests close (overlay tap / Escape / X / item select)
 *   user      {object|null|undefined}  auth state from useAuth / UserProvider
 */
function NavDrawer({ open, onClose, user }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const drawerRef = useRef(null);

  const tabParam = searchParams.get('tab');
  const activeTab = VALID_TABS.has(tabParam) ? tabParam : TABS.WORKOUTS;

  const availableTabs = [
    TABS.WORKOUTS,
    ...(user ? [TABS.BODY_WEIGHT, TABS.HABITS, TABS.NUTRITION] : []),
  ];

  // Escape key to close
  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  // Prevent body scroll when drawer is open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  const handleTabSelect = (tab) => {
    setSearchParams({ tab }, { replace: false });
    onClose();
  };

  return (
    <>
      {/* Overlay / scrim */}
      <div
        className={`${styles.overlay} ${open ? styles.overlayVisible : ''}`}
        aria-hidden="true"
        onClick={onClose}
      />

      {/* Drawer panel */}
      <div
        ref={drawerRef}
        className={`${styles.drawer} ${open ? styles.drawerOpen : ''}`}
        role="dialog"
        aria-label="Navigation menu"
        aria-modal="true"
      >
        {/* Drawer header */}
        <div className={styles.drawerHeader}>
          <span className={styles.drawerTitle}>Menu</span>
          <button
            className={styles.closeBtn}
            onClick={onClose}
            aria-label="Close navigation menu"
          >
            <X size={16} aria-hidden="true" style={{ display: 'block' }} />
          </button>
        </div>

        {/* Nav items */}
        <nav aria-label="Main navigation">
          <ul className={styles.navList} role="list">
            {availableTabs.map((tab) => (
              <li key={tab}>
                <button
                  className={`${styles.navItem} ${tab === activeTab ? styles.navItemActive : ''}`}
                  onClick={() => handleTabSelect(tab)}
                  aria-current={tab === activeTab ? 'page' : undefined}
                >
                  {TAB_LABELS[tab]}
                </button>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </>
  );
}

export default NavDrawer;
export { TABS, TAB_LABELS, VALID_TABS };
