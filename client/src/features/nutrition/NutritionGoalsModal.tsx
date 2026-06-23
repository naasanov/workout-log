import { useEffect, useState } from 'react';
import Modal from '../../components/Modal.jsx';
import { useGoals, usePutGoals } from './api';
import type { Goals } from './types';
import styles from './NutritionGoalsModal.module.scss';

interface NutritionGoalsModalProps {
  open: boolean;
  onClose: () => void;
}

// Parse a string input to a number or null.
// Empty string / whitespace → null (clears the goal).
// Valid numeric string → the number.
// Invalid string → null (treat as clear).
function parseGoalValue(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  if (!isFinite(n) || n < 0) return null;
  return n;
}

export default function NutritionGoalsModal({ open, onClose }: NutritionGoalsModalProps) {
  const goalsQuery = useGoals();
  const putGoals = usePutGoals();

  // Local string state so the user can type freely without coercion
  const [calories, setCalories] = useState('');
  const [protein, setProtein] = useState('');
  const [carbs, setCarbs] = useState('');
  const [fat, setFat] = useState('');

  const [saveError, setSaveError] = useState<string | null>(null);

  // Pre-fill form when goals load or modal re-opens
  useEffect(() => {
    if (!open) return;
    const g: Goals = goalsQuery.data ?? {};
    setCalories(g.calories != null ? String(g.calories) : '');
    setProtein(g.protein_g != null ? String(g.protein_g) : '');
    setCarbs(g.carbs_g != null ? String(g.carbs_g) : '');
    setFat(g.fat_g != null ? String(g.fat_g) : '');
    setSaveError(null);
  }, [open, goalsQuery.data]);

  async function handleSave() {
    setSaveError(null);
    const goals: Goals = {
      calories: parseGoalValue(calories),
      protein_g: parseGoalValue(protein),
      carbs_g: parseGoalValue(carbs),
      fat_g: parseGoalValue(fat),
    };
    try {
      await putGoals.mutateAsync(goals);
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to save goals.';
      setSaveError(msg);
    }
  }

  const isPending = putGoals.isPending;

  return (
    <Modal
      open={open}
      onOpenChange={(isOpen: boolean) => { if (!isOpen) onClose(); }}
      title="Nutrition Goals"
      showTitle={false}
      contentClassName={styles.modalContent}
    >
      <div className={styles.modal}>
        <div className={styles.header}>
          <h2 className={styles.title}>Nutrition Goals</h2>
        </div>

        <p className={styles.hint}>
          Leave a field empty to remove that goal.
        </p>

        <div className={styles.fields}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="goal-calories">
              Calories (kcal)
            </label>
            <input
              id="goal-calories"
              className={styles.input}
              type="number"
              inputMode="numeric"
              min="0"
              step="1"
              placeholder="e.g. 2000"
              value={calories}
              onChange={e => setCalories(e.target.value)}
            />
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="goal-protein">
              Protein (g)
            </label>
            <input
              id="goal-protein"
              className={styles.input}
              type="number"
              inputMode="decimal"
              min="0"
              step="1"
              placeholder="e.g. 150"
              value={protein}
              onChange={e => setProtein(e.target.value)}
            />
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="goal-carbs">
              Carbs (g)
            </label>
            <input
              id="goal-carbs"
              className={styles.input}
              type="number"
              inputMode="decimal"
              min="0"
              step="1"
              placeholder="e.g. 250"
              value={carbs}
              onChange={e => setCarbs(e.target.value)}
            />
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="goal-fat">
              Fat (g)
            </label>
            <input
              id="goal-fat"
              className={styles.input}
              type="number"
              inputMode="decimal"
              min="0"
              step="1"
              placeholder="e.g. 70"
              value={fat}
              onChange={e => setFat(e.target.value)}
            />
          </div>
        </div>

        {saveError && (
          <p className={styles.errorMsg}>{saveError}</p>
        )}

        <div className={styles.footer}>
          <button
            className={styles.cancelBtn}
            type="button"
            onClick={onClose}
            disabled={isPending}
          >
            Cancel
          </button>
          <button
            className={styles.saveBtn}
            type="button"
            onClick={handleSave}
            disabled={isPending}
          >
            {isPending ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
