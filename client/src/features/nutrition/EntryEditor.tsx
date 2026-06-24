/**
 * EntryEditor — Phase 1 + serving-size unit selector
 * Handles 'manual-add' and 'manual-edit' modes.
 * 'proposal' mode renders the same form but onConfirm/onDeny are wired in Phase 2.
 */
import {
  useState,
  useCallback,
  useEffect,
  useRef,
} from 'react';
import Modal from '../../components/Modal.jsx';
import BarcodeScanner from './BarcodeScanner';
import { useCreateEntry, useUpdateEntry, useFoodSearch, lookupBarcode, getPortions } from './api';
import type {
  EntryEditorProps,
  Meal,
  IngredientInput,
  EntryInput,
  FoodSearchResult,
  FoodPortion,
  Per100g,
} from './types';
import { MEALS } from './types';
import styles from './EntryEditor.module.scss';

// ---------------------------------------------------------------------------
// Module-level portions cache — keyed by source_ref, avoids redundant fetches
// when the user reselects the same food or edits then reopens.
// ---------------------------------------------------------------------------
const portionsCache = new Map<string, FoodPortion[]>();

// Synthetic "grams" unit — always present as the first/fallback option.
const GRAMS_UNIT: FoodPortion = { label: 'g', grams: 1 };

// ---------------------------------------------------------------------------
// Internal row shape — extends IngredientInput with UI-only fields:
//   quantity   — the number the user types in the left input
//   unitLabel  — the currently-selected unit label ('g', 'medium', 'serving', …)
//   unitGrams  — grams per one unit (1 for 'g')
//   portions   — available portion options for this row's food
//   per100g    — non-null when filled from search/barcode (enables live recompute)
// Effective grams = quantity × unitGrams.  row.grams always = effectiveGrams.
// ---------------------------------------------------------------------------
interface EditorRow extends IngredientInput {
  /** Internal row id for React keys/removal. */
  rowKey: number;
  /** Quantity the user typed. */
  quantity: number;
  /** Label of the selected unit. */
  unitLabel: string;
  /** Grams per one unit of the selected option (1 for plain grams). */
  unitGrams: number;
  /** Available portion options for the dropdown (includes the 'g' sentinel). */
  portions: FoodPortion[];
  /** Non-null when row was filled from a search/barcode result (enables live recompute). */
  per100g: Per100g | null;
}

let _rowKeyCounter = 0;
function nextKey(): number {
  return ++_rowKeyCounter;
}

function emptyRow(): EditorRow {
  return {
    rowKey: nextKey(),
    name: '',
    grams: 100,
    quantity: 100,
    unitLabel: 'g',
    unitGrams: 1,
    portions: [GRAMS_UNIT],
    source: 'manual',
    source_ref: null,
    calories: 0,
    protein_g: 0,
    carbs_g: 0,
    fat_g: 0,
    per100g: null,
  };
}

