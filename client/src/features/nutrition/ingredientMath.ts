/**
 * ingredientMath.ts — Pure helpers shared by EntryEditor and MealBuilder.
 *
 * Extracted from EntryEditor.tsx so both editors can import the same logic
 * without duplicating it.  EntryEditor behaviour is unchanged.
 *
 * ---------------------------------------------------------------------------
 * Weight vs. serving basis
 * ---------------------------------------------------------------------------
 * Historically every ingredient was weight-based: per-100g macros scaled by a
 * gram amount. UNC campus-dining foods publish per-SERVING nutrition with no
 * gram weight at all ("1 each", "½ cup") — converting them to grams would be
 * fabricated data (a cup of soup and a cup of granola differ ~4x by weight).
 * So `EditorRow` now carries an explicit `basis` and generalizes the existing
 * quantity × unit machinery: for a weight row, `unitGrams` is the grams-per-
 * unit and `quantity × unitGrams = grams`; for a serving row there is no
 * gram equivalent at all — `quantity` IS the serving count and `grams` is
 * always `null`. Same shape, same handlers, one extra branch.
 */
import type { FoodSearchResult, FoodPortion, Per100g, IngredientInput, IngredientSource } from './types';

// ---------------------------------------------------------------------------
// Module-level portions cache — keyed by source_ref, avoids redundant fetches
// when the user reselects the same food or edits then reopens.
// Exported so both EntryEditor and MealBuilder share the same cache instance.
// ---------------------------------------------------------------------------
export const portionsCache = new Map<string, FoodPortion[]>();

// Synthetic "grams" unit — always present as the first/fallback option for
// weight-basis rows. Never offered on a serving-basis row (see IngredientSheet).
export const GRAMS_UNIT: FoodPortion = { label: 'g', grams: 1 };

// ---------------------------------------------------------------------------
// Internal row shape — extends IngredientInput with UI-only fields.
//
// Weight basis (basis: 'weight'):  grams = quantity × unitGrams (as before).
// Serving basis (basis: 'serving'): grams is always null; quantity is the
//   number of servings; unitGrams is meaningless (kept 0 for hygiene, never
//   read on this path) and unitLabel is the serving label as UNC states it
//   (e.g. "½ cup") — not a real "unit" in the weight sense.
// ---------------------------------------------------------------------------
export interface EditorRow extends IngredientInput {
  /** Internal row id for React keys/removal. */
  rowKey: number;
  /** Weight-basis: grams = quantity × unitGrams. Serving-basis: quantity = servings. */
  basis: 'weight' | 'serving';
  /** Quantity the user typed. */
  quantity: number;
  /** Label of the selected unit (weight) or the serving label (serving). */
  unitLabel: string;
  /** Grams per one unit of the selected option (1 for plain grams). Unused for serving rows. */
  unitGrams: number;
  /** Available portion options for the dropdown (includes the 'g' sentinel). Empty/irrelevant for serving rows. */
  portions: FoodPortion[];
  /** Non-null when row was filled from a search/barcode result (enables live recompute). Weight basis only. */
  per100g: Per100g | null;
  /** Non-null when row was filled from a serving-basis search result (enables live recompute). Serving basis only. */
  perServing: Per100g | null;
}

let _rowKeyCounter = 0;
export function nextKey(): number {
  return ++_rowKeyCounter;
}

