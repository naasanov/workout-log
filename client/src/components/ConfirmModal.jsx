import Modal from './Modal.jsx';
import styles from '../styles/ConfirmModal.module.scss';

/**
 * ConfirmModal — destructive-action confirmation dialog.
 *
 * Props (unchanged from the hand-rolled version):
 *   message   {string}  — text to display
 *   onConfirm {fn}      — called when user clicks "Delete"
 *   onCancel  {fn}      — called when user clicks "Cancel", presses ESC, or clicks backdrop
 *
 * Call-site pattern (unchanged): {showConfirm && <ConfirmModal ... />}
 * The component is always "open" when mounted; closing is handled by calling onCancel/onConfirm
 * from the parent, which unmounts the component.
 */
function ConfirmModal({ message, onConfirm, onCancel }) {
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
