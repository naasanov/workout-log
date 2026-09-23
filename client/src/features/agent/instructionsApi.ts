// React Query hooks for per-user agent instructions (#382): free-text
// preferences folded into the agent's system prompt (see
// services/agent/prompt/userInstructions.ts). Mirrors the tab-preferences
// hooks (api/tabPreferences.ts): shared axios instance, { data, message }
// envelope unwrapped.
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import clientApi from '../../api/clientApi';
import type { AgentInstructionsResponse } from '../../../../shared/agentInstructions';

export const agentInstructionsKey = ['agent-instructions'];

/** Fetch the caller's current agent instructions; `instructions` is null when none are set. */
export function useAgentInstructions() {
  return useQuery({
    queryKey: agentInstructionsKey,
    queryFn: async (): Promise<AgentInstructionsResponse> => {
      const res = await clientApi.get('/users/agent-instructions');
      return res.data.data;
    },
  });
}

/** Save the caller's agent instructions. Trimmed/length-validated server-side. */
export function usePutAgentInstructions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (instructions: string): Promise<AgentInstructionsResponse> => {
      const res = await clientApi.put('/users/agent-instructions', { instructions });
      return res.data.data;
    },
    onSuccess: (data) => qc.setQueryData(agentInstructionsKey, data),
  });
}
