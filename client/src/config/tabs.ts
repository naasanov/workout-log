// Single source of truth for the four top-level "tools" (tabs). Keys must match
// the server's TAB_KEYS in schemas/tabPreferences.ts (kept in sync by hand — the
// client and server are separate npm projects). Consolidates constants that used
// to be duplicated in Workouts.tsx and NavDrawer.tsx.

export const TABS = {
  WORKOUTS: 'workouts',
  BODY_WEIGHT: 'body-weight',
  HABITS: 'habits',
  NUTRITION: 'nutrition',
  CHAT_HISTORY: 'chat-history',
} as const;

export type Tab = (typeof TABS)[keyof typeof TABS];

// Owner-only admin page (#325). It is a `?tab=` value but not a user-configurable tool,
// so it stays out of DEFAULT_ORDER/VALID_TABS and the "Add tools" list; owner status
// gates it instead (NavDrawer.tsx, Workouts.tsx).
export const ADMIN_USAGE_TAB = 'admin-usage';

// Loosely typed (not Record<Tab, string>) so a `?tab=` value read straight off
// the URL -- a plain string, not yet narrowed to Tab -- can index it directly.
export const TAB_LABELS: Record<string, string> = {
  [TABS.WORKOUTS]: 'Workouts',
  [TABS.BODY_WEIGHT]: 'Body Weight',
  [TABS.HABITS]: 'Habits',
  [TABS.NUTRITION]: 'Nutrition',
  [TABS.CHAT_HISTORY]: 'Chat History',
  [ADMIN_USAGE_TAB]: 'AI Usage',
};

// Default order for new/backfilled accounts; also the canonical ordering used to
// list disabled tabs in the "Add tools" section.
export const DEFAULT_ORDER: Tab[] = [
  TABS.WORKOUTS,
  TABS.BODY_WEIGHT,
  TABS.HABITS,
  TABS.NUTRITION,
  TABS.CHAT_HISTORY,
];

const tabSet = new Set<string>(DEFAULT_ORDER);

// Checks a possibly-null `?tab=` search param against the known tabs, narrowing
// it to Tab on success. Takes `string | null` directly (rather than a plain
// Set) so a caller reading straight off URLSearchParams#get needs no separate
// null check before consulting it.
export const VALID_TABS = {
  has: (tab: string | null): tab is Tab => tab !== null && tabSet.has(tab),
};
