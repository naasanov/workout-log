// Generalized chat agent entry point. Runs a tool-calling loop via the
// Vercel AI SDK's streamText, assembling the system prompt and tool set from
// domain modules, and returns the StreamTextResult for the caller to pipe.
import { streamText, stepCountIs, convertToModelMessages } from 'ai';
import type { ModelMessage, ToolSet } from 'ai';
import { openai } from '@ai-sdk/openai';
import * as store from '../nutrition/store';
import { recordUsage } from '../nutrition/usage';
import { getUserFlags } from '../flags';
import { buildSystemPrompt } from './prompt';
import { assembleTools, ToolContext, ToolModule } from './tools/registry';
import { nutritionTools } from './tools/nutrition';
import { reportTokenUsage } from './tokenEstimate';

/**
 * Every domain's tools, merged per-request by assembleTools. Later waves add
 * more entries here (workouts, goals, etc.) without touching this file's
 * request-handling logic.
 */
const TOOL_MODULES: ToolModule[] = [nutritionTools];

export interface ChatOptions {
  userUuid: string;
  /** ISO-8601 date string: YYYY-MM-DD — the day the user is currently viewing */
  selectedDate: string;
  /** Raw useChat UI messages from the client (array of UIMessage-like objects without id) */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  messages: any[];
  /** Reasoning effort: none | minimal | low | medium | high (default: medium) */
  effort?: 'none' | 'minimal' | 'low' | 'medium' | 'high';
  /** When true, instructs the agent to log the entry immediately without asking follow-up questions. */
  autoConfirm?: boolean;
  /**
   * How many proposals the user denied since their previous message. Transient
   * per-turn signal (the client passes it in the request body) folded into the
   * system prompt so the agent reconsiders — kept out of the visible user message.
   */
  deniedProposalCount?: number;
}

/**
 * Task C / #216 — barcode-attachment grounding.
 *
 * The client attaches a scanned barcode as a `data-barcodeAttachment` UI
 * message part (see client/src/features/nutrition/NutritionChat.tsx). Data
 * parts (`type` starting with `data-`) are UI-only: `convertToModelMessages`
 * silently drops them from the converted user turn (there's no `convertDataPart`
 * option passed below), so the model never sees the raw part — only the
 * synthetic tool-call/tool-result pair we splice in ourselves, built here.
 *
 * This mirrors exactly what the removed `lookup_barcode` tool used to return
 * (a FoodSearchResult-shaped product: name/source/source_ref/per100g/
 * serving_grams), so the model treats it as already-retrieved grounding for a
 * `lookup_barcode` call it never actually makes (that tool no longer exists).
 *
 * #216 fix: EVERY user message's barcode attachment(s) are replayed, not just
 * the most recent message's. Previously only the last message was inspected,
 * so a barcode was grounded ONLY on the turn it was scanned — asking about it
 * a turn later got "0 barcode scans" because the model genuinely had no
 * barcode data past that turn. The parts always persisted server-side
 * (routes/nutrition.ts stores each message's full parts array), so the fix is
 * purely about *replaying* them all, not about storing anything new. Accepted
 * tradeoff: extra input tokens per turn, proportional to scans-in-conversation.
 */
interface BarcodeAttachmentProduct {
  name: string;
  source: string;
  source_ref: string;
  per100g: Record<string, number | null | undefined>;
  serving_grams?: number | null;
  portions?: unknown;
}

/**
 * Find every `data-barcodeAttachment` part on a single message, if it's a user
 * turn. #213 made multiple scans possible per message, so this `.filter`s
 * (rather than `.find`s) every matching part.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function findBarcodeAttachments(message: any): { code: string; product: BarcodeAttachmentProduct }[] {
  if (!message || message.role !== 'user' || !Array.isArray(message.parts)) return [];
  return message.parts
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((p: any) => p?.type === 'data-barcodeAttachment')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((p: any) => p?.data)
    .filter((data: unknown): data is { code: string; product: BarcodeAttachmentProduct } => {
      const d = data as { code?: unknown; product?: unknown } | null | undefined;
      return !!d?.code && !!d?.product;
    });
}

/**
 * Build the synthetic assistant tool-call + tool message pairs that replay a
 * message's scanned product(s) as `lookup_barcode` tool-results. Each
 * attachment gets its own pair with a distinct `toolCallId` — `messageKey`
 * (the source message's index/id) plus the attachment's position within that
 * message guarantees uniqueness across the whole conversation, even when the
 * same barcode is scanned more than once (a plain `Date.now()` id, as used
 * previously, could collide when several attachments are processed within the
 * same millisecond).
 */
