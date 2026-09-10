// Confirmation gate for deleting a conversation -- genuinely destructive
// (removes the conversation, its messages, and its resolutions server-side),
// so this always sits between the Delete button and the actual mutation.
import Modal from '../../components/Modal.jsx';
import styles from './ConfirmDeleteModal.module.scss';

export interface ConfirmDeleteModalProps {
  open: boolean;
  title: string | null;
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export default function ConfirmDeleteModal({ open, title, pending, onCancel, onConfirm }: ConfirmDeleteModalProps) {
  return (
    <Modal
      open={open}
      onOpenChange={(isOpen: boolean) => { if (!isOpen) onCancel(); }}
      title="Delete conversation"
      contentClassName={styles.modalContent}
    >
      <div className={styles.inner}>
        <h2 className={styles.heading}>Delete this conversation?</h2>
        <p className={styles.description}>
          {title ? `"${title}"` : 'This conversation'} and all of its messages will be permanently
          deleted. This can't be undone.
        </p>
        <div className={styles.actions}>
          <button type="button" className={styles.cancelBtn} onClick={onCancel} disabled={pending}>
            Cancel
          </button>
          <button type="button" className={styles.confirmBtn} onClick={onConfirm} disabled={pending}>
            {pending ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
