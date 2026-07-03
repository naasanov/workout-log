import { useState, useRef, useEffect } from 'react';
import { useDay, useGoals, useDeleteEntry, useCreateEntry, useRecentCustomFoods, getCustomFood } from './api';
import EntryEditor from './EntryEditor';
import NutritionGoalsModal from './NutritionGoalsModal';
import NutritionChat from './NutritionChat';
import MyFoodsSheet from './MyFoodsSheet';
import MealBuilder from './MealBuilder';
import ConfirmModal from '../../components/ConfirmModal.jsx';
import type { EntryEditorMode, EntryRow, Meal, IngredientInput } from './types';
import { MEALS, MEAL_LABELS } from './types';
import styles from './NutritionTracker.module.scss';
import { MoreVertical, ChevronLeft, ChevronRight, Target, BookMarked } from 'lucide-react';

// ---- Helpers ----

function getTodayLocalDate(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function shiftDate(dateStr: string, days: number): string {
  const [y, mo, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, mo - 1, d + days);
  const ny = dt.getFullYear();
  const nm = String(dt.getMonth() + 1).padStart(2, '0');
  const nd = String(dt.getDate()).padStart(2, '0');
  return `${ny}-${nm}-${nd}`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

// ---- Progress bar ----

interface ProgressBarProps {
  value: number;
  goal: number;
  color?: string;
}

function ProgressBar({ value, goal }: ProgressBarProps) {
  const pct = goal > 0 ? clamp((value / goal) * 100, 0, 100) : 0;
  const over = goal > 0 && value > goal;
  return (
    <div className={styles.progressTrack}>
      <div
        className={`${styles.progressFill} ${over ? styles.progressFillOver : ''}`}
        style={{ width: `${pct}%` }}
        role="progressbar"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
      />
    </div>
  );
}

// ---- Three-dots entry menu (#72) ----

interface EntryMenuProps {
  entry: EntryRow;
  onEdit: (entry: EntryRow) => void;
  onDelete: (entry: EntryRow) => void;
  onSaveAsMeal?: (entry: EntryRow) => void;
}

function EntryMenu({ entry, onEdit, onDelete, onSaveAsMeal }: EntryMenuProps) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  // Close on outside tap/click
  useEffect(() => {
    if (!open) return;
    function handleOutside(e: MouseEvent | TouchEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('touchstart', handleOutside, { passive: true });
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('touchstart', handleOutside);
    };
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false);
        btnRef.current?.focus();
      }
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open]);

  return (
    <div className={styles.entryMenuWrapper} ref={wrapperRef}>
      <button
        ref={btnRef}
        className={styles.dotsBtn}
        onClick={() => setOpen(v => !v)}
        aria-label={`Options for ${entry.name}`}
        aria-haspopup="true"
        aria-expanded={open}
      >
        <MoreVertical className={styles.dotsIcon} size={16} aria-hidden="true" />
      </button>

      {open && (
        <div className={styles.entryDropdown} role="menu">
          <button
            className={styles.entryDropdownItem}
            role="menuitem"
            onClick={() => { setOpen(false); onEdit(entry); }}
          >
            Edit
          </button>
          {onSaveAsMeal && (
            <button
              className={styles.entryDropdownItem}
              role="menuitem"
              onClick={() => { setOpen(false); onSaveAsMeal(entry); }}
            >
              Save as meal
            </button>
          )}
          <button
            className={`${styles.entryDropdownItem} ${styles.entryDropdownItemDanger}`}
            role="menuitem"
            onClick={() => { setOpen(false); onDelete(entry); }}
          >
            Delete
          </button>
        </div>
      )}
    </div>
  );
}

// ---- Recently used custom foods row ----

interface RecentlyUsedRowProps {
  selectedDate: string;
  defaultMeal?: Meal;
}

