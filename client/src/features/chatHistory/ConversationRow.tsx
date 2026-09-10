// One row in the chat-history list: when the chat was last active as its
// header, its first message beneath, plus quick Continue/Delete actions.
import { format, isThisYear } from 'date-fns';
import { RotateCcw, Trash2 } from 'lucide-react';
import styles from './ConversationRow.module.scss';
import type { Conversation } from '../agent/api';

export interface ConversationRowProps {
  conversation: Conversation;
  onOpen: () => void;
  onContinue: () => void;
  onDelete: () => void;
  continuePending: boolean;
}

function formatWhen(dateStr: string): string {
  const date = new Date(dateStr);
  return format(date, isThisYear(date) ? 'MMM d · h:mm a' : 'MMM d, yyyy · h:mm a');
}

export default function ConversationRow({
  conversation,
  onOpen,
  onContinue,
  onDelete,
  continuePending,
}: ConversationRowProps) {
  const when = formatWhen(conversation.updated_at);
  const firstMessage = conversation.title;

  return (
    <li className={`${styles.row} ${conversation.active ? styles.rowActive : ''}`}>
      <button type="button" className={styles.rowMain} onClick={onOpen}>
        <div className={styles.rowTop}>
          <span className={styles.when}>{when}</span>
          {conversation.active && <span className={styles.activeBadge}>Active</span>}
        </div>
        <p className={`${styles.firstMessage} ${firstMessage ? '' : styles.empty}`}>
          {firstMessage ?? 'No messages yet'}
        </p>
      </button>

      <div className={styles.actions}>
        {!conversation.active && (
          <button
            type="button"
            className={styles.actionBtn}
            onClick={onContinue}
            disabled={continuePending}
            aria-label={`Continue chat from ${when}`}
            title="Continue this conversation"
          >
            <RotateCcw size={16} aria-hidden="true" style={{ display: 'block' }} />
          </button>
        )}
        <button
          type="button"
          className={`${styles.actionBtn} ${styles.deleteBtn}`}
          onClick={onDelete}
          aria-label={`Delete chat from ${when}`}
          title="Delete this conversation"
        >
          <Trash2 size={16} aria-hidden="true" style={{ display: 'block' }} />
        </button>
      </div>
    </li>
  );
}
