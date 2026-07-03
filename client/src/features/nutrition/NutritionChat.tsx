/**
 * NutritionChat — Phase 2 AI chat bottom-sheet (custom CSS sheet).
 *
 * Polish-3 features implemented:
 * #2  Bottom sheet follows finger (continuous pointermove drag, snap on release)
 * #3  Safe-area padding on composer (env(safe-area-inset-bottom))
 * #4  textarea font-size 16px on mobile (no iOS zoom on focus)
 * #6  Scroll containment (overscroll-behavior:contain; body scroll lock when expanded)
 * #7  Clear-chat button in header (clearTranscript + localStorage drop)
 * #8  Stop button on send area while streaming; interrupted marker on message
 * #9  Inline proposal — EntryEditor renders as a card in the message list
 * #10 Serving pre-select — ProposeEntryArgs passed directly to proposal mode
 * #12 Stick-to-bottom — auto-scroll only while near the bottom; pauses on scroll-up
 * #14 Send→Stop button during streaming (stop icon, calls useChat stop())
 * #15 Transcripts = DB source of truth (fetchTranscript on open/day-change/focus)
 * #17 Interrupted marker for assistant rows that ended without onFinish
 *
 * Feedback-issues fixes:
 * #61 Safe-area on sheet bottom so composer clears iOS home indicator
 * #64 overscroll-behavior containment + touch-action on header to stop page scroll bleed
 * #65 Entire header row acts as drag handle (not just the thin pill)
 * #66 Animate reasoning open/close (max-height transition, same as ToolCallCard)
 * #70 Confirm before clearing chat (ConfirmModal)
 * #71 Confirmed-proposal line includes entry name (rawArgs.name)
 * #74 Messages not scrollable while sheet is in peek state
 * #76 Collapse adjacent reasoning parts into one block per message
 * #77 ReasoningBubble collapsed state matches ToolCallCard styling
 */
import {
  useState,
  useRef,
  useCallback,
  useEffect,
} from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, isToolUIPart, getToolName } from 'ai';
import type { FileUIPart, UIMessage, ToolUIPart, DynamicToolUIPart } from 'ai';
import ReactMarkdown from 'react-markdown';
import { useCreateEntry, useCreateCustomFood, fetchTranscript, clearTranscript } from './api';
import type { StoredChatMessage } from './api';
import EntryEditor from './EntryEditor';
import MealBuilder from './MealBuilder';
import BarcodeScanner from './BarcodeScanner';
import ToolCallCard from './ToolCallCard';
import ConfirmModal from '../../components/ConfirmModal';
import type { EntryInput, EntryEditorMode, ProposeEntryArgs, ProposeCustomFoodArgs, CustomFoodInput } from './types';
import styles from './NutritionChat.module.scss';
import { ChevronDown, Trash2, Camera, ScanBarcode, Square, Send, Images, AlertCircle, ChevronRight, MessageSquare } from 'lucide-react';
import useIsMobile from '../../hooks/useIsMobile';

// ---------------------------------------------------------------------------
// Auth helper — mirrors clientApi.js interceptor logic
// ---------------------------------------------------------------------------
const VITE_API_URL = (import.meta as unknown as { env: Record<string, string> }).env.VITE_API_URL || '/api';

async function getAccessToken(): Promise<string> {
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

// ---------------------------------------------------------------------------
// Image downscaler — canvas → JPEG data URL, max 1024px, quality 0.8
// ---------------------------------------------------------------------------
const MAX_EDGE = 1024;
const JPEG_QUALITY = 0.8;

async function downscaleImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);

      let { width, height } = img;
      if (width > MAX_EDGE || height > MAX_EDGE) {
        const ratio = Math.min(MAX_EDGE / width, MAX_EDGE / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) { reject(new Error('Canvas not available')); return; }
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', JPEG_QUALITY));
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Image load failed'));
    };

    img.src = objectUrl;
  });
}

// ---------------------------------------------------------------------------
// Pending photo state
// ---------------------------------------------------------------------------
interface PendingPhoto {
  file: File;
  previewUrl: string;
  dataUrl?: string;
}

// ---------------------------------------------------------------------------
// localStorage persistence helpers
// ---------------------------------------------------------------------------
const LS_PREFIX = 'peak.nutritionChat.';
const MAX_STORED_DAYS = 7;

function lsKey(date: string) {
  return `${LS_PREFIX}${date}`;
}

function loadMessagesForDate(date: string): UIMessage[] {
  try {
    const raw = localStorage.getItem(lsKey(date));
    if (!raw) return [];
    return JSON.parse(raw) as UIMessage[];
  } catch {
    return [];
  }
}

function saveMessagesForDate(date: string, messages: UIMessage[]) {
  try {
    localStorage.setItem(lsKey(date), JSON.stringify(messages));
    pruneOldDays(date);
  } catch {
    // storage full — ignore
  }
}

function dropMessagesForDate(date: string) {
  localStorage.removeItem(lsKey(date));
}

