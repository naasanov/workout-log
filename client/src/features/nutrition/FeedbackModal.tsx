/**
 * FeedbackModal — item #1.
 * A small Radix Dialog + react-hook-form that lets users send feedback.
 * Category: bug / idea / other. Message: textarea.
 * On submit: calls submitFeedback() from api.ts.
 * Shows a brief thank-you state, then auto-closes after 2s.
 */
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import Modal from '../../components/Modal.jsx';
import { submitFeedback } from './api';
import styles from './FeedbackModal.module.scss';

interface FeedbackModalProps {
  open: boolean;
  onClose: () => void;
}

type FeedbackCategory = 'bug' | 'idea' | 'other';

interface FeedbackForm {
  category: FeedbackCategory;
  message: string;
}

export default function FeedbackModal({ open, onClose }: FeedbackModalProps) {
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FeedbackForm>({
    defaultValues: { category: 'idea', message: '' },
  });

  function handleClose() {
    reset();
    setSubmitted(false);
    setSubmitError(null);
    onClose();
  }

  async function onSubmit(data: FeedbackForm) {
    setSubmitError(null);
    try {
      await submitFeedback({ category: data.category, message: data.message });
      setSubmitted(true);
      // Auto-close after 2s
      setTimeout(() => {
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
                <option value="other">Other</option>
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
                })}
              />
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
