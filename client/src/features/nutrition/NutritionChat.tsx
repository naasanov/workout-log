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
import { useCreateEntry, fetchTranscript, clearTranscript } from './api';
import type { StoredChatMessage } from './api';
import EntryEditor from './EntryEditor';
import BarcodeScanner from './BarcodeScanner';
import ToolCallCard from './ToolCallCard';
import type { EntryInput, EntryEditorMode, ProposeEntryArgs } from './types';
import styles from './NutritionChat.module.scss';

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
// Reasoning collapsible
// ---------------------------------------------------------------------------
interface ReasoningBubbleProps {
  text: string;
  streaming: boolean;
}

function ReasoningBubble({ text, streaming }: ReasoningBubbleProps) {
  const [open, setOpen] = useState(false);
  if (!streaming && !text.trim()) return null;

  return (
    <div className={styles.reasoning}>
      <button
        type="button"
        className={styles.reasoningToggle}
        onClick={() => setOpen(p => !p)}
        aria-expanded={open}
      >
        <svg className={styles.reasoningChevron} viewBox="0 0 10 6" fill="none" aria-hidden="true" style={{ display: 'block' }}>
          <path
            d={open ? 'M1 5l4-4 4 4' : 'M1 1l4 4 4-4'}
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        {streaming ? 'Thinking…' : 'Reasoning'}
      </button>
      {open && (
        <div className={styles.reasoningText}>
          <ReactMarkdown>{text}</ReactMarkdown>
        </div>
      )}
    </div>
  );
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
  confirmedProposals: Set<string>;
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
}: MessageProps) {
  const isUser = message.role === 'user';
  // #15/#17: interrupted flag from StoredChatMessage cast
  const interrupted = !!(message as unknown as { interrupted?: boolean }).interrupted;
  const isStreamingThis = isLastAssistant && isStreaming;

  return (
    <div className={`${styles.messageGroup} ${isUser ? styles.messageGroupUser : styles.messageGroupAssistant}`}>
      {message.parts.map((part, idx) => {
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
                  <ReactMarkdown>{part.text}</ReactMarkdown>
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

        // ---- Reasoning part ----
        if (part.type === 'reasoning') {
          return (
            <ReasoningBubble
              key={idx}
              text={part.text}
              streaming={part.state === 'streaming'}
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
            const isConfirmed = confirmedProposals.has(partKey);

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
                  Entry logged!
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
const PEEK_HEIGHT = 96;     // px — drag handle + composer
const EXPANDED_HEIGHT_VH = 88; // dvh

export default function NutritionChat({ open, onClose, selectedDate }: NutritionChatProps) {
  // #15: Load from localStorage as fast cache; DB will override on mount.
  const initialMessages = loadMessagesForDate(selectedDate);

  const loadedDateRef = useRef(selectedDate);

  // ---- useChat setup ----
  const { messages, setMessages, sendMessage, status, stop } = useChat({
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

  // Persist messages on every change
  useEffect(() => {
    if (messages.length > 0) {
      saveMessagesForDate(selectedDate, messages);
    }
  }, [messages, selectedDate]);

  // #15: Fetch transcript from DB on mount (DB is source of truth)
  const fetchAndApplyTranscript = useCallback(async (date: string) => {
    try {
      const stored = await fetchTranscript(date);
      if (stored.length > 0) {
        const uiMessages = storedToUIMessages(stored);
        setMessages(uiMessages);
        saveMessagesForDate(date, uiMessages);
      }
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
      fetchAndApplyTranscript(selectedDate);
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

  // ---- Proposal state tracking ----
  const [deniedProposals, setDeniedProposals] = useState<Set<string>>(new Set());
  const [confirmedProposals, setConfirmedProposals] = useState<Set<string>>(new Set());

  // ---- Composer state ----
  const [text, setText] = useState('');
  const [pendingPhotos, setPendingPhotos] = useState<PendingPhoto[]>([]);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [barcodeOpen, setBarcodeOpen] = useState(false);

  // ---- Refs ----
  const fileInputRef = useRef<HTMLInputElement>(null);
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

  const removePhoto = useCallback((previewUrl: string) => {
    setPendingPhotos(prev => {
      const photo = prev.find(p => p.previewUrl === previewUrl);
      if (photo) URL.revokeObjectURL(photo.previewUrl);
      return prev.filter(p => p.previewUrl !== previewUrl);
    });
  }, []);

  // ---- Barcode handling ----
  const handleBarcodeDetected = useCallback((code: string) => {
    setBarcodeOpen(false);
    setText(prev => prev ? `${prev} barcode:${code}` : `barcode:${code}`);
    textareaRef.current?.focus();
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

  // Enter to send, Shift+Enter for newline
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

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
    setConfirmedProposals(prev => new Set([...prev, partKey]));
  }, [createEntry]);

  // ---- #7: Clear chat ----
  const handleClearChat = useCallback(async () => {
    try {
      await clearTranscript(selectedDate);
    } catch {
      // ignore server error — we still clear client-side
    }
    dropMessagesForDate(selectedDate);
    setMessages([]);
    setDeniedProposals(new Set());
    setConfirmedProposals(new Set());
  }, [selectedDate, setMessages]);

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

        {/* #2: Drag handle — continuous pointer tracking */}
        <button
          type="button"
          className={styles.dragHandleBtn}
          onPointerDown={handleDragPointerDown}
          onPointerMove={handleDragPointerMove}
          onPointerUp={handleDragPointerUp}
          onPointerCancel={handleDragPointerUp}
          aria-label={isExpanded ? 'Collapse AI chat' : 'Expand AI chat'}
          aria-expanded={isExpanded}
        >
          <span className={styles.dragHandle} aria-hidden="true" />
        </button>

        {/* Header — only shown when expanded */}
        {isExpanded && (
          <div className={styles.header}>
            <span className={styles.headerTitle}>Ask AI</span>

            {/* #7: Clear chat button */}
            <button
              type="button"
              className={styles.clearBtn}
              onClick={handleClearChat}
              aria-label="Clear chat"
              title="Clear today's chat"
            >
              <svg className={styles.clearIcon} viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <path d="M4 6h12M8 6V4h4v2M6 6l1 10h6l1-10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>

            <button
              type="button"
              className={styles.closeBtn}
              onClick={collapse}
              aria-label="Collapse"
            >
              <svg className={styles.collapseSvg} viewBox="0 0 14 8" fill="none" aria-hidden="true">
                <path d="M1 1l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        )}

        {/* #6: Messages — overscroll-behavior:contain prevents body scroll */}
        <div
          ref={messagesContainerRef}
          className={styles.messages}
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
            />
          ))}

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

        {/* Composer — #3: safe-area padding, #4: 16px font-size on mobile */}
        <div className={styles.composer}>
          {/* Photo attach button */}
          <button
            type="button"
            className={styles.composerBtn}
            onClick={() => fileInputRef.current?.click()}
            aria-label="Attach photo"
            title="Attach photo"
          >
            <svg className={styles.composerBtnIcon} viewBox="0 0 22 22" fill="none" aria-hidden="true">
              <rect x="2" y="5" width="18" height="13" rx="2.5" stroke="currentColor" strokeWidth="1.8" />
              <circle cx="11" cy="12" r="3.5" stroke="currentColor" strokeWidth="1.8" />
              <path d="M8 5l1.5-2h3L14 5" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
            </svg>
          </button>

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

          {/* Barcode button */}
          <button
            type="button"
            className={styles.composerBtn}
            onClick={() => setBarcodeOpen(true)}
            aria-label="Scan barcode"
            title="Scan barcode"
          >
            <svg className={styles.composerBtnIcon} viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <rect x="2" y="4" width="3" height="16" rx="0.5" fill="currentColor" stroke="none" />
              <rect x="7" y="4" width="1.5" height="16" rx="0.5" fill="currentColor" stroke="none" />
              <rect x="10.5" y="4" width="2.5" height="16" rx="0.5" fill="currentColor" stroke="none" />
              <rect x="15" y="4" width="1.5" height="16" rx="0.5" fill="currentColor" stroke="none" />
              <rect x="18.5" y="4" width="3.5" height="16" rx="0.5" fill="currentColor" stroke="none" />
            </svg>
          </button>

          {/* #4: 16px font-size set via CSS class to prevent iOS zoom */}
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
              <svg className={styles.sendIcon} viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <rect x="5" y="5" width="10" height="10" rx="2" fill="currentColor" />
              </svg>
            </button>
          ) : (
            <button
              type="button"
              className={styles.sendBtn}
              onClick={handleSend}
              disabled={!canSend}
              aria-label="Send"
            >
              <svg className={styles.sendIcon} viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <path d="M2 10l16-8-8 16V10H2z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Barcode scanner — rendered outside the sheet */}
      {barcodeOpen && (
        <BarcodeScanner
          onDetected={handleBarcodeDetected}
          onClose={() => setBarcodeOpen(false)}
        />
      )}
    </>
  );
}
