// Type-only re-exports of the server's nutrition contract (see shared/nutrition.ts).
// `import type` here and at every call site keeps zod and the server's validation
// logic out of the client bundle. Client-only UI types are declared below.
export type {
  Meal,
  EntrySource,
  IngredientSource,
  Per100g,
  FoodPortion,
  FoodSearchResult,
  IngredientInput,
  IngredientRow,
  ProposeIngredient,
  ProposeEntryArgs,
  EntryInput,
  EntryRow,
  DayTotals,
  DayResponse,
  Goals,
  CustomServing,
  CustomFoodInput,
  ProposeCustomFoodIngredient,
  ProposeCustomFoodServing,
  ProposeCustomFoodArgs,
  CustomFoodRow,
} from '../../../../shared/nutrition';

import type {
  Meal,
  EntryRow,
  EntryInput,
  ProposeEntryArgs,
  FoodSearchResult,
} from '../../../../shared/nutrition';

export const MEALS: Meal[] = ['breakfast', 'lunch', 'dinner', 'snack'];

export const MEAL_LABELS: Record<Meal, string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
  snack: 'Snack / Other',
};

// ---- Barcode chat attachment (a scanned barcode attached to a chat message) ----
// The screenshot (`imageDataUrl`) is UI-ONLY — it renders as the chip thumbnail
// and the tap-to-preview card, but is NEVER sent to the model as vision. Only
// `product` (structured per-100g macros from Open Food Facts) is fed to the
// agent, injected server-side as a pre-fetched tool-result (see
// services/nutrition/agent.ts) since the `lookup_barcode` tool was removed.
export interface BarcodeAttachmentData {
  code: string;
  imageDataUrl?: string | null;
  product: FoodSearchResult;
  // Set by the nightly chat-image retention job (scripts/redactOldChatImages.js)
  // when it strips `imageDataUrl` out of an old (2+ days) transcript row.
  // `imageDataUrl` will be null when this is true; the flag lets the UI show
  // a "photo no longer available" note instead of silently having no image.
  imageRedacted?: boolean;
}

// ---- Redacted image marker part ----
// Replaces a chat `file` part (image/*) whose base64 data URI was stripped by
// the nightly retention job (scripts/redactOldChatImages.js) once the message
// is 2+ days old. `mediaType` is preserved from the original part purely for
// display purposes (e.g. so the UI could say "photo" vs "image" if desired).
export interface ImageRedactedData {
  mediaType: string;
}

// ---- EntryEditor props contract (S2 implements the component) ----
// Phase 1 implements 'manual-add' and 'manual-edit'. 'proposal' is wired in Phase 2.
export type EntryEditorMode =
  | { kind: 'manual-add'; date: string; defaultMeal?: Meal }
  | { kind: 'manual-edit'; date: string; entry: EntryRow }
  | { kind: 'proposal'; date: string; proposal: ProposeEntryArgs };

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
