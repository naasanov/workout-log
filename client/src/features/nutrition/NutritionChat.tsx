/**
 * NutritionChat — Phase 2 AI chat bottom-sheet (custom CSS sheet).
 *
 * Changes (polish pass):
 * 1. Custom CSS bottom sheet with peeking composer + tap/drag-to-expand.
 * 2. localStorage persistence keyed by selectedDate; cleared between days.
 * 3. Auto-growing textarea (up to ~8 lines), Enter to send / Shift+Enter newline.
 * 4. Markdown rendering (react-markdown) in assistant text + reasoning.
 * 5. Empty reasoning parts filtered out (no toggle rendered).
 * 6. No horizontal scroll on mobile (overflow-wrap, contained JSON <pre>).
 * 7. Consistent font sizes on mobile (text-size-adjust, explicit sizes).
 * 8. Human-readable tool names via TOOL_LABEL_MAP in ToolCallCard.
 *
 * - useChat → POST /api/nutrition/chat (auth header + credentials:include)
 * - Composer: text + photo attach (downscale via canvas → FileUIPart) + barcode
 * - Renders message.parts: text, tool calls, propose_entry→EntryEditor, reasoning
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
import { useCreateEntry } from './api';
import EntryEditor from './EntryEditor';
import BarcodeScanner from './BarcodeScanner';
import ToolCallCard from './ToolCallCard';
import type { EntryInput, EntryEditorMode } from './types';
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
// Pending photo state — local File + downscaled data URL for preview
// ---------------------------------------------------------------------------
interface PendingPhoto {
  file: File;
  previewUrl: string;
  dataUrl?: string;
}

// ---------------------------------------------------------------------------
// localStorage persistence helpers (item 2)
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

function pruneOldDays(currentDate: string) {
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith(LS_PREFIX)) keys.push(k);
  }
  if (keys.length <= MAX_STORED_DAYS) return;
  // Sort ascending by date suffix and remove oldest
  keys.sort();
  const currentKey = lsKey(currentDate);
  const toRemove = keys
    .filter(k => k !== currentKey)
    .slice(0, keys.length - MAX_STORED_DAYS);
  toRemove.forEach(k => localStorage.removeItem(k));
}

// ---------------------------------------------------------------------------
// Auto-grow textarea hook (item 3)
// ---------------------------------------------------------------------------
function useAutoGrow(ref: React.RefObject<HTMLTextAreaElement | null>, value: string) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || 21;
    const maxLines = 8;
    const maxHeight = lineHeight * maxLines + 20; // 20px for padding
    el.style.height = Math.min(el.scrollHeight, maxHeight) + 'px';
    el.style.overflowY = el.scrollHeight > maxHeight ? 'auto' : 'hidden';
  }, [value, ref]);
}

// ---------------------------------------------------------------------------
// Reasoning collapsible (item 4 — markdown; item 5 — filter empty)
// ---------------------------------------------------------------------------
interface ReasoningBubbleProps {
  text: string;
  streaming: boolean;
}

function ReasoningBubble({ text, streaming }: ReasoningBubbleProps) {
  const [open, setOpen] = useState(false);
  // Item 5: filter empty/whitespace reasoning
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
          {/* Item 4: render reasoning as markdown */}
          <ReactMarkdown>{text}</ReactMarkdown>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ProposeEntryArgs type (matches backend propose_entry tool args)
// ---------------------------------------------------------------------------
interface ProposeEntryArgs {
  meal: import('./types').Meal;
  name: string;
  source: import('./types').EntrySource;
  barcode?: string | null;
  ingredients: import('./types').IngredientInput[];
}

// ---------------------------------------------------------------------------
// Message bubble
// ---------------------------------------------------------------------------
interface MessageProps {
  message: UIMessage;
  selectedDate: string;
  onProposalConfirm: (input: EntryInput, partKey: string) => void;
  onProposalDeny: (partKey: string) => void;
  deniedProposals: Set<string>;
  confirmedProposals: Set<string>;
}

