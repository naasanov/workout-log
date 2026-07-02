/**
 * MyFoodsSheet — Full-screen bottom-sheet library of the user's custom foods & meals.
 *
 * Features:
 * - Follows the NutritionChat custom sheet pattern (NOT Radix Dialog)
 * - Search box filtering the library
 * - MEALS and FOODS sections with New Meal / New Food buttons
 * - Row tap → opens MealBuilder to edit
 * - Per-row overflow menu with Duplicate and Delete
 * - Draft rows badged "Draft"
 * - List macros: first custom serving macros if available, else per-100g
 */
import {
  useState,
  useEffect,
  useRef,
  useCallback,
} from 'react';
import { useCustomFoods, useDeleteCustomFood, useDuplicateCustomFood } from './api';
import type { CustomFoodRow } from './types';
import MealBuilder from './MealBuilder';
import ConfirmModal from '../../components/ConfirmModal';
import styles from './MyFoodsSheet.module.scss';
import { X, MoreVertical, Search, Plus } from 'lucide-react';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Get the display macros for a food row (first custom serving or per-100g). */
function displayMacros(item: CustomFoodRow) {
  if (item.servings.length > 0) {
    const s = item.servings[0];
    const g = s.grams;
    const f = g / 100;
    return {
      grams: g,
      calories: round2(item.per100g.calories * f),
      protein_g: round2(item.per100g.protein_g * f),
      carbs_g: round2(item.per100g.carbs_g * f),
      fat_g: round2(item.per100g.fat_g * f),
      label: s.label,
    };
  }
  return {
    grams: 100,
    calories: round2(item.per100g.calories),
    protein_g: round2(item.per100g.protein_g),
    carbs_g: round2(item.per100g.carbs_g),
    fat_g: round2(item.per100g.fat_g),
    label: '100g',
  };
}

// ---------------------------------------------------------------------------
// Row overflow menu
// ---------------------------------------------------------------------------
interface RowMenuProps {
  item: CustomFoodRow;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}

