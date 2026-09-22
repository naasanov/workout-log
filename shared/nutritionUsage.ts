// Owner-only AI usage report contract: aggregate stats from services/nutrition/usage.ts
// plus OpenAI's actual billed cost from services/nutrition/openaiCosts.ts, assembled by
// routes/admin.ts into the GET /admin/usage response body. Plain TypeScript types only
// (no zod, no runtime code), since the report is server-computed and never client-sent.

export interface UsagePeriodStats {
  /** Number of recorded chat turns (one ai_usage row per completed turn). */
  turns: number;
  /** Model invocations across those turns, equal to `steps` since each step is one call. */
  modelCalls: number;
  steps: number;
  toolCalls: number;
  webSearchCalls: number;
  uncachedInputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  costUsd: number;
}

export interface DailyUsageStats extends UsagePeriodStats {
  /** YYYY-MM-DD, in the database's local date representation. */
  day: string;
}

export interface UserUsageBreakdown extends UsagePeriodStats {
  userUuid: string;
  /** Null when the user row has no email on file (e.g. a deleted account). */
  email: string | null;
}

export interface ActualCostDaily {
  /** YYYY-MM-DD, UTC day (matches ai_usage's daily grouping). */
  date: string;
  costUsd: number;
}

export type ActualCostStatus = 'ok' | 'unavailable';

/** Actual OpenAI-billed cost, org/project-wide -- never scoped to one user. */
export interface ActualCostReport {
  status: ActualCostStatus;
  /** Null when status is 'unavailable'. */
  totalUsd: number | null;
  daily: ActualCostDaily[];
  /** Set only when status is 'unavailable', for display next to the tile. */
  message?: string;
}

/** One user's apportioned share of billed cost, summed over the report's [from, to]. */
export interface BilledCostByUser {
  userUuid: string;
  billedCostUsd: number;
}

/** One day's billed cost, either the real OpenAI-billed figure or an estimate fallback. */
export interface BilledCostDaily {
  /** YYYY-MM-DD, UTC day (matches ActualCostDaily.date and ai_usage's daily grouping). */
  day: string;
  billedCostUsd: number;
  /** True when the Costs API hadn't reported this day yet, so `billedCostUsd` is this
   *  day's estimated cost rather than a real billed figure (typically only today). */
  estimated: boolean;
}

/**
 * Billed cost apportioned across users and days, from apportionBilledCost in
 * services/nutrition/usage.ts. Null on OwnerUsageReport when `actualCost` isn't
 * 'ok' (no OPENAI_ADMIN_KEY, or the Costs API call failed), in which case the
 * dashboard falls back to each row's own `costUsd` estimate instead.
 */
export interface BilledCostReport {
  /** Total billed cost for [from, to], narrowed to `userUuid` when the report is
   *  filtered by user. Includes `unattributedUsd` only when unfiltered. */
  totalUsd: number;
  /** Billed cost on days with billed data but zero estimated usage from any user,
   *  so it can't be apportioned. Always the full range total, ignoring any user
   *  filter, since it isn't any one user's to begin with. */
  unattributedUsd: number;
  /** Count of days in range that fell back to their estimate (see BilledCostDaily). */
  estimatedDayCount: number;
  /** Narrowed to `userUuid` when the report is filtered, like `daily` above. */
  daily: BilledCostDaily[];
  /** Always the full, unfiltered per-user breakdown, like `byUser` above. */
  byUser: BilledCostByUser[];
}

export interface OwnerUsageReport {
  from: string;
  to: string;
  totals: UsagePeriodStats;
  daily: DailyUsageStats[];
  /** Per-user totals for the same [from, to] window, always unfiltered by `userUuid`
   *  so the dashboard's user filter has every user in range to choose from. */
  byUser: UserUsageBreakdown[];
  /** Null when the server has no OPENAI_ADMIN_KEY configured. */
  actualCost: ActualCostReport | null;
  /** Billed cost apportioned per user/day; see BilledCostReport. */
  billedCost: BilledCostReport | null;
}
