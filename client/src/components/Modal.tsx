/**
 * Modal — reusable Radix UI Dialog wrapper
 *
 * API:
 *   <Modal
 *     open={boolean}            // controlled open state
 *     onOpenChange={fn}         // called with (open: boolean) — use to close: onOpenChange={setOpen}
 *     title={string}            // accessible Dialog.Title (visually hidden by default)
 *     showTitle={boolean}       // set true to render title visibly (default: false)
 *     contentClassName={string} // extra CSS class(es) for the panel div
 *   >
 *     {children}
 *   </Modal>
 *
 * Radix provides focus-trap, ESC key, scroll-lock, and portal for free.
 * The portal renders into document.body, escaping header CSS bleed-through.
 */
import * as Dialog from '@radix-ui/react-dialog';
import type { ReactNode } from 'react';
import styles from '../styles/Modal.module.scss';

type ModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  showTitle?: boolean;
  contentClassName?: string;
  children?: ReactNode;
};

function Modal({ open, onOpenChange, title, showTitle = false, contentClassName, children }: ModalProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.overlay} />
        <Dialog.Content
          className={`${styles.content}${contentClassName ? ` ${contentClassName}` : ''}`}
          // Prevent default auto-focus behavior from stealing focus unexpectedly
          onOpenAutoFocus={e => e.preventDefault()}
        >
          <Dialog.Title className={showTitle ? undefined : styles.srOnly}>
            {title || 'Dialog'}
          </Dialog.Title>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export default Modal;
