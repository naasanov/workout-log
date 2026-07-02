// Client-side mirror of the backend contract in main/workout-log/schemas/nutrition.ts.
// Kept in sync by hand (the client is a separate Vite/TS project).

export type Meal = 'breakfast' | 'lunch' | 'dinner' | 'snack';
export type EntrySource = 'manual' | 'text' | 'photo' | 'barcode' | 'mixed' | 'custom';
export type IngredientSource = 'usda' | 'off' | 'manual' | 'custom';

export const MEALS: Meal[] = ['breakfast', 'lunch', 'dinner', 'snack'];

export interface Per100g {
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fiber_g?: number | null;
  sugar_g?: number | null;
  sodium_mg?: number | null;
}

// A household serving size, e.g. { label: "medium", grams: 118 }.
// `grams` = weight of ONE unit (effective grams = quantity * grams).
export interface FoodPortion {
  label: string;
  grams: number;
}

export interface FoodSearchResult {
  name: string;
  source: 'usda' | 'off' | 'custom';
  source_ref: string;
  per100g: Per100g;
  serving_grams?: number | null;
  // Serving sizes attached inline for the top result(s) (#8).
  portions?: FoodPortion[] | null;
  // For custom items: disambiguate food vs meal for badge display.
  kind?: 'food' | 'meal';
}

export interface IngredientInput {
  name: string;
  grams: number;
  source: IngredientSource;
  source_ref?: string | null;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  // Optional micros (Phase B — custom foods & meals)
  fiber_g?: number | null;
  sugar_g?: number | null;
  sodium_mg?: number | null;
}
export interface IngredientRow extends IngredientInput {
  id: number;
}

// A proposed ingredient: an IngredientInput plus optional serving metadata so the
// editor can pre-select a real serving ("1 medium") instead of raw grams (#10).
// `grams` is the RESOLVED effective grams (quantity * unit grams). unit==='g' = raw grams.
export interface ProposeIngredient extends IngredientInput {
  quantity?: number | null;
  unit?: string | null;
  portions?: FoodPortion[] | null;
}

// What the agent's propose_entry tool emits (no localDate; serving-aware rows).
// `notes` is OPTIONAL — populated ONLY when the AI needs to explain a confusing
// or non-obvious choice (e.g. odd decimal grams, ambiguous food selection). Must
// NOT be an always-present summary.
export interface ProposeEntryArgs {
  meal: Meal;
  name: string;
  source: EntrySource;
  barcode?: string | null;
  raw_llm_json?: unknown;
  ingredients: ProposeIngredient[];
  notes?: string | null;
}

export interface EntryInput {
  localDate: string; // YYYY-MM-DD
  meal: Meal;
  name: string;
  source: EntrySource;
  barcode?: string | null;
  raw_llm_json?: unknown;
  ingredients: IngredientInput[];
  // Provenance for entries logged from a custom food/meal (non-authoritative).
  from_custom_food_id?: number | null;
}

export interface EntryRow {
  id: number;
  date: string; // YYYY-MM-DD
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

export interface Goals {
  calories?: number | null;
  protein_g?: number | null;
  carbs_g?: number | null;
  fat_g?: number | null;
}

// ---- EntryEditor props contract (S2 implements the component) ----
// Phase 1 implements 'manual-add' and 'manual-edit'. 'proposal' is wired in Phase 2.
export type EntryEditorMode =
  | { kind: 'manual-add'; date: string; defaultMeal?: Meal }
  | { kind: 'manual-edit'; date: string; entry: EntryRow }
  | { kind: 'proposal'; date: string; proposal: ProposeEntryArgs };

// ---- Custom Foods & Meals (Phase B — mirrors schemas/nutrition.ts) ----

/** A user-defined serving size (by grams or fraction of batch). */
export interface CustomServing {
  id?: number;
  label: string;
  def_type: 'grams' | 'fraction';
  def_value: number;
  grams: number;
  sort_order?: number;
}

/** Payload for creating or updating a custom food/meal. */
export interface CustomFoodInput {
  kind: 'food' | 'meal';
  name: string;
  notes?: string | null;
  status: 'draft' | 'saved';
  ingredients: IngredientInput[];
  servings: CustomServing[];
}

/** A custom food/meal row returned from the server. */
export interface CustomFoodRow {
  id: number;
  kind: 'food' | 'meal';
  status: 'draft' | 'saved';
  name: string;
  notes?: string | null;
  total_grams: number;
  // Batch macros
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fiber_g?: number | null;
  sugar_g?: number | null;
  sodium_mg?: number | null;
  // Derived per-100g macros
  per100g: Per100g;
  // Resolved ingredients (with ids)
  ingredients: (IngredientInput & { id: number })[];
  // Resolved servings (with ids and sort_order)
  servings: (CustomServing & { id: number; sort_order: number })[];
  created_at: string;
  updated_at: string;
}

export interface EntryEditorProps {
  // `open` is ignored when `inline` is true (the editor renders in-flow in the
  // chat thread for proposals, #9 — no Dialog overlay).
  open: boolean;
  inline?: boolean;
  mode: EntryEditorMode;
  onClose: () => void;
  // Manual modes save via the api hooks internally, then call onClose.
  // Proposal mode calls these instead of saving directly. onConfirm resolves the
  // serving-aware proposal rows to grams-based EntryInput before persisting.
  onConfirm?: (input: EntryInput) => void;
  onDeny?: () => void;
}
