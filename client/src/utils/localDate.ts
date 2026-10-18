import { addDays, format, parseISO } from 'date-fns';

// Calendar dates (YYYY-MM-DD) are always interpreted in the viewer's local
// timezone. `new Date('YYYY-MM-DD')` parses as UTC midnight, so never use it.
const DATE_FORMAT = 'yyyy-MM-dd';

/** Today's local calendar date as YYYY-MM-DD. */
export function getTodayLocalDate(): string {
  return format(new Date(), DATE_FORMAT);
}

/** The current local wall-clock time as 24-hour HH:mm. */
export function getLocalTimeHHmm(): string {
  return format(new Date(), 'HH:mm');
}

/** Formats a Date's local calendar day as YYYY-MM-DD. */
export function toLocalDateString(date: Date): string {
  return format(date, DATE_FORMAT);
}

/** Parses YYYY-MM-DD as local midnight of that day. */
export function parseLocalDate(dateStr: string): Date {
  return parseISO(dateStr);
}

/** Shifts a YYYY-MM-DD by whole calendar days, DST-safe. */
export function shiftLocalDate(dateStr: string, days: number): string {
  return format(addDays(parseLocalDate(dateStr), days), DATE_FORMAT);
}

/**
 * ISO instant at local noon of the given YYYY-MM-DD. Noon keeps the stored
 * instant on the intended calendar day in local time and, for any timezone
 * within UTC-11..UTC+11, on the same UTC day too.
 */
export function localDateToISO(dateStr: string): string {
  const d = parseLocalDate(dateStr);
  d.setHours(12, 0, 0, 0);
  return d.toISOString();
}
