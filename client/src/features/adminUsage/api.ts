// React Query hooks for the owner-only AI usage dashboard. Mirrors
// nutrition/api.ts: shared axios instance, { data, message } envelope unwrapped.
import { useQuery } from '@tanstack/react-query';
import clientApi from '../../api/clientApi.js';
import type { OwnerUsageReport } from './types';

export const adminUsageKeys = {
  report: (from: string, to: string) => ['admin-usage', from, to] as const,
};

/**
 * Fetch the owner-only usage report for [from, to] (both YYYY-MM-DD). Any
 * non-owner signed-in user gets a 404 from the server (routes/admin.ts), so
 * this query fails for them by design rather than returning empty data.
 */
export function useAdminUsageReport(from: string, to: string, enabled: boolean) {
  return useQuery({
    queryKey: adminUsageKeys.report(from, to),
    queryFn: async (): Promise<OwnerUsageReport> => {
      const res = await clientApi.get('/admin/usage', { params: { from, to } });
      return res.data.data;
    },
    enabled,
    retry: false,
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
