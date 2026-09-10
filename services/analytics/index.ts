// Public surface of the analytics domain: one cross-domain time-series query.
// Not registered as an agent tool here -- a later wave wires querySeries up.
export { querySeries } from './store';
export { AnalyticsError } from './errors';
export type { ParsedMetric, NutritionField, ExerciseField } from './metric';
export type {
  Bucket, Agg, QuerySeriesParams, SeriesPoint, SeriesSummary, Coverage, QuerySeriesResult,
} from './types';
