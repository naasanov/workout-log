// Full-screen chat photo preview, shared by the composer thumbnail and sent messages.
// Modal supplies Escape, scroll lock and the portal but skips open-autofocus, and
// callers unmount it rather than closing it, so focus is managed here.
import { useCallback, useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import Modal from './Modal.jsx';
import styles from './ImagePreviewModal.module.scss';

export interface ImagePreviewModalProps {
  src: string;
  alt: string;
  onClose: () => void;
}

export default function ImagePreviewModal({ src, alt, onClose }: ImagePreviewModalProps) {
  const triggerRef = useRef<HTMLElement | null>(null);

  // The dialog content mounts after this component's effects run, so the close
  // button is focused from a callback ref once it actually exists.
  const focusOnMount = useCallback((el: HTMLButtonElement | null) => {
    el?.focus();
  }, []);

  useEffect(() => {
    triggerRef.current = document.activeElement as HTMLElement | null;
    return () => triggerRef.current?.focus();
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
          ref={focusOnMount}
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
