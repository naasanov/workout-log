// Actual billed cost from OpenAI's Organization Costs API, supplementing the
// locally-estimated cost in usage.ts. Requires OPENAI_ADMIN_KEY (an Admin API
// key, not a regular project key); optionally scoped to OPENAI_PROJECT_ID.
//
// Response shape confirmed against OpenAI's published cookbook example for
// GET /v1/organization/costs: { object: 'page', data: Bucket[], has_more,
// next_page }, where each Bucket is { start_time, end_time, results }, and
// each result is { amount: { value, currency }, project_id, ... }.
const OPENAI_COSTS_URL = 'https://api.openai.com/v1/organization/costs';
const BUCKET_WIDTH = '1d';
const MAX_BUCKETS_PER_PAGE = 180;
const MAX_PAGES = 20;
const FETCH_TIMEOUT_MS = 10_000;
const CACHE_TTL_MS = 10 * 60 * 1000;

export interface ActualCostDaily {
  /** YYYY-MM-DD, UTC day (matches ai_usage's daily grouping). */
  date: string;
  costUsd: number;
}

export type ActualCostStatus = 'ok' | 'unavailable';

export interface ActualCostReport {
  status: ActualCostStatus;
  /** Null when status is 'unavailable'. */
  totalUsd: number | null;
  daily: ActualCostDaily[];
  /** Set only when status is 'unavailable', for display next to the tile. */
  message?: string;
}

interface OpenAiCostAmount {
  value: number;
  currency: string;
}

interface OpenAiCostResult {
  amount: OpenAiCostAmount;
}

interface OpenAiCostBucket {
  start_time: number;
  end_time: number;
  results: OpenAiCostResult[];
}

interface OpenAiCostsPage {
  data: OpenAiCostBucket[];
  has_more: boolean;
  next_page: string | null;
}

const cache = new Map<string, { expiresAt: number; report: ActualCostReport }>();

function parseProjectIds(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw.split(',').map((id) => id.trim()).filter((id) => id.length > 0);
}

function utcDayStartSeconds(day: string): number {
  return Math.floor(Date.parse(`${day}T00:00:00.000Z`) / 1000);
}

function cacheKey(from: string, to: string, projectIds: string[]): string {
  return `${from}|${to}|${projectIds.slice().sort().join(',')}`;
}

async function fetchPage(params: URLSearchParams, adminKey: string): Promise<OpenAiCostsPage> {
  const res = await fetch(`${OPENAI_COSTS_URL}?${params.toString()}`, {
    headers: { Authorization: `Bearer ${adminKey}` },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`OpenAI costs API returned ${res.status}`);
  }
  return res.json() as Promise<OpenAiCostsPage>;
}

/** Fetches every bucket in [startSeconds, endSeconds), following next_page/has_more. */
async function fetchAllBuckets(
  startSeconds: number,
  endSeconds: number,
  adminKey: string,
  projectIds: string[],
): Promise<OpenAiCostBucket[]> {
  const daysInRange = Math.max(1, Math.round((endSeconds - startSeconds) / 86_400));
  const limit = Math.min(MAX_BUCKETS_PER_PAGE, daysInRange);

  const buckets: OpenAiCostBucket[] = [];
  let page: string | undefined;
  for (let i = 0; i < MAX_PAGES; i++) {
    const params = new URLSearchParams({
      start_time: String(startSeconds),
      end_time: String(endSeconds),
      bucket_width: BUCKET_WIDTH,
      limit: String(limit),
    });
    // OpenAI's list-valued query params (project_ids, models, ...) are repeated
    // keys, not project_ids[]=..., matching how the Python `requests` client
    // serializes a list-valued params entry in OpenAI's own cookbook examples.
    for (const projectId of projectIds) params.append('project_ids', projectId);
    if (page) params.set('page', page);

    const result = await fetchPage(params, adminKey);
    buckets.push(...result.data);
    if (!result.has_more || !result.next_page) return buckets;
    page = result.next_page;
  }
  return buckets;
}

function bucketsToDaily(buckets: OpenAiCostBucket[]): ActualCostDaily[] {
  const totals = new Map<string, number>();
  for (const bucket of buckets) {
    const date = new Date(bucket.start_time * 1000).toISOString().slice(0, 10);
    const bucketTotal = bucket.results.reduce((sum, r) => sum + (r.amount?.value ?? 0), 0);
    totals.set(date, (totals.get(date) ?? 0) + bucketTotal);
  }
  return Array.from(totals.entries())
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([date, costUsd]) => ({ date, costUsd }));
}

/**
 * Actual OpenAI-billed cost for [from, to] (both YYYY-MM-DD, UTC days,
 * `to` inclusive), org/project-wide -- never scoped to one user. Returns
 * null when OPENAI_ADMIN_KEY is unset (feature off), or a report whose
 * status is 'unavailable' on any API failure; never throws.
 */
export async function getActualCostReport(from: string, to: string): Promise<ActualCostReport | null> {
  const adminKey = process.env.OPENAI_ADMIN_KEY;
  if (!adminKey) return null;

  const projectIds = parseProjectIds(process.env.OPENAI_PROJECT_ID);
  const key = cacheKey(from, to, projectIds);
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.report;

  try {
    const startSeconds = utcDayStartSeconds(from);
    const endSeconds = utcDayStartSeconds(to) + 86_400;
    const buckets = await fetchAllBuckets(startSeconds, endSeconds, adminKey, projectIds);
    const daily = bucketsToDaily(buckets);
    const totalUsd = daily.reduce((sum, d) => sum + d.costUsd, 0);
    const report: ActualCostReport = { status: 'ok', totalUsd, daily };
    cache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, report });
    return report;
  } catch (err) {
    console.error('[openai costs] failed to fetch actual billed cost:', err);
    const report: ActualCostReport = {
      status: 'unavailable',
      totalUsd: null,
      daily: [],
      message: 'Actual billed cost is temporarily unavailable.',
    };
    cache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, report });
    return report;
  }
}

/** Exported for tests only, to reset the in-memory cache between cases. */
export function _clearActualCostCache(): void {
  cache.clear();
}
