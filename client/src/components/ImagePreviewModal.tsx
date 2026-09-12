/**
 * ImagePreviewModal — full-screen preview for a chat photo, opened by
 * tapping its thumbnail. Wraps the shared Modal primitive so it inherits
 * Escape-to-close, scroll-lock, restore-focus-on-close, and portal
 * behavior for free; Modal skips its own open-autofocus, so this component
 * moves focus onto its close button itself once mounted.
 *
 * Shared by the nutrition composer's pending-photo thumbnail and a sent
 * message's attached image — one implementation for both surfaces.
 */
import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import Modal from './Modal.jsx';
import styles from './ImagePreviewModal.module.scss';

export interface ImagePreviewModalProps {
  src: string;
  alt: string;
  onClose: () => void;
}

export default function ImagePreviewModal({ src, alt, onClose }: ImagePreviewModalProps) {
  const closeBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeBtnRef.current?.focus();
  }, []);

  // Backdrop-tap-to-close: only when the tap lands on the full-screen
  // wrapper itself, not when it bubbles up from the image or close button.
  function handleBackdropClick(e: React.MouseEvent<HTMLDivElement>) {
    if (e.target === e.currentTarget) onClose();
  }

  return (
    <Modal
      open={true}
      onOpenChange={(isOpen: boolean) => { if (!isOpen) onClose(); }}
      title={alt}
      contentClassName={styles.previewContent}
    >
      <div className={styles.previewArea} onClick={handleBackdropClick}>
        <button
          ref={closeBtnRef}
          type="button"
          className={styles.closeBtn}
          onClick={onClose}
          aria-label="Close preview"
        >
          <X size={22} aria-hidden="true" style={{ display: 'block' }} />
        </button>
        <img src={src} alt={alt} className={styles.previewImage} />
      </div>
    </Modal>
  );
}
