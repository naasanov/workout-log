/**
 * Nutrition's composer plugin: the camera/library/barcode attach buttons,
 * pending-photo and pending-barcode state, and the thumbnail strip/notice
 * row shown above the composer. Returns a ComposerPlugin (see
 * features/agent/AgentChat.tsx) plus modal JSX (the barcode scanner
 * overlay, and a tap-to-preview card for a pending scan) meant to render as
 * siblings of <AgentChat/>, not inside the sheet.
 *
 * Wired into the chat on every tab, not only nutrition's — a photo or a
 * scanned barcode is useful regardless of which tab is active, since the
 * agent has nutrition tools no matter which tab you're on. It still lives
 * under `features/nutrition` (not `features/agent`) because the barcode
 * path does real nutrition-domain work: looking a code up against Open
 * Food Facts and shaping the result into a `data-barcodeAttachment` part.
 */
import { useCallback, useRef, useState } from 'react';
import { Camera, Images, ScanBarcode, X } from 'lucide-react';
import styles from './NutritionComposer.module.scss';
import type { ComposerPlugin, AgentMessagePart } from '../agent/AgentChat';
import { downscaleImage } from './imageDownscale';
import { lookupBarcode } from './api';
import BarcodeScanner from './BarcodeScanner';
import BarcodeAttachmentCard from './BarcodeAttachmentCard';
import ImagePreviewModal from '../../components/ImagePreviewModal';
import type { BarcodeAttachmentData } from './types';

interface PendingPhoto {
  file: File;
  previewUrl: string;
  dataUrl?: string;
}

// A client-generated `id` (like PendingPhoto's previewUrl) lets MULTIPLE
// scans be pending at once — a single-object slot would mean a second scan
// silently overwrites the first.
interface PendingBarcode {
  id: string;
  code: string;
  imageDataUrl?: string;
  product: BarcodeAttachmentData['product'];
}

export interface NutritionComposerExtras {
  plugin: ComposerPlugin;
  modals: React.ReactNode;
}

