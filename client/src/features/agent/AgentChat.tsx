/**
 * AgentChat — the generic AI chat bottom sheet, usable from any tab.
 *
 * Thread identity is a server-side conversation (GET/POST /api/chat/*), not
 * a calendar day: a domain wrapper (e.g. NutritionChat) supplies a `context`
 * object (tab/selectedDate/focusedResource) that rides along on every send
 * so the agent can resolve vague references, but it is not what identifies
 * the thread. Tool-call rendering is fully pluggable — see registry.tsx —
 * so this file has no import of anything domain-specific; a domain plugs in
 * its own tool renderers and an optional composer plugin (extra attach
 * buttons, extra content above the composer).
 *
 * Preserved from the original nutrition-only implementation (bug history
 * worth keeping):
 * - Bottom sheet follows the finger via continuous pointermove drag, snaps
 *   on release by midpoint or a 0.3px/ms velocity threshold.
 * - PEEK_HEIGHT=0 — collapsed shows only the floating FAB, no visible sliver.
 *   A drag upward from the FAB opens the sheet; a tap (delta < 10px) opens
 *   it fully.
 * - Safe-area padding on the composer/sheet so it clears the iOS home
 *   indicator; overscroll containment + body scroll lock while expanded so
 *   the page behind the sheet never scrolls.
 * - Transcripts are DB-backed (server is the source of truth); localStorage
 *   is only a fast-path cache so a reload doesn't flash an empty thread.
 * - Dangling-run polling (3s interval, 2min timeout): if the user leaves
 *   while the agent is generating and returns while the server run is still
 *   in progress, a transcript refetch alone would show only the trailing
 *   user message with no reply. Polling picks up the assistant reply once
 *   the server-side run finishes persisting it.
 * - Stall watchdog (60s no activity): a stream that dies SILENTLY (a
 *   backgrounded mobile tab, a dropped connection, a proxy timing out
 *   without sending FIN) never rejects the fetch behind useChat, so
 *   `status` never leaves 'streaming' and the poll above never arms. The
 *   watchdog aborts the hung fetch and runs the same recovery as the poll.
 * - Disconnect-style errors (navigating away mid-stream) are spurious — the
 *   run completes server-side and the poll/refetch recovers it — so they're
 *   suppressed rather than shown as an error bubble.
 */
import {
  useState,
  useRef,
  useCallback,
  useEffect,
  forwardRef,
  useImperativeHandle,
} from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import type { UIMessage } from 'ai';
import ChatMessage from './ChatMessage';
import ErrorBubble, { isDisconnectError } from './ErrorBubble';
import { useAutoGrow } from './useAutoGrow';
import {
  VITE_API_URL,
  getAccessToken,
  fetchActiveConversation,
  startNewConversation,
  fetchResolutions,
  saveResolution,
} from './api';
import type { StoredChatMessage, ProposalResolution } from './api';
import type { AgentChatContext, ProposalResolutionState } from './registry';
// Built-in generic tool renderers self-register on import.
import './proposals/MutationProposalCard';
import styles from './AgentChat.module.scss';
import { ChevronDown, Plus, Square, Send, MessageSquare, RefreshCw } from 'lucide-react';
import useIsMobile from '../../hooks/useIsMobile';

// ---------------------------------------------------------------------------
// A composer plugin lets a domain add its own attach buttons and extra
// content (thumbnails, notices) without AgentChat knowing what they are.
// `hasPendingContent`/`renderAttachRow`/`renderAboveComposer` are plain
// values (not callbacks) so they naturally stay fresh across the plugin
// owner's own re-renders — AgentChat just reads whatever it was passed.
// ---------------------------------------------------------------------------
export type AgentMessagePart = Record<string, unknown>;

export interface ComposerPlugin {
  renderAttachRow?: React.ReactNode;
  renderAboveComposer?: React.ReactNode;
  hasPendingContent?: boolean;
  /** Called right before sending: returns extra parts (files, data-*
   *  attachments) to include, and should clear the plugin's own pending state. */
  takeAttachments?: () => Promise<AgentMessagePart[]> | AgentMessagePart[];
  /** Text to use when the composer is empty but attachments were taken
   *  (e.g. "Log this scanned product: X"). */
  fallbackText?: (attachments: AgentMessagePart[]) => string | null;
  /** Intercepts a paste into the composer textarea (e.g. a pasted image). */
  onComposerPaste?: (e: React.ClipboardEvent<HTMLTextAreaElement>) => void;
}

export interface AgentChatProps {
  open: boolean;
  onClose: () => void;
  context: AgentChatContext;
  composerPlugin?: ComposerPlugin;
  emptyHint?: string;
  /** Visible header title. */
  title?: string;
  /** Accessible label for the dialog and the FAB. */
  srLabel?: string;
  composerPlaceholder?: string;
}

