// Trims replayed chat history before it is converted to model messages.
// Production data (#325) showed prior assistant message parts growing from
// ~17KB at turns 1-2 to 140KB+ past turn 11 -- mostly reasoning text and
// tool payloads (food search, UNC menus, web search) the model never needs
// again once a turn is resolved. This is a pure function of the raw
// client-supplied UI message array, so it is testable without a database or
// a model call, and is called from services/agent/index.ts before any other
// processing (barcode replay, convertToModelMessages) sees the messages.
//
// Policy (owner-approved): the last KEEP_FULL_TURNS turns are replayed
// byte-identical. In every older turn: text and propose_* tool calls survive
// (the actionable record of what was offered), barcode attachment data
// survives (services/agent/index.ts depends on it to replay grounding), and
// everything else -- reasoning, calculator/search/menu/web-search tool
// payloads, old inline images -- is replaced with a compact placeholder so
// the model still knows a lookup happened without re-sending its payload.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ChatMessage = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MessagePart = any;

export const KEEP_FULL_TURNS = 2;

const IMAGE_PLACEHOLDER_TEXT = '[image attached earlier -- not replayed]';

// Tool names whose output is a large, re-fetchable lookup payload rather
// than a durable record of a proposed change. See the module doc comment
// for the reference sizes that motivated dropping these.
const DROPPED_TOOL_NAMES = new Set([
  'calculator',
  'convert_to_grams',
  'search_foods',
  'search_foods_batch',
  'get_food_portions',
  'get_foods_portions',
  'search_unc_foods',
  'get_unc_menu',
  'list_unc_locations',
  'get_unc_food',
  'web_search',
]);

function toolName(part: MessagePart): string | null {
  if (typeof part?.type !== 'string' || !part.type.startsWith('tool-')) return null;
  return part.type.slice('tool-'.length);
}

function isProposeToolPart(part: MessagePart): boolean {
  const name = toolName(part);
  return name !== null && name.startsWith('propose_');
}

/** A short stand-in for a dropped tool part, naming the tool so the model knows a lookup already happened. */
function toolPlaceholder(part: MessagePart): MessagePart {
  return { type: 'text', text: `[${toolName(part)} lookup result omitted to save space]` };
}

/**
 * Keep text and propose_* tool calls; replace every other tool part with a
 * compact placeholder; drop reasoning and step-marker parts outright.
 * Returns null when nothing worth keeping remains, so the caller can drop
 * the whole message rather than replay an empty turn.
 */
function trimAssistantMessage(message: ChatMessage): ChatMessage | null {
  const parts: MessagePart[] = Array.isArray(message.parts) ? message.parts : [];
  const kept: MessagePart[] = [];
  for (const part of parts) {
    if (part?.type === 'text') {
      kept.push(part);
    } else if (isProposeToolPart(part)) {
      kept.push(part);
    } else if (part?.type === 'reasoning' || part?.type === 'step-start') {
      // Dropped outright -- not a lookup record, so no placeholder needed.
    } else if (toolName(part) !== null) {
      kept.push(toolPlaceholder(part));
    }
    // Any other part type (unrecognized data-* etc.) is dropped silently.
  }
  return kept.length === 0 ? null : { ...message, parts: kept };
}

/**
 * Keep text and barcode-attachment data parts untouched -- streamChat
 * replays every user message's barcode attachment(s) regardless of turn
 * age -- and replace inline image/file parts with a short text stand-in.
 */
function trimUserMessage(message: ChatMessage): ChatMessage {
  const parts: MessagePart[] = Array.isArray(message.parts) ? message.parts : [];
  const kept = parts.map((part: MessagePart) => (part?.type === 'file' ? { type: 'text', text: IMAGE_PLACEHOLDER_TEXT } : part));
  return { ...message, parts: kept };
}

function trimOlderMessage(message: ChatMessage): ChatMessage | null {
  if (message?.role === 'assistant') return trimAssistantMessage(message);
  if (message?.role === 'user') return trimUserMessage(message);
  return message;
}

/**
 * Trim the older portion of a conversation before it is replayed to the
 * model. Never mutates `messages` or any message/part inside it -- every
 * changed message/part is a fresh object; untouched (recent) messages are
 * passed through by reference. A conversation with KEEP_FULL_TURNS user
 * turns or fewer is returned unchanged (as a shallow copy).
 */
export function trimHistoryForReplay(messages: ChatMessage[]): ChatMessage[] {
  if (!Array.isArray(messages)) return messages;

  const userIndices: number[] = [];
  messages.forEach((message, i) => {
    if (message?.role === 'user') userIndices.push(i);
  });

  if (userIndices.length <= KEEP_FULL_TURNS) {
    return messages.slice();
  }

  // Start of the (KEEP_FULL_TURNS)-th-from-last turn: everything from here
  // to the end is replayed untouched; everything before it is trimmed.
  const cutoff = userIndices[userIndices.length - KEEP_FULL_TURNS];

  const older: ChatMessage[] = [];
  for (let i = 0; i < cutoff; i++) {
    const trimmed = trimOlderMessage(messages[i]);
    if (trimmed !== null) older.push(trimmed);
  }

  return [...older, ...messages.slice(cutoff)];
}
