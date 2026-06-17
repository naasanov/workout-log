import Section from '../components/Section.jsx';
import AddSection from '../components/AddSection.jsx';
import BodyWeightTracker from '../components/BodyWeightTracker.jsx';
import HabitTracker from '../components/HabitTracker.jsx';
import { useState, useEffect } from 'react';
import styles from "../styles/Workouts.module.scss";
import Header from '../components/Header.jsx';
import clientApi from '../api/clientApi.js';
import useAuth from '../hooks/useAuth.js';

const TABS = {
  WORKOUTS: 'workouts',
  BODY_WEIGHT: 'body-weight',
  HABITS: 'habits',
};

function Workouts() {
  const [sections, setSections] = useState([]);
  const [activeTab, setActiveTab] = useState(TABS.WORKOUTS);
  const { withAuth, user } = useAuth();

  // Reset to Workouts tab if user logs out while on an auth-only tab
  useEffect(() => {
    if (!user && activeTab !== TABS.WORKOUTS) {
      setActiveTab(TABS.WORKOUTS);
    }
  }, [user, activeTab]);

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
            onClick={() => setActiveTab(TABS.WORKOUTS)}
          >
            Workouts
          </button>
          {user && (
            <>
              <button
                className={`${styles.tab} ${activeTab === TABS.BODY_WEIGHT ? styles.tabActive : ''}`}
                onClick={() => setActiveTab(TABS.BODY_WEIGHT)}
              >
                Body Weight
              </button>
              <button
                className={`${styles.tab} ${activeTab === TABS.HABITS ? styles.tabActive : ''}`}
                onClick={() => setActiveTab(TABS.HABITS)}
              >
                Habits
              </button>
            </>
          )}
        </nav>

        {activeTab === TABS.WORKOUTS && (
          <div>
            {sections.map((s) => (
              <Section
                key={s.id}
                section={s}
                setSections={setSections}
              />
            ))}
            <AddSection setSections={setSections} />
          </div>
        )}

        {activeTab === TABS.BODY_WEIGHT && (
          <BodyWeightTracker />
        )}

        {activeTab === TABS.HABITS && (
          <HabitTracker />
        )}
      </main>
    </>
  );
}

export default Workouts;
