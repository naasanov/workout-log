import Section from '../components/Section.jsx';
import AddSection from '../components/AddSection.jsx';
import BodyWeightTracker from '../components/BodyWeightTracker.jsx';
import HabitTracker from '../components/HabitTracker.jsx';
import NutritionTracker from '../features/nutrition/NutritionTracker';
import { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import styles from "../styles/Workouts.module.scss";
import Header from '../components/Header.jsx';
import clientApi from '../api/clientApi.js';
import useAuth from '../hooks/useAuth.js';
import { useQuery } from '@tanstack/react-query';

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

function Workouts() {
  const [sections, setSections] = useState([]);
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  // Derive active tab from URL; fall back to WORKOUTS for unknown values
  const tabParam = searchParams.get('tab');
  const activeTab = VALID_TABS.has(tabParam) ? tabParam : TABS.WORKOUTS;

  // If a confirmed-logged-out user lands on an auth-only tab, redirect to Workouts.
  // user === null means definitively logged out; undefined means still loading — don't redirect yet.
  useEffect(() => {
    if (user === null && activeTab !== TABS.WORKOUTS) {
      setSearchParams({ tab: TABS.WORKOUTS }, { replace: true });
    }
  }, [user, activeTab, setSearchParams]);

  // Close mobile menu on outside tap or Escape key
  useEffect(() => {
    if (!menuOpen) return;
    function handlePointerDown(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setMenuOpen(false);
      }
    }
    function handleKeyDown(e) {
      if (e.key === 'Escape') setMenuOpen(false);
    }
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [menuOpen]);

  const switchTab = (tab) => {
    setSearchParams({ tab }, { replace: false });
  };

  const handleMobileTabSelect = (tab) => {
    switchTab(tab);
    setMenuOpen(false);
  };

  const sectionsQuery = useQuery({
    queryKey: ['sections'],
    queryFn: async () => {
      const res = await clientApi.get('/sections/user');
      return res.data.data ?? [];
    },
    // Only run once auth is resolved and the user is logged in
    enabled: user !== undefined && user !== null,
  });

  // Sync query data into local state so child components can do optimistic updates
  // via setSections without requiring full query invalidation on every mutation.
  useEffect(() => {
    if (sectionsQuery.data) {
      setSections(sectionsQuery.data);
    }
  }, [sectionsQuery.data]);

  // Build the list of available tabs (respecting auth gating)
  const availableTabs = [
    TABS.WORKOUTS,
    ...(user ? [TABS.BODY_WEIGHT, TABS.HABITS, TABS.NUTRITION] : []),
  ];

  return (
    <>
      <Header />
      <main className={styles.container}>
        {/* Desktop tab row — hidden on mobile via CSS */}
        <nav className={styles.tabs}>
          <button
            className={`${styles.tab} ${activeTab === TABS.WORKOUTS ? styles.tabActive : ''}`}
            onClick={() => switchTab(TABS.WORKOUTS)}
          >
            Workouts
          </button>
          {user && (
            <>
              <button
                className={`${styles.tab} ${activeTab === TABS.BODY_WEIGHT ? styles.tabActive : ''}`}
                onClick={() => switchTab(TABS.BODY_WEIGHT)}
              >
                Body Weight
              </button>
              <button
                className={`${styles.tab} ${activeTab === TABS.HABITS ? styles.tabActive : ''}`}
                onClick={() => switchTab(TABS.HABITS)}
              >
                Habits
              </button>
              <button
                className={`${styles.tab} ${activeTab === TABS.NUTRITION ? styles.tabActive : ''}`}
                onClick={() => switchTab(TABS.NUTRITION)}
              >
                Nutrition
              </button>
            </>
          )}
        </nav>

        {/* Mobile hamburger nav — shown on mobile, hidden on desktop via CSS */}
        <div className={styles.mobileNav} ref={menuRef}>
          <button
            className={styles.mobileNavToggle}
            onClick={() => setMenuOpen((v) => !v)}
            aria-haspopup="listbox"
            aria-expanded={menuOpen}
            aria-label={`Current tab: ${TAB_LABELS[activeTab]}. Open tab menu`}
          >
            <span className={styles.mobileNavLabel}>{TAB_LABELS[activeTab]}</span>
            {/* Chevron SVG — display:block to avoid iOS Safari inline-block bug */}
            <svg
              className={`${styles.mobileNavChevron} ${menuOpen ? styles.mobileNavChevronOpen : ''}`}
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              aria-hidden="true"
              style={{ display: 'block' }}
            >
              <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>

          {menuOpen && (
            <ul className={styles.mobileNavMenu} role="listbox" aria-label="Select tab">
              {availableTabs.map((tab) => (
                <li key={tab} role="option" aria-selected={tab === activeTab}>
                  <button
                    className={`${styles.mobileNavItem} ${tab === activeTab ? styles.mobileNavItemActive : ''}`}
                    onClick={() => handleMobileTabSelect(tab)}
                  >
                    {TAB_LABELS[tab]}
                    {tab === activeTab && (
                      /* Checkmark SVG — display:block to avoid iOS Safari inline-block bug */
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 14 14"
                        fill="none"
                        aria-hidden="true"
                        style={{ display: 'block' }}
                      >
                        <path d="M2.5 7l3.5 3.5 5.5-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* All panels stay mounted to preserve in-memory state; hidden via CSS */}
        <div style={{ display: activeTab === TABS.WORKOUTS ? undefined : 'none' }}>
          {sections.map((s) => (
            <Section
              key={s.id}
              section={s}
              setSections={setSections}
            />
          ))}
          <AddSection setSections={setSections} />
        </div>

        {user && (
          <div style={{ display: activeTab === TABS.BODY_WEIGHT ? undefined : 'none' }}>
            <BodyWeightTracker />
          </div>
        )}

        {user && (
          <div style={{ display: activeTab === TABS.HABITS ? undefined : 'none' }}>
            <HabitTracker />
          </div>
        )}

        {user && (
          <div style={{ display: activeTab === TABS.NUTRITION ? undefined : 'none' }}>
            <NutritionTracker />
          </div>
        )}
      </main>
    </>
  );
}

export default Workouts;
