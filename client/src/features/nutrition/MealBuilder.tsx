/**
 * MealBuilder — shared form for creating/editing custom foods and meals.
 *
 * Two modes driven by `kind`:
 *   'meal' — name + notes + ingredient rows + servings editor + batch-scale +
 *             live 100g / full-batch macro readouts + autosave draft.
 *   'food' — name + notes + single per-serving macro entry + serving size in
 *             grams + optional extra custom servings.
 *
 * Autosave: debounced PATCH (~600ms) to the single draft custom_food.
 * On open: if a draft for the given kind exists, load it.
 * Save: flip status to 'saved' and close.
 *
 * Proposal mode: when `proposalArgs` is provided (from the AI agent's
 * propose_custom_food tool), the builder is pre-filled with those values and
 * autosave is suppressed. The Save button calls `onConfirmProposal(payload)`
 * instead of writing to the DB directly.
 */
import {
  useState,
  useEffect,
  useCallback,
  useRef,
} from 'react';
import { useCreateCustomFood, useUpdateCustomFood } from './api';
import type {
  CustomFoodRow,
  CustomFoodInput,
  CustomServing,
  IngredientInput,
  IngredientSource,
  ProposeCustomFoodArgs,
} from './types';
import styles from './MealBuilder.module.scss';
import { X, Plus, Trash2 } from 'lucide-react';
import IngredientSheet, { IngredientCardList } from './IngredientSheet';
import {
  GRAMS_UNIT,
  type EditorRow as BuilderRow,
  nextKey,
  emptyRow as emptyBuilderRow,
  round2,
  sumRows,
} from './ingredientMath';

// ---------------------------------------------------------------------------
// Debounce hook (used for autosave)
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
// Props
// ---------------------------------------------------------------------------
export interface MealBuilderProps {
  open: boolean;
  kind: 'food' | 'meal';
  /** If provided, load this draft on open instead of fetching. */
  initialDraft?: CustomFoodRow | null;
  /** Pre-fill rows (e.g. "Save as meal" from an entry). */
  prefillRows?: BuilderRow[];
  onClose: () => void;
  onSaved?: (saved: CustomFoodRow) => void;
  /**
   * Proposal mode: when provided, pre-fill from agent's propose_custom_food args
   * and suppress autosave. The Save button calls onConfirmProposal(payload) instead
   * of writing to the DB. Used by NutritionChat inline card.
   */
  proposalArgs?: ProposeCustomFoodArgs;
  onConfirmProposal?: (payload: CustomFoodInput) => void;
  onDenyProposal?: () => void;
}

