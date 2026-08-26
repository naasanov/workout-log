// Shared contract for the Nutrition feature: zod request schemas + TypeScript
// row/response types. Backend validates requests with these; the client mirrors
// the types in client/src/features/nutrition/types.ts (kept in sync by hand —
// the two npm projects don't share a tsconfig).
import { z } from 'zod';

export const MEALS = ['breakfast', 'lunch', 'dinner', 'snack'] as const;
export const ENTRY_SOURCES = ['manual', 'text', 'photo', 'barcode', 'mixed', 'custom'] as const;
export const INGREDIENT_SOURCES = ['usda', 'off', 'manual', 'custom', 'unc'] as const;

// Per-100g nutrient profile returned by food search / barcode lookup. Also reused
// (despite the name) as the plain nutrient-bundle shape for `per_serving` below,
// since a serving's nutrients are the same six fields, just not normalized to 100g.
export const per100gSchema = z.object({
  calories: z.number().nonnegative(),
  protein_g: z.number().nonnegative(),
  carbs_g: z.number().nonnegative(),
  fat_g: z.number().nonnegative(),
  fiber_g: z.number().nonnegative().nullable().optional(),
  sugar_g: z.number().nonnegative().nullable().optional(),
  sodium_mg: z.number().nonnegative().nullable().optional(),
});

// Shared cross-field check for the exactly-one-basis invariant (weight OR serving,
// never both, never neither). Used by ingredientInputSchema and every schema that
// extends it (proposeIngredientSchema, proposeCustomFoodIngredientSchema, the
// ingredients array in customFoodRowSchema) so the invariant can't be bypassed by
// going through one of those instead of the base schema.
function checkIngredientBasis(
  val: { grams?: number | null; serving_qty?: number | null; serving_label?: string | null },
  ctx: z.RefinementCtx,
): void {
  const hasGrams = val.grams != null;
  const hasServingQty = val.serving_qty != null;
  const hasServingLabel = val.serving_label != null;
  const hasServing = hasServingQty || hasServingLabel;

  if (hasGrams && hasServing) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Ingredient row must not set both grams (weight basis) and serving_qty/serving_label (serving basis) — exactly one basis is required.',
      path: ['grams'],
    });
  } else if (!hasGrams && !hasServing) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Ingredient row must set either grams (weight basis) or serving_qty + serving_label (serving basis).',
      path: ['grams'],
    });
  } else if (hasServing && (!hasServingQty || !hasServingLabel)) {
    // Serving basis chosen but incomplete — UNC (and any future serving source)
    // has no gram equivalent, so a half-filled serving basis is unusable: name
    // which specific field is missing rather than a generic "invalid" error.
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: hasServingQty
        ? 'Serving basis requires serving_label (in addition to serving_qty) to be set.'
        : 'Serving basis requires serving_qty (in addition to serving_label) to be set.',
      path: hasServingQty ? ['serving_label'] : ['serving_qty'],
    });
  }
}

// One ingredient row as sent by the client. Macros are the contribution at
// `grams` (client computes per100g * grams/100, or types them for manual rows) —
// OR, for a serving-basis row (UNC dining, #? — see migrations/018_unc_dining.sql),
// the contribution of `serving_qty` servings of `serving_label` as published by
// the source, with `grams` left null since no gram weight exists to derive from.
export const ingredientInputSchema = z
  .object({
    name: z.string().min(1).max(255),
    grams: z.number().positive().nullable().optional(),
    source: z.enum(INGREDIENT_SOURCES),
    source_ref: z.string().max(64).nullable().optional(),
    calories: z.number().nonnegative(),
    protein_g: z.number().nonnegative(),
    carbs_g: z.number().nonnegative(),
    fat_g: z.number().nonnegative(),
    // Optional micros — carried so meal snapshots and entry totals can sum them.
    fiber_g: z.number().nonnegative().nullable().optional(),
    sugar_g: z.number().nonnegative().nullable().optional(),
    sodium_mg: z.number().nonnegative().nullable().optional(),
    // Serving basis: an alternative to `grams` for foods with no gram weight
    // (e.g. UNC's "1/2 cup", "1 each"). See checkIngredientBasis above for the
    // exactly-one-basis invariant this row must satisfy.
    serving_qty: z.number().positive().nullable().optional(),
    serving_label: z.string().max(64).nullable().optional(),
  })
  .superRefine(checkIngredientBasis);

// Create/replace an entry (POST /entries, PATCH /entries/:id share this shape).
export const entryInputSchema = z.object({
  localDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  meal: z.enum(MEALS),
  name: z.string().min(1).max(255),
  source: z.enum(ENTRY_SOURCES),
  barcode: z.string().max(32).nullable().optional(),
  raw_llm_json: z.unknown().nullable().optional(),
  // Provenance: set when this entry was logged from a custom food/meal so that
  // recentCustomFoods (which INNER JOINs on this column) can populate.
  from_custom_food_id: z.number().int().positive().nullable().optional(),
  ingredients: z.array(ingredientInputSchema).min(1),
});

