// Nutrition AI usage tracking -- records token usage + cost per /chat request.
// All DB writes are best-effort: a failed insert must never break the chat stream.
import { RowDataPacket } from 'mysql2';
import { parseISO } from 'date-fns';
import pool from '../../database';

// ---------------------------------------------------------------------------
// Pricing constants (per 1M tokens, or per 1K calls for web search). Defaults
// come from a month of reconciled OpenAI line-item billing (#325): cached
// input is billed at roughly a tenth of uncached input, and pricing all
// input at the uncached rate overstated the bill because the cache hit rate
// was high. Override any of these via env vars if OpenAI's pricing changes.
// ---------------------------------------------------------------------------
const INPUT_PER_1M = Number(process.env.GPT55_INPUT_PER_1M ?? 5.0);
const CACHED_INPUT_PER_1M = Number(process.env.GPT55_CACHED_INPUT_PER_1M ?? 0.5);
const OUTPUT_PER_1M = Number(process.env.GPT55_OUTPUT_PER_1M ?? 30.0);
// Web search was a rounding error next to token cost last month ($1.39 of
// $108 total). No confirmed per-call rate was available, so this default is
// a judgment call -- override with the real rate once billing confirms it.
const WEB_SEARCH_PER_1K_CALLS = Number(process.env.WEB_SEARCH_PER_1K_CALLS ?? 10.0);

export interface UsageData {
  inputTokens: number;
  /** Subset of inputTokens read from the prompt cache; billed at CACHED_INPUT_PER_1M. */
  cachedInputTokens: number;
  outputTokens: number;
  /** Reasoning tokens are billed as output tokens (already included in outputTokens). */
  reasoningTokens: number;
  totalTokens: number;
  /** Number of model steps (LLM round-trips) in the turn. */
  steps: number;
  /** Number of tool calls made across every step of the turn. */
  toolCalls: number;
  /** Number of those tool calls that were web_search. */
  webSearchCalls: number;
}

/**
 * Shape of the fields this module reads off streamText's onFinish result
 * (see 'ai' package's LanguageModelUsage / GenerateTextEndEvent types).
 * Kept as a narrow structural type here (rather than importing StreamText's
 * own types) so this stays easy to construct in a unit test.
 */
export interface FinishResultLike {
  usage: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    outputTokenDetails?: { reasoningTokens?: number };
    inputTokenDetails?: { cacheReadTokens?: number };
  };
  steps: unknown[];
  toolCalls: { toolName: string }[];
}

/**
 * Map streamText's onFinish result to a UsageData row. Reasoning tokens live
 * at usage.outputTokenDetails.reasoningTokens and cached input tokens at
 * usage.inputTokenDetails.cacheReadTokens in the AI SDK v7 shape -- an
 * earlier version of this code read a field name ('outputDetails') that
 * SDK v7 never populates, so reasoning tokens silently recorded as 0.
 */
export function usageDataFromFinishResult({ usage, steps, toolCalls }: FinishResultLike): UsageData {
  const inputTokens = usage.inputTokens ?? 0;
  const outputTokens = usage.outputTokens ?? 0;
  const reasoningTokens = usage.outputTokenDetails?.reasoningTokens ?? 0;
  const cachedInputTokens = usage.inputTokenDetails?.cacheReadTokens ?? 0;
  const totalTokens = usage.totalTokens ?? (inputTokens + outputTokens);
  const webSearchCalls = toolCalls.filter((call) => call.toolName === 'web_search').length;

  return {
    inputTokens,
    cachedInputTokens,
    outputTokens,
    reasoningTokens,
    totalTokens,
    steps: steps.length,
    toolCalls: toolCalls.length,
    webSearchCalls,
  };
}

/** Exported for unit testing the pricing math directly (see tests/usageFromFinish.test.js). */
export function computeCost(data: UsageData): number {
  const cachedInputTokens = Math.max(0, Math.min(data.cachedInputTokens, data.inputTokens));
  const uncachedInputTokens = data.inputTokens - cachedInputTokens;
  const inputCost = (uncachedInputTokens / 1_000_000) * INPUT_PER_1M;
  const cachedCost = (cachedInputTokens / 1_000_000) * CACHED_INPUT_PER_1M;
  const outputCost = (data.outputTokens / 1_000_000) * OUTPUT_PER_1M;
  const webSearchCost = (data.webSearchCalls / 1000) * WEB_SEARCH_PER_1K_CALLS;
  return inputCost + cachedCost + outputCost + webSearchCost;
}