export function emptyRow(): EditorRow {
  return {
    rowKey: nextKey(),
    basis: 'weight',
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
    perServing: null,
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

/**
 * Recompute a row's macros from a per-serving snapshot and a serving count.
 * Mirrors recomputeMacros exactly, except the scale factor is the serving
 * count itself (there's no /100 — per-serving values already mean "for ONE
 * serving", so factor === quantity, unlike weight's grams/100).
 */
export function recomputeServingMacros(
  perServing: Per100g,
  quantity: number,
): Pick<EditorRow, 'calories' | 'protein_g' | 'carbs_g' | 'fat_g' | 'fiber_g' | 'sugar_g' | 'sodium_mg'> {
  const factor = quantity;
  return {
    calories: round2(perServing.calories * factor),
    protein_g: round2(perServing.protein_g * factor),
    carbs_g: round2(perServing.carbs_g * factor),
    fat_g: round2(perServing.fat_g * factor),
    fiber_g: perServing.fiber_g != null ? round2(perServing.fiber_g * factor) : null,
    sugar_g: perServing.sugar_g != null ? round2(perServing.sugar_g * factor) : null,
    sodium_mg: perServing.sodium_mg != null ? round2(perServing.sodium_mg * factor) : null,
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
// `scaleRowMacros` unifies both cases: when a per100g/perServing snapshot
// exists, scale from it (unchanged behaviour). When it doesn't, derive an
// implicit "per100g" baseline from the row's CURRENT macros ÷ CURRENT amount
// and scale from that. Because the baseline is derived fresh from current
// state every time (never cached), a manual macro edit (handleMacroChange)
// automatically becomes the new baseline for the next scale — no separate
// re-baseline step needed.
//
// UNC generalization: a serving row scales the exact same way, just with
// `quantity` (servings) playing the role `grams` plays for weight rows —
// `newAmount` is newGrams for a weight row, or the new serving quantity for
// a serving row. The snapshot branch picks per100g or perServing based on
// row.basis; the "derive from current state" and freeze-guard branches below
// are basis-agnostic already (they only look at row.grams/row.quantity vs.
// newAmount), so they needed no branching at all — see the basis-based
// "current amount" pick right before the divide-by-zero guard.
//
// #219 — that "derive fresh from current state" design has one hazard: if a
// caller ever commits a row with `grams: 0` (e.g. the grams input was
// transiently emptied mid-edit and naively coerced via `parseFloat(x) || 0`),
// the row's own macros AND grams collapse to 0 in the same update, and the
// baseline this function would derive next time is gone for good — there is
// nothing left to scale from. The fix lives on the caller side: IngredientSheet
// (handleQuantityChange) never writes an empty/zero-parsed grams (or, now,
// quantity) value into row state while the user is mid-edit — it freezes the
// input's own display text locally and leaves the row (grams/quantity +
// macros) untouched, so the last real (amount, macros) pair the row holds
// keeps serving as the baseline for as long as the field sits empty, however
// long that is. The two guards below are defense-in-depth for any other
// caller (e.g. applyNewPortions) that asks to scale to/from a non-positive
// amount: freeze instead of dividing by (or scaling to) zero, so a stray 0
// can never silently zero out — and lose — a manual baseline. This applies
// identically to a serving row scaling to/from quantity <= 0.
// ---------------------------------------------------------------------------
export function scaleRowMacros(
  row: EditorRow,
  newAmount: number,
): Pick<EditorRow, 'calories' | 'protein_g' | 'carbs_g' | 'fat_g' | 'fiber_g' | 'sugar_g' | 'sodium_mg'> {
  if (row.basis === 'serving') {
    if (row.perServing) {
      return recomputeServingMacros(row.perServing, newAmount);
    }
  } else if (row.per100g) {
    return recomputeMacros(row.per100g, newAmount);
  }
  // Basis-agnostic "current amount" — grams for a weight row, quantity for a
  // serving row (grams is always null on a serving row, so it can't be used
  // as the divisor there).
  const currentAmount = row.basis === 'serving' ? row.quantity : row.grams;
  // Guard divide-by-zero (no prior amount to derive a rate from) and guard
  // scaling TO a non-positive target (#219 — would zero out, and thereby
  // destroy, the manual baseline). Either way, there's nothing sound to
  // compute — leave macros as-is rather than producing NaN/Infinity/0.
  if (!currentAmount || newAmount <= 0) {
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
  const factor = newAmount / currentAmount;
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
 *
 * Only meaningful for weight-basis foods — a serving-basis (UNC) result has
 * no gram-convertible portions at all, so callers must check
 * `food.per100g != null` before calling this (see rowFromFood).
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
 *  UNC generalization: when the food is serving-basis (per100g is null and
 *  per_serving/serving_label are set — UNC publishes no gram weight for
 *  almost any of its items), produce a serving-basis row instead: quantity=1,
 *  unitLabel = the serving label as UNC states it, grams=null. There is no
 *  "portions dropdown" for a serving-basis row — the served amount IS the
 *  serving; converting it to another unit would be fabricated (see the
 *  module doc comment).
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
  if (food.per100g == null && food.per_serving != null) {
    const perServing = food.per_serving;
    const unitLabel = food.serving_label ?? 'serving';
    const quantity = 1;
    return {
      rowKey: existingRowKey ?? nextKey(),
      basis: 'serving',
      name: food.name,
      grams: null,
      quantity,
      unitLabel,
      unitGrams: 0,
      portions: [],
      source: food.source,
      source_ref: food.source_ref,
      per100g: null,
      perServing,
      serving_qty: quantity,
      serving_label: unitLabel,
      ...recomputeServingMacros(perServing, quantity),
    };
  }

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
  // food.per100g is guaranteed non-null here (the serving-basis branch above
  // already returned for the per100g == null case).
  const per100g = food.per100g as Per100g;

  return {
    rowKey: existingRowKey ?? nextKey(),
    basis: 'weight',
    name: food.name,
    grams: effectiveGrams,
    quantity,
    unitLabel: selectedUnit.label,
    unitGrams: selectedUnit.grams,
    portions,
    source: food.source,
    source_ref: food.source_ref,
    per100g,
    perServing: null,
    ...recomputeMacros(per100g, effectiveGrams),
  };
}

/**
 * Build an EditorRow from a stored IngredientInput — e.g. an EntryRow's
 * ingredients loaded for manual-edit, or a CustomFoodRow's ingredients loaded
 * for editing/duplication. Branches on the same basis invariant as
 * rowFromFood: `grams == null` means the stored row is serving-basis
 * (UNC-style, carrying serving_qty/serving_label instead — see types.ts).
 * Used by EntryEditor and MealBuilder so both editors load stored rows the
 * same way instead of duplicating the branch at every call site.
 *
 * No live per100g/perServing snapshot is available for a stored row (only its
 * already-resolved macros are) — same as before this helper existed, any
 * further qty/unit edit is handled by scaleRowMacros's "derive baseline from
 * current macros/amount" fallback (#185).
 */
export function rowFromStoredIngredient(ing: IngredientInput): EditorRow {
  if (ing.grams == null) {
    const quantity = ing.serving_qty ?? 1;
    const unitLabel = ing.serving_label ?? 'serving';
    return {
      ...ing,
      rowKey: nextKey(),
      basis: 'serving',
      grams: null,
      quantity,
      unitLabel,
      unitGrams: 0,
      portions: [],
      fiber_g: ing.fiber_g ?? null,
      sugar_g: ing.sugar_g ?? null,
      sodium_mg: ing.sodium_mg ?? null,
      serving_qty: quantity,
      serving_label: unitLabel,
      per100g: null,
      perServing: null,
    };
  }
  return {
    ...ing,
    rowKey: nextKey(),
    basis: 'weight',
    grams: ing.grams,
    quantity: ing.grams,
    unitLabel: 'g',
    unitGrams: 1,
    portions: [GRAMS_UNIT],
    fiber_g: ing.fiber_g ?? null,
    sugar_g: ing.sugar_g ?? null,
    sodium_mg: ing.sodium_mg ?? null,
    per100g: null,
    perServing: null,
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
  // Serving-basis rows have no portions dropdown to refresh (see rowFromFood).
  if (row.basis === 'serving') return row;
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

/**
 * Turn an EditorRow into the IngredientInput payload sent to the server —
 * the single place that decides which basis to emit, so every caller
 * (EntryEditor's save/confirm paths, MealBuilder's buildPayload) emits
 * exactly one basis per row: `grams` for a weight row, `serving_qty` +
 * `serving_label` for a serving row — never both, never neither (server-
 * enforced invariant, see the ingredientInputSchema refine in
 * schemas/nutrition.ts). `scale` (default 1) is an optional macro/amount
 * multiplier for callers that batch-scale (MealBuilder's per-batch × N) —
 * it's unitless, so it applies identically to a weight row's grams or a
 * serving row's serving_qty.
 */
export function ingredientInputFromRow(r: EditorRow, scale = 1): IngredientInput {
  const base = {
    name: r.name,
    source: r.source,
    source_ref: r.source_ref ?? null,
    calories: round2(r.calories * scale),
    protein_g: round2(r.protein_g * scale),
    carbs_g: round2(r.carbs_g * scale),
    fat_g: round2(r.fat_g * scale),
    fiber_g: r.fiber_g != null ? round2(r.fiber_g * scale) : null,
    sugar_g: r.sugar_g != null ? round2(r.sugar_g * scale) : null,
    sodium_mg: r.sodium_mg != null ? round2(r.sodium_mg * scale) : null,
  };
  if (r.basis === 'serving') {
    return { ...base, grams: null, serving_qty: round2(r.quantity * scale), serving_label: r.unitLabel };
  }
  return { ...base, grams: r.grams != null ? round2(r.grams * scale) : null, serving_qty: null, serving_label: null };
}

/** Sum all rows into batch totals.
 *  Weight-basis rows contribute to the gram total as before; serving-basis
 *  rows carry `grams: null` (see EditorRow) and are skipped in that sum so a
 *  mixed batch's gram total isn't corrupted into NaN by a null. Macro sums
 *  are unaffected — every row's macros are always concrete numbers regardless
 *  of basis.
 *
 *  `hasWeight` is `true` iff at least one row carried a real (non-null) gram
 *  weight. An all-serving batch (e.g. all UNC dining items) has NO row with a
 *  derivable weight, so `grams` sums to 0 via the `?? 0` fallback above — but
 *  that 0 means "nothing to add", not "the batch weighs zero". Callers MUST
 *  check `hasWeight` before displaying `grams`: when it's `false` the true
 *  total weight is unknown/not applicable, and must be rendered as such (e.g.
 *  an em dash) — never simplified back to a bare `0g`, which would state
 *  something false. */
export function sumRows(rows: EditorRow[]) {
  return rows.reduce(
    (acc, r) => ({
      grams: acc.grams + (r.grams ?? 0),
      hasWeight: acc.hasWeight || r.grams != null,
      calories: acc.calories + r.calories,
      protein_g: acc.protein_g + r.protein_g,
      carbs_g: acc.carbs_g + r.carbs_g,
      fat_g: acc.fat_g + r.fat_g,
      fiber_g: acc.fiber_g + (r.fiber_g ?? 0),
      sugar_g: acc.sugar_g + (r.sugar_g ?? 0),
      sodium_mg: acc.sodium_mg + (r.sodium_mg ?? 0),
    }),
    { grams: 0, hasWeight: false, calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0, sugar_g: 0, sodium_mg: 0 },
  );
}