function ChatMessage({
  message,
  selectedDate,
  onProposalConfirm,
  onProposalDeny,
  deniedProposals,
  confirmedProposals,
}: MessageProps) {
  const isUser = message.role === 'user';

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
                // User messages: plain text with whitespace preserved
                <p className={styles.bubbleText}>{part.text}</p>
              ) : (
                // Item 4: render assistant text as markdown
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

        // ---- Reasoning part (item 4 + item 5) ----
        if (part.type === 'reasoning') {
          return (
            <ReasoningBubble
              key={idx}
              text={part.text}
              streaming={part.state === 'streaming'}
            />
          );
        }

        // ---- Tool invocation part (typed static tools or dynamic-tool) ----
        if (isToolUIPart(part)) {
          const toolName = getToolName(part as ToolUIPart | DynamicToolUIPart);
          const toolCallId = (part as { toolCallId: string }).toolCallId;

          // propose_entry gets its own EntryEditor treatment
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

            const rawArgs = (part.state === 'output-available'
              ? (part as { output: unknown }).output
              : part.input) as ProposeEntryArgs;
            const proposal: EntryInput = {
              localDate: selectedDate,
              meal: rawArgs.meal,
              name: rawArgs.name,
              source: rawArgs.source,
              barcode: rawArgs.barcode ?? null,
              ingredients: rawArgs.ingredients,
            };

            return (
              <ProposalCard
                key={idx}
                partKey={partKey}
                proposal={proposal}
                selectedDate={selectedDate}
                onConfirm={(input) => onProposalConfirm(input, partKey)}
                onDeny={() => onProposalDeny(partKey)}
              />
            );
          }

          // All other tool calls → ToolCallCard
          return <ToolCallCard key={idx} part={part as ToolUIPart | DynamicToolUIPart} />;
        }

        return null;
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ProposalCard — wraps EntryEditor in proposal mode
// ---------------------------------------------------------------------------
interface ProposalCardProps {
  partKey: string;
  proposal: EntryInput;
  selectedDate: string;
  onConfirm: (input: EntryInput) => void;
  onDeny: () => void;
}