// ---------------------------------------------------------------------------
// Main MealBuilder component
// ---------------------------------------------------------------------------
export default function MealBuilder({ open, kind, initialDraft, prefillRows, onClose, onSaved, proposalArgs, onConfirmProposal, onDenyProposal }: MealBuilderProps) {
  const isProposalMode = proposalArgs !== undefined;
  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');
  const [rows, setRows] = useState<BuilderRow[]>([emptyBuilderRow()]);
  const [servings, setServings] = useState<CustomServing[]>([]);
  const [batchScale, setBatchScale] = useState(1);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [draftId, setDraftId] = useState<number | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Food-mode only: single serving size in grams
  const [foodServingGrams, setFoodServingGrams] = useState(100);
  const [foodCalories, setFoodCalories] = useState(0);
  const [foodProtein, setFoodProtein] = useState(0);
  const [foodCarbs, setFoodCarbs] = useState(0);
  const [foodFat, setFoodFat] = useState(0);
  const [foodFiber, setFoodFiber] = useState('');
  const [foodSugar, setFoodSugar] = useState('');
  const [foodSodium, setFoodSodium] = useState('');

  // Servings editor state
  const [newServingLabel, setNewServingLabel] = useState('');
  const [newServingType, setNewServingType] = useState<'grams' | 'fraction'>('grams');
  const [newServingValue, setNewServingValue] = useState('');

  const createMutation = useCreateCustomFood();
  const updateMutation = useUpdateCustomFood();

  // ---------------------------------------------------------------------------
  // Init / reset on open
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!open) return;

    setSaveError(null);
    setServings([]);
    setBatchScale(1);
    setNewServingLabel('');
    setNewServingValue('');
    setNewServingType('grams');

    // Proposal mode: pre-fill from agent args, no draft fetch
    if (proposalArgs) {
      setName(proposalArgs.name);
      setNotes(proposalArgs.notes ?? '');
      setDraftId(null);
      if (proposalArgs.servings && proposalArgs.servings.length > 0) {
        // Agent provides def_type + def_value but not resolved grams — use def_value as grams
        // for fractions (approximate); server resolves on save.
        setServings(proposalArgs.servings.map((s, i) => ({
          label: s.label,
          def_type: s.def_type,
          def_value: s.def_value,
          grams: s.def_type === 'grams' ? s.def_value : s.def_value * 100, // approx; resolved on save
          sort_order: i,
        })));
      }
      if (kind === 'meal' && proposalArgs.ingredients.length > 0) {
        setRows(proposalArgs.ingredients.map(ing => ({
          rowKey: nextKey(),
          name: ing.name,
          grams: ing.grams,
          quantity: ing.quantity ?? ing.grams,
          unitLabel: ing.unit ?? 'g',
          unitGrams: ing.unit && ing.unit !== 'g' && ing.quantity && ing.quantity > 0
            ? ing.grams / ing.quantity
            : 1,
          portions: ing.portions ?? [GRAMS_UNIT],
          source: ing.source as IngredientSource,
          source_ref: ing.source_ref ?? null,
          calories: ing.calories,
          protein_g: ing.protein_g,
          carbs_g: ing.carbs_g,
          fat_g: ing.fat_g,
          fiber_g: ing.fiber_g ?? null,
          sugar_g: ing.sugar_g ?? null,
          sodium_mg: ing.sodium_mg ?? null,
          per100g: null,
        })));
      } else if (kind === 'food' && proposalArgs.ingredients.length > 0) {
        const ing = proposalArgs.ingredients[0];
        setFoodServingGrams(ing.grams);
        setFoodCalories(ing.calories);
        setFoodProtein(ing.protein_g);
        setFoodCarbs(ing.carbs_g);
        setFoodFat(ing.fat_g);
        setFoodFiber(ing.fiber_g != null ? String(ing.fiber_g) : '');
        setFoodSugar(ing.sugar_g != null ? String(ing.sugar_g) : '');
        setFoodSodium(ing.sodium_mg != null ? String(ing.sodium_mg) : '');
      }
      return;
    }

    if (initialDraft) {
      loadFromRow(initialDraft);
      return;
    }

    if (prefillRows && prefillRows.length > 0) {
      setName('');
      setNotes('');
      setRows(prefillRows.map(r => ({ ...r, rowKey: nextKey() })));
      setDraftId(null);
    } else {
      setName('');
      setNotes('');
      setRows([emptyBuilderRow()]);
      setDraftId(null);
      setFoodServingGrams(100);
      setFoodCalories(0);
      setFoodProtein(0);
      setFoodCarbs(0);
      setFoodFat(0);
      setFoodFiber('');
      setFoodSugar('');
      setFoodSodium('');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function loadFromRow(row: CustomFoodRow) {
    setName(row.name);
    setNotes(row.notes ?? '');
    setDraftId(row.id);
    setServings(row.servings.map(s => ({ ...s })));

    if (kind === 'meal') {
      setRows(row.ingredients.map(ing => ({
        rowKey: nextKey(),
        name: ing.name,
        grams: ing.grams,
        quantity: ing.grams,
        unitLabel: 'g',
        unitGrams: 1,
        portions: [GRAMS_UNIT],
        source: ing.source as IngredientSource,
        source_ref: ing.source_ref ?? null,
        calories: ing.calories,
        protein_g: ing.protein_g,
        carbs_g: ing.carbs_g,
        fat_g: ing.fat_g,
        fiber_g: ing.fiber_g ?? null,
        sugar_g: ing.sugar_g ?? null,
        sodium_mg: ing.sodium_mg ?? null,
        per100g: null,
      })));
    } else {
      // Food mode: first ingredient holds the per-serving macros
      const ing = row.ingredients[0];
      if (ing) {
        setFoodServingGrams(ing.grams);
        setFoodCalories(ing.calories);
        setFoodProtein(ing.protein_g);
        setFoodCarbs(ing.carbs_g);
        setFoodFat(ing.fat_g);
        setFoodFiber(ing.fiber_g != null ? String(ing.fiber_g) : '');
        setFoodSugar(ing.sugar_g != null ? String(ing.sugar_g) : '');
        setFoodSodium(ing.sodium_mg != null ? String(ing.sodium_mg) : '');
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Build payload
  // ---------------------------------------------------------------------------
  function buildPayload(status: 'draft' | 'saved'): CustomFoodInput {
    let ingredients: IngredientInput[];
    let resolvedServings: CustomServing[];

    if (kind === 'meal') {
      const totals = sumRows(rows);
      ingredients = rows
        .filter(r => r.name.trim() && r.grams > 0)
        .map(r => ({
          name: r.name,
          grams: r.grams * batchScale,
          source: r.source,
          source_ref: r.source_ref ?? null,
          calories: round2(r.calories * batchScale),
          protein_g: round2(r.protein_g * batchScale),
          carbs_g: round2(r.carbs_g * batchScale),
          fat_g: round2(r.fat_g * batchScale),
          fiber_g: r.fiber_g != null ? round2(r.fiber_g * batchScale) : null,
          sugar_g: r.sugar_g != null ? round2(r.sugar_g * batchScale) : null,
          sodium_mg: r.sodium_mg != null ? round2(r.sodium_mg * batchScale) : null,
        }));
      const scaledTotalGrams = totals.grams * batchScale;
      resolvedServings = servings.map(s => ({
        ...s,
        grams: s.def_type === 'fraction' ? round2(s.def_value * scaledTotalGrams) : s.grams,
      }));
    } else {
      // Food mode: single ingredient
      ingredients = [{
        name: name.trim() || 'Custom food',
        grams: foodServingGrams,
        source: 'manual',
        source_ref: null,
        calories: foodCalories,
        protein_g: foodProtein,
        carbs_g: foodCarbs,
        fat_g: foodFat,
        fiber_g: foodFiber ? parseFloat(foodFiber) : null,
        sugar_g: foodSugar ? parseFloat(foodSugar) : null,
        sodium_mg: foodSodium ? parseFloat(foodSodium) : null,
      }];
      resolvedServings = servings.map(s => ({
        ...s,
        grams: s.def_type === 'fraction' ? round2(s.def_value * foodServingGrams) : s.grams,
      }));
    }

    return {
      kind,
      name: name.trim(),
      notes: notes.trim() || null,
      status,
      ingredients,
      servings: resolvedServings,
    };
  }

  // ---------------------------------------------------------------------------
  // Autosave draft (debounced)
  // ---------------------------------------------------------------------------
  const autosavePayloadStr = JSON.stringify({ name, notes, rows: rows.map(r => ({ ...r, rowKey: undefined })), servings, batchScale, foodServingGrams, foodCalories, foodProtein, foodCarbs, foodFat });
  const debouncedPayloadStr = useDebounce(autosavePayloadStr, 600);

  const draftIdRef = useRef<number | null>(null);
  draftIdRef.current = draftId;

  useEffect(() => {
    if (!open) return;
    // Suppress autosave in proposal mode
    if (isProposalMode) return;
    // Only autosave if there's some content
    if (!name.trim() && rows.every(r => !r.name.trim()) && kind === 'meal') return;
    if (!name.trim() && kind === 'food') return;

    const payload = buildPayload('draft');

    if (draftIdRef.current !== null) {
      updateMutation.mutateAsync({ id: draftIdRef.current, input: payload }).catch(() => {});
    } else {
      createMutation.mutateAsync(payload).then(created => {
        setDraftId(created.id);
      }).catch(() => {});
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedPayloadStr, open]);

  // ---------------------------------------------------------------------------
  // Save (flip to saved, or confirm proposal)
  // ---------------------------------------------------------------------------
  async function handleSave() {
    if (!name.trim()) {
      setSaveError('Please enter a name.');
      return;
    }
    setSaveError(null);

    // Proposal mode: hand payload back to caller; no DB write here.
    if (isProposalMode && onConfirmProposal) {
      onConfirmProposal(buildPayload('saved'));
      return;
    }

    setIsSaving(true);
    try {
      const payload = buildPayload('saved');
      let saved: CustomFoodRow;
      if (draftId !== null) {
        saved = await updateMutation.mutateAsync({ id: draftId, input: payload });
      } else {
        saved = await createMutation.mutateAsync(payload);
      }
      onSaved?.(saved);
      onClose();
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save.');
    } finally {
      setIsSaving(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Batch-scale control
  // ---------------------------------------------------------------------------
  function applyBatchScale(newScale: number) {
    if (newScale < 1) return;
    setBatchScale(newScale);
  }

  // ---------------------------------------------------------------------------
  // Servings editor
  // ---------------------------------------------------------------------------
  function addServing() {
    const value = parseFloat(newServingValue);
    if (!newServingLabel.trim() || isNaN(value) || value <= 0) return;
    const totals = sumRows(rows);
    const totalGrams = totals.grams * batchScale;
    const grams = newServingType === 'fraction'
      ? round2(value * totalGrams)
      : value;
    setServings(prev => [...prev, {
      label: newServingLabel.trim(),
      def_type: newServingType,
      def_value: value,
      grams,
      sort_order: prev.length,
    }]);
    setNewServingLabel('');
    setNewServingValue('');
  }

  function removeServing(idx: number) {
    setServings(prev => prev.filter((_, i) => i !== idx));
  }

  // ---------------------------------------------------------------------------
  // Computed readouts for meal mode
  // ---------------------------------------------------------------------------
  const batchTotals = sumRows(rows);
  const scaledGrams = batchTotals.grams * batchScale;
  const scaledCals = round2(batchTotals.calories * batchScale);
  const scaledProtein = round2(batchTotals.protein_g * batchScale);
  const scaledCarbs = round2(batchTotals.carbs_g * batchScale);
  const scaledFat = round2(batchTotals.fat_g * batchScale);
  const per100gCalories = scaledGrams > 0 ? round2(scaledCals * 100 / scaledGrams) : 0;
  const per100gProtein = scaledGrams > 0 ? round2(scaledProtein * 100 / scaledGrams) : 0;
  const per100gCarbs = scaledGrams > 0 ? round2(scaledCarbs * 100 / scaledGrams) : 0;
  const per100gFat = scaledGrams > 0 ? round2(scaledFat * 100 / scaledGrams) : 0;

  // ---------------------------------------------------------------------------
  // Row helpers
  // ---------------------------------------------------------------------------
  const removeRow = useCallback((key: number) => {
    setRows(prev => prev.filter(r => r.rowKey !== key));
  }, []);

  // Ingredient sheet state
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editingRow, setEditingRow] = useState<BuilderRow | null>(null);

  const openSheetForAdd = useCallback(() => {
    setEditingRow(null);
    setSheetOpen(true);
  }, []);

  const openSheetForEdit = useCallback((row: BuilderRow) => {
    setEditingRow(row);
    setSheetOpen(true);
  }, []);

  const closeSheet = useCallback(() => {
    setSheetOpen(false);
    setEditingRow(null);
  }, []);

  const handleSheetDone = useCallback((row: BuilderRow) => {
    setRows(prev => {
      const idx = prev.findIndex(r => r.rowKey === row.rowKey);
      if (idx !== -1) {
        return prev.map(r => (r.rowKey === row.rowKey ? row : r));
      }
      return [...prev, row];
    });
  }, []);

  const handleSheetDelete = useCallback(() => {
    if (editingRow !== null) {
      removeRow(editingRow.rowKey);
    }
  }, [editingRow, removeRow]);

  const handleExpandMeal = useCallback((expandedRows: BuilderRow[]) => {
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

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  if (!open) return null;

  const title = isProposalMode
    ? (kind === 'meal' ? 'Save custom meal' : 'Save custom food')
    : kind === 'meal'
      ? (draftId ? 'Edit Meal' : 'New Meal')
      : (draftId ? 'Edit Food' : 'New Food');

  return (
    <div className={isProposalMode ? styles.proposalWrap : styles.overlay}>
      <div className={isProposalMode ? styles.proposalSheet : styles.sheet} role="dialog" aria-modal={!isProposalMode} aria-label={title}>
        {/* Header */}
        <div className={styles.sheetHeader}>
          <button
            type="button"
            className={styles.closeBtn}
            onClick={isProposalMode ? (onDenyProposal ?? onClose) : onClose}
            aria-label={isProposalMode ? 'Decline' : 'Close'}
          >
            <X size={16} aria-hidden="true" style={{ display: 'block' }} />
          </button>
          <h2 className={styles.sheetTitle}>{title}</h2>
          <button
            type="button"
            className={styles.saveBtn}
            onClick={handleSave}
            disabled={isSaving || !name.trim()}
          >
            {isProposalMode ? 'Confirm' : isSaving ? 'Saving…' : 'Save'}
          </button>
        </div>

        <div className={styles.body}>
          {/* Name */}
          <div className={styles.field}>
            <label className={styles.fieldLabelText} htmlFor="builder-name">Name</label>
            <input
              id="builder-name"
              className={styles.input}
              type="text"
              placeholder={kind === 'meal' ? 'e.g. Chicken Rice Bowl' : 'e.g. Protein Shake'}
              value={name}
              onChange={e => setName(e.target.value)}
            />
          </div>

          {/* Notes */}
          <div className={styles.field}>
            <label className={styles.fieldLabelText} htmlFor="builder-notes">Notes (optional)</label>
            <textarea
              id="builder-notes"
              className={styles.textarea}
              placeholder="Any notes…"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={2}
            />
          </div>

          {kind === 'meal' ? (
            <>
              {/* Batch scale */}
              <div className={styles.scaleSection}>
                <span className={styles.sectionLabel}>Batch scale</span>
                <div className={styles.scaleRow}>
                  <button type="button" className={styles.scaleBtn} onClick={() => applyBatchScale(batchScale - 1)} disabled={batchScale <= 1} aria-label="Decrease scale">−</button>
                  <span className={styles.scaleValue}>{batchScale}×</span>
                  <button type="button" className={styles.scaleBtn} onClick={() => applyBatchScale(batchScale + 1)} aria-label="Increase scale">+</button>
                  <span className={styles.scaleHint}>All ingredient grams are multiplied by this</span>
                </div>
              </div>

              {/* Ingredient cards */}
              <div className={styles.section}>
                <span className={styles.sectionLabel}>Ingredients</span>
                <IngredientCardList
                  rows={rows}
                  onEditRow={openSheetForEdit}
                  onAddRow={openSheetForAdd}
                />
              </div>

              {/* Macro readouts */}
              <div className={styles.macroReadouts}>
                <div className={styles.macroSection}>
                  <span className={styles.macroSectionLabel}>Full batch ({round2(scaledGrams)}g)</span>
                  <div className={styles.macroGrid}>
                    <span>{Math.round(scaledCals)} kcal</span>
                    <span>{round2(scaledProtein)}g prot</span>
                    <span>{round2(scaledCarbs)}g carbs</span>
                    <span>{round2(scaledFat)}g fat</span>
                    {batchTotals.fiber_g > 0 && <span>{round2(batchTotals.fiber_g * batchScale)}g fiber</span>}
                    {batchTotals.sugar_g > 0 && <span>{round2(batchTotals.sugar_g * batchScale)}g sugar</span>}
                    {batchTotals.sodium_mg > 0 && <span>{round2(batchTotals.sodium_mg * batchScale)}mg sodium</span>}
                  </div>
                </div>
                <div className={styles.macroSection}>
                  <span className={styles.macroSectionLabel}>Per 100g</span>
                  <div className={styles.macroGrid}>
                    <span>{Math.round(per100gCalories)} kcal</span>
                    <span>{round2(per100gProtein)}g prot</span>
                    <span>{round2(per100gCarbs)}g carbs</span>
                    <span>{round2(per100gFat)}g fat</span>
                  </div>
                </div>
              </div>

              {/* Servings editor */}
              <div className={styles.section}>
                <span className={styles.sectionLabel}>Custom servings</span>
                {servings.length > 0 && (
                  <ul className={styles.servingList}>
                    {servings.map((s, i) => (
                      <li key={i} className={styles.servingItem}>
                        <span className={styles.servingName}>{s.label}</span>
                        <span className={styles.servingGrams}>{s.grams}g</span>
                        <button type="button" className={styles.removeBtn} onClick={() => removeServing(i)} aria-label={`Remove ${s.label}`}>
                          <Trash2 size={14} aria-hidden="true" style={{ display: 'block' }} />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <div className={styles.addServingRow}>
                  <input
                    className={styles.inputSmall}
                    type="text"
                    placeholder="Label (e.g. container)"
                    value={newServingLabel}
                    onChange={e => setNewServingLabel(e.target.value)}
                    aria-label="Serving label"
                  />
                  <select
                    className={styles.unitSelect}
                    value={newServingType}
                    onChange={e => setNewServingType(e.target.value as 'grams' | 'fraction')}
                    aria-label="Serving type"
                  >
                    <option value="grams">by grams</option>
                    <option value="fraction">fraction of batch</option>
                  </select>
                  <input
                    className={styles.inputSmall}
                    type="number" min="0" step="0.01"
                    placeholder={newServingType === 'grams' ? '400' : '0.25'}
                    value={newServingValue}
                    onChange={e => setNewServingValue(e.target.value)}
                    aria-label="Serving value"
                  />
                  <button type="button" className={styles.addServingBtn} onClick={addServing} aria-label="Add serving">
                    <Plus size={14} aria-hidden="true" style={{ display: 'block' }} /> Add
                  </button>
                </div>
              </div>
            </>
          ) : (
            /* Food mode */
            <>
              <div className={styles.field}>
                <label className={styles.fieldLabelText} htmlFor="food-serving-grams">Serving size (grams)</label>
                <input
                  id="food-serving-grams"
                  className={styles.input}
                  type="number" min="1" step="1"
                  value={foodServingGrams}
                  onChange={e => setFoodServingGrams(parseFloat(e.target.value) || 100)}
                  aria-label="Serving size in grams"
                />
              </div>
              <div className={styles.section}>
                <span className={styles.sectionLabel}>Macros per serving</span>
                <div className={styles.foodMacros}>
                  <label className={styles.fieldLabel}>
                    <span>kcal</span>
                    <input className={styles.inputSmall} type="number" min="0" step="0.1"
                      value={foodCalories === 0 ? '' : foodCalories}
                      onChange={e => setFoodCalories(parseFloat(e.target.value) || 0)} aria-label="Calories" />
                  </label>
                  <label className={styles.fieldLabel}>
                    <span>Protein (g)</span>
                    <input className={styles.inputSmall} type="number" min="0" step="0.1"
                      value={foodProtein === 0 ? '' : foodProtein}
                      onChange={e => setFoodProtein(parseFloat(e.target.value) || 0)} aria-label="Protein" />
                  </label>
                  <label className={styles.fieldLabel}>
                    <span>Carbs (g)</span>
                    <input className={styles.inputSmall} type="number" min="0" step="0.1"
                      value={foodCarbs === 0 ? '' : foodCarbs}
                      onChange={e => setFoodCarbs(parseFloat(e.target.value) || 0)} aria-label="Carbs" />
                  </label>
                  <label className={styles.fieldLabel}>
                    <span>Fat (g)</span>
                    <input className={styles.inputSmall} type="number" min="0" step="0.1"
                      value={foodFat === 0 ? '' : foodFat}
                      onChange={e => setFoodFat(parseFloat(e.target.value) || 0)} aria-label="Fat" />
                  </label>
                  <label className={styles.fieldLabel}>
                    <span>Fiber (g, opt)</span>
                    <input className={styles.inputSmall} type="number" min="0" step="0.1"
                      value={foodFiber}
                      onChange={e => setFoodFiber(e.target.value)} aria-label="Fiber" />
                  </label>
                  <label className={styles.fieldLabel}>
                    <span>Sugar (g, opt)</span>
                    <input className={styles.inputSmall} type="number" min="0" step="0.1"
                      value={foodSugar}
                      onChange={e => setFoodSugar(e.target.value)} aria-label="Sugar" />
                  </label>
                  <label className={styles.fieldLabel}>
                    <span>Sodium (mg, opt)</span>
                    <input className={styles.inputSmall} type="number" min="0" step="0.1"
                      value={foodSodium}
                      onChange={e => setFoodSodium(e.target.value)} aria-label="Sodium" />
                  </label>
                </div>
                {/* Per-100g derived */}
                {foodServingGrams > 0 && (
                  <p className={styles.rowHint}>
                    Per 100g: {round2(foodCalories * 100 / foodServingGrams)} kcal ·{' '}
                    {round2(foodProtein * 100 / foodServingGrams)}g prot ·{' '}
                    {round2(foodCarbs * 100 / foodServingGrams)}g carbs ·{' '}
                    {round2(foodFat * 100 / foodServingGrams)}g fat
                  </p>
                )}
              </div>

              {/* Extra custom servings for food mode */}
              <div className={styles.section}>
                <span className={styles.sectionLabel}>Custom servings (optional)</span>
                {servings.length > 0 && (
                  <ul className={styles.servingList}>
                    {servings.map((s, i) => (
                      <li key={i} className={styles.servingItem}>
                        <span className={styles.servingName}>{s.label}</span>
                        <span className={styles.servingGrams}>{s.grams}g</span>
                        <button type="button" className={styles.removeBtn} onClick={() => removeServing(i)} aria-label={`Remove ${s.label}`}>
                          <Trash2 size={14} aria-hidden="true" style={{ display: 'block' }} />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <div className={styles.addServingRow}>
                  <input
                    className={styles.inputSmall}
                    type="text"
                    placeholder="Label"
                    value={newServingLabel}
                    onChange={e => setNewServingLabel(e.target.value)}
                    aria-label="Serving label"
                  />
                  <input
                    className={styles.inputSmall}
                    type="number" min="0" step="1"
                    placeholder="grams"
                    value={newServingValue}
                    onChange={e => setNewServingValue(e.target.value)}
                    aria-label="Serving grams"
                  />
                  <button type="button" className={styles.addServingBtn} onClick={addServing} aria-label="Add serving">
                    <Plus size={14} aria-hidden="true" style={{ display: 'block' }} /> Add
                  </button>
                </div>
              </div>
            </>
          )}

          {saveError && <p className={styles.errorMsg}>{saveError}</p>}
        </div>
      </div>

      {/* Ingredient sheet — portaled to body so it overlays MealBuilder's own sheet */}
      <IngredientSheet
        open={sheetOpen}
        editRow={editingRow}
        onClose={closeSheet}
        onDone={handleSheetDone}
        onDelete={editingRow !== null ? handleSheetDelete : undefined}
        onExpandMeal={handleExpandMeal}
      />
    </div>
  );
}

// BuilderRow is an alias for EditorRow (shared shape from ingredientMath.ts).
// Re-exported for external consumers (e.g. prefillRows from EntryRow).
export type { BuilderRow };
