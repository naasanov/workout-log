/**
 * NutritionChat — Phase 2 AI chat bottom-sheet.
 *
 * - Radix Dialog bottom-sheet
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
import * as Dialog from '@radix-ui/react-dialog';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, isToolUIPart, getToolName } from 'ai';
import type { FileUIPart, UIMessage, ToolUIPart, DynamicToolUIPart } from 'ai';
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
  // Attempt to use cached token from sessionStorage.
  // If expired, call /api/auth/token to refresh (same as clientApi.js).
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
  previewUrl: string; // always the original blob URL for fast preview
  dataUrl?: string;   // JPEG data URL (set after downscale)
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
  return (
    <div className={styles.reasoning}>
      <button
        type="button"
        className={styles.reasoningToggle}
        onClick={() => setOpen(p => !p)}
        aria-expanded={open}
      >
        <svg className={styles.reasoningChevron} viewBox="0 0 10 6" fill="none" aria-hidden="true">
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
        <p className={styles.reasoningText}>{text}</p>
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
              <p className={styles.bubbleText}>{part.text}</p>
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
              // Still streaming input
              return <ToolCallCard key={idx} part={part as ToolUIPart | DynamicToolUIPart} />;
            }

            // Prefer output (echoed args) when available, fall back to input
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
      {/* Collapsed placeholder when editor is closed */}
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
// NutritionChat
// ---------------------------------------------------------------------------
interface NutritionChatProps {
  open: boolean;
  onClose: () => void;
  selectedDate: string;
}

export default function NutritionChat({ open, onClose, selectedDate }: NutritionChatProps) {
  // ---- useChat setup ----
  const { messages, sendMessage, status, stop } = useChat({
    transport: new DefaultChatTransport({
      api: `${VITE_API_URL}/nutrition/chat`,
      credentials: 'include',
      headers: async () => {
        const token = await getAccessToken();
        return { Authorization: `Bearer ${token}` };
      },
      body: { selectedDate },
    }),
  });

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

    // Start downscaling in background
    setPendingPhotos(prev => [...prev, ...newPhotos]);

    // Downscale each
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
    // Reset the input so the same file can be reselected
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

    // Build FileUIPart[] from downscaled photos
    const files: FileUIPart[] = pendingPhotos.map(p => ({
      type: 'file' as const,
      mediaType: 'image/jpeg',
      url: p.dataUrl ?? p.previewUrl, // fall back to original if downscale not done yet
    }));

    const msgText = text.trim();

    // Revoke object URLs
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

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Send on Enter (not Shift+Enter)
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  // ---- Proposal handlers ----
  const handleProposalDeny = useCallback((partKey: string) => {
    setDeniedProposals(prev => new Set([...prev, partKey]));
    // Send a follow-up message so the agent knows
    sendMessage(
      { text: 'That proposal doesn\'t look right, please try again with a different approach.' },
      { body: { selectedDate } },
    );
  }, [selectedDate, sendMessage]);

  // We also need to track confirmed proposals — wrapped in a callback passed down
  const handleProposalConfirmWithTracking = useCallback(async (input: EntryInput, partKey: string) => {
    await createEntry.mutateAsync(input);
    setConfirmedProposals(prev => new Set([...prev, partKey]));
  }, [createEntry]);

  // ---- Render ----
  return (
    <>
      <Dialog.Root open={open} onOpenChange={v => { if (!v) onClose(); }}>
        <Dialog.Portal>
          <Dialog.Overlay className={styles.overlay} />
          <Dialog.Content className={styles.sheet} aria-label="Nutrition AI chat">
            <Dialog.Title className={styles.srOnly}>Nutrition AI</Dialog.Title>

            {/* Header */}
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
                onClick={onClose}
                aria-label="Close"
              >
                <svg className={styles.closeSvg} viewBox="0 0 14 14" fill="none" aria-hidden="true">
                  <path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </button>
            </div>

            {/* Messages */}
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

            {/* Composer */}
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

              {/* Hidden file input — accepts images, prefers camera on mobile */}
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

              {/* Text input */}
              <textarea
                ref={textareaRef}
                className={styles.composerInput}
                placeholder="Describe what you ate…"
                value={text}
                onChange={e => setText(e.target.value)}
                onKeyDown={handleKeyDown}
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
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* Barcode scanner — rendered outside dialog */}
      {barcodeOpen && (
        <BarcodeScanner
          onDetected={handleBarcodeDetected}
          onClose={() => setBarcodeOpen(false)}
        />
      )}
    </>
  );
}
