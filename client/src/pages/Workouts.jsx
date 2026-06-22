import Section from '../components/Section.jsx';
import AddSection from '../components/AddSection.jsx';
import BodyWeightTracker from '../components/BodyWeightTracker.jsx';
import HabitTracker from '../components/HabitTracker.jsx';
import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import styles from "../styles/Workouts.module.scss";
import Header from '../components/Header.jsx';
import clientApi from '../api/clientApi.js';
import useAuth from '../hooks/useAuth.js';

const TABS = {
  WORKOUTS: 'workouts',
  BODY_WEIGHT: 'body-weight',
  HABITS: 'habits',
};

const VALID_TABS = new Set(Object.values(TABS));

function Workouts() {
  const [sections, setSections] = useState([]);
  const { withAuth, user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  // Derive active tab from URL; fall back to WORKOUTS for unknown values
  const tabParam = searchParams.get('tab');
  const activeTab = VALID_TABS.has(tabParam) ? tabParam : TABS.WORKOUTS;

  // If a non-logged-in user lands on an auth-only tab, redirect to Workouts.
  // Only act once auth has RESOLVED to logged-out (user === null); while
  // user === undefined (still loading) we leave the URL untouched.
  useEffect(() => {
    if (user === null && activeTab !== TABS.WORKOUTS) {
      setSearchParams({ tab: TABS.WORKOUTS }, { replace: true });
    }
  }, [user, activeTab, setSearchParams]);

  const switchTab = (tab) => {
    setSearchParams({ tab }, { replace: false });
  };

  useEffect(() => {
    const fetchSections = async () => {
      const res = await withAuth(() => clientApi.get(`/sections/user`));
      const sections = res?.data.data;
      setSections(sections ?? []);
    }
    fetchSections();
  }, [withAuth])

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
      </main>
    </>
  );
}

export default Workouts;
