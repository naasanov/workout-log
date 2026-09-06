// Date-range handling shared by every metric. Two table families use
// different column types (see services/bodyWeight/store.ts and
// services/workouts/variations.ts), so the SQL condition built for `to`
// depends on which one a metric reads from.
import { parseISO, isValid, addDays, format, differenceInCalendarDays } from 'date-fns';
import { AnalyticsError } from './errors';

const BARE_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export type ColumnType = 'date' | 'datetime';

function requireValid(date: Date, label: string, raw: string): Date {
  if (!isValid(date)) throw new AnalyticsError(`Invalid ${label} date: ${raw}`);
  return date;
}

/** Calendar-date portion ('YYYY-MM-DD') of a bare date or full datetime string. */
function toDateOnlyString(value: string): string {
  if (BARE_DATE.test(value)) return value;
  return format(requireValid(parseISO(value), 'from/to', value), 'yyyy-MM-dd');
}

/**
 * Builds the WHERE fragment + bound params for one metric's date range.
 * DATE columns (food_entries, habit_tallies) have no time granularity, so
 * both bounds are truncated to their calendar day and compared inclusively.
 * DATETIME columns follow resolveTo in services/bodyWeight/store.ts: a bare
 * `to` date resolves to the start of the next day and is compared with `<`,
 * so a same-day entry logged later is still included; an explicit datetime
 * is an exact inclusive cutoff (`<=`). `from` needs no such handling since a
 * bare date already parses to that day's start.
 */
export function dateRangeCondition(
  dateExpr: string,
  columnType: ColumnType,
  from: string,
  to: string,
): { conditions: string[]; params: unknown[] } {
  if (columnType === 'date') {
    const fromStr = toDateOnlyString(from);
    const toStr = toDateOnlyString(to);
    return {
      conditions: [`${dateExpr} >= ?`, `${dateExpr} <= ?`],
      params: [fromStr, toStr],
    };
  }

  const fromValue = requireValid(parseISO(from), 'from', from);

  let toValue: Date;
  let toOperator: '<' | '<=';
  if (BARE_DATE.test(to)) {
    toValue = new Date(requireValid(parseISO(to), 'to', to).getTime() + ONE_DAY_MS);
    toOperator = '<';
  } else {
    toValue = requireValid(parseISO(to), 'to', to);
    toOperator = '<=';
  }

  return {
    conditions: [`${dateExpr} >= ?`, `${dateExpr} ${toOperator} ?`],
    params: [fromValue, toValue],
  };
}

/**
 * The [from, to] window expressed as whole calendar days, independent of
 * which column type backs the metric. Used as the coverage denominator and
 * as the x-axis origin for the regression slope, so every metric's trend is
 * measured against the same day-zero regardless of bucket size.
 */
export function windowDaySpan(from: string, to: string): { startDay: Date; totalDays: number } {
  const startDay = parseISO(toDateOnlyString(from));
  const endDayInclusive = parseISO(toDateOnlyString(to));
  const endDayExclusive = addDays(endDayInclusive, 1);
  const totalDays = differenceInCalendarDays(endDayExclusive, startDay);
  if (totalDays <= 0) {
    throw new AnalyticsError('`to` must not be before `from`');
  }
  return { startDay, totalDays };
}

/** Normalizes a DATE value coming back from mysql2 (a Date, or already a string) to 'YYYY-MM-DD'. */
export function normalizeDbDate(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}
