// Single source of truth for the four top-level "tools" (tabs). Keys must match
// the server's TAB_KEYS in schemas/tabPreferences.ts (kept in sync by hand — the
// client and server are separate npm projects). Consolidates constants that used
// to be duplicated in Workouts.jsx and NavDrawer.jsx.

export const TABS = {
  WORKOUTS: 'workouts',
  BODY_WEIGHT: 'body-weight',
  HABITS: 'habits',
  NUTRITION: 'nutrition',
  CHAT_HISTORY: 'chat-history',
};

// Owner-only admin page (#325), also a `?tab=` value but deliberately kept
// out of DEFAULT_ORDER/VALID_TABS below: it isn't one of the user-configurable
// "tools" from tabPreferences, doesn't belong in the "Add tools" list every
// account sees, and isn't validated by schemas/tabPreferences.ts's TAB_KEYS.
// Visibility is gated by owner status instead (see NavDrawer.jsx, Workouts.jsx).
export const ADMIN_USAGE_TAB = 'admin-usage';

export const TAB_LABELS = {
  [TABS.WORKOUTS]: 'Workouts',
  [TABS.BODY_WEIGHT]: 'Body Weight',
  [TABS.HABITS]: 'Habits',
  [TABS.NUTRITION]: 'Nutrition',
  [TABS.CHAT_HISTORY]: 'Chat History',
  [ADMIN_USAGE_TAB]: 'AI Usage',
};

// Default order for new/backfilled accounts; also the canonical ordering used to
// list disabled tabs in the "Add tools" section.
export const DEFAULT_ORDER = [
  TABS.WORKOUTS,
  TABS.BODY_WEIGHT,
  TABS.HABITS,
  TABS.NUTRITION,
  TABS.CHAT_HISTORY,
];

export const VALID_TABS = new Set(DEFAULT_ORDER);
