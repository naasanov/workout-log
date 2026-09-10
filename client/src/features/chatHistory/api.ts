// React Query hooks for the chat-history tab. The list endpoint
// (GET /chat/conversations, see routes/chat.ts) returns every row's title
// (its first message), so the list needs no per-row fetch.
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  fetchConversations,
  fetchConversation,
  continueConversation as continueConversationApi,
  deleteConversation as deleteConversationApi,
} from '../agent/api';

export const chatHistoryKeys = {
  list: ['chatHistory', 'conversations'] as const,
  detail: (id: number) => ['chatHistory', 'conversation', id] as const,
};

export function useConversationList() {
  return useQuery({
    queryKey: chatHistoryKeys.list,
    queryFn: fetchConversations,
  });
}

/** Fetches one conversation's full transcript for the read-only viewer,
 *  used only once a row is opened. */
export function useConversationDetail(id: number | null) {
  return useQuery({
    queryKey: chatHistoryKeys.detail(id ?? -1),
    queryFn: () => fetchConversation(id as number),
    enabled: id !== null,
  });
}

export function useContinueConversation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => continueConversationApi(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: chatHistoryKeys.list });
    },
  });
}

export function useDeleteConversation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => deleteConversationApi(id),
    onSuccess: (_data, id) => {
      qc.invalidateQueries({ queryKey: chatHistoryKeys.list });
      qc.removeQueries({ queryKey: chatHistoryKeys.detail(id) });
    },
  });
}
