// FatSecret Platform API (Basic) food search: branded, packaged, and chain-restaurant foods.
// Skipped silently when FATSECRET_CLIENT_ID/SECRET are unset. Every failure resolves to
// "no results"; nothing here throws into a search. Traffic uses the QuotaGuard static-IP proxy
// when QUOTAGUARDSTATIC_URL is set, since FatSecret whitelists those addresses only.
import { ProxyAgent, fetch as undiciFetch } from 'undici';
import type { Dispatcher } from 'undici';
import { FoodSearchResult, FoodPortion, Per100g } from '../../shared/nutrition';

const TOKEN_URL = 'https://oauth.fatsecret.com/connect/token';
const API_URL = 'https://platform.fatsecret.com/rest/server.api';
const REQUEST_TIMEOUT_MS = 8000;
// FatSecret terms: content other than food_id may not be cached beyond 24h. Stay well under.
const SEARCH_TTL_MS = 60 * 60 * 1000;
const DETAIL_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_CACHE_ENTRIES = 500;

// ---- TTL cache ----

export class TtlCache<V> {
  private readonly map = new Map<string, { value: V; expiresAt: number }>();
  constructor(
    private readonly ttlMs: number,
    private readonly now: () => number = Date.now,
    private readonly maxEntries: number = MAX_CACHE_ENTRIES,
  ) {}

  get(key: string): V | undefined {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    if (hit.expiresAt <= this.now()) {
      this.map.delete(key);
      return undefined;
    }
    return hit.value;
  }

  set(key: string, value: V): void {
    if (this.map.size >= this.maxEntries) {
      const oldest = this.map.keys().next();
      if (!oldest.done) this.map.delete(oldest.value);
    }
    this.map.set(key, { value, expiresAt: this.now() + this.ttlMs });
  }

  clear(): void {
    this.map.clear();
  }
}

const searchCache = new TtlCache<FoodSearchResult[]>(SEARCH_TTL_MS);
const detailCache = new TtlCache<FatSecretFood | null>(DETAIL_TTL_MS);

// ---- Pure mapping ----