/** Insert one ai_usage row. Never throws -- failures are logged and silenced. */
export async function recordUsage(
  userUuid: string,
  model: string,
  data: UsageData,
): Promise<void> {
  try {
    const costUsd = computeCost(data);
    await pool.query(
      `INSERT INTO ai_usage
         (user_uuid, model, input_tokens, cached_input_tokens, output_tokens, reasoning_tokens,
          total_tokens, steps, tool_calls, web_search_calls, cost_usd)
       VALUES (UUID_TO_BIN(?), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        userUuid,
        model,
        data.inputTokens,
        data.cachedInputTokens,
        data.outputTokens,
        data.reasoningTokens,
        data.totalTokens,
        data.steps,
        data.toolCalls,
        data.webSearchCalls,
        costUsd,
      ],
    );
  } catch (err) {
    // Best-effort: log but never propagate so the chat stream is unaffected.
    console.error('[ai_usage] failed to record usage:', err);
  }
}

export interface UserUsageTotals {
  requestCount: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalReasoningTokens: number;
  totalTokens: number;
  totalCostUsd: number;
}

/** Return aggregated usage totals for the given user. */
export async function getUserUsageTotals(userUuid: string): Promise<UserUsageTotals> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT
       COUNT(*) AS requestCount,
       COALESCE(SUM(input_tokens), 0)     AS totalInputTokens,
       COALESCE(SUM(output_tokens), 0)    AS totalOutputTokens,
       COALESCE(SUM(reasoning_tokens), 0) AS totalReasoningTokens,
       COALESCE(SUM(total_tokens), 0)     AS totalTokens,
       COALESCE(SUM(cost_usd), 0)         AS totalCostUsd
     FROM ai_usage
     WHERE user_uuid = UUID_TO_BIN(?)`,
    [userUuid],
  );
  const row = rows[0];
  return {
    requestCount: Number(row.requestCount),
    totalInputTokens: Number(row.totalInputTokens),
    totalOutputTokens: Number(row.totalOutputTokens),
    totalReasoningTokens: Number(row.totalReasoningTokens),
    totalTokens: Number(row.totalTokens),
    totalCostUsd: Number(row.totalCostUsd),
  };
}

export interface AllUsersRow {
  email: string;
  userUuid: string;
  requestCount: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalReasoningTokens: number;
  totalTokens: number;
  totalCostUsd: number;
}

/** Return per-user breakdown (all users). Only called for the owner. */
export async function getAllUsersUsage(): Promise<AllUsersRow[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT
       u.email,
       BIN_TO_UUID(u.user_uuid) AS userUuid,
       COUNT(a.id)                        AS requestCount,
       COALESCE(SUM(a.input_tokens), 0)     AS totalInputTokens,
       COALESCE(SUM(a.output_tokens), 0)    AS totalOutputTokens,
       COALESCE(SUM(a.reasoning_tokens), 0) AS totalReasoningTokens,
       COALESCE(SUM(a.total_tokens), 0)     AS totalTokens,
       COALESCE(SUM(a.cost_usd), 0)         AS totalCostUsd
     FROM users u
     LEFT JOIN ai_usage a ON a.user_uuid = u.user_uuid
     GROUP BY u.user_uuid, u.email
     ORDER BY totalCostUsd DESC`,
  );
  return rows.map((row) => ({
    email: row.email,
    userUuid: row.userUuid,
    requestCount: Number(row.requestCount),
    totalInputTokens: Number(row.totalInputTokens),
    totalOutputTokens: Number(row.totalOutputTokens),
    totalReasoningTokens: Number(row.totalReasoningTokens),
    totalTokens: Number(row.totalTokens),
    totalCostUsd: Number(row.totalCostUsd),
  }));
}

/** Look up a user's email by UUID (to compare against OWNER_EMAIL). */
export async function getUserEmail(userUuid: string): Promise<string | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT email FROM users WHERE user_uuid = UUID_TO_BIN(?)`,
    [userUuid],
  );
  return rows.length > 0 ? (rows[0].email as string) : null;
}

