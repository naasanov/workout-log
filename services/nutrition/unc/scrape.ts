// UNC Dining scraper (dining.unc.edu). Reverse-engineered from the live site — there is
// no public API. Two endpoints:
//   1. Menu page:      GET /locations/{slug}/?date=YYYY-MM-DD          -> HTML
//   2. Nutrition panel: GET /wp-content/themes/nmc_dining/ajax-content/recipe.php
//                           ?recipe={n}&hide_allergens=0                -> JSON {success, html}
// Uses native fetch (Node 23). No new HTTP dep, mirroring services/nutrition/providers.ts.
//
// Perf note: dining hall pages (e.g. Chase) run ~6.8MB with 1300+ items. We avoid the
// classic ReDoS trap of `(.*?)` spanning megabytes under a lookahead by slicing out
// tabpanels/stations with plain indexOf first, then only regex-scanning the resulting
// (much smaller) substrings for items.

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const MENU_FETCH_TIMEOUT_MS = 15000;
const RECIPE_FETCH_TIMEOUT_MS = 15000;

export type UncPerServing = {
  calories: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  fiber_g: number | null;
  sugar_g: number | null;
  added_sugar_g: number | null;
  sodium_mg: number | null;
  cholesterol_mg: number | null;
  sat_fat_g: number | null;
  trans_fat_g: number | null;
  calcium_mg: number | null;
  iron_mg: number | null;
  potassium_mg: number | null;
  vitamin_d_mcg: number | null;
};

export type UncMenuItem = {
  meal_period: string; // raw label, e.g. "Dinner (5pm-8:30pm)"
  period_label: string; // "Dinner"
  period_start: string | null; // "17:00" 24h
  period_end: string | null; // "20:30"; "24:00" when UNC writes 12am
  station: string;
  recipe_number: number;
  name: string;
  allergens: string[];
  dietary: string[];
  ingredients_search: string;
};

export type UncMenuDay =
  | { status: 'ok'; location_slug: string; location_name: string; date: string; items: UncMenuItem[] }
  | { status: 'no_menu'; location_slug: string; date: string }
  | { status: 'error'; location_slug: string; date: string; error: string };

export type UncRecipe = {
  recipe_number: number;
  name: string;
  serving_label: string | null;
  per_serving: UncPerServing;
  allergens: string[];
  ingredients: string | null;
};

// Location slugs known to publish full nutrition panels (14 of UNC's 33 dining
// locations). STALE-DUPLICATE HAZARD: UNC's location list has near-duplicate slugs
// (e.g. "bandidos-2", "italian-pizzeria-iii-2", "italian-pizzeria-iii-4") left over
// from site reorganizations that resolve to pages with no menu/nutrition data. Those
// are deliberately excluded here — don't "helpfully" add them back in without checking
// the live site first, they are traps, not omissions.
export const UNC_NUTRITION_LOCATION_SLUGS = [
  'chase',
  'top-of-lenoir',
  'mediterranean-deli',
  'cafe-1789',
  'la-farm-bakery-2',
  'mediterranean-deli-3',
  'blue-ram',
  'first-draft-deli',
  'the-scoop',
  '1-5-0-2',
  'law-bar',
  'stone-leaf-cafe',
  'cholanad',
  'bandidos-3',
] as const;

const NUTRITION_FIELDS = [
  'Calories',
  'Total Fat',
  'Saturated Fat',
  'Trans Fat',
  'Cholesterol',
  'Sodium',
  'Total Carbohydrate',
  'Dietary Fiber',
  'Sugars',
  'Added Sugar',
  'Protein',
  'Calcium',
  'Iron',
  'Potassium',
  'Vitamin D',
] as const;

// Common named entities the site actually uses (curly quotes, dashes, nbsp, etc), plus
// generic decimal/hex numeric entity decoding (covers things like &#8217;).
const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
  mdash: '—',
  ndash: '–',
  hellip: '…',
  deg: '°',
  frac12: '½',
  frac14: '¼',
  frac34: '¾',
  copy: '©',
  reg: '®',
  trade: '™',
};

/** Unescape HTML entities: named entities we know about + generic numeric (&#123;/&#x1F;). */
function unescapeHtml(str: string): string {
  return str.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z][a-zA-Z0-9]*);/g, (match, ent: string) => {
    if (ent[0] === '#') {
      const isHex = ent[1] === 'x' || ent[1] === 'X';
      const code = isHex ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
      return Number.isNaN(code) ? match : String.fromCodePoint(code);
    }
    return NAMED_ENTITIES[ent] ?? match;
  });
}

