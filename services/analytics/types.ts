/** Time bucket width for querySeries. */
export type Bucket = 'day' | 'week' | 'month';

/** How raw per-bucket values are reduced to the single number a point reports. */
export type Agg = 'avg' | 'sum' | 'min' | 'max' | 'last';

export interface QuerySeriesParams {
  /** Metric identifier -- see services/analytics/metric.ts for the grammar. */
  metric: string;
  /** Inclusive lower bound (ISO date or datetime string). */
  from: string;
  /** Upper bound (ISO date or datetime string); see services/analytics/dates.ts for how bare dates are resolved. */
  to: string;
  bucket?: Bucket;
  /** Defaults to the metric's own natural aggregation when omitted. */
  agg?: Agg;
}

export interface SeriesPoint {
  /** Start of the bucket, as 'YYYY-MM-DD'. */
  bucketStart: string;
  value: number;
  /** Distinct calendar days with data inside this one bucket. */
  daysWithData: number;
}

export interface SeriesSummary {
  /** Number of non-empty buckets returned. */
  count: number;
  mean: number | null;
  first: number | null;
  last: number | null;
  min: number | null;
  max: number | null;
  /** last - first. */
  change: number | null;
  /** Least-squares slope over calendar-day offsets, scaled to units per week. */
  slopePerWeek: number | null;
  /** Coefficient of determination of that same fit, in [0, 1]. */
  r2: number | null;
}

export interface Coverage {
  /** Distinct calendar days with at least one raw row anywhere in the window. */
  daysWithData: number;
  /** Total calendar days spanned by [from, to]. */
  daysInWindow: number;
  /** daysWithData / daysInWindow, or null when daysInWindow is 0. */
  coverage: number | null;
}

export interface QuerySeriesResult {
  metric: string;
  bucket: Bucket;
  agg: Agg;
  points: SeriesPoint[];
  summary: SeriesSummary;
  coverage: Coverage;
}
