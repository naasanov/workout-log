/**
 * ToolCallCard — collapsible card for a single AI tool invocation.
 *
 * Collapsed: tool name + status chip + summary.
 * Expanded: input args + output result (pretty JSON) + one-line friendly summary.
 *
 * Polish changes:
 * 6. No horizontal scroll on mobile — overflow-wrap + contained JSON <pre>.
 * 7. Consistent font sizes — explicit px on both name and description.
 * 8. Human-readable tool names via TOOL_LABEL_MAP; title-case fallback.
 */
import { useState } from 'react';
import { getToolName } from 'ai';
import type { DynamicToolUIPart, ToolUIPart } from 'ai';
import styles from './ToolCallCard.module.scss';

type AnyToolUIPart = ToolUIPart | DynamicToolUIPart;

// ---- Item 8: Human-readable tool name map ----
const TOOL_LABEL_MAP: Record<string, string> = {
  search_usda: 'USDA search',
  search_foods_batch: 'USDA search',
  lookup_barcode: 'Barcode lookup',
  get_portions: 'Serving sizes',
  search_food_history: 'Food history',
  get_goals_and_today: 'Goals & today',
  convert_units: 'Unit conversion',
  convert_to_grams: 'Unit conversion',
  web_search: 'Web search',
  web_search_preview: 'Web search',
  propose_entry: 'Propose entry',
};

/** Convert snake_case / camelCase to Title Case as a fallback. */
function toTitleCase(name: string): string {
  return name
    .replace(/[_-]/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, c => c.toUpperCase());
}

function friendlyToolName(rawName: string): string {
  return TOOL_LABEL_MAP[rawName] ?? toTitleCase(rawName);
}

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
  return '';
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

// ---- Pretty JSON (item 6: scrolls within its own box) ----
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

  const rawToolName = getToolName(part as ToolUIPart | DynamicToolUIPart);
  // Item 8: use friendly label in UI; keep raw name for summary lookup
  const displayName = friendlyToolName(rawToolName);

  const isDone = part.state === 'output-available';
  const isError = part.state === 'output-error';
  const input = (part as { input?: unknown }).input as unknown;
  const output = isDone ? (part as { output: unknown }).output : undefined;
  const errorText = isError ? (part as { errorText: string }).errorText : undefined;

  const summary = (isDone || isError)
    ? toolSummary(rawToolName, input, output)
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

        {/* Item 8: show friendly name */}
        <span className={styles.toolName}>{displayName}</span>

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
