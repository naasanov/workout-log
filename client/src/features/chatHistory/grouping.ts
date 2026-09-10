// Recency grouping for the chat-history list (Today / Yesterday / This week /
// Older), kept apart from the components so the bucketing reads on its own.
import { isToday, isYesterday, differenceInCalendarDays } from 'date-fns';
import type { Conversation } from '../agent/api';

export type RecencyGroup = 'Today' | 'Yesterday' | 'This week' | 'Older';

const GROUP_ORDER: RecencyGroup[] = ['Today', 'Yesterday', 'This week', 'Older'];

export function recencyGroupFor(dateStr: string): RecencyGroup {
  const date = new Date(dateStr);
  if (isToday(date)) return 'Today';
  if (isYesterday(date)) return 'Yesterday';
  if (differenceInCalendarDays(new Date(), date) < 7) return 'This week';
  return 'Older';
}

/**
 * Buckets conversations by recency of `updated_at`, most recent group first.
 * The caller is expected to filter out the pinned active conversation first
 * so it isn't shown twice (once pinned, once in its natural bucket).
 */
export function groupByRecency(
  conversations: Conversation[],
): { group: RecencyGroup; items: Conversation[] }[] {
  const buckets = new Map<RecencyGroup, Conversation[]>();
  for (const c of conversations) {
    const group = recencyGroupFor(c.updated_at);
    if (!buckets.has(group)) buckets.set(group, []);
    buckets.get(group)!.push(c);
  }
  return GROUP_ORDER.filter((g) => buckets.has(g)).map((group) => ({ group, items: buckets.get(group)! }));
}
