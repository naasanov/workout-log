import { useRef, useState } from 'react';
import Modal from './Modal.jsx';
import styles from '../styles/VariationNotesModal.module.scss';

/**
 * VariationNotesModal — free-text notes editor for a variation.
 * Mirrors the shape of WeightGraphModal: same Modal wrapper, same
 * header-with-title-and-close pattern. Autosaves on blur; the close button
 * and the Save button are both just affordances into the same close path.
 *
 * Radix Dialog closes on Escape and overlay click without ever blurring the
 * textarea (no mousedown moves focus first), so `onBlur` alone misses those
 * paths and would silently discard the edit. Every close path — blur, the
 * close button, the Save button, overlay click, and Escape — funnels
 * through `flush()`, which reads the latest typed value from a ref
 * (avoiding stale closures) and no-ops if it already matches what was last
 * saved (avoiding duplicate PATCHes when e.g. blur fires immediately before
 * a close/save handler).
 *
 * Props:
 *   variation {object}   — must have .id and .label
 *   notes     {string}   — current notes value (may be empty/null)
 *   onSave    {fn}       — async (notes: string) => void, called when the value changed
 *   onClose   {fn}       — called to close the modal
 */
function VariationNotesModal({ variation, notes, onSave, onClose }) {
  const initial = notes ?? '';
  const [value, setValue] = useState(initial);
  const valueRef = useRef(initial);
  const savedRef = useRef(initial);

  function handleChange(e) {
    const next = e.target.value;
    setValue(next);
    valueRef.current = next;
  }

  function flush() {
    const current = valueRef.current;
    if (current === savedRef.current) return;
    // Update synchronously, before the (async) save resolves, so a second
    // close signal (e.g. blur followed by the close button's own handler)
    // sees it as already-saved and no-ops instead of firing a second PATCH.
    savedRef.current = current;
    onSave(current);
  }

  function handleClose() {
    flush();
    onClose();
  }

  return (
    <Modal
      open={true}
      onOpenChange={(isOpen) => { if (!isOpen) handleClose(); }}
      title={variation.label || 'Variation'}
      showTitle={false}
      contentClassName={styles.modalContent}
    >
      <div className={styles.modal}>
        <div className={styles.header}>
          <span className={styles.title}>{variation.label || 'Variation'}</span>
          <button className={styles.close} onClick={handleClose} aria-label="Close">✕</button>
        </div>

        <textarea
          className={styles.textarea}
          value={value}
          onChange={handleChange}
          onBlur={flush}
          placeholder="Bar weight, machine settings, form cues..."
          maxLength={2000}
          autoFocus
        />

        <div className={styles.actions}>
          {/* #232: purely a UX affordance — goes through the same handleClose
              path as the X, so it inherits flush()'s dedupe and never fires
              a second PATCH even if blur already flushed the edit. */}
          <button type="button" className={styles.save} onClick={handleClose}>
            Save
          </button>
        </div>
      </div>
    </Modal>
  );
}

export default VariationNotesModal;
