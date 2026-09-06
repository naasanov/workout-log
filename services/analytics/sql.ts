// Maps a parsed metric to fixed SQL fragments (table/column references
// chosen by this file, never by user input) plus the params those fragments
// bind. variation ids and habit names are only ever passed as bound query
// parameters -- see services/analytics/metric.ts for why that already rules
// out injection regardless of their content.
import { Agg, Bucket } from './types';
import { ParsedMetric } from './metric';

/** Per-day reduction of raw rows before they're grouped into buckets. Not caller-controlled. */
export type DayAgg = 'avg' | 'sum' | 'max';

export interface MetricSql {
  /** FROM clause, including any joins needed to reach user_uuid. */
  fromSql: string;
  /** Column reference for this metric's date/datetime column. */
  dateExpr: string;
  dateColumnType: 'date' | 'datetime';
  /** Column reference (or computed expression) for the raw value. */
  valueExpr: string;
  /** Fixed WHERE fragments (each with its own '?'), in the same order as `params`. */
  conditions: string[];
  params: unknown[];
  dayAgg: DayAgg;
  defaultAgg: Agg;
}

/**
 * body_weight averages multiple same-day weigh-ins (documented default agg);
 * nutrition sums a day's entries into a day total, matching getDay in
 * services/nutrition/store.ts, then defaults to averaging those day totals
 * across the bucket ("calories naturally sum per day then average per
 * week"); habit tallies sum (a day's count, then a bucket's total taps);
 * exercise metrics take the day's best set (MAX) and default to reporting
 * the bucket's best set too, so a week/month bucket surfaces the period's PR
 * rather than smoothing it away.
 */
export function buildMetricSql(userUuid: string, parsed: ParsedMetric): MetricSql {
  switch (parsed.kind) {
    case 'body_weight':
      return {
        fromSql: 'body_weight',
        dateExpr: 'date',
        dateColumnType: 'datetime',
        valueExpr: 'weight',
        conditions: ['user_uuid = UUID_TO_BIN(?)'],
        params: [userUuid],
        dayAgg: 'avg',
        defaultAgg: 'avg',
      };

    case 'nutrition':
      return {
        fromSql: 'food_entries',
        dateExpr: 'date',
        dateColumnType: 'date',
        // fiber_g is nullable; COALESCE is a no-op for the other (NOT NULL) macro columns.
        valueExpr: `COALESCE(${parsed.field}, 0)`,
        conditions: ['user_uuid = UUID_TO_BIN(?)'],
        params: [userUuid],
        dayAgg: 'sum',
        defaultAgg: 'avg',
      };

    case 'habit':
      return {
        fromSql: 'habit_tallies',
        dateExpr: 'date',
        dateColumnType: 'date',
        valueExpr: 'count',
        conditions: ['user_uuid = UUID_TO_BIN(?)', 'habit_name = ?'],
        params: [userUuid, parsed.habitName],
        dayAgg: 'sum',
        defaultAgg: 'sum',
      };

    case 'exercise': {
      const valueExpr =
        parsed.field === 'weight' ? 'vh.weight'
        : parsed.field === 'reps' ? 'vh.reps'
        // Epley estimated 1RM; vh.reps is nullable so this only ever runs
        // under the `vh.reps IS NOT NULL` condition added below.
        : 'vh.weight * (1 + vh.reps / 30.0)';

      const conditions = ['vh.variation_id = ?', 's.user_uuid = UUID_TO_BIN(?)', 'vh.weight IS NOT NULL'];
      if (parsed.field !== 'weight') conditions.push('vh.reps IS NOT NULL');

      return {
        // variation_history -> variations -> movements -> sections is the
        // same ownership chain used throughout services/workouts.
        fromSql: `variation_history vh
                   JOIN variations v ON v.variation_id = vh.variation_id
                   JOIN movements m ON m.movement_id = v.movement_id
                   JOIN sections s ON s.section_id = m.section_id`,
        dateExpr: 'vh.date',
        dateColumnType: 'datetime',
        valueExpr,
        conditions,
        params: [parsed.variationId, userUuid],
        dayAgg: 'max',
        defaultAgg: 'max',
      };
    }
  }
}

const DAY_AGG_FN: Record<DayAgg, string> = { avg: 'AVG', sum: 'SUM', max: 'MAX' };

const BUCKET_EXPR: Record<Bucket, string> = {
  day: 'day',
  // WEEKDAY() is 0 for Monday, so this lands on the Monday of that week.
  week: 'DATE_SUB(day, INTERVAL WEEKDAY(day) DAY)',
  month: 'DATE_SUB(day, INTERVAL DAYOFMONTH(day) - 1 DAY)',
};

/**
 * The full bucketed-and-aggregated query. Raw rows are first collapsed to one
 * value per calendar day (dayAgg), then grouped into buckets; every caller
 * agg (avg/sum/min/max/last) is computed per bucket so picking one afterward
 * needs no second query. `last` is the day_value of that bucket's latest day,
 * picked via a window function rather than plain MAX/MIN since it must track
 * whichever day sorts last, not whichever value happens to be largest.
 */
export function buildSeriesSql(metricSql: MetricSql, bucket: Bucket, conditions: string[]): string {
  return `
    WITH raw_rows AS (
      SELECT DATE(${metricSql.dateExpr}) AS day, ${metricSql.valueExpr} AS value
      FROM ${metricSql.fromSql}
      WHERE ${conditions.join(' AND ')}
    ),
    day_level AS (
      SELECT day, ${DAY_AGG_FN[metricSql.dayAgg]}(value) AS day_value
      FROM raw_rows
      GROUP BY day
    ),
    bucketed AS (
      SELECT day, day_value, ${BUCKET_EXPR[bucket]} AS bucket_start
      FROM day_level
    ),
    ranked AS (
      SELECT bucket_start, day, day_value,
             ROW_NUMBER() OVER (PARTITION BY bucket_start ORDER BY day DESC) AS rn
      FROM bucketed
    )
    SELECT
      bucket_start,
      COUNT(*) AS day_count,
      AVG(day_value) AS avg_value,
      SUM(day_value) AS sum_value,
      MIN(day_value) AS min_value,
      MAX(day_value) AS max_value,
      -- last_value is a reserved word in MySQL 8 (the window function), so
      -- this alias avoids it rather than needing a backtick everywhere it's read.
      MAX(CASE WHEN rn = 1 THEN day_value END) AS last_val
    FROM ranked
    GROUP BY bucket_start
    ORDER BY bucket_start ASC
  `;
}
