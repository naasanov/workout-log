// Read-only transcript view for one archived (or active) conversation.
// Reuses the live chat's own ChatMessage/ProcessTimeline/ToolCallCard
// rendering (in `readOnly` mode -- see ChatMessage.tsx) rather than
// reimplementing message/tool-card display, so a historical conversation
// looks exactly like it did live wherever its data survived retention.
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { UIMessage } from 'ai';
import { Clock, RotateCcw, Trash2, X } from 'lucide-react';
import Modal from '../../components/Modal.jsx';
import ChatMessage from '../agent/ChatMessage';
import { fetchResolutions } from '../agent/api';
import type { Conversation, ProposalResolution, StoredChatMessage } from '../agent/api';
import type { ProposalResolutionState } from '../agent/registry';
import { useConversationDetail } from './api';
import styles from './ConversationViewer.module.scss';

export interface ConversationViewerProps {
  conversationId: number | null;
  onClose: () => void;
  onContinue: (id: number) => void;
  continuePending: boolean;
  onDelete: (id: number, title: string | null) => void;
}

// Cast a stored row to UIMessage -- only `id`/`role`/`parts` (and the
// `interrupted` flag ChatMessage reads separately) are ever read back out,
// mirroring the identical cast in AgentChat.tsx's storedToUIMessages.
function toUIMessage(stored: StoredChatMessage): UIMessage {
  return stored as unknown as UIMessage;
}

/** True if any part in the transcript was trimmed/redacted by the nightly
 *  retention job -- drives the "some details have aged out" note so an old
 *  conversation reads as intentionally abridged, not broken. */
function hasAgedOutContent(messages: StoredChatMessage[]): boolean {
  return messages.some((m) =>
    Array.isArray(m.parts) &&
    m.parts.some((p) => {
      const part = p as { type?: string; payloadTrimmed?: boolean };
      return part?.payloadTrimmed === true || part?.type === 'data-imageRedacted';
    }),
  );
}

export default function ConversationViewer({
  conversationId,
  onClose,
  onContinue,
  continuePending,
  onDelete,
}: ConversationViewerProps) {
  const detailQuery = useConversationDetail(conversationId);
  const resolutionsQuery = useQuery({
    queryKey: ['chatHistory', 'resolutions', conversationId ?? -1],
    queryFn: () => fetchResolutions(conversationId as number),
    enabled: conversationId !== null,
  });

  const resolutions = useMemo(() => {
    const rows = (resolutionsQuery.data ?? []) as ProposalResolution[];
    const map = new Map<string, ProposalResolutionState>();
    for (const row of rows) {
      map.set(row.toolCallId, { kind: row.kind, status: row.status, displayName: row.displayName });
    }
    return map;
  }, [resolutionsQuery.data]);

  const conversation: Conversation | undefined = detailQuery.data?.conversation;
  const messages = detailQuery.data?.messages ?? [];
  const agedOut = hasAgedOutContent(messages);
  const title = conversation?.title ?? 'Untitled conversation';

  return (
    <Modal
      open={conversationId !== null}
      onOpenChange={(isOpen: boolean) => { if (!isOpen) onClose(); }}
      title={title}
      contentClassName={styles.viewerModal}
    >
      <div className={styles.header}>
        <span className={styles.headerTitle}>{title}</span>
        {conversation && !conversation.active && (
          <button
            type="button"
            className={styles.headerBtn}
            onClick={() => onContinue(conversation.id)}
            disabled={continuePending}
          >
            <RotateCcw size={14} aria-hidden="true" style={{ display: 'block' }} />
            {continuePending ? 'Continuing…' : 'Continue'}
          </button>
        )}
        {conversation && (
          <button
            type="button"
            className={`${styles.headerBtn} ${styles.deleteHeaderBtn}`}
            onClick={() => onDelete(conversation.id, conversation.title)}
          >
            <Trash2 size={14} aria-hidden="true" style={{ display: 'block' }} />
            Delete
          </button>
        )}
        <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="Close">
          <X size={16} aria-hidden="true" style={{ display: 'block' }} />
        </button>
      </div>

      {agedOut && (
        <div className={styles.agedOutNote}>
          <Clock size={14} aria-hidden="true" style={{ display: 'block', flexShrink: 0 }} />
          <span>Some tool details and photos from this conversation have aged out and are no longer shown.</span>
        </div>
      )}

      <div className={styles.messages}>
        {detailQuery.isLoading && <p className={styles.emptyState}>Loading conversation…</p>}
        {!detailQuery.isLoading && messages.length === 0 && (
          <p className={styles.emptyState}>This conversation has no messages.</p>
        )}
        {messages.map((message) => (
          <ChatMessage
            key={message.message_id}
            message={toUIMessage(message)}
            isLastAssistant={false}
            isStreaming={false}
            context={{}}
            resolutions={resolutions}
            resolveProposal={() => {}}
            readOnly
          />
        ))}
      </div>
    </Modal>
  );
}
