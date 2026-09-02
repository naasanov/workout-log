/**
 * EntryEditor — Phase 1 + Phase 2 (inline proposal, serving pre-select)
 * Handles 'manual-add', 'manual-edit', and 'proposal' modes.
 *
 * Phase 2 additions:
 * - `inline` prop: when true, renders without the Radix Dialog overlay (#9)
 * - Proposal mode: pre-selects quantity/unit from ProposeIngredient data (#10)
 * - On Confirm: resolves serving-aware rows to grams-based EntryInput (#10)
 */
import {
  useState,
  useCallback,
  useEffect,
  useMemo,
} from 'react';
import Modal from '../../components/Modal.jsx';
import { useCreateEntry, useUpdateEntry } from './api';
import type {
  EntryEditorProps,
  Meal,
  IngredientInput,
  IngredientSource,
  EntryInput,
  FoodPortion,
  ProposeIngredient,
} from './types';
import { MEALS, MEAL_LABELS } from './types';
import styles from './EntryEditor.module.scss';
import { Plus, X } from 'lucide-react';
import IngredientSheet, { IngredientCardList } from './IngredientSheet';
import {
  GRAMS_UNIT,
  type EditorRow,
  nextKey,
  emptyRow,
  round2,
  sumRows,
  rowFromStoredIngredient,
  ingredientInputFromRow,
} from './ingredientMath';

// ---------------------------------------------------------------------------
// #10: Build an EditorRow from a ProposeIngredient (serving-aware).
// The proposal carries quantity/unit/portions so we can pre-select them.
// ing.grams is already the resolved effective grams (quantity * unitGrams) —
// for a WEIGHT proposal. A UNC (serving-basis) proposal instead sets
// grams: null and carries serving_qty/serving_label directly (see the agent's
// propose_entry contract in services/nutrition/agent.ts) — there's no
// "resolved grams" to fall back on for those, and none is needed since the
// serving IS the amount.
// ---------------------------------------------------------------------------
function rowFromProposedIngredient(ing: ProposeIngredient): EditorRow {
  if (ing.grams == null) {
    // Serving basis: quantity = serving_qty as proposed, unitLabel = the
    // serving label exactly as the source stated it. No portions dropdown —
    // there's no gram weight to convert against (see ingredientMath's
    // rowFromFood, which applies the same rule to a search-selected UNC food).
    const quantity = ing.serving_qty ?? 1;
    const unitLabel = ing.serving_label ?? 'serving';
    return {
      rowKey: nextKey(),
      basis: 'serving',
      name: ing.name,
      grams: null,
      quantity,
      unitLabel,
      unitGrams: 0,
      portions: [],
      source: ing.source,
      source_ref: ing.source_ref ?? null,
      calories: ing.calories,
      protein_g: ing.protein_g,
      carbs_g: ing.carbs_g,
      fat_g: ing.fat_g,
      fiber_g: ing.fiber_g ?? null,
      sugar_g: ing.sugar_g ?? null,
      sodium_mg: ing.sodium_mg ?? null,
      serving_qty: quantity,
      serving_label: unitLabel,
      // Macros already resolved by the agent; no perServing snapshot needed
      // for live recompute (matches the weight branch's per100g: null below).
      per100g: null,
      perServing: null,
    };
  }

  // Build the portions list: always start with 'g', then any proposal portions.
  const portionsList: FoodPortion[] = [GRAMS_UNIT];
  if (ing.portions && ing.portions.length > 0) {
    for (const p of ing.portions) {
      if (p.label !== 'g') portionsList.push(p);
    }
  }

  // Find the proposed unit in the portions list.
  const proposedUnit = ing.unit ? portionsList.find(p => p.label === ing.unit) : null;

  let quantity: number;
  let unitLabel: string;
  let unitGrams: number;

  if (proposedUnit && ing.quantity != null && ing.quantity > 0) {
    // Pre-select the agent-specified serving unit and quantity.
    quantity = ing.quantity;
    unitLabel = proposedUnit.label;
    unitGrams = proposedUnit.grams;
  } else {
    // Fallback: raw grams mode (unit='g', quantity=grams).
    quantity = ing.grams;
    unitLabel = 'g';
    unitGrams = 1;
  }

  return {
    rowKey: nextKey(),
    basis: 'weight',
    name: ing.name,
    grams: ing.grams, // effective grams already resolved by the agent
    quantity,
    unitLabel,
    unitGrams,
    portions: portionsList,
    source: ing.source,
    source_ref: ing.source_ref ?? null,
    calories: ing.calories,
    protein_g: ing.protein_g,
    carbs_g: ing.carbs_g,
    fat_g: ing.fat_g,
    fiber_g: ing.fiber_g ?? null,
    sugar_g: ing.sugar_g ?? null,
    sodium_mg: ing.sodium_mg ?? null,
    // Macros already resolved; no per100g needed for live recompute.
    per100g: null,
    perServing: null,
  };
}