/** Recompute a row's macros from its per100g snapshot and effective grams. */
function recomputeMacros(per100g: Per100g, grams: number): Pick<EditorRow, 'calories' | 'protein_g' | 'carbs_g' | 'fat_g'> {
  const factor = grams / 100;
  return {
    calories: round2(per100g.calories * factor),
    protein_g: round2(per100g.protein_g * factor),
    carbs_g: round2(per100g.carbs_g * factor),
    fat_g: round2(per100g.fat_g * factor),
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Build the initial portions list visible immediately when a food is selected
 * (before the async USDA fetch resolves).  For OFF/barcode with serving_grams,
 * include a "serving" option.  Always starts with "g".
 */
function immediatePortions(food: FoodSearchResult): FoodPortion[] {
  const list: FoodPortion[] = [GRAMS_UNIT];
  if (food.source === 'off' && food.serving_grams) {
    list.push({ label: 'serving', grams: food.serving_grams });
  }
  return list;
}

/** Convert a FoodSearchResult into an editor row.
 *  Picks quantity=1 + first available portion if the food has a serving_grams,
 *  otherwise defaults to quantity=100, unit=g (same behaviour as before).
 */
function rowFromFood(food: FoodSearchResult, existingPortions?: FoodPortion[]): EditorRow {
  const portions = existingPortions ?? immediatePortions(food);

  // Default: use first non-gram portion if available, else grams.
  let quantity: number;
  let selectedUnit: FoodPortion;
  if (portions.length > 1) {
    // First non-g option (index 1) is the preferred serving.
    selectedUnit = portions[1];
    quantity = 1;
  } else {
    selectedUnit = GRAMS_UNIT;
    quantity = food.serving_grams ?? 100;
  }

  const effectiveGrams = quantity * selectedUnit.grams;

  return {
    rowKey: nextKey(),
    name: food.name,
    grams: effectiveGrams,
    quantity,
    unitLabel: selectedUnit.label,
    unitGrams: selectedUnit.grams,
    portions,
    source: food.source,
    source_ref: food.source_ref,
    per100g: food.per100g,
    ...recomputeMacros(food.per100g, effectiveGrams),
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
            // Use pointerDown so we fire before the name input's onBlur hides
            // any ancestor focus-based dropdown (we're not using onBlur here,
            // but this is good defensive practice).
            e.preventDefault();
            onSelect(food);
          }}
        >
          <span className={styles.dropdownName}>{food.name}</span>
          <span className={styles.dropdownMeta}>
            {food.per100g.calories} kcal/100g · {food.source.toUpperCase()}
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
}

function IngredientRowEditor({ row, onChange, onRemove, onOpenBarcode }: IngredientRowProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearch, setShowSearch] = useState(false);

  // ---- Async portion fetching for USDA foods ----
  // Runs whenever source_ref changes (i.e. a new USDA food is selected).
  // Cache lives at module level so it outlives component mount/unmount cycles.
  useEffect(() => {
    if (row.source !== 'usda' || !row.source_ref) return;

    const ref = row.source_ref;

    // Already cached — merge immediately without a network call.
    if (portionsCache.has(ref)) {
      const cached = portionsCache.get(ref)!;
      const merged = buildPortionList(row, cached);
      if (merged.length !== row.portions.length) {
        // Only update if the list actually changed (avoids infinite loop).
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
      // Silently ignore — the user still has 'g' and any serving option.
    });

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row.source_ref]);

  function handleNameChange(e: React.ChangeEvent<HTMLInputElement>) {
    const name = e.target.value;
    setSearchQuery(name);
    setShowSearch(true);
    // Keep typing into the name — clear per100g so it becomes manual mode.
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
    // If USDA food is already cached, build with full portions immediately.
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
      // Manual row: grams = quantity (unit is always 'g')
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
              // Small delay so pointerDown on a dropdown item fires first.
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
          {/* Barcode icon — display:block per iOS SVG rule */}
          <svg
            className={styles.barcodeIcon}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <rect x="2" y="4" width="3" height="16" rx="0.5" fill="currentColor" stroke="none" />
            <rect x="7" y="4" width="1.5" height="16" rx="0.5" fill="currentColor" stroke="none" />
            <rect x="10.5" y="4" width="2.5" height="16" rx="0.5" fill="currentColor" stroke="none" />
            <rect x="15" y="4" width="1.5" height="16" rx="0.5" fill="currentColor" stroke="none" />
            <rect x="18.5" y="4" width="3.5" height="16" rx="0.5" fill="currentColor" stroke="none" />
          </svg>
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

        {/* Zone 2: Macro fields — wrap together */}
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
// Helpers for building portions lists after a fetch
// ---------------------------------------------------------------------------

/** Build a full portions list for a food result given the fetched FoodPortion[]. */
function buildPortionListFromFetched(food: FoodSearchResult, fetched: FoodPortion[]): FoodPortion[] {
  const list: FoodPortion[] = [GRAMS_UNIT];
  // For USDA, append the fetched household portions.
  if (food.source === 'usda') {
    for (const p of fetched) {
      list.push(p);
    }
  }
  // For OFF/barcode with serving_grams, add serving option (deduplicate).
  if (food.source === 'off' && food.serving_grams) {
    list.push({ label: 'serving', grams: food.serving_grams });
  }
  return list;
}

/**
 * Merge newly-fetched portions into the current row's portions list,
 * starting from what the row already has (which includes 'g' + optional serving).
 * USDA: replace with [g, ...fetched].  OFF: keep existing (serving was set immediately).
 */
function buildPortionList(row: EditorRow, fetched: FoodPortion[]): FoodPortion[] {
  if (row.source === 'usda') {
    return [GRAMS_UNIT, ...fetched];
  }
  // OFF: already has its portions from immediatePortions
  return row.portions;
}

/**
 * Apply a new portions list to a row.  If the currently-selected unit still
 * exists in the new list, keep it; otherwise fall back to the first option.
 */
function applyNewPortions(row: EditorRow, newPortions: FoodPortion[]): EditorRow {
  const existing = newPortions.find(p => p.label === row.unitLabel);
  if (existing) {
    // Unit still valid — just update the portions list.
    return { ...row, portions: newPortions };
  }
  // Current unit is gone — switch to first non-g option if available, else g.
  const preferred = newPortions.length > 1 ? newPortions[1] : GRAMS_UNIT;
  const quantity = row.unitLabel === 'g' ? 1 : row.quantity; // reset qty to 1 if switching from g
  const effectiveGrams = quantity * preferred.grams;
  const macros = row.per100g ? recomputeMacros(row.per100g, effectiveGrams) : {};
  return {
    ...row,
    portions: newPortions,
    unitLabel: preferred.label,
    unitGrams: preferred.grams,
    quantity,
    grams: effectiveGrams,
    ...macros,
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
      calories: acc.calories + r.calories,
      protein_g: acc.protein_g + r.protein_g,
      carbs_g: acc.carbs_g + r.carbs_g,
      fat_g: acc.fat_g + r.fat_g,
    }),
    { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 },
  );

  return (
    <div className={styles.totals}>
      <span className={styles.totalsLabel}>Total</span>
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
export default function EntryEditor({ open, mode, onClose, onConfirm, onDeny }: EntryEditorProps) {
  const isEdit = mode.kind === 'manual-edit';
  const date = mode.date;

  // ----- Meal selector -----
  const [meal, setMeal] = useState<Meal>(() => {
    if (mode.kind === 'manual-edit') return mode.entry.meal;
    if (mode.kind === 'manual-add') return mode.defaultMeal ?? 'breakfast';
    // proposal
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
        // Edit mode: load with unit='g', quantity=stored grams (we don't persist the unit).
        quantity: ing.grams,
        unitLabel: 'g',
        unitGrams: 1,
        portions: [GRAMS_UNIT],
        per100g: null, // existing edit rows — macros already stored, not per100g
      }));
    }
    if (mode.kind === 'proposal') {
      // TODO Phase 2: wire proposal ingredients here
      return mode.proposal.ingredients.map(ing => ({
        ...ing,
        rowKey: nextKey(),
        quantity: ing.grams,
        unitLabel: 'g',
        unitGrams: 1,
        portions: [GRAMS_UNIT],
        per100g: null,
      }));
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

  // Reset form when the mode prop changes (e.g. open different entry).
  const modeKind = mode.kind;
  useEffect(() => {
    if (!open) return;
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
          per100g: null,
        })),
      );
    } else if (mode.kind === 'manual-add') {
      setMeal(mode.defaultMeal ?? 'breakfast');
      setEntryName('');
      setRows([emptyRow()]);
    }
    // proposal: TODO Phase 2 — keep form as-is for now
    setSaveError(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, modeKind]);

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
  // If the user left the entry name blank, fall back to the first ingredient's name.
  const firstValidIngredient = rows.find(r => r.name.trim().length > 0 && r.grams > 0);
  const effectiveName = entryName.trim() || firstValidIngredient?.name.trim() || '';

  const canSave =
    effectiveName.length > 0 &&
    rows.length > 0 &&
    !isPending;

  async function handleSave() {
    if (!canSave) return;
    setSaveError(null);

    // row.grams is always = quantity × unitGrams (effective grams) — the backend contract is unchanged.
    const ingredients: IngredientInput[] = rows.map(r => ({
      name: r.name,
      grams: r.grams,
      source: r.source,
      source_ref: r.source_ref ?? null,
      calories: r.calories,
      protein_g: r.protein_g,
      carbs_g: r.carbs_g,
      fat_g: r.fat_g,
    }));

    const input: EntryInput = {
      localDate: date,
      meal,
      name: effectiveName,
      source: 'manual',
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

  // ----- Proposal mode footer (Phase 2 wiring) -----
  function handleConfirm() {
    // TODO Phase 2: build EntryInput from current form state and call onConfirm
    if (onConfirm) {
      const ingredients: IngredientInput[] = rows.map(r => ({
        name: r.name,
        grams: r.grams,
        source: r.source,
        source_ref: r.source_ref ?? null,
        calories: r.calories,
        protein_g: r.protein_g,
        carbs_g: r.carbs_g,
        fat_g: r.fat_g,
      }));
      onConfirm({
        localDate: date,
        meal,
        name: effectiveName,
        source: 'manual',
        ingredients,
      });
    }
  }

  function handleDeny() {
    // TODO Phase 2: wire onDeny
    if (onDeny) onDeny();
  }

  const isProposal = mode.kind === 'proposal';

  const titleMap: Record<typeof modeKind, string> = {
    'manual-add': 'Add Food Entry',
    'manual-edit': 'Edit Food Entry',
    'proposal': 'Review Entry',
  };

  return (
    <>
      <Modal
        open={open}
        onOpenChange={(isOpen: boolean) => { if (!isOpen) onClose(); }}
        title={titleMap[modeKind]}
        showTitle={false}
        contentClassName={styles.modalContent}
      >
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
                {m.charAt(0).toUpperCase() + m.slice(1)}
              </button>
            ))}
          </div>

          {/* Entry name */}
          <div className={styles.field}>
            <label className={styles.fieldLabel} htmlFor="entry-name">
              Entry name
            </label>
            <input
              id="entry-name"
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

          {/* Save error */}
          {saveError && (
            <p className={styles.errorMsg}>{saveError}</p>
          )}

          {/* Footer */}
          <div className={styles.footer}>
            {isProposal ? (
              <>
                {/* TODO Phase 2: these buttons call onConfirm/onDeny */}
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
      </Modal>

      {/* Barcode scanner renders outside the modal (above it) */}
      {scanningRowKey !== null && (
        <BarcodeScanner
          onDetected={handleBarcodeDetected}
          onClose={handleBarcodeClose}
        />
      )}
    </>
  );
}
