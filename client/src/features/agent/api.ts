// Conversation-based chat API — the generic agent's thread identity is a
// conversation id, not a calendar day. Mirrors the backend contract in
// routes/chat.ts and services/conversations/store.ts (kept in sync by hand,
// same convention as features/nutrition/types.ts).
import clientApi from '../../api/clientApi.js';

export const VITE_API_URL = (import.meta as unknown as { env: Record<string, string> }).env.VITE_API_URL || '/api';

// ---------------------------------------------------------------------------
// Auth helper — mirrors clientApi.js's interceptor logic. useChat's transport
// needs a plain fetch-header function, not an axios instance.
// ---------------------------------------------------------------------------
export async function getAccessToken(): Promise<string> {
  let token = sessionStorage.getItem('accessToken');
  if (token) {
    try {
      const { exp } = JSON.parse(atob(token.split('.')[1]));
      if (Date.now() < exp * 1000) return token;
    } catch { /* invalid token — fall through */ }
  }
  const res = await fetch(`${VITE_API_URL}/auth/token`, {
    method: 'POST',
    credentials: 'include',
  });
  if (!res.ok) throw new Error('Token refresh failed');
  const data = await res.json();
  token = data.data.accessToken as string;
  sessionStorage.setItem('accessToken', token);
  return token;
}

export interface Conversation {
  id: number;
  title: string | null;
  active: boolean;
  archived_at: string | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
  /** Only present on rows from GET /chat/conversations (the list endpoint),
   *  which joins these in server-side; other endpoints answer with a full
   *  messages array instead and leave these unset. */
  message_count?: number;
  preview?: string | null;
}

/** A stored chat message row as returned by the server. */
export type StoredChatMessage = {
  id: number;
  message_id: string;
  role: 'user' | 'assistant' | 'system';
  parts: unknown[];
  interrupted: boolean;
  created_at: string;
};

export interface ConversationWithMessages {
  conversation: Conversation;
  messages: StoredChatMessage[];
}

/** Resolve (or create) the caller's active conversation, with its messages. */
export async function fetchActiveConversation(): Promise<ConversationWithMessages> {
  const res = await clientApi.get('/chat/active');
  return res.data.data;
}

/** Fetch one conversation the caller owns, with its messages. */
export async function fetchConversation(id: number): Promise<ConversationWithMessages> {
  const res = await clientApi.get(`/chat/conversations/${id}`);
  return res.data.data;
}

/** Start a new conversation, archiving whichever one was previously active. */
export async function startNewConversation(): Promise<ConversationWithMessages> {
  const res = await clientApi.post('/chat/conversations');
  return res.data.data;
}

/** List every conversation the caller owns, most recently updated first. */
export async function fetchConversations(): Promise<Conversation[]> {
  const res = await clientApi.get('/chat/conversations');
  return res.data.data;
}

/** Reactivate an archived conversation, resetting its expiry and archiving whatever else is active. */
export async function continueConversation(id: number): Promise<ConversationWithMessages> {
  const res = await clientApi.post(`/chat/conversations/${id}/continue`);
  return res.data.data;
}

/** Permanently delete a conversation, its messages, and its resolutions. */
export async function deleteConversation(id: number): Promise<void> {
  await clientApi.delete(`/chat/conversations/${id}`);
}

// ---- Proposal resolutions ----
// `kind` is a free-form resource tag (e.g. "entry", "section.delete") rather
// than a closed union — one resolution mechanism now covers proposals from
// any resource, not just nutrition's original two kinds.
export type ProposalResolution = {
  toolCallId: string;
  kind: string;
  status: 'confirmed' | 'denied';
  displayName: string | null;
};

/** Load all resolved proposals for a conversation. */
export async function fetchResolutions(conversationId: number): Promise<ProposalResolution[]> {
  const res = await clientApi.get(`/chat/conversations/${conversationId}/resolutions`);
  const rows = (res.data.data ?? []) as {
    tool_call_id: string;
    kind: string;
    status: 'confirmed' | 'denied';
    display_name: string | null;
  }[];
  return rows.map(r => ({ toolCallId: r.tool_call_id, kind: r.kind, status: r.status, displayName: r.display_name }));
}

/**
 * Record a single proposal's resolution. `result` is an optional structured
 * outcome of a confirmed write (e.g. `{ id }`, or an array of those for a
 * batch) that the server surfaces back to the agent next turn — see
 * routes/chat.ts's POST /conversations/:id/resolutions.
 */
export async function saveResolution(
  conversationId: number,
  toolCallId: string,
  kind: string,
  status: 'confirmed' | 'denied',
  displayName: string | null = null,
  result?: unknown,
): Promise<void> {
  await clientApi.post(`/chat/conversations/${conversationId}/resolutions`, { toolCallId, kind, status, displayName, result });
}
