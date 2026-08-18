// UNC campus-dining query API -- the orchestration layer the agent tools (Wave 4) call.
// Combines the scraper (scrape.ts, network) with the cache (store.ts, DB) under the
// caching policy documented in migrations/018_unc_dining.sql and repeated inline below.
// CONTRACT: none of these exported functions ever throw -- callers get a status-tagged
// or empty-shaped result instead, matching how providers.ts degrades on failure.
import { fetchMenuDay, fetchRecipe, UncMenuItem, UncPerServing, UNC_NUTRITION_LOCATION_SLUGS } from './scrape';
import * as uncStore from './store';
import { RecipeCacheRow } from './store';
import { tokenize, diceScore } from '../providers';

export type UncPeriodInfo = {
  meal_period: string;
  label: string;
  start_time: string | null;
  end_time: string | null;
  is_open_now: boolean;
};

export type UncItemRef = {
  location_slug: string;
  location_name: string;
  menu_date: string;
  meal_period: string;
  station: string;
};

export type UncFoodResult = {
  recipe_number: number;
  name: string;
  serving_label: string | null;
  per_serving: UncPerServing;
  allergens: string[];
  dietary: string[];
  ingredients: string | null;
  availability: UncItemRef[];
  score?: number;
};

type EnsureMenuDayResult =
  | { status: 'ok'; location_slug: string; location_name: string; items: UncMenuItem[] }
  | { status: 'no_menu'; location_slug: string }
  | { status: 'not_published'; location_slug: string }
  | { status: 'error'; location_slug: string; error: string };

