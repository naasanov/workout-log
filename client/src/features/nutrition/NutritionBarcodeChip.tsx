/**
 * Registers the data-barcodeAttachment part renderer: a scanned barcode
 * attached to a chat message renders as a tappable chip; tapping it opens
 * the read-only BarcodeAttachmentCard. Self-contained (owns its own preview
 * state) so it needs nothing lifted into the generic chat shell.
 */
import { useState } from 'react';
import { ImageOff, ScanBarcode } from 'lucide-react';
import styles from './NutritionChat.module.scss';
import { registerPartRenderer } from '../agent/registry';
import type { PartRendererProps } from '../agent/registry';
import BarcodeAttachmentCard from './BarcodeAttachmentCard';
import type { BarcodeAttachmentData } from './types';

function BarcodeAttachmentChip({ part }: PartRendererProps) {
  const [preview, setPreview] = useState<BarcodeAttachmentData | null>(null);
  const data = (part as unknown as { data: BarcodeAttachmentData }).data;

  return (
    <>
      <button
        type="button"
        className={styles.barcodeAttachmentChip}
        onClick={() => setPreview(data)}
        aria-label={`View scanned product: ${data.product.name}`}
      >
        {data.imageDataUrl ? (
          <img src={data.imageDataUrl} alt="" aria-hidden="true" className={styles.barcodeAttachmentThumb} />
        ) : (
          <span className={styles.barcodeAttachmentThumbFallback} aria-hidden="true">
            {data.imageRedacted ? (
              <ImageOff size={16} aria-hidden="true" style={{ display: 'block' }} />
            ) : (
              <ScanBarcode size={16} aria-hidden="true" style={{ display: 'block' }} />
            )}
          </span>
        )}
        <ScanBarcode className={styles.barcodeAttachmentBadge} size={16} aria-hidden="true" style={{ display: 'block' }} />
        <span className={styles.barcodeAttachmentName}>
          {data.product.name}
          {data.imageRedacted && <span className={styles.imageRedactedNote}> · photo no longer available</span>}
        </span>
      </button>

      {preview && (
        <BarcodeAttachmentCard open={true} data={preview} onClose={() => setPreview(null)} />
      )}
    </>
  );
}

registerPartRenderer('data-barcodeAttachment', BarcodeAttachmentChip);
