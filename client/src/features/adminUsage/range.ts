// Shared range math for the admin usage dashboard and its owner-status probe,
// so both compute the same [from, to] for the default window and share one
// cached request (see useIsOwner in api.ts).
import { format, subDays } from 'date-fns';

export const DEFAULT_RANGE_DAYS = 30;

export function computeRange(days: number): { from: string; to: string } {
  const to = new Date();
  const from = subDays(to, days - 1);
  return { from: format(from, 'yyyy-MM-dd'), to: format(to, 'yyyy-MM-dd') };
}