// ---------------------------------------------------------------------------
// #313: localStorage draft — 'manual-add' only.
// 'manual-edit' already has a persisted entry to fall back on and 'proposal'
// is regenerable from the agent, so neither is drafted here: a stale draft
// silently overriding either would be a worse bug than the one this fixes.
// ---------------------------------------------------------------------------
const DRAFT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function draftKey(date: string): string {
  return `peak.entryDraft.manual-add.${date}`;
}

interface StoredEntryDraft {
  savedAt: number;
  meal: Meal;
  entryName: string;
  ingredients: IngredientInput[];
}

interface RestoredDraft {
  meal: Meal;
  entryName: string;
  rows: EditorRow[];
}

const INGREDIENT_SOURCES: IngredientSource[] = ['usda', 'off', 'manual', 'custom', 'unc'];

// Rebuilds one IngredientInput from parsed JSON. The stored value may be
// corrupt or from an older shape, so every field is type-checked before use
// rather than trusting the cast — a malformed row would otherwise crash render.
function validateDraftIngredient(x: unknown): IngredientInput | null {
  if (typeof x !== 'object' || x === null) return null;
  const r = x as Record<string, unknown>;
  if (typeof r.name !== 'string') return null;
  if (r.grams !== null && typeof r.grams !== 'number') return null;
  if (typeof r.source !== 'string' || !INGREDIENT_SOURCES.includes(r.source as IngredientSource)) return null;
  if (
    typeof r.calories !== 'number' ||
    typeof r.protein_g !== 'number' ||
    typeof r.carbs_g !== 'number' ||
    typeof r.fat_g !== 'number'
  ) return null;
  return {
    name: r.name,
    grams: (r.grams as number | null) ?? null,
    source: r.source as IngredientSource,
    source_ref: typeof r.source_ref === 'string' ? r.source_ref : null,
    calories: r.calories,
    protein_g: r.protein_g,
    carbs_g: r.carbs_g,
    fat_g: r.fat_g,
    fiber_g: typeof r.fiber_g === 'number' ? r.fiber_g : null,
    sugar_g: typeof r.sugar_g === 'number' ? r.sugar_g : null,
    sodium_mg: typeof r.sodium_mg === 'number' ? r.sodium_mg : null,
    serving_qty: typeof r.serving_qty === 'number' ? r.serving_qty : null,
    serving_label: typeof r.serving_label === 'string' ? r.serving_label : null,
  };
}

// Reads and validates the draft for `date`. Returns null for anything
// missing, expired, malformed, or pristine (no real content) so callers
// never special-case "nothing to restore" — try/catch keeps a broken
// localStorage (Safari private mode, corrupt JSON) from breaking the editor.
function loadDraft(date: string): RestoredDraft | null {
  try {
    const raw = localStorage.getItem(draftKey(date));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return null;
    const p = parsed as Record<string, unknown>;
    if (typeof p.savedAt !== 'number' || Date.now() - p.savedAt > DRAFT_MAX_AGE_MS) return null;
    if (typeof p.meal !== 'string' || !MEALS.includes(p.meal as Meal)) return null;
    if (typeof p.entryName !== 'string') return null;
    if (!Array.isArray(p.ingredients)) return null;
    const validated = p.ingredients.map(validateDraftIngredient);
    if (validated.some(v => v === null)) return null;
    const ingredients = validated as IngredientInput[];

    const isEmpty = !p.entryName.trim() && ingredients.every(i => !i.name.trim());
    if (isEmpty) return null;

    return {
      meal: p.meal as Meal,
      entryName: p.entryName,
      rows: ingredients.length > 0 ? ingredients.map(rowFromStoredIngredient) : [emptyRow()],
    };
  } catch {
    return null;
  }
}

