// External nutrition data providers: USDA FoodData Central + Open Food Facts.
// Uses native fetch (Node 23). No external HTTP dep.
//
// CONTRACT (signatures fixed in design; S1 fills in the bodies):
//   - searchFoods: query USDA FDC foods/search (api key from process.env.USDA_FDC_API_KEY,
//     dataType=Foundation,SR Legacy,Survey (FNDDS), pageSize=5), map the best matches to
//     FoodSearchResult via a lightweight token-overlap scorer (normalize, Dice/Jaccard,
//     bonus for Foundation/SR Legacy, penalty for very long descriptions); fall back to an
//     OFF text search if FDC returns nothing. Extract per-100g macros by nutrient number
//     (Energy 1008, Protein 1003, Carbs 1005, Fat 1004, Fiber 1079, Sugars 2000, Sodium 1093).
//     In-memory cache keyed by fdcId. Never throw on a single bad match — return [].
//   - lookupBarcode: GET https://world.openfoodfacts.org/api/v2/product/<code>.json
//     (send a descriptive User-Agent). Return null when status:0 (not found).
import { FoodSearchResult, FoodPortion } from '../../schemas/nutrition';

const USER_AGENT = 'WorkoutLogApp/1.0 (nutrition tracker; contact: admin@example.com)';

// In-memory cache: source_ref → FoodSearchResult
const cache = new Map<string, FoodSearchResult>();

// In-memory cache for portions: "source:ref" → FoodPortion[]
const portionsCache = new Map<string, FoodPortion[]>();

/** Normalize a string to a set of lowercase tokens. */
function tokenize(str: string): Set<string> {
  const tokens = str
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1);
  return new Set(tokens);
}

/** Dice coefficient between two token sets. */
function diceScore(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const t of a) {
    if (b.has(t)) intersection++;
  }
  return (2 * intersection) / (a.size + b.size);
}

/** Score a food name against the query tokens. Higher is better. */
function scoreResult(name: string, queryTokens: Set<string>, dataType?: string): number {
  const nameTokens = tokenize(name);
  let score = diceScore(queryTokens, nameTokens);
  // bonus for preferred data types
  if (dataType === 'Foundation' || dataType === 'SR Legacy') score += 0.1;
  // penalty for very long descriptions (likely composite or branded)
  if (name.length > 80) score -= 0.1;
  return score;
}

type NutrientMap = Record<number, number | null>;

/** Extract macros by USDA nutrientId (Energy 1008, Protein 1003, Carbs 1005, Fat 1004,
 *  Fiber 1079, Sugars 2000, Sodium 1093). NB: these are nutrient IDs — NOT nutrientNumber,
 *  which uses the legacy codes "208"/"203"/"205"/"204" and would never match. */
function extractNutrients(nutrients: Array<{ nutrientId?: number; value?: number }>): NutrientMap {
  const map: NutrientMap = { 1008: null, 1003: null, 1005: null, 1004: null, 1079: null, 2000: null, 1093: null };
  for (const n of nutrients) {
    const id = n.nutrientId;
    if (id !== undefined && id in map && n.value !== undefined && n.value !== null) {
      map[id] = n.value;
    }
  }
  return map;
}

/** Map USDA food item to FoodSearchResult. Returns null if essential macros missing. */
function mapUsdaFood(food: any, queryTokens: Set<string>): FoodSearchResult | null {
  try {
    const name: string = food.description ?? '';
    const nutrients: Array<{ nutrientId?: number; value?: number }> = food.foodNutrients ?? [];
    const nm = extractNutrients(nutrients);

    // Require energy; treat a MISSING macro as 0 (USDA omits legitimately-zero
    // nutrients, e.g. carbs on raw chicken — don't drop the whole food for that).
    const calories = nm[1008];
    if (calories === null) return null;
    const protein = nm[1003] ?? 0;
    const carbs = nm[1005] ?? 0;
    const fat = nm[1004] ?? 0;

    const sourceRef = String(food.fdcId);
    const result: FoodSearchResult = {
      name,
      source: 'usda',
      source_ref: sourceRef,
      per100g: {
        calories,
        protein_g: protein,
        carbs_g: carbs,
        fat_g: fat,
        fiber_g: nm[1079] ?? null,
        sugar_g: nm[2000] ?? null,
        // USDA sodium in mg/100g already
        sodium_mg: nm[1093] !== null ? nm[1093]! : null,
      },
      serving_grams: food.servingSize ?? null,
    };

    // cache by source_ref
    cache.set(sourceRef, result);
    return result;
  } catch {
    return null;
  }
}

