import { useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { X, ChevronUp, ChevronDown, Plus, Minus } from 'lucide-react';
import styles from '../styles/NavDrawer.module.scss';
import { TABS, TAB_LABELS, DEFAULT_ORDER, VALID_TABS, ADMIN_USAGE_TAB } from '../config/tabs';
import { useTabPreferences, usePutTabPreferences } from '../api/tabPreferences';
import { useIsOwner } from '../features/adminUsage/api';
import { computeRange, DEFAULT_RANGE_DAYS } from '../features/adminUsage/range';

/**
 * NavDrawer — left slide-out navigation panel.
 *
 * Props:
 *   open         {boolean}  whether the drawer is visible
 *   onClose      {function} called when user requests close
 *   user         {object|null|undefined}  auth state
 *   editMode     {boolean}  whether the tab-manager edit UI is showing (#110)
 *   onEditModeChange {function(boolean)} toggle edit mode
 */
function NavDrawer({ open, onClose, user, editMode = false, onEditModeChange }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const drawerRef = useRef(null);

  const loggedIn = !!user;
  const { data: prefs } = useTabPreferences(loggedIn);
  const putPrefs = usePutTabPreferences();

  const tabParam = searchParams.get('tab');
  const activeTab = tabParam === ADMIN_USAGE_TAB ? ADMIN_USAGE_TAB : VALID_TABS.has(tabParam) ? tabParam : TABS.WORKOUTS;

  // Logged-in users navigate their enabled tabs (ordered); logged-out visitors
  // only ever see Workouts. `prefs` is undefined while the query loads.
  const enabled = loggedIn ? (prefs ?? []) : [TABS.WORKOUTS];
  const disabled = DEFAULT_ORDER.filter((t) => !enabled.includes(t));

  // Owner-only nav entry (#325), shown only once the useIsOwner probe succeeds.
  const { from: adminFrom, to: adminTo } = computeRange(DEFAULT_RANGE_DAYS);
  const isOwner = useIsOwner(adminFrom, adminTo, loggedIn);

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

  // ── Edit actions (#110) — each persists optimistically via putPrefs ──────────
  const moveTab = (index, dir) => {
    const next = [...enabled];
    const j = index + dir;
    if (j < 0 || j >= next.length) return;
    [next[index], next[j]] = [next[j], next[index]];
    putPrefs.mutate(next);
  };
  const removeTab = (tab) => putPrefs.mutate(enabled.filter((t) => t !== tab));
  const addTab = (tab) => putPrefs.mutate([...enabled, tab]);

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
          <div className={styles.drawerHeaderActions}>
            {loggedIn && (
              <button
                className={`${styles.editBtn} ${editMode ? styles.editBtnActive : ''}`}
                onClick={() => onEditModeChange?.(!editMode)}
                aria-pressed={editMode}
              >
                {editMode ? 'Done' : 'Edit'}
              </button>
            )}
            <button
              className={styles.closeBtn}
              onClick={onClose}
              aria-label="Close navigation menu"
            >
              <X size={16} aria-hidden="true" style={{ display: 'block' }} />
            </button>
          </div>
        </div>

        {/* ── Normal navigation ──────────────────────────────────────────── */}
        {!editMode && (
          <nav aria-label="Main navigation">
            <ul className={styles.navList} role="list">
              {enabled.map((tab) => (
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
              {isOwner && (
                <li key={ADMIN_USAGE_TAB}>
                  <button
                    className={`${styles.navItem} ${activeTab === ADMIN_USAGE_TAB ? styles.navItemActive : ''}`}
                    onClick={() => handleTabSelect(ADMIN_USAGE_TAB)}
                    aria-current={activeTab === ADMIN_USAGE_TAB ? 'page' : undefined}
                  >
                    {TAB_LABELS[ADMIN_USAGE_TAB]}
                  </button>
                </li>
              )}
            </ul>
          </nav>
        )}

        {/* ── Edit mode: reorder + toggle tools (#110) ───────────────────── */}
        {editMode && loggedIn && (
          <div className={styles.editPanel}>
            {enabled.length > 0 && (
              <ul className={styles.editList} role="list">
                {enabled.map((tab, index) => (
                  <li key={tab} className={styles.editRow}>
                    <span className={styles.editTabLabel}>{TAB_LABELS[tab]}</span>
                    <div className={styles.editControls}>
                      <button
                        className={styles.iconBtn}
                        onClick={() => moveTab(index, -1)}
                        disabled={index === 0}
                        aria-label={`Move ${TAB_LABELS[tab]} up`}
                      >
                        <ChevronUp size={16} aria-hidden="true" style={{ display: 'block' }} />
                      </button>
                      <button
                        className={styles.iconBtn}
                        onClick={() => moveTab(index, 1)}
                        disabled={index === enabled.length - 1}
                        aria-label={`Move ${TAB_LABELS[tab]} down`}
                      >
                        <ChevronDown size={16} aria-hidden="true" style={{ display: 'block' }} />
                      </button>
                      <button
                        className={`${styles.iconBtn} ${styles.removeBtn}`}
                        onClick={() => removeTab(tab)}
                        aria-label={`Remove ${TAB_LABELS[tab]}`}
                      >
                        <Minus size={16} aria-hidden="true" style={{ display: 'block' }} />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            {disabled.length > 0 && (
              <div className={styles.addSection}>
                <span className={styles.addHeading}>Add tools</span>
                <ul className={styles.editList} role="list">
                  {disabled.map((tab) => (
                    <li key={tab} className={styles.editRow}>
                      <span className={styles.editTabLabel}>{TAB_LABELS[tab]}</span>
                      <button
                        className={`${styles.iconBtn} ${styles.addBtn}`}
                        onClick={() => addTab(tab)}
                        aria-label={`Add ${TAB_LABELS[tab]}`}
                      >
                        <Plus size={16} aria-hidden="true" style={{ display: 'block' }} />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}

export default NavDrawer;
