import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import clientApi from '../api/clientApi.js';
import useAuth from '../hooks/useAuth.js';
import styles from '../styles/ApiKeyModal.module.scss';

function ApiKeyModal({ onClose }) {
  const [keys, setKeys] = useState([]);
  const [loading, setLoading] = useState(true);
  const [label, setLabel] = useState('');
  const [generating, setGenerating] = useState(false);
  const [newKey, setNewKey] = useState(null);
  const [copied, setCopied] = useState(false);
  const { withAuth } = useAuth();

  useEffect(() => {
    fetchKeys();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function fetchKeys() {
    const res = await withAuth(() => clientApi.get('/api/v1/keys'));
    if (res?.data?.data) setKeys(res.data.data);
    setLoading(false);
  }

  async function handleGenerate(e) {
    e.preventDefault();
    if (!label.trim()) return;
    setGenerating(true);
    const res = await withAuth(() => clientApi.post('/api/v1/keys', { label: label.trim() }));
    if (res?.data?.data) {
      setNewKey(res.data.data.key);
      setKeys(prev => [{ id: res.data.data.id, label: label.trim(), created_at: new Date().toISOString(), last_used_at: null }, ...prev]);
      setLabel('');
    }
    setGenerating(false);
  }

  async function handleDelete(id) {
    await withAuth(() => clientApi.delete(`/api/v1/keys/${id}`));
    setKeys(prev => prev.filter(k => k.id !== id));
  }

  async function handleCopy() {
    await navigator.clipboard.writeText(newKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <div className={styles.header}>
          <h2 className={styles.title}>API Keys</h2>
          <button className={styles.closeBtn} onClick={onClose} aria-label="Close">✕</button>
        </div>

        {newKey && (
          <div className={styles.newKeyBox}>
            <p className={styles.newKeyWarning}>⚠ Copy this key now — it won't be shown again.</p>
            <div className={styles.newKeyRow}>
              <code className={styles.newKeyValue}>{newKey}</code>
              <button className={styles.copyBtn} onClick={handleCopy}>
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
          </div>
        )}

        <form className={styles.form} onSubmit={handleGenerate}>
          <input
            className={styles.input}
            type="text"
            placeholder="Key label (e.g. my-script)"
            value={label}
            onChange={e => setLabel(e.target.value)}
            required
          />
          <button className={styles.generateBtn} type="submit" disabled={generating || !label.trim()}>
            {generating ? 'Generating…' : 'Generate'}
          </button>
        </form>

        <div className={styles.keyList}>
          {loading ? (
            <p className={styles.empty}>Loading…</p>
          ) : keys.length === 0 ? (
            <p className={styles.empty}>No API keys yet.</p>
          ) : (
            keys.map(key => (
              <div key={key.id} className={styles.keyItem}>
                <div className={styles.keyInfo}>
                  <span className={styles.keyLabel}>{key.label || <em>unlabeled</em>}</span>
                  <span className={styles.keyMeta}>Created {format(new Date(key.created_at), 'MMM d, yyyy')}</span>
                </div>
                <button className={styles.deleteBtn} onClick={() => handleDelete(key.id)} aria-label="Delete key">✕</button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

export default ApiKeyModal;
