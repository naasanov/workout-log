import { useState } from 'react';
import Modal from './Modal.jsx';
import styles from '../styles/VariationNotesModal.module.scss';

/**
 * VariationNotesModal — free-text notes editor for a variation.
 * Mirrors the shape of WeightGraphModal: same Modal wrapper, same
 * header-with-title-and-close pattern. Autosaves on blur, no Save button.
 *
 * Props:
 *   variation {object}   — must have .id and .label
 *   notes     {string}   — current notes value (may be empty/null)
 *   onSave    {fn}       — async (notes: string) => void, called on blur when changed
 *   onClose   {fn}       — called to close the modal
 */
function VariationNotesModal({ variation, notes, onSave, onClose }) {
  const [value, setValue] = useState(notes ?? '');

  function handleBlur() {
    const trimmed = value;
    if (trimmed === (notes ?? '')) return;
    onSave(trimmed);
  }

  return (
    <Modal
      open={true}
      onOpenChange={(isOpen) => { if (!isOpen) onClose(); }}
      title={variation.label || 'Variation'}
      showTitle={false}
      contentClassName={styles.modalContent}
    >
      <div className={styles.modal}>
        <div className={styles.header}>
          <span className={styles.title}>{variation.label || 'Variation'}</span>
          <button className={styles.close} onClick={onClose} aria-label="Close">✕</button>
        </div>

        <textarea
          className={styles.textarea}
          value={value}
          onChange={e => setValue(e.target.value)}
          onBlur={handleBlur}
          placeholder="Bar weight, machine settings, form cues..."
          maxLength={2000}
          autoFocus
        />
      </div>
    </Modal>
  );
}

export default VariationNotesModal;
