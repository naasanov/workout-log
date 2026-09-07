import { Router } from 'express';
import { pipeUIMessageStreamToResponse, consumeStream } from 'ai';
import { authenticateToken } from './auth';
import { validateId } from '../utils/validation';
import handleSqlError from '../utils/handleSqlError';
import { User } from '../types';
import { streamChat } from '../services/agent';
import * as store from '../services/conversations/store';

const router = Router();
router.use(authenticateToken);

// Caps how large a resolution's `result` JSON can be -- it is echoed back
// into a future system prompt (see buildVolatileContext), so an unbounded
// blob from a misbehaving client would otherwise inflate every later turn.
const RESULT_JSON_MAX_LENGTH = 4000;

// How many recent confirmed results to fold into the prompt (see
// buildVolatileContext's "Recently confirmed changes" block) -- bounds
// prompt growth for a long-running conversation with many confirmed writes.
const MAX_CONFIRMED_RESULTS_IN_PROMPT = 20;

// Conversations are owned directly by user_uuid (no ownership chain to walk),
// but every id-scoped route still confirms the row belongs to the caller
// before acting on it, and reports 404 rather than 403 on a mismatch so ids
// stay unenumerable -- matching the convention in routes/movements.ts and
// routes/variations.ts.

/**
 * Describes where in the app the user is chatting from. `tab` and
 * `focusedResource` let the agent resolve vague references ("this exercise",
 * "today") without the user naming what they mean.
 */
interface ChatContext {
  tab?: string;
  selectedDate?: string;
  focusedResource?: { type: string; id: string | number };
}

function isValidChatContext(context: unknown): context is ChatContext {
  if (context === undefined) return true;
  if (typeof context !== 'object' || context === null || Array.isArray(context)) return false;
  const c = context as Record<string, unknown>;
  if (c.tab !== undefined && typeof c.tab !== 'string') return false;
  if (c.selectedDate !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(String(c.selectedDate))) return false;
  if (c.focusedResource !== undefined) {
    const fr = c.focusedResource as Record<string, unknown> | null;
    if (typeof fr !== 'object' || fr === null) return false;
    if (typeof fr.type !== 'string') return false;
    if (typeof fr.id !== 'string' && typeof fr.id !== 'number') return false;
  }
  return true;
}

/**
 * Resolve the user's currently-active conversation, creating one if they
 * have none. Kept separate from the streaming handler below so conversation
 * resolution is testable without a live model call (see GET /active).
 */
export async function resolveActiveConversationId(userUuid: string): Promise<number> {
  const list = await store.listConversations(userUuid);
  const active = list.find((c) => c.active);
  if (active) return active.id;
  return store.createConversation(userUuid);
}

/** Fetch a conversation the caller owns, or send 404 and return null. */
async function requireOwnedConversation(userUuid: string, conversationId: number, res: import('express').Response) {
  const found = await store.getConversation(userUuid, conversationId);
  if (!found) {
    res.status(404).json({ message: `Conversation ${conversationId} not found` });
    return null;
  }
  return found;
}

// GET /active — resolve (or create) the caller's active conversation, with its messages.
router.get('/active', async (req, res): Promise<any> => {
  const { uuid }: User = res.locals.user;
  try {
    const conversationId = await resolveActiveConversationId(uuid);
    const found = await store.getConversation(uuid, conversationId);
    return res.status(200).json({ data: found, message: 'Active conversation resolved' });
  } catch (error) {
    return handleSqlError(error, res);
  }
});

// GET /conversations — list the caller's conversations, most recently updated first.
router.get('/conversations', async (req, res): Promise<any> => {
  const { uuid }: User = res.locals.user;
  try {
    const data = await store.listConversations(uuid);
    return res.status(200).json({ data, message: `Found ${data.length} conversation(s)` });
  } catch (error) {
    return handleSqlError(error, res);
  }
});

// POST /conversations — start a new chat, archiving the current active one.
router.post('/conversations', async (req, res): Promise<any> => {
  const { uuid }: User = res.locals.user;
  try {
    const id = await store.createConversation(uuid);
    const data = await store.getConversation(uuid, id);
    return res.status(201).json({ data, message: 'New conversation started' });
  } catch (error) {
    return handleSqlError(error, res);
  }
});

// GET /conversations/:id — one conversation with its messages.
router.get('/conversations/:id', async (req, res): Promise<any> => {
  const { uuid }: User = res.locals.user;
  if (!validateId(req.params.id, res)) return;
  const id = Number(req.params.id);

  try {
    const found = await requireOwnedConversation(uuid, id, res);
    if (!found) return;
    return res.status(200).json({ data: found, message: `Successfully retrieved conversation ${id}` });
  } catch (error) {
    return handleSqlError(error, res);
  }
});