// Writes the current form state as a draft, or clears it when the form is
// still pristine (an untitled entry with no named ingredients) so an
// immediately-closed editor never leaves a confusing empty draft behind.
// Serializes the draft's CONTENT only, with no timestamp. The result is a
// plain string, so an unchanged form yields an identical value and the
// autosave debounce below settles instead of re-arming on object identity.
function serializeDraftContent(meal: Meal, entryName: string, rows: EditorRow[]): string | null {
  try {
    const isEmpty = !entryName.trim() && rows.every(r => !r.name.trim());
    if (isEmpty) return null;
    return JSON.stringify({
      meal,
      entryName,
      ingredients: rows.map(r => ingredientInputFromRow(r)),
    });
  } catch {
    return null;
  }
}

// Stamps `savedAt` at write time, keeping it out of the serialized content so
// it can't make an otherwise-identical draft look changed.
function writeDraft(date: string, contentJson: string | null) {
  try {
    if (contentJson === null) {
      localStorage.removeItem(draftKey(date));
      return;
    }
    const content = JSON.parse(contentJson) as Omit<StoredEntryDraft, 'savedAt'>;
    const stored: StoredEntryDraft = { savedAt: Date.now(), ...content };
    localStorage.setItem(draftKey(date), JSON.stringify(stored));
  } catch {
    // Best-effort only — a full or blocked localStorage must never break the editor.
  }
}

