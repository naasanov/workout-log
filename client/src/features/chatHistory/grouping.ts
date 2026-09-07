// Pure helpers for the chat-history list: recency grouping (Today /
// Yesterday / This week / Older) and the archive-expiry label shown on each
// row. Split out from the components so the bucketing logic is easy to
// reason about on its own.
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

/**
 * A short "Expires in N days" / "Expires today" / "Expired" label for an
 * archived conversation's `expires_at`. Null for an active conversation
 * (expires_at is null until it's archived) -- callers should render nothing
 * in that case rather than a stray "Expired".
 */
export function expiryLabel(expiresAt: string | null): string | null {
  if (!expiresAt) return null;
  const days = differenceInCalendarDays(new Date(expiresAt), new Date());
  if (days < 0) return 'Expired';
  if (days === 0) return 'Expires today';
  if (days === 1) return 'Expires tomorrow';
  return `Expires in ${days} days`;
}
