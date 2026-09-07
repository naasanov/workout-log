// One row in the chat-history list: title, date, message count, preview
// snippet, and an expiry indicator, plus quick Continue/Delete actions.
import { format } from 'date-fns';
import { RotateCcw, Trash2 } from 'lucide-react';
import styles from './ConversationRow.module.scss';
import { expiryLabel } from './grouping';
import type { Conversation } from '../agent/api';

export interface ConversationRowProps {
  conversation: Conversation;
  messageCount: number;
  preview: string | null;
  onOpen: () => void;
  onContinue: () => void;
  onDelete: () => void;
  continuePending: boolean;
}

export default function ConversationRow({
  conversation,
  messageCount,
  preview,
  onOpen,
  onContinue,
  onDelete,
  continuePending,
}: ConversationRowProps) {
  const title = conversation.title ?? 'Untitled conversation';
  const expiry = expiryLabel(conversation.expires_at);

  return (
    <li className={`${styles.row} ${conversation.active ? styles.rowActive : ''}`}>
      <button type="button" className={styles.rowMain} onClick={onOpen}>
        <div className={styles.rowTop}>
          <span className={styles.title}>{title}</span>
          {conversation.active && <span className={styles.activeBadge}>Active</span>}
        </div>
        <p className={styles.preview}>{preview ?? 'No messages yet'}</p>
        <div className={styles.meta}>
          <span>{format(new Date(conversation.updated_at), 'MMM d, yyyy · h:mm a')}</span>
          <span aria-hidden="true">·</span>
          <span>{messageCount} message{messageCount === 1 ? '' : 's'}</span>
          {expiry && (
            <>
              <span aria-hidden="true">·</span>
              <span className={expiry === 'Expired' ? styles.expiredLabel : undefined}>{expiry}</span>
            </>
          )}
        </div>
      </button>

      <div className={styles.actions}>
        {!conversation.active && (
          <button
            type="button"
            className={styles.actionBtn}
            onClick={onContinue}
            disabled={continuePending}
            aria-label={`Continue "${title}"`}
            title="Continue this conversation"
          >
            <RotateCcw size={16} aria-hidden="true" style={{ display: 'block' }} />
          </button>
        )}
        <button
          type="button"
          className={`${styles.actionBtn} ${styles.deleteBtn}`}
          onClick={onDelete}
          aria-label={`Delete "${title}"`}
          title="Delete this conversation"
        >
          <Trash2 size={16} aria-hidden="true" style={{ display: 'block' }} />
        </button>
      </div>
    </li>
  );
}
