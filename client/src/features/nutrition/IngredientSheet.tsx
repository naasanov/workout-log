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
  scaleRowMacros,
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
            {/* #228 — custom foods derive per100g by dividing totals by
                total_grams, which yields long repeating decimals; round for
                display only, the stored/computed value is untouched. */}
            {Math.round(food.per100g.calories)} kcal/100g ·{' '}
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

  // #219 — while the user is mid-edit clearing the grams/quantity field, the
  // input must visibly go empty WITHOUT ever committing quantity/grams: 0 (or
  // NaN) into `row`. Committing a 0 there would make scaleRowMacros scale
  // every macro to 0 and, once macros are 0, there's no baseline left to
  // derive from on the next keystroke — the "1.5g protein stays 1.5g, then
  // becomes 3g" scaling described in #219 would be gone for good. So instead:
  // empty/zero/invalid input is tracked purely as local display text here,
  // `row` (and therefore the macro fields, which read straight off `row`)
  // stays frozen at its last real values, however long the field sits empty.
  // Cleared automatically whenever `row` changes for a reason other than this
  // field's own commits (new row loaded, food/barcode selected, unit changed).
  const [frozenQuantityText, setFrozenQuantityText] = useState<string | null>(null);
  useEffect(() => {
    setFrozenQuantityText(null);
  }, [row.rowKey, row.quantity, row.unitLabel]);

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
            // #229 — meals were always expanding to their FULL-BATCH amounts
            // (ing.grams as stored), so selecting a custom meal from search
            // silently defaulted the serving size to "make the whole batch".
            // If the meal has at least one defined serving, scale every
            // expanded ingredient down to the first defined serving instead.
            // Guard total_grams <= 0 (or missing) — nothing sound to scale
            // from, so fall back to today's full-batch expansion rather than
            // dividing by zero (same spirit as scaleRowMacros's guards).
            const firstServing = customFood.servings[0];
            const scale =
              firstServing && customFood.total_grams > 0
                ? firstServing.grams / customFood.total_grams
                : 1;
            const expandedRows: EditorRow[] = customFood.ingredients.map(ing => ({
              rowKey: nextKey(),
              name: ing.name,
              grams: round2(ing.grams * scale),
              quantity: round2(ing.grams * scale),
              unitLabel: 'g',
              unitGrams: 1,
              portions: [GRAMS_UNIT],
              source: ing.source as IngredientSource,
              source_ref: ing.source_ref ?? null,
              calories: round2(ing.calories * scale),
              protein_g: round2(ing.protein_g * scale),
              carbs_g: round2(ing.carbs_g * scale),
              fat_g: round2(ing.fat_g * scale),
              fiber_g: ing.fiber_g != null ? round2(ing.fiber_g * scale) : null,
              sugar_g: ing.sugar_g != null ? round2(ing.sugar_g * scale) : null,
              sodium_mg: ing.sodium_mg != null ? round2(ing.sodium_mg * scale) : null,
              per100g: null,
            }));
            onExpandMeal(expandedRows);
          })
          .catch(() => {
            // #199: preserve the row's identity so this replaces the row being
            // edited instead of appending a duplicate untitled row.
            onChange(rowFromFood(food, immediatePortions(food), row.rowKey));
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
    // #199: preserve the row's identity so this replaces the row being edited
    // instead of appending a duplicate untitled row.
    onChange(rowFromFood(food, portions, row.rowKey));
  }

  // #185 — quantity/unit changes must scale macros even when the row has no
  // per100g snapshot (hand-typed macros, or a snapshot lost via
  // handleNameChange). scaleRowMacros derives a baseline from the row's
  // current macros ÷ current grams in that case, so this always scales.
  //
  // #219 — an empty (or genuinely zero/invalid) grams field is deliberately
  // NOT committed to `row` at all: `parseFloat('') || 0` used to coerce empty
  // straight to 0 and write it through, which zeroed every macro and wiped
  // out the baseline scaleRowMacros needs for the *next* edit (see the block
  // comment on scaleRowMacros). Instead, freeze — track the raw text locally
  // so the field still visibly reads empty, but leave quantity/grams/macros
  // untouched until a real positive number is typed, however long that takes.
  function handleQuantityChange(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value;
    const parsed = parseFloat(raw);
    if (raw.trim() === '' || Number.isNaN(parsed) || parsed <= 0) {
      setFrozenQuantityText(raw);
      return;
    }
    setFrozenQuantityText(null);
    const effectiveGrams = parsed * row.unitGrams;
    onChange({ ...row, quantity: parsed, grams: effectiveGrams, ...scaleRowMacros(row, effectiveGrams) });
  }

  function handleUnitChange(e: React.ChangeEvent<HTMLSelectElement>) {
    setFrozenQuantityText(null);
    const label = e.target.value;
    const selected = row.portions.find(p => p.label === label) ?? GRAMS_UNIT;
    const effectiveGrams = row.quantity * selected.grams;
    onChange({
      ...row,
      unitLabel: selected.label,
      unitGrams: selected.grams,
      grams: effectiveGrams,
      ...scaleRowMacros(row, effectiveGrams),
    });
  }

  // Only reachable when macrosReadOnly is false (row.per100g === null): the
  // user is hand-entering a macro value. No separate "re-baseline" step is
  // needed — scaleRowMacros (#185) always derives its baseline from the row's
  // CURRENT macros/grams, so this edit automatically becomes the reference
  // for the next quantity/unit change.
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
            value={frozenQuantityText !== null ? frozenQuantityText : (row.quantity === 0 ? '' : row.quantity)}
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
      // #199: preserve the row's identity (functional update to avoid taking
      // a `row` dependency) so this replaces the row being edited instead of
      // appending a duplicate untitled row.
      setRow(prev => rowFromFood(food, undefined, prev.rowKey));
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

            {/* #227 — manual dismiss only, no auto-hide timer. */}
            {barcodeError && (
              <div className={styles.noticeRow}>
                <p className={styles.noticeText}>{barcodeError}</p>
                <button
                  type="button"
                  className={styles.noticeDismiss}
                  onClick={() => setBarcodeError(null)}
                  aria-label="Dismiss barcode error"
                >
                  <X size={14} aria-hidden="true" style={{ display: 'block' }} />
                </button>
              </div>
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
