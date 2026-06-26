// Nutrition AI usage tracking — records token usage + cost per /chat request.
// All DB writes are best-effort: a failed insert must never break the chat stream.
import { RowDataPacket } from 'mysql2';
import pool from '../../database';

// ---------------------------------------------------------------------------
// Pricing constants (per 1 M tokens). Override via env vars if OpenAI changes
// pricing; set to 0 if GPT-5.5 pricing is unknown until confirmed.
//
// NOTE: GPT-5.5 pricing has not been officially published as of the time this
// code was written. Set OWNER_EMAIL, GPT55_INPUT_PER_1M, and GPT55_OUTPUT_PER_1M
// in your .env / Heroku config vars once pricing is confirmed.
// ---------------------------------------------------------------------------
const INPUT_PER_1M = Number(process.env.GPT55_INPUT_PER_1M ?? 0);
const OUTPUT_PER_1M = Number(process.env.GPT55_OUTPUT_PER_1M ?? 0);

export interface UsageData {
  inputTokens: number;
  outputTokens: number;
  /** Reasoning tokens are billed as output tokens. */
  reasoningTokens: number;
  totalTokens: number;
}

function computeCost(data: UsageData): number {
  // Reasoning tokens are billed as output tokens (already included in outputTokens
  // from the AI SDK's totalUsage). We compute cost on inputTokens + outputTokens.
  const inputCost = (data.inputTokens / 1_000_000) * INPUT_PER_1M;
  const outputCost = (data.outputTokens / 1_000_000) * OUTPUT_PER_1M;
  return inputCost + outputCost;
}

/** Insert one ai_usage row. Never throws — failures are logged and silenced. */
export async function recordUsage(
  userUuid: string,
  model: string,
  data: UsageData,
): Promise<void> {
  try {
    const costUsd = computeCost(data);
    await pool.query(
      `INSERT INTO ai_usage
         (user_uuid, model, input_tokens, output_tokens, reasoning_tokens, total_tokens, cost_usd)
       VALUES (UUID_TO_BIN(?), ?, ?, ?, ?, ?, ?)`,
      [
        userUuid,
        model,
        data.inputTokens,
        data.outputTokens,
        data.reasoningTokens,
        data.totalTokens,
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