// POST /conversations/:id/archive — archive a conversation the caller owns.
router.post('/conversations/:id/archive', async (req, res): Promise<any> => {
  const { uuid }: User = res.locals.user;
  if (!validateId(req.params.id, res)) return;
  const id = Number(req.params.id);

  try {
    if (!(await requireOwnedConversation(uuid, id, res))) return;
    await store.archiveConversation(uuid, id);
    const data = await store.getConversation(uuid, id);
    return res.status(200).json({ data, message: `Conversation ${id} archived` });
  } catch (error) {
    return handleSqlError(error, res);
  }
});

// POST /conversations/:id/continue — make an archived conversation active again.
router.post('/conversations/:id/continue', async (req, res): Promise<any> => {
  const { uuid }: User = res.locals.user;
  if (!validateId(req.params.id, res)) return;
  const id = Number(req.params.id);

  try {
    if (!(await requireOwnedConversation(uuid, id, res))) return;
    await store.continueConversation(uuid, id);
    const data = await store.getConversation(uuid, id);
    return res.status(200).json({ data, message: `Conversation ${id} is active again` });
  } catch (error) {
    return handleSqlError(error, res);
  }
});

// DELETE /conversations/:id — permanently delete a conversation, its messages, and its resolutions.
router.delete('/conversations/:id', async (req, res): Promise<any> => {
  const { uuid }: User = res.locals.user;
  if (!validateId(req.params.id, res)) return;
  const id = Number(req.params.id);

  try {
    if (!(await requireOwnedConversation(uuid, id, res))) return;
    await store.deleteConversation(uuid, id);
    return res.status(200).json({ message: `Conversation ${id} deleted` });
  } catch (error) {
    return handleSqlError(error, res);
  }
});

// GET /conversations/:id/resolutions — proposal accept/deny state for a conversation.
router.get('/conversations/:id/resolutions', async (req, res): Promise<any> => {
  const { uuid }: User = res.locals.user;
  if (!validateId(req.params.id, res)) return;
  const id = Number(req.params.id);

  try {
    if (!(await requireOwnedConversation(uuid, id, res))) return;
    const data = await store.getResolutions(id);
    return res.status(200).json({ data, message: `Found ${data.length} resolution(s)` });
  } catch (error) {
    return handleSqlError(error, res);
  }
});

// POST /conversations/:id/resolutions — record a proposal's accept/deny state.
router.post('/conversations/:id/resolutions', async (req, res): Promise<any> => {
  const { uuid }: User = res.locals.user;
  if (!validateId(req.params.id, res)) return;
  const id = Number(req.params.id);

  const { toolCallId, kind, status, displayName, result } = req.body as {
    toolCallId?: unknown;
    kind?: unknown;
    status?: unknown;
    displayName?: unknown;
    // Structured outcome of the confirmed write (e.g. { id }, or an array of
    // those for a batch) -- see store.ts's ProposalResolutionRow doc comment.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    result?: any;
  };
  if (typeof toolCallId !== 'string' || toolCallId.length === 0 || toolCallId.length > 64) {
    return res.status(400).json({ message: 'toolCallId must be a non-empty string of at most 64 characters' });
  }
  // kind is a free-form resource tag (entry, custom_food, body_weight_entry.delete,
  // ...) -- see migrations/024_generalize_proposal_kind.sql and store.ts's
  // ProposalResolutionRow -- so only its shape/length is validated here.
  if (typeof kind !== 'string' || kind.length === 0 || kind.length > 32) {
    return res.status(400).json({ message: 'kind must be a non-empty string of at most 32 characters' });
  }
  if (status !== 'confirmed' && status !== 'denied') {
    return res.status(400).json({ message: 'status must be "confirmed" or "denied"' });
  }
  if (displayName !== undefined && displayName !== null && typeof displayName !== 'string') {
    return res.status(400).json({ message: 'displayName must be a string or null' });
  }
  if (result !== undefined && result !== null && JSON.stringify(result).length > RESULT_JSON_MAX_LENGTH) {
    return res.status(400).json({ message: `result must serialize to at most ${RESULT_JSON_MAX_LENGTH} characters` });
  }

  try {
    if (!(await requireOwnedConversation(uuid, id, res))) return;
    await store.saveResolution(uuid, id, toolCallId, kind, status, (displayName as string | null) ?? null, null, result ?? null);
    return res.status(204).send();
  } catch (error) {
    return handleSqlError(error, res);
  }
});