// ---------------------------------------------------------------------------
// Imperative handle: the sheet manages its own open/expanded state
// internally (drag gestures, tap-to-open), so `open`/`onClose` above are not
// a real controlled-open API. A caller outside the sheet (e.g. chat history's
// "Continue" action, which reactivates a different conversation server-side)
// needs to both pull that new active conversation in and pop the sheet open;
// this ref exposes exactly that, without turning `open` into two competing
// sources of truth for the same state.
// ---------------------------------------------------------------------------
export interface AgentChatHandle {
  /** Re-resolves the caller's active conversation from the server (picking
   *  up whatever just became active) and expands the sheet to show it. */
  openActiveConversation: () => void;
}

// ---------------------------------------------------------------------------
// localStorage persistence — keyed by conversation id (the thread identity),
// not by date. A fast-path cache only; the server is the source of truth.
// ---------------------------------------------------------------------------
const LS_PREFIX = 'peak.agentChat.messages.';
const LS_RESOLUTIONS_PREFIX = 'peak.agentChat.resolutions.';
const LS_LAST_CONVERSATION_ID = 'peak.agentChat.lastConversationId';
const MAX_STORED_CONVERSATIONS = 7;

function lsKey(id: number) {
  return `${LS_PREFIX}${id}`;
}

function resolutionsKey(id: number) {
  return `${LS_RESOLUTIONS_PREFIX}${id}`;
}

function loadMessagesForConversation(id: number): UIMessage[] {
  try {
    const raw = localStorage.getItem(lsKey(id));
    if (!raw) return [];
    return JSON.parse(raw) as UIMessage[];
  } catch {
    return [];
  }
}

function pruneOldEntries(prefix: string, currentKey: string) {
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith(prefix)) keys.push(k);
  }
  if (keys.length <= MAX_STORED_CONVERSATIONS) return;
  keys.sort();
  const toRemove = keys
    .filter(k => k !== currentKey)
    .slice(0, keys.length - MAX_STORED_CONVERSATIONS);
  toRemove.forEach(k => localStorage.removeItem(k));
}

function saveMessagesForConversation(id: number, messages: UIMessage[]) {
  try {
    localStorage.setItem(lsKey(id), JSON.stringify(messages));
    pruneOldEntries(LS_PREFIX, lsKey(id));
  } catch {
    // storage full — ignore
  }
}

type ResolutionEntry = [string, ProposalResolutionState];

function loadResolutionsForConversation(id: number): ResolutionEntry[] {
  try {
    const raw = localStorage.getItem(resolutionsKey(id));
    if (!raw) return [];
    return JSON.parse(raw) as ResolutionEntry[];
  } catch {
    return [];
  }
}

function saveResolutionsForConversation(id: number, entries: ResolutionEntry[]) {
  try {
    localStorage.setItem(resolutionsKey(id), JSON.stringify(entries));
    pruneOldEntries(LS_RESOLUTIONS_PREFIX, resolutionsKey(id));
  } catch {
    // storage full — ignore
  }
}

// Cast StoredChatMessage[] to UIMessage[] for useChat.
function storedToUIMessages(stored: StoredChatMessage[]): UIMessage[] {
  return stored as unknown as UIMessage[];
}

// A transcript "ends in a dangling user message" when its last message has
// role 'user' with no following assistant reply. On return-while-generating
// the server has persisted the user row but not yet the assistant row, so
// the transcript looks like this until the run completes.
function endsInDanglingUser(messages: UIMessage[]): boolean {
  if (messages.length === 0) return false;
  return messages[messages.length - 1].role === 'user';
}

// Sheet height constants. PEEK_HEIGHT=0 — no visible sliver; the floating
// FAB replaces the peek strip.
const PEEK_HEIGHT = 0;
const EXPANDED_HEIGHT_VH = 88; // dvh

// The reconnect spin must complete a whole rotation or it reads as a stray
// flicker instead of an in-progress action. Matches the 1s
// .reconnectIconSpinning duration, so one rotation and the minimum are equal.
const RECONNECT_MIN_SPIN_MS = 1000;