function buildBarcodeToolResultMessages(
  attachments: { code: string; product: BarcodeAttachmentProduct }[],
  messageKey: string,
): ModelMessage[] {
  const result: ModelMessage[] = [];
  attachments.forEach((attachment, i) => {
    const toolCallId = `barcode-scan-${messageKey}-${i}-${attachment.code}`;
    result.push(
      {
        role: 'assistant',
        content: [
          {
            type: 'tool-call',
            toolCallId,
            toolName: 'lookup_barcode',
            input: { code: attachment.code },
          },
        ],
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId,
            toolName: 'lookup_barcode',
            // JSON round-trip: strips the object down to plain JSON so it satisfies
            // ToolResultOutput's `value: JSONValue` (mirrors the pattern used by the
            // search_food_history tools above for the same reason).
            output: { type: 'json', value: JSON.parse(JSON.stringify(attachment.product)) },
          },
        ],
      },
    );
  });
  return result;
}

/** Kick off the AI chat loop; returns the StreamTextResult for the caller to pipe. */
export async function streamChat({
  userUuid,
  selectedDate,
  messages,
  effort,
  autoConfirm,
  deniedProposalCount,
}: ChatOptions) {
  // Fetch context in parallel — degrade gracefully if DB not available.
  // getUserFlags never throws on its own (see services/flags.ts), but the .catch
  // here matches the defensive style of the other three so a flag lookup can
  // never take down the whole chat turn even under future changes.
  const [recent, goals, todayDay, flags] = await Promise.all([
    store.recentEntries(userUuid, 3).catch(() => []),
    store.getGoals(userUuid).catch(() => ({ calories: null, protein_g: null, carbs_g: null, fat_g: null })),
    store.getDay(userUuid, selectedDate).catch(() => ({ date: selectedDate, totals: { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0, sugar_g: 0, sodium_mg: 0 }, entries: [] })),
    getUserFlags(userUuid).catch(() => ({ unc_dining: false })),
  ]);

  const uncEnabled = flags.unc_dining;

  const goalsLine = [
    goals.calories != null ? `${goals.calories} kcal` : null,
    goals.protein_g != null ? `${goals.protein_g}g protein` : null,
    goals.carbs_g != null ? `${goals.carbs_g}g carbs` : null,
    goals.fat_g != null ? `${goals.fat_g}g fat` : null,
  ]
    .filter(Boolean)
    .join(', ');

  const system = buildSystemPrompt({
    uncEnabled,
    selectedDate,
    goalsLine,
    todayTotals: todayDay.totals,
    recentEntries: recent,
    autoConfirm,
    deniedProposalCount,
  });

  // #216: convert message-by-message (instead of the whole array at once) so
  // each user message's barcode attachment(s) can be replayed as synthetic
  // `lookup_barcode` tool-result pairs immediately after THAT message's
  // converted form — not dumped at the end of the whole conversation. The old
  // "push at the end" approach only ever replayed the LAST message's barcode,
  // because it relied on the last raw client message always being the one
  // 'user' turn that converts to the final ModelMessage in the array; that
  // assumption breaks for any earlier message, so a barcode scanned on turn 1
  // was invisible to the model by turn 2.
  //
  // convertToModelMessages processes each UIMessage independently (no state is
  // carried between messages — see the `for (const message of messages)` loop
  // in the 'ai' package's implementation), so converting one message at a time
  // and concatenating produces the exact same ModelMessage[] as converting the
  // whole array in one call; it just lets us interleave the synthetic pairs at
  // the right position.
  const modelMessages: ModelMessage[] = [];
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    modelMessages.push(...(await convertToModelMessages([message])));

    const barcodeAttachments = findBarcodeAttachments(message);
    if (barcodeAttachments.length > 0) {
      // `i` (the message's position in the conversation) keys the synthetic
      // toolCallIds so they stay unique even if the exact same barcode is
      // scanned again in a later message.
      modelMessages.push(...buildBarcodeToolResultMessages(barcodeAttachments, String(i)));
    }
  }

  const toolContext: ToolContext = {
    userUuid,
    selectedDate,
    flags: { unc_dining: uncEnabled },
  };
  const tools: ToolSet = assembleTools(TOOL_MODULES, toolContext);

  // Best-effort token instrumentation for measuring the cacheable prefix
  // (system prompt + tool schemas) before later waves optimize it. Never
  // blocks or fails the chat turn.
  reportTokenUsage(system, tools)
    .then((report) => {
      console.log('[agent] estimated tokens', report);
    })
    .catch(() => {});

  const result = streamText({
    model: openai('gpt-5.5'),
    system,
    messages: modelMessages,
    stopWhen: [stepCountIs(16)],
    providerOptions: {
      openai: {
        reasoningEffort: effort ?? 'medium',
        reasoningSummary: 'auto',
      },
    },
    onFinish: ({ usage }) => {
      // Best-effort usage recording — never await, never throw.
      const inputTokens = usage.inputTokens ?? 0;
      const outputTokens = usage.outputTokens ?? 0;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const reasoningTokens = (usage as any).outputDetails?.reasoningTokens ?? 0;
      const totalTokens = usage.totalTokens ?? (inputTokens + outputTokens);
      recordUsage(userUuid, 'gpt-5.5', {
        inputTokens,
        outputTokens,
        reasoningTokens,
        totalTokens,
      });
    },
    tools,
  });

  return result;
}
