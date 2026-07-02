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
 */
import {
  useState,
  useEffect,
  useCallback,
  useRef,
} from 'react';
import { useFoodSearch, useCreateCustomFood, useUpdateCustomFood, getCustomFood } from './api';
import type {
  FoodSearchResult,
  FoodPortion,
  CustomFoodRow,
  CustomFoodInput,
  CustomServing,
  IngredientInput,
  IngredientSource,
  Per100g,
} from './types';
import styles from './MealBuilder.module.scss';
import { X, Plus, Trash2 } from 'lucide-react';

// ---------------------------------------------------------------------------
// Shared pure helpers (mirrors ingredientMath.ts to avoid circular deps)
// ---------------------------------------------------------------------------
const GRAMS_UNIT: FoodPortion = { label: 'g', grams: 1 };

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

interface BuilderRow extends IngredientInput {
  rowKey: number;
  quantity: number;
  unitLabel: string;
  unitGrams: number;
  portions: FoodPortion[];
  per100g: Per100g | null;
}

let _key = 0;
function nextKey() { return ++_key; }

function emptyBuilderRow(): BuilderRow {
  return {
    rowKey: nextKey(),
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
  };
}

function recomputeMacros(per100g: Per100g, grams: number) {
  const f = grams / 100;
  return {
    calories: round2(per100g.calories * f),
    protein_g: round2(per100g.protein_g * f),
    carbs_g: round2(per100g.carbs_g * f),
    fat_g: round2(per100g.fat_g * f),
    fiber_g: per100g.fiber_g != null ? round2(per100g.fiber_g * f) : null,
    sugar_g: per100g.sugar_g != null ? round2(per100g.sugar_g * f) : null,
    sodium_mg: per100g.sodium_mg != null ? round2(per100g.sodium_mg * f) : null,
  };
}

function rowFromFood(food: FoodSearchResult, portions?: FoodPortion[]): BuilderRow {
  const portionList = portions ?? [GRAMS_UNIT];
  const selectedUnit = portionList.length > 1 ? portionList[1] : GRAMS_UNIT;
  const quantity = portionList.length > 1 ? 1 : (food.serving_grams ?? 100);
  const grams = quantity * selectedUnit.grams;
  return {
    rowKey: nextKey(),
    name: food.name,
    grams,
    quantity,
    unitLabel: selectedUnit.label,
    unitGrams: selectedUnit.grams,
    portions: portionList,
    source: food.source,
    source_ref: food.source_ref,
    per100g: food.per100g,
    ...recomputeMacros(food.per100g, grams),
  };
}

function sumRows(rows: BuilderRow[]) {
  return rows.reduce(
    (acc, r) => ({
      grams: acc.grams + r.grams,
      calories: acc.calories + r.calories,
      protein_g: acc.protein_g + r.protein_g,
      carbs_g: acc.carbs_g + r.carbs_g,
      fat_g: acc.fat_g + r.fat_g,
      fiber_g: acc.fiber_g + (r.fiber_g ?? 0),
      sugar_g: acc.sugar_g + (r.sugar_g ?? 0),
      sodium_mg: acc.sodium_mg + (r.sodium_mg ?? 0),
    }),
    { grams: 0, calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0, sugar_g: 0, sodium_mg: 0 },
  );
}

// ---------------------------------------------------------------------------
// Debounce hook
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
// Mini search dropdown for ingredient rows
// ---------------------------------------------------------------------------
interface DropdownProps {
  query: string;
  onSelect: (food: FoodSearchResult) => void;
}