function ProposalCard({ proposal, selectedDate, onConfirm, onDeny }: ProposalCardProps) {
  const [editorOpen, setEditorOpen] = useState(true);

  const mode: EntryEditorMode = {
    kind: 'proposal',
    date: selectedDate,
    proposal,
  };

  return (
    <>
      {!editorOpen && (
        <div className={styles.proposalPlaceholder}>
          <span className={styles.proposalName}>{proposal.name}</span>
          <button
            type="button"
            className={styles.proposalReviewBtn}
            onClick={() => setEditorOpen(true)}
          >
            Review
          </button>
        </div>
      )}

      <EntryEditor
        open={editorOpen}
        mode={mode}
        onClose={() => setEditorOpen(false)}
        onConfirm={(input) => {
          setEditorOpen(false);
          onConfirm(input);
        }}
        onDeny={() => {
          setEditorOpen(false);
          onDeny();
        }}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// NutritionChat — custom CSS bottom sheet (item 1)
//
// A plain fixed-position panel that animates its `height` between a peek
// (96px — just drag handle + composer) and expanded (88dvh — full chat).
// vaul was removed: it reveals content top-down at the snap line, which
// hid our bottom-pinned composer. Driving `height` with an `expanded`
// boolean keeps the composer at the bottom and always visible at the peek.
// ---------------------------------------------------------------------------
interface NutritionChatProps {
  open: boolean;
  onClose: () => void;
  selectedDate: string;
}

export default function NutritionChat({ open, onClose, selectedDate }: NutritionChatProps) {
  // Item 2: load messages from localStorage on mount / date change
  const initialMessages = loadMessagesForDate(selectedDate);

  // Track last loaded date to detect day change
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

  // Item 2: persist messages on every change
  useEffect(() => {
    if (messages.length > 0) {
      saveMessagesForDate(selectedDate, messages);
    }
  }, [messages, selectedDate]);

  // Item 2: when selectedDate changes, load the new day's messages
  useEffect(() => {
    if (selectedDate !== loadedDateRef.current) {
      loadedDateRef.current = selectedDate;
      const newDayMessages = loadMessagesForDate(selectedDate);
      setMessages(newDayMessages);
    }
  }, [selectedDate, setMessages]);

  // ---- Custom sheet expand/collapse state (item 1) ----
  const [expanded, setExpanded] = useState(false);

  // When the parent sets `open` (the "Ask AI" button) → expand.
  useEffect(() => {
    if (open) setExpanded(true);
  }, [open]);

  const collapse = useCallback(() => {
    setExpanded(false);
    onClose();
  }, [onClose]);

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

  const isStreaming = status === 'streaming' || status === 'submitted';

  // Item 3: auto-grow textarea
  useAutoGrow(textareaRef, text);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

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

    // Expand sheet when sending a message
    setExpanded(true);

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

  // Item 3: Enter to send, Shift+Enter for newline
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

  // ---- Drag handle: pointer-drag enhancement (item 1) ----
  // Tap toggles; drag up > 40px expands, drag down > 40px collapses.
  const dragStartY = useRef<number | null>(null);
  const dragMoved = useRef(false);

  const handleDragPointerDown = useCallback((e: React.PointerEvent) => {
    dragStartY.current = e.clientY;
    dragMoved.current = false;
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  }, []);

  const handleDragPointerMove = useCallback((e: React.PointerEvent) => {
    if (dragStartY.current === null) return;
    const delta = e.clientY - dragStartY.current;
    if (Math.abs(delta) > 40) {
      dragMoved.current = true;
      if (delta < 0) {
        setExpanded(true);
      } else {
        collapse(); // keeps parent `open` state in sync
      }
      dragStartY.current = null; // commit once per gesture
    }
  }, [collapse]);

  const handleDragPointerUp = useCallback(() => {
    // Tap (no significant movement) → toggle
    if (!dragMoved.current) {
      if (expanded) {
        collapse(); // keeps parent `open` state in sync
      } else {
        setExpanded(true);
      }
    }
    dragStartY.current = null;
    dragMoved.current = false;
  }, [collapse, expanded]);

  const isExpanded = expanded;

  // ---- Render ----
  return (
    <>
      {/* Dim overlay behind the sheet — only when expanded; click to collapse */}
      {isExpanded && (
        <div
          className={styles.overlay}
          onClick={collapse}
          aria-hidden="true"
        />
      )}

      {/* Custom CSS bottom sheet — always peeks, animates height */}
      <div
        className={`${styles.sheet} ${isExpanded ? styles.sheetExpanded : styles.sheetPeek}`}
        aria-label="Nutrition AI chat"
        role="dialog"
      >
        <span className={styles.srOnly}>Nutrition AI</span>

        {/* Drag handle (tap to toggle, drag up/down to expand/collapse) */}
        <button
          type="button"
          className={styles.dragHandleBtn}
          onPointerDown={handleDragPointerDown}
          onPointerMove={handleDragPointerMove}
          onPointerUp={handleDragPointerUp}
          aria-label={isExpanded ? 'Collapse AI chat' : 'Expand AI chat'}
          aria-expanded={isExpanded}
        >
          <span className={styles.dragHandle} aria-hidden="true" />
        </button>

        {/* Header — only shown when expanded */}
        {isExpanded && (
          <div className={styles.header}>
            <span className={styles.headerTitle}>Ask AI</span>
            {isStreaming && (
              <button
                type="button"
                className={styles.stopBtn}
                onClick={stop}
                aria-label="Stop generation"
              >
                Stop
              </button>
            )}
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

        {/* Messages — collapses to 0 height in peek (flex:1, min-height:0) */}
        <div className={styles.messages}>
          {messages.length === 0 && (
            <div className={styles.emptyHint}>
              <p>Describe what you ate, scan a barcode, or attach a photo of your food.</p>
            </div>
          )}

          {messages.map(message => (
            <ChatMessage
              key={message.id}
              message={message}
              selectedDate={selectedDate}
              onProposalConfirm={handleProposalConfirmWithTracking}
              onProposalDeny={handleProposalDeny}
              deniedProposals={deniedProposals}
              confirmedProposals={confirmedProposals}
            />
          ))}

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

            {/* Composer — always visible in both peek and expanded states */}
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

              {/* Item 3: auto-grow textarea */}
              <textarea
                ref={textareaRef}
                className={styles.composerInput}
                placeholder="Describe what you ate…"
                value={text}
                onChange={e => setText(e.target.value)}
                onKeyDown={handleKeyDown}
                onFocus={() => {
                  // Expand the sheet when user focuses the input
                  setExpanded(true);
                }}
                rows={1}
                aria-label="Chat message"
              />

              {/* Send button */}
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