function RowMenu({ item, onEdit, onDuplicate, onDelete }: RowMenuProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    function outside(e: MouseEvent | TouchEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', outside);
    document.addEventListener('touchstart', outside, { passive: true });
    return () => {
      document.removeEventListener('mousedown', outside);
      document.removeEventListener('touchstart', outside);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { setOpen(false); btnRef.current?.focus(); }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <div className={styles.rowMenuWrapper} ref={wrapRef}>
      <button
        ref={btnRef}
        className={styles.dotsBtn}
        onClick={e => { e.stopPropagation(); setOpen(v => !v); }}
        aria-label={`Options for ${item.name}`}
        aria-haspopup="true"
        aria-expanded={open}
      >
        <MoreVertical size={16} aria-hidden="true" style={{ display: 'block' }} />
      </button>
      {open && (
        <div className={styles.rowDropdown} role="menu">
          <button className={styles.dropdownItem} role="menuitem"
            onClick={() => { setOpen(false); onEdit(); }}>
            Edit
          </button>
          <button className={styles.dropdownItem} role="menuitem"
            onClick={() => { setOpen(false); onDuplicate(); }}>
            Duplicate
          </button>
          <button className={`${styles.dropdownItem} ${styles.dropdownItemDanger}`} role="menuitem"
            onClick={() => { setOpen(false); onDelete(); }}>
            Delete
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Single food row
// ---------------------------------------------------------------------------
interface FoodRowProps {
  item: CustomFoodRow;
  onTap: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}

function FoodRow({ item, onTap, onDuplicate, onDelete }: FoodRowProps) {
  const macros = displayMacros(item);
  return (
    <div className={styles.foodRow} role="button" tabIndex={0}
      onClick={onTap}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onTap(); } }}>
      <div className={styles.foodRowTop}>
        <div className={styles.foodRowLeft}>
          <span className={styles.foodName}>{item.name}</span>
          {item.status === 'draft' && <span className={styles.draftBadge}>Draft</span>}
          {item.notes && <span className={styles.foodNotes}>{item.notes}</span>}
        </div>
        <RowMenu item={item} onEdit={onTap} onDuplicate={onDuplicate} onDelete={onDelete} />
      </div>
      <div className={styles.foodMacros}>
        <span className={styles.macroCalories}>{Math.round(macros.calories)} kcal</span>
        <span className={styles.macroServingLabel}>/ {macros.label}</span>
        <div className={styles.macroChips}>
          <span className={styles.chip}>{round2(macros.protein_g)}g P</span>
          <span className={styles.chip}>{round2(macros.carbs_g)}g C</span>
          <span className={styles.chip}>{round2(macros.fat_g)}g F</span>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main sheet
// ---------------------------------------------------------------------------
interface MyFoodSheetProps {
  open: boolean;
  onClose: () => void;
}

export default function MyFoodsSheet({ open, onClose }: MyFoodSheetProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [builderOpen, setBuilderOpen] = useState(false);
  const [builderKind, setBuilderKind] = useState<'food' | 'meal'>('meal');
  const [editingDraft, setEditingDraft] = useState<CustomFoodRow | null>(null);
  const [pendingDelete, setPendingDelete] = useState<CustomFoodRow | null>(null);

  const { data: allItems = [], isLoading, refetch } = useCustomFoods();
  const deleteMutation = useDeleteCustomFood();
  const duplicateMutation = useDuplicateCustomFood();

  // Refetch on open
  useEffect(() => {
    if (open) refetch();
  }, [open, refetch]);

  const q = searchQuery.toLowerCase().trim();
  const filtered = q
    ? allItems.filter(item => item.name.toLowerCase().includes(q))
    : allItems;

  const meals = filtered.filter(item => item.kind === 'meal');
  const foods = filtered.filter(item => item.kind === 'food');

  const openBuilder = useCallback((kind: 'food' | 'meal', draft?: CustomFoodRow) => {
    setBuilderKind(kind);
    setEditingDraft(draft ?? null);
    setBuilderOpen(true);
  }, []);

  function handleDuplicate(item: CustomFoodRow) {
    duplicateMutation.mutate(item.id, {
      onSuccess: () => refetch(),
    });
  }

  function handleDeleteConfirm() {
    if (!pendingDelete) return;
    deleteMutation.mutate(pendingDelete.id, {
      onSuccess: () => { setPendingDelete(null); refetch(); },
    });
  }

  function handleBuilderSaved() {
    setBuilderOpen(false);
    refetch();
  }

  if (!open) return null;

  return (
    <>
      <div className={styles.overlay} onClick={onClose} aria-hidden="true" />

      <div className={styles.sheet} role="dialog" aria-modal="true" aria-label="My Foods">
        {/* Header */}
        <div className={styles.header}>
          <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="Close My Foods">
            <X size={16} aria-hidden="true" style={{ display: 'block' }} />
          </button>
          <h2 className={styles.title}>My Foods</h2>
        </div>

        {/* Search */}
        <div className={styles.searchWrap}>
          <Search size={16} className={styles.searchIcon} aria-hidden="true" />
          <input
            className={styles.searchInput}
            type="search"
            placeholder="Search your library…"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            aria-label="Search custom foods"
          />
        </div>

        {/* Content */}
        <div className={styles.content}>
          {isLoading && <p className={styles.hint}>Loading…</p>}

          {!isLoading && allItems.length === 0 && !searchQuery && (
            <p className={styles.hint}>
              You haven't saved any custom foods or meals yet. Tap New Meal or New Food to get started.
            </p>
          )}

          {!isLoading && q && filtered.length === 0 && (
            <p className={styles.hint}>No results for "{searchQuery}"</p>
          )}

          {/* MEALS section */}
          <div className={styles.section}>
            <div className={styles.sectionHeader}>
              <span className={styles.sectionTitle}>Meals</span>
              <button
                type="button"
                className={styles.newBtn}
                onClick={() => openBuilder('meal')}
                aria-label="New Meal"
              >
                <Plus size={14} aria-hidden="true" style={{ display: 'block' }} />
                New Meal
              </button>
            </div>
            {meals.length > 0 ? (
              <div className={styles.foodList}>
                {meals.map(item => (
                  <FoodRow
                    key={item.id}
                    item={item}
                    onTap={() => openBuilder('meal', item)}
                    onDuplicate={() => handleDuplicate(item)}
                    onDelete={() => setPendingDelete(item)}
                  />
                ))}
              </div>
            ) : (
              !isLoading && <p className={styles.emptySection}>No meals{q ? ' matching your search' : ' saved yet'}.</p>
            )}
          </div>

          {/* FOODS section */}
          <div className={styles.section}>
            <div className={styles.sectionHeader}>
              <span className={styles.sectionTitle}>Foods</span>
              <button
                type="button"
                className={styles.newBtn}
                onClick={() => openBuilder('food')}
                aria-label="New Food"
              >
                <Plus size={14} aria-hidden="true" style={{ display: 'block' }} />
                New Food
              </button>
            </div>
            {foods.length > 0 ? (
              <div className={styles.foodList}>
                {foods.map(item => (
                  <FoodRow
                    key={item.id}
                    item={item}
                    onTap={() => openBuilder('food', item)}
                    onDuplicate={() => handleDuplicate(item)}
                    onDelete={() => setPendingDelete(item)}
                  />
                ))}
              </div>
            ) : (
              !isLoading && <p className={styles.emptySection}>No foods{q ? ' matching your search' : ' saved yet'}.</p>
            )}
          </div>
        </div>
      </div>

      {/* MealBuilder for create/edit */}
      <MealBuilder
        open={builderOpen}
        kind={builderKind}
        initialDraft={editingDraft}
        onClose={() => setBuilderOpen(false)}
        onSaved={handleBuilderSaved}
      />

      {/* Delete confirm */}
      {pendingDelete !== null && (
        <ConfirmModal
          message={`Delete "${pendingDelete.name}"?`}
          onConfirm={handleDeleteConfirm}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </>
  );
}
