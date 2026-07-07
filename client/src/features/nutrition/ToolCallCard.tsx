/**
 * ToolCallCard — collapsible card for a single AI tool invocation.
 *
 * Collapsed: single muted line — small icon + tool label + inline spinner while
 * running, resolves to just the label (no chip/done text) when done.
 * Expanded: input args + output result (pretty JSON). Input hidden if empty/`{}`.
 *
 * Polish changes:
 * 6.  No horizontal scroll on mobile — overflow-wrap + contained JSON <pre>.
 * 7.  Consistent font sizes — explicit px on both name and description.
 * 8.  Human-readable tool names via TOOL_LABEL_MAP; title-case fallback.
 * 11. Compact Codex-style collapsed state — no border/card, single muted line.
 * 13. Hide empty input — don't render input section when input is empty / `{}`.
 */
import { useRef, useState } from 'react';
import { getToolName } from 'ai';
import type { DynamicToolUIPart, ToolUIPart } from 'ai';
import styles from './ToolCallCard.module.scss';
import { ChevronDown } from 'lucide-react';

type AnyToolUIPart = ToolUIPart | DynamicToolUIPart;

// ---- Item 8: Human-readable tool name map ----
const TOOL_LABEL_MAP: Record<string, string> = {
  search_usda: 'Food search',
  search_foods: 'Food search',
  search_foods_batch: 'Food search',
  lookup_barcode: 'Barcode lookup',
  get_portions: 'Serving sizes',
  get_portions_batch: 'Serving sizes',
  search_food_history: 'Food history',
  search_food_history_batch: 'Food history',
  get_goals_and_today: 'Goals & today',
  convert_units: 'Unit conversion',
  convert_to_grams: 'Unit conversion',
  web_search: 'Web search',
  web_search_preview: 'Web search',
  propose_entry: 'Propose entry',
  propose_custom_food: 'Save custom food',
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

// ---- Item 13: detect empty input ----
function isEmptyInput(input: unknown): boolean {
  if (input === undefined || input === null) return true;
  if (typeof input === 'object' && !Array.isArray(input)) {
    return Object.keys(input as object).length === 0;
  }
  return false;
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

// ---- Animated expand/collapse body ----
interface AnimatedBodyProps {
  expanded: boolean;
  children: React.ReactNode;
}

function AnimatedBody({ expanded, children }: AnimatedBodyProps) {
  const innerRef = useRef<HTMLDivElement>(null);

  return (
    <div
      className={`${styles.bodyWrapper} ${expanded ? styles.bodyWrapperOpen : ''}`}
      style={
        expanded
          ? { maxHeight: innerRef.current ? innerRef.current.scrollHeight + 'px' : '800px' }
          : { maxHeight: '0px' }
      }
      aria-hidden={!expanded}
    >
      <div ref={innerRef} className={styles.body}>
        {children}
      </div>
    </div>
  );
}

// ---- Main component ----
interface ToolCallCardProps {
  part: AnyToolUIPart;
}

export default function ToolCallCard({ part }: ToolCallCardProps) {
  const [expanded, setExpanded] = useState(false);

  const rawToolName = getToolName(part as ToolUIPart | DynamicToolUIPart);
  const displayName = friendlyToolName(rawToolName);

  const isRunning = part.state === 'input-streaming' || part.state === 'input-available';
  const isDone = part.state === 'output-available';
  const isError = part.state === 'output-error';

  const input = (part as { input?: unknown }).input as unknown;
  const output = isDone ? (part as { output: unknown }).output : undefined;
  const errorText = isError ? (part as { errorText: string }).errorText : undefined;

  const hasEmptyInput = isEmptyInput(input);

  return (
    <div className={`${styles.card} ${isError ? styles.cardError : ''}`}>
      {/* Item 11: single muted collapsed line */}
      <button
        type="button"
        className={styles.header}
        onClick={() => setExpanded(prev => !prev)}
        aria-expanded={expanded}
      >
        {/* Expand chevron */}
        <ChevronDown
          className={`${styles.chevronIcon} ${expanded ? styles.chevronOpen : ''}`}
          size={16}
          aria-hidden="true"
        />

        {/* Item 11: tool label — always shown */}
        <span className={styles.toolName}>{displayName}</span>

        {/* Item 11: inline spinner while running — disappears when done/error */}
        {isRunning && (
          <span className={styles.spinner} aria-hidden="true" />
        )}

        {/* Error indicator only */}
        {isError && (
          <span className={styles.errorBadge} aria-label="error">!</span>
        )}
      </button>

      {/* Animated expand/collapse */}
      <AnimatedBody expanded={expanded}>
        {/* Item 13: skip input section if empty */}
        {!hasEmptyInput && (
          <div className={styles.section}>
            <span className={styles.sectionLabel}>Input</span>
            <PrettyJson value={input} />
          </div>
        )}
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
      </AnimatedBody>
    </div>
  );
}