const AgentChat = forwardRef<AgentChatHandle, AgentChatProps>(function AgentChat({
  open,
  onClose,
  context,
  composerPlugin,
  emptyHint = 'Ask me anything, or tell me what to log.',
  title = 'Ask AI',
  srLabel = 'AI chat',
  composerPlaceholder = 'Message the assistant…',
}: AgentChatProps, ref) {
  // Fast cache: seed from whichever conversation id we last knew about, so a
  // reload doesn't flash an empty thread while GET /active resolves.
  const lastKnownId = (() => {
    const raw = localStorage.getItem(LS_LAST_CONVERSATION_ID);
    const parsed = raw ? Number(raw) : NaN;
    return Number.isFinite(parsed) ? parsed : null;
  })();
  const initialMessages = lastKnownId !== null ? loadMessagesForConversation(lastKnownId) : [];
  const initialResolutions = lastKnownId !== null ? loadResolutionsForConversation(lastKnownId) : [];

  const [conversationId, setConversationId] = useState<number | null>(lastKnownId);
  const loadedConversationIdRef = useRef<number | null>(lastKnownId);
  const resolutionsConversationIdRef = useRef<number | null>(lastKnownId);

  // ---- useChat setup ----
  const { messages, setMessages, sendMessage, status, stop, error: chatError, clearError } = useChat({
    transport: new DefaultChatTransport({
      api: `${VITE_API_URL}/chat`,
      credentials: 'include',
      headers: async () => {
        const token = await getAccessToken();
        return { Authorization: `Bearer ${token}` };
      },
    }),
    messages: initialMessages,
  });

  // ---- Proposal resolution state ----
  // Unified across every proposal-capable tool (propose_entry,
  // propose_custom_food, propose_mutation, ...), keyed by toolCallId —
  // mirrors the server's generalized proposal_resolutions table exactly
  // (kind is a free-form resource tag, e.g. "entry" or "section.delete").
  const [resolutions, setResolutions] = useState<Map<string, ProposalResolutionState>>(new Map(initialResolutions));
  const [pendingDenialCount, setPendingDenialCount] = useState(0);

  useEffect(() => {
    if (conversationId === null) return;
    if (resolutionsConversationIdRef.current !== conversationId) return;
    saveResolutionsForConversation(conversationId, [...resolutions.entries()]);
  }, [resolutions, conversationId]);

  const applyServerResolutions = useCallback((forConversationId: number, rows: ProposalResolution[]) => {
    if (rows.length === 0) return;
    if (forConversationId !== loadedConversationIdRef.current) return; // stale — conversation switched mid-fetch
    setResolutions(prev => {
      const next = new Map(prev);
      for (const row of rows) {
        next.set(row.toolCallId, { kind: row.kind, status: row.status, displayName: row.displayName });
      }
      return next;
    });
  }, []);

  const refreshResolutionsFromServer = useCallback((forConversationId: number) => {
    fetchResolutions(forConversationId).then(rows => applyServerResolutions(forConversationId, rows)).catch(() => {});
  }, [applyServerResolutions]);

  // Records a proposal's outcome — persists to the server (best-effort) and
  // updates the local map that drives the generic confirmed/denied line.
  const resolveProposal = useCallback((
    toolCallId: string,
    status: 'confirmed' | 'denied',
    kind: string,
    displayName: string | null = null,
    result?: unknown,
  ) => {
    setResolutions(prev => new Map([...prev, [toolCallId, { kind, status, displayName }]]));
    if (status === 'denied') setPendingDenialCount(prev => prev + 1);
    if (conversationId !== null) {
      saveResolution(conversationId, toolCallId, kind, status, displayName, result).catch(() => {});
    }
  }, [conversationId]);

  // Keep a ref to the latest messages so stable callbacks can compare the
  // incoming transcript against what's currently loaded without re-creating
  // themselves on every message change.
  const messagesRef = useRef<UIMessage[]>(messages);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // Persist messages on every change
  useEffect(() => {
    if (conversationId !== null && messages.length > 0) {
      saveMessagesForConversation(conversationId, messages);
    }
  }, [messages, conversationId]);

  // ---------------------------------------------------------------------------
  // Resolve the active conversation and apply its transcript.
  //
  // Bug fix (part of the original #chat-midstream-persistence family): don't
  // let a leaner DB transcript clobber a richer local cache. On
  // return-after-disconnect the DB refetch could return fewer messages than
  // what's currently loaded (a completed/partial assistant message). The
  // more-complete set wins: if the DB transcript has fewer messages than
  // what's loaded, keep the loaded set (and re-save it); otherwise the DB
  // version is at least as complete, so it wins.
  //
  // `refreshResolutions` mirrors the original's selectivity: resolutions are
  // re-pulled from the server on mount/focus, but not on every poll tick or
  // watchdog/reconnect recovery (those already re-check every few seconds).
  // ---------------------------------------------------------------------------
  const fetchAndApplyActive = useCallback(async (
    baseline?: UIMessage[],
    refreshResolutions = false,
  ): Promise<UIMessage[] | null> => {
    try {
      const { conversation, messages: stored } = await fetchActiveConversation();
      const uiMessages = storedToUIMessages(stored);

      if (conversation.id !== loadedConversationIdRef.current) {
        // The active conversation changed underneath us (e.g. "New chat"
        // from another tab/device) — switch wholesale rather than merging.
        loadedConversationIdRef.current = conversation.id;
        resolutionsConversationIdRef.current = conversation.id;
        setConversationId(conversation.id);
        localStorage.setItem(LS_LAST_CONVERSATION_ID, String(conversation.id));
        setMessages(uiMessages);
        saveMessagesForConversation(conversation.id, uiMessages);
        setResolutions(new Map(loadResolutionsForConversation(conversation.id)));
        refreshResolutionsFromServer(conversation.id);
        return uiMessages;
      }

      const current = baseline ?? messagesRef.current;
      if (uiMessages.length < current.length) {
        saveMessagesForConversation(conversation.id, current);
        return current;
      }
      setMessages(uiMessages);
      saveMessagesForConversation(conversation.id, uiMessages);
      if (refreshResolutions) refreshResolutionsFromServer(conversation.id);
      return uiMessages;
    } catch {
      // Silently fall back to the localStorage cache
      return null;
    }
  }, [setMessages, refreshResolutionsFromServer]);

  // ---- Poll for an in-progress server run ----
  const [pollingActive, setPollingActive] = useState(false);

  // Latest useChat status, read inside stable callbacks without re-subscribing.
  const statusRef = useRef(status);
  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  const evaluateDangling = useCallback((applied: UIMessage[] | null) => {
    const set = applied ?? messagesRef.current;
    const isLiveStreaming = statusRef.current === 'streaming' || statusRef.current === 'submitted';
    setPollingActive(endsInDanglingUser(set) && !isLiveStreaming);
  }, []);

  // See AgentChatHandle: lets an external caller (chat history's "Continue")
  // pull in a conversation that was just made active elsewhere and pop the
  // sheet open, without turning `open` into a second, competing source of
  // truth for the sheet's own expand/collapse state.
  useImperativeHandle(ref, () => ({
    openActiveConversation: () => {
      fetchAndApplyActive(undefined, true).then(applied => evaluateDangling(applied));
      setExpanded(true);
    },
  }), [fetchAndApplyActive, evaluateDangling]);

  // On mount: resolve the active conversation, apply its transcript, then
  // evaluate the dangling condition. Also pulls server-side resolutions so
  // an accepted/denied proposal from another device renders resolved.
  useEffect(() => {
    fetchAndApplyActive(undefined, true).then(applied => evaluateDangling(applied));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // On window focus / visibilitychange — refetch so runs that completed
  // server-side while backgrounded show up, and (re)start polling if we
  // returned to a still-in-progress run.
  useEffect(() => {
    function handleVisibilityChange() {
      if (document.visibilityState === 'visible') {
        fetchAndApplyActive(undefined, true).then(applied => evaluateDangling(applied));
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleVisibilityChange);
    };
  }, [fetchAndApplyActive, evaluateDangling]);

  // The poll loop. Hard stops: assistant arrives (transcript no longer
  // dangling), 2-min timeout, user sends a new message (status becomes
  // submitted/streaming), or unmount.
  const POLL_INTERVAL_MS = 3000;
  const POLL_TIMEOUT_MS = 120000;
  useEffect(() => {
    if (!pollingActive) return;
    const startedAt = Date.now();

    const interval = setInterval(async () => {
      if (statusRef.current === 'streaming' || statusRef.current === 'submitted') {
        setPollingActive(false);
        return;
      }
      if (Date.now() - startedAt >= POLL_TIMEOUT_MS) {
        setPollingActive(false);
        return;
      }
      const applied = await fetchAndApplyActive();
      const set = applied ?? messagesRef.current;
      if (!endsInDanglingUser(set)) {
        setPollingActive(false);
      }
    }, POLL_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [pollingActive, fetchAndApplyActive]);

  // ---------------------------------------------------------------------------
  // Stall watchdog — detects a stream that died SILENTLY.
  //
  // routes/chat.ts already guarantees the model run completes and gets
  // persisted (it tees the UI message stream and drains one branch
  // server-side, independent of whether the client is still connected), and
  // the poll loop above already knows how to pull a completed reply back out
  // of the DB. But that poll only arms via evaluateDangling, which refuses
  // to run while `status` still reads 'streaming'/'submitted'. A socket that
  // dies loudly flips `status` away from streaming and everything above
  // already recovers. A socket that dies SILENTLY — a backgrounded mobile
  // tab, a dropped connection, a proxy timing out without sending FIN —
  // never rejects the fetch behind useChat, so `status` never leaves
  // 'streaming', the poll never arms, and the "still working" indicator
  // spins until the user reloads.
  //
  // Fix: track the timestamp of the last observed stream activity (the AI
  // SDK mutates `messages` on every incoming chunk, so a `useEffect` keyed
  // on `[messages, status]` stamping a ref is a sound proxy for "bytes are
  // still arriving"). Once STALL_THRESHOLD_MS passes with no activity, abort
  // the hung fetch and re-run the exact poll recovery.
  //
  // 60s: Heroku's router already terminates a streaming response after ~55s
  // with no bytes sent, so a genuine gap longer than that cannot survive
  // production regardless of what we do client-side.
  // ---------------------------------------------------------------------------
  const STALL_THRESHOLD_MS = 60000;
  const STALL_CHECK_INTERVAL_MS = 5000;

  const lastActivityRef = useRef<number>(Date.now());
  // Lets the working indicator read "Reconnecting…" instead of the plain
  // pending copy while the watchdog-triggered poll is recovering.
  const [watchdogFired, setWatchdogFired] = useState(false);

  useEffect(() => {
    lastActivityRef.current = Date.now();
  }, [messages, status]);

  useEffect(() => {
    if (status !== 'streaming' && status !== 'submitted') return;

    const interval = setInterval(() => {
      if (Date.now() - lastActivityRef.current < STALL_THRESHOLD_MS) return;
      setWatchdogFired(true);
      stop(); // abort the hung fetch — status leaves 'streaming'/'submitted'
      fetchAndApplyActive().then(applied => evaluateDangling(applied));
    }, STALL_CHECK_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [status, stop, fetchAndApplyActive, evaluateDangling]);

  // Once the recovery poll this watchdog armed has finished (or the
  // condition never actually applied), drop the "Reconnecting…" label so it
  // doesn't linger into some unrelated later wait.
  useEffect(() => {
    if (!pollingActive) setWatchdogFired(false);
  }, [pollingActive]);

  // Manual reconnect — the header refresh button runs the exact same
  // recovery as the watchdog, for a user who doesn't want to wait out
  // STALL_THRESHOLD_MS or has no browser refresh (bookmarked mobile PWA).
  const reconnectInFlightRef = useRef(false);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const reconnectStartRef = useRef(0);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    return () => clearTimeout(reconnectTimeoutRef.current);
  }, []);

  const handleManualReconnect = useCallback(() => {
    if (reconnectInFlightRef.current) return;
    reconnectInFlightRef.current = true;
    reconnectStartRef.current = Date.now();
    setIsReconnecting(true);
    setWatchdogFired(true);
    stop(); // aborts a hung fetch; isDisconnectError() swallows the resulting AbortError
    fetchAndApplyActive()
      .then(applied => evaluateDangling(applied))
      .finally(() => {
        // The guard releases with the spinner, not the fetch, so a repeat
        // tap during the deferred remainder is still ignored.
        const elapsed = Date.now() - reconnectStartRef.current;
        const remaining = RECONNECT_MIN_SPIN_MS - elapsed;
        const clear = () => {
          reconnectInFlightRef.current = false;
          setIsReconnecting(false);
        };
        if (remaining > 0) {
          reconnectTimeoutRef.current = setTimeout(clear, remaining);
        } else {
          clear();
        }
      });
  }, [stop, fetchAndApplyActive, evaluateDangling]);

  // Clear disconnect-style errors so they don't linger in useChat state once
  // the ErrorBubble is suppressed above (the poll/refetch is what actually
  // recovers the assistant reply, not this error).
  useEffect(() => {
    if (isDisconnectError(chatError)) {
      clearError();
    }
  }, [chatError, clearError]);

  // Detect mobile to suppress Enter-to-send
  const { isMobile } = useIsMobile();

  // ---- Sheet expand/collapse state ----
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (open) setExpanded(true);
  }, [open]);

  const collapse = useCallback(() => {
    setExpanded(false);
    onClose();
  }, [onClose]);

  // Lock body scroll while sheet is expanded
  useEffect(() => {
    if (expanded) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [expanded]);

  // ---- Composer state ----
  const [text, setText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);

  const isStreaming = status === 'streaming' || status === 'submitted';

  useAutoGrow(textareaRef, text);

  // ---- Stick-to-bottom — only auto-scroll when near bottom ----
  const isNearBottomRef = useRef(true);
  const NEAR_BOTTOM_THRESHOLD = 80; // px from bottom

  const checkNearBottom = useCallback(() => {
    const el = messagesContainerRef.current;
    if (!el) return;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    isNearBottomRef.current = distFromBottom <= NEAR_BOTTOM_THRESHOLD;
  }, []);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    if (isNearBottomRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior });
    }
  }, []);

  useEffect(() => {
    scrollToBottom('smooth');
  }, [messages, pollingActive, scrollToBottom]);

  useEffect(() => {
    if (expanded) {
      isNearBottomRef.current = true;
      messagesEndRef.current?.scrollIntoView({ behavior: 'instant' });
    }
  }, [expanded]);

  // ---- Send ----
  const canSend = (text.trim().length > 0 || !!composerPlugin?.hasPendingContent) && !isStreaming;

  const handleSend = useCallback(async () => {
    if (!canSend) return;

    setExpanded(true);
    isNearBottomRef.current = true; // force scroll to bottom on send
    setPollingActive(false); // this client will stream live — no poll/indicator
    lastActivityRef.current = Date.now();
    setWatchdogFired(false);

    // Denial(s) travel to the agent via the request body (not by editing the
    // user's visible message) so the system prompt can fold in a note for
    // this one turn, then the count is cleared so it isn't re-sent later.
    const deniedProposalCount = pendingDenialCount;
    if (deniedProposalCount > 0) setPendingDenialCount(0);

    let extraParts: AgentMessagePart[] = [];
    try {
      extraParts = (await composerPlugin?.takeAttachments?.()) ?? [];
    } catch {
      extraParts = [];
    }

    let msgText = text.trim();
    if (!msgText && extraParts.length > 0) {
      msgText = composerPlugin?.fallbackText?.(extraParts) ?? '';
    }
    setText('');

    const parts = [
      ...extraParts,
      ...(msgText ? [{ type: 'text' as const, text: msgText }] : []),
    ];

    await sendMessage(
      { parts } as Parameters<typeof sendMessage>[0],
      { body: { context, deniedProposalCount } },
    );
  }, [canSend, text, pendingDenialCount, context, sendMessage, composerPlugin]);

  const handleStop = useCallback(() => {
    stop();
  }, [stop]);

  // Enter to send on desktop only; on mobile Enter inserts newline.
  // Shift+Enter always inserts a newline regardless of platform.
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !isMobile) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend, isMobile]);

  // ---- New chat — archives the current conversation and starts a fresh one ----
  const handleNewChat = useCallback(async () => {
    try {
      const { conversation } = await startNewConversation();
      loadedConversationIdRef.current = conversation.id;
      resolutionsConversationIdRef.current = conversation.id;
      setConversationId(conversation.id);
      localStorage.setItem(LS_LAST_CONVERSATION_ID, String(conversation.id));
      setMessages([]);
      setResolutions(new Map());
      setPollingActive(false);
      clearError();
      setPendingDenialCount(0);
    } catch {
      // best-effort — the user is still looking at their previous chat
    }
  }, [setMessages, clearError]);

  // ---- Bottom sheet follows finger (continuous pointermove, snap on release) ----
  const sheetRef = useRef<HTMLDivElement>(null);
  const dragStartYRef = useRef<number | null>(null);
  const dragStartHeightRef = useRef<number>(PEEK_HEIGHT);
  const dragLastYRef = useRef<number>(0);
  const dragLastTimeRef = useRef<number>(0);
  const dragVelocityRef = useRef<number>(0); // px/ms — negative = upward (expand)
  const [draggingHeight, setDraggingHeight] = useState<number | null>(null);

  const getExpandedPx = useCallback((): number => {
    return Math.round(window.innerHeight * EXPANDED_HEIGHT_VH / 100);
  }, []);

  // Cancels the synthetic click a touch tap fires after pointerup, once this
  // button has unmounted in favor of the sheet's overlay. Must run on the
  // native touchstart: pointerup/pointerdown don't suppress it, and React's own touchstart handlers are passive.
  const attachFabTouchStartGuard = useCallback((node: HTMLButtonElement | null) => {
    if (!node) return;
    node.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
  }, []);

  const handleDragPointerDown = useCallback((e: React.PointerEvent) => {
    const currentHeight = expanded ? getExpandedPx() : PEEK_HEIGHT;
    dragStartYRef.current = e.clientY;
    dragStartHeightRef.current = currentHeight;
    dragLastYRef.current = e.clientY;
    dragLastTimeRef.current = e.timeStamp;
    dragVelocityRef.current = 0;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDraggingHeight(currentHeight);
  }, [expanded, getExpandedPx]);

  const handleDragPointerMove = useCallback((e: React.PointerEvent) => {
    if (dragStartYRef.current === null) return;

    const delta = dragStartYRef.current - e.clientY; // positive = dragged up = bigger height
    const raw = dragStartHeightRef.current + delta;
    const maxH = getExpandedPx();
    const clamped = Math.max(PEEK_HEIGHT, Math.min(raw, maxH));

    const dt = e.timeStamp - dragLastTimeRef.current;
    if (dt > 0) {
      dragVelocityRef.current = (dragLastYRef.current - e.clientY) / dt;
    }
    dragLastYRef.current = e.clientY;
    dragLastTimeRef.current = e.timeStamp;

    setDraggingHeight(clamped);
  }, [getExpandedPx]);

  const handleDragPointerUp = useCallback(() => {
    if (dragStartYRef.current === null) return;
    const height = draggingHeight ?? (expanded ? getExpandedPx() : PEEK_HEIGHT);
    const midpoint = (PEEK_HEIGHT + getExpandedPx()) / 2;
    const velocity = dragVelocityRef.current; // px/ms, positive=upward

    let shouldExpand: boolean;
    if (Math.abs(velocity) > 0.3) {
      shouldExpand = velocity > 0;
    } else {
      shouldExpand = height > midpoint;
    }

    setDraggingHeight(null);
    dragStartYRef.current = null;

    if (shouldExpand) {
      setExpanded(true);
    } else {
      collapse();
    }
  }, [draggingHeight, expanded, getExpandedPx, collapse]);

  const sheetStyle: React.CSSProperties = draggingHeight !== null
    ? { height: `${draggingHeight}px`, transition: 'none' }
    : {};

  const isExpanded = expanded;

  const lastAssistantIdx = messages.reduce((last, m, i) => m.role === 'assistant' ? i : last, -1);

  return (
    <>
      {isExpanded && (
        <div
          className={styles.overlay}
          onClick={collapse}
          aria-hidden="true"
        />
      )}

      <div
        ref={sheetRef}
        className={`${styles.sheet} ${isExpanded ? styles.sheetExpanded : styles.sheetPeek} ${draggingHeight !== null ? styles.sheetDragging : ''}`}
        style={sheetStyle}
        aria-label={`${srLabel} chat`}
        role="dialog"
      >
        <span className={styles.srOnly}>{srLabel}</span>

        {/* Entire header area is the drag target. When collapsed, this is
            the only visible region — a thin strip. When expanded, the
            header row (with title + buttons) also drags. */}
        <div
          className={styles.dragHandleBtn}
          onPointerDown={handleDragPointerDown}
          onPointerMove={handleDragPointerMove}
          onPointerUp={handleDragPointerUp}
          onPointerCancel={handleDragPointerUp}
          role="button"
          tabIndex={0}
          aria-label={isExpanded ? 'Collapse AI chat' : 'Expand AI chat'}
          aria-expanded={isExpanded}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              isExpanded ? collapse() : setExpanded(true);
            }
          }}
        >
          <span className={styles.dragHandle} aria-hidden="true" />
        </div>

        {isExpanded && (
          <div
            className={styles.header}
            onPointerDown={handleDragPointerDown}
            onPointerMove={handleDragPointerMove}
            onPointerUp={handleDragPointerUp}
            onPointerCancel={handleDragPointerUp}
          >
            <span className={styles.headerTitle}>{title}</span>

            <button
              type="button"
              className={styles.newChatBtn}
              onClick={(e) => { e.stopPropagation(); handleNewChat(); }}
              onPointerDown={(e) => e.stopPropagation()}
              aria-label="Start a new chat"
              title="New chat"
            >
              <Plus className={styles.newChatIcon} size={16} aria-hidden="true" />
            </button>

            {/* Manual escape hatch — re-runs the watchdog's recovery on
                demand, for a user who doesn't want to wait or has no
                browser refresh handy. */}
            <button
              type="button"
              className={styles.reconnectBtn}
              onClick={(e) => { e.stopPropagation(); handleManualReconnect(); }}
              onPointerDown={(e) => e.stopPropagation()}
              disabled={isReconnecting}
              aria-label="Reconnect"
              title="Reconnect to the assistant"
            >
              <RefreshCw
                className={`${styles.reconnectIcon} ${isReconnecting ? styles.reconnectIconSpinning : ''}`}
                size={16}
                aria-hidden="true"
              />
            </button>

            <button
              type="button"
              className={styles.closeBtn}
              onClick={(e) => { e.stopPropagation(); collapse(); }}
              onPointerDown={(e) => e.stopPropagation()}
              aria-label="Collapse"
            >
              <ChevronDown className={styles.collapseSvg} size={16} aria-hidden="true" />
            </button>
          </div>
        )}

        {/* overflow-behavior:contain prevents body scroll. When in peek
            state, scrolling is disabled entirely. */}
        <div
          ref={messagesContainerRef}
          className={`${styles.messages} ${!isExpanded ? styles.messagesPeek : ''}`}
          onScroll={checkNearBottom}
        >
          {messages.length === 0 && (
            <div className={styles.emptyHint}>
              <p>{emptyHint}</p>
            </div>
          )}

          {messages.map((message, idx) => (
            <ChatMessage
              key={message.id}
              message={message}
              isLastAssistant={idx === lastAssistantIdx}
              isStreaming={isStreaming}
              context={context}
              resolutions={resolutions}
              resolveProposal={resolveProposal}
            />
          ))}

          {/* Disconnect-style errors (navigation away mid-stream, aborted
              fetch) are spurious — the run completes server-side and the
              poll above recovers it — so they're suppressed rather than
              rendered here. */}
          {chatError && !isDisconnectError(chatError) && (
            <div className={styles.messageGroup}>
              <ErrorBubble error={chatError} />
            </div>
          )}

          {/* Poll "working" indicator — shown while a dangling server-side
              run is being polled and this client is NOT streaming live. */}
          {pollingActive && !isStreaming && (
            <div className={`${styles.messageGroup} ${styles.messageGroupAssistant}`}>
              <div className={styles.workingBubble}>
                <span className={styles.workingSpinner} aria-hidden="true" />
                <span>{watchdogFired ? 'Reconnecting…' : 'Assistant is still working…'}</span>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {composerPlugin?.renderAboveComposer}

        {/* Composer — safe-area padding, 16px font-size on mobile (no iOS
            zoom on focus). A composer plugin may add its own buttons above
            the textarea (see composerAttachRow). */}
        <div className={styles.composerWrap}>
          {composerPlugin?.renderAttachRow && (
            <div className={styles.composerAttachRow}>
              {composerPlugin.renderAttachRow}
            </div>
          )}

          <div className={styles.composer}>
            <textarea
              ref={textareaRef}
              className={styles.composerInput}
              placeholder={composerPlaceholder}
              value={text}
              onChange={e => setText(e.target.value)}
              onKeyDown={handleKeyDown}
              onPaste={composerPlugin?.onComposerPaste}
              onFocus={() => {
                setExpanded(true);
              }}
              rows={1}
              aria-label="Chat message"
            />

            {isStreaming ? (
              <button
                type="button"
                className={`${styles.sendBtn} ${styles.stopBtn}`}
                onClick={handleStop}
                aria-label="Stop generation"
              >
                <Square className={styles.sendIcon} size={16} aria-hidden="true" />
              </button>
            ) : (
              <button
                type="button"
                className={styles.sendBtn}
                onClick={handleSend}
                disabled={!canSend}
                aria-label="Send"
              >
                <Send className={styles.sendIcon} size={16} aria-hidden="true" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Floating chat FAB — visible only when the sheet is closed. Tap
          opens fully; drag upward drags the sheet open. */}
      {!isExpanded && (
        <button
          type="button"
          ref={attachFabTouchStartGuard}
          className={styles.floatingChatBtn}
          aria-label={`Open ${srLabel} chat`}
          onPointerDown={(e: React.PointerEvent<HTMLButtonElement>) => {
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
            dragStartYRef.current = e.clientY;
            dragStartHeightRef.current = 0;
            dragLastYRef.current = e.clientY;
            dragLastTimeRef.current = e.timeStamp;
            dragVelocityRef.current = 0;
            setDraggingHeight(0);
          }}
          onPointerMove={(e: React.PointerEvent<HTMLButtonElement>) => {
            if (dragStartYRef.current === null) return;
            const delta = dragStartYRef.current - e.clientY;
            const raw = dragStartHeightRef.current + delta;
            const maxH = getExpandedPx();
            const clamped = Math.max(0, Math.min(raw, maxH));
            const dt = e.timeStamp - dragLastTimeRef.current;
            if (dt > 0) {
              dragVelocityRef.current = (dragLastYRef.current - e.clientY) / dt;
            }
            dragLastYRef.current = e.clientY;
            dragLastTimeRef.current = e.timeStamp;
            setDraggingHeight(clamped);
          }}
          onPointerUp={(e: React.PointerEvent<HTMLButtonElement>) => {
            if (dragStartYRef.current === null) return;
            const startY = dragStartYRef.current;
            const endY = e.clientY;
            const totalDelta = startY - endY;
            dragStartYRef.current = null;
            setDraggingHeight(null);

            if (totalDelta < 10) {
              // Tap (minimal drag) — open fully
              setExpanded(true);
            } else {
              // Drag release — apply snap logic
              const height = draggingHeight ?? 0;
              const midpoint = getExpandedPx() / 2;
              const velocity = dragVelocityRef.current;
              const shouldExpand = Math.abs(velocity) > 0.3 ? velocity > 0 : height > midpoint;
              if (shouldExpand) {
                setExpanded(true);
              }
            }
          }}
          onPointerCancel={() => {
            dragStartYRef.current = null;
            setDraggingHeight(null);
          }}
          onClick={(e) => {
            // Backstop for any click that still reaches this button, such as
            // a real mouse click. Keeps it from bubbling past the FAB.
            e.stopPropagation();
          }}
        >
          <MessageSquare className={styles.floatingChatBtnIcon} size={16} aria-hidden="true" />
        </button>
      )}
    </>
  );
});

export default AgentChat;
