/**
 * Confirm card for propose_mutation — the one cross-domain write proposal
 * covering body weight, habits/tallies, sections, movements, variations, and
 * nutrition goals. Renders either a single mutation (unchanged from before
 * batching existed) or a batch (`{ mutations: [...] }`, see
 * schemas/mutations.ts) as one reviewable list under one Confirm/Deny.
 * Not pretty, but legible and correct: shows the resource, the operation,
 * every field on the payload, and (for a delete) the cascade counts the
 * model was required to gather beforehand.
 */
import { useState } from 'react';
import { AlertTriangle, Check, X } from 'lucide-react';
import styles from './MutationProposalCard.module.scss';
import { registerToolRenderer } from '../registry';
import type { ToolRendererProps } from '../registry';
import { executeMutation, executeMutationBatch } from './mutationExecutor';
import type { MutationItemResult } from './mutationExecutor';
import {
  CASCADE_COUNT_FIELDS,
  CASCADE_COUNT_LABELS,
  CURRENT_VALUE_PREFIX,
  FIELD_LABELS,
  HIDDEN_ID_FIELDS,
  LEADING_FIELDS,
  PARENT_NAME_FIELDS,
  parseMutationType,
  resourceLabel,
} from './mutationTypes';
import type { MutationInput, MutationBatchInput } from './mutationTypes';

function fieldLabel(key: string): string {
  return FIELD_LABELS[key] ?? key.replace(/_/g, ' ');
}

function formatValue(value: unknown): string {
  if (value === null) return '(clear)';
  if (value === undefined) return '';
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  return String(value);
}

function isBatchInput(input: unknown): input is MutationBatchInput {
  return !!input && typeof input === 'object' && Array.isArray((input as { mutations?: unknown }).mutations);
}

function summaryLine(input: MutationInput, op: string | undefined): string {
  const { resource } = parseMutationType(input.type);
  const name = (input.label ?? input.current_label ?? input.name ?? input.current_name ?? input.habit_name) as string | undefined;
  const parentField = PARENT_NAME_FIELDS[resource];
  const parentName = parentField ? input[parentField] as string | undefined : undefined;
  const suffix = name ? `: ${name}${parentName ? ` in ${parentName}` : ''}` : '';
  const label = resourceLabel(resource);
  if (op === 'create') return `Created ${label}${suffix}`;
  if (op === 'delete') return `Deleted ${label}${suffix}`;
  return `Updated ${label}${suffix}`;
}

interface FieldRow {
  key: string;
  value: string;
}

// One row per user-meaningful field: ids and bookkeeping hidden, a
// current_<field> merged into its <field> row as "old → new", and the
// record's location and name first.
function fieldRows(input: MutationInput): FieldRow[] {
  const visible = Object.keys(input ?? {}).filter(key =>
    key !== 'type' && !HIDDEN_ID_FIELDS.has(key) && !CASCADE_COUNT_FIELDS.has(key));

  const rows = new Map<string, FieldRow>();
  for (const key of visible) {
    const base = key.startsWith(CURRENT_VALUE_PREFIX) ? key.slice(CURRENT_VALUE_PREFIX.length) : key;
    if (rows.has(base)) continue;
    const current = input[CURRENT_VALUE_PREFIX + base];
    const next = input[base];
    const hasCurrent = current !== undefined;
    const hasNext = next !== undefined;
    let value: string;
    if (hasCurrent && hasNext && current !== next) value = `${formatValue(current)} → ${formatValue(next)}`;
    else value = formatValue(hasNext ? next : current);
    rows.set(base, { key: base, value });
  }

  const rank = (key: string) => {
    const index = LEADING_FIELDS.indexOf(key);
    return index === -1 ? LEADING_FIELDS.length : index;
  };
  return [...rows.values()].sort((a, b) => rank(a.key) - rank(b.key));
}

