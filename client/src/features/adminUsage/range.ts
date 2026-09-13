// Shared [from, to] for the dashboard and its owner probe, so both share one cached request.
// Dates are UTC days, because ai_usage.created_at is stored and grouped by UTC day, and a
// local "today" would drop evening turns already recorded under tomorrow's UTC date.
export const DEFAULT_RANGE_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

export function computeRange(days: number): { from: string; to: string } {
  const now = Date.now();
  const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  return { from: utcDay(now - (days - 1) * DAY_MS), to: utcDay(now) };
}
