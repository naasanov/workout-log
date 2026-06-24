// Client-side mirror of the backend contract in main/workout-log/schemas/nutrition.ts.
// Kept in sync by hand (the client is a separate Vite/TS project).

export type Meal = 'breakfast' | 'lunch' | 'dinner' | 'snack';
export type EntrySource = 'manual' | 'text' | 'photo' | 'barcode' | 'mixed';
export type IngredientSource = 'usda' | 'off' | 'manual';

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

export interface FoodSearchResult {
  name: string;
  source: 'usda' | 'off';
  source_ref: string;
  per100g: Per100g;
  serving_grams?: number | null;
}

// A household serving size, e.g. { label: "medium", grams: 118 }.
// `grams` = weight of ONE unit (effective grams = quantity * grams).
export interface FoodPortion {
  label: string;
  grams: number;
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
}
export interface IngredientRow extends IngredientInput {
  id: number;
}

export interface EntryInput {
  localDate: string; // YYYY-MM-DD
  meal: Meal;
  name: string;
  source: EntrySource;
  barcode?: string | null;
  raw_llm_json?: unknown;
  ingredients: IngredientInput[];
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
  | { kind: 'proposal'; date: string; proposal: EntryInput };

export interface EntryEditorProps {
  open: boolean;
  mode: EntryEditorMode;
  onClose: () => void;
  // Manual modes save via the api hooks internally, then call onClose.
  // Proposal mode (Phase 2) calls these instead of saving directly:
  onConfirm?: (input: EntryInput) => void;
  onDeny?: () => void;
}
