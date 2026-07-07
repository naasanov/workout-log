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
} from './ingredientMath';

// ---------------------------------------------------------------------------
// #10: Build an EditorRow from a ProposeIngredient (serving-aware).
// The proposal carries quantity/unit/portions so we can pre-select them.
// ing.grams is already the resolved effective grams (quantity * unitGrams).
// ---------------------------------------------------------------------------
function rowFromProposedIngredient(ing: ProposeIngredient): EditorRow {
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
  };
}

// ---------------------------------------------------------------------------
// Totals bar
// ---------------------------------------------------------------------------
interface TotalsProps {
  rows: EditorRow[];
}

function Totals({ rows }: TotalsProps) {
  const totals = rows.reduce(
    (acc, r) => ({
      grams: acc.grams + r.grams,
      calories: acc.calories + r.calories,
      protein_g: acc.protein_g + r.protein_g,
      carbs_g: acc.carbs_g + r.carbs_g,
      fat_g: acc.fat_g + r.fat_g,
    }),
    { grams: 0, calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 },
  );

  return (
    <div className={styles.totals}>
      <span className={styles.totalsLabel}>Total</span>
      <span className={styles.totalsStat}>
        <strong>{round2(totals.grams)}</strong>g
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
    if (mode.kind === 'manual-add') return mode.defaultMeal ?? 'breakfast';
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
      return mode.entry.ingredients.map(ing => ({
        ...ing,
        rowKey: nextKey(),
        quantity: ing.grams,
        unitLabel: 'g',
        unitGrams: 1,
        portions: [GRAMS_UNIT],
        fiber_g: ing.fiber_g ?? null,
        sugar_g: ing.sugar_g ?? null,
        sodium_mg: ing.sodium_mg ?? null,
        per100g: null,
      }));
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
      setRows(
        mode.entry.ingredients.map(ing => ({
          ...ing,
          rowKey: nextKey(),
          quantity: ing.grams,
          unitLabel: 'g',
          unitGrams: 1,
          portions: [GRAMS_UNIT],
          fiber_g: ing.fiber_g ?? null,
          sugar_g: ing.sugar_g ?? null,
          sodium_mg: ing.sodium_mg ?? null,
          per100g: null,
        })),
      );
    } else if (mode.kind === 'manual-add') {
      setMeal(mode.defaultMeal ?? 'breakfast');
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

  // Called when a custom meal is selected: replace the editing row (if editing
  // an empty row) or append the expanded rows.
  const handleExpandMeal = useCallback((expandedRows: EditorRow[]) => {
    setRows(prev => {
      if (editingRow !== null) {
        const idx = prev.findIndex(r => r.rowKey === editingRow.rowKey);
        if (idx !== -1 && !prev[idx].name.trim()) {
          return [...prev.slice(0, idx), ...expandedRows, ...prev.slice(idx + 1)];
        }
      }
      return [...prev, ...expandedRows];
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingRow]);

  // ----- Sheet open/close helpers -----
  const openSheetForAdd = useCallback(() => {
    setEditingRow(null);
    setSheetOpen(true);
  }, []);

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
  }, []);

  // Sheet Delete: remove the row being edited
  const handleSheetDelete = useCallback(() => {
    if (editingRow !== null) {
      removeRow(editingRow.rowKey);
    }
  }, [editingRow, removeRow]);

  // ----- Save -----
  const firstValidIngredient = rows.find(r => r.name.trim().length > 0 && r.grams > 0);
  const effectiveName = entryName.trim() || firstValidIngredient?.name.trim() || '';

  const canSave =
    effectiveName.length > 0 &&
    rows.length > 0 &&
    !isPending;

  async function handleSave() {
    if (!canSave) return;
    setSaveError(null);

    const ingredients: IngredientInput[] = rows.map(r => ({
      name: r.name,
      grams: r.grams, // effective grams = quantity × unitGrams
      source: r.source,
      source_ref: r.source_ref ?? null,
      calories: r.calories,
      protein_g: r.protein_g,
      carbs_g: r.carbs_g,
      fat_g: r.fat_g,
      fiber_g: r.fiber_g ?? null,
      sugar_g: r.sugar_g ?? null,
      sodium_mg: r.sodium_mg ?? null,
    }));

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

  // ----- Proposal confirm: strip serving metadata, send grams-based EntryInput -----
  function handleConfirm() {
    if (!onConfirm) return;
    // #10: resolve serving-aware rows to plain grams-based IngredientInput
    const ingredients: IngredientInput[] = rows.map(r => ({
      name: r.name,
      grams: r.grams, // always the effective grams (quantity × unitGrams)
      source: r.source,
      source_ref: r.source_ref ?? null,
      calories: r.calories,
      protein_g: r.protein_g,
      carbs_g: r.carbs_g,
      fat_g: r.fat_g,
      fiber_g: r.fiber_g ?? null,
      sugar_g: r.sugar_g ?? null,
      sodium_mg: r.sodium_mg ?? null,
    }));
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
      onExpandMeal={handleExpandMeal}
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
