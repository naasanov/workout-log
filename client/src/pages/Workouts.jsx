import Section from '../components/Section.jsx';
import AddSection from '../components/AddSection.jsx';
import BodyWeightTracker from '../components/BodyWeightTracker.jsx';
import HabitTracker from '../components/HabitTracker.jsx';
import NutritionTracker from '../features/nutrition/NutritionTracker';
import ChatHistoryPanel from '../features/chatHistory/ChatHistoryPanel';
import TabsEmptyState from '../components/TabsEmptyState.jsx';
import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import styles from "../styles/Workouts.module.scss";
import Header from '../components/Header.jsx';
import clientApi from '../api/clientApi.js';
import useAuth from '../hooks/useAuth.js';
import { useQuery } from '@tanstack/react-query';
import { TABS, TAB_LABELS } from '../config/tabs';
import { useTabPreferences } from '../api/tabPreferences';
import useDocumentTitle from '../hooks/useDocumentTitle';
import AgentChat from '../features/agent/AgentChat';
import { useNutritionComposerExtras } from '../features/nutrition/NutritionComposerExtras';
// Registers nutrition's tool and part renderers (propose_entry,
// propose_custom_food, the barcode-attachment chip) into the shared registry
// for their side effect. The chat itself mounts once below, not per tab.
import '../features/nutrition/NutritionToolRenderers';
import '../features/nutrition/NutritionBarcodeChip';

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

  // Nutrition's currently-viewed day, reported up by NutritionTracker so the
  // page-level chat below can include it in context while nutrition is
  // active. Nutrition is the only tab with a per-day concept today.
  const [nutritionSelectedDate, setNutritionSelectedDate] = useState(null);

  // Nutrition's camera/barcode composer plugin, wired into the single
  // global AgentChat instance on every tab: scanning a barcode or attaching
  // a photo is useful regardless of which tab is active.
  const { plugin: nutritionComposerPlugin, modals: nutritionChatModals } = useNutritionComposerExtras();

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
  const isNutritionTab = activeTab === TABS.NUTRITION;

  // Reaches the agent's system prompt so it can resolve vague references
  // ("this exercise", "today") to whatever the user is currently looking at.
  // Memoized so AgentChat's own callbacks (which depend on this object)
  // don't get redefined on every unrelated Workouts re-render.
  const chatContext = useMemo(
    () => (isNutritionTab
      ? { tab: TABS.NUTRITION, selectedDate: nutritionSelectedDate ?? undefined }
      : { tab: activeTab ?? undefined }),
    [isNutritionTab, nutritionSelectedDate, activeTab],
  );

  const handleChatClose = useCallback(() => {}, []);

  // Imperative handle onto the single page-level AgentChat instance (see its
  // AgentChatHandle) -- lets chat history's "Continue" action pull in the
  // conversation it just reactivated and pop the sheet open, without
  // threading a second, competing "open" state through this page.
  const agentChatRef = useRef(null);
  const handleConversationContinued = useCallback(() => {
    agentChatRef.current?.openActiveConversation();
  }, []);

  // #236: unique tab titles, tab name first so browser-tab truncation
  // (which cuts from the end) never eats the distinguishing word. activeTab
  // is null in the empty state (logged in, no enabled tools) — fall back to
  // the bare app name rather than showing a stale/undefined label.
  useDocumentTitle(activeTab ? `${TAB_LABELS[activeTab]} · Peak` : 'Peak');

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
            <NutritionTracker onSelectedDateChange={setNutritionSelectedDate} />
          </div>
        )}

        {user && (
          <div style={{ display: activeTab === TABS.CHAT_HISTORY ? undefined : 'none' }}>
            <ChatHistoryPanel onConversationContinued={handleConversationContinued} />
          </div>
        )}
      </main>

      {/* AI chat — mounted once here (not per-tab) so it's available on every
          tab and never remounts (and never loses in-flight state) when the
          user switches tabs, including through the tab-preferences loading
          window right after login: this only depends on `user`, not
          `activeTab` or `prefsLoading`, so it mounts exactly once per
          session. Only the composerPlugin/copy swap based on the active tab;
          the AgentChat element itself stays the same instance across every
          render. Gated on `user` since the transport requires an
          authenticated session (matches the chat's previous nutrition-only
          gating). */}
      {user && (
        <AgentChat
          ref={agentChatRef}
          open={false}
          onClose={handleChatClose}
          context={chatContext}
          composerPlugin={nutritionComposerPlugin}
          emptyHint={isNutritionTab
            ? 'Describe what you ate, scan a barcode, or attach a photo of your food.'
            : 'Log, look up, or analyze anything you track.'}
          srLabel={isNutritionTab ? 'Nutrition AI' : undefined}
          composerPlaceholder={isNutritionTab
            ? 'Describe what you ate…'
            : 'Message the assistant'}
        />
      )}
      {user && nutritionChatModals}
    </>
  );
}

export default Workouts;
