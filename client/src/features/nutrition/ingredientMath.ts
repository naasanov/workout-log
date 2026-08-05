/**
 * ingredientMath.ts — Pure helpers shared by EntryEditor and MealBuilder.
 *
 * Extracted from EntryEditor.tsx so both editors can import the same logic
 * without duplicating it.  EntryEditor behaviour is unchanged.
 */
import type { FoodSearchResult, FoodPortion, Per100g, IngredientInput, IngredientSource } from './types';

// ---------------------------------------------------------------------------
// Module-level portions cache — keyed by source_ref, avoids redundant fetches
// when the user reselects the same food or edits then reopens.
// Exported so both EntryEditor and MealBuilder share the same cache instance.
// ---------------------------------------------------------------------------
export const portionsCache = new Map<string, FoodPortion[]>();

// Synthetic "grams" unit — always present as the first/fallback option.
export const GRAMS_UNIT: FoodPortion = { label: 'g', grams: 1 };

// ---------------------------------------------------------------------------
// Internal row shape — extends IngredientInput with UI-only fields.
// Effective grams = quantity × unitGrams.  row.grams always = effectiveGrams.
// ---------------------------------------------------------------------------
export interface EditorRow extends IngredientInput {
  /** Internal row id for React keys/removal. */
  rowKey: number;
  /** Quantity the user typed. */
  quantity: number;
  /** Label of the selected unit. */
  unitLabel: string;
  /** Grams per one unit of the selected option (1 for plain grams). */
  unitGrams: number;
  /** Available portion options for the dropdown (includes the 'g' sentinel). */
  portions: FoodPortion[];
  /** Non-null when row was filled from a search/barcode result (enables live recompute). */
  per100g: Per100g | null;
}

let _rowKeyCounter = 0;
export function nextKey(): number {
  return ++_rowKeyCounter;
}

