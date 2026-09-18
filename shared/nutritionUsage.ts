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
}