function RecentlyUsedRow({ selectedDate, defaultMeal }: RecentlyUsedRowProps) {
  const { data: recent = [] } = useRecentCustomFoods(4);
  const createEntry = useCreateEntry(selectedDate);

  async function handleQuickReLog(food: { name: string; source: string; source_ref: string; per100g: any; portions?: any[] | null }) {
    try {
      const id = parseInt(food.source_ref, 10);
      if (isNaN(id)) return;
      const customFood = await getCustomFood(id);

      let grams = customFood.total_grams;
      if (customFood.servings.length > 0) {
        grams = customFood.servings[0].grams;
      }

      const scaleFactor = grams / (customFood.total_grams || 1);
      const ingredients: IngredientInput[] = customFood.ingredients.map(ing => ({
        name: ing.name,
        grams: Math.round(ing.grams * scaleFactor * 10) / 10,
        source: 'custom' as const,
        source_ref: ing.source_ref ?? null,
        calories: Math.round(ing.calories * scaleFactor * 100) / 100,
        protein_g: Math.round(ing.protein_g * scaleFactor * 100) / 100,
        carbs_g: Math.round(ing.carbs_g * scaleFactor * 100) / 100,
        fat_g: Math.round(ing.fat_g * scaleFactor * 100) / 100,
        fiber_g: ing.fiber_g != null ? Math.round(ing.fiber_g * scaleFactor * 100) / 100 : null,
        sugar_g: ing.sugar_g != null ? Math.round(ing.sugar_g * scaleFactor * 100) / 100 : null,
        sodium_mg: ing.sodium_mg != null ? Math.round(ing.sodium_mg * scaleFactor * 100) / 100 : null,
      }));

      await createEntry.mutateAsync({
        localDate: selectedDate,
        meal: defaultMeal ?? 'breakfast',
        name: food.name,
        source: 'custom',
        ingredients,
        from_custom_food_id: id,
      });
    } catch {
      // Silently ignore
    }
  }

  if (recent.length === 0) return null;

  return (
    <div className={styles.recentRow}>
      <span className={styles.recentLabel}>Recently used</span>
      <div className={styles.recentItems}>
        {recent.map(food => (
          <button
            key={food.source_ref}
            type="button"
            className={styles.recentItem}
            onClick={() => handleQuickReLog(food)}
            aria-label={`Quick re-log ${food.name}`}
            title={`Quick re-log: ${food.name}`}
          >
            <span className={styles.recentName}>{food.name}</span>
            <span className={styles.recentMeta}>{Math.round(food.per100g.calories)} kcal/100g</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ---- Main component ----

export default function NutritionTracker() {
  const [selectedDate, setSelectedDate] = useState<string>(getTodayLocalDate);

  // Editor state
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorMode, setEditorMode] = useState<EntryEditorMode>({
    kind: 'manual-add',
    date: selectedDate,
  });

  // AI chat
  const [chatOpen, setChatOpen] = useState(false);

  // Goals modal
  const [goalsModalOpen, setGoalsModalOpen] = useState(false);

  // My Foods sheet
  const [myFoodsOpen, setMyFoodsOpen] = useState(false);

  // Meal builder (Save as meal)
  const [mealBuilderOpen, setMealBuilderOpen] = useState(false);
  const [mealBuilderPrefillRows, setMealBuilderPrefillRows] = useState<any[]>([]);

  // Pending delete
  const [pendingDeleteEntry, setPendingDeleteEntry] = useState<EntryRow | null>(null);

  const dayQuery = useDay(selectedDate);
  const goalsQuery = useGoals();
  const deleteMutation = useDeleteEntry(selectedDate);

  const data = dayQuery.data;
  const goals = goalsQuery.data ?? {};

  // ---- Handlers ----

  function handlePrevDay() {
    setSelectedDate(prev => shiftDate(prev, -1));
  }

  function handleNextDay() {
    setSelectedDate(prev => shiftDate(prev, 1));
  }

  function openAddEditor() {
    setEditorMode({ kind: 'manual-add', date: selectedDate });
    setEditorOpen(true);
  }

  function openEditEditor(entry: EntryRow) {
    setEditorMode({ kind: 'manual-edit', date: selectedDate, entry });
    setEditorOpen(true);
  }

  function handleEditorClose() {
    setEditorOpen(false);
  }

  function handleSaveAsMeal(entry: EntryRow) {
    // Map entry ingredients to builder rows
    const prefillRows = entry.ingredients.map((ing, i) => ({
      rowKey: i + 1,
      name: ing.name,
      grams: ing.grams,
      quantity: ing.grams,
      unitLabel: 'g',
      unitGrams: 1,
      portions: [{ label: 'g', grams: 1 }],
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
    setMealBuilderPrefillRows(prefillRows);
    setMealBuilderOpen(true);
  }

  function handleDeleteConfirm() {
    if (!pendingDeleteEntry) return;
    const id = pendingDeleteEntry.id;
    setPendingDeleteEntry(null);
    deleteMutation.mutate(id);
  }

  // ---- Render ----

  const totals = data?.totals;
  const entries = data?.entries ?? [];

  // Group entries by meal in MEALS order
  const grouped = MEALS.map(meal => ({
    meal,
    entries: entries.filter(e => e.meal === meal),
  })).filter(g => g.entries.length > 0);

  const mealLabel = (meal: Meal) => MEAL_LABELS[meal];

  return (
    <section className={styles.container}>
      {/* Date nav */}
      <div className={styles.dateNav}>
        <button
          className={styles.arrowBtn}
          onClick={handlePrevDay}
          aria-label="Previous day"
        >
          <ChevronLeft className={styles.arrowIcon} size={16} aria-hidden="true" />
        </button>

        <input
          className={styles.dateInput}
          type="date"
          value={selectedDate}
          onChange={e => setSelectedDate(e.target.value)}
          aria-label="Select date"
        />

        <button
          className={styles.arrowBtn}
          onClick={handleNextDay}
          aria-label="Next day"
        >
          <ChevronRight className={styles.arrowIcon} size={16} aria-hidden="true" />
        </button>
      </div>

      {/* Actions row — Feedback button removed (#60: moved to Header) */}
      <div className={styles.actions}>
        <button className={styles.addBtn} onClick={openAddEditor}>
          + Add food
        </button>

        <button
          className={styles.aiBtn}
          onClick={() => setChatOpen(true)}
          aria-label="Ask AI"
          title="AI-powered food logging"
        >
          Ask AI
        </button>

        {/* Goals button — #73: bullseye/target icon instead of sun-like glyph */}
        <button
          className={styles.settingsBtn}
          onClick={() => setGoalsModalOpen(true)}
          aria-label="Nutrition goals"
          title="Set nutrition goals"
        >
          <Target className={styles.settingsIcon} size={16} aria-hidden="true" />
        </button>

        {/* My Foods button */}
        <button
          className={styles.settingsBtn}
          onClick={() => setMyFoodsOpen(true)}
          aria-label="My Foods"
          title="My custom foods and meals"
        >
          <BookMarked className={styles.settingsIcon} size={16} aria-hidden="true" />
        </button>
      </div>

      {/* Totals card */}
      <div className={styles.totalsCard}>
        <div className={styles.caloriesRow}>
          <span className={styles.caloriesBig}>
            {totals ? Math.round(totals.calories) : 0}
          </span>
          <span className={styles.caloriesUnit}>kcal</span>
          {goals.calories != null && (
            <span className={styles.caloriesGoal}>
              / {goals.calories} goal
            </span>
          )}
        </div>

        {/* Calorie progress bar — only if calorie goal set */}
        {goals.calories != null && totals && (
          <ProgressBar value={totals.calories} goal={goals.calories} />
        )}

        {/* Macro bars — only for macros that have a goal */}
        {totals && (
          <div className={styles.macrosRow}>
            {goals.protein_g != null && (
              <div className={styles.macroItem}>
                <div className={styles.macroHeader}>
                  <span className={styles.macroName}>Protein</span>
                  <span className={styles.macroValue}>
                    {Math.round(totals.protein_g)}g / {goals.protein_g}g
                  </span>
                </div>
                <ProgressBar value={totals.protein_g} goal={goals.protein_g} />
              </div>
            )}

            {goals.carbs_g != null && (
              <div className={styles.macroItem}>
                <div className={styles.macroHeader}>
                  <span className={styles.macroName}>Carbs</span>
                  <span className={styles.macroValue}>
                    {Math.round(totals.carbs_g)}g / {goals.carbs_g}g
                  </span>
                </div>
                <ProgressBar value={totals.carbs_g} goal={goals.carbs_g} />
              </div>
            )}

            {goals.fat_g != null && (
              <div className={styles.macroItem}>
                <div className={styles.macroHeader}>
                  <span className={styles.macroName}>Fat</span>
                  <span className={styles.macroValue}>
                    {Math.round(totals.fat_g)}g / {goals.fat_g}g
                  </span>
                </div>
                <ProgressBar value={totals.fat_g} goal={goals.fat_g} />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Loading / error */}
      {dayQuery.isLoading && (
        <p className={styles.loadingMsg}>Loading…</p>
      )}
      {dayQuery.isError && (
        <p className={styles.errorMsg}>Failed to load entries.</p>
      )}

      {/* Meal groups */}
      {!dayQuery.isLoading && !dayQuery.isError && grouped.length === 0 && (
        <p className={styles.emptyDay}>No food logged for this day. Tap + Add food to start.</p>
      )}

      {grouped.map(({ meal, entries: mealEntries }) => (
        <div key={meal} className={styles.mealGroup}>
          <div className={styles.mealHeader}>{mealLabel(meal)}</div>

          {mealEntries.map(entry => (
            <div key={entry.id} className={styles.entryRow}>
              {/* #72: three-dots menu at top-right; name wraps up to 2 lines */}
              <div className={styles.entryTop}>
                <span className={styles.entryName}>{entry.name}</span>
                <EntryMenu
                  entry={entry}
                  onEdit={openEditEditor}
                  onDelete={setPendingDeleteEntry}
                  onSaveAsMeal={handleSaveAsMeal}
                />
              </div>

              {/* kcal left, macro chips right (#101) */}
              <div className={styles.macroChips}>
                <span className={styles.entryCalories}>{Math.round(entry.calories)} kcal</span>
                <div className={styles.macroChipsGroup}>
                  <span className={styles.chip}>{Math.round(entry.protein_g)}g P</span>
                  <span className={styles.chip}>{Math.round(entry.carbs_g)}g C</span>
                  <span className={styles.chip}>{Math.round(entry.fat_g)}g F</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      ))}

      {/* Recently used custom foods row */}
      <RecentlyUsedRow selectedDate={selectedDate} defaultMeal={editorMode.kind === 'manual-add' ? (editorMode as any).defaultMeal : undefined} />

      {/* EntryEditor (always mounted, controlled by open) */}
      <EntryEditor
        open={editorOpen}
        mode={editorMode}
        onClose={handleEditorClose}
      />

      {/* AI Chat bottom-sheet */}
      <NutritionChat
        open={chatOpen}
        onClose={() => setChatOpen(false)}
        selectedDate={selectedDate}
      />

      {/* Goals modal */}
      <NutritionGoalsModal
        open={goalsModalOpen}
        onClose={() => setGoalsModalOpen(false)}
      />

      {/* My Foods sheet */}
      <MyFoodsSheet
        open={myFoodsOpen}
        onClose={() => setMyFoodsOpen(false)}
      />

      {/* Meal builder (Save as meal) */}
      <MealBuilder
        open={mealBuilderOpen}
        kind="meal"
        prefillRows={mealBuilderPrefillRows}
        onClose={() => setMealBuilderOpen(false)}
      />

      {/* Delete confirmation */}
      {pendingDeleteEntry !== null && (
        <ConfirmModal
          message={`Delete "${pendingDeleteEntry.name}"?`}
          onConfirm={handleDeleteConfirm}
          onCancel={() => setPendingDeleteEntry(null)}
        />
      )}
    </section>
  );
}
