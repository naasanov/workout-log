import { useState } from 'react';
import { AlertCircle, ChevronRight } from 'lucide-react';
import styles from './AgentChat.module.scss';

// ---------------------------------------------------------------------------
// Disconnect/abort-error detection.
//
// When the user navigates away (or the tab/network drops) mid-stream, the
// streaming fetch behind useChat is aborted. Different browsers surface this
// differently — Safari: Error("Load failed"); Chrome/others: AbortError,
// "network error", "Failed to fetch", "The user aborted a request". The
// server-side run keeps completing normally and the transcript poll/refetch
// recovers the full assistant reply — so this specific class of error is
// spurious noise, not a real failure, and must not be shown as an ErrorBubble.
// ---------------------------------------------------------------------------
const DISCONNECT_ERROR_PATTERNS = [
  'load failed',
  'network error',
  'failed to fetch',
  'aborted',
];

export function isDisconnectError(err: Error | undefined | null): boolean {
  if (!err) return false;
  if (err.name === 'AbortError') return true;
  const message = (err.message || '').toLowerCase();
  return DISCONNECT_ERROR_PATTERNS.some(pattern => message.includes(pattern));
}

// ---------------------------------------------------------------------------
// Error bubble — shown in the chat thread when useChat surfaces an error
// ---------------------------------------------------------------------------
interface ErrorBubbleProps {
  error: Error;
}

export default function ErrorBubble({ error }: ErrorBubbleProps) {
  const [expanded, setExpanded] = useState(false);

  const detail = (() => {
    try {
      const parsed = JSON.parse(error.message);
      return JSON.stringify(parsed, null, 2);
    } catch {
      return error.message || String(error);
    }
  })();

  return (
    <div className={styles.errorBubble}>
      <button
        type="button"
        className={styles.errorBubbleToggle}
        onClick={() => setExpanded(p => !p)}
        aria-expanded={expanded}
      >
        <AlertCircle className={styles.errorBubbleIcon} size={16} aria-hidden="true" />
        <span className={styles.errorBubbleLabel}>Something went wrong</span>
        <ChevronRight
          className={`${styles.errorBubbleChevron} ${expanded ? styles.errorBubbleChevronOpen : ''}`}
          size={16}
          aria-hidden="true"
        />
      </button>
      {expanded && (
        <pre className={styles.errorBubbleDetail}>{detail}</pre>
      )}
    </div>
  );
}
