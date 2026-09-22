// Modal for editing the user's free-text agent instructions (#382):
// personal preferences folded into the agent's system prompt after the
// stable core/domain sections (see services/agent/prompt/userInstructions.ts).
// Mounted conditionally by its caller (see AgentChat.tsx's gear button), so
// it is always "open" while rendered rather than taking an `open` prop.
import { useEffect, useState } from 'react';
import Modal from '../../components/Modal.jsx';
import { useAgentInstructions, usePutAgentInstructions } from './instructionsApi';
import styles from './AgentInstructionsModal.module.scss';

export interface AgentInstructionsModalProps {
  onClose: () => void;
}

// Mirrors shared/agentInstructions.ts's AGENT_INSTRUCTIONS_MAX_LENGTH -- kept
// as a plain client-side constant since client imports from shared/ must be
// type-only (no server runtime code, zod included, in the client bundle).
const MAX_LENGTH = 1000;

export default function AgentInstructionsModal({ onClose }: AgentInstructionsModalProps) {
  const instructionsQuery = useAgentInstructions();
  const putInstructions = usePutAgentInstructions();

  const [text, setText] = useState('');
  const [saveError, setSaveError] = useState<string | null>(null);

  // Pre-fill once the current value loads.
  useEffect(() => {
    if (instructionsQuery.data) {
      setText(instructionsQuery.data.instructions ?? '');
    }
  }, [instructionsQuery.data]);

  const overLimit = text.length > MAX_LENGTH;
  const isPending = putInstructions.isPending;
  const isLoading = instructionsQuery.isLoading;

  async function handleSave() {
    if (overLimit) return;
    setSaveError(null);
    try {
      await putInstructions.mutateAsync(text);
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to save instructions.';
      setSaveError(msg);
    }
  }

  return (
    <Modal
      open
      onOpenChange={(isOpen: boolean) => { if (!isOpen) onClose(); }}
      title="Agent Instructions"
      showTitle={false}
      contentClassName={styles.modalContent}
    >
      <div className={styles.modal}>
        <div className={styles.header}>
          <h2 className={styles.title}>Agent Instructions</h2>
        </div>

        <p className={styles.hint}>
          Tell the agent how you would like it to respond -- tone, units, level of detail,
          anything else you want it to default to. These are preferences, not rules: they
          cannot override how the agent works, and it still only proposes changes for you
          to confirm.
        </p>

        {isLoading ? (
          <p className={styles.loadingState}>Loading...</p>
        ) : instructionsQuery.isError ? (
          <p className={styles.errorMsg}>Failed to load your instructions. Please try again.</p>
        ) : (
          <div className={styles.field}>
            <label className={styles.label} htmlFor="agent-instructions-textarea">
              Your instructions
            </label>
            <textarea
              id="agent-instructions-textarea"
              className={`${styles.textarea} ${overLimit ? styles.textareaError : ''}`}
              placeholder="e.g. Keep responses brief. Use lbs, not kg."
              value={text}
              onChange={e => setText(e.target.value)}
              rows={6}
            />
            <span className={`${styles.charCount} ${overLimit ? styles.charCountError : ''}`}>
              {text.length} / {MAX_LENGTH}
            </span>
          </div>
        )}

        {saveError && (
          <p className={styles.errorMsg}>{saveError}</p>
        )}

        <div className={styles.footer}>
          <button
            className={styles.cancelBtn}
            type="button"
            onClick={onClose}
            disabled={isPending}
          >
            Cancel
          </button>
          <button
            className={styles.saveBtn}
            type="button"
            onClick={handleSave}
            disabled={isPending || isLoading || overLimit}
          >
            {isPending ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
