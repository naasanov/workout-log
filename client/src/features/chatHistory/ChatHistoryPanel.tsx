// The chat-history tab: browse past conversations, open one read-only, and
// continue or delete it. Core feature set only -- no pin/star, model-
// generated titles, full-text search, or manual rename (all explicitly
// deferred).
import { useState } from 'react';
import { MessagesSquare } from 'lucide-react';
import styles from './ChatHistoryPanel.module.scss';
import ConversationRow from './ConversationRow';
import ConversationViewer from './ConversationViewer';
import ConfirmDeleteModal from './ConfirmDeleteModal';
import { groupByRecency } from './grouping';
import {
  useConversationList,
  useContinueConversation,
  useDeleteConversation,
} from './api';

export interface ChatHistoryPanelProps {
  /** Called once a conversation has been made active again via Continue --
   *  the caller (Workouts.jsx) uses this to pop the chat sheet open onto it. */
  onConversationContinued: () => void;
}

export default function ChatHistoryPanel({ onConversationContinued }: ChatHistoryPanelProps) {
  const listQuery = useConversationList();
  const conversations = listQuery.data?.conversations ?? [];
  const expiryDays = listQuery.data?.expiryDays;
  const conversationById = new Map(conversations.map((c) => [c.id, c]));

  const continueMutation = useContinueConversation();
  const deleteMutation = useDeleteConversation();

  const [openConversationId, setOpenConversationId] = useState<number | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{ id: number; title: string | null } | null>(null);

  const active = conversations.find((c) => c.active) ?? null;
  const rest = conversations.filter((c) => !c.active);
  const groups = groupByRecency(rest);

  function handleContinue(id: number) {
    continueMutation.mutate(id, {
      onSuccess: () => {
        setOpenConversationId(null);
        onConversationContinued();
      },
    });
  }

  function handleDeleteConfirmed() {
    if (!pendingDelete) return;
    deleteMutation.mutate(pendingDelete.id, {
      onSuccess: () => {
        if (openConversationId === pendingDelete.id) setOpenConversationId(null);
        setPendingDelete(null);
      },
    });
  }

  function renderRow(id: number) {
    const conversation = conversationById.get(id);
    if (!conversation) return null;
    return (
      <ConversationRow
        key={id}
        conversation={conversation}
        onOpen={() => setOpenConversationId(id)}
        onContinue={() => handleContinue(id)}
        onDelete={() => setPendingDelete({ id, title: conversation.title })}
        continuePending={continueMutation.isPending && continueMutation.variables === id}
      />
    );
  }

  if (listQuery.isLoading) {
    return <p className={styles.loading}>Loading conversations…</p>;
  }

  if (conversations.length === 0) {
    return (
      <div className={styles.emptyState}>
        <MessagesSquare size={32} className={styles.emptyIcon} aria-hidden="true" style={{ display: 'block' }} />
        <h2 className={styles.emptyHeading}>No conversations yet</h2>
        <p className={styles.emptyBody}>
          Chats you start from the AI assistant will show up here once you send a message.
        </p>
      </div>
    );
  }

  return (
    <div className={styles.panel}>
      {expiryDays !== undefined && (
        <p className={styles.expiryNote}>Past chats are kept for {expiryDays} days.</p>
      )}

      {active && (
        <ul className={styles.list} role="list">
          {renderRow(active.id)}
        </ul>
      )}

      {groups.map(({ group, items }) => (
        <div key={group}>
          <h2 className={styles.groupHeading}>{group}</h2>
          <ul className={styles.list} role="list">
            {items.map((c) => renderRow(c.id))}
          </ul>
        </div>
      ))}

      <ConversationViewer
        conversationId={openConversationId}
        onClose={() => setOpenConversationId(null)}
        onContinue={handleContinue}
        continuePending={continueMutation.isPending}
        onDelete={(id, title) => setPendingDelete({ id, title })}
      />

      <ConfirmDeleteModal
        open={pendingDelete !== null}
        title={pendingDelete?.title ?? null}
        pending={deleteMutation.isPending}
        onCancel={() => setPendingDelete(null)}
        onConfirm={handleDeleteConfirmed}
      />
    </div>
  );
}