function pruneOldDays(currentDate: string) {
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith(LS_PREFIX)) keys.push(k);
  }
  if (keys.length <= MAX_STORED_DAYS) return;
  keys.sort();
  const currentKey = lsKey(currentDate);
  const toRemove = keys
    .filter(k => k !== currentKey)
    .slice(0, keys.length - MAX_STORED_DAYS);
  toRemove.forEach(k => localStorage.removeItem(k));
}

// ---------------------------------------------------------------------------
// Cast StoredChatMessage[] to UIMessage[] for useChat (#15)
// ---------------------------------------------------------------------------
function storedToUIMessages(stored: StoredChatMessage[]): UIMessage[] {
  return stored as unknown as UIMessage[];
}

// ---------------------------------------------------------------------------
// Strip OpenAI-style citation tokens from assistant text.
// Models sometimes emit markers like citeturn1view1 wrapped in private-use-area
// unicode chars (U+E200–U+E2FF range). Strip both the PUA-delimited form and
// any bare "cite…turn…" token so they don't show as garbage in the UI.
// Applied only to assistant text, never to user input.
// ---------------------------------------------------------------------------
function stripCitationTokens(text: string): string {
  return text
    // Remove PUA-delimited citation spans. Models (e.g. some OpenAI runs) emit
    // characters in U+E200-U+E2FF as open/close delimiters around tokens like
    // "turn1view1". Strip the delimiters and any content they enclose.
    .replace(/[-][^-]*[-]/g, '')
    // Also strip bare cite-token patterns that may appear without PUA delimiters,
    // e.g. citeturn1view1 or citeturn0search5.
    .replace(/cite\w*turn\d+\w*/gi, '');
}

// ---------------------------------------------------------------------------
// Auto-grow textarea hook
// ---------------------------------------------------------------------------
function useAutoGrow(ref: React.RefObject<HTMLTextAreaElement | null>, value: string) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || 21;
    const maxLines = 8;
    const maxHeight = lineHeight * maxLines + 20;
    el.style.height = Math.min(el.scrollHeight, maxHeight) + 'px';
    el.style.overflowY = el.scrollHeight > maxHeight ? 'auto' : 'hidden';
  }, [value, ref]);
}

// ---------------------------------------------------------------------------
// #66/#77: Reasoning collapsible — animated like ToolCallCard
// ---------------------------------------------------------------------------
interface ReasoningBubbleProps {
  text: string;
  streaming: boolean;
}

