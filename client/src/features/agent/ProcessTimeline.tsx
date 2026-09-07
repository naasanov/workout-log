/**
 * The process timeline — collapses a message's reasoning/tool-call steps
 * into one collapsible control instead of one card per step.
 *
 * - Adjacent reasoning parts merge into a single block (mergeReasoningParts)
 *   so the model's "think, think some more" pattern reads as one bubble.
 * - Consecutive tool-call/reasoning steps group into a single cluster
 *   (groupPartsForRender) — text/attachments/actionable proposals are never
 *   part of a cluster; they always render inline via the caller.
 * - While streaming, the collapsed line shows only the current step's title,
 *   sliding up ("conveyor") as each new step starts. Once done, it reads
 *   "N steps". Expanding reveals the full ordered list.
 */
import { useRef, useState } from 'react';
import { isToolUIPart, getToolName } from 'ai';
import type { UIMessage, ToolUIPart, DynamicToolUIPart } from 'ai';
import ReactMarkdown from 'react-markdown';
import { ChevronDown } from 'lucide-react';
import styles from './AgentChat.module.scss';
import ToolCallCard, { friendlyToolName } from './ToolCallCard';
import { stripCitationTokens } from './citations';
import { getPartRenderer, getToolRendererRegistration } from './registry';
import type { ProposalResolutionState } from './registry';

type AnyToolUIPart = ToolUIPart | DynamicToolUIPart;

// ---------------------------------------------------------------------------
// Reasoning collapsible — animated like ToolCallCard
// ---------------------------------------------------------------------------
interface ReasoningBubbleProps {
  text: string;
  streaming: boolean;
}

