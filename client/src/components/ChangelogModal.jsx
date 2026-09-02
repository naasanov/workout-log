/**
 * ChangelogModal — "What's new" list, opened from the header icon button.
 * Renders the hand-curated CHANGELOG config as a scrollable list of dated
 * entries. Unread tracking lives in Header, which owns the button.
 *
 * When open, fetches the signed-in user's own submitted-issue numbers and
 * badges any item whose `issues` include one of them. This is deliberately
 * tolerant: signed out, a failed request, or no submissions all render the
 * plain list with no badge and no error (the modal is shown when signed out
 * too — see Header.jsx).
 */
import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import Modal from './Modal.jsx';
import { fetchMySubmittedIssueNumbers } from '../features/nutrition/api';
import { CHANGELOG } from '../config/changelog';
import styles from '../styles/ChangelogModal.module.scss';

// Parses a 'YYYY-MM-DD' string into a local-time Date so date-fns formats
// the same calendar day everywhere, regardless of the viewer's timezone.
function parseEntryDate(dateStr) {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day);
}

// A changelog item is either a plain string or { text, issues }. These
// normalize either shape so rendering doesn't need to branch per-item.
function itemText(item) {
  return typeof item === 'string' ? item : item.text;
}
function itemIssues(item) {
  return typeof item === 'string' ? [] : item.issues ?? [];
}

export default function ChangelogModal({ open, onClose }) {
  // Issue numbers the signed-in user has submitted, for badging. Empty set
  // renders identically to "not fetched yet" — no badges, no error state.
  const [submittedIssues, setSubmittedIssues] = useState(() => new Set());

  useEffect(() => {
    if (!open) return undefined;

    let cancelled = false;
    fetchMySubmittedIssueNumbers().then((numbers) => {
      // fetchMySubmittedIssueNumbers already resolves to [] on any failure
      // (signed out, network hiccup) — this always just sets what it got.
      if (!cancelled) setSubmittedIssues(new Set(numbers));
    });

    return () => {
      cancelled = true;
    };
  }, [open]);

  return (
    <Modal
      open={open}
      onOpenChange={(isOpen) => { if (!isOpen) onClose(); }}
      title="What's New"
      showTitle={false}
      contentClassName={styles.modalContent}
    >
      <div className={styles.modal}>
        <div className={styles.header}>
          <h2 className={styles.title}>What&rsquo;s New</h2>
        </div>

        {CHANGELOG.length === 0 ? (
          <p className={styles.emptyState}>Nothing to show yet.</p>
        ) : (
          <div className={styles.list}>
            {CHANGELOG.map((entry) => (
              <div key={entry.date} className={styles.entry}>
                <div className={styles.entryDate}>
                  {format(parseEntryDate(entry.date), 'MMMM d, yyyy')}
                </div>
                <h3 className={styles.entryTitle}>{entry.title}</h3>
                <ul className={styles.entryItems}>
                  {entry.items.map((item) => {
                    const text = itemText(item);
                    const isMine = itemIssues(item).some((n) => submittedIssues.has(n));
                    return (
                      <li key={text}>
                        {text}
                        {isMine && (
                          <span className={styles.submittedBadge}>You submitted this</span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}
