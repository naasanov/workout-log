import Section from '../components/Section.jsx';
import AddSection from '../components/AddSection.jsx';
import BodyWeightTracker from '../components/BodyWeightTracker.jsx';
import HabitTracker from '../components/HabitTracker.jsx';
import NutritionTracker from '../features/nutrition/NutritionTracker';
import { useState, useEffect } from 'react';
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

const VALID_TABS = new Set(Object.values(TABS));

function Workouts() {
  const [sections, setSections] = useState([]);
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

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

  const switchTab = (tab) => {
    setSearchParams({ tab }, { replace: false });
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

  return (
    <>
      <Header />
      <main className={styles.container}>
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
