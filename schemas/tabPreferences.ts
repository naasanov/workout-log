// Shared contract for the customizable-tabs feature (#110): which top-level
// tabs a user has enabled, and in what order. Stored per-user as an ordered
// JSON array of tab keys; element[0] is the user's homepage. The client mirrors
// these keys in client/src/config/tabs.js (kept in sync by hand).
import { z } from 'zod';

// The four top-level "tools". Order here is the default order for new/backfilled
// accounts. Keys must match the client's TABS in client/src/config/tabs.js.
export const TAB_KEYS = ['workouts', 'body-weight', 'habits', 'nutrition'] as const;
export type TabKey = (typeof TAB_KEYS)[number];

// PUT /users/tab-preferences body: an ordered, duplicate-free list of valid keys.
export const tabPreferencesSchema = z.object({
  enabledTabs: z
    .array(z.enum(TAB_KEYS))
    .max(TAB_KEYS.length)
    .refine((arr) => new Set(arr).size === arr.length, {
      message: 'enabledTabs must not contain duplicates',
    }),
});

export type TabPreferencesInput = z.infer<typeof tabPreferencesSchema>;
