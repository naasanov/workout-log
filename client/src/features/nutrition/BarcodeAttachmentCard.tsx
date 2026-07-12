/**
 * BarcodeAttachmentCard — READ-ONLY preview for a scanned barcode chat attachment.
 *
 * Tapping the barcode chip in the composer (pending) or in a sent message
 * (transcript) opens this card. It reuses IngredientSheet's Radix Dialog shell
 * and CSS classes (.sheet/.header/.body/.macrosSection/.macrosGrid/...) plus
 * ingredientMath's rowFromFood()/recomputeMacros() so the macro figures and
 * layout match the rest of the app exactly — this is intentionally NOT an
 * editable form: there are no inputs, no barcode/search affordances, no Done
 * button. Just name + resolved serving + macros, and a Close button.
 */
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { rowFromFood } from './ingredientMath';
import type { BarcodeAttachmentData } from './types';
import styles from './IngredientSheet.module.scss';

export interface BarcodeAttachmentCardProps {
  open: boolean;
  data: BarcodeAttachmentData;
  onClose: () => void;
}

export default function BarcodeAttachmentCard({ open, data, onClose }: BarcodeAttachmentCardProps) {
  const row = rowFromFood(data.product);

  return (
    <Dialog.Root open={open} onOpenChange={isOpen => { if (!isOpen) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.overlay} />
        <Dialog.Content
          className={styles.sheet}
          aria-label="Scanned product"
          onOpenAutoFocus={e => e.preventDefault()}
          onEscapeKeyDown={e => e.stopPropagation()}
        >
          <Dialog.Title className={styles.srOnly}>Scanned product</Dialog.Title>

          <div className={styles.header}>
            <button
              type="button"
              className={styles.closeBtn}
              onClick={onClose}
              aria-label="Close"
            >
              <X size={16} aria-hidden="true" style={{ display: 'block' }} />
            </button>
            <h2 className={styles.headerTitle}>Scanned product</h2>
            <span style={{ width: 32 }} aria-hidden="true" />
          </div>

          <div className={styles.body}>
            {data.imageDataUrl ? (
              <img
                src={data.imageDataUrl}
                alt=""
                aria-hidden="true"
                style={{
                  width: '100%',
                  maxHeight: 160,
                  objectFit: 'cover',
                  borderRadius: 12,
                  marginBottom: 12,
                  display: 'block',
                }}
              />
            ) : data.imageRedacted ? (
              <p style={{ fontSize: 12, fontStyle: 'italic', opacity: 0.6, margin: '0 0 12px' }}>
                Photo no longer available
              </p>
            ) : null}

            <div className={styles.nameRow}>
              <div className={styles.nameInputWrap}>
                <p style={{ fontWeight: 600, margin: 0 }}>{row.name}</p>
              </div>
            </div>

            <div className={styles.portionRow}>
              <label className={styles.fieldLabel} aria-label="Quantity">
                <span>Qty</span>
                <span className={styles.unitStatic}>{row.quantity}</span>
              </label>
              <label className={styles.fieldLabel}>
                <span>Unit</span>
                <span className={styles.unitStatic}>{row.unitLabel}</span>
              </label>
            </div>

            <div className={styles.macrosSection}>
              <span className={styles.macrosSectionLabel}>Macros</span>
              <div className={styles.macrosGrid}>
                <label className={styles.fieldLabel}>
                  <span>kcal</span>
                  <input
                    className={styles.inputSmall}
                    type="text"
                    value={Math.round(row.calories)}
                    readOnly
                    aria-label="Calories"
                  />
                </label>
                <label className={styles.fieldLabel}>
                  <span>Prot</span>
                  <input
                    className={styles.inputSmall}
                    type="text"
                    value={row.protein_g}
                    readOnly
                    aria-label="Protein g"
                  />
                </label>
                <label className={styles.fieldLabel}>
                  <span>Carbs</span>
                  <input
                    className={styles.inputSmall}
                    type="text"
                    value={row.carbs_g}
                    readOnly
                    aria-label="Carbs g"
                  />
                </label>
                <label className={styles.fieldLabel}>
                  <span>Fat</span>
                  <input
                    className={styles.inputSmall}
                    type="text"
                    value={row.fat_g}
                    readOnly
                    aria-label="Fat g"
                  />
                </label>
              </div>
              <p className={styles.rowHint}>
                From Open Food Facts (barcode {data.code}) · read-only — this is a preview of the scanned product, not an editable entry.
              </p>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
