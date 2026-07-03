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
  useRef,
} from 'react';
import Modal from '../../components/Modal.jsx';
import BarcodeScanner from './BarcodeScanner';
import { useCreateEntry, useUpdateEntry, useFoodSearch, lookupBarcode, getPortions, getCustomFood } from './api';
import type {
  EntryEditorProps,
  Meal,
  IngredientInput,
  EntryInput,
  FoodSearchResult,
  FoodPortion,
  ProposeIngredient,
} from './types';
import { MEALS, MEAL_LABELS } from './types';
import styles from './EntryEditor.module.scss';
import { ScanBarcode } from 'lucide-react';
import {
  portionsCache,
  GRAMS_UNIT,
  type EditorRow,
  nextKey,
  emptyRow,
  round2,
  recomputeMacros,
  immediatePortions,
  rowFromFood,
  buildPortionListFromFetched,
  buildPortionList,
  applyNewPortions,
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
// Search dropdown for a single ingredient row
// ---------------------------------------------------------------------------
interface SearchDropdownProps {
  query: string;
  onSelect: (food: FoodSearchResult) => void;
}

function SearchDropdown({ query, onSelect }: SearchDropdownProps) {
  const debouncedQuery = useDebounce(query, 300);
  const { data: results = [], isFetching } = useFoodSearch(debouncedQuery);

  if (!query.trim() || (results.length === 0 && !isFetching)) return null;

  return (
    <ul className={styles.dropdown} role="listbox">
      {isFetching && (
        <li className={styles.dropdownHint}>Searching…</li>
      )}
      {!isFetching && results.length === 0 && (
        <li className={styles.dropdownHint}>No results</li>
      )}
      {results.map(food => (
        <li
          key={`${food.source}:${food.source_ref}`}
          className={styles.dropdownItem}
          role="option"
          aria-selected={false}
          onPointerDown={e => {
            e.preventDefault();
            onSelect(food);
          }}
        >
          <span className={styles.dropdownName}>{food.name}</span>
          <span className={styles.dropdownMeta}>
            {food.per100g.calories} kcal/100g · {food.source === 'custom' ? (food.kind === 'meal' ? 'Custom · Meal' : food.kind === 'food' ? 'Custom · Food' : 'Custom') : food.source.toUpperCase()}
          </span>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Single ingredient row
// ---------------------------------------------------------------------------
interface IngredientRowProps {
  row: EditorRow;
  onChange: (updated: EditorRow) => void;
  onRemove: () => void;
  onOpenBarcode: () => void;
  onExpandMeal?: (rows: EditorRow[]) => void;
}

function IngredientRowEditor({ row, onChange, onRemove, onOpenBarcode, onExpandMeal }: IngredientRowProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearch, setShowSearch] = useState(false);

  // ---- Async portion fetching for USDA foods ----
  useEffect(() => {
    if (row.source !== 'usda' || !row.source_ref) return;

    const ref = row.source_ref;

    if (portionsCache.has(ref)) {
      const cached = portionsCache.get(ref)!;
      const merged = buildPortionList(row, cached);
      if (merged.length !== row.portions.length) {
        onChange(applyNewPortions(row, merged));
      }
      return;
    }

    let cancelled = false;
    getPortions('usda', ref).then(fetched => {
      if (cancelled) return;
      portionsCache.set(ref, fetched);
      const merged = buildPortionList(row, fetched);
      onChange(applyNewPortions(row, merged));
    }).catch(() => {
      // Silently ignore — user still has 'g' and any serving option.
    });

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row.source_ref]);

  function handleNameChange(e: React.ChangeEvent<HTMLInputElement>) {
    const name = e.target.value;
    setSearchQuery(name);
    setShowSearch(true);
    onChange({
      ...row,
      name,
      source: 'manual',
      source_ref: null,
      per100g: null,
      portions: [GRAMS_UNIT],
      unitLabel: 'g',
      unitGrams: 1,
    });
  }

  function handleSelectFood(food: FoodSearchResult) {
    setShowSearch(false);
    setSearchQuery('');

    // Custom meal: expand its ingredients as a snapshot into the editor rows.
    if (food.source === 'custom' && food.kind === 'meal' && onExpandMeal) {
      const id = parseInt(food.source_ref, 10);
      if (!isNaN(id)) {
        getCustomFood(id).then(customFood => {
          const expandedRows: EditorRow[] = customFood.ingredients.map(ing => ({
            rowKey: nextKey(),
            name: ing.name,
            grams: ing.grams,
            quantity: ing.grams,
            unitLabel: 'g',
            unitGrams: 1,
            portions: [GRAMS_UNIT],
            source: ing.source,
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
        }).catch(() => {
          // Fallback: add as single row with batch macros
          onChange(rowFromFood(food, immediatePortions(food)));
        });
        return;
      }
    }

    const cached = food.source === 'usda' && food.source_ref
      ? portionsCache.get(food.source_ref)
      : undefined;
    const portions = cached
      ? buildPortionListFromFetched(food, cached)
      : immediatePortions(food);
    onChange(rowFromFood(food, portions));
  }

  function handleQuantityChange(e: React.ChangeEvent<HTMLInputElement>) {
    const quantity = parseFloat(e.target.value) || 0;
    const effectiveGrams = quantity * row.unitGrams;
    if (row.per100g) {
      onChange({ ...row, quantity, grams: effectiveGrams, ...recomputeMacros(row.per100g, effectiveGrams) });
    } else {
      onChange({ ...row, quantity, grams: effectiveGrams });
    }
  }

  function handleUnitChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const label = e.target.value;
    const selected = row.portions.find(p => p.label === label) ?? GRAMS_UNIT;
    const effectiveGrams = row.quantity * selected.grams;
    if (row.per100g) {
      onChange({
        ...row,
        unitLabel: selected.label,
        unitGrams: selected.grams,
        grams: effectiveGrams,
        ...recomputeMacros(row.per100g, effectiveGrams),
      });
    } else {
      onChange({ ...row, unitLabel: selected.label, unitGrams: selected.grams, grams: effectiveGrams });
    }
  }

  function handleMacroChange(field: 'calories' | 'protein_g' | 'carbs_g' | 'fat_g', value: string) {
    onChange({ ...row, [field]: parseFloat(value) || 0 });
  }

  const macrosReadOnly = row.per100g !== null;
  const showUnitDropdown = row.portions.length > 1;

  return (
    <div className={styles.row}>
      <div className={styles.rowNameWrap}>
        <div className={styles.rowNameInputWrap}>
          <input
            className={styles.input}
            type="text"
            placeholder="Ingredient name"
            value={row.name}
            onChange={handleNameChange}
            onFocus={() => setShowSearch(true)}
            onBlur={() => {
              setTimeout(() => setShowSearch(false), 150);
            }}
            aria-label="Ingredient name"
          />
          {showSearch && (
            <SearchDropdown query={searchQuery} onSelect={handleSelectFood} />
          )}
        </div>
        <button
          type="button"
          className={styles.barcodeBtn}
          onClick={onOpenBarcode}
          aria-label="Scan barcode"
          title="Scan barcode"
        >
          <ScanBarcode className={styles.barcodeIcon} size={16} aria-hidden="true" />
        </button>
      </div>

      <div className={styles.rowNutrients}>
        {/* Zone 1: Quantity + unit — stay together */}
        <div className={styles.portionGroup}>
          <label className={styles.nutrientLabel} aria-label="Quantity">
            <span>Qty</span>
            <input
              className={styles.inputSmall}
              type="number"
              min="0"
              step="0.1"
              value={row.quantity === 0 ? '' : row.quantity}
              onChange={handleQuantityChange}
              aria-label="Quantity"
            />
          </label>
          {showUnitDropdown ? (
            <label className={styles.nutrientLabel}>
              <span>Unit</span>
              <select
                className={styles.unitSelect}
                value={row.unitLabel}
                onChange={handleUnitChange}
                aria-label="Unit"
              >
                {row.portions.map(p => (
                  <option key={p.label} value={p.label}>
                    {p.label === 'g' ? 'g' : `${p.label} (${p.grams}g)`}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <label className={styles.nutrientLabel}>
              <span>Unit</span>
              <span className={styles.unitStatic}>g</span>
            </label>
          )}
        </div>

        {/* Zone 2: Macro fields */}
        <div className={styles.macrosGroup}>
          <label className={styles.nutrientLabel}>
            <span>kcal</span>
            <input
              className={styles.inputSmall}
              type="number"
              min="0"
              step="0.1"
              value={row.calories === 0 ? '' : row.calories}
              onChange={e => handleMacroChange('calories', e.target.value)}
              readOnly={macrosReadOnly}
              aria-label="Calories"
            />
          </label>

          <label className={styles.nutrientLabel}>
            <span>Prot</span>
            <input
              className={styles.inputSmall}
              type="number"
              min="0"
              step="0.1"
              value={row.protein_g === 0 ? '' : row.protein_g}
              onChange={e => handleMacroChange('protein_g', e.target.value)}
              readOnly={macrosReadOnly}
              aria-label="Protein g"
            />
          </label>

          <label className={styles.nutrientLabel}>
            <span>Carbs</span>
            <input
              className={styles.inputSmall}
              type="number"
              min="0"
              step="0.1"
              value={row.carbs_g === 0 ? '' : row.carbs_g}
              onChange={e => handleMacroChange('carbs_g', e.target.value)}
              readOnly={macrosReadOnly}
              aria-label="Carbs g"
            />
          </label>

          <label className={styles.nutrientLabel}>
            <span>Fat</span>
            <input
              className={styles.inputSmall}
              type="number"
              min="0"
              step="0.1"
              value={row.fat_g === 0 ? '' : row.fat_g}
              onChange={e => handleMacroChange('fat_g', e.target.value)}
              readOnly={macrosReadOnly}
              aria-label="Fat g"
            />
          </label>
        </div>

        <button
          type="button"
          className={styles.removeRowBtn}
          onClick={onRemove}
          aria-label="Remove ingredient"
        >
          ✕
        </button>
      </div>

      {macrosReadOnly && (
        <p className={styles.rowHint}>
          Macros computed from per-100g values · adjust qty/unit to recalculate
        </p>
      )}
    </div>
  );
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

  // ----- Barcode scanner state -----
  const [scanningRowKey, setScanningRowKey] = useState<number | null>(null);
  const [barcodeError, setBarcodeError] = useState<string | null>(null);
  const scanningRowKeyRef = useRef<number | null>(null);
  scanningRowKeyRef.current = scanningRowKey;

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
  const updateRow = useCallback((key: number, updated: EditorRow) => {
    setRows(prev => prev.map(r => (r.rowKey === key ? updated : r)));
  }, []);

  const removeRow = useCallback((key: number) => {
    setRows(prev => prev.filter(r => r.rowKey !== key));
  }, []);

  const addRow = useCallback(() => {
    setRows(prev => [...prev, emptyRow()]);
  }, []);

  // Called when a custom meal is selected: replace the current empty row (or
  // append if the row has content) with the meal's ingredient snapshot.
  const handleExpandMeal = useCallback((rowKey: number, expandedRows: EditorRow[]) => {
    setRows(prev => {
      const idx = prev.findIndex(r => r.rowKey === rowKey);
      if (idx === -1) return [...prev, ...expandedRows];
      // Replace the trigger row with the expanded rows only if it's still empty.
      const trigger = prev[idx];
      if (!trigger.name.trim()) {
        return [...prev.slice(0, idx), ...expandedRows, ...prev.slice(idx + 1)];
      }
      return [...prev, ...expandedRows];
    });
  }, []);

  // ----- Barcode callbacks -----
  const handleOpenBarcode = useCallback((rowKey: number) => {
    setBarcodeError(null);
    setScanningRowKey(rowKey);
  }, []);

  const handleBarcodeDetected = useCallback(async (code: string) => {
    setScanningRowKey(null);
    const targetKey = scanningRowKeyRef.current;
    if (targetKey === null) return;
    try {
      const food = await lookupBarcode(code);
      if (!food) {
        setBarcodeError(`Barcode ${code} not found in database.`);
        return;
      }
      const newRow = rowFromFood(food);
      setRows(prev => prev.map(r => (r.rowKey === targetKey ? { ...newRow, rowKey: targetKey } : r)));
    } catch {
      setBarcodeError('Failed to look up barcode. Try again.');
    }
  }, []);

  const handleBarcodeClose = useCallback(() => {
    setScanningRowKey(null);
  }, []);

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

      {/* Ingredient rows */}
      <div className={styles.ingredientsSection}>
        <span className={styles.ingredientsLabel}>Ingredients</span>
        <div className={styles.ingredientsList}>
          {rows.map(row => (
            <IngredientRowEditor
              key={row.rowKey}
              row={row}
              onChange={updated => updateRow(row.rowKey, updated)}
              onRemove={() => removeRow(row.rowKey)}
              onOpenBarcode={() => handleOpenBarcode(row.rowKey)}
              onExpandMeal={expandedRows => handleExpandMeal(row.rowKey, expandedRows)}
            />
          ))}
        </div>
        <button
          type="button"
          className={styles.addRowBtn}
          onClick={addRow}
        >
          + Add ingredient
        </button>
      </div>

      {/* Barcode lookup error */}
      {barcodeError && (
        <p className={styles.errorMsg}>{barcodeError}</p>
      )}

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

  // #9: inline mode — render as a card in the chat message thread, no Dialog
  if (inline) {
    return (
      <>
        <div className={styles.inlineEditorCard}>
          {editorContent}
        </div>

        {scanningRowKey !== null && (
          <BarcodeScanner
            onDetected={handleBarcodeDetected}
            onClose={handleBarcodeClose}
          />
        )}
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

      {scanningRowKey !== null && (
        <BarcodeScanner
          onDetected={handleBarcodeDetected}
          onClose={handleBarcodeClose}
        />
      )}
    </>
  );
}
