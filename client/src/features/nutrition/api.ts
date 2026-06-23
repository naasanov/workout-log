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

export async function lookupBarcode(code: string): Promise<FoodSearchResult | null> {
  try {
    const res = await clientApi.get(`/nutrition/barcode/${code}`);
    return res.data.data;
  } catch (err: any) {
    if (err?.response?.status === 404) return null;
    throw err;
  }
}