function toNum(x: unknown): number | null {
  if (x == null || x === '') return null;
  const n = typeof x === 'number' ? x : parseFloat(String(x));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** FatSecret returns a single object when there is one element and an array otherwise. */
export function asArray<T>(x: T | T[] | null | undefined): T[] {
  if (x == null) return [];
  return Array.isArray(x) ? x : [x];
}

export interface ParsedDescription {
  basis: string;
  calories: number;
  fat_g: number;
  carbs_g: number;
  protein_g: number;
}

/** Parses "Per 1 bottle - Calories: 230kcal | Fat: 3.50g | Carbs: 8.00g | Protein: 42.00g". */
export function parseFoodDescription(desc: unknown): ParsedDescription | null {
  if (typeof desc !== 'string') return null;
  const m = desc.match(
    /^Per\s+(.+?)\s+-\s+Calories:\s*([\d.]+)\s*kcal\s*\|\s*Fat:\s*([\d.]+)\s*g\s*\|\s*Carbs:\s*([\d.]+)\s*g\s*\|\s*Protein:\s*([\d.]+)\s*g/i,
  );
  if (!m) return null;
  return {
    basis: m[1].trim(),
    calories: parseFloat(m[2]),
    fat_g: parseFloat(m[3]),
    carbs_g: parseFloat(m[4]),
    protein_g: parseFloat(m[5]),
  };
}

function displayName(food: { food_name?: unknown; brand_name?: unknown }): string {
  const name = String(food.food_name ?? '').trim();
  const brand = typeof food.brand_name === 'string' ? food.brand_name.trim() : '';
  if (!brand) return name;
  return name.toLowerCase().startsWith(brand.toLowerCase()) ? name : `${brand} ${name}`;
}

/** Maps one foods.search item to a result. A gram basis ("Per 100g", "Per 585g") becomes per100g;
 *  anything else ("Per 1 bottle", "Per 1 serving") stays on a serving basis with no gram weight. */
export function mapSearchItem(item: any): FoodSearchResult | null {
  if (!item || item.food_id == null) return null;
  const parsed = parseFoodDescription(item.food_description);
  const name = displayName(item);
  if (!parsed || !name) return null;
  const macros = { calories: parsed.calories, protein_g: parsed.protein_g, carbs_g: parsed.carbs_g, fat_g: parsed.fat_g };

  const gramMatch = parsed.basis.match(/^(\d+(?:\.\d+)?)\s*g$/i);
  if (gramMatch) {
    const grams = parseFloat(gramMatch[1]);
    if (!(grams > 0)) return null;
    const k = 100 / grams;
    return {
      name,
      source: 'fatsecret',
      source_ref: String(item.food_id),
      per100g: {
        calories: round2(macros.calories * k),
        protein_g: round2(macros.protein_g * k),
        carbs_g: round2(macros.carbs_g * k),
        fat_g: round2(macros.fat_g * k),
      },
    };
  }
  return {
    name,
    source: 'fatsecret',
    source_ref: String(item.food_id),
    per100g: null,
    per_serving: macros,
    serving_label: parsed.basis.slice(0, 64),
  };
}

export function mapSearchResponse(json: any, limit: number): FoodSearchResult[] {
  const out: FoodSearchResult[] = [];
  for (const item of asArray(json?.foods?.food)) {
    const mapped = mapSearchItem(item);
    if (mapped) out.push(mapped);
    if (out.length >= limit) break;
  }
  return out;
}

export interface FatSecretServing {
  description: string;
  measurement: string;
  units: number;
  /** Weight of the whole serving in grams, when FatSecret publishes a g or oz metric. */
  grams: number | null;
  nutrients: Per100g;
}

export interface FatSecretFood {
  food_id: string;
  name: string;
  servings: FatSecretServing[];
}

function metricGrams(s: any): number | null {
  const amount = toNum(s.metric_serving_amount);
  if (amount == null || amount <= 0) return null;
  const unit = String(s.metric_serving_unit ?? '').toLowerCase();
  if (unit === 'g') return amount;
  if (unit === 'oz') return amount * 28.3495;
  return null;
}

/** Normalizes a food.get response (servings.serving may be an object or an array). */
export function mapFoodDetail(json: any): FatSecretFood | null {
  const food = json?.food;
  if (!food || food.food_id == null) return null;
  const servings: FatSecretServing[] = [];
  for (const s of asArray<any>(food.servings?.serving)) {
    const calories = toNum(s.calories);
    const protein = toNum(s.protein);
    const carbs = toNum(s.carbohydrate);
    const fat = toNum(s.fat);
    if (calories == null || protein == null || carbs == null || fat == null) continue;
    servings.push({
      description: String(s.serving_description ?? '').trim(),
      measurement: String(s.measurement_description ?? '').trim(),
      units: toNum(s.number_of_units) || 1,
      grams: metricGrams(s),
      nutrients: {
        calories,
        protein_g: protein,
        carbs_g: carbs,
        fat_g: fat,
        fiber_g: toNum(s.fiber),
        sugar_g: toNum(s.sugar),
        sodium_mg: toNum(s.sodium),
      },
    });
  }
  return { food_id: String(food.food_id), name: displayName(food), servings };
}

function scale(n: Per100g, k: number): Per100g {
  const sc = (v: number | null | undefined) => (v == null ? null : round2(v * k));
  return {
    calories: round2(n.calories * k),
    protein_g: round2(n.protein_g * k),
    carbs_g: round2(n.carbs_g * k),
    fat_g: round2(n.fat_g * k),
    fiber_g: sc(n.fiber_g),
    sugar_g: sc(n.sugar_g),
    sodium_mg: sc(n.sodium_mg),
  };
}

/** Per-100g nutrients from the gram-weighted serving closest to 100 g (least rounding error), or null. */
export function detailPer100g(food: FatSecretFood): Per100g | null {
  const weighted = food.servings.filter((x) => x.grams != null);
  const s = weighted.sort((a, b) => Math.abs(Math.log((a.grams as number) / 100)) - Math.abs(Math.log((b.grams as number) / 100)))[0];
  return s && s.grams ? scale(s.nutrients, 100 / s.grams) : null;
}

/** Household portions (grams for ONE unit) from servings with a gram weight. */
export function detailPortions(food: FatSecretFood): FoodPortion[] {
  const seen = new Set<string>();
  const out: FoodPortion[] = [];
  for (const s of food.servings) {
    if (!s.grams) continue;
    if (/^(g|gram|grams|100 ?g)$/i.test(s.measurement) || /^\d+\s*g$/i.test(s.description)) continue;
    let label = s.description.replace(/^[\d./\s]+/, '').replace(/\s*\(.*?\)\s*/g, ' ').trim();
    if (!label || /^serving$/i.test(label)) label = s.measurement || 'serving';
    if (seen.has(label)) continue;
    seen.add(label);
    out.push({ label: label.slice(0, 64), grams: round2(s.grams / s.units) });
  }
  out.sort((a, b) => a.grams - b.grams);
  return out.slice(0, 8);
}

/** Upgrades a description-derived result with full detail: gram-weighted foods move to per100g
 *  (with fiber, sugar, sodium and portions); serving-only foods keep their serving basis. */
export function applyDetail(result: FoodSearchResult, food: FatSecretFood): FoodSearchResult {
  const per100g = detailPer100g(food);
  if (per100g) {
    return { ...result, per100g, per_serving: null, serving_label: null, portions: detailPortions(food) };
  }
  if (result.per_serving && food.servings.length > 0) {
    const label = result.serving_label ?? '';
    const match = food.servings.find((s) => s.description.toLowerCase() === label.toLowerCase()) ?? food.servings[0];
    if (Math.round(match.nutrients.calories) === Math.round(result.per_serving.calories)) {
      return { ...result, per_serving: match.nutrients };
    }
  }
  return result;
}

// ---- HTTP ----

export function isFatSecretConfigured(): boolean {
  return !!(process.env.FATSECRET_CLIENT_ID && process.env.FATSECRET_CLIENT_SECRET);
}

let proxyAgent: Dispatcher | null = null;
let proxyUrlInUse = '';
function getDispatcher(): Dispatcher | undefined {
  const url = process.env.QUOTAGUARDSTATIC_URL;
  if (!url) return undefined;
  if (!proxyAgent || proxyUrlInUse !== url) {
    proxyAgent = new ProxyAgent(url);
    proxyUrlInUse = url;
  }
  return proxyAgent;
}

async function fsFetch(url: string, init: { method?: string; headers: Record<string, string>; body?: string }) {
  return undiciFetch(url, { ...init, dispatcher: getDispatcher(), signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
}

let token: { value: string; expiresAt: number } | null = null;
let tokenInFlight: Promise<string | null> | null = null;

async function requestToken(): Promise<string | null> {
  const basic = Buffer.from(`${process.env.FATSECRET_CLIENT_ID}:${process.env.FATSECRET_CLIENT_SECRET}`).toString('base64');
  const resp = await fsFetch(TOKEN_URL, {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials&scope=basic',
  });
  if (!resp.ok) {
    console.warn(`[nutrition/fatsecret] token request returned ${resp.status}`);
    return null;
  }
  const json: any = await resp.json();
  if (!json?.access_token) return null;
  const ttlMs = (toNum(json.expires_in) ?? 3600) * 1000;
  // Refresh a minute early so a token never expires mid-request.
  token = { value: String(json.access_token), expiresAt: Date.now() + Math.max(ttlMs - 60_000, 0) };
  return token.value;
}

async function getToken(): Promise<string | null> {
  if (token && token.expiresAt > Date.now()) return token.value;
  if (!tokenInFlight) {
    tokenInFlight = requestToken()
      .catch((err) => {
        console.warn('[nutrition/fatsecret] token request failed:', err instanceof Error ? err.message : err);
        return null;
      })
      .finally(() => {
        tokenInFlight = null;
      });
  }
  return tokenInFlight;
}

/** Calls a server.api method; returns parsed JSON or null on any transport or API error. */
async function callApi(params: Record<string, string>): Promise<any | null> {
  try {
    const bearer = await getToken();
    if (!bearer) return null;
    const qs = new URLSearchParams({ ...params, format: 'json' }).toString();
    const resp = await fsFetch(`${API_URL}?${qs}`, { headers: { Authorization: `Bearer ${bearer}` } });
    if (!resp.ok) {
      console.warn(`[nutrition/fatsecret] ${params.method} returned ${resp.status}`);
      return null;
    }
    const json: any = await resp.json();
    if (json?.error) {
      console.warn(`[nutrition/fatsecret] ${params.method} error ${json.error.code}: ${json.error.message}`);
      if (json.error.code === 2 || json.error.code === 13) token = null;
      return null;
    }
    return json;
  } catch (err) {
    console.warn(`[nutrition/fatsecret] ${params.method} failed:`, err instanceof Error ? err.message : err);
    return null;
  }
}

/** One foods.search request; [] when unconfigured or on any error. */
export async function searchFatSecret(query: string, limit: number): Promise<FoodSearchResult[]> {
  if (!isFatSecretConfigured() || !query.trim()) return [];
  const key = `${limit}:${query.trim().toLowerCase()}`;
  const cached = searchCache.get(key);
  if (cached) return cached.map((r) => ({ ...r }));
  const json = await callApi({
    method: 'foods.search',
    max_results: String(limit),
    search_expression: query.trim(),
  });
  if (!json) return [];
  const results = mapSearchResponse(json, limit);
  searchCache.set(key, results);
  return results.map((r) => ({ ...r }));
}

/** One food.get request (servings with metric weights); null when unavailable. */
export async function getFatSecretFood(foodId: string): Promise<FatSecretFood | null> {
  if (!isFatSecretConfigured() || !foodId) return null;
  const cached = detailCache.get(foodId);
  if (cached !== undefined) return cached;
  const json = await callApi({ method: 'food.get.v2', food_id: foodId });
  if (!json) return null;
  const food = mapFoodDetail(json);
  detailCache.set(foodId, food);
  return food;
}

export async function getFatSecretPortions(foodId: string): Promise<FoodPortion[]> {
  const food = await getFatSecretFood(foodId);
  return food ? detailPortions(food) : [];
}

/** Test hook: resets module-level caches and the token. */
export function _resetFatSecretStateForTests(): void {
  searchCache.clear();
  detailCache.clear();
  token = null;
}
