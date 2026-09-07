/**
 * One message bubble group — dispatches each part to the right renderer:
 * text/markdown, an attached image, a redacted-image marker, a registered
 * data-part renderer (e.g. nutrition's barcode chip), or a registered tool
 * renderer (proposal/view) via the registry in registry.tsx. Anything left
 * over folds into the collapsible ProcessTimeline.
 */
import { isToolUIPart, getToolName } from 'ai';
import type { UIMessage, ToolUIPart, DynamicToolUIPart } from 'ai';
import ReactMarkdown from 'react-markdown';
import { ImageOff } from 'lucide-react';
import styles from './AgentChat.module.scss';
import { stripCitationTokens } from './citations';
import {
  mergeReasoningParts,
  groupPartsForRender,
  ProcessTimeline,
  ReasoningBubble,
  clusterItemKey,
  MergedPart,
} from './ProcessTimeline';
import { getPartRenderer, getToolRendererRegistration } from './registry';
import type { AgentChatContext, ProposalResolutionState } from './registry';

type AnyToolUIPart = ToolUIPart | DynamicToolUIPart;

export interface ChatMessageProps {
  message: UIMessage;
  isLastAssistant: boolean;
  isStreaming: boolean;
  context: AgentChatContext;
  resolutions: Map<string, ProposalResolutionState>;
  resolveProposal: (toolCallId: string, status: 'confirmed' | 'denied', kind: string, displayName?: string | null) => void;
}

export default function ChatMessage({
  message,
  isLastAssistant,
  isStreaming,
  context,
  resolutions,
  resolveProposal,
}: ChatMessageProps) {
  const isUser = message.role === 'user';
  // Interrupted flag from a stored assistant message that ended without onFinish.
  const interrupted = !!(message as unknown as { interrupted?: boolean }).interrupted;
  const isStreamingThis = isLastAssistant && isStreaming;

  const mergedParts = mergeReasoningParts(message.parts);
  const groups = groupPartsForRender(mergedParts, resolutions);

  // Renders a single non-cluster part (text / attachment / resolved or
  // actionable proposal/view). Cluster-eligible parts (plain tool-call
  // cards, reasoning) never reach here; they render via ProcessTimeline.
  function renderSinglePart(merged: MergedPart): React.ReactNode {
    if (merged.type === 'merged-reasoning') {
      // Not reachable — merged-reasoning is always cluster-eligible — but
      // keep a safe fallback rather than silently dropping content.
      return (
        <ReasoningBubble
          key={clusterItemKey(merged)}
          text={merged.text}
          streaming={merged.streaming && isStreamingThis}
        />
      );
    }

    const { part, originalIndex: idx } = merged;

    // ---- Text part ----
    if (part.type === 'text') {
      if (!part.text) return null;
      return (
        <div
          key={idx}
          className={`${styles.bubble} ${isUser ? styles.bubbleUser : styles.bubbleAssistant}`}
        >
          {isUser ? (
            <p className={styles.bubbleText}>{part.text}</p>
          ) : (
            <div className={styles.bubbleMarkdown}>
              <ReactMarkdown>{stripCitationTokens(part.text)}</ReactMarkdown>
            </div>
          )}
        </div>
      );
    }

    // ---- File part (user-attached image) ----
    if (part.type === 'file' && part.mediaType.startsWith('image/')) {
      return (
        <img
          key={idx}
          src={part.url}
          alt="Attached image"
          className={styles.attachedImage}
        />
      );
    }

    // ---- Redacted image marker (photo stripped by the nightly retention job) ----
    if (part.type === 'data-imageRedacted') {
      const data = (part as unknown as { data: { mediaType?: string } }).data;
      return (
        <div key={idx} className={styles.imageRedactedChip} title={data?.mediaType}>
          <ImageOff size={16} aria-hidden="true" style={{ display: 'block' }} />
          <span>Photo no longer available</span>
        </div>
      );
    }

    // ---- Registered data-part renderer (e.g. nutrition's barcode chip) ----
    const PartRenderer = getPartRenderer(part.type);
    if (PartRenderer) {
      return (
        <div key={idx}>
          <PartRenderer part={part} index={idx} context={context} />
        </div>
      );
    }

    // ---- Tool invocation part ----
    if (isToolUIPart(part)) {
      const toolName = getToolName(part as AnyToolUIPart);
      const toolCallId = (part as { toolCallId: string }).toolCallId;
      const resolution = resolutions.get(toolCallId);

      if (resolution) {
        if (resolution.status === 'denied') {
          return (
            <div key={idx} className={styles.proposalDenied}>
              Proposal declined
            </div>
          );
        }
        return (
          <div key={idx} className={styles.proposalConfirmed}>
            {resolution.displayName ?? 'Done'}
          </div>
        );
      }

      const registration = getToolRendererRegistration(toolName);
      if (registration?.Component) {
        const Renderer = registration.Component;
        return (
          <div key={idx} className={styles.proposalInlineWrap}>
            <Renderer
              part={part as AnyToolUIPart}
              toolCallId={toolCallId}
              context={context}
              resolution={undefined}
              resolve={(status, kind, displayName) => resolveProposal(toolCallId, status, kind, displayName ?? null)}
            />
          </div>
        );
      }

      // No registration (fallback ToolCallCard) — handled via
      // classifyMergedPart/ProcessTimeline, so this should never reach here.
      return null;
    }

    return null;
  }

  return (
    <div className={`${styles.messageGroup} ${isUser ? styles.messageGroupUser : styles.messageGroupAssistant}`}>
      {groups.map(group => (
        group.kind === 'cluster'
          ? (
            <ProcessTimeline
              key={group.groupKey}
              items={group.items}
              isStreamingThis={isStreamingThis}
            />
          )
          // renderSinglePart's returned elements already carry their own
          // `key` prop, which satisfies React's list-key requirement here.
          : renderSinglePart(group.merged)
      ))}

      {/* Interrupted marker for assistant messages that ended mid-stream */}
      {!isUser && interrupted && !isStreamingThis && (
        <div className={styles.interruptedMarker}>
          Response interrupted
        </div>
      )}
    </div>
  );
}
