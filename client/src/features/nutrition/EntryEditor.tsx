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
} from 'react';
import Modal from '../../components/Modal.jsx';
import { useCreateEntry, useUpdateEntry } from './api';
import type {
  EntryEditorProps,
  Meal,
  IngredientInput,
  EntryInput,
  FoodPortion,
  ProposeIngredient,
} from './types';
import { MEALS, MEAL_LABELS } from './types';
import styles from './EntryEditor.module.scss';
import { Plus } from 'lucide-react';
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

  // ----- Meal selector -----
  const [meal, setMeal] = useState<Meal>(() => {
    if (mode.kind === 'manual-edit') return mode.entry.meal;
    // #200: default new manually-created foods to Snack / Other instead of Breakfast.
    if (mode.kind === 'manual-add') return mode.defaultMeal ?? 'snack';
    return mode.proposal.meal;
  });

  // ----- Entry name -----
  const [entryName, setEntryName] = useState<string>(() => {
    if (mode.kind === 'manual-edit') return mode.entry.name;
    if (mode.kind === 'proposal') return mode.proposal.name;
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
    return [emptyRow()];
  });

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
      // #200: default new manually-created foods to Snack / Other instead of Breakfast.
      setMeal(mode.defaultMeal ?? 'snack');
      setEntryName('');
      setRows([emptyRow()]);
    } else if (mode.kind === 'proposal') {
      setMeal(mode.proposal.meal);
      setEntryName(mode.proposal.name);
      // #10: serving-aware init for proposal rows
      setRows(mode.proposal.ingredients.map(rowFromProposedIngredient));
    }
    setSaveError(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, inline, modeKind]);

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
      onClose();
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : 'Failed to save. Please try again.';
      setSaveError(msg);
    }
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
              onClick={onClose}
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