const NULL_PER_SERVING: UncPerServing = {
  calories: null, protein_g: null, carbs_g: null, fat_g: null,
  fiber_g: null, sugar_g: null, added_sugar_g: null,
  sodium_mg: null, cholesterol_mg: null, sat_fat_g: null, trans_fat_g: null,
  calcium_mg: null, iron_mg: null, potassium_mg: null, vitamin_d_mcg: null,
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Matches the "today" convention used elsewhere in this codebase (routes/nutrition.ts):
// server-local-clock UTC calendar date, not a timezone-aware "local to the diner" date.
function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function normalizeDate(date?: string): string {
  if (date && DATE_RE.test(date)) return date;
  return todayDate();
}

/** Latest date UNC has published (today + 31), as YYYY-MM-DD. */
export function horizonDate(today: Date = new Date()): string {
  const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  d.setUTCDate(d.getUTCDate() + 31);
  return d.toISOString().slice(0, 10);
}

function ttlHours(): number {
  const raw = process.env.UNC_MENU_TTL_HOURS;
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 24;
}

function nowTimeHHMM(d: Date = new Date()): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** end-exclusive; null start/end (unparseable hours) never "contains" a time. */
function timeInRange(now: string, start: string | null, end: string | null): boolean {
  if (start === null || end === null) return false;
  return now >= start && now < end;
}

// ---- Location name resolution ----
// unc_menu_days/unc_menu_items don't store a location display name (see migration --
// only location_slug). The real name (from the page's <h1>) is learned in-memory the
// first time we actually fetch a location live in this process; a slug-derived fallback
// covers cold reads served purely from cache before any live fetch has happened.
const locationNameCache = new Map<string, string>();

function humanizeSlug(slug: string): string {
  const base = slug.replace(/-\d+$/, '').replace(/-/g, ' ');
  return base.replace(/\b\w/g, (c) => c.toUpperCase());
}

function resolveLocationName(slug: string): string {
  return locationNameCache.get(slug) ?? humanizeSlug(slug);
}

// ---- Friendly location name -> slug resolution ----
// No name table needed: derive comparable tokens straight from the slug itself (strip
// the "-<N>" stale-duplicate suffix scrape.ts warns about, split on '-') and fuzzy-match
// against the caller's input token set with the same Dice scorer providers.ts uses for
// food search. "Top of Lenoir" -> {top,of,lenoir} matches "top-of-lenoir" exactly this way.
function slugTokens(slug: string): Set<string> {
  return tokenize(slug.replace(/-\d+$/, '').replace(/-/g, ' '));
}

function resolveLocationSlug(input: string): string | null {
  const norm = input.trim().toLowerCase();
  if ((UNC_NUTRITION_LOCATION_SLUGS as readonly string[]).includes(norm)) return norm;
  const queryTokens = tokenize(norm);
  let best: { slug: string; score: number } | null = null;
  for (const slug of UNC_NUTRITION_LOCATION_SLUGS) {
    const score = diceScore(queryTokens, slugTokens(slug));
    if (!best || score > best.score) best = { slug, score };
  }
  return best && best.score >= 0.5 ? best.slug : null;
}

function resolveLocationSlugs(location?: string): string[] {
  if (!location) return [...UNC_NUTRITION_LOCATION_SLUGS];
  const slug = resolveLocationSlug(location);
  return slug ? [slug] : [];
}

// ---- Bounded concurrency ----
async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let idx = 0;
  async function worker(): Promise<void> {
    while (idx < items.length) {
      const current = idx++;
      results[current] = await fn(items[current]);
    }
  }
  const workerCount = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

const RECIPE_FETCH_CONCURRENCY = 5;
const LOCATION_FETCH_CONCURRENCY = 5;

/** Fetch+cache any recipe_numbers referenced by `items` that aren't already permanently
 *  cached, with bounded concurrency (never fire one request per item). */
async function ensureRecipesCached(items: UncMenuItem[]): Promise<void> {
  const byRecipe = new Map<number, UncMenuItem>();
  for (const item of items) {
    if (!byRecipe.has(item.recipe_number)) byRecipe.set(item.recipe_number, item);
  }
  const allNumbers = [...byRecipe.keys()];
  const cached = await uncStore.getCachedRecipeNumbers(allNumbers);
  const missing = allNumbers.filter((n) => !cached.has(n));
  if (missing.length === 0) return;

  const fetched = await mapWithConcurrency(missing, RECIPE_FETCH_CONCURRENCY, async (recipeNumber) => ({
    recipeNumber,
    recipe: await fetchRecipe(recipeNumber),
  }));

  const rows: RecipeCacheRow[] = [];
  for (const { recipeNumber, recipe } of fetched) {
    if (!recipe) continue; // fetch failed -- stays uncached, retried next time it's seen
    const item = byRecipe.get(recipeNumber)!;
    rows.push({
      recipe_number: recipeNumber,
      name: recipe.name || item.name,
      serving_label: recipe.serving_label,
      per_serving: recipe.per_serving,
      // The recipe panel's own "Allergens:" field is authoritative; fall back to the
      // menu item's allergen-has_* classes only if the panel omitted it.
      allergens: recipe.allergens.length > 0 ? recipe.allergens : item.allergens,
      // Dietary badges (vegan/halal/...) have no equivalent on the recipe panel --
      // they only ever come from the menu item's own prop-* classes.
      dietary: item.dietary,
      ingredients: recipe.ingredients,
    });
  }
  if (rows.length > 0) await uncStore.saveRecipes(rows);
}

/**
 * Ensure a location/date is cached, respecting the policy from migrations/018_unc_dining.sql:
 *   - Beyond today+31: UNC hasn't published it -- 'not_published', no network call.
 *   - Past dates: once stored, served from the DB forever, never re-fetched (UNC purges
 *     past menus after ~5-8 days; a re-fetch would come back empty and we'd lose data).
 *   - Today/future: served from cache within the TTL (default 24h, UNC_MENU_TTL_HOURS
 *     overrides), otherwise re-fetched and upserted.
 */
export async function ensureMenuDay(slug: string, date: string): Promise<EnsureMenuDayResult> {
  try {
    if (date > horizonDate()) {
      return { status: 'not_published', location_slug: slug };
    }

    const today = todayDate();
    const isPast = date < today;
    const meta = await uncStore.getMenuDayMeta(slug, date);

    let stale: boolean;
    if (meta === null) {
      stale = true;
    } else if (isPast) {
      stale = false; // permanent archive -- never re-fetch
    } else {
      stale = Date.now() - meta.fetched_at.getTime() > ttlHours() * 3600 * 1000;
    }

    if (!stale && meta !== null) {
      if (meta.item_count === 0) return { status: 'no_menu', location_slug: slug };
      const items = await uncStore.getMenuDayItems(slug, date);
      return { status: 'ok', location_slug: slug, location_name: resolveLocationName(slug), items };
    }

    const fetched = await fetchMenuDay(slug, date);

    if (fetched.status === 'error') {
      // Network/parse failure: degrade to whatever we already have rather than
      // surfacing an error the caller can't act on.
      if (meta !== null) {
        if (meta.item_count === 0) return { status: 'no_menu', location_slug: slug };
        const items = await uncStore.getMenuDayItems(slug, date);
        return { status: 'ok', location_slug: slug, location_name: resolveLocationName(slug), items };
      }
      return { status: 'error', location_slug: slug, error: fetched.error };
    }

    if (fetched.status === 'ok') {
      locationNameCache.set(slug, fetched.location_name);
      await ensureRecipesCached(fetched.items);
      await uncStore.saveMenuDay(slug, date, fetched.items);
      const items = await uncStore.getMenuDayItems(slug, date);
      return { status: 'ok', location_slug: slug, location_name: fetched.location_name, items };
    }

    // fetched.status === 'no_menu' -- write path is guarded (see store.ts saveMenuDay):
    // if we already had a non-empty archived day, that data survives this call intact.
    await uncStore.saveMenuDay(slug, date, []);
    const postMeta = await uncStore.getMenuDayMeta(slug, date);
    if (postMeta && postMeta.item_count > 0) {
      const items = await uncStore.getMenuDayItems(slug, date);
      return { status: 'ok', location_slug: slug, location_name: resolveLocationName(slug), items };
    }
    return { status: 'no_menu', location_slug: slug };
  } catch (err) {
    return { status: 'error', location_slug: slug, error: err instanceof Error ? err.message : String(err) };
  }
}

async function ensureLocationsForDate(date: string, slugs: string[]): Promise<Map<string, EnsureMenuDayResult>> {
  const pairs = await mapWithConcurrency(slugs, LOCATION_FETCH_CONCURRENCY, async (slug) => {
    return [slug, await ensureMenuDay(slug, date)] as const;
  });
  return new Map(pairs);
}

// Canonical meal-hour windows, used ONLY as a fallback when a period's own label doesn't
// match the query by name -- e.g. a retail location's single "Open" period. A "dinner"
// search then includes it if its open hours overlap dinner at all (Stone Leaf Cafe, open
// to 7pm, overlaps; Bandidos, closed by 3pm, does not).
const MEAL_WINDOWS: Record<string, [string, string]> = {
  breakfast: ['06:00', '11:00'],
  brunch: ['10:00', '14:00'],
  lunch: ['11:00', '14:30'],
  dinner: ['17:00', '20:30'],
};

function periodMatchesQuery(item: UncMenuItem, query?: string): boolean {
  if (!query) return true;
  const q = query.trim().toLowerCase();
  if (q === 'now') {
    return timeInRange(nowTimeHHMM(), item.period_start, item.period_end);
  }
  const label = item.period_label.toLowerCase();
  if (label.includes(q) || q.includes(label)) return true;
  const window = MEAL_WINDOWS[q];
  if (window && item.period_start !== null && item.period_end !== null) {
    return item.period_start < window[1] && item.period_end > window[0];
  }
  return false;
}

/** True if any query token is a prefix/substring match (either direction) of any name
 *  token -- e.g. "burrito" vs "burritos". Used only to decide inclusion; diceScore
 *  still does the actual ranking whenever it finds a real (exact-token) match. */
function looseTokenOverlap(queryTokens: Set<string>, nameTokens: Set<string>): boolean {
  for (const q of queryTokens) {
    for (const n of nameTokens) {
      if (q === n || n.startsWith(q) || q.startsWith(n)) return true;
    }
  }
  return false;
}

function stationMatchesQuery(station: string, query?: string): boolean {
  if (!query) return true;
  const s = station.toLowerCase();
  const q = query.trim().toLowerCase();
  return s.includes(q) || q.includes(s);
}

/** Search foods by name across a date's menus. `location` optional (slug or friendly name). */
export async function searchUncFoods(
  query: string,
  date?: string,
  location?: string,
): Promise<{ menu_date: string; horizon_date: string; not_published: boolean; results: UncFoodResult[] }> {
  try {
    const d = normalizeDate(date);
    const horizon = horizonDate();
    if (d > horizon) {
      return { menu_date: d, horizon_date: horizon, not_published: true, results: [] };
    }

    const slugs = resolveLocationSlugs(location);
    const dayResults = await ensureLocationsForDate(d, slugs);

    // Group by recipe_number so a food served at multiple stations/periods scores once
    // and carries every place it's available, per UncFoodResult's contract.
    const byRecipe = new Map<number, { item: UncMenuItem; availability: UncItemRef[] }>();
    for (const [slug, r] of dayResults) {
      if (r.status !== 'ok') continue;
      for (const item of r.items) {
        const ref: UncItemRef = {
          location_slug: slug, location_name: r.location_name,
          menu_date: d, meal_period: item.meal_period, station: item.station,
        };
        const existing = byRecipe.get(item.recipe_number);
        if (existing) existing.availability.push(ref);
        else byRecipe.set(item.recipe_number, { item, availability: [ref] });
      }
    }

    const recipeMap = await uncStore.getRecipesByNumbers([...byRecipe.keys()]);
    const queryTokens = tokenize(query);

    const scored: UncFoodResult[] = [];
    for (const [recipeNumber, { item, availability }] of byRecipe) {
      const recipeRow = recipeMap.get(recipeNumber);
      const name = recipeRow?.name || item.name;
      const nameTokens = tokenize(name);
      let score = diceScore(queryTokens, nameTokens);
      // diceScore requires an EXACT token match, so a plural/prefix miss (query
      // "burrito" vs name token "burritos") scores a hard 0 and would otherwise vanish
      // even though it's obviously the food being asked for. Candidate inclusion is
      // therefore loosened to a per-token prefix/substring check; diceScore's real
      // score is still what's used for ranking whenever it found anything.
      if (score <= 0) {
        if (!looseTokenOverlap(queryTokens, nameTokens)) continue;
        score = 0.01;
      }
      scored.push({
        recipe_number: recipeNumber,
        name,
        serving_label: recipeRow?.serving_label ?? null,
        per_serving: recipeRow?.per_serving ?? NULL_PER_SERVING,
        allergens: recipeRow?.allergens ?? item.allergens,
        dietary: recipeRow?.dietary ?? item.dietary,
        ingredients: recipeRow?.ingredients ?? null,
        availability,
        score,
      });
    }
    scored.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    return { menu_date: d, horizon_date: horizon, not_published: false, results: scored.slice(0, 10) };
  } catch {
    return { menu_date: normalizeDate(date), horizon_date: horizonDate(), not_published: false, results: [] };
  }
}

/** Full menu, grouped location -> period -> station. Item names only unless includeNutrition. */
export async function getUncMenu(opts: {
  date?: string; mealPeriod?: string; location?: string; station?: string; includeNutrition?: boolean;
}): Promise<{
  menu_date: string; horizon_date: string; not_published: boolean;
  locations: Array<{
    location_slug: string; location_name: string;
    periods: Array<UncPeriodInfo & {
      stations: Array<{ station: string; items: Array<{
        recipe_number: number; name: string; serving_label: string | null;
        allergens: string[]; dietary: string[]; per_serving?: UncPerServing;
      }> }>;
    }>;
  }>;
}> {
  try {
    const d = normalizeDate(opts.date);
    const horizon = horizonDate();
    if (d > horizon) {
      return { menu_date: d, horizon_date: horizon, not_published: true, locations: [] };
    }

    const slugs = resolveLocationSlugs(opts.location);
    const dayResults = await ensureLocationsForDate(d, slugs);

    const isToday = d === todayDate();

    let recipeMap = new Map<number, RecipeCacheRow>();
    if (opts.includeNutrition) {
      const needed = new Set<number>();
      for (const r of dayResults.values()) {
        if (r.status === 'ok') for (const item of r.items) needed.add(item.recipe_number);
      }
      recipeMap = await uncStore.getRecipesByNumbers([...needed]);
    }

    const locations: Awaited<ReturnType<typeof getUncMenu>>['locations'] = [];
    for (const slug of slugs) {
      const r = dayResults.get(slug);
      if (!r || r.status !== 'ok') continue; // no menu that day -- skip, don't error

      const periodGroups = new Map<string, { sample: UncMenuItem; stations: Map<string, UncMenuItem[]> }>();
      for (const item of r.items) {
        if (!periodMatchesQuery(item, opts.mealPeriod)) continue;
        if (!stationMatchesQuery(item.station, opts.station)) continue;
        let group = periodGroups.get(item.meal_period);
        if (!group) {
          group = { sample: item, stations: new Map() };
          periodGroups.set(item.meal_period, group);
        }
        let stationItems = group.stations.get(item.station);
        if (!stationItems) {
          stationItems = [];
          group.stations.set(item.station, stationItems);
        }
        stationItems.push(item);
      }
      if (periodGroups.size === 0) continue; // nothing matched the filters at this location

      const periods = [...periodGroups.values()].map((group) => ({
        meal_period: group.sample.meal_period,
        label: group.sample.period_label,
        start_time: group.sample.period_start,
        end_time: group.sample.period_end,
        is_open_now: isToday && timeInRange(nowTimeHHMM(), group.sample.period_start, group.sample.period_end),
        stations: [...group.stations.entries()].map(([station, items]) => ({
          station,
          items: items.map((it) => {
            const recipeRow = recipeMap.get(it.recipe_number);
            const built: {
              recipe_number: number; name: string; serving_label: string | null;
              allergens: string[]; dietary: string[]; per_serving?: UncPerServing;
            } = {
              recipe_number: it.recipe_number,
              name: recipeRow?.name || it.name,
              serving_label: recipeRow?.serving_label ?? null,
              allergens: recipeRow?.allergens ?? it.allergens,
              dietary: recipeRow?.dietary ?? it.dietary,
            };
            if (opts.includeNutrition) built.per_serving = recipeRow?.per_serving ?? NULL_PER_SERVING;
            return built;
          }),
        })),
      }));

      locations.push({ location_slug: slug, location_name: r.location_name, periods });
    }

    return { menu_date: d, horizon_date: horizon, not_published: false, locations };
  } catch {
    return { menu_date: normalizeDate(opts.date), horizon_date: horizonDate(), not_published: false, locations: [] };
  }
}

/** Locations + hours for a date, with NO menu items (cheap "what's open" lookup). */
export async function listUncLocations(date?: string): Promise<{
  menu_date: string; horizon_date: string;
  locations: Array<{ location_slug: string; location_name: string; has_menu: boolean; periods: UncPeriodInfo[] }>;
}> {
  try {
    const d = normalizeDate(date);
    const horizon = horizonDate();
    const allSlugs = [...UNC_NUTRITION_LOCATION_SLUGS];

    if (d > horizon) {
      return {
        menu_date: d, horizon_date: horizon,
        locations: allSlugs.map((slug) => ({ location_slug: slug, location_name: resolveLocationName(slug), has_menu: false, periods: [] })),
      };
    }

    const dayResults = await ensureLocationsForDate(d, allSlugs);
    const isToday = d === todayDate();

    const locations = allSlugs.map((slug) => {
      const r = dayResults.get(slug);
      if (!r || r.status !== 'ok') {
        return { location_slug: slug, location_name: resolveLocationName(slug), has_menu: false, periods: [] };
      }
      const seen = new Map<string, UncMenuItem>();
      for (const item of r.items) if (!seen.has(item.meal_period)) seen.set(item.meal_period, item);
      const periods: UncPeriodInfo[] = [...seen.values()].map((item) => ({
        meal_period: item.meal_period,
        label: item.period_label,
        start_time: item.period_start,
        end_time: item.period_end,
        is_open_now: isToday && timeInRange(nowTimeHHMM(), item.period_start, item.period_end),
      }));
      return { location_slug: slug, location_name: r.location_name, has_menu: true, periods };
    });

    return { menu_date: d, horizon_date: horizon, locations };
  } catch {
    return {
      menu_date: normalizeDate(date), horizon_date: horizonDate(),
      locations: [...UNC_NUTRITION_LOCATION_SLUGS].map((slug) => ({ location_slug: slug, location_name: resolveLocationName(slug), has_menu: false, periods: [] })),
    };
  }
}

/** One item's full nutrition by recipe number. */
export async function getUncFood(recipeNumber: number, date?: string): Promise<UncFoodResult | null> {
  try {
    const d = normalizeDate(date);
    const horizon = horizonDate();

    const availability: UncItemRef[] = [];
    let fallbackItem: UncMenuItem | null = null;

    if (d <= horizon) {
      const dayResults = await ensureLocationsForDate(d, [...UNC_NUTRITION_LOCATION_SLUGS]);
      for (const [slug, r] of dayResults) {
        if (r.status !== 'ok') continue;
        for (const item of r.items) {
          if (item.recipe_number !== recipeNumber) continue;
          if (!fallbackItem) fallbackItem = item;
          availability.push({ location_slug: slug, location_name: r.location_name, menu_date: d, meal_period: item.meal_period, station: item.station });
        }
      }
    }

    // Query the cache AFTER building availability: ensureMenuDay's internal recipe
    // caching (ensureRecipesCached) may have just warmed this exact recipe_number.
    const recipeMap = await uncStore.getRecipesByNumbers([recipeNumber]);
    const recipeRow = recipeMap.get(recipeNumber);

    if (!recipeRow && !fallbackItem) return null;

    return {
      recipe_number: recipeNumber,
      name: recipeRow?.name || fallbackItem?.name || `Recipe ${recipeNumber}`,
      serving_label: recipeRow?.serving_label ?? null,
      per_serving: recipeRow?.per_serving ?? NULL_PER_SERVING,
      allergens: recipeRow?.allergens ?? fallbackItem?.allergens ?? [],
      dietary: recipeRow?.dietary ?? fallbackItem?.dietary ?? [],
      ingredients: recipeRow?.ingredients ?? null,
      availability,
    };
  } catch {
    return null;
  }
}
