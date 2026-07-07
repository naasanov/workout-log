// Single source of truth for the four top-level "tools" (tabs). Keys must match
// the server's TAB_KEYS in schemas/tabPreferences.ts (kept in sync by hand — the
// client and server are separate npm projects). Consolidates constants that used
// to be duplicated in Workouts.jsx and NavDrawer.jsx.

export const TABS = {
  WORKOUTS: 'workouts',
  BODY_WEIGHT: 'body-weight',
  HABITS: 'habits',
  NUTRITION: 'nutrition',
};

export const TAB_LABELS = {
  [TABS.WORKOUTS]: 'Workouts',
  [TABS.BODY_WEIGHT]: 'Body Weight',
  [TABS.HABITS]: 'Habits',
  [TABS.NUTRITION]: 'Nutrition',
};

// Default order for new/backfilled accounts; also the canonical ordering used to
// list disabled tabs in the "Add tools" section.
export const DEFAULT_ORDER = [
  TABS.WORKOUTS,
  TABS.BODY_WEIGHT,
  TABS.HABITS,
  TABS.NUTRITION,
];

export const VALID_TABS = new Set(DEFAULT_ORDER);