// The field list shared by both the single-mutation and per-batch-item views.
function MutationFields({ input }: { input: MutationInput }) {
  const rows = fieldRows(input);
  const cascadeEntries = Object.entries(input ?? {})
    .filter(([key, value]) => CASCADE_COUNT_FIELDS.has(key) && Number(value) > 0);

  return (
    <>
      {rows.length > 0 && (
        <div className={styles.fields}>
          {rows.map(({ key, value }) => (
            <div key={key} className={styles.field}>
              <span className={styles.fieldKey}>{fieldLabel(key)}:</span>
              <span className={styles.fieldValue}>{value}</span>
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
    </>
  );
}

// ---------------------------------------------------------------------------
// Single mutation
// ---------------------------------------------------------------------------

function SingleMutationCard({ input, resolve }: { input: MutationInput; resolve: ToolRendererProps['resolve'] }) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { resource, op } = parseMutationType(input?.type ?? '');
  const title = `${op ?? 'change'} ${resourceLabel(resource)}`;

  async function handleConfirm() {
    setSubmitting(true);
    setError(null);
    try {
      const result = await executeMutation(input);
      resolve('confirmed', input.type, summaryLine(input, op), result.id !== undefined ? { id: result.id } : undefined);
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

      <MutationFields input={input} />

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

// ---------------------------------------------------------------------------
// Batch
// ---------------------------------------------------------------------------

function batchItemStatus(index: number, results: MutationItemResult[] | null): 'pending' | 'done' | 'failed' | 'skipped' {
  if (!results) return 'pending';
  if (index >= results.length) return 'skipped';
  return results[index].error !== undefined ? 'failed' : 'done';
}

function BatchItem({ item, status, error }: { item: MutationInput; status: 'pending' | 'done' | 'failed' | 'skipped'; error?: string }) {
  const { resource, op } = parseMutationType(item.type);
  const title = `${op ?? 'change'} ${resourceLabel(resource)}`;

  return (
    <li className={styles.batchItem}>
      <div className={styles.batchItemHeader}>
        <span className={styles.batchItemTitle}>{title}</span>
        {status === 'done' && <Check size={14} aria-hidden="true" className={styles.batchItemDone} />}
        {status === 'failed' && <X size={14} aria-hidden="true" className={styles.batchItemFailed} />}
        {status === 'skipped' && <span className={styles.batchItemSkipped}>not attempted</span>}
      </div>
      <MutationFields input={item} />
      {status === 'failed' && error && <p className={styles.errorText}>{error}</p>}
    </li>
  );
}

function BatchMutationCard({ mutations, resolve }: { mutations: MutationInput[]; resolve: ToolRendererProps['resolve'] }) {
  const [submitting, setSubmitting] = useState(false);
  const [results, setResults] = useState<MutationItemResult[] | null>(null);
  const [failed, setFailed] = useState(false);

  async function handleConfirm() {
    setSubmitting(true);
    const outcome = await executeMutationBatch(mutations);
    setSubmitting(false);
    setResults(outcome.results);
    if (outcome.ok) {
      const total = mutations.length;
      resolve('confirmed', 'batch', `Applied ${total} change${total === 1 ? '' : 's'}`, outcome.results);
    } else {
      // Left open rather than auto-resolved: the writes that already
      // happened are real and irreversible, so the user sees exactly what
      // succeeded before this card reports itself as done — see
      // executeMutationBatch's partial-failure doc comment.
      setFailed(true);
    }
  }

  function handleDismissPartial() {
    if (!results) return;
    const succeeded = results.filter(r => r.error === undefined).length;
    resolve('confirmed', 'batch', `Applied ${succeeded} of ${mutations.length} changes (stopped early)`, results);
  }

  function handleDeny() {
    resolve('denied', 'batch');
  }

  return (
    <div className={styles.card}>
      <p className={styles.title}>Apply {mutations.length} changes</p>

      <ul className={styles.batchList}>
        {mutations.map((item, index) => (
          <BatchItem
            key={index}
            item={item}
            status={batchItemStatus(index, results)}
            error={results?.[index]?.error}
          />
        ))}
      </ul>

      {failed && (
        <p className={styles.errorText}>
          Stopped after a failure — the changes above marked done were already applied and were not undone;
          nothing marked "not attempted" was.
        </p>
      )}

      <div className={styles.actions}>
        {failed ? (
          <button type="button" className={styles.confirmBtn} onClick={handleDismissPartial}>
            Dismiss
          </button>
        ) : (
          <>
            <button type="button" className={styles.denyBtn} onClick={handleDeny} disabled={submitting}>
              Deny
            </button>
            <button type="button" className={styles.confirmBtn} onClick={handleConfirm} disabled={submitting}>
              {submitting ? 'Applying…' : 'Confirm'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function MutationProposalCard({ part, resolve }: ToolRendererProps) {
  const rawInput = (part.state === 'output-available'
    ? (part as { output: unknown }).output
    : (part as { input: unknown }).input);

  // A one-item batch has no refs to resolve, so it reads as the single change it is.
  if (isBatchInput(rawInput) && rawInput.mutations.length === 1) {
    return <SingleMutationCard input={rawInput.mutations[0]} resolve={resolve} />;
  }
  if (isBatchInput(rawInput)) {
    return <BatchMutationCard mutations={rawInput.mutations} resolve={resolve} />;
  }

  return <SingleMutationCard input={rawInput as MutationInput} resolve={resolve} />;
}

registerToolRenderer('propose_mutation', { kind: 'proposal', Component: MutationProposalCard });

export default MutationProposalCard;