// PUT /goals — every field optional/nullable (clear a goal by sending null).
export const goalsSchema = z.object({
  calories: z.number().nonnegative().nullable().optional(),
  protein_g: z.number().nonnegative().nullable().optional(),
  carbs_g: z.number().nonnegative().nullable().optional(),
  fat_g: z.number().nonnegative().nullable().optional(),
  fiber_g: z.number().nonnegative().nullable().optional(),
});

export const foodSearchResultSchema = z
  .object({
    name: z.string(),
    source: z.enum(['usda', 'off', 'custom', 'unc']),
    source_ref: z.string(),
    // Weight basis: per-100g nutrients, for USDA/OFF/custom results. Nullable
    // because UNC results carry `per_serving` instead — see the refine below.
    per100g: per100gSchema.nullable(),
    // Serving basis (UNC dining): nutrients for ONE serving as published by the
    // source, with no gram equivalent. Reuses per100gSchema's nutrient shape.
    per_serving: per100gSchema.nullable().optional(),
    // Display label for the serving per_serving is measured in (e.g. "1/2 cup").
    // Only meaningful alongside per_serving.
    serving_label: z.string().nullable().optional(),
    serving_grams: z.number().positive().nullable().optional(),
    // Household serving sizes, attached inline for the top result(s) so the agent
    // can propose real servings without a separate get_portions call (#8). May be
    // omitted/empty when not (yet) fetched; the foodPortionSchema is defined below.
    portions: z
      .array(z.object({ label: z.string(), grams: z.number().positive() }))
      .nullable()
      .optional(),
    // Disambiguates custom food vs custom meal for badge display / meal-expansion
    // gating in the client. Optional/nullable because only source: 'custom' results
    // have a kind — USDA and Open Food Facts results (providers.ts) never set it.
    kind: z.enum(['food', 'meal']).nullable().optional(),
  })
  .superRefine((val, ctx) => {
    const hasPer100g = val.per100g != null;
    const hasPerServing = val.per_serving != null;
    if (hasPer100g && hasPerServing) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Food search result must not set both per100g and per_serving — exactly one basis is required.',
        path: ['per100g'],
      });
    } else if (!hasPer100g && !hasPerServing) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Food search result must set exactly one of per100g (weight basis) or per_serving (serving basis).',
        path: ['per100g'],
      });
    }
  });

export type Meal = (typeof MEALS)[number];
export type EntrySource = (typeof ENTRY_SOURCES)[number];
export type IngredientSource = (typeof INGREDIENT_SOURCES)[number];
export type Per100g = z.infer<typeof per100gSchema>;
export type IngredientInput = z.infer<typeof ingredientInputSchema>;
export type EntryInput = z.infer<typeof entryInputSchema>;
export type Goals = z.infer<typeof goalsSchema>;

// A household serving size for a food, e.g. { label: "medium", grams: 118 }.
// `grams` is the weight of ONE of this unit (so effective grams = quantity * grams).
export const foodPortionSchema = z.object({
  label: z.string(),
  grams: z.number().positive(),
});
export type FoodPortion = z.infer<typeof foodPortionSchema>;

// A proposed ingredient (what `propose_entry` emits per row): an ingredientInput
// PLUS optional serving metadata so the editor can pre-select a real household
// serving ("1 medium") instead of raw grams:
//   - quantity + unit: the chosen serving (e.g. 1 "medium"); `grams` stays the
//     RESOLVED effective grams (quantity * the unit's grams) used for macro math.
//   - portions: the available serving options for this food, so the editor's unit
//     dropdown is populated without an extra fetch. unit === 'g' means raw grams.
// On confirm the editor resolves rows back to plain ingredientInput (grams-based).
export const proposeIngredientSchema = ingredientInputSchema.extend({
  quantity: z.number().positive().nullable().optional(),
  unit: z.string().max(64).nullable().optional(),
  portions: z.array(foodPortionSchema).nullable().optional(),
});
export type ProposeIngredient = z.infer<typeof proposeIngredientSchema>;

// What the agent's `propose_entry` tool emits — a full entry MINUS localDate
// (the client supplies the selected day on confirm), with serving-aware ingredients.
// Rendered as the EntryEditor in proposal mode; on confirm the client adds
// localDate -> EntryInput -> POST /entries.
//
// `notes` is OPTIONAL and should be populated ONLY when the AI needs to explain
// a confusing or non-obvious choice (e.g. why odd decimal grams were used, or
// why a particular database entry was selected over others). It must NOT be an
// always-on summary of the proposal.
export const proposeEntryArgsSchema = entryInputSchema
  .omit({ localDate: true, ingredients: true })
  .extend({
    ingredients: z.array(proposeIngredientSchema).min(1),
    notes: z.string().max(400).nullable().optional(),
  });
export type ProposeEntryArgs = z.infer<typeof proposeEntryArgsSchema>;
export type FoodSearchResult = z.infer<typeof foodSearchResultSchema>;

// ---- Custom Foods & Meals schemas ----

