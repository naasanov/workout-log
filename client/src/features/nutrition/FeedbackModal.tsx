/**
 * FeedbackModal — item #1.
 * A small Radix Dialog + react-hook-form that lets users send feedback.
 * Category: bug / idea / UI / other. Tool: which tab the feedback concerns
 * (defaults to the tab the user is currently on). Message: textarea.
 * On submit: calls submitFeedback() from api.ts.
 * Shows a brief thank-you state, then auto-closes after 2s.
 *
 * #218: the modal is mounted globally (Header.jsx) and stays mounted across
 * open/close, so a Cancel/backdrop/Esc close must NOT clear the in-progress
 * draft — react-hook-form's `reset()` is only called after a *successful*
 * submit. The draft is plain React state (via react-hook-form's internal
 * state), so it survives close/reopen within the page session but starts
 * clean on a full reload — no localStorage involved, per product decision.
 *
 * #296: picked attachments follow the same #218 rule — they're plain React
 * state that only clears after a successful submit, never on close.
 */
import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useSearchParams } from 'react-router-dom';
import { Plus } from 'lucide-react';
import Modal from '../../components/Modal.jsx';
import { submitFeedback } from './api';
import { downscaleImage } from './imageDownscale';
import { TABS, TAB_LABELS, DEFAULT_ORDER, VALID_TABS } from '../../config/tabs';
import styles from './FeedbackModal.module.scss';

interface FeedbackModalProps {
  open: boolean;
  onClose: () => void;
}

type FeedbackCategory = 'bug' | 'idea' | 'ui' | 'other';

// #215: "which tab/tool" the feedback is about — the four app tabs plus a
// catch-all for feedback that isn't tied to a specific tab.
const OTHER_TOOL = 'other';

// #266: mirrors the server's `message` max (routes/feedback.ts) so the
// common "too long" case is caught client-side and never round-trips.
const MESSAGE_MAX_LENGTH = 4000;

// #296: mirrors the server's attachment cap (routes/feedback.ts).
const MAX_ATTACHMENTS = 3;

interface FeedbackForm {
  category: FeedbackCategory;
  tool: string;
  message: string;
}

interface AttachmentDraft {
  id: string;
  previewUrl: string;
  dataUrl: string | null;
  error: string | null;
}