function ReasoningBubble({ text, streaming }: ReasoningBubbleProps) {
  const [open, setOpen] = useState(false);
  const innerRef = useRef<HTMLDivElement>(null);

  if (!streaming && !text.trim()) return null;

  return (
    <div className={styles.reasoning}>
      {/* #77: collapsed header matches ToolCallCard .header styling */}
      <button
        type="button"
        className={styles.reasoningToggle}
        onClick={() => setOpen(p => !p)}
        aria-expanded={open}
      >
        {/* #77: same chevron pattern as ToolCallCard */}
        <ChevronDown
          className={`${styles.reasoningChevron} ${open ? styles.reasoningChevronOpen : ''}`}
          size={16}
          aria-hidden="true"
          style={{ display: 'block' }}
        />
        {streaming ? 'Thinking…' : 'Reasoning'}
        {/* Streaming pulse dot — matches ToolCallCard spinner */}
        {streaming && <span className={styles.reasoningSpinner} aria-hidden="true" />}
      </button>

      {/* #66: Animated body — max-height transition same as ToolCallCard AnimatedBody */}
      <div
        className={`${styles.reasoningBody} ${open ? styles.reasoningBodyOpen : ''}`}
        style={
          open
            ? { maxHeight: innerRef.current ? innerRef.current.scrollHeight + 'px' : '800px' }
            : { maxHeight: '0px' }
        }
        aria-hidden={!open}
      >
        <div ref={innerRef} className={styles.reasoningText}>
          <ReactMarkdown>{stripCitationTokens(text)}</ReactMarkdown>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// #107: Error bubble — shown in the chat thread when useChat surfaces an error
// ---------------------------------------------------------------------------
interface ErrorBubbleProps {
  error: Error;
}

function ErrorBubble({ error }: ErrorBubbleProps) {
  const [expanded, setExpanded] = useState(false);

  const detail = (() => {
    try {
      // Try to parse as JSON for richer display
      const parsed = JSON.parse(error.message);
      return JSON.stringify(parsed, null, 2);
    } catch {
      return error.message || String(error);
    }
  })();

  return (
    <div className={styles.errorBubble}>
      <button
        type="button"
        className={styles.errorBubbleToggle}
        onClick={() => setExpanded(p => !p)}
        aria-expanded={expanded}
      >
        <AlertCircle className={styles.errorBubbleIcon} size={16} aria-hidden="true" />
        <span className={styles.errorBubbleLabel}>Something went wrong</span>
        <ChevronRight
          className={`${styles.errorBubbleChevron} ${expanded ? styles.errorBubbleChevronOpen : ''}`}
          size={16}
          aria-hidden="true"
        />
      </button>
      {expanded && (
        <pre className={styles.errorBubbleDetail}>{detail}</pre>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// #76: Merge adjacent reasoning parts in a message into a single combined block
// ---------------------------------------------------------------------------
type MergedPart =
  | { type: 'merged-reasoning'; text: string; streaming: boolean; originalIndices: number[] }
  | { type: 'other'; part: UIMessage['parts'][number]; originalIndex: number };

function mergeReasoningParts(parts: UIMessage['parts']): MergedPart[] {
  const result: MergedPart[] = [];

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part.type === 'reasoning') {
      // Start a merged reasoning block
      const texts: string[] = [part.text];
      const indices: number[] = [i];
      const isStreaming = part.state === 'streaming';
      let mergedStreaming = isStreaming;

      // Consume all consecutive reasoning parts
      while (i + 1 < parts.length && parts[i + 1].type === 'reasoning') {
        i++;
        const next = parts[i] as { type: 'reasoning'; text: string; state?: string };
        texts.push(next.text);
        indices.push(i);
        if (next.state === 'streaming') mergedStreaming = true;
      }

      result.push({
        type: 'merged-reasoning',
        text: texts.join('\n\n'),
        streaming: mergedStreaming,
        originalIndices: indices,
      });
    } else {
      result.push({ type: 'other', part, originalIndex: i });
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Message bubble
// ---------------------------------------------------------------------------
interface MessageProps {
  message: UIMessage;
  isLastAssistant: boolean;
  isStreaming: boolean;
  selectedDate: string;
  onProposalConfirm: (input: EntryInput, partKey: string) => void;
  onProposalDeny: (partKey: string) => void;
  deniedProposals: Set<string>;
  confirmedProposals: Map<string, string>; // partKey → entry name
  onCustomFoodConfirm: (payload: CustomFoodInput, partKey: string) => void;
  onCustomFoodDeny: (partKey: string) => void;
  deniedCustomFoodProposals: Set<string>;
  confirmedCustomFoodProposals: Map<string, string>; // partKey → food name
}

function ChatMessage({
  message,
  isLastAssistant,
  isStreaming,
  selectedDate,
  onProposalConfirm,
  onProposalDeny,
  deniedProposals,
  confirmedProposals,
  onCustomFoodConfirm,
  onCustomFoodDeny,
  deniedCustomFoodProposals,
  confirmedCustomFoodProposals,
}: MessageProps) {
  const isUser = message.role === 'user';
  // #15/#17: interrupted flag from StoredChatMessage cast
  const interrupted = !!(message as unknown as { interrupted?: boolean }).interrupted;
  const isStreamingThis = isLastAssistant && isStreaming;

  // #76: merge adjacent reasoning parts before rendering
  const mergedParts = mergeReasoningParts(message.parts);

  return (
    <div className={`${styles.messageGroup} ${isUser ? styles.messageGroupUser : styles.messageGroupAssistant}`}>
      {mergedParts.map((merged, renderIdx) => {
        // ---- Merged reasoning block (#76) ----
        if (merged.type === 'merged-reasoning') {
          return (
            <ReasoningBubble
              key={`reasoning-${renderIdx}`}
              text={merged.text}
              streaming={merged.streaming}
            />
          );
        }

        const { part, originalIndex: idx } = merged;

        // ---- Text part ----
        if (part.type === 'text') {
          if (!part.text) return null;
          return (
            <div
              key={idx}
              className={`${styles.bubble} ${isUser ? styles.bubbleUser : styles.bubbleAssistant}`}
            >
              {isUser ? (
                <p className={styles.bubbleText}>{part.text}</p>
              ) : (
                <div className={styles.bubbleMarkdown}>
                  <ReactMarkdown>{stripCitationTokens(part.text)}</ReactMarkdown>
                </div>
              )}
            </div>
          );
        }

        // ---- File part (user-attached image) ----
        if (part.type === 'file' && part.mediaType.startsWith('image/')) {
          return (
            <img
              key={idx}
              src={part.url}
              alt="Attached image"
              className={styles.attachedImage}
            />
          );
        }

        // ---- Tool invocation part ----
        if (isToolUIPart(part)) {
          const toolName = getToolName(part as ToolUIPart | DynamicToolUIPart);
          const toolCallId = (part as { toolCallId: string }).toolCallId;

          // #9: propose_entry renders as an inline EntryEditor card
          if (toolName === 'propose_entry') {
            const partKey = `${message.id}-${toolCallId}`;
            const isDenied = deniedProposals.has(partKey);
            const confirmedName = confirmedProposals.get(partKey);
            const isConfirmed = confirmedName !== undefined;

            if (isDenied) {
              return (
                <div key={idx} className={styles.proposalDenied}>
                  Proposal declined — please refine your request.
                </div>
              );
            }
            // #71: include entry name in confirmed message
            if (isConfirmed) {
              return (
                <div key={idx} className={styles.proposalConfirmed}>
                  {confirmedName ? `Logged: ${confirmedName}` : 'Entry logged!'}
                </div>
              );
            }
            if (part.state !== 'input-available' && part.state !== 'output-available') {
              return <ToolCallCard key={idx} part={part as ToolUIPart | DynamicToolUIPart} />;
            }

            // #10: pass the raw ProposeEntryArgs (with quantity/unit/portions) directly
            const rawArgs = (part.state === 'output-available'
              ? (part as { output: unknown }).output
              : part.input) as ProposeEntryArgs;

            // Build the mode using ProposeEntryArgs (not a plain EntryInput)
            const mode: EntryEditorMode = {
              kind: 'proposal',
              date: selectedDate,
              proposal: rawArgs,
            };

            return (
              <div key={idx} className={styles.proposalInlineWrap}>
                {/* #9: inline=true → card in thread, no Dialog overlay */}
                <EntryEditor
                  open={true}
                  inline={true}
                  mode={mode}
                  onClose={() => onProposalDeny(partKey)}
                  onConfirm={(input) => onProposalConfirm(input, partKey)}
                  onDeny={() => onProposalDeny(partKey)}
                />
              </div>
            );
          }

          // propose_custom_food: renders as an inline pre-filled MealBuilder card
          if (toolName === 'propose_custom_food') {
            const partKey = `${message.id}-${toolCallId}`;
            const isDenied = deniedCustomFoodProposals.has(partKey);
            const confirmedName = confirmedCustomFoodProposals.get(partKey);
            const isConfirmed = confirmedName !== undefined;

            if (isDenied) {
              return (
                <div key={idx} className={styles.proposalDenied}>
                  Proposal declined — please refine your request.
                </div>
              );
            }
            if (isConfirmed) {
              return (
                <div key={idx} className={styles.proposalConfirmed}>
                  {confirmedName ? `Saved: ${confirmedName}` : 'Custom food saved!'}
                </div>
              );
            }
            if (part.state !== 'input-available' && part.state !== 'output-available') {
              return <ToolCallCard key={idx} part={part as ToolUIPart | DynamicToolUIPart} />;
            }

            const rawArgs = (part.state === 'output-available'
              ? (part as { output: unknown }).output
              : part.input) as ProposeCustomFoodArgs;

            return (
              <div key={idx} className={styles.proposalInlineWrap}>
                <MealBuilder
                  open={true}
                  kind={rawArgs.kind}
                  proposalArgs={rawArgs}
                  onClose={() => onCustomFoodDeny(partKey)}
                  onDenyProposal={() => onCustomFoodDeny(partKey)}
                  onConfirmProposal={(payload) => onCustomFoodConfirm(payload, partKey)}
                />
              </div>
            );
          }

          // #104: hide the calculator tool card — it's an implementation detail
          if (toolName === 'calculator') return null;

          return <ToolCallCard key={idx} part={part as ToolUIPart | DynamicToolUIPart} />;
        }

        return null;
      })}

      {/* #8/#17: interrupted marker for assistant messages that ended mid-stream */}
      {!isUser && interrupted && !isStreamingThis && (
        <div className={styles.interruptedMarker}>
          Response interrupted
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// NutritionChat — custom CSS bottom sheet
// ---------------------------------------------------------------------------
interface NutritionChatProps {
  open: boolean;
  onClose: () => void;
  selectedDate: string;
}

// Sheet height constants
// #116: PEEK_HEIGHT=0 — no visible sliver; floating FAB replaces the peek strip.
const PEEK_HEIGHT = 0;
const EXPANDED_HEIGHT_VH = 88; // dvh

export default function NutritionChat({ open, onClose, selectedDate }: NutritionChatProps) {
  // #15: Load from localStorage as fast cache; DB will override on mount.
  const initialMessages = loadMessagesForDate(selectedDate);

  const loadedDateRef = useRef(selectedDate);

  // ---- useChat setup ----
  const { messages, setMessages, sendMessage, status, stop, error: chatError, clearError } = useChat({
    transport: new DefaultChatTransport({
      api: `${VITE_API_URL}/nutrition/chat`,
      credentials: 'include',
      headers: async () => {
        const token = await getAccessToken();
        return { Authorization: `Bearer ${token}` };
      },
      body: { selectedDate },
    }),
    messages: initialMessages,
  });

  // Keep a ref to the latest messages so the (stable) refetch callback can compare
  // the incoming DB transcript against what's currently loaded without re-creating
  // itself on every message change.
  const messagesRef = useRef<UIMessage[]>(messages);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // Persist messages on every change
  useEffect(() => {
    if (messages.length > 0) {
      saveMessagesForDate(selectedDate, messages);
    }
  }, [messages, selectedDate]);

  // #15: Fetch transcript from DB on mount (DB is source of truth).
  //
  // Bug fix (#chat-midstream-persistence, part 2): don't let a leaner DB transcript
  // clobber a richer local cache. On return-after-disconnect the DB refetch could
  // return fewer messages (e.g. only the user message) than what's currently loaded
  // — a completed/partial assistant message. Combined with the effect above that
  // persists `messages` to localStorage, blindly applying the shorter DB set would
  // discard the more-complete transcript.
  //
  // Rule: the more-complete set wins. If the DB transcript has fewer messages than
  // what's currently loaded, keep the loaded set (and re-save it, since a shorter DB
  // may have overwritten the cache on a previous pass). Otherwise the DB version is
  // at least as complete, so it wins — preserving DB-as-source-of-truth for the
  // normal case and for runs that completed server-side while backgrounded.
  const fetchAndApplyTranscript = useCallback(async (date: string, baseline?: UIMessage[]) => {
    try {
      const stored = await fetchTranscript(date);
      if (stored.length === 0) return;
      const uiMessages = storedToUIMessages(stored);
      // `baseline` is the known-correct current set for `date` (e.g. the freshly
      // loaded cache on a day switch, where messagesRef may still hold the old day).
      // Fall back to the live ref when no explicit baseline is given.
      const current = baseline ?? messagesRef.current;
      if (uiMessages.length < current.length) {
        // DB is missing messages the cache/UI has — never lose them.
        saveMessagesForDate(date, current);
        return;
      }
      setMessages(uiMessages);
      saveMessagesForDate(date, uiMessages);
    } catch {
      // Silently fall back to localStorage cache
    }
  }, [setMessages]);

  // On mount: load transcript from DB
  useEffect(() => {
    fetchAndApplyTranscript(selectedDate);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When selectedDate changes: switch to new day's messages (LS first, then DB)
  useEffect(() => {
    if (selectedDate !== loadedDateRef.current) {
      loadedDateRef.current = selectedDate;
      const cached = loadMessagesForDate(selectedDate);
      setMessages(cached);
      fetchAndApplyTranscript(selectedDate, cached);
    }
  }, [selectedDate, setMessages, fetchAndApplyTranscript]);

  // #15: On window focus / visibilitychange — refetch transcript so runs that
  // completed server-side while the tab was backgrounded show up.
  useEffect(() => {
    function handleVisibilityChange() {
      if (document.visibilityState === 'visible') {
        fetchAndApplyTranscript(selectedDate);
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleVisibilityChange);
    };
  }, [selectedDate, fetchAndApplyTranscript]);

  // #105: detect mobile to suppress Enter-to-send
  const { isMobile } = useIsMobile();

  // ---- Sheet expand/collapse state ----
  const [expanded, setExpanded] = useState(false);

  // When the parent sets `open` → expand
  useEffect(() => {
    if (open) setExpanded(true);
  }, [open]);

  const collapse = useCallback(() => {
    setExpanded(false);
    onClose();
  }, [onClose]);

  // #6: Lock body scroll while sheet is expanded
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

  // ---- Entry creation for confirmed proposals ----
  const createEntry = useCreateEntry(selectedDate);

  // ---- Custom food creation for confirmed propose_custom_food proposals ----
  const createCustomFood = useCreateCustomFood();

  // ---- Proposal state tracking ----
  const [deniedProposals, setDeniedProposals] = useState<Set<string>>(new Set());
  // #71: store name alongside confirmation so the message can display it
  const [confirmedProposals, setConfirmedProposals] = useState<Map<string, string>>(new Map());

  // ---- Custom food proposal state tracking ----
  const [deniedCustomFoodProposals, setDeniedCustomFoodProposals] = useState<Set<string>>(new Set());
  const [confirmedCustomFoodProposals, setConfirmedCustomFoodProposals] = useState<Map<string, string>>(new Map());

  // ---- Composer state ----
  const [text, setText] = useState('');
  const [pendingPhotos, setPendingPhotos] = useState<PendingPhoto[]>([]);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [barcodeOpen, setBarcodeOpen] = useState(false);

  // #70: confirm-clear-chat dialog state
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  // ---- Refs ----
  const fileInputRef = useRef<HTMLInputElement>(null);
  // #106: separate hidden input for photo library (no capture attribute)
  const libraryInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);

  const isStreaming = status === 'streaming' || status === 'submitted';

  useAutoGrow(textareaRef, text);

  // ---- #12: Stick-to-bottom — only auto-scroll when near bottom ----
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

  // Scroll to bottom when messages change, only if near bottom
  useEffect(() => {
    scrollToBottom('smooth');
  }, [messages, scrollToBottom]);

  // On initial open: jump to bottom immediately
  useEffect(() => {
    if (expanded) {
      isNearBottomRef.current = true;
      messagesEndRef.current?.scrollIntoView({ behavior: 'instant' });
    }
  }, [expanded]);

  // ---- Photo handling ----
  const handlePhotoFiles = useCallback(async (files: FileList) => {
    setPhotoError(null);
    const incoming = Array.from(files).filter(f => f.type.startsWith('image/'));
    if (incoming.length === 0) return;

    const newPhotos: PendingPhoto[] = incoming.map(file => ({
      file,
      previewUrl: URL.createObjectURL(file),
    }));

    setPendingPhotos(prev => [...prev, ...newPhotos]);

    const settled = await Promise.allSettled(newPhotos.map(p => downscaleImage(p.file)));
    setPendingPhotos(prev => {
      const updated = [...prev];
      newPhotos.forEach((p, i) => {
        const result = settled[i];
        const idx = updated.findIndex(u => u.previewUrl === p.previewUrl);
        if (idx !== -1 && result.status === 'fulfilled') {
          updated[idx] = { ...updated[idx], dataUrl: result.value };
        }
      });
      return updated;
    });
  }, []);

  const handleFileInputChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      await handlePhotoFiles(e.target.files);
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [handlePhotoFiles]);

  // #106: handler for the photo library input
  const handleLibraryInputChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      await handlePhotoFiles(e.target.files);
    }
    if (libraryInputRef.current) libraryInputRef.current.value = '';
  }, [handlePhotoFiles]);

  const removePhoto = useCallback((previewUrl: string) => {
    setPendingPhotos(prev => {
      const photo = prev.find(p => p.previewUrl === previewUrl);
      if (photo) URL.revokeObjectURL(photo.previewUrl);
      return prev.filter(p => p.previewUrl !== previewUrl);
    });
  }, []);

  // ---- Barcode handling ----
  const [barcodeLoading, setBarcodeLoading] = useState(false);

  const handleBarcodeDetected = useCallback(async (code: string) => {
    setBarcodeOpen(false);
    setBarcodeLoading(true);
    try {
      const res = await fetch(`https://world.openfoodfacts.org/api/v0/product/${code}.json`);
      const data = await res.json() as {
        status: number;
        product?: {
          product_name?: string;
          nutriments?: {
            'energy-kcal_100g'?: number;
            'proteins_100g'?: number;
            'carbohydrates_100g'?: number;
            'fat_100g'?: number;
          };
          serving_quantity?: number;
          serving_quantity_unit?: string;
        };
      };

      if (data.status === 1 && data.product) {
        const p = data.product;
        const name = p.product_name ?? 'Unknown product';
        const n = p.nutriments ?? {};
        const kcal = n['energy-kcal_100g'] != null ? Math.round(n['energy-kcal_100g']) : '?';
        const protein = n['proteins_100g'] != null ? Math.round(n['proteins_100g']) : '?';
        const carbs = n['carbohydrates_100g'] != null ? Math.round(n['carbohydrates_100g']) : '?';
        const fat = n['fat_100g'] != null ? Math.round(n['fat_100g']) : '?';

        let formatted = `[Scanned: ${code}]\nProduct: ${name}\nPer 100g: ${kcal} kcal | ${protein}g protein | ${carbs}g carbs | ${fat}g fat`;
        if (p.serving_quantity != null) {
          const unit = p.serving_quantity_unit ?? 'g';
          formatted += `\nServing size: ${p.serving_quantity}${unit}`;
        }

        setText(prev => prev ? `${formatted}\n${prev}` : formatted);
      } else {
        console.warn('Open Food Facts: product not found for barcode', code);
        setText(prev => prev ? `${prev} barcode:${code}` : `barcode:${code}`);
      }
    } catch (err) {
      console.warn('Open Food Facts lookup failed:', err);
      setText(prev => prev ? `${prev} barcode:${code}` : `barcode:${code}`);
    } finally {
      setBarcodeLoading(false);
      textareaRef.current?.focus();
    }
  }, []);

  // ---- Send ----
  const canSend = (text.trim().length > 0 || pendingPhotos.length > 0) && !isStreaming;

  const handleSend = useCallback(async () => {
    if (!canSend) return;

    setExpanded(true);
    isNearBottomRef.current = true; // force scroll to bottom on send

    const files: FileUIPart[] = pendingPhotos.map(p => ({
      type: 'file' as const,
      mediaType: 'image/jpeg',
      url: p.dataUrl ?? p.previewUrl,
    }));

    const msgText = text.trim();

    pendingPhotos.forEach(p => URL.revokeObjectURL(p.previewUrl));
    setText('');
    setPendingPhotos([]);

    await sendMessage(
      files.length > 0
        ? { text: msgText || undefined, files } as Parameters<typeof sendMessage>[0]
        : { text: msgText } as Parameters<typeof sendMessage>[0],
      { body: { selectedDate } },
    );
  }, [canSend, text, pendingPhotos, selectedDate, sendMessage]);

  // #14: Stop button calls useChat stop()
  const handleStop = useCallback(() => {
    stop();
  }, [stop]);

  // #105: Enter to send on desktop only; on mobile Enter inserts newline.
  // Shift+Enter always inserts a newline regardless of platform.
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !isMobile) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend, isMobile]);

  // ---- Proposal handlers ----
  const handleProposalDeny = useCallback((partKey: string) => {
    setDeniedProposals(prev => new Set([...prev, partKey]));
    sendMessage(
      { text: 'That proposal doesn\'t look right, please try again with a different approach.' },
      { body: { selectedDate } },
    );
  }, [selectedDate, sendMessage]);

  const handleProposalConfirmWithTracking = useCallback(async (input: EntryInput, partKey: string) => {
    await createEntry.mutateAsync(input);
    // #71: store the entry name so the confirmed message can display it
    const entryName = (input as unknown as { name?: string }).name ?? '';
    setConfirmedProposals(prev => new Map([...prev, [partKey, entryName]]));
  }, [createEntry]);

  // ---- Custom food proposal handlers ----
  const handleCustomFoodDeny = useCallback((partKey: string) => {
    setDeniedCustomFoodProposals(prev => new Set([...prev, partKey]));
  }, []);

  const handleCustomFoodConfirm = useCallback(async (payload: CustomFoodInput, partKey: string) => {
    const saved = await createCustomFood.mutateAsync(payload);
    setConfirmedCustomFoodProposals(prev => new Map([...prev, [partKey, saved.name]]));
  }, [createCustomFood]);

  // ---- #7/#70: Clear chat — guarded by ConfirmModal ----
  const executeClearChat = useCallback(async () => {
    setShowClearConfirm(false);
    try {
      await clearTranscript(selectedDate);
    } catch {
      // ignore server error — we still clear client-side
    }
    dropMessagesForDate(selectedDate);
    setMessages([]);
    clearError();
    setDeniedProposals(new Set());
    setConfirmedProposals(new Map());
    setDeniedCustomFoodProposals(new Set());
    setConfirmedCustomFoodProposals(new Map());
  }, [selectedDate, setMessages, clearError]);

  const handleClearChat = useCallback(() => {
    setShowClearConfirm(true);
  }, []);

  // ---- #2: Bottom sheet follows finger (continuous pointermove, snap on release) ----
  // We drive sheetHeight as an integer px value while dragging.
  // On release we snap to peek or expanded based on position + velocity.
  const sheetRef = useRef<HTMLDivElement>(null);
  const dragStartYRef = useRef<number | null>(null);
  const dragStartHeightRef = useRef<number>(PEEK_HEIGHT);
  const dragLastYRef = useRef<number>(0);
  const dragLastTimeRef = useRef<number>(0);
  const dragVelocityRef = useRef<number>(0); // px/ms — negative = upward (expand)
  const [draggingHeight, setDraggingHeight] = useState<number | null>(null);

  // Compute full expanded height in px
  const getExpandedPx = useCallback((): number => {
    return Math.round(window.innerHeight * EXPANDED_HEIGHT_VH / 100);
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

    // Track velocity (px/ms, negative = downward movement)
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
      // Fast swipe — follow velocity direction
      shouldExpand = velocity > 0;
    } else {
      // Slow drag — snap based on position
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

  // Compute the sheet's inline style
  const sheetStyle: React.CSSProperties = draggingHeight !== null
    ? { height: `${draggingHeight}px`, transition: 'none' }
    : {};

  const isExpanded = expanded;

  // Find the last assistant message index for streaming indicator
  const lastAssistantIdx = messages.reduce((last, m, i) => m.role === 'assistant' ? i : last, -1);

  // ---- Render ----
  return (
    <>
      {/* Dim overlay — only when expanded */}
      {isExpanded && (
        <div
          className={styles.overlay}
          onClick={collapse}
          aria-hidden="true"
        />
      )}

      {/* Custom CSS bottom sheet */}
      <div
        ref={sheetRef}
        className={`${styles.sheet} ${isExpanded ? styles.sheetExpanded : styles.sheetPeek} ${draggingHeight !== null ? styles.sheetDragging : ''}`}
        style={sheetStyle}
        aria-label="Nutrition AI chat"
        role="dialog"
      >
        <span className={styles.srOnly}>Nutrition AI</span>

        {/* #65: Entire header area is the drag target.
            When collapsed, this is the only visible region — a thin strip.
            When expanded, the header row (with title + buttons) also drags.
            We keep a separate visual pill inside for discoverability. */}
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
          {/* #65: Visual pill — inside the drag zone, just a cue */}
          <span className={styles.dragHandle} aria-hidden="true" />
        </div>

        {/* #65: Header row also participates in drag (#64: touch-action:none stops page scroll) */}
        {isExpanded && (
          <div
            className={styles.header}
            onPointerDown={handleDragPointerDown}
            onPointerMove={handleDragPointerMove}
            onPointerUp={handleDragPointerUp}
            onPointerCancel={handleDragPointerUp}
          >
            <span className={styles.headerTitle}>Ask AI</span>

            {/* #7/#70: Clear chat — now opens confirmation dialog */}
            <button
              type="button"
              className={styles.clearBtn}
              onClick={(e) => { e.stopPropagation(); handleClearChat(); }}
              onPointerDown={(e) => e.stopPropagation()}
              aria-label="Clear chat"
              title="Clear today's chat"
            >
              <Trash2 className={styles.clearIcon} size={16} aria-hidden="true" />
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

        {/* #6/#74: Messages — overscroll-behavior:contain prevents body scroll.
            #74: When in peek state, disable scrolling entirely. */}
        <div
          ref={messagesContainerRef}
          className={`${styles.messages} ${!isExpanded ? styles.messagesPeek : ''}`}
          onScroll={checkNearBottom}
        >
          {messages.length === 0 && (
            <div className={styles.emptyHint}>
              <p>Describe what you ate, scan a barcode, or attach a photo of your food.</p>
            </div>
          )}

          {messages.map((message, idx) => (
            <ChatMessage
              key={message.id}
              message={message}
              isLastAssistant={idx === lastAssistantIdx}
              isStreaming={isStreaming}
              selectedDate={selectedDate}
              onProposalConfirm={handleProposalConfirmWithTracking}
              onProposalDeny={handleProposalDeny}
              deniedProposals={deniedProposals}
              confirmedProposals={confirmedProposals}
              onCustomFoodConfirm={handleCustomFoodConfirm}
              onCustomFoodDeny={handleCustomFoodDeny}
              deniedCustomFoodProposals={deniedCustomFoodProposals}
              confirmedCustomFoodProposals={confirmedCustomFoodProposals}
            />
          ))}

          {/* #107: Error bubble — shown when the chat stream/API call fails */}
          {chatError && (
            <div className={styles.messageGroup}>
              <ErrorBubble error={chatError} />
            </div>
          )}

          {/* #12: Scroll anchor — scrollIntoView targets this */}
          <div ref={messagesEndRef} />
        </div>

        {/* Photo thumbnails */}
        {pendingPhotos.length > 0 && (
          <div className={styles.thumbnails}>
            {pendingPhotos.map(p => (
              <div key={p.previewUrl} className={styles.thumbnailWrap}>
                <img src={p.previewUrl} alt="Pending photo" className={styles.thumbnail} />
                <button
                  type="button"
                  className={styles.thumbnailRemove}
                  onClick={() => removePhoto(p.previewUrl)}
                  aria-label="Remove photo"
                >
                  ✕
                </button>
                {!p.dataUrl && <span className={styles.thumbnailProcessing} />}
              </div>
            ))}
          </div>
        )}

        {photoError && (
          <p className={styles.photoError}>{photoError}</p>
        )}

        {/* Composer — #3/#61: safe-area padding, #4: 16px font-size on mobile
            #93: camera + barcode moved above textarea as floating circles (left-aligned).
            #92: textarea now spans full width; placeholder centering fixed via CSS. */}
        <div className={styles.composerWrap}>
          {/* #93: Floating circular attach buttons — above the textarea, left-aligned */}
          <div className={styles.composerAttachRow}>
            {/* Photo attach button */}
            <button
              type="button"
              className={styles.composerCircleBtn}
              onClick={() => fileInputRef.current?.click()}
              aria-label="Attach photo"
              title="Attach photo"
            >
              <Camera className={styles.composerCircleBtnIcon} size={16} aria-hidden="true" />
            </button>

            {/* Barcode button */}
            <button
              type="button"
              className={styles.composerCircleBtn}
              onClick={() => setBarcodeOpen(true)}
              disabled={barcodeLoading}
              aria-label={barcodeLoading ? 'Looking up barcode…' : 'Scan barcode'}
              title="Scan barcode"
            >
              <ScanBarcode className={styles.composerCircleBtnIcon} size={16} aria-hidden="true" />
            </button>

            {/* #106: Photo library button — opens file picker without capture */}
            <button
              type="button"
              className={styles.composerCircleBtn}
              onClick={() => libraryInputRef.current?.click()}
              aria-label="Attach from photo library"
              title="Attach from photo library"
            >
              <Images className={styles.composerCircleBtnIcon} size={16} aria-hidden="true" />
            </button>
          </div>

          {/* Camera capture input — opens direct camera on iOS */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            multiple
            className={styles.hiddenFileInput}
            onChange={handleFileInputChange}
            aria-hidden="true"
            tabIndex={-1}
          />

          {/* #106: Photo library input — no capture attribute so iOS shows the file picker */}
          <input
            ref={libraryInputRef}
            type="file"
            accept="image/*"
            multiple
            className={styles.hiddenFileInput}
            onChange={handleLibraryInputChange}
            aria-hidden="true"
            tabIndex={-1}
          />

          {/* #93: Bottom row — textarea spans full width + send button at right */}
          <div className={styles.composer}>
            {/* #4/#92: 16px font-size (no iOS zoom); placeholder vertically centered via CSS */}
            <textarea
              ref={textareaRef}
              className={styles.composerInput}
              placeholder="Describe what you ate…"
              value={text}
              onChange={e => setText(e.target.value)}
              onKeyDown={handleKeyDown}
              onFocus={() => {
                setExpanded(true);
              }}
              rows={1}
              aria-label="Chat message"
            />

            {/* #14: Send/Stop button — shows Stop icon while streaming */}
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

      {/* #116: Floating chat FAB — visible only when sheet is closed (PEEK_HEIGHT=0 means
          the sheet is invisible). Tap opens fully; drag upward drags sheet open. */}
      {!isExpanded && (
        <button
          type="button"
          className={styles.floatingChatBtn}
          aria-label="Open AI chat"
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
            // Prevent click from firing after a drag that didn't cross threshold
            e.stopPropagation();
          }}
        >
          <MessageSquare className={styles.floatingChatBtnIcon} size={16} aria-hidden="true" />
        </button>
      )}

      {/* Barcode scanner — rendered outside the sheet */}
      {barcodeOpen && (
        <BarcodeScanner
          onDetected={handleBarcodeDetected}
          onClose={() => setBarcodeOpen(false)}
        />
      )}

      {/* #70: Confirm before clearing chat */}
      {showClearConfirm && (
        <ConfirmModal
          message="Clear today's chat? This cannot be undone."
          onConfirm={executeClearChat}
          onCancel={() => setShowClearConfirm(false)}
        />
      )}
    </>
  );
}
