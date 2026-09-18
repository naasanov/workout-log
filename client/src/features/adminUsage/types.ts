// Client-side mirror of the owner-only report shape in
// main/workout-log/services/nutrition/usage.ts (getOwnerUsageReport),
// services/nutrition/openaiCosts.ts (ActualCostReport), and routes/admin.ts.
// Kept in sync by hand, same convention as nutrition/types.ts.

export interface UsagePeriodStats {
  turns: number;
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
  /** YYYY-MM-DD. */
  day: string;
}

export interface UserUsageBreakdown extends UsagePeriodStats {
  userUuid: string;
  /** Null when the user has no email on file; the UI falls back to a truncated uuid. */
  email: string | null;
}

export interface ActualCostDaily {
  /** YYYY-MM-DD, UTC day. */
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
  /** Set only when status is 'unavailable'. */
  message?: string;
}

export interface OwnerUsageReport {
  from: string;
  to: string;
  totals: UsagePeriodStats;
  daily: DailyUsageStats[];
  byUser: UserUsageBreakdown[];
  /** Null when the server has no OPENAI_ADMIN_KEY configured. */
  actualCost: ActualCostReport | null;
}
