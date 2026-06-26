import { useState } from 'react';
import { useDay, useGoals, useDeleteEntry } from './api';
import EntryEditor from './EntryEditor';
import NutritionGoalsModal from './NutritionGoalsModal';
import FeedbackModal from './FeedbackModal';
import NutritionChat from './NutritionChat';
import ConfirmModal from '../../components/ConfirmModal.jsx';
import type { EntryEditorMode, EntryRow } from './types';
import { MEALS } from './types';
import styles from './NutritionTracker.module.scss';

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

  // Feedback modal
  const [feedbackOpen, setFeedbackOpen] = useState(false);

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

  const mealLabel = (meal: string) =>
    meal.charAt(0).toUpperCase() + meal.slice(1);

  return (
    <section className={styles.container}>
      {/* Date nav */}
      <div className={styles.dateNav}>
        <button
          className={styles.arrowBtn}
          onClick={handlePrevDay}
          aria-label="Previous day"
        >
          <svg
            className={styles.arrowIcon}
            viewBox="0 0 18 18"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M11 4L6 9l5 5"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
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
          <svg
            className={styles.arrowIcon}
            viewBox="0 0 18 18"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M7 4l5 5-5 5"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>

      {/* Actions row */}
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

        <button
          className={styles.feedbackBtn}
          onClick={() => setFeedbackOpen(true)}
          aria-label="Send feedback"
          title="Send feedback"
        >
          Feedback
        </button>

        <button
          className={styles.settingsBtn}
          onClick={() => setGoalsModalOpen(true)}
          aria-label="Nutrition goals"
          title="Set nutrition goals"
        >
          <svg
            className={styles.settingsIcon}
            viewBox="0 0 20 20"
            fill="none"
            aria-hidden="true"
          >
            <circle cx="10" cy="10" r="2.5" stroke="currentColor" strokeWidth="1.8" />
            <path
              d="M10 2v2M10 16v2M2 10h2M16 10h2M4.22 4.22l1.42 1.42M14.36 14.36l1.42 1.42M4.22 15.78l1.42-1.42M14.36 5.64l1.42-1.42"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          </svg>
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
              {/* Item 16: name on its own row (wraps up to 2 lines), kcal+buttons below */}
              <div className={styles.entryTop}>
                <span className={styles.entryName}>{entry.name}</span>
                <div className={styles.entryMeta}>
                  <span className={styles.entryCalories}>{Math.round(entry.calories)} kcal</span>
                  <div className={styles.entryBtns}>
                    <button
                      className={styles.editBtn}
                      onClick={() => openEditEditor(entry)}
                      aria-label={`Edit ${entry.name}`}
                    >
                      Edit
                    </button>
                    <button
                      className={styles.deleteBtn}
                      onClick={() => setPendingDeleteEntry(entry)}
                      aria-label={`Delete ${entry.name}`}
                    >
                      ✕
                    </button>
                  </div>
                </div>
              </div>

              <div className={styles.macroChips}>
                <span className={styles.chip}>{Math.round(entry.protein_g)}g prot</span>
                <span className={styles.chip}>{Math.round(entry.carbs_g)}g carbs</span>
                <span className={styles.chip}>{Math.round(entry.fat_g)}g fat</span>
              </div>
            </div>
          ))}
        </div>
      ))}

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

      {/* Feedback modal */}
      <FeedbackModal
        open={feedbackOpen}
        onClose={() => setFeedbackOpen(false)}
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
