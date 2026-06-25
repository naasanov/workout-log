/**
 * ToolCallCard — collapsible card for a single AI tool invocation.
 *
 * Collapsed: tool name + status chip.
 * Expanded: input args + output result (pretty JSON) + one-line friendly summary.
 */
import { useState } from 'react';
import { getToolName } from 'ai';
import type { DynamicToolUIPart, ToolUIPart } from 'ai';
import styles from './ToolCallCard.module.scss';

type AnyToolUIPart = ToolUIPart | DynamicToolUIPart;

// ---- Friendly summary for known tools ----
function toolSummary(toolName: string, input: unknown, output: unknown): string {
  if (toolName === 'search_usda') {
    const q = (input as { query?: string })?.query ?? '';
    const count = Array.isArray(output) ? output.length : 0;
    return `Searched USDA for "${q}" — ${count} result${count !== 1 ? 's' : ''}`;
  }
  if (toolName === 'lookup_barcode') {
    const code = (input as { barcode?: string })?.barcode ?? '';
    const found = output !== null && output !== undefined;
    return `Barcode ${code} — ${found ? 'found' : 'not found'}`;
  }
  if (toolName === 'get_portions') {
    const count = Array.isArray(output) ? output.length : 0;
    return `Fetched ${count} portion${count !== 1 ? 's' : ''}`;
  }
  if (toolName === 'search_food_history') {
    const q = (input as { query?: string })?.query ?? '';
    const count = Array.isArray(output) ? output.length : 0;
    return `History search "${q}" — ${count} match${count !== 1 ? 'es' : ''}`;
  }
  if (toolName === 'get_goals_and_today') {
    return 'Retrieved nutrition goals and today\'s log';
  }
  if (toolName === 'propose_entry') {
    const name = (input as { name?: string })?.name ?? 'entry';
    const meal = (input as { meal?: string })?.meal ?? '';
    return `Proposed ${meal ? meal + ': ' : ''}${name}`;
  }
  return toolName;
}

// ---- Status chip ----
type ChipVariant = 'running' | 'done' | 'error';

interface StatusChipProps {
  state: AnyToolUIPart['state'];
}

function StatusChip({ state }: StatusChipProps) {
  let variant: ChipVariant;
  let label: string;

  if (state === 'input-streaming' || state === 'input-available') {
    variant = 'running';
    label = 'running';
  } else if (state === 'output-available') {
    variant = 'done';
    label = 'done';
  } else if (state === 'output-error') {
    variant = 'error';
    label = 'error';
  } else {
    variant = 'running';
    label = state;
  }

  return (
    <span className={`${styles.chip} ${styles[`chip_${variant}`]}`}>
      {variant === 'running' && (
        <span className={styles.spinner} aria-hidden="true" />
      )}
      {label}
    </span>
  );
}

// ---- Pretty JSON ----
function PrettyJson({ value }: { value: unknown }) {
  if (value === undefined || value === null) return <span className={styles.jsonNull}>—</span>;
  return (
    <pre className={styles.jsonBlock}>
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

// ---- Main component ----
interface ToolCallCardProps {
  part: AnyToolUIPart;
}

export default function ToolCallCard({ part }: ToolCallCardProps) {
  const [expanded, setExpanded] = useState(false);

  const toolName = getToolName(part as ToolUIPart | DynamicToolUIPart);
  const isDone = part.state === 'output-available';
  const isError = part.state === 'output-error';
  const input = (part as { input?: unknown }).input as unknown;
  const output = isDone ? (part as { output: unknown }).output : undefined;
  const errorText = isError ? (part as { errorText: string }).errorText : undefined;

  const summary = (isDone || isError)
    ? toolSummary(toolName, input, output)
    : null;

  return (
    <div className={`${styles.card} ${isError ? styles.cardError : ''}`}>
      <button
        type="button"
        className={styles.header}
        onClick={() => setExpanded(prev => !prev)}
        aria-expanded={expanded}
      >
        <span className={styles.chevron} aria-hidden="true">
          {/* SVG chevron: display:block per iOS SVG rule */}
          <svg
            className={styles.chevronIcon}
            viewBox="0 0 10 6"
            fill="none"
            aria-hidden="true"
          >
            <path
              d={expanded ? 'M1 5l4-4 4 4' : 'M1 1l4 4 4-4'}
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>

        <span className={styles.toolName}>{toolName}</span>

        <StatusChip state={part.state} />

        {summary && !expanded && (
          <span className={styles.summary}>{summary}</span>
        )}
      </button>

      {expanded && (
        <div className={styles.body}>
          <div className={styles.section}>
            <span className={styles.sectionLabel}>Input</span>
            <PrettyJson value={input} />
          </div>
          {isDone && (
            <div className={styles.section}>
              <span className={styles.sectionLabel}>Output</span>
              <PrettyJson value={output} />
            </div>
          )}
          {isError && (
            <div className={styles.section}>
              <span className={styles.sectionLabel}>Error</span>
              <p className={styles.errorText}>{errorText}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
