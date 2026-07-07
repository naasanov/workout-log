import Section from '../components/Section.jsx';
import AddSection from '../components/AddSection.jsx';
import BodyWeightTracker from '../components/BodyWeightTracker.jsx';
import HabitTracker from '../components/HabitTracker.jsx';
import NutritionTracker from '../features/nutrition/NutritionTracker';
import TabsEmptyState from '../components/TabsEmptyState.jsx';
import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import styles from "../styles/Workouts.module.scss";
import Header from '../components/Header.jsx';
import clientApi from '../api/clientApi.js';
import useAuth from '../hooks/useAuth.js';
import { useQuery } from '@tanstack/react-query';
import { TABS } from '../config/tabs';
import { useTabPreferences } from '../api/tabPreferences';

function Workouts() {
  const [sections, setSections] = useState([]);
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  // Nav drawer state lives here (not in Header) so the empty-state CTA can open
  // the tab manager in edit mode. #110
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editMode, setEditMode] = useState(false);

  const loggedIn = !!user;
  const { data: prefs, isLoading: prefsLoading } = useTabPreferences(loggedIn);
  const enabledTabs = loggedIn ? (prefs ?? []) : [TABS.WORKOUTS];
  const enabledKey = enabledTabs.join('|');

  const tabParam = searchParams.get('tab');

  // Resolve the tab to render. Logged-out → Workouts only. Logged-in → the
  // requested tab if it's enabled, else the first enabled tab (the homepage).
  // null = show the empty state (logged-in with no enabled tabs). #110
  let activeTab;
  if (!loggedIn) {
    activeTab = TABS.WORKOUTS;
  } else if (enabledTabs.length > 0) {
    activeTab = enabledTabs.includes(tabParam) ? tabParam : enabledTabs[0];
  } else {
    activeTab = null;
  }

  // Auto-open onto the homepage: if the URL's tab isn't enabled, redirect to the
  // first enabled tab. Waits for prefs to load so we don't flash Workouts. #110
  useEffect(() => {
    if (!loggedIn || prefsLoading) return;
    if (enabledTabs.length === 0) return; // empty state — nowhere to redirect
    if (!tabParam || !enabledTabs.includes(tabParam)) {
      setSearchParams({ tab: enabledTabs[0] }, { replace: true });
    }
    // enabledKey captures the enabled-tabs identity without an unstable array dep
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loggedIn, prefsLoading, enabledKey, tabParam, setSearchParams]);

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

  const showEmptyState = loggedIn && !prefsLoading && enabledTabs.length === 0;

  return (
    <>
      <Header
        drawerOpen={drawerOpen}
        onDrawerOpenChange={setDrawerOpen}
        editMode={editMode}
        onEditModeChange={setEditMode}
      />
      <main className={styles.container}>
        {showEmptyState && (
          <TabsEmptyState
            onAddTools={() => { setDrawerOpen(true); setEditMode(true); }}
          />
        )}

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