function IngredientDropdown({ query, onSelect }: DropdownProps) {
  const debouncedQ = useDebounce(query, 300);
  const { data: results = [], isFetching } = useFoodSearch(debouncedQ);

  if (!query.trim() || (results.length === 0 && !isFetching)) return null;

  return (
    <ul className={styles.dropdown} role="listbox">
      {isFetching && <li className={styles.dropdownHint}>Searching…</li>}
      {!isFetching && results.length === 0 && <li className={styles.dropdownHint}>No results</li>}
      {results.map(food => (
        <li
          key={`${food.source}:${food.source_ref}`}
          className={styles.dropdownItem}
          role="option"
          aria-selected={false}
          onPointerDown={e => { e.preventDefault(); onSelect(food); }}
        >
          <span className={styles.dropdownName}>{food.name}</span>
          <span className={styles.dropdownMeta}>
            {food.per100g.calories} kcal/100g ·{' '}
            {food.source === 'custom'
              ? (food.kind === 'meal' ? 'Custom · Meal' : food.kind === 'food' ? 'Custom · Food' : 'Custom')
              : food.source.toUpperCase()}
          </span>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Single ingredient row for MealBuilder
// ---------------------------------------------------------------------------
interface IngredientRowProps {
  row: BuilderRow;
  onChange: (updated: BuilderRow) => void;
  onRemove: () => void;
  onExpandMeal?: (rows: BuilderRow[]) => void;
}

function BuilderIngredientRow({ row, onChange, onRemove, onExpandMeal }: IngredientRowProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearch, setShowSearch] = useState(false);

  function handleNameChange(e: React.ChangeEvent<HTMLInputElement>) {
    const name = e.target.value;
    setSearchQuery(name);
    setShowSearch(true);
    onChange({ ...row, name, source: 'manual', source_ref: null, per100g: null, portions: [GRAMS_UNIT], unitLabel: 'g', unitGrams: 1 });
  }

  async function handleSelectFood(food: FoodSearchResult) {
    setShowSearch(false);
    setSearchQuery('');

    // Custom meal: expand ingredients as snapshot rows
    if (food.source === 'custom' && food.kind === 'meal' && onExpandMeal) {
      const id = parseInt(food.source_ref, 10);
      if (!isNaN(id)) {
        try {
          const customFood = await getCustomFood(id);
          const expandedRows: BuilderRow[] = customFood.ingredients.map(ing => ({
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
          }));
          onExpandMeal(expandedRows);
        } catch {
          onChange(rowFromFood(food));
        }
        return;
      }
    }

    // Custom food or external: add as single row with custom portions
    const portions: FoodPortion[] = food.source === 'custom' && food.portions?.length
      ? [GRAMS_UNIT, ...food.portions.filter(p => p.label !== 'g')]
      : [GRAMS_UNIT];
    onChange(rowFromFood(food, portions));
  }

  function handleQuantityChange(e: React.ChangeEvent<HTMLInputElement>) {
    const quantity = parseFloat(e.target.value) || 0;
    const grams = quantity * row.unitGrams;
    onChange({ ...row, quantity, grams, ...(row.per100g ? recomputeMacros(row.per100g, grams) : {}) });
  }

  function handleUnitChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const label = e.target.value;
    const selected = row.portions.find(p => p.label === label) ?? GRAMS_UNIT;
    const grams = row.quantity * selected.grams;
    onChange({ ...row, unitLabel: selected.label, unitGrams: selected.grams, grams, ...(row.per100g ? recomputeMacros(row.per100g, grams) : {}) });
  }

  function handleMacro(field: 'calories' | 'protein_g' | 'carbs_g' | 'fat_g' | 'fiber_g' | 'sugar_g' | 'sodium_mg', val: string) {
    onChange({ ...row, [field]: parseFloat(val) || 0 });
  }

  const macrosReadOnly = row.per100g !== null;
  const showUnit = row.portions.length > 1;

  return (
    <div className={styles.ingredientRow}>
      <div className={styles.rowNameWrap}>
        <div className={styles.rowNameInputWrap}>
          <input
            className={styles.input}
            type="text"
            placeholder="Ingredient name"
            value={row.name}
            onChange={handleNameChange}
            onFocus={() => setShowSearch(true)}
            onBlur={() => setTimeout(() => setShowSearch(false), 150)}
            aria-label="Ingredient name"
          />
          {showSearch && <IngredientDropdown query={searchQuery} onSelect={handleSelectFood} />}
        </div>
        <button type="button" className={styles.removeBtn} onClick={onRemove} aria-label="Remove ingredient">
          <X size={16} aria-hidden="true" style={{ display: 'block' }} />
        </button>
      </div>
      <div className={styles.rowFields}>
        <label className={styles.fieldLabel}>
          <span>Qty</span>
          <input
            className={styles.inputSmall}
            type="number" min="0" step="0.1"
            value={row.quantity === 0 ? '' : row.quantity}
            onChange={handleQuantityChange}
            aria-label="Quantity"
          />
        </label>
        {showUnit ? (
          <label className={styles.fieldLabel}>
            <span>Unit</span>
            <select className={styles.unitSelect} value={row.unitLabel} onChange={handleUnitChange} aria-label="Unit">
              {row.portions.map(p => (
                <option key={p.label} value={p.label}>
                  {p.label === 'g' ? 'g' : `${p.label} (${p.grams}g)`}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <label className={styles.fieldLabel}>
            <span>Unit</span>
            <span className={styles.unitStatic}>g</span>
          </label>
        )}
        <label className={styles.fieldLabel}>
          <span>kcal</span>
          <input className={styles.inputSmall} type="number" min="0" step="0.1"
            value={row.calories === 0 ? '' : row.calories}
            onChange={e => handleMacro('calories', e.target.value)} readOnly={macrosReadOnly} aria-label="Calories" />
        </label>
        <label className={styles.fieldLabel}>
          <span>Prot</span>
          <input className={styles.inputSmall} type="number" min="0" step="0.1"
            value={row.protein_g === 0 ? '' : row.protein_g}
            onChange={e => handleMacro('protein_g', e.target.value)} readOnly={macrosReadOnly} aria-label="Protein g" />
        </label>
        <label className={styles.fieldLabel}>
          <span>Carbs</span>
          <input className={styles.inputSmall} type="number" min="0" step="0.1"
            value={row.carbs_g === 0 ? '' : row.carbs_g}
            onChange={e => handleMacro('carbs_g', e.target.value)} readOnly={macrosReadOnly} aria-label="Carbs g" />
        </label>
        <label className={styles.fieldLabel}>
          <span>Fat</span>
          <input className={styles.inputSmall} type="number" min="0" step="0.1"
            value={row.fat_g === 0 ? '' : row.fat_g}
            onChange={e => handleMacro('fat_g', e.target.value)} readOnly={macrosReadOnly} aria-label="Fat g" />
        </label>
      </div>
      {macrosReadOnly && (
        <p className={styles.rowHint}>Macros computed from per-100g values · adjust qty/unit to recalculate</p>
      )}
    </div>
  );
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
}

// ---------------------------------------------------------------------------
// Main MealBuilder component
// ---------------------------------------------------------------------------
export default function MealBuilder({ open, kind, initialDraft, prefillRows, onClose, onSaved }: MealBuilderProps) {
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
  // Save (flip to saved)
  // ---------------------------------------------------------------------------
  async function handleSave() {
    if (!name.trim()) {
      setSaveError('Please enter a name.');
      return;
    }
    setSaveError(null);
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
  const updateRow = useCallback((key: number, updated: BuilderRow) => {
    setRows(prev => prev.map(r => r.rowKey === key ? updated : r));
  }, []);

  const removeRow = useCallback((key: number) => {
    setRows(prev => prev.filter(r => r.rowKey !== key));
  }, []);

  const addRow = useCallback(() => {
    setRows(prev => [...prev, emptyBuilderRow()]);
  }, []);

  const handleExpandMeal = useCallback((rowKey: number, expandedRows: BuilderRow[]) => {
    setRows(prev => {
      const idx = prev.findIndex(r => r.rowKey === rowKey);
      if (idx === -1) return [...prev, ...expandedRows];
      const trigger = prev[idx];
      if (!trigger.name.trim()) {
        return [...prev.slice(0, idx), ...expandedRows, ...prev.slice(idx + 1)];
      }
      return [...prev, ...expandedRows];
    });
  }, []);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  if (!open) return null;

  const title = kind === 'meal'
    ? (draftId ? 'Edit Meal' : 'New Meal')
    : (draftId ? 'Edit Food' : 'New Food');

  return (
    <div className={styles.overlay}>
      <div className={styles.sheet} role="dialog" aria-modal="true" aria-label={title}>
        {/* Header */}
        <div className={styles.sheetHeader}>
          <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="Close">
            <X size={16} aria-hidden="true" style={{ display: 'block' }} />
          </button>
          <h2 className={styles.sheetTitle}>{title}</h2>
          <button
            type="button"
            className={styles.saveBtn}
            onClick={handleSave}
            disabled={isSaving || !name.trim()}
          >
            {isSaving ? 'Saving…' : 'Save'}
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

              {/* Ingredient rows */}
              <div className={styles.section}>
                <span className={styles.sectionLabel}>Ingredients</span>
                <div className={styles.ingredientList}>
                  {rows.map(row => (
                    <BuilderIngredientRow
                      key={row.rowKey}
                      row={row}
                      onChange={updated => updateRow(row.rowKey, updated)}
                      onRemove={() => removeRow(row.rowKey)}
                      onExpandMeal={expandedRows => handleExpandMeal(row.rowKey, expandedRows)}
                    />
                  ))}
                </div>
                <button type="button" className={styles.addIngredientBtn} onClick={addRow}>
                  <Plus size={14} aria-hidden="true" style={{ display: 'block' }} /> Add ingredient
                </button>
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
    </div>
  );
}

// Export BuilderRow type for external usage (e.g. prefillRows from EntryRow)
export type { BuilderRow };