/** OFF text search fallback. */
async function searchOFF(query: string): Promise<FoodSearchResult[]> {
  try {
    const url =
      `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(query)}` +
      `&search_simple=1&action=process&json=1&page_size=5&fields=product_name,nutriments,serving_quantity`;
    const resp = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(8000),
    });
    if (!resp.ok) return [];
    const data: any = await resp.json();
    const products: any[] = data.products ?? [];
    const results: FoodSearchResult[] = [];

    for (const p of products) {
      try {
        const name: string = p.product_name ?? '';
        if (!name) continue;
        const n = p.nutriments ?? {};
        const calories = n['energy-kcal_100g'] ?? n['energy_100g'];
        if (calories === undefined || calories === null) continue;
        const sourceRef = p.id ?? p._id ?? `off-${encodeURIComponent(name)}`;
        const result: FoodSearchResult = {
          name,
          source: 'off',
          source_ref: String(sourceRef),
          per100g: {
            calories: Number(calories),
            protein_g: Number(n['proteins_100g'] ?? 0),
            carbs_g: Number(n['carbohydrates_100g'] ?? 0),
            fat_g: Number(n['fat_100g'] ?? 0),
            fiber_g: n['fiber_100g'] != null ? Number(n['fiber_100g']) : null,
            sugar_g: n['sugars_100g'] != null ? Number(n['sugars_100g']) : null,
            // OFF sodium is in g/100g; convert to mg
            sodium_mg: n['sodium_100g'] != null ? Number(n['sodium_100g']) * 1000 : null,
          },
          serving_grams: p.serving_quantity ? Number(p.serving_quantity) : null,
        };
        cache.set(String(sourceRef), result);
        results.push(result);
      } catch {
        // skip bad product
      }
    }
    return results;
  } catch {
    return [];
  }
}

/** One USDA FDC search attempt → mapped + ranked results (empty on any failure). */
async function searchUsdaOnce(
  query: string,
  apiKey: string,
  queryTokens: Set<string>,
): Promise<FoodSearchResult[]> {
  try {
    const url =
      `https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${encodeURIComponent(apiKey)}` +
      `&query=${encodeURIComponent(query)}` +
      `&dataType=Foundation,SR%20Legacy,Survey%20(FNDDS)&pageSize=10`;
    const resp = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(8000),
    });
    if (!resp.ok) return [];
    const data: any = await resp.json();
    const foods: any[] = data.foods ?? [];
    const mapped: Array<{ result: FoodSearchResult; score: number }> = [];
    for (const food of foods) {
      const result = mapUsdaFood(food, queryTokens);
      if (!result) continue;
      mapped.push({ result, score: scoreResult(result.name, queryTokens, food.dataType) });
    }
    mapped.sort((a, b) => b.score - a.score);
    return mapped.slice(0, 5).map((m) => m.result);
  } catch {
    return [];
  }
}

/** USDA + OFF text search → ranked candidate foods with per-100g macros. */
export async function searchFoods(query: string): Promise<FoodSearchResult[]> {
  const apiKey = process.env.USDA_FDC_API_KEY ?? 'DEMO_KEY';
  const queryTokens = tokenize(query);

  // USDA FDC search is intermittently flaky/rate-limited — retry once on empty
  // before falling back to Open Food Facts (which is weak for generic whole foods).
  let results = await searchUsdaOnce(query, apiKey, queryTokens);
  if (results.length === 0) {
    await new Promise((r) => setTimeout(r, 250));
    results = await searchUsdaOnce(query, apiKey, queryTokens);
  }
  if (results.length === 0) {
    results = await searchOFF(query);
  }
  return results;
}

/** Fetch household serving portions for a food from USDA FDC or OFF.
 *  Returns [] on any error; never throws. Results are cached in-memory. */
