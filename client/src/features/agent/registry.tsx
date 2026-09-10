/**
 * Tool/part renderer registry — how a domain plugs its own UI into the
 * generic chat shell without features/agent ever importing anything
 * domain-specific.
 *
 * A tool call renders via `registerToolRenderer(name, ...)`:
 *  - kind 'proposal': an unresolved actionable card (confirm/deny) while
 *    input/output is available; once resolved, AgentChat itself renders a
 *    generic "declined" / confirmed-summary line instead of the component.
 *  - kind 'view': a read-only presentation of the tool's output, shown once
 *    output is available.
 *  - kind 'hidden': never rendered at all, and never counted as a process
 *    step (e.g. deterministic background helpers).
 * A tool with no registration falls back to the generic ToolCallCard.
 *
 * A non-tool message part (e.g. a `data-*` UI part) renders via
 * `registerPartRenderer(partType, ...)`. An unregistered part type that
 * isn't one of the built-ins (text/file/data-imageRedacted) is hidden.
 */
import type { ToolUIPart, DynamicToolUIPart, UIMessage } from 'ai';

export type AnyToolUIPart = ToolUIPart | DynamicToolUIPart;

/** Where in the app the chat is open, and what it's currently looking at. */
export interface AgentChatContext {
  tab?: string;
  selectedDate?: string;
  focusedResource?: { type: string; id: string | number };
}

/** A resolved proposal's outcome, keyed by toolCallId in AgentChat's resolution map. */
export interface ProposalResolutionState {
  kind: string;
  status: 'confirmed' | 'denied';
  displayName: string | null;
}

export interface ToolRendererProps {
  part: AnyToolUIPart;
  toolCallId: string;
  context: AgentChatContext;
  /** Set once this proposal has been confirmed or denied; undefined while pending. */
  resolution: ProposalResolutionState | undefined;
  /**
   * Records this proposal's outcome — persists to the server (best-effort)
   * and updates the local resolution map. `kind` is a free-form resource tag
   * (e.g. "entry", "section.delete") stored alongside the resolution.
   * `result` is an optional structured outcome (e.g. `{ id }`, or an array
   * of those for a batch) that feeds the agent's next turn — see
   * routes/chat.ts's POST /conversations/:id/resolutions.
   */
  resolve: (status: 'confirmed' | 'denied', kind: string, displayName?: string | null, result?: unknown) => void;
}

export type ToolRendererComponent = (props: ToolRendererProps) => React.ReactNode;

export type ToolRendererKind = 'proposal' | 'view' | 'hidden';

export interface ToolRendererRegistration {
  kind: ToolRendererKind;
  // Absent when kind === 'hidden' — there is nothing to render.
  Component?: ToolRendererComponent;
}

export interface PartRendererProps {
  part: UIMessage['parts'][number];
  index: number;
  context: AgentChatContext;
}

export type PartRendererComponent = (props: PartRendererProps) => React.ReactNode;

const toolRegistry = new Map<string, ToolRendererRegistration>();
const partRegistry = new Map<string, PartRendererComponent>();

/** Registers how a tool call renders in the timeline. Call once at module load. */
export function registerToolRenderer(toolName: string, registration: ToolRendererRegistration): void {
  toolRegistry.set(toolName, registration);
}

export function getToolRendererRegistration(toolName: string): ToolRendererRegistration | undefined {
  return toolRegistry.get(toolName);
}

/** Registers how a non-tool message part type (e.g. a data-* part) renders inline. */
export function registerPartRenderer(partType: string, Component: PartRendererComponent): void {
  partRegistry.set(partType, Component);
}

export function getPartRenderer(partType: string): PartRendererComponent | undefined {
  return partRegistry.get(partType);
}
