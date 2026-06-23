import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import clientApi from '../api/clientApi.js';
import { useUser } from '../context/UserProvider.jsx';
import Modal from './Modal.jsx';
import styles from '../styles/ApiKeyModal.module.scss';

/**
 * ApiKeyModal — manage public API keys.
 *
 * Props (unchanged):
 *   onClose {fn} — called to close the modal
 *
 * Data logic: unchanged (React Query useQuery/useMutation).
 * Form: migrated to react-hook-form.
 */
function ApiKeyModal({ onClose }) {
  const { user } = useUser();
  const queryClient = useQueryClient();
  const [newKey, setNewKey] = useState(null);
  const [copied, setCopied] = useState(false);

  // react-hook-form for the create-key form
  const { register, handleSubmit, reset, watch, formState: { isSubmitting } } = useForm({
    defaultValues: { label: '' },
  });
  const labelValue = watch('label');

  // ── React Query data logic (untouched) ──────────────────────────────────────

  const { data: keys = [], isLoading: loading } = useQuery({
    queryKey: ['apiKeys'],
    queryFn: async () => {
      const res = await clientApi.get('/v1/keys');
      return res.data.data;
    },
    enabled: !!user,
  });

  const generateMutation = useMutation({
    mutationFn: async (labelValue) => {
      const res = await clientApi.post('/v1/keys', { label: labelValue });
      return res.data.data;
    },
    onSuccess: (data) => {
      setNewKey(data.key);
      reset();
      // Optimistically add new key to cache
      queryClient.setQueryData(['apiKeys'], (prev = []) => [
        { id: data.id, label: data.label ?? labelValue.trim(), created_at: new Date().toISOString(), last_used_at: null },
        ...prev,
      ]);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id) => {
      await clientApi.delete(`/v1/keys/${id}`);
      return id;
    },
    onSuccess: (id) => {
      queryClient.setQueryData(['apiKeys'], (prev = []) => prev.filter(k => k.id !== id));
    },
  });

  // ── Handlers ────────────────────────────────────────────────────────────────

  function onSubmit(data) {
    generateMutation.mutate(data.label.trim());
  }

  function handleDelete(id) {
    deleteMutation.mutate(id);
  }

  async function handleCopy() {
    await navigator.clipboard.writeText(newKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <Modal
      open={true}
      onOpenChange={(isOpen) => { if (!isOpen) onClose(); }}
      title="API Keys"
      showTitle={false}
      contentClassName={styles.modalContent}
    >
      <div className={styles.modal}>
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

        <form className={styles.form} onSubmit={handleSubmit(onSubmit)} noValidate>
          <input
            className={styles.input}
            type="text"
            placeholder="Key label (e.g. my-script)"
            {...register('label', { required: true })}
          />
          <button
            className={styles.generateBtn}
            type="submit"
            disabled={generateMutation.isPending || isSubmitting || !labelValue.trim()}
          >
            {generateMutation.isPending || isSubmitting ? 'Generating…' : 'Generate'}
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
    </Modal>
  );
}

export default ApiKeyModal;
