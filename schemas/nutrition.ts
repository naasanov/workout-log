// Shared contract for the Nutrition feature: zod request schemas + TypeScript
// row/response types. Backend validates requests with these; the client mirrors
// the types in client/src/features/nutrition/types.ts (kept in sync by hand —
// the two npm projects don't share a tsconfig).
import { z } from 'zod';

export const MEALS = ['breakfast', 'lunch', 'dinner', 'snack'] as const;
export const ENTRY_SOURCES = ['manual', 'text', 'photo', 'barcode', 'mixed'] as const;
export const INGREDIENT_SOURCES = ['usda', 'off', 'manual'] as const;

// Per-100g nutrient profile returned by food search / barcode lookup.
export const per100gSchema = z.object({
  calories: z.number().nonnegative(),
  protein_g: z.number().nonnegative(),
  carbs_g: z.number().nonnegative(),
  fat_g: z.number().nonnegative(),
  fiber_g: z.number().nonnegative().nullable().optional(),
  sugar_g: z.number().nonnegative().nullable().optional(),
  sodium_mg: z.number().nonnegative().nullable().optional(),
});

// One ingredient row as sent by the client. Macros are the contribution at
// `grams` (client computes per100g * grams/100, or types them for manual rows).
export const ingredientInputSchema = z.object({
  name: z.string().min(1).max(255),
  grams: z.number().positive(),
  source: z.enum(INGREDIENT_SOURCES),
  source_ref: z.string().max(64).nullable().optional(),
  calories: z.number().nonnegative(),
  protein_g: z.number().nonnegative(),
  carbs_g: z.number().nonnegative(),
  fat_g: z.number().nonnegative(),
});

// Create/replace an entry (POST /entries, PATCH /entries/:id share this shape).
export const entryInputSchema = z.object({
  localDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  meal: z.enum(MEALS),
  name: z.string().min(1).max(255),
  source: z.enum(ENTRY_SOURCES),
  barcode: z.string().max(32).nullable().optional(),
  raw_llm_json: z.unknown().nullable().optional(),
  ingredients: z.array(ingredientInputSchema).min(1),
});

// PUT /goals — every field optional/nullable (clear a goal by sending null).
export const goalsSchema = z.object({
  calories: z.number().nonnegative().nullable().optional(),
  protein_g: z.number().nonnegative().nullable().optional(),
  carbs_g: z.number().nonnegative().nullable().optional(),
  fat_g: z.number().nonnegative().nullable().optional(),
});

export const foodSearchResultSchema = z.object({
  name: z.string(),
  source: z.enum(['usda', 'off']),
  source_ref: z.string(),
  per100g: per100gSchema,
  serving_grams: z.number().positive().nullable().optional(),
  // Household serving sizes, attached inline for the top result(s) so the agent
  // can propose real servings without a separate get_portions call (#8). May be
  // omitted/empty when not (yet) fetched; the foodPortionSchema is defined below.
  portions: z
    .array(z.object({ label: z.string(), grams: z.number().positive() }))
    .nullable()
    .optional(),
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