export async function getPortions(source: 'usda' | 'off', ref: string): Promise<FoodPortion[]> {
  const cacheKey = `${source}:${ref}`;
  const cached = portionsCache.get(cacheKey);
  if (cached) return cached;

  if (source === 'off') {
    portionsCache.set(cacheKey, []);
    return [];
  }

  // USDA: fetch the full food detail record
  try {
    const apiKey = process.env.USDA_FDC_API_KEY ?? 'DEMO_KEY';
    const url = `https://api.nal.usda.gov/fdc/v1/food/${encodeURIComponent(ref)}?api_key=${encodeURIComponent(apiKey)}`;
    const resp = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(8000),
    });
    if (!resp.ok) {
      portionsCache.set(cacheKey, []);
      return [];
    }

    const data: any = await resp.json();
    const rawPortions: any[] = data.foodPortions ?? [];

    const seen = new Set<string>();
    const portions: FoodPortion[] = [];

    for (const p of rawPortions) {
      try {
        const gramWeight: number = p.gramWeight;
        if (gramWeight == null || gramWeight <= 0) continue;

        const amount: number = p.amount || 1;

        // Determine label: prefer modifier (only if it's human-readable text, not a
        // numeric FNDDS code), then measureUnit.name (if not "undetermined"),
        // then fall back to portionDescription.
        let label = '';
        let gramsForOne: number;

        const modifier: string = (p.modifier ?? '').trim();
        // USDA Survey/FNDDS foods store numeric food-code IDs in modifier — skip those
        const modifierIsNumericCode = /^\d+$/.test(modifier);
        const measureUnitName: string = (p.measureUnit?.name ?? '').trim().toLowerCase();
        const portionDescription: string = (p.portionDescription ?? '').trim();

        if (modifier && !modifierIsNumericCode) {
          label = modifier;
          gramsForOne = gramWeight / amount;
        } else if (measureUnitName && measureUnitName !== 'undetermined') {
          label = p.measureUnit.name.trim();
          gramsForOne = gramWeight / amount;
        } else if (portionDescription) {
          label = portionDescription;
          // Don't divide by amount in the fallback — use gramWeight as-is
          gramsForOne = gramWeight;
        } else {
          continue; // no usable label
        }

        label = label.trim();
        if (!label) continue;
        // Skip non-informative USDA portion labels.
        if (/^(quantity not specified|not specified|undetermined)$/i.test(label)) continue;
        if (seen.has(label)) continue;
        seen.add(label);

        portions.push({ label, grams: gramsForOne });
      } catch {
        // skip malformed portion entry
      }
    }

    // Sort by grams ascending, cap to 8
    portions.sort((a, b) => a.grams - b.grams);
    const result = portions.slice(0, 8);

    portionsCache.set(cacheKey, result);
    return result;
  } catch {
    portionsCache.set(cacheKey, []);
    return [];
  }
}

/** Open Food Facts barcode lookup → product as a FoodSearchResult, or null if not found. */
export async function lookupBarcode(code: string): Promise<FoodSearchResult | null> {
  // Check cache first
  const cached = cache.get(`off-barcode-${code}`);
  if (cached) return cached;

  try {
    const url = `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json?fields=product_name,nutriments,serving_quantity`;
    const resp = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(8000),
    });
    if (!resp.ok) return null;
    const data: any = await resp.json();
    if (data.status === 0 || !data.product) return null;

    const p = data.product;
    const name: string = p.product_name ?? '';
    const n = p.nutriments ?? {};
    const caloriesRaw = n['energy-kcal_100g'] ?? n['energy_100g'];
    if (caloriesRaw === undefined || caloriesRaw === null) return null;

    const result: FoodSearchResult = {
      name: name || `Product ${code}`,
      source: 'off',
      source_ref: code,
      per100g: {
        calories: Number(caloriesRaw),
        protein_g: Number(n['proteins_100g'] ?? 0),
        carbs_g: Number(n['carbohydrates_100g'] ?? 0),
        fat_g: Number(n['fat_100g'] ?? 0),
        fiber_g: n['fiber_100g'] != null ? Number(n['fiber_100g']) : null,
        sugar_g: n['sugars_100g'] != null ? Number(n['sugars_100g']) : null,
        // OFF sodium is g/100g → mg
        sodium_mg: n['sodium_100g'] != null ? Number(n['sodium_100g']) * 1000 : null,
      },
      serving_grams: p.serving_quantity ? Number(p.serving_quantity) : null,
    };

    cache.set(`off-barcode-${code}`, result);
    return result;
  } catch {
    return null;
  }
}
