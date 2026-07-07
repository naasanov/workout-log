/**
 * IngredientSheet — reusable bottom-sheet editor for a single ingredient row.
 *
 * Implemented as a Radix Dialog so it participates in Radix's focus/pointer-events
 * layer stack. This means it works correctly when opened from inside another Radix
 * Dialog (e.g. Add-Food modal, Edit-Entry modal, MyFoodsSheet) — nested Radix
 * Dialogs are NOT inert-marked by the parent. It also works fine when opened from
 * the inline chat proposal card (not inside any dialog).
 *
 * Usage pattern (two sub-components exported):
 *   <IngredientCardList>   — renders the static summary cards. The "Add ingredient"
 *                            action lives in the caller's heading row (see EntryEditor /
 *                            MealBuilder), not here — callers wire it to the same
 *                            handler they pass in as `onAddRow` when opening the sheet.
 *   <IngredientSheet>      — the actual sheet (controls its own open state via onClose).
 *
 * Callers (EntryEditor, MealBuilder) lift the state: they own the `rows` array
 * and call sheet callbacks to add / update / remove rows.
 */
import {
  useState,
  useEffect,
  useCallback,
} from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import BarcodeScanner from './BarcodeScanner';
import { useFoodSearch, lookupBarcode, getPortions, getCustomFood } from './api';
import type {
  FoodSearchResult,
  FoodPortion,
  IngredientSource,
} from './types';
import styles from './IngredientSheet.module.scss';
import { X, Trash2, ChevronRight, ScanBarcode } from 'lucide-react';
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
// Search dropdown inside the sheet
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
      {isFetching && <li className={styles.dropdownHint}>Searching…</li>}
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
            {food.per100g.calories} kcal/100g ·{' '}
            {food.source === 'custom'
              ? food.kind === 'meal'
                ? 'Custom · Meal'
                : 'Custom · Food'
              : food.source.toUpperCase()}
          </span>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// The single-ingredient form rendered inside the sheet
// ---------------------------------------------------------------------------
interface IngredientFormProps {
  row: EditorRow;
  onChange: (updated: EditorRow) => void;
  onExpandMeal?: (rows: EditorRow[]) => void;
  /** Called when user taps the barcode button inside the sheet */
  onOpenBarcode: () => void;
}