// POST / — the global AI agent chat endpoint (streams a UI message stream).
// Unlike the nutrition-only chat, the thread is identified by the caller's
// active conversation rather than a calendar date; a `context` object tells
// the agent what tab/date/resource the user is currently looking at.
router.post('/', async (req, res): Promise<any> => {
  const { uuid }: User = res.locals.user;
  const { messages, context, effort, deniedProposalCount } = req.body as {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    messages: any[];
    context?: ChatContext;
    effort?: 'none' | 'minimal' | 'low' | 'medium' | 'high';
    deniedProposalCount?: number;
  };

  if (!Array.isArray(messages)) {
    return res.status(400).json({ message: 'messages must be an array' });
  }
  if (!isValidChatContext(context)) {
    return res.status(400).json({ message: 'context must describe { tab?, selectedDate?, focusedResource? }' });
  }

  const selectedDate = context?.selectedDate ?? new Date().toISOString().slice(0, 10);

  try {
    const conversationId = await resolveActiveConversationId(uuid);

    // Confirmed propose_mutation resolutions that carry a structured result
    // (see store.ts's ProposalResolutionRow) feed the next turn's prompt so
    // the agent learns what it actually created -- see buildVolatileContext.
    // Fetched server-side (unlike deniedProposalCount) since it must survive
    // a reload rather than living only in the client's in-memory state.
    const resolutions = await store.getResolutions(conversationId).catch(() => []);
    const confirmedResults = resolutions
      .filter((r) => r.status === 'confirmed' && r.result !== null && r.result !== undefined)
      .slice(-MAX_CONFIRMED_RESULTS_IN_PROMPT)
      .map((r) => ({ kind: r.kind, display_name: r.display_name, result: r.result }));

    // Persist the last user message immediately (best-effort)
    const lastUserMsg = messages.length > 0 ? messages[messages.length - 1] : null;
    if (lastUserMsg && lastUserMsg.role === 'user') {
      const msgId: string = lastUserMsg.id ?? `user-${Date.now()}`;
      const parts = Array.isArray(lastUserMsg.parts) ? lastUserMsg.parts : [{ type: 'text', text: String(lastUserMsg.content ?? '') }];
      await store.appendMessage(uuid, conversationId, msgId, 'user', parts).catch(() => {});
    }

    const result = await streamChat({
      userUuid: uuid,
      selectedDate,
      tab: context?.tab,
      focusedResource: context?.focusedResource,
      messages: messages as Parameters<typeof streamChat>[0]['messages'],
      effort,
      deniedProposalCount,
      confirmedResults,
    });

    // Build the UI message stream ONCE. Its onEnd callback persists the assistant
    // UIMessage (with full parts: text/reasoning/tool-*) so that after reload, tool
    // cards and reasoning render correctly.
    //
    // Bug fix (#chat-midstream-persistence): onEnd only fires when this UI-message
    // stream is fully drained. Previously we only piped it to the HTTP response, so
    // when the client disconnected mid-stream `res` stopped being written, the stream
    // stopped being pulled, and onEnd NEVER fired — losing the assistant row.
    // (`result.consumeStream()` on the BASE stream ran the model to completion but is a
    // separate consumer; it does not drive this derived stream's onEnd.)
    //
    // Fix: tee the UI-message stream. Pipe one branch to the response for the client,
    // and drain the other branch server-side with consumeStream(). The server-side
    // drain guarantees the stream reaches completion — and thus onEnd fires exactly
    // once — regardless of whether the client is still connected. onEnd lives on the
    // single source stream, so persistence happens in exactly one place (no double-insert).
    const uiStream = result.toUIMessageStream({
      sendReasoning: true,
      // Capture the final UIMessage (which has parts: text/reasoning/tool-*) so that
      // persisted transcripts round-trip correctly after reload.
      onEnd: async ({ responseMessage, isAborted }) => {
        try {
          const msgId = (responseMessage as { id?: string }).id ?? `asst-${Date.now()}`;
          const parts = Array.isArray(responseMessage.parts) ? responseMessage.parts : [];
          const assistantRowId = await store.appendMessage(uuid, conversationId, msgId, 'assistant', parts);
          if (isAborted && assistantRowId !== null) {
            await store.markInterrupted(assistantRowId).catch(() => {});
          }
        } catch {
          // best-effort — don't break anything
        }
      },
      // Surface real error details (single-user personal app — leaking internals is fine)
      onError: (error: unknown): string => {
        if (error == null) return 'Unknown error';
        if (typeof error === 'string') return error;
        if (error instanceof Error) return error.message;
        try { return JSON.stringify(error); } catch { return String(error); }
      },
    });

    const [toClient, toDrain] = uiStream.tee();

    // Drain one branch server-side so the run always completes and onEnd fires,
    // even if the client has disconnected. Best-effort — never throw.
    consumeStream({ stream: toDrain, onError: () => {} }).catch(() => {});

    // Stream the other branch to the Express response using the standalone helper
    // (avoids the deprecated result method).
    pipeUIMessageStreamToResponse({
      response: res,
      stream: toClient,
    });
  } catch (error) {
    // Only reached if streamText itself throws before streaming begins
    const err = error as Error;
    console.error('[chat] Stream error:', err?.message ?? String(error));
    if (err?.stack) console.error('[chat] Stack:', err.stack);
    return handleSqlError(error, res);
  }
});

export default router;
