/**
 * Generic confirm card for propose_mutation — the one cross-domain write
 * proposal covering body weight, habits/tallies, sections, movements,
 * variations, and nutrition goals. Not pretty, but legible and correct:
 * shows the resource, the operation, every field on the payload, and (for a
 * delete) the cascade counts the model was required to gather beforehand.
 */
import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import styles from './MutationProposalCard.module.scss';
import { registerToolRenderer } from '../registry';
import type { ToolRendererProps } from '../registry';
import { executeMutation } from './mutationExecutor';
import { CASCADE_COUNT_FIELDS, CASCADE_COUNT_LABELS, parseMutationType, resourceLabel } from './mutationTypes';
import type { MutationInput } from './mutationTypes';

function humanizeKey(key: string): string {
  return key.replace(/_/g, ' ');
}

function formatValue(value: unknown): string {
  if (value === null) return '(clear)';
  if (value === undefined) return '';
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  return String(value);
}

function summaryLine(input: MutationInput, op: string | undefined): string {
  const label = resourceLabel(parseMutationType(input.type).resource);
  const name = (input.label ?? input.name ?? input.habit_name) as string | undefined;
  const suffix = name ? `: ${name}` : '';
  if (op === 'create') return `Created ${label}${suffix}`;
  if (op === 'delete') return `Deleted ${label}${suffix}`;
  return `Updated ${label}${suffix}`;
}

function MutationProposalCard({ part, resolve }: ToolRendererProps) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const input = (part.state === 'output-available'
    ? (part as { output: unknown }).output
    : (part as { input: unknown }).input) as MutationInput;

  const { resource, op } = parseMutationType(input?.type ?? '');
  const title = `${op ?? 'change'} ${resourceLabel(resource)}`;

  const fieldEntries = Object.entries(input ?? {}).filter(([key]) => key !== 'type');
  const cascadeEntries = fieldEntries.filter(([key]) => CASCADE_COUNT_FIELDS.has(key) && Number(input[key]) > 0);
  const plainEntries = fieldEntries.filter(([key]) => !CASCADE_COUNT_FIELDS.has(key));

  async function handleConfirm() {
    setSubmitting(true);
    setError(null);
    try {
      await executeMutation(input);
      resolve('confirmed', input.type, summaryLine(input, op));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to apply this change.');
    } finally {
      setSubmitting(false);
    }
  }

  function handleDeny() {
    resolve('denied', input.type);
  }

  return (
    <div className={styles.card}>
      <p className={styles.title}>{title}</p>

      {plainEntries.length > 0 && (
        <div className={styles.fields}>
          {plainEntries.map(([key, value]) => (
            <div key={key} className={styles.field}>
              <span className={styles.fieldKey}>{humanizeKey(key)}:</span>
              <span className={styles.fieldValue}>{formatValue(value)}</span>
            </div>
          ))}
        </div>
      )}

      {cascadeEntries.length > 0 && (
        <div className={styles.cascadeWarning}>
          <AlertTriangle size={14} aria-hidden="true" style={{ display: 'block', flexShrink: 0, marginTop: 1 }} />
          <span>
            This also destroys {cascadeEntries
              .map(([key, value]) => `${value} ${CASCADE_COUNT_LABELS[key] ?? key}`)
              .join(' and ')}.
          </span>
        </div>
      )}

      {error && <p className={styles.errorText}>{error}</p>}

      <div className={styles.actions}>
        <button type="button" className={styles.denyBtn} onClick={handleDeny} disabled={submitting}>
          Deny
        </button>
        <button type="button" className={styles.confirmBtn} onClick={handleConfirm} disabled={submitting}>
          {submitting ? 'Applying…' : 'Confirm'}
        </button>
      </div>
    </div>
  );
}

registerToolRenderer('propose_mutation', { kind: 'proposal', Component: MutationProposalCard });

export default MutationProposalCard;
