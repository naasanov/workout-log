// React Query hooks for the customizable-tabs feature (#110). Mirrors the
// nutrition goals hooks (features/nutrition/api.ts): shared axios instance,
// { data, message } envelope unwrapped, per-user and account-scoped.
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import clientApi from './clientApi.js';

export const tabPreferencesKey = ['tab-preferences'];

/**
 * Fetch the user's ordered enabled tabs. Pass `enabled` (truthy only when logged
 * in) so the query doesn't run for logged-out visitors. Returns string[] — an
 * empty array means the new-account empty state.
 */
export function useTabPreferences(enabled) {
  return useQuery({
    queryKey: tabPreferencesKey,
    queryFn: async () => {
      const res = await clientApi.get('/users/tab-preferences');
      return res.data.data;
    },
    enabled: !!enabled,
  });
}

/** Persist the ordered enabled tabs. Optimistically updates the cache so the UI
 *  (nav list, homepage) reacts instantly to toggles/reorders. */
export function usePutTabPreferences() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (enabledTabs) => {
      const res = await clientApi.put('/users/tab-preferences', { enabledTabs });
      return res.data.data;
    },
    onMutate: async (enabledTabs) => {
      await qc.cancelQueries({ queryKey: tabPreferencesKey });
      const prev = qc.getQueryData(tabPreferencesKey);
      qc.setQueryData(tabPreferencesKey, enabledTabs);
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev !== undefined) qc.setQueryData(tabPreferencesKey, ctx.prev);
    },
    onSuccess: (data) => qc.setQueryData(tabPreferencesKey, data),
  });
}