export default function FeedbackModal({ open, onClose }: FeedbackModalProps) {
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // #215: default the "tool" field to the tab the user is currently on —
  // read the same way NavDrawer.jsx does (URL `tab` search param, falling
  // back to Workouts). Imported from the shared config, not duplicated.
  const [searchParams] = useSearchParams();
  const tabParam = searchParams.get('tab');
  // Pre-existing tsc gap: URLSearchParams#get is `string | null`, but
  // VALID_TABS (from the untyped tabs.js config) infers `Set<string>` — guard
  // the null case explicitly rather than widening the shared config's types.
  const currentTab = tabParam != null && VALID_TABS.has(tabParam) ? tabParam : TABS.WORKOUTS;

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    getValues,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FeedbackForm>({
    defaultValues: { category: 'idea', tool: currentTab, message: '' },
  });

  // #266: live character count for the counter under the textarea.
  const messageLength = watch('message')?.length ?? 0;
  const overLimit = messageLength > MESSAGE_MAX_LENGTH;

  // Since this modal stays mounted app-wide (see header comment), the user
  // can navigate tabs while it's closed. Keep "tool" following the active
  // tab in that case — but only while it still holds the last tab we
  // defaulted it to. Once the user picks a tool themselves, their choice
  // (part of the draft #218 preserves) is left alone.
  const lastDefaultTool = useRef(currentTab);
  useEffect(() => {
    if (getValues('tool') === lastDefaultTool.current) {
      setValue('tool', currentTab);
    }
    lastDefaultTool.current = currentTab;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTab]);

  // #296: picked attachments, keyed by a local id. `dataUrl` fills in once
  // the downscale finishes; `previewUrl` (an object URL) renders immediately
  // so the thumbnail doesn't wait on that. Survives close per #218 — see
  // handleClose below, which never touches this.
  const [attachments, setAttachments] = useState<AttachmentDraft[]>([]);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function clearAttachments() {
    setAttachments((prev) => {
      prev.forEach((a) => URL.revokeObjectURL(a.previewUrl));
      return [];
    });
  }

  async function handleFilesPicked(files: FileList | null) {
    if (!files || files.length === 0) return;
    setAttachmentError(null);

    const room = MAX_ATTACHMENTS - attachments.length;
    const picked = Array.from(files).slice(0, room);
    if (files.length > room) {
      setAttachmentError(`You can attach up to ${MAX_ATTACHMENTS} images.`);
    }

    const drafts: AttachmentDraft[] = picked.map((file) => ({
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      previewUrl: URL.createObjectURL(file),
      dataUrl: null,
      error: null,
    }));
    setAttachments((prev) => [...prev, ...drafts]);

    await Promise.all(picked.map(async (file, i) => {
      const draft = drafts[i];
      try {
        const dataUrl = await downscaleImage(file);
        setAttachments((prev) => prev.map((a) => (a.id === draft.id ? { ...a, dataUrl } : a)));
      } catch {
        setAttachments((prev) => prev.map((a) => (
          a.id === draft.id ? { ...a, error: 'Failed to process this image.' } : a
        )));
      }
    }));
  }

  // Blocks submit while any picked image is still being downscaled, so a
  // fast tap on Send can't race ahead of it and submit without that image.
  const attachmentsProcessing = attachments.some((a) => a.dataUrl == null && a.error == null);

  function removeAttachment(id: string) {
    setAttachments((prev) => {
      const target = prev.find((a) => a.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((a) => a.id !== id);
    });
  }

  // Revoke any outstanding object URLs when the modal unmounts entirely
  // (it's mounted app-wide, so this only fires on full app teardown). Reads
  // through a ref so the cleanup sees the latest attachments, not a stale
  // closure from mount time.
  const attachmentsRef = useRef(attachments);
  attachmentsRef.current = attachments;
  useEffect(() => () => {
    attachmentsRef.current.forEach((a) => URL.revokeObjectURL(a.previewUrl));
  }, []);

  // #218: close (Cancel / backdrop / Esc) leaves the draft untouched — only
  // the transient success/error UI state is reset. `reset()` is reserved for
  // the post-submit path below. Picked attachments follow the same rule.
  function handleClose() {
    setSubmitted(false);
    setSubmitError(null);
    setAttachmentError(null);
    onClose();
  }

  async function onSubmit(data: FeedbackForm) {
    setSubmitError(null);
    try {
      const attachmentDataUrls = attachments
        .map((a) => a.dataUrl)
        .filter((url): url is string => url != null);
      await submitFeedback({
        category: data.category,
        tool: data.tool,
        message: data.message,
        attachments: attachmentDataUrls.length > 0 ? attachmentDataUrls : undefined,
      });
      setSubmitted(true);
      // Auto-close after 2s, clearing the draft since submission succeeded
      setTimeout(() => {
        reset({ category: 'idea', tool: currentTab, message: '' });
        clearAttachments();
        handleClose();
      }, 2000);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Something went wrong. Please try again.';
      setSubmitError(msg);
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={(isOpen: boolean) => { if (!isOpen) handleClose(); }}
      title="Send Feedback"
      showTitle={false}
      contentClassName={styles.modalContent}
    >
      <div className={styles.modal}>
        <div className={styles.header}>
          <h2 className={styles.title}>Send Feedback</h2>
        </div>

        {submitted ? (
          <div className={styles.successState}>
            <p className={styles.successMsg}>Thanks! Your feedback was sent.</p>
          </div>
        ) : (
          <form className={styles.form} onSubmit={handleSubmit(onSubmit)} noValidate>
            {/* Category select */}
            <div className={styles.field}>
              <label className={styles.label} htmlFor="fb-category">
                Category
              </label>
              <select
                id="fb-category"
                className={styles.select}
                {...register('category', { required: true })}
              >
                <option value="bug">Bug report</option>
                <option value="idea">Feature idea</option>
                <option value="ui">UI</option>
                <option value="other">Other</option>
              </select>
            </div>

            {/* #215: Tool/tab select — required, defaults to the current tab */}
            <div className={styles.field}>
              <label className={styles.label} htmlFor="fb-tool">
                Tool
              </label>
              <select
                id="fb-tool"
                className={styles.select}
                {...register('tool', { required: true })}
              >
                {DEFAULT_ORDER.map((tab) => (
                  <option key={tab} value={tab}>
                    {TAB_LABELS[tab]}
                  </option>
                ))}
                <option value={OTHER_TOOL}>Other / N/A</option>
              </select>
            </div>

            {/* Message textarea */}
            <div className={styles.field}>
              <label className={styles.label} htmlFor="fb-message">
                Message
              </label>
              <textarea
                id="fb-message"
                className={`${styles.textarea} ${errors.message ? styles.textareaError : ''}`}
                placeholder="Tell us what you noticed or what you'd love to see..."
                rows={4}
                {...register('message', {
                  required: 'Please add a message.',
                  minLength: { value: 5, message: 'Message is too short.' },
                  // #266: client-side cap matching the server's limit so the
                  // common overflow case never round-trips to get a 400.
                  maxLength: {
                    value: MESSAGE_MAX_LENGTH,
                    message: 'Message is too long — please keep it under 4000 characters.',
                  },
                })}
              />
              {/* #266: live counter, flips to the error color once over the limit */}
              <span className={`${styles.charCount} ${overLimit ? styles.charCountError : ''}`}>
                {messageLength} / {MESSAGE_MAX_LENGTH}
              </span>
              {errors.message && (
                <span className={styles.fieldError}>{errors.message.message}</span>
              )}
            </div>

            {/* #296/#308: image attachments. A plus button (matching the
                add-ingredient plus) opens the hidden file picker, thumbnails
                render the same as chat attachment previews. */}
            <div className={styles.field}>
              <div className={styles.attachmentsHeaderRow}>
                <label className={styles.label} htmlFor="fb-attachments">
                  Attachments (optional)
                </label>
                <button
                  type="button"
                  className={styles.addAttachmentBtn}
                  onClick={() => fileInputRef.current?.click()}
                  disabled={attachments.length >= MAX_ATTACHMENTS}
                  aria-label="Add attachment"
                >
                  <Plus size={16} aria-hidden="true" style={{ display: 'block' }} />
                </button>
              </div>
              <input
                id="fb-attachments"
                ref={fileInputRef}
                className={styles.visuallyHidden}
                type="file"
                accept="image/*"
                multiple
                disabled={attachments.length >= MAX_ATTACHMENTS}
                onChange={(e) => {
                  handleFilesPicked(e.target.files);
                  e.target.value = '';
                }}
              />
              {attachments.length > 0 && (
                <div className={styles.thumbnails}>
                  {attachments.map((a) => (
                    <div key={a.id} className={styles.thumbnailWrap}>
                      <img src={a.previewUrl} alt="Attachment preview" className={styles.thumbnail} />
                      <button
                        type="button"
                        className={styles.thumbnailRemove}
                        aria-label="Remove attachment"
                        onClick={() => removeAttachment(a.id)}
                      >
                        ✕
                      </button>
                      {a.dataUrl == null && !a.error && (
                        <span className={styles.thumbnailProcessing}>...</span>
                      )}
                      {a.error && (
                        <span className={styles.thumbnailErrorBadge}>!</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {attachments.some((a) => a.error) && (
                <span className={styles.fieldError}>
                  One or more images couldn&apos;t be processed and won&apos;t be sent.
                </span>
              )}
              {attachmentError && (
                <span className={styles.fieldError}>{attachmentError}</span>
              )}
            </div>

            {submitError && (
              <p className={styles.errorMsg}>{submitError}</p>
            )}

            <div className={styles.footer}>
              <button
                className={styles.cancelBtn}
                type="button"
                onClick={handleClose}
                disabled={isSubmitting}
              >
                Cancel
              </button>
              <button
                className={styles.submitBtn}
                type="submit"
                disabled={isSubmitting || attachmentsProcessing}
              >
                {isSubmitting ? 'Sending…' : attachmentsProcessing ? 'Processing…' : 'Send'}
              </button>
            </div>
          </form>
        )}
      </div>
    </Modal>
  );
}
