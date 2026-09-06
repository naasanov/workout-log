// Parses and strictly validates the querySeries metric identifier grammar:
//
//   body_weight
//   nutrition.<calories|protein_g|carbs_g|fat_g|fiber_g>
//   habit:<habitName>
//   exercise:<variationId>.<weight|reps|e1rm>
//
// A parsed metric only ever yields plain data (an enum tag, a validated
// number, or a string that is later bound as a query parameter) -- nothing
// here is ever concatenated into SQL text. services/analytics/sql.ts maps
// each parsed kind to a fixed, hand-written FROM/column reference; an unknown
// or malformed metric string throws AnalyticsError before any SQL is built.
import { AnalyticsError } from './errors';

export type NutritionField = 'calories' | 'protein_g' | 'carbs_g' | 'fat_g' | 'fiber_g';
export type ExerciseField = 'weight' | 'reps' | 'e1rm';

export type ParsedMetric =
  | { kind: 'body_weight' }
  | { kind: 'nutrition'; field: NutritionField }
  | { kind: 'habit'; habitName: string }
  | { kind: 'exercise'; variationId: number; field: ExerciseField };

const NUTRITION_FIELDS: ReadonlySet<string> = new Set(['calories', 'protein_g', 'carbs_g', 'fat_g', 'fiber_g']);
const EXERCISE_METRIC_RE = /^(\d{1,10})\.(weight|reps|e1rm)$/;

// habit names are stored as VARCHAR(100) and are always bound as a query
// parameter, never interpolated, so their content can't reach SQL structure
// regardless of characters used. This still rejects control characters and
// enforces the same length cap as the column, so a malformed metric string
// fails fast rather than silently matching zero rows.
const HABIT_NAME_RE = /^[^\x00-\x1F\x7F]{1,100}$/;

export function parseMetric(metric: unknown): ParsedMetric {
  if (typeof metric !== 'string' || metric.length === 0) {
    throw new AnalyticsError('metric must be a non-empty string');
  }

  if (metric === 'body_weight') {
    return { kind: 'body_weight' };
  }

  if (metric.startsWith('nutrition.')) {
    const field = metric.slice('nutrition.'.length);
    if (!NUTRITION_FIELDS.has(field)) {
      throw new AnalyticsError(`Unknown nutrition metric: ${metric}`);
    }
    return { kind: 'nutrition', field: field as NutritionField };
  }

  if (metric.startsWith('habit:')) {
    const habitName = metric.slice('habit:'.length);
    if (!HABIT_NAME_RE.test(habitName)) {
      throw new AnalyticsError(`Invalid habit metric: ${metric}`);
    }
    return { kind: 'habit', habitName };
  }

  if (metric.startsWith('exercise:')) {
    const match = EXERCISE_METRIC_RE.exec(metric.slice('exercise:'.length));
    if (!match) {
      throw new AnalyticsError(
        `Invalid exercise metric: ${metric} (expected exercise:<variationId>.<weight|reps|e1rm>)`,
      );
    }
    const variationId = Number(match[1]);
    if (!Number.isSafeInteger(variationId) || variationId <= 0) {
      throw new AnalyticsError(`Invalid variation id in metric: ${metric}`);
    }
    return { kind: 'exercise', variationId, field: match[2] as ExerciseField };
  }

  throw new AnalyticsError(`Unknown metric: ${metric}`);
}