export function emptyRow(): EditorRow {
  return {
    rowKey: nextKey(),
    name: '',
    grams: 100,
    quantity: 100,
    unitLabel: 'g',
    unitGrams: 1,
    portions: [GRAMS_UNIT],
    source: 'manual' as IngredientSource,
    source_ref: null,
    calories: 0,
    protein_g: 0,
    carbs_g: 0,
    fat_g: 0,
    fiber_g: null,
    sugar_g: null,
    sodium_mg: null,
    per100g: null,
  };
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Recompute a row's macros from its per100g snapshot and effective grams. */
export function recomputeMacros(
  per100g: Per100g,
  grams: number,
): Pick<EditorRow, 'calories' | 'protein_g' | 'carbs_g' | 'fat_g' | 'fiber_g' | 'sugar_g' | 'sodium_mg'> {
  const factor = grams / 100;
  return {
    calories: round2(per100g.calories * factor),
    protein_g: round2(per100g.protein_g * factor),
    carbs_g: round2(per100g.carbs_g * factor),
    fat_g: round2(per100g.fat_g * factor),
    fiber_g: per100g.fiber_g != null ? round2(per100g.fiber_g * factor) : null,
    sugar_g: per100g.sugar_g != null ? round2(per100g.sugar_g * factor) : null,
    sodium_mg: per100g.sodium_mg != null ? round2(per100g.sodium_mg * factor) : null,
  };
}

// ---------------------------------------------------------------------------
// #185 — Changing serving amount should scale macros correctly even if they
// were manually entered.
//
// Previously, quantity/unit changes only recomputed macros `if (row.per100g)`.
// Rows with no per100g snapshot (hand-typed macros, or a per100g snapshot lost
// via handleNameChange after editing an auto-filled name) silently froze their
// macros on any qty/unit change.
//
// `scaleRowMacros` unifies both cases: when a per100g snapshot exists, scale
// from it (unchanged behaviour). When it doesn't, derive an implicit "per100g"
// baseline from the row's CURRENT macros ÷ CURRENT grams and scale from that.
// Because the baseline is derived fresh from current state every time (never
// cached), a manual macro edit (handleMacroChange) automatically becomes the
// new baseline for the next scale — no separate re-baseline step needed.
// ---------------------------------------------------------------------------
export function scaleRowMacros(
  row: EditorRow,
  newGrams: number,
): Pick<EditorRow, 'calories' | 'protein_g' | 'carbs_g' | 'fat_g' | 'fiber_g' | 'sugar_g' | 'sodium_mg'> {
  if (row.per100g) {
    return recomputeMacros(row.per100g, newGrams);
  }
  // Guard divide-by-zero: with no prior grams to derive a rate from, there's
  // no valid baseline — leave macros as-is rather than producing NaN/Infinity.
  if (!row.grams) {
    return {
      calories: row.calories,
      protein_g: row.protein_g,
      carbs_g: row.carbs_g,
      fat_g: row.fat_g,
      fiber_g: row.fiber_g,
      sugar_g: row.sugar_g,
      sodium_mg: row.sodium_mg,
    };
  }
  const factor = newGrams / row.grams;
  return {
    calories: round2(row.calories * factor),
    protein_g: round2(row.protein_g * factor),
    carbs_g: round2(row.carbs_g * factor),
    fat_g: round2(row.fat_g * factor),
    fiber_g: row.fiber_g != null ? round2(row.fiber_g * factor) : null,
    sugar_g: row.sugar_g != null ? round2(row.sugar_g * factor) : null,
    sodium_mg: row.sodium_mg != null ? round2(row.sodium_mg * factor) : null,
  };
}

/**
 * Build the initial portions list visible immediately when a food is selected.
 * For custom foods the portions are already provided on the result.
 * For OFF/barcode with serving_grams, include a "serving" option.
 * Always starts with "g".
 */
export function immediatePortions(food: FoodSearchResult): FoodPortion[] {
  if (food.source === 'custom' && food.portions && food.portions.length > 0) {
    return [GRAMS_UNIT, ...food.portions.filter(p => p.label !== 'g')];
  }
  const list: FoodPortion[] = [GRAMS_UNIT];
  if (food.source === 'off' && food.serving_grams) {
    list.push({ label: 'serving', grams: food.serving_grams });
  }
  return list;
}

/** Convert a FoodSearchResult into an EditorRow.
 *  Picks quantity=1 + first available portion if the food has a serving_grams,
 *  otherwise defaults to quantity=100, unit=g (same behaviour as before).
 *
 *  #199: pass `existingRowKey` when this call is filling in an already-open
 *  row (food-search selection or barcode scan on an editing row) so the
 *  result replaces that row instead of minting a new one. Omit it only when
 *  genuinely creating a brand-new row.
 */
export function rowFromFood(
  food: FoodSearchResult,
  existingPortions?: FoodPortion[],
  existingRowKey?: number,
): EditorRow {
  const portions = existingPortions ?? immediatePortions(food);

  // Default: use first non-gram portion if available, else grams.
  let quantity: number;
  let selectedUnit: FoodPortion;
  if (portions.length > 1) {
    // First non-g option (index 1) is the preferred serving.
    selectedUnit = portions[1];
    quantity = 1;
  } else {
    selectedUnit = GRAMS_UNIT;
    quantity = food.serving_grams ?? 100;
  }

  const effectiveGrams = quantity * selectedUnit.grams;

  return {
    rowKey: existingRowKey ?? nextKey(),
    name: food.name,
    grams: effectiveGrams,
    quantity,
    unitLabel: selectedUnit.label,
    unitGrams: selectedUnit.grams,
    portions,
    source: food.source,
    source_ref: food.source_ref,
    per100g: food.per100g,
    ...recomputeMacros(food.per100g, effectiveGrams),
  };
}

export function buildPortionListFromFetched(food: FoodSearchResult, fetched: FoodPortion[]): FoodPortion[] {
  const list: FoodPortion[] = [GRAMS_UNIT];
  if (food.source === 'usda') {
    for (const p of fetched) {
      list.push(p);
    }
  }
  if (food.source === 'off' && food.serving_grams) {
    list.push({ label: 'serving', grams: food.serving_grams });
  }
  return list;
}

export function buildPortionList(row: EditorRow, fetched: FoodPortion[]): FoodPortion[] {
  if (row.source === 'usda') {
    return [GRAMS_UNIT, ...fetched];
  }
  return row.portions;
}

export function applyNewPortions(row: EditorRow, newPortions: FoodPortion[]): EditorRow {
  const existing = newPortions.find(p => p.label === row.unitLabel);
  if (existing) {
    return { ...row, portions: newPortions };
  }
  const preferred = newPortions.length > 1 ? newPortions[1] : GRAMS_UNIT;
  const quantity = row.unitLabel === 'g' ? 1 : row.quantity;
  const effectiveGrams = quantity * preferred.grams;
  // #185 — scale even without a per100g snapshot (see scaleRowMacros).
  const macros = scaleRowMacros(row, effectiveGrams);
  return {
    ...row,
    portions: newPortions,
    unitLabel: preferred.label,
    unitGrams: preferred.grams,
    quantity,
    grams: effectiveGrams,
    ...macros,
  };
}

/** Sum all rows into batch totals. */
export function sumRows(rows: EditorRow[]) {
  return rows.reduce(
    (acc, r) => ({
      grams: acc.grams + r.grams,
      calories: acc.calories + r.calories,
      protein_g: acc.protein_g + r.protein_g,
      carbs_g: acc.carbs_g + r.carbs_g,
      fat_g: acc.fat_g + r.fat_g,
      fiber_g: acc.fiber_g + (r.fiber_g ?? 0),
      sugar_g: acc.sugar_g + (r.sugar_g ?? 0),
      sodium_mg: acc.sodium_mg + (r.sodium_mg ?? 0),
    }),
    { grams: 0, calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0, sugar_g: 0, sodium_mg: 0 },
  );
}
