import { SeriesSummary } from './types';

export interface RegressionPoint {
  /** Calendar-day offset from the window's start day. */
  x: number;
  value: number;
}

/**
 * count/mean/first/last/min/max/change plus a least-squares trend line over
 * (x, value), with the slope rescaled to units-per-week regardless of what
 * bucket width produced the points -- a day, week, or month bucketing of the
 * same underlying data all yield the same slope units. Guards every division
 * so 0 or 1 points never produce NaN.
 */
export function computeSummary(points: RegressionPoint[]): SeriesSummary {
  const n = points.length;
  if (n === 0) {
    return {
      count: 0, mean: null, first: null, last: null, min: null, max: null,
      change: null, slopePerWeek: null, r2: null,
    };
  }

  const values = points.map((p) => p.value);
  const first = values[0];
  const last = values[values.length - 1];
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const change = last - first;

  let slopePerWeek: number | null = null;
  let r2: number | null = null;

  if (n >= 2) {
    const meanX = points.reduce((a, p) => a + p.x, 0) / n;
    let sxx = 0, sxy = 0, syy = 0;
    for (const p of points) {
      const dx = p.x - meanX;
      const dy = p.value - mean;
      sxx += dx * dx;
      sxy += dx * dy;
      syy += dy * dy;
    }
    if (sxx > 0) {
      slopePerWeek = (sxy / sxx) * 7;
      // A flat series (syy === 0) has zero residual under any slope through
      // its mean, so the fit is trivially perfect.
      r2 = syy > 0 ? (sxy * sxy) / (sxx * syy) : 1;
    }
  }

  return { count: n, mean, first, last, min, max, change, slopePerWeek, r2 };
}