/** Strip tags, unescape entities, and collapse internal whitespace to single spaces. */
function textFromHtmlFragment(fragment: string): string {
  return unescapeHtml(fragment.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
}

/**
 * Parse a raw period label like "Dinner (5pm-8:30pm)" into a display label and 24h
 * start/end times. Returns nulls for start/end when the "(start-end)" suffix isn't
 * present or doesn't parse — callers should treat that as "unknown hours", not an error.
 */
export function parsePeriodLabel(label: string): {
  period_label: string;
  period_start: string | null;
  period_end: string | null;
} {
  const normalized = label.replace(/\s+/g, ' ').trim();
  const m = /^(.*?)\s*\(([^)]+)\)\s*$/.exec(normalized);
  if (!m) {
    return { period_label: normalized, period_start: null, period_end: null };
  }
  const period_label = m[1].trim();
  const range = m[2].trim();
  const parts = range.split('-');
  if (parts.length !== 2) {
    return { period_label, period_start: null, period_end: null };
  }
  const period_start = parseClockTime(parts[0].trim());
  let period_end = parseClockTime(parts[1].trim());
  // UNC writes midnight as "12am"; represent an END time of midnight as 24:00 so it
  // sorts/compares after the period's own start time (00:00 would look like it's
  // before the period even begins).
  if (period_end === '00:00') period_end = '24:00';
  return { period_label, period_start, period_end };
}