export function ReasoningBubble({ text, streaming }: ReasoningBubbleProps) {
  const [open, setOpen] = useState(false);
  const innerRef = useRef<HTMLDivElement>(null);

  if (!streaming && !text.trim()) return null;

  return (
    <div className={styles.reasoning}>
      {/* Collapsed header matches ToolCallCard's .header styling */}
      <button
        type="button"
        className={styles.reasoningToggle}
        onClick={() => setOpen(p => !p)}
        aria-expanded={open}
      >
        <ChevronDown
          className={`${styles.reasoningChevron} ${open ? styles.reasoningChevronOpen : ''}`}
          size={16}
          aria-hidden="true"
          style={{ display: 'block' }}
        />
        {streaming ? 'Thinking…' : 'Reasoning'}
        {streaming && <span className={styles.reasoningSpinner} aria-hidden="true" />}
      </button>

      {/* Animated body — max-height transition, same technique as ToolCallCard */}
      <div
        className={`${styles.reasoningBody} ${open ? styles.reasoningBodyOpen : ''}`}
        style={
          open
            ? { maxHeight: innerRef.current ? innerRef.current.scrollHeight + 'px' : '800px' }
            : { maxHeight: '0px' }
        }
        aria-hidden={!open}
      >
        <div ref={innerRef} className={styles.reasoningText}>
          <ReactMarkdown>{stripCitationTokens(text)}</ReactMarkdown>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Merge adjacent reasoning parts in a message into a single combined block
// ---------------------------------------------------------------------------
export type MergedPart =
  | { type: 'merged-reasoning'; text: string; streaming: boolean; originalIndices: number[] }
  | { type: 'other'; part: UIMessage['parts'][number]; originalIndex: number };

export function mergeReasoningParts(parts: UIMessage['parts']): MergedPart[] {
  const result: MergedPart[] = [];

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part.type === 'reasoning') {
      const texts: string[] = [part.text];
      const indices: number[] = [i];
      const isStreaming = part.state === 'streaming';
      let mergedStreaming = isStreaming;

      while (i + 1 < parts.length && parts[i + 1].type === 'reasoning') {
        i++;
        const next = parts[i] as { type: 'reasoning'; text: string; state?: string };
        texts.push(next.text);
        indices.push(i);
        if (next.state === 'streaming') mergedStreaming = true;
      }

      result.push({
        type: 'merged-reasoning',
        text: texts.join('\n\n'),
        streaming: mergedStreaming,
        originalIndices: indices,
      });
    } else {
      result.push({ type: 'other', part, originalIndex: i });
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Group parts into single-render items and clusters, using the tool/part
// renderer registry (features/agent/registry.tsx) to decide classification
// instead of hardcoding tool names — a domain's registration decides whether
// its tool renders inline, hidden, or as a plain clustered step.
// ---------------------------------------------------------------------------
export type RenderGroup =
  | { kind: 'cluster'; items: MergedPart[]; groupKey: string }
  | { kind: 'single'; merged: MergedPart; groupKey: string };

function classifyMergedPart(
  merged: MergedPart,
  resolutions: Map<string, ProposalResolutionState>,
  readOnly = false,
): 'cluster' | 'inline' | 'hidden' {
  if (merged.type === 'merged-reasoning') {
    // An empty reasoning block that's finished streaming renders nothing
    // (ReasoningBubble returns null) — hide it so it doesn't inflate the
    // "N steps" count or leave a phantom step. Still show it while streaming.
    return merged.text.trim() || merged.streaming ? 'cluster' : 'hidden';
  }

  const { part } = merged;
  if (!isToolUIPart(part)) {
    // Only genuinely visible, always-shown parts are 'inline'. Everything else
    // (e.g. AI SDK 'step-start' boundary markers, empty text) is 'hidden' so it
    // neither renders nor fragments the single process timeline.
    if (part.type === 'text') return part.text ? 'inline' : 'hidden';
    if (part.type === 'file' || part.type === 'data-imageRedacted') return 'inline';
    if (getPartRenderer(part.type)) return 'inline';
    return 'hidden';
  }

  const toolName = getToolName(part as AnyToolUIPart);
  const toolCallId = (part as { toolCallId: string }).toolCallId;
  const registration = getToolRendererRegistration(toolName);

  if (!registration) return 'cluster'; // no renderer registered — plain ToolCallCard step
  if (registration.kind === 'hidden') return 'hidden';

  // Once resolved (confirmed/denied), the outcome renders as a single inline
  // line rather than the tool's own card — see ChatMessage.
  if (resolutions.has(toolCallId)) return 'inline';

  if (registration.kind === 'proposal') {
    // A read-only (archived-conversation) view never mounts an actionable
    // proposal card (confirm/deny only makes sense in a live chat), so an
    // unresolved proposal always renders as a plain ToolCallCard step there.
    if (readOnly) return 'cluster';
    // Not yet resolved into args — renders as a plain ToolCallCard, so it's
    // just another step in the chain until the proposal is actually ready.
    return part.state === 'input-available' || part.state === 'output-available' ? 'inline' : 'cluster';
  }

  // 'view' — only worth showing once there's output to view.
  return part.state === 'output-available' ? 'inline' : 'cluster';
}

export function groupPartsForRender(
  mergedParts: MergedPart[],
  resolutions: Map<string, ProposalResolutionState>,
  readOnly = false,
): RenderGroup[] {
  const groups: RenderGroup[] = [];
  // All process steps (reasoning + tool calls) across the whole message collapse
  // into ONE timeline, not one-per-contiguous-run. The first cluster-eligible
  // part creates the single cluster (placed at that position); every later
  // cluster part is appended to that same cluster even if inline parts (the
  // proposal card, final text) appear between them. In practice the process runs
  // first and the proposal/answer follow, so this reads top-to-bottom naturally.
  let cluster: { kind: 'cluster'; items: MergedPart[]; groupKey: string } | null = null;

  for (const merged of mergedParts) {
    const cls = classifyMergedPart(merged, resolutions, readOnly);
    if (cls === 'hidden') continue;

    if (cls === 'cluster') {
      if (!cluster) {
        cluster = { kind: 'cluster', items: [], groupKey: `cluster-${clusterItemKey(merged)}` };
        groups.push(cluster);
      }
      cluster.items.push(merged);
    } else {
      const key = merged.type === 'merged-reasoning' ? `r${merged.originalIndices[0]}` : `s${merged.originalIndex}`;
      groups.push({ kind: 'single', merged, groupKey: `single-${key}` });
    }
  }

  return groups;
}

export function clusterItemKey(merged: MergedPart): string {
  return merged.type === 'merged-reasoning' ? `r${merged.originalIndices[0]}` : `t${merged.originalIndex}`;
}

function renderClusterItem(merged: MergedPart, isStreamingThis: boolean): React.ReactNode {
  if (merged.type === 'merged-reasoning') {
    return (
      <ReasoningBubble
        key={clusterItemKey(merged)}
        text={merged.text}
        streaming={merged.streaming && isStreamingThis}
      />
    );
  }
  return (
    <ToolCallCard
      key={clusterItemKey(merged)}
      part={merged.part as AnyToolUIPart}
    />
  );
}

// Title shown for a single step in the timeline — reasoning reads "Thinking…"
// while it streams, "Reasoning" once settled; tool calls use their friendly name.
function stepTitle(merged: MergedPart, streaming: boolean): string {
  if (merged.type === 'merged-reasoning') {
    return streaming && merged.streaming ? 'Thinking…' : 'Reasoning';
  }
  return friendlyToolName(getToolName(merged.part as AnyToolUIPart));
}

export interface ProcessTimelineProps {
  items: MergedPart[];
  isStreamingThis: boolean;
}

// One unified, collapsible timeline for a message's whole reasoning/tool-call
// process.
//
// - During execution: the collapsed line shows ONLY the current (last) step's
//   title; each new step replaces it with a slide-up "conveyor" animation.
// - After execution: the collapsed line reads "N steps".
// - Expanding (either state) reveals the full ordered list; new steps append
//   below while streaming. Each list item is itself a single-level collapsible
//   (reasoning → text, or tool → input/output) — no redundant nested wrapper.
// - The body uses the grid 0fr→1fr auto-height technique (not a clamped
//   max-height), so nested item expansions are never clipped — the thread scrolls.
export function ProcessTimeline({ items, isStreamingThis }: ProcessTimelineProps) {
  const [open, setOpen] = useState(false);

  if (items.length === 0) return null;

  const currentIndex = items.length - 1;
  const current = items[currentIndex];
  const collapsedLabel = isStreamingThis
    ? stepTitle(current, true)
    : `${items.length} step${items.length !== 1 ? 's' : ''}`;

  return (
    <div className={styles.toolCluster}>
      <button
        type="button"
        className={styles.reasoningToggle}
        onClick={() => setOpen(p => !p)}
        aria-expanded={open}
      >
        <ChevronDown
          className={`${styles.reasoningChevron} ${open ? styles.reasoningChevronOpen : ''}`}
          size={16}
          aria-hidden="true"
          style={{ display: 'block' }}
        />
        <span className={styles.timelineLabelViewport}>
          {/* Keyed by the current step while streaming so React remounts the
              label and re-plays the slide-up "conveyor" animation on each step. */}
          <span
            key={isStreamingThis ? `step-${currentIndex}` : 'done'}
            className={isStreamingThis ? styles.timelineLabelLive : styles.timelineLabel}
          >
            {collapsedLabel}
          </span>
        </span>
        {isStreamingThis && <span className={styles.reasoningSpinner} aria-hidden="true" />}
      </button>

      <div
        className={`${styles.timelineBody} ${open ? styles.timelineBodyOpen : ''}`}
        aria-hidden={!open}
      >
        <div className={styles.timelineBodyInner}>
          {items.map(m => renderClusterItem(m, isStreamingThis))}
        </div>
      </div>
    </div>
  );
}
