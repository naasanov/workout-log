// Trims replayed chat history before it is converted to model messages (#325).
// Older turns keep text, propose_* calls and barcode grounding; reasoning,
// other tool payloads and inline images become compact placeholders.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ChatMessage = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MessagePart = any;

export const KEEP_FULL_TURNS = 2;

// Replayed history is part of the cached prompt prefix, so the trimmed region
// grows in whole blocks of turns. It changes once every TRIM_BLOCK_TURNS turns
// rather than every turn, which would rewrite the prefix on every request.
export const TRIM_BLOCK_TURNS = 4;

const IMAGE_PLACEHOLDER_TEXT = '[image attached earlier, not replayed]';

function toolName(part: MessagePart): string | null {
  if (typeof part?.type !== 'string' || !part.type.startsWith('tool-')) return null;
  return part.type.slice('tool-'.length);
}

function toolPlaceholder(part: MessagePart): MessagePart {
  return { type: 'text', text: `[${toolName(part)} lookup result omitted to save space]` };
}

// Returns null when nothing worth replaying remains, so the whole message is dropped.
function trimAssistantMessage(message: ChatMessage): ChatMessage | null {
  const parts: MessagePart[] = Array.isArray(message.parts) ? message.parts : [];
  const kept: MessagePart[] = [];
  for (const part of parts) {
    const name = toolName(part);
    if (part?.type === 'text' || name?.startsWith('propose_')) {
      kept.push(part);
    } else if (name !== null) {
      kept.push(toolPlaceholder(part));
    }
  }
  return kept.length === 0 ? null : { ...message, parts: kept };
}

// Barcode data parts stay, since streamChat replays every user message's barcode grounding.
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
 * Never mutates its input. Messages outside the trimmed region are passed
 * through by reference, and at least the last KEEP_FULL_TURNS turns always are.
 */
export function trimHistoryForReplay(messages: ChatMessage[]): ChatMessage[] {
  if (!Array.isArray(messages)) return messages;

  const userIndices: number[] = [];
  messages.forEach((message, i) => {
    if (message?.role === 'user') userIndices.push(i);
  });

  const trimmableTurns = Math.max(0, userIndices.length - KEEP_FULL_TURNS);
  const trimmedTurns = Math.floor(trimmableTurns / TRIM_BLOCK_TURNS) * TRIM_BLOCK_TURNS;
  if (trimmedTurns === 0) return messages.slice();

  const cutoff = userIndices[trimmedTurns];
  const older: ChatMessage[] = [];
  for (let i = 0; i < cutoff; i++) {
    const trimmed = trimOlderMessage(messages[i]);
    if (trimmed !== null) older.push(trimmed);
  }
  return [...older, ...messages.slice(cutoff)];
}
