import Modal from './Modal';
import styles from '../styles/ConfirmModal.module.scss';

type ConfirmModalProps = {
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
};

/**
 * ConfirmModal — destructive-action confirmation dialog.
 *
 * Call-site pattern (unchanged): {showConfirm && <ConfirmModal ... />}
 * The component is always "open" when mounted; closing is handled by calling onCancel/onConfirm
 * from the parent, which unmounts the component.
 */
function ConfirmModal({ message, onConfirm, onCancel }: ConfirmModalProps) {
  return (
    <Modal
      open={true}
      onOpenChange={(isOpen) => { if (!isOpen) onCancel(); }}
      title="Confirm deletion"
    >
      <div className={styles.modal}>
        <p className={styles.message}>{message}</p>
        <div className={styles.actions}>
          <button className={styles.cancel} onClick={onCancel}>Cancel</button>
          <button className={styles.confirm} onClick={onConfirm}>Delete</button>
        </div>
      </div>
    </Modal>
  );
}

export default ConfirmModal;