// What the agent's `propose_custom_food` tool emits — a full builder payload for
// creating a custom food or meal. Echoed back as output so the client can render
// an inline proposal card. The user reviews/edits and confirms; the client POSTs
// to /nutrition/custom-foods on confirm (agent does NOT write to DB).
//
// Serving definitions carry def_type + def_value; grams resolution happens on save.
// The agent may include any field the human builder can set (full parity).
export const proposeCustomFoodIngredientSchema = ingredientInputSchema.extend({
  // Optional serving metadata so the builder can pre-select a real household serving
  quantity: z.number().positive().nullable().optional(),
  unit: z.string().max(64).nullable().optional(),
  portions: z.array(foodPortionSchema).nullable().optional(),
});
export type ProposeCustomFoodIngredient = z.infer<typeof proposeCustomFoodIngredientSchema>;

export const proposeCustomFoodServingSchema = z.object({
  label: z.string().min(1).max(64),
  def_type: z.enum(['grams', 'fraction']),
  def_value: z.number().positive(),
});
export type ProposeCustomFoodServing = z.infer<typeof proposeCustomFoodServingSchema>;

export const proposeCustomFoodArgsSchema = z.object({
  kind: z.enum(['food', 'meal']),
  name: z.string().min(1).max(255),
  notes: z.string().max(1000).nullable().optional(),
  ingredients: z.array(proposeCustomFoodIngredientSchema),
  servings: z.array(proposeCustomFoodServingSchema),
});
export type ProposeCustomFoodArgs = z.infer<typeof proposeCustomFoodArgsSchema>;

/** One custom serving definition stored alongside a custom food/meal. */
export const customServingSchema = z.object({
  label: z.string().min(1).max(64),
  def_type: z.enum(['grams', 'fraction']),
  def_value: z.number().positive(),
  grams: z.number().positive(),
});
export type CustomServing = z.infer<typeof customServingSchema>;

/** Input payload for creating or updating a custom food/meal. */
export const customFoodInputSchema = z.object({
  kind: z.enum(['food', 'meal']),
  name: z.string().min(1).max(255),
  notes: z.string().max(1000).nullable().optional(),
  status: z.enum(['draft', 'saved']),
  ingredients: z.array(ingredientInputSchema),
  servings: z.array(customServingSchema),
});
export type CustomFoodInput = z.infer<typeof customFoodInputSchema>;

/** The persisted custom food/meal row returned to the client. */
export const customFoodRowSchema = z.object({
  id: z.number().int().positive(),
  kind: z.enum(['food', 'meal']),
  status: z.enum(['draft', 'saved']),
  name: z.string(),
  notes: z.string().nullable(),
  // Null when the batch can't produce a meaningful total weight — i.e. it
  // contains at least one serving-basis ingredient (no gram equivalent), so
  // summing grams across rows would understate the true batch weight rather
  // than represent it. See services/nutrition/store.ts sumIngredientsFull.
  total_grams: z.number().nonnegative().nullable(),
  calories: z.number().nonnegative(),
  protein_g: z.number().nonnegative(),
  carbs_g: z.number().nonnegative(),
  fat_g: z.number().nonnegative(),
  fiber_g: z.number().nullable(),
  sugar_g: z.number().nullable(),
  sodium_mg: z.number().nullable(),
  // Null alongside a null total_grams, for the same reason — a per-100g rate
  // is meaningless without a known total batch weight.
  per100g: per100gSchema.nullable(),
  ingredients: z.array(ingredientInputSchema.extend({ id: z.number() })),
  servings: z.array(customServingSchema.extend({ id: z.number(), sort_order: z.number() })),
  created_at: z.string(),
  updated_at: z.string(),
});
export type CustomFoodRow = z.infer<typeof customFoodRowSchema>;

// ---- Proposal resolutions (#186) ----
// Server-side record of accept/deny state for propose_entry / propose_custom_food
// cards, so a refetched transcript doesn't re-render an already-resolved proposal
// as actionable. Keyed by toolCallId (see NutritionChat.tsx's ProposalResolutions).
export const proposalResolutionInputSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  toolCallId: z.string().min(1).max(64),
  kind: z.enum(['entry', 'custom_food']),
  status: z.enum(['confirmed', 'denied']),
  displayName: z.string().max(255).nullable().optional(),
});
export type ProposalResolutionInput = z.infer<typeof proposalResolutionInputSchema>;

// ---- DB row / response shapes returned to the client ----
export interface IngredientRow extends IngredientInput {
  id: number;
}
export interface EntryRow {
  id: number;
  date: string; // YYYY-MM-DD (normalize mysql2 DATE with String(x).slice(0,10))
  logged_at: string;
  meal: Meal;
  name: string;
  source: EntrySource;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fiber_g: number | null;
  sugar_g: number | null;
  sodium_mg: number | null;
  barcode: string | null;
  ingredients: IngredientRow[];
}
export interface DayTotals {
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fiber_g: number;
  sugar_g: number;
  sodium_mg: number;
}
export interface DayResponse {
  date: string;
  totals: DayTotals;
  entries: EntryRow[];
}