// ---------------------------------------------------------------------------
// Owner-only aggregate report (routes/admin.ts). ai_usage.created_at is
// DATETIME, so a bare YYYY-MM-DD upper bound must resolve to the start of
// the next day and be applied with `<`, or it silently drops that whole day
// -- see resolveTo in services/bodyWeight/store.ts for the same pattern.
// ---------------------------------------------------------------------------
const BARE_DATE = /^\d{4}-\d{2}-\d{2}$/;

function resolveRange(from: string, to: string): { fromValue: Date; toValue: Date; toOperator: '<' | '<=' } {
  const fromValue = parseISO(from);
  if (BARE_DATE.test(to)) {
    const startOfDay = parseISO(to);
    return { fromValue, toValue: new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000), toOperator: '<' };
  }
  return { fromValue, toValue: parseISO(to), toOperator: '<=' };
}

export interface UsagePeriodStats {
  /** Number of recorded chat turns (one ai_usage row per completed turn). */
  turns: number;
  /**
   * Number of underlying model invocations across those turns. Currently
   * equal to `steps` (each step is one model call); kept as a separate field
   * because a dashboard may frame the two differently.
   */
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

export interface OwnerUsageReport {
  totals: UsagePeriodStats;
  daily: DailyUsageStats[];
}

const USAGE_STATS_SELECT = `
       COUNT(*) AS turns,
       COALESCE(SUM(steps), 0) AS modelCalls,
       COALESCE(SUM(steps), 0) AS steps,
       COALESCE(SUM(tool_calls), 0) AS toolCalls,
       COALESCE(SUM(web_search_calls), 0) AS webSearchCalls,
       COALESCE(SUM(GREATEST(input_tokens - COALESCE(cached_input_tokens, 0), 0)), 0) AS uncachedInputTokens,
       COALESCE(SUM(cached_input_tokens), 0) AS cachedInputTokens,
       COALESCE(SUM(output_tokens), 0) AS outputTokens,
       COALESCE(SUM(reasoning_tokens), 0) AS reasoningTokens,
       COALESCE(SUM(cost_usd), 0) AS costUsd`;

function toStats(row: RowDataPacket): UsagePeriodStats {
  return {
    turns: Number(row.turns),
    modelCalls: Number(row.modelCalls),
    steps: Number(row.steps),
    toolCalls: Number(row.toolCalls),
    webSearchCalls: Number(row.webSearchCalls),
    uncachedInputTokens: Number(row.uncachedInputTokens),
    cachedInputTokens: Number(row.cachedInputTokens),
    outputTokens: Number(row.outputTokens),
    reasoningTokens: Number(row.reasoningTokens),
    costUsd: Number(row.costUsd),
  };
}

/**
 * Owner-only aggregate AI usage: totals plus a per-day series over
 * [from, to] (both YYYY-MM-DD). Aggregated entirely in SQL. `to` is treated
 * as inclusive of the whole calendar day per resolveRange above.
 */
export async function getOwnerUsageReport(from: string, to: string): Promise<OwnerUsageReport> {
  const { fromValue, toValue, toOperator } = resolveRange(from, to);

  const [totalsRows] = await pool.query<RowDataPacket[]>(
    `SELECT${USAGE_STATS_SELECT}
     FROM ai_usage
     WHERE created_at >= ? AND created_at ${toOperator} ?`,
    [fromValue, toValue],
  );

  // DATE_FORMAT (not DATE()) so `day` comes back as a plain 'YYYY-MM-DD'
  // string regardless of how the mysql2 driver would otherwise box a DATE
  // value as a JS Date.
  const [dailyRows] = await pool.query<RowDataPacket[]>(
    `SELECT DATE_FORMAT(created_at, '%Y-%m-%d') AS day,${USAGE_STATS_SELECT}
     FROM ai_usage
     WHERE created_at >= ? AND created_at ${toOperator} ?
     GROUP BY DATE_FORMAT(created_at, '%Y-%m-%d')
     ORDER BY day ASC`,
    [fromValue, toValue],
  );

  return {
    totals: toStats(totalsRows[0]),
    daily: dailyRows.map((row) => ({ day: String(row.day), ...toStats(row) })),
  };
}