function clearDraft(date: string) {
  try {
    localStorage.removeItem(draftKey(date));
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// Debounce hook (used for draft autosave, #313) — same local pattern as
// MealBuilder.tsx / IngredientSheet.tsx.
// ---------------------------------------------------------------------------
function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

// ---------------------------------------------------------------------------
// Totals bar
// ---------------------------------------------------------------------------
interface TotalsProps {
  rows: EditorRow[];
}

function Totals({ rows }: TotalsProps) {
  // sumRows (ingredientMath) already skips null grams from serving-basis rows
  // so a mixed batch's gram total isn't corrupted into NaN.
  const totals = sumRows(rows);

  return (
    <div className={styles.totals}>
      <span className={styles.totalsLabel}>Total</span>
      <span className={styles.totalsStat}>
        {/* No row carries a real weight (all-serving entry, e.g. UNC dining
            items) — the true total weight is unknown/not applicable, not 0.
            Show an em dash so this can't be misread as "0g of food" or as a
            bug in the macro math below. Don't "simplify" this back to
            `round2(totals.grams)}g` — see hasWeight's doc comment. */}
        {totals.hasWeight ? <><strong>{round2(totals.grams)}</strong>g</> : <strong>—</strong>}
      </span>
      <span className={styles.totalsStat}>
        <strong>{Math.round(totals.calories)}</strong> kcal
      </span>
      <span className={styles.totalsStat}>
        <strong>{round2(totals.protein_g)}</strong>g prot
      </span>
      <span className={styles.totalsStat}>
        <strong>{round2(totals.carbs_g)}</strong>g carbs
      </span>
      <span className={styles.totalsStat}>
        <strong>{round2(totals.fat_g)}</strong>g fat
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export default function EntryEditor({
  open,
  inline,
  mode,
  onClose,
  onConfirm,
  onDeny,
}: EntryEditorProps) {
  const isEdit = mode.kind === 'manual-edit';
  const date = mode.date;
  const isManualAdd = mode.kind === 'manual-add';

  // #313: read the manual-add draft (if any) once per mount — the lazy
  // initializers below all read from this single computed value so a
  // restored draft's meal/name/rows land together, not piecemeal.
  const [initialDraft] = useState<RestoredDraft | null>(() =>
    isManualAdd ? loadDraft(date) : null,
  );

  // ----- Meal selector -----
  const [meal, setMeal] = useState<Meal>(() => {
    if (mode.kind === 'manual-edit') return mode.entry.meal;
    // #200: default new manually-created foods to Snack / Other instead of Breakfast.
    if (mode.kind === 'manual-add') return initialDraft?.meal ?? mode.defaultMeal ?? 'snack';
    return mode.proposal.meal;
  });

  // ----- Entry name -----
  const [entryName, setEntryName] = useState<string>(() => {
    if (mode.kind === 'manual-edit') return mode.entry.name;
    if (mode.kind === 'proposal') return mode.proposal.name;
    if (mode.kind === 'manual-add') return initialDraft?.entryName ?? '';
    return '';
  });

  // ----- Ingredient rows -----
  const [rows, setRows] = useState<EditorRow[]>(() => {
    if (mode.kind === 'manual-edit') {
      return mode.entry.ingredients.map(rowFromStoredIngredient);
    }
    if (mode.kind === 'proposal') {
      // #10: pre-select serving unit/quantity from ProposeIngredient
      return mode.proposal.ingredients.map(rowFromProposedIngredient);
    }
    if (mode.kind === 'manual-add' && initialDraft) return initialDraft.rows;
    return [emptyRow()];
  });

  // #313: shown as a small dismissible note when a draft was restored.
  const [draftRestored, setDraftRestored] = useState<boolean>(() => initialDraft !== null);

  // ----- Ingredient sheet state -----
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editingRow, setEditingRow] = useState<EditorRow | null>(null);

  // ----- Error display -----
  const [saveError, setSaveError] = useState<string | null>(null);

  // ----- Mutations -----
  const createMutation = useCreateEntry(date);
  const updateMutation = useUpdateEntry(date);

  const isPending = createMutation.isPending || updateMutation.isPending;

  // Reset form when the mode prop changes.
  const modeKind = mode.kind;
  useEffect(() => {
    // For inline mode (proposal card in chat), always reset when mode changes.
    // For dialog mode, only reset when open.
    if (!open && !inline) return;
    if (mode.kind === 'manual-edit') {
      setMeal(mode.entry.meal);
      setEntryName(mode.entry.name);
      setRows(mode.entry.ingredients.map(rowFromStoredIngredient));
    } else if (mode.kind === 'manual-add') {
      // #313: re-check for a draft on reopen, not just on first mount — the
      // draft written while this editor was previously closed is exactly
      // what the reporter wants back.
      const restored = loadDraft(mode.date);
      if (restored) {
        setMeal(restored.meal);
        setEntryName(restored.entryName);
        setRows(restored.rows);
      } else {
        // #200: default new manually-created foods to Snack / Other instead of Breakfast.
        setMeal(mode.defaultMeal ?? 'snack');
        setEntryName('');
        setRows([emptyRow()]);
      }
      setDraftRestored(restored !== null);
    } else if (mode.kind === 'proposal') {
      setMeal(mode.proposal.meal);
      setEntryName(mode.proposal.name);
      // #10: serving-aware init for proposal rows
      setRows(mode.proposal.ingredients.map(rowFromProposedIngredient));
    }
    setSaveError(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, inline, modeKind]);

  // #313: debounced draft autosave — manual-add only. Writes ~500ms after the
  // last edit so we don't hit localStorage on every keystroke. The debounced
  // value is a content string, so an unchanged form settles; a pristine form
  // serializes to null, which clears the key instead of writing.
  const draftContent = useMemo(
    () => (isManualAdd ? serializeDraftContent(meal, entryName, rows) : null),
    [isManualAdd, meal, entryName, rows],
  );
  const debouncedDraftContent = useDebounce(draftContent, 500);
  useEffect(() => {
    if (!isManualAdd) return;
    writeDraft(date, debouncedDraftContent);
  }, [debouncedDraftContent, isManualAdd, date]);

  // ----- Row helpers -----
  const removeRow = useCallback((key: number) => {
    setRows(prev => prev.filter(r => r.rowKey !== key));
  }, []);

  // ----- Sheet open/close helpers -----
  // #178: reuse an existing empty/untitled row instead of stacking a new blank
  // one each time "add ingredient" is tapped.
  const openSheetForAdd = useCallback(() => {
    const existingEmpty = rows.find(r => !r.name.trim());
    setEditingRow(existingEmpty ?? null);
    setSheetOpen(true);
  }, [rows]);

  const openSheetForEdit = useCallback((row: EditorRow) => {
    setEditingRow(row);
    setSheetOpen(true);
  }, []);

  const closeSheet = useCallback(() => {
    setSheetOpen(false);
    setEditingRow(null);
  }, []);

  // Sheet Done: add new row or update existing
  const handleSheetDone = useCallback((row: EditorRow) => {
    setRows(prev => {
      const idx = prev.findIndex(r => r.rowKey === row.rowKey);
      if (idx !== -1) {
        // Update existing
        return prev.map(r => (r.rowKey === row.rowKey ? row : r));
      }
      // Add new
      return [...prev, row];
    });
    // #246 — a custom food/meal row's own name is the sensible entry name
    // (custom foods are single-ingredient items too), so adopt it when the
    // user hasn't typed one of their own. Never clobber a typed name.
    if (row.source === 'custom') {
      setEntryName(prev => (prev.trim() ? prev : row.name));
    }
  }, []);

  // Sheet Delete: remove the row being edited
  const handleSheetDelete = useCallback(() => {
    if (editingRow !== null) {
      removeRow(editingRow.rowKey);
    }
  }, [editingRow, removeRow]);

  // ----- Save -----
  // "Has a valid amount" is basis-aware: a weight row needs grams > 0, a
  // serving row (grams always null) needs a positive serving quantity instead.
  const firstValidIngredient = rows.find(
    r => r.name.trim().length > 0 && (r.basis === 'serving' ? r.quantity > 0 : (r.grams ?? 0) > 0),
  );
  const effectiveName = entryName.trim() || firstValidIngredient?.name.trim() || '';

  const canSave =
    effectiveName.length > 0 &&
    rows.length > 0 &&
    !isPending;

  async function handleSave() {
    if (!canSave) return;
    setSaveError(null);

    // #174: pre-validate client-side so a blank ingredient name surfaces as a
    // clear message instead of a raw "Request failed with status code 400".
    if (rows.some(r => !r.name.trim())) {
      setSaveError('Every ingredient needs a name');
      return;
    }

    // ingredientInputFromRow emits exactly one basis per row: grams for a
    // weight row, serving_qty + serving_label for a serving row.
    const ingredients: IngredientInput[] = rows.map(r => ingredientInputFromRow(r));

    // Detect provenance: if any ingredient row was filled from a custom food/meal,
    // tag the entry with source='custom' and from_custom_food_id so that the
    // recently-used list (which joins on from_custom_food_id) can bootstrap.
    const customRow = rows.find(
      r => r.source === 'custom' && r.source_ref != null && !isNaN(Number(r.source_ref)),
    );
    const entrySource: EntryInput['source'] = customRow ? 'custom' : 'manual';
    const fromCustomFoodId = customRow ? Number(customRow.source_ref) : undefined;

    const input: EntryInput = {
      localDate: date,
      meal,
      name: effectiveName,
      source: entrySource,
      ...(fromCustomFoodId != null ? { from_custom_food_id: fromCustomFoodId } : {}),
      ingredients,
    };

    try {
      if (mode.kind === 'manual-edit') {
        await updateMutation.mutateAsync({ id: mode.entry.id, input });
      } else {
        await createMutation.mutateAsync(input);
      }
      // #313: the entry is now persisted server-side, so the local draft
      // (if any) would only ever be stale from here on.
      if (isManualAdd) clearDraft(date);
      onClose();
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : 'Failed to save. Please try again.';
      setSaveError(msg);
    }
  }

  // #313: explicit discard — clears the draft, unlike onClose (backdrop click,
  // Esc, the modal's X) which leaves it in place for the reporter's exact case.
  function handleCancel() {
    if (isManualAdd) clearDraft(date);
    onClose();
  }

  // ----- Proposal confirm: resolve serving-aware UI rows to plain IngredientInput -----
  function handleConfirm() {
    if (!onConfirm) return;
    // #10: resolve UI-only quantity/unit fields to a plain IngredientInput.
    // A weight row resolves to its effective grams (quantity × unitGrams), as
    // before. A UNC (serving-basis) row is NOT converted to grams — there is
    // no gram weight to convert to (see the module doc comment in
    // ingredientMath.ts) — it instead resolves to serving_qty + serving_label
    // with grams left null. ingredientInputFromRow is the single place that
    // decides this so both basis are always emitted correctly.
    const ingredients: IngredientInput[] = rows.map(r => ingredientInputFromRow(r));
    const proposalSource = mode.kind === 'proposal' ? mode.proposal.source : 'manual';
    onConfirm({
      localDate: date,
      meal,
      name: effectiveName,
      source: proposalSource,
      barcode: mode.kind === 'proposal' ? (mode.proposal.barcode ?? null) : null,
      ingredients,
    });
  }

  function handleDeny() {
    if (onDeny) onDeny();
  }

  const isProposal = mode.kind === 'proposal';

  const titleMap: Record<typeof modeKind, string> = {
    'manual-add': 'Add Food Entry',
    'manual-edit': 'Edit Food Entry',
    'proposal': 'Review Entry',
  };

  // The shared editor form body (used by both dialog and inline modes).
  const editorContent = (
    <div className={styles.editor}>
      {/* Header */}
      <div className={styles.header}>
        <h2 className={styles.title}>{titleMap[modeKind]}</h2>
      </div>

      {/* #313: dismissible note when a manual-add draft was restored on open */}
      {isManualAdd && draftRestored && (
        <div className={styles.draftRestoredNote}>
          <span>Restored your unsaved entry</span>
          <button
            type="button"
            className={styles.draftRestoredDismiss}
            onClick={() => setDraftRestored(false)}
            aria-label="Dismiss"
          >
            <X size={14} aria-hidden="true" style={{ display: 'block' }} />
          </button>
        </div>
      )}

      {/* Meal selector */}
      <div className={styles.mealSelector} role="group" aria-label="Meal">
        {MEALS.map(m => (
          <button
            key={m}
            type="button"
            className={`${styles.mealBtn} ${meal === m ? styles.mealBtnActive : ''}`}
            onClick={() => setMeal(m)}
          >
            {MEAL_LABELS[m]}
          </button>
        ))}
      </div>

      {/* Entry name */}
      <div className={styles.field}>
        <label className={styles.fieldLabel} htmlFor={`entry-name-${inline ? 'inline' : 'modal'}`}>
          Entry name
        </label>
        <input
          id={`entry-name-${inline ? 'inline' : 'modal'}`}
          className={styles.input}
          type="text"
          placeholder="e.g. Chicken salad"
          value={entryName}
          onChange={e => setEntryName(e.target.value)}
        />
      </div>

      {/* Ingredient cards + Add button */}
      <div className={styles.ingredientsSection}>
        <div className={styles.ingredientsHeaderRow}>
          <span className={styles.ingredientsLabel}>Ingredients</span>
          <button
            type="button"
            className={styles.addIngredientBtn}
            onClick={openSheetForAdd}
            aria-label="Add ingredient"
          >
            <Plus size={16} aria-hidden="true" style={{ display: 'block' }} />
          </button>
        </div>
        <IngredientCardList
          rows={rows}
          onEditRow={openSheetForEdit}
        />
      </div>

      {/* Live totals */}
      <Totals rows={rows} />

      {/* AI proposal notes — only shown when present (explains non-obvious choices) */}
      {isProposal && mode.kind === 'proposal' && mode.proposal.notes && (
        <p className={styles.proposalNotes}>{mode.proposal.notes}</p>
      )}

      {/* Save error */}
      {saveError && (
        <p className={styles.errorMsg}>{saveError}</p>
      )}

      {/* Footer */}
      <div className={styles.footer}>
        {isProposal ? (
          <>
            <button
              type="button"
              className={styles.denyBtn}
              onClick={handleDeny}
            >
              Deny
            </button>
            <button
              type="button"
              className={styles.saveBtn}
              onClick={handleConfirm}
              disabled={!canSave}
            >
              Confirm
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className={styles.cancelBtn}
              onClick={handleCancel}
              disabled={isPending}
            >
              Cancel
            </button>
            <button
              type="button"
              className={styles.saveBtn}
              onClick={handleSave}
              disabled={!canSave}
            >
              {isPending ? 'Saving…' : isEdit ? 'Save changes' : 'Save'}
            </button>
          </>
        )}
      </div>
    </div>
  );

  // The portaled ingredient sheet is rendered outside of both inline and dialog modes
  // so it always layers above the host container.
  const ingredientSheet = (
    <IngredientSheet
      open={sheetOpen}
      editRow={editingRow}
      onClose={closeSheet}
      onDone={handleSheetDone}
      onDelete={editingRow !== null ? handleSheetDelete : undefined}
      // #247 — deliberately NOT passing onExpandMeal here. IngredientSheet's
      // meal-expansion branch is guarded by `&& onExpandMeal`, so omitting it
      // routes custom meals through the normal rowFromFood path instead:
      // a single row named after the meal, with a working portion dropdown.
      // MealBuilder still passes onExpandMeal (expanding a meal into
      // ingredient rows is correct there) — don't "fix" this by restoring it.
    />
  );

  // #9: inline mode — render as a card in the chat message thread, no Dialog
  if (inline) {
    return (
      <>
        <div className={styles.inlineEditorCard}>
          {editorContent}
        </div>
        {ingredientSheet}
      </>
    );
  }

  // Standard dialog mode
  return (
    <>
      <Modal
        open={open}
        onOpenChange={(isOpen: boolean) => { if (!isOpen) onClose(); }}
        title={titleMap[modeKind]}
        showTitle={false}
        contentClassName={styles.modalContent}
      >
        {editorContent}
      </Modal>
      {ingredientSheet}
    </>
  );
}
