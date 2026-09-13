// Client-side mirror of the owner-only report shape in
// main/workout-log/services/nutrition/usage.ts (getOwnerUsageReport) and
// routes/admin.ts. Kept in sync by hand, same convention as nutrition/types.ts.

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

export interface OwnerUsageReport {
  from: string;
  to: string;
  totals: UsagePeriodStats;
  daily: DailyUsageStats[];
}