/** Parse a 12h clock time like "7am", "10:30am", "12pm" into 24h "HH:MM", or null. */
function parseClockTime(raw: string): string | null {
  const m = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i.exec(raw);
  if (!m) return null;
  let hour = parseInt(m[1], 10);
  const minute = m[2] ? parseInt(m[2], 10) : 0;
  const meridiem = m[3].toLowerCase();
  if (hour < 1 || hour > 12 || minute < 0 || minute > 59) return null;
  if (meridiem === 'pm' && hour !== 12) hour += 12;
  if (meridiem === 'am' && hour === 12) hour = 0;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/** Slice out `<div role="tabpanel" id="{tabId}" ...> ... </div>` up to the next tabpanel,
 *  the footer, or end of document — exactly the boundary the validated Python prototype
 *  used. Implemented with indexOf rather than a regex lookahead spanning megabytes. */
function extractTabPanel(page: string, tabId: string): string | null {
  const startMarker = `<div role="tabpanel" id="${tabId}"`;
  const start = page.indexOf(startMarker);
  if (start === -1) return null;
  const searchFrom = start + startMarker.length;
  const nextPanel = page.indexOf('<div role="tabpanel"', searchFrom);
  const footer = page.indexOf('<footer', searchFrom);
  let end = page.length;
  if (nextPanel !== -1) end = Math.min(end, nextPanel);
  if (footer !== -1) end = Math.min(end, footer);
  return page.slice(start, end);
}

/** Split a tabpanel's HTML into per-station blocks on `<div class="menu-station">`,
 *  same slicing approach as extractTabPanel. */
function splitStationBlocks(panel: string): string[] {
  const marker = '<div class="menu-station">';
  const starts: number[] = [];
  let idx = panel.indexOf(marker);
  while (idx !== -1) {
    starts.push(idx);
    idx = panel.indexOf(marker, idx + marker.length);
  }
  const blocks: string[] = [];
  for (let i = 0; i < starts.length; i++) {
    const end = i + 1 < starts.length ? starts[i + 1] : panel.length;
    blocks.push(panel.slice(starts[i], end));
  }
  return blocks;
}

/** Station name: the `.toggle-menu-station-data` button text is the only branch that
 *  actually fires on live pages (there is NO `menu-station-name` span despite what you'd
 *  guess from the class naming) — but we keep the span as a defensive fallback. */
function extractStationName(block: string): string {
  const spanMatch = /<span class="menu-station-name">([\s\S]*?)<\/span>/.exec(block);
  if (spanMatch) return textFromHtmlFragment(spanMatch[1]) || '?';
  const btnMatch = /class="toggle-menu-station-data"[^>]*>([\s\S]*?)<\/button>/.exec(block);
  if (btnMatch) return textFromHtmlFragment(btnMatch[1]) || '?';
  return '?';
}

const ITEM_RE =
  /<li class="menu-item-li" data-searchable="([^"]*)">\s*<a[^>]*class="show-nutrition([^"]*)"[^>]*data-recipe="(\d+)"[^>]*>([\s\S]*?)<\/a>/g;

const PERIOD_TAB_RE =
  /<button[^>]*aria-controls="(tabinfo-\d+)"[^>]*>\s*<div class="c-tabs-nav__link-inner">([\s\S]*?)<\/div>/g;

/**
 * Pure parser: menu page HTML -> location display name + flat item list. Never throws —
 * a page with an unexpected shape just yields fewer/no items rather than an exception,
 * since fetchMenuDay uses "zero items" to mean "no menu published today" (gotcha: UNC
 * returns HTTP 200 with an empty menu, never a 404).
 */
export function parseMenuHtml(
  html: string,
  _slug: string,
  _date: string,
): { location_name: string; items: UncMenuItem[] } {
  // Location display name comes from the page <h1> — NOT <title>. The page embeds many
  // inline-SVG <title> elements ("Vegan", "Halal", "Smart Choice" icons) that would
  // otherwise get picked up by mistake.
  const h1Match = /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(html);
  const location_name = h1Match ? textFromHtmlFragment(h1Match[1]) : '';

  // Meal-period tab buttons -> tabpanel id, e.g. tabinfo-4 -> "Dinner (5pm-8:30pm)".
  const periods = new Map<string, string>();
  for (const m of html.matchAll(PERIOD_TAB_RE)) {
    periods.set(m[1], textFromHtmlFragment(m[2]));
  }

  const items: UncMenuItem[] = [];
  for (const [tabId, rawPeriod] of periods) {
    const panel = extractTabPanel(html, tabId);
    if (!panel) continue;
    const { period_label, period_start, period_end } = parsePeriodLabel(rawPeriod);

    for (const block of splitStationBlocks(panel)) {
      const station = extractStationName(block);
      for (const im of block.matchAll(ITEM_RE)) {
        const [, searchable, classAttr, recipeStr, nameHtml] = im;
        const classes = classAttr.trim().split(/\s+/).filter((c) => c.length > 0);
        const allergens = classes
          .filter((c) => c.startsWith('allergen-has_'))
          .map((c) => c.slice('allergen-has_'.length))
          .sort();
        const dietary = classes
          .filter((c) => c.startsWith('prop-'))
          .map((c) => c.slice('prop-'.length))
          .sort();
        const name = textFromHtmlFragment(nameHtml);

        // #265: an item with no name is never useful to the model, whatever the cause --
        // rather than trying to prove ITEM_RE can never produce one (extensive live
        // reproduction across many dates/locations turned up zero cases; the observed
        // blanks appear to come from unc_recipes rows that got permanently stuck with a
        // blank name, see the store.ts fix), drop it here too so the *fresh*-scrape path
        // degrades to "fewer items" the same way the cached-read path does, even against
        // a markup shape we haven't seen yet.
        if (!name) continue;

        items.push({
          meal_period: rawPeriod,
          period_label,
          period_start,
          period_end,
          station,
          recipe_number: parseInt(recipeStr, 10),
          name,
          allergens,
          dietary,
          ingredients_search: unescapeHtml(searchable),
        });
      }
    }
  }

  return { location_name, items };
}

/**
 * Pure parser: a recipe.php nutrition panel's `html` field -> structured nutrition.
 * Any field the panel omits (e.g. "Added Sugar" is absent on most non-baked recipes)
 * comes back as null — never coerced to 0, since 0 is a real, different value.
 */
export function parseRecipeHtml(html: string, recipeNumber: number): UncRecipe {
  // Strip tags to NEWLINES (not empty string) so each label/value keeps its own line —
  // that's what lets us read "label, then next numeric line" the way the panel's table
  // markup lays them out. Then unescape entities, then collapse runs of spaces/tabs
  // (but not newlines) so multi-space indentation doesn't create fake blank lines.
  let txt = html.replace(/<[^>]+>/g, '\n');
  txt = unescapeHtml(txt);
  txt = txt.replace(/[ \t]+/g, ' ');
  const lines = txt
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const found: Partial<Record<(typeof NUTRITION_FIELDS)[number], number>> = {};
  const fieldSet: Set<string> = new Set(NUTRITION_FIELDS);
  for (let i = 0; i < lines.length; i++) {
    const label = lines[i].replace(/:$/, '').trim();
    if (!fieldSet.has(label)) continue;
    const key = label as (typeof NUTRITION_FIELDS)[number];
    if (found[key] !== undefined) continue; // first occurrence wins
    for (let j = i + 1; j <= i + 2 && j < lines.length; j++) {
      const vm = /^([\d.,]+)\s*(kcal|g|mg|mcg)?$/.exec(lines[j]);
      if (vm) {
        found[key] = parseFloat(vm[1].replace(/,/g, ''));
        break;
      }
    }
  }

  let serving_label: string | null = null;
  const apsMatch = /Amount Per Serving\s*\n\s*([^\n]+)/.exec(txt);
  if (apsMatch) serving_label = apsMatch[1].trim();

  let allergensText: string | null = null;
  const allergensMatch = /Allergens\s*\n\s*([^\n]+)/.exec(txt);
  if (allergensMatch) allergensText = allergensMatch[1].trim();
  const allergens = allergensText
    ? allergensText
        .split(',')
        .map((a) => a.trim().toLowerCase())
        .filter((a) => a.length > 0)
    : [];

  const nameMatch = /<h[12][^>]*>([\s\S]*?)<\/h[12]>/.exec(html);
  const name = nameMatch ? textFromHtmlFragment(nameMatch[1]) : '';

  const ingredientsMatch = /<p>\s*<strong>Ingredients:<\/strong>([\s\S]*?)<\/p>/i.exec(html);
  const ingredients = ingredientsMatch ? textFromHtmlFragment(ingredientsMatch[1]) : null;

  const per_serving: UncPerServing = {
    calories: found['Calories'] ?? null,
    protein_g: found['Protein'] ?? null,
    carbs_g: found['Total Carbohydrate'] ?? null,
    fat_g: found['Total Fat'] ?? null,
    fiber_g: found['Dietary Fiber'] ?? null,
    sugar_g: found['Sugars'] ?? null,
    added_sugar_g: found['Added Sugar'] ?? null,
    sodium_mg: found['Sodium'] ?? null,
    cholesterol_mg: found['Cholesterol'] ?? null,
    sat_fat_g: found['Saturated Fat'] ?? null,
    trans_fat_g: found['Trans Fat'] ?? null,
    calcium_mg: found['Calcium'] ?? null,
    iron_mg: found['Iron'] ?? null,
    potassium_mg: found['Potassium'] ?? null,
    vitamin_d_mcg: found['Vitamin D'] ?? null,
  };

  return { recipe_number: recipeNumber, name, serving_label, per_serving, allergens, ingredients };
}

/**
 * Fetch and parse a single location/date menu page. Never throws — network failures,
 * non-2xx responses, and unexpected page shapes all resolve to a status-tagged result
 * so callers can distinguish "no menu published today" (status 'no_menu', a normal HTTP
 * 200 with zero items — UNC never 404s this) from "we couldn't get an answer" (status
 * 'error').
 */
export async function fetchMenuDay(slug: string, date: string): Promise<UncMenuDay> {
  let resp: Response;
  try {
    const url = `https://dining.unc.edu/locations/${encodeURIComponent(slug)}/?date=${encodeURIComponent(date)}`;
    resp = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(MENU_FETCH_TIMEOUT_MS),
    });
  } catch (err) {
    return { status: 'error', location_slug: slug, date, error: err instanceof Error ? err.message : String(err) };
  }

  if (!resp.ok) {
    return { status: 'error', location_slug: slug, date, error: `HTTP ${resp.status}` };
  }

  let html: string;
  try {
    html = await resp.text();
  } catch (err) {
    return { status: 'error', location_slug: slug, date, error: err instanceof Error ? err.message : String(err) };
  }

  let parsed: { location_name: string; items: UncMenuItem[] };
  try {
    parsed = parseMenuHtml(html, slug, date);
  } catch (err) {
    return { status: 'error', location_slug: slug, date, error: err instanceof Error ? err.message : String(err) };
  }

  if (parsed.items.length === 0) {
    return { status: 'no_menu', location_slug: slug, date };
  }
  return { status: 'ok', location_slug: slug, location_name: parsed.location_name, date, items: parsed.items };
}

/**
 * Fetch and parse a single recipe's nutrition panel. Returns null (never throws) on any
 * network failure, non-2xx response, `{success:false}` payload, or parse error — the
 * same "one bad item shouldn't take down a batch" contract as providers.ts.
 */
export async function fetchRecipe(recipeNumber: number): Promise<UncRecipe | null> {
  try {
    const url = `https://dining.unc.edu/wp-content/themes/nmc_dining/ajax-content/recipe.php?recipe=${recipeNumber}&hide_allergens=0`;
    const resp = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(RECIPE_FETCH_TIMEOUT_MS),
    });
    if (!resp.ok) return null;
    const data: any = await resp.json();
    if (!data?.success || typeof data.html !== 'string') return null;
    return parseRecipeHtml(data.html, recipeNumber);
  } catch {
    return null;
  }
}
