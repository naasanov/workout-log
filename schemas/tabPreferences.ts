// Shared contract for the customizable-tabs feature (#110): which top-level
// tabs a user has enabled, and in what order. Stored per-user as an ordered
// JSON array of tab keys; element[0] is the user's homepage. The client mirrors
// these keys in client/src/config/tabs.js (kept in sync by hand).
import { z } from 'zod';

// The top-level "tools". Order here is the default order for new/backfilled
// accounts. Keys must match the client's TABS in client/src/config/tabs.js.
// Adding a key here is the only step needed for services/tabPreferences.ts to
// adopt it for existing users on their next read (see known_tabs there) --
// remember to also add it to the client's TABS list by hand.
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
