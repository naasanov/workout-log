// React Query hooks + imperative helpers for the Nutrition feature.
// All calls go through the shared axios instance (same-origin /api base) and
// unwrap the backend's { data, message } envelope.
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import clientApi from '../../api/clientApi.js';
import type {
  DayResponse,
  EntryInput,
  EntryRow,
  Goals,
  FoodSearchResult,
  FoodPortion,
} from './types';

export const nutritionKeys = {
  day: (date: string) => ['nutrition', 'day', date] as const,
  goals: ['nutrition', 'goals'] as const,
};

export function useDay(date: string) {
  return useQuery({
    queryKey: nutritionKeys.day(date),
    queryFn: async (): Promise<DayResponse> => {
      const res = await clientApi.get(`/nutrition/day/${date}`);
      return res.data.data;
    },
    enabled: !!date,
  });
}

export function useGoals() {
  return useQuery({
    queryKey: nutritionKeys.goals,
    queryFn: async (): Promise<Goals> => {
      const res = await clientApi.get('/nutrition/goals');
      return res.data.data;
    },
  });
}

export function usePutGoals() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (goals: Goals): Promise<Goals> => {
      const res = await clientApi.put('/nutrition/goals', goals);
      return res.data.data;
    },
    onSuccess: (data) => qc.setQueryData(nutritionKeys.goals, data),
  });
}

export function useCreateEntry(date: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: EntryInput): Promise<{ id: number; totals: EntryRow }> => {
      const res = await clientApi.post('/nutrition/entries', input);
      return res.data.data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: nutritionKeys.day(date) }),
  });
}

export function useUpdateEntry(date: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, input }: { id: number; input: EntryInput }): Promise<EntryRow> => {
      const res = await clientApi.patch(`/nutrition/entries/${id}`, input);
      return res.data.data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: nutritionKeys.day(date) }),
  });
}

export function useDeleteEntry(date: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number): Promise<void> => {
      await clientApi.delete(`/nutrition/entries/${id}`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: nutritionKeys.day(date) }),
  });
}

// Imperative helpers (used by the editor for search-as-you-type & barcode scan).
export async function searchFoods(query: string): Promise<FoodSearchResult[]> {
  const res = await clientApi.get('/nutrition/foods/search', { params: { q: query } });
  return res.data.data;
}

/**
 * React Query hook for food search with in-memory caching.
 *
 * Cache key: ['nutrition', 'foodSearch', normalizedQuery]
 * staleTime: 5 minutes — cached results are returned immediately on refocus
 * without triggering a new network request while still fresh.
 * gcTime: 10 minutes — keeps results in memory after the component unmounts.
 *
 * Pass the already-debounced query so typing doesn't spam the network.
 * The hook is disabled when the normalised query is shorter than 2 chars.
 */
export function useFoodSearch(debouncedQuery: string) {
  const normalizedQuery = debouncedQuery.trim().toLowerCase();
  return useQuery<FoodSearchResult[]>({
    queryKey: ['nutrition', 'foodSearch', normalizedQuery],
    queryFn: () => searchFoods(debouncedQuery.trim()),
    enabled: normalizedQuery.length >= 2,
    staleTime: 5 * 60 * 1000,  // 5 minutes
    gcTime: 10 * 60 * 1000,    // 10 minutes
  });
}

export async function lookupBarcode(code: string): Promise<FoodSearchResult | null> {
  try {
    const res = await clientApi.get(`/nutrition/barcode/${code}`);
    return res.data.data;
  } catch (err: any) {
    if (err?.response?.status === 404) return null;
    throw err;
  }
}

/** Household serving sizes for a food (USDA via foodPortions; OFF returns []). */
export async function getPortions(
  source: 'usda' | 'off',
  ref: string,
): Promise<FoodPortion[]> {
  const res = await clientApi.get('/nutrition/portions', { params: { source, ref } });
  return res.data.data;
}

// ---- Chat transcripts (server-persisted; DB is source of truth, #15/#17) ----
// Messages are stored/returned as AI SDK UIMessage objects (parts-based). Typed
// loosely here so this file doesn't depend on @ai-sdk/react's UIMessage generic;
// the chat component casts to its own UIMessage[] on load.
export type StoredChatMessage = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  parts: unknown[];
  // 'streaming' assistant rows that ended without an onFinish are flagged so the
  // client can render an "interrupted" marker (#15).
  interrupted?: boolean;
};

/** Load the persisted transcript for a local day (newest run last). */
export async function fetchTranscript(date: string): Promise<StoredChatMessage[]> {
  const res = await clientApi.get('/nutrition/chat/transcript', { params: { date } });
  return res.data.data ?? [];
}

/** Clear the chat for a local day (DB + the client should also drop its cache). */
export async function clearTranscript(date: string): Promise<void> {
  await clientApi.delete('/nutrition/chat/transcript', { params: { date } });
}

// ---- App feedback (#1) — POST creates a GitHub issue server-side when a
// GITHUB_TOKEN is configured, else stores in a feedback table. App-level, not
// nutrition-scoped, but lives here since the feedback UI ships with this batch.
export async function submitFeedback(input: {
  category?: 'bug' | 'idea' | 'other';
  message: string;
}): Promise<void> {
  await clientApi.post('/feedback', input);
}