function IngredientForm({ row, onChange, onExpandMeal, onOpenBarcode }: IngredientFormProps) {
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
    getPortions('usda', ref)
      .then(fetched => {
        if (cancelled) return;
        portionsCache.set(ref, fetched);
        const merged = buildPortionList(row, fetched);
        onChange(applyNewPortions(row, merged));
      })
      .catch(() => {/* silently ignore — 'g' still available */});

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

    // Custom meal: expand its ingredients as a snapshot
    if (food.source === 'custom' && food.kind === 'meal' && onExpandMeal) {
      const id = parseInt(food.source_ref, 10);
      if (!isNaN(id)) {
        getCustomFood(id)
          .then(customFood => {
            const expandedRows: EditorRow[] = customFood.ingredients.map(ing => ({
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
          })
          .catch(() => {
            onChange(rowFromFood(food, immediatePortions(food)));
          });
        return;
      }
    }

    const cached =
      food.source === 'usda' && food.source_ref
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

  function handleMacroChange(
    field: 'calories' | 'protein_g' | 'carbs_g' | 'fat_g',
    value: string,
  ) {
    onChange({ ...row, [field]: parseFloat(value) || 0 });
  }

  const macrosReadOnly = row.per100g !== null;
  const showUnitDropdown = row.portions.length > 1;

  return (
    <>
      {/* Name + barcode */}
      <div className={styles.nameRow}>
        <div className={styles.nameInputWrap}>
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

      {/* Qty + Unit */}
      <div className={styles.portionRow}>
        <label className={styles.fieldLabel} aria-label="Quantity">
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
          <label className={styles.fieldLabel}>
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
          <label className={styles.fieldLabel}>
            <span>Unit</span>
            <span className={styles.unitStatic}>g</span>
          </label>
        )}
      </div>

      {/* Macro fields */}
      <div className={styles.macrosSection}>
        <span className={styles.macrosSectionLabel}>Macros</span>
        <div className={styles.macrosGrid}>
          <label className={styles.fieldLabel}>
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
          <label className={styles.fieldLabel}>
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
          <label className={styles.fieldLabel}>
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
          <label className={styles.fieldLabel}>
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
        {macrosReadOnly && (
          <p className={styles.rowHint}>
            Macros computed from per-100g values · adjust qty/unit to recalculate
          </p>
        )}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// IngredientSheet — the Radix Dialog bottom sheet
// ---------------------------------------------------------------------------
export interface IngredientSheetProps {
  /**
   * When open, the sheet is visible.
   * If editRow is provided, the sheet opens in "edit" mode (pre-filled + Delete button).
   * If editRow is null/undefined, the sheet opens in "add" mode (blank form + Add action).
   */
  open: boolean;
  editRow?: EditorRow | null;
  onClose: () => void;
  /** Called with the new/updated row when Done is tapped. */
  onDone: (row: EditorRow) => void;
  /** Called when Delete is tapped in edit mode. */
  onDelete?: () => void;
  /**
   * Called when the user selects a custom meal that should expand into multiple rows.
   * The sheet closes itself and passes the expanded rows up.
   */
  onExpandMeal?: (rows: EditorRow[]) => void;
}

export default function IngredientSheet({
  open,
  editRow,
  onClose,
  onDone,
  onDelete,
  onExpandMeal,
}: IngredientSheetProps) {
  const isEdit = editRow != null;
  const [row, setRow] = useState<EditorRow>(() => editRow ?? emptyRow());
  const [barcodeOpen, setBarcodeOpen] = useState(false);
  const [barcodeError, setBarcodeError] = useState<string | null>(null);

  // Reset inner state whenever the sheet opens or switches to a different row.
  useEffect(() => {
    if (open) {
      setRow(editRow ?? emptyRow());
      setBarcodeError(null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editRow?.rowKey]);

  const handleOpenBarcode = useCallback(() => {
    setBarcodeError(null);
    setBarcodeOpen(true);
  }, []);

  const handleBarcodeDetected = useCallback(async (code: string) => {
    setBarcodeOpen(false);
    try {
      const food = await lookupBarcode(code);
      if (!food) {
        setBarcodeError(`Barcode ${code} not found in database.`);
        return;
      }
      setRow(rowFromFood(food));
    } catch {
      setBarcodeError('Failed to look up barcode. Try again.');
    }
  }, []);

  const handleExpandMeal = useCallback((expandedRows: EditorRow[]) => {
    onExpandMeal?.(expandedRows);
    onClose();
  }, [onExpandMeal, onClose]);

  const handleDone = useCallback(() => {
    onDone(row);
    onClose();
  }, [row, onDone, onClose]);

  const handleDelete = useCallback(() => {
    onDelete?.();
    onClose();
  }, [onDelete, onClose]);

  const title = isEdit ? 'Edit ingredient' : 'Add ingredient';
  const canDone = row.name.trim().length > 0;

  return (
    <Dialog.Root open={open} onOpenChange={isOpen => { if (!isOpen) onClose(); }}>
      <Dialog.Portal>
        {/* Scrim overlay */}
        <Dialog.Overlay className={styles.overlay} />

        {/* Sheet panel */}
        <Dialog.Content
          className={styles.sheet}
          aria-label={title}
          // Prevent auto-focus from jumping unexpectedly (mobile UX)
          onOpenAutoFocus={e => e.preventDefault()}
          // Stop Escape from bubbling up and closing the parent dialog.
          // Radix will still close THIS dialog via onOpenChange → onClose.
          onEscapeKeyDown={e => e.stopPropagation()}
        >
          <Dialog.Title className={styles.srOnly}>{title}</Dialog.Title>

          {/* Header */}
          <div className={styles.header}>
            <button
              type="button"
              className={styles.closeBtn}
              onClick={onClose}
              aria-label="Close"
            >
              <X size={16} aria-hidden="true" style={{ display: 'block' }} />
            </button>
            <h2 className={styles.headerTitle}>{title}</h2>
            <button
              type="button"
              className={styles.doneBtn}
              onClick={handleDone}
              disabled={!canDone}
            >
              {isEdit ? 'Done' : 'Add'}
            </button>
          </div>

          {/* Form */}
          <div className={styles.body}>
            <IngredientForm
              row={row}
              onChange={setRow}
              onOpenBarcode={handleOpenBarcode}
              onExpandMeal={onExpandMeal ? handleExpandMeal : undefined}
            />

            {barcodeError && (
              <p className={styles.rowHint} style={{ color: 'var(--error, #ED1518)' }}>
                {barcodeError}
              </p>
            )}

            {/* Delete button — only shown in edit mode */}
            {isEdit && onDelete && (
              <button
                type="button"
                className={styles.deleteBtn}
                onClick={handleDelete}
              >
                <Trash2 size={16} aria-hidden="true" style={{ display: 'block' }} />
                Delete ingredient
              </button>
            )}
          </div>
        </Dialog.Content>

        {/* Barcode scanner — rendered inside the same portal layer */}
        {barcodeOpen && (
          <BarcodeScanner
            onDetected={handleBarcodeDetected}
            onClose={() => setBarcodeOpen(false)}
          />
        )}
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// ---------------------------------------------------------------------------
// IngredientCardList — static summary cards + "Add ingredient" button.
// Rendered in the editor view (not portaled).
// ---------------------------------------------------------------------------
export interface IngredientCardListProps {
  rows: EditorRow[];
  /** Called with the row that was tapped — caller opens the sheet in edit mode. */
  onEditRow: (row: EditorRow) => void;
}

export function IngredientCardList({ rows, onEditRow }: IngredientCardListProps) {
  return (
    <div className={styles.cardList}>
      {rows.map(row => (
        <button
          key={row.rowKey}
          type="button"
          className={styles.card}
          onClick={() => onEditRow(row)}
          aria-label={`Edit ${row.name || 'ingredient'}`}
        >
          <div className={styles.cardContent}>
            <span className={styles.cardName}>
              {row.name || <span style={{ opacity: 0.4 }}>Untitled ingredient</span>}
            </span>
            <div className={styles.cardMacros}>
              <span className={styles.cardCalories}>
                {Math.round(row.calories)} kcal
              </span>
              <div className={styles.macroChips}>
                <span className={styles.chip}>P {round2(row.protein_g)}g</span>
                <span className={styles.chip}>C {round2(row.carbs_g)}g</span>
                <span className={styles.chip}>F {round2(row.fat_g)}g</span>
              </div>
            </div>
          </div>
          <ChevronRight
            className={styles.cardChevron}
            size={16}
            aria-hidden="true"
          />
        </button>
      ))}
    </div>
  );
}
