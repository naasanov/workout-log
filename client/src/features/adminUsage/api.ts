// React Query hooks for the owner-only AI usage dashboard. Mirrors
// nutrition/api.ts: shared axios instance, { data, message } envelope unwrapped.
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import clientApi from '../../api/clientApi.js';
import type { OwnerUsageReport } from './types';

export const adminUsageKeys = {
  // userUuid folds to 'all' when absent, so a call that omits it (like useIsOwner
  // below) shares its cache entry with the dashboard's unfiltered default view.
  report: (from: string, to: string, userUuid?: string) =>
    ['admin-usage', from, to, userUuid ?? 'all'] as const,
};

/**
 * Fetch the owner-only usage report for [from, to] (both YYYY-MM-DD), optionally
 * narrowed to one user. Any non-owner signed-in user gets a 404 from the server
 * (routes/admin.ts), so this query fails for them by design rather than
 * returning empty data.
 */
export function useAdminUsageReport(from: string, to: string, enabled: boolean, userUuid?: string) {
  return useQuery({
    queryKey: adminUsageKeys.report(from, to, userUuid),
    queryFn: async (): Promise<OwnerUsageReport> => {
      const params: Record<string, string> = { from, to };
      if (userUuid) params.userUuid = userUuid;
      const res = await clientApi.get('/admin/usage', { params });
      return res.data.data;
    },
    enabled,
    retry: false,
    // Keeps the previous range/filter's data on screen while a new one loads,
    // so switching the range chips or the user filter doesn't blank the dashboard.
    placeholderData: keepPreviousData,
  });
}

/**
 * Whether the signed-in user is the owner, read from GET /admin/usage succeeding (anyone
 * else gets 404). Shares the dashboard's default-range query key, so opening the
 * dashboard costs no second request. Undefined while in flight.
 */
export function useIsOwner(from: string, to: string, loggedIn: boolean): boolean | undefined {
  const query = useAdminUsageReport(from, to, loggedIn);
  if (!loggedIn) return false;
  if (query.isSuccess) return true;
  if (query.isError) return false;
  return undefined;
}
