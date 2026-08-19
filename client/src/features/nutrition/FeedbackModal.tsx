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
 */
import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useSearchParams } from 'react-router-dom';
import Modal from '../../components/Modal.jsx';
import { submitFeedback } from './api';
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

interface FeedbackForm {
  category: FeedbackCategory;
  tool: string;
  message: string;
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

  // #218: close (Cancel / backdrop / Esc) leaves the draft untouched — only
  // the transient success/error UI state is reset. `reset()` is reserved for
  // the post-submit path below.
  function handleClose() {
    setSubmitted(false);
    setSubmitError(null);
    onClose();
  }

  async function onSubmit(data: FeedbackForm) {
    setSubmitError(null);
    try {
      await submitFeedback({ category: data.category, tool: data.tool, message: data.message });
      setSubmitted(true);
      // Auto-close after 2s, clearing the draft since submission succeeded
      setTimeout(() => {
        reset({ category: 'idea', tool: currentTab, message: '' });
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
                disabled={isSubmitting}
              >
                {isSubmitting ? 'Sending…' : 'Send'}
              </button>
            </div>
          </form>
        )}
      </div>
    </Modal>
  );
}