export function useNutritionComposerExtras(): NutritionComposerExtras {
  const [pendingPhotos, setPendingPhotos] = useState<PendingPhoto[]>([]);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [barcodeOpen, setBarcodeOpen] = useState(false);
  const [barcodeLoading, setBarcodeLoading] = useState(false);
  const [pendingBarcodes, setPendingBarcodes] = useState<PendingBarcode[]>([]);
  const [barcodeNotice, setBarcodeNotice] = useState<string | null>(null);
  // Tap-to-preview for a scan still pending in the composer (not yet sent).
  const [barcodePreview, setBarcodePreview] = useState<BarcodeAttachmentData | null>(null);
  // Full-screen tap-to-preview for a pending photo thumbnail.
  const [photoPreview, setPhotoPreview] = useState<{ src: string; alt: string } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const libraryInputRef = useRef<HTMLInputElement>(null);

  const handlePhotoFiles = useCallback(async (files: FileList) => {
    setPhotoError(null);
    const incoming = Array.from(files).filter(f => f.type.startsWith('image/'));
    if (incoming.length === 0) return;

    const newPhotos: PendingPhoto[] = incoming.map(file => ({
      file,
      previewUrl: URL.createObjectURL(file),
    }));

    setPendingPhotos(prev => [...prev, ...newPhotos]);

    const settled = await Promise.allSettled(newPhotos.map(p => downscaleImage(p.file)));
    setPendingPhotos(prev => {
      const updated = [...prev];
      newPhotos.forEach((p, i) => {
        const result = settled[i];
        const idx = updated.findIndex(u => u.previewUrl === p.previewUrl);
        if (idx !== -1 && result.status === 'fulfilled') {
          updated[idx] = { ...updated[idx], dataUrl: result.value };
        }
      });
      return updated;
    });
  }, []);

  const handleFileInputChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      await handlePhotoFiles(e.target.files);
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [handlePhotoFiles]);

  const handleLibraryInputChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      await handlePhotoFiles(e.target.files);
    }
    if (libraryInputRef.current) libraryInputRef.current.value = '';
  }, [handlePhotoFiles]);

  // Paste an image directly into the composer. Only intercepts the paste
  // when the clipboard actually contains image data; plain text proceeds.
  const handleComposerPaste = useCallback((e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files = e.clipboardData?.files;
    if (!files || files.length === 0) return;
    const hasImage = Array.from(files).some(f => f.type.startsWith('image/'));
    if (!hasImage) return;
    e.preventDefault();
    handlePhotoFiles(files);
  }, [handlePhotoFiles]);

  const removePhoto = useCallback((previewUrl: string) => {
    setPendingPhotos(prev => {
      const photo = prev.find(p => p.previewUrl === previewUrl);
      if (photo) URL.revokeObjectURL(photo.previewUrl);
      return prev.filter(p => p.previewUrl !== previewUrl);
    });
  }, []);

  // The scanned barcode becomes a chat ATTACHMENT (like a photo), not
  // textarea text. Not-found scans are REJECTED — nothing is attached, and
  // the user is told to describe the item manually or photograph the label.
  const handleBarcodeDetected = useCallback(async (code: string, imageDataUrl?: string) => {
    setBarcodeOpen(false);
    setBarcodeLoading(true);
    setBarcodeNotice(null);
    try {
      const product = await lookupBarcode(code);
      if (!product) {
        setBarcodeNotice(
          `Couldn't find a product for barcode ${code}. Describe it in the chat, or take a photo of the nutrition label instead.`,
        );
        return;
      }
      // APPEND rather than replace, so a second (third, ...) scan adds
      // another chip instead of overwriting the previous one.
      setPendingBarcodes(prev => [...prev, { id: crypto.randomUUID(), code, imageDataUrl, product }]);
    } catch {
      setBarcodeNotice('Barcode lookup failed. Describe the item in the chat, or take a photo of the nutrition label instead.');
    } finally {
      setBarcodeLoading(false);
    }
  }, []);

  const removePendingBarcode = useCallback((id: string) => {
    setPendingBarcodes(prev => prev.filter(b => b.id !== id));
  }, []);

  const hasPendingContent = pendingPhotos.length > 0 || pendingBarcodes.length > 0;

  const takeAttachments = useCallback((): AgentMessagePart[] => {
    const files: AgentMessagePart[] = pendingPhotos.map(p => ({
      type: 'file' as const,
      mediaType: 'image/jpeg',
      url: p.dataUrl ?? p.previewUrl,
    }));

    // A barcode-only send (no typed text) still needs a fallback text part —
    // see fallbackText below. The structured product data travels as one
    // data-barcodeAttachment part PER scan; convertToModelMessages drops
    // these from the user turn by design (UI-only — the model instead
    // receives it as a pre-fetched tool-result).
    const barcodeParts: AgentMessagePart[] = pendingBarcodes.map(b => ({
      type: 'data-barcodeAttachment' as const,
      data: {
        code: b.code,
        imageDataUrl: b.imageDataUrl ?? null,
        product: b.product,
      } satisfies BarcodeAttachmentData,
    }));

    pendingPhotos.forEach(p => URL.revokeObjectURL(p.previewUrl));
    setPendingPhotos([]);
    setPendingBarcodes([]);

    return [...files, ...barcodeParts];
  }, [pendingPhotos, pendingBarcodes]);

  const fallbackText = useCallback((attachments: AgentMessagePart[]): string | null => {
    const barcodeAttachments = attachments.filter(a => a.type === 'data-barcodeAttachment');
    if (barcodeAttachments.length === 0) return null;
    const names = barcodeAttachments
      .map(a => ((a.data as BarcodeAttachmentData).product.name))
      .join(', ');
    return barcodeAttachments.length === 1
      ? `Log this scanned product: ${names}`
      : `Log these scanned products: ${names}`;
  }, []);

  const renderAttachRow = (
    <>
      <button
        type="button"
        className={styles.composerCircleBtn}
        onClick={() => fileInputRef.current?.click()}
        aria-label="Attach photo"
        title="Attach photo"
      >
        <Camera className={styles.composerCircleBtnIcon} size={16} aria-hidden="true" />
      </button>

      <button
        type="button"
        className={styles.composerCircleBtn}
        onClick={() => setBarcodeOpen(true)}
        disabled={barcodeLoading}
        aria-label={barcodeLoading ? 'Looking up barcode…' : 'Scan barcode'}
        title="Scan barcode"
      >
        <ScanBarcode className={styles.composerCircleBtnIcon} size={16} aria-hidden="true" />
      </button>

      <button
        type="button"
        className={styles.composerCircleBtn}
        onClick={() => libraryInputRef.current?.click()}
        aria-label="Attach from photo library"
        title="Attach from photo library"
      >
        <Images className={styles.composerCircleBtnIcon} size={16} aria-hidden="true" />
      </button>

      {/* Camera capture input — opens direct camera on iOS */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        className={styles.hiddenFileInput}
        onChange={handleFileInputChange}
        aria-hidden="true"
        tabIndex={-1}
      />

      {/* Photo library input — no capture attribute so iOS shows the file picker */}
      <input
        ref={libraryInputRef}
        type="file"
        accept="image/*"
        multiple
        className={styles.hiddenFileInput}
        onChange={handleLibraryInputChange}
        aria-hidden="true"
        tabIndex={-1}
      />
    </>
  );

  const renderAboveComposer = (
    <>
      {(pendingPhotos.length > 0 || pendingBarcodes.length > 0) && (
        <div className={styles.thumbnails}>
          {pendingPhotos.map(p => (
            <div key={p.previewUrl} className={styles.thumbnailWrap}>
              <button
                type="button"
                className={styles.photoThumbBtn}
                onClick={() => setPhotoPreview({ src: p.previewUrl, alt: 'Pending photo' })}
                aria-label="View pending photo"
              >
                <img src={p.previewUrl} alt="Pending photo" className={styles.thumbnail} />
              </button>
              <button
                type="button"
                className={styles.thumbnailRemove}
                onClick={() => removePhoto(p.previewUrl)}
                aria-label="Remove photo"
              >
                ✕
              </button>
              {!p.dataUrl && <span className={styles.thumbnailProcessing} />}
            </div>
          ))}

          {/* One chip PER pending scan — tap to preview, X to remove just that one. */}
          {pendingBarcodes.map((b, i) => (
            <div key={b.id} className={styles.thumbnailWrap}>
              <button
                type="button"
                className={styles.barcodeThumbBtn}
                onClick={() => setBarcodePreview({
                  code: b.code,
                  imageDataUrl: b.imageDataUrl ?? null,
                  product: b.product,
                })}
                aria-label={
                  pendingBarcodes.length > 1
                    ? `View scanned product ${i + 1} of ${pendingBarcodes.length}: ${b.product.name}`
                    : `View scanned product: ${b.product.name}`
                }
              >
                {b.imageDataUrl ? (
                  <img src={b.imageDataUrl} alt="Scanned product" className={styles.thumbnail} />
                ) : (
                  <span className={styles.thumbnail} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <ScanBarcode size={16} aria-hidden="true" style={{ display: 'block' }} />
                  </span>
                )}
                <ScanBarcode className={styles.barcodeThumbBadge} size={16} aria-hidden="true" style={{ display: 'block' }} />
              </button>
              <button
                type="button"
                className={styles.thumbnailRemove}
                onClick={() => removePendingBarcode(b.id)}
                aria-label={
                  pendingBarcodes.length > 1
                    ? `Remove scanned product ${i + 1} of ${pendingBarcodes.length}: ${b.product.name}`
                    : 'Remove scanned product'
                }
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      {photoError && <p className={styles.photoError}>{photoError}</p>}

      {/* Manual dismiss only, no auto-hide timer. */}
      {barcodeNotice && (
        <div className={styles.noticeRow}>
          <p className={styles.noticeText}>{barcodeNotice}</p>
          <button
            type="button"
            className={styles.noticeDismiss}
            onClick={() => setBarcodeNotice(null)}
            aria-label="Dismiss barcode notice"
          >
            <X size={14} aria-hidden="true" style={{ display: 'block' }} />
          </button>
        </div>
      )}
    </>
  );

  const modals = (
    <>
      {barcodeOpen && (
        <BarcodeScanner
          onDetected={handleBarcodeDetected}
          onClose={() => setBarcodeOpen(false)}
        />
      )}

      {barcodePreview && (
        <BarcodeAttachmentCard
          open={true}
          data={barcodePreview}
          onClose={() => setBarcodePreview(null)}
        />
      )}

      {photoPreview && (
        <ImagePreviewModal
          src={photoPreview.src}
          alt={photoPreview.alt}
          onClose={() => setPhotoPreview(null)}
        />
      )}
    </>
  );

  return {
    plugin: {
      renderAttachRow,
      renderAboveComposer,
      hasPendingContent,
      takeAttachments,
      fallbackText,
      onComposerPaste: handleComposerPaste,
    },
    modals,
  };
}
