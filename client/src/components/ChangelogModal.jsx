/**
 * ChangelogModal — "What's new" list, opened from the header icon button.
 * Renders the hand-curated CHANGELOG config as a scrollable list of dated
 * entries. No fetch, no unread tracking — it only shows content when opened.
 */
import { format } from 'date-fns';
import Modal from './Modal.jsx';
import { CHANGELOG } from '../config/changelog';
import styles from '../styles/ChangelogModal.module.scss';

// Parses a 'YYYY-MM-DD' string into a local-time Date so date-fns formats
// the same calendar day everywhere, regardless of the viewer's timezone.
function parseEntryDate(dateStr) {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day);
}

export default function ChangelogModal({ open, onClose }) {
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
                  {entry.items.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}
