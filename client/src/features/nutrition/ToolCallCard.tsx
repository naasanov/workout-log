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

export function friendlyToolName(rawName: string): string {
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

// ---------------------------------------------------------------------------
// Food-result rendering — search_foods / search_foods_batch (FoodSearchResult,
// source: usda/off/custom/manual/unc) and the UNC-specific tools
// (search_unc_foods / get_unc_food, whose UncFoodResult shape has no `source`
// field at all — it's implied by the tool, always UNC). Tool output is
// `unknown` (whatever JSON the server tool returned), and UncFoodResult is a
// server-only type (services/nutrition/unc/index.ts) this client file must
// not depend on — so results are recognized by duck-typing at runtime rather
// than imported types.
// ---------------------------------------------------------------------------
type AnyRecord = Record<string, unknown>;

function isRecord(x: unknown): x is AnyRecord {
  return !!x && typeof x === 'object' && !Array.isArray(x);
}

interface FoodResultLike {
  name: string;
  source: string; // 'usda' | 'off' | 'custom' | 'manual' | 'unc'
  per100g?: { calories: number } | null;
  per_serving?: { calories: number } | null;
  serving_label?: string | null;
}

interface UncAvailabilityLike {
  location_name: string;
  meal_period: string;
}

interface UncResultLike {
  recipe_number: number;
  name: string;
  serving_label: string | null;
  per_serving?: { calories: number | null } | null;
  availability?: UncAvailabilityLike[];
}

function isUncResultLike(x: unknown): x is UncResultLike {
  return isRecord(x) && typeof x.recipe_number === 'number' && typeof x.name === 'string';
}

function isFoodResultLike(x: unknown): x is FoodResultLike {
  return isRecord(x) && typeof x.name === 'string' && typeof x.source === 'string';
}

type ResultLike = FoodResultLike | UncResultLike;

/** Try to pull a flat list of food/UNC results out of a tool's output, across
 *  every shape these tools actually return: a bare array (search_foods), a
 *  `{ results: [...] }` wrapper (search_unc_foods), a single object
 *  (get_unc_food), or search_foods_batch's `[{ query, results: [...] }, ...]`.
 *  Returns null when the output doesn't look like any of those — callers fall
 *  back to the raw JSON view. */
function extractResultItems(output: unknown): ResultLike[] | null {
  if (Array.isArray(output)) {
    if (output.length === 0) return null;
    if (output.every(isUncResultLike)) return output as UncResultLike[];
    if (output.every(isFoodResultLike)) return output as FoodResultLike[];
    // search_foods_batch: [{ query, results: FoodSearchResult[] }, ...]
    if (output.every(o => isRecord(o) && Array.isArray((o as AnyRecord).results))) {
      const flattened = (output as AnyRecord[]).flatMap(o => o.results as unknown[]);
      return flattened.length > 0 && flattened.every(isFoodResultLike)
        ? (flattened as FoodResultLike[])
        : null;
    }
    return null;
  }
  if (isRecord(output)) {
    if (Array.isArray(output.results)) {
      const arr = output.results;
      if (arr.length > 0 && arr.every(isUncResultLike)) return arr as UncResultLike[];
      if (arr.length > 0 && arr.every(isFoodResultLike)) return arr as FoodResultLike[];
      return null;
    }
    // get_unc_food: a single UncFoodResult (get_unc_food returns null, not an
    // object, when nothing matched — isRecord already excludes that case).
    if (isUncResultLike(output)) return [output];
  }
  return null;
}

const SOURCE_BADGE_LABEL: Record<string, string> = {
  usda: 'USDA',
  off: 'OFF',
  custom: 'Custom',
  manual: 'Manual',
  unc: 'UNC',
};

const SOURCE_BADGE_COLOR: Record<string, string> = {
  usda: '#4a7c59',
  off: '#3a6ea5',
  custom: '#8a5cb8',
  manual: '#6b6b6b',
  unc: '#a5673a',
};

function SourceBadge({ source }: { source: string }) {
  const label = SOURCE_BADGE_LABEL[source] ?? source.toUpperCase();
  const color = SOURCE_BADGE_COLOR[source] ?? '#6b6b6b';
  return (
    <span
      className={styles.sourceBadge}
      style={{ color, backgroundColor: `${color}22` }}
    >
      {label}
    </span>
  );
}

function caloriesLabel(item: FoodResultLike): string {
  if (item.per100g) return `${Math.round(item.per100g.calories)} kcal/100g`;
  if (item.per_serving) {
    return item.serving_label
      ? `${Math.round(item.per_serving.calories)} kcal / ${item.serving_label}`
      : `${Math.round(item.per_serving.calories)} kcal/serving`;
  }
  return '';
}

/** "Location · meal period", plus a "+N more" count when the item is served
 *  in more than one place — availability is the full list, not just one. */
function availabilityLabel(availability?: UncAvailabilityLike[]): string | null {
  if (!availability || availability.length === 0) return null;
  const [first, ...rest] = availability;
  const base = `${first.location_name} · ${first.meal_period}`;
  return rest.length > 0 ? `${base} (+${rest.length} more)` : base;
}

/** One food/UNC result row: source badge, name, and whatever secondary detail
 *  applies — per-100g/per-serving calories for a general food result, or
 *  serving label + location/meal period for a UNC result. */
function ResultRow({ item }: { item: ResultLike }) {
  const isUnc = isUncResultLike(item);
  const detail = isUnc
    ? [item.serving_label, availabilityLabel(item.availability)].filter(Boolean).join(' · ')
    : caloriesLabel(item);
  return (
    <li className={styles.resultRow}>
      <div className={styles.resultRowTop}>
        <SourceBadge source={isUnc ? 'unc' : (item as FoodResultLike).source} />
        <span className={styles.resultName}>{item.name}</span>
      </div>
      {detail && (
        <span className={styles.resultDetail}>{detail}</span>
      )}
    </li>
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
  const resultItems = isDone ? extractResultItems(output) : null;

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
        {/* Food-search / UNC-dining tool outputs get a friendly badged list
            (source badge + name + serving/location detail) instead of raw
            JSON when the shape is recognized; anything else still falls back
            to the plain PrettyJson dump. */}
        {isDone && resultItems && resultItems.length > 0 && (
          <div className={styles.section}>
            <span className={styles.sectionLabel}>Results</span>
            <ul className={styles.resultsList}>
              {resultItems.map((item, i) => (
                <ResultRow key={i} item={item} />
              ))}
            </ul>
          </div>
        )}
        {isDone && !(resultItems && resultItems.length > 0) && (
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
