import { Router } from 'express';
import { pipeUIMessageStreamToResponse } from 'ai';
import { authenticateToken } from './auth';
import { validateId } from '../utils/validation';
import handleSqlError from '../utils/handleSqlError';
import { User } from '../types';
import { entryInputSchema, goalsSchema, customFoodInputSchema } from '../schemas/nutrition';
import * as store from '../services/nutrition/store';
import { searchAllFoodsWithPortions, lookupBarcode, getPortions } from '../services/nutrition/providers';
import { streamNutritionChat } from '../services/nutrition/agent';
import { getUserUsageTotals, getAllUsersUsage, getUserEmail } from '../services/nutrition/usage';
import {
  getTranscript,
  appendMessage,
  markInterrupted,
  clearTranscript,
} from '../services/nutrition/transcripts';

const router = Router();
router.use(authenticateToken);

// GET /day/:date — full day view
router.get('/day/:date', async (req, res): Promise<any> => {
  const { uuid }: User = res.locals.user;
  const { date } = req.params;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ message: 'date must be in YYYY-MM-DD format' });
  }

  try {
    const data = await store.getDay(uuid, date);
    return res.status(200).json({ data, message: `Successfully retrieved nutrition for ${date}` });
  } catch (error) {
    return handleSqlError(error, res);
  }
});

// POST /entries — create entry
router.post('/entries', async (req, res): Promise<any> => {
  const { uuid }: User = res.locals.user;
  const parsed = entryInputSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: parsed.error.issues[0]?.message ?? 'Invalid request body' });
  }

  try {
    const { id, totals } = await store.createEntry(uuid, parsed.data);
    return res.status(201).json({ data: { ...totals, id }, message: 'Entry created' });
  } catch (error) {
    return handleSqlError(error, res);
  }
});

// GET /entries/:id — single entry
router.get('/entries/:id', async (req, res): Promise<any> => {
  const { uuid }: User = res.locals.user;
  if (!validateId(req.params.id, res)) return;
  const id = Number(req.params.id);

  try {
    const data = await store.getEntry(uuid, id);
    if (!data) return res.status(404).json({ message: `Entry ${id} not found` });
    return res.status(200).json({ data, message: `Successfully retrieved entry ${id}` });
  } catch (error) {
    return handleSqlError(error, res);
  }
});

// PATCH /entries/:id — update entry
router.patch('/entries/:id', async (req, res): Promise<any> => {
  const { uuid }: User = res.locals.user;
  if (!validateId(req.params.id, res)) return;
  const id = Number(req.params.id);

  const parsed = entryInputSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: parsed.error.issues[0]?.message ?? 'Invalid request body' });
  }

  try {
    const data = await store.updateEntry(uuid, id, parsed.data);
    if (!data) return res.status(404).json({ message: `Entry ${id} not found` });
    return res.status(200).json({ data, message: `Entry ${id} updated` });
  } catch (error) {
    return handleSqlError(error, res);
  }
});

// DELETE /entries/:id
router.delete('/entries/:id', async (req, res): Promise<any> => {
  const { uuid }: User = res.locals.user;
  if (!validateId(req.params.id, res)) return;
  const id = Number(req.params.id);

  try {
    const deleted = await store.deleteEntry(uuid, id);
    if (!deleted) return res.status(404).json({ message: `Entry ${id} not found` });
    return res.status(200).json({ message: `Entry ${id} deleted` });
  } catch (error) {
    return handleSqlError(error, res);
  }
});

// GET /custom-foods/recent — most-recently-logged custom items (must be BEFORE /:id)
router.get('/custom-foods/recent', async (req, res): Promise<any> => {
  const { uuid }: User = res.locals.user;
  const limit = Math.min(Number(req.query.limit ?? 5), 20);

  try {
    const data = await store.recentCustomFoods(uuid, limit);
    return res.status(200).json({ data, message: `Found ${data.length} recent custom food(s)` });
  } catch (error) {
    return handleSqlError(error, res);
  }
});

// GET /custom-foods — list custom foods/meals (optional ?status=draft|saved)
router.get('/custom-foods', async (req, res): Promise<any> => {
  const { uuid }: User = res.locals.user;
  const statusParam = req.query.status as string | undefined;

  if (statusParam && statusParam !== 'draft' && statusParam !== 'saved') {
    return res.status(400).json({ message: 'status must be "draft" or "saved"' });
  }

  try {
    const data = await store.listCustomFoods(uuid, statusParam as 'draft' | 'saved' | undefined);
    return res.status(200).json({ data, message: `Found ${data.length} custom food(s)` });
  } catch (error) {
    return handleSqlError(error, res);
  }
});

// POST /custom-foods — create a custom food/meal
router.post('/custom-foods', async (req, res): Promise<any> => {
  const { uuid }: User = res.locals.user;
  const parsed = customFoodInputSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: parsed.error.issues[0]?.message ?? 'Invalid request body' });
  }

  try {
    const data = await store.createCustomFood(uuid, parsed.data);
    return res.status(201).json({ data, message: 'Custom food created' });
  } catch (error) {
    return handleSqlError(error, res);
  }
});

// GET /custom-foods/:id — single custom food/meal
router.get('/custom-foods/:id', async (req, res): Promise<any> => {
  const { uuid }: User = res.locals.user;
  if (!validateId(req.params.id, res)) return;
  const id = Number(req.params.id);

  try {
    const data = await store.getCustomFood(uuid, id);
    if (!data) return res.status(404).json({ message: `Custom food ${id} not found` });
    return res.status(200).json({ data, message: `Successfully retrieved custom food ${id}` });
  } catch (error) {
    return handleSqlError(error, res);
  }
});

// PATCH /custom-foods/:id — update / draft autosave
router.patch('/custom-foods/:id', async (req, res): Promise<any> => {
  const { uuid }: User = res.locals.user;
  if (!validateId(req.params.id, res)) return;
  const id = Number(req.params.id);

  const parsed = customFoodInputSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: parsed.error.issues[0]?.message ?? 'Invalid request body' });
  }

  try {
    const data = await store.updateCustomFood(uuid, id, parsed.data);
    if (!data) return res.status(404).json({ message: `Custom food ${id} not found` });
    return res.status(200).json({ data, message: `Custom food ${id} updated` });
  } catch (error) {
    return handleSqlError(error, res);
  }
});

// DELETE /custom-foods/:id
router.delete('/custom-foods/:id', async (req, res): Promise<any> => {
  const { uuid }: User = res.locals.user;
  if (!validateId(req.params.id, res)) return;
  const id = Number(req.params.id);

  try {
    const deleted = await store.deleteCustomFood(uuid, id);
    if (!deleted) return res.status(404).json({ message: `Custom food ${id} not found` });
    return res.status(200).json({ message: `Custom food ${id} deleted` });
  } catch (error) {
    return handleSqlError(error, res);
  }
});

// POST /custom-foods/:id/duplicate — clone a saved item into a new draft
router.post('/custom-foods/:id/duplicate', async (req, res): Promise<any> => {
  const { uuid }: User = res.locals.user;
  if (!validateId(req.params.id, res)) return;
  const id = Number(req.params.id);

  try {
    const data = await store.duplicateCustomFood(uuid, id);
    if (!data) return res.status(404).json({ message: `Custom food ${id} not found` });
    return res.status(201).json({ data, message: `Custom food ${id} duplicated` });
  } catch (error) {
    return handleSqlError(error, res);
  }
});

// GET /foods/search?q=...
router.get('/foods/search', async (req, res): Promise<any> => {
  const { uuid }: User = res.locals.user;
  const q = (req.query.q ?? '') as string;
  if (!q.trim()) {
    return res.status(400).json({ message: 'Query parameter q is required' });
  }

  try {
    const data = await searchAllFoodsWithPortions(uuid, q.trim());
    return res.status(200).json({ data, message: `Found ${data.length} result(s)` });
  } catch (error) {
    return handleSqlError(error, res);
  }
});

// GET /barcode/:code
router.get('/barcode/:code', async (req, res): Promise<any> => {
  const { code } = req.params;
  if (!/^\d+$/.test(code)) {
    return res.status(400).json({ message: 'Barcode must contain digits only' });
  }

  try {
    const data = await lookupBarcode(code);
    if (!data) return res.status(404).json({ message: `Product with barcode ${code} not found` });
    return res.status(200).json({ data, message: `Found product for barcode ${code}` });
  } catch (error) {
    return handleSqlError(error, res);
  }
});

// GET /portions?source=usda|off&ref=<id>
router.get('/portions', async (req, res): Promise<any> => {
  const source = req.query.source as string;
  const ref = (req.query.ref ?? '') as string;

  if (source !== 'usda' && source !== 'off') {
    return res.status(400).json({ message: 'source must be "usda" or "off"' });
  }
  if (!ref.trim()) {
    return res.status(400).json({ message: 'ref is required' });
  }

  try {
    const data = await getPortions(source, ref.trim());
    return res.status(200).json({ data, message: `Found ${data.length} portion(s)` });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to fetch portions' });
  }
});

// GET /goals
router.get('/goals', async (req, res): Promise<any> => {
  const { uuid }: User = res.locals.user;
  try {
    const data = await store.getGoals(uuid);
    return res.status(200).json({ data, message: 'Successfully retrieved nutrition goals' });
  } catch (error) {
    return handleSqlError(error, res);
  }
});

// PUT /goals
router.put('/goals', async (req, res): Promise<any> => {
  const { uuid }: User = res.locals.user;
  const parsed = goalsSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: parsed.error.issues[0]?.message ?? 'Invalid request body' });
  }

  try {
    const data = await store.putGoals(uuid, parsed.data);
    return res.status(200).json({ data, message: 'Goals saved' });
  } catch (error) {
    return handleSqlError(error, res);
  }
});

// GET /usage — caller's own AI usage totals; owner also gets per-user breakdown.
// Set OWNER_EMAIL in env/Heroku config to enable the all-users view.
router.get('/usage', async (req, res): Promise<any> => {
  const { uuid }: User = res.locals.user;
  try {
    const ownTotals = await getUserUsageTotals(uuid);

    // Check if this user is the owner
    const ownerEmail = process.env.OWNER_EMAIL;
    let allUsers = undefined;
    if (ownerEmail) {
      const callerEmail = await getUserEmail(uuid);
      if (callerEmail && callerEmail.toLowerCase() === ownerEmail.toLowerCase()) {
        allUsers = await getAllUsersUsage();
      }
    }

    return res.status(200).json({
      data: {
        own: ownTotals,
        ...(allUsers !== undefined ? { allUsers } : {}),
      },
      message: 'AI usage retrieved',
    });
  } catch (error) {
    return handleSqlError(error, res);
  }
});

// GET /chat/transcript?date=YYYY-MM-DD — fetch stored chat messages for a day
router.get('/chat/transcript', async (req, res): Promise<any> => {
  const { uuid }: User = res.locals.user;
  const date = (req.query.date ?? '') as string;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ message: 'date query param must be in YYYY-MM-DD format' });
  }

  try {
    const data = await getTranscript(uuid, date);
    return res.status(200).json({ data, message: `Found ${data.length} message(s)` });
  } catch (error) {
    return handleSqlError(error, res);
  }
});

// DELETE /chat/transcript?date=YYYY-MM-DD — clear transcript for a day
router.delete('/chat/transcript', async (req, res): Promise<any> => {
  const { uuid }: User = res.locals.user;
  const date = (req.query.date ?? '') as string;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ message: 'date query param must be in YYYY-MM-DD format' });
  }

  try {
    await clearTranscript(uuid, date);
    return res.status(204).send();
  } catch (error) {
    return handleSqlError(error, res);
  }
});

// POST /chat — Nutrition AI agent chat endpoint (streams UI message stream)
router.post('/chat', async (req, res): Promise<any> => {
  const { uuid }: User = res.locals.user;
  const { messages, selectedDate, effort } = req.body as {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    messages: any[];
    selectedDate?: string;
    effort?: 'none' | 'minimal' | 'low' | 'medium' | 'high';
  };

  if (!Array.isArray(messages)) {
    return res.status(400).json({ message: 'messages must be an array' });
  }

  const date = selectedDate ?? new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ message: 'selectedDate must be in YYYY-MM-DD format' });
  }

  try {
    // Persist the last user message immediately (best-effort)
    const lastUserMsg = messages.length > 0 ? messages[messages.length - 1] : null;
    if (lastUserMsg && lastUserMsg.role === 'user') {
      const msgId: string = lastUserMsg.id ?? `user-${Date.now()}`;
      const parts = Array.isArray(lastUserMsg.parts) ? lastUserMsg.parts : [{ type: 'text', text: String(lastUserMsg.content ?? '') }];
      await appendMessage(uuid, date, msgId, 'user', parts).catch(() => {});
    }

    const result = await streamNutritionChat({
      userUuid: uuid,
      selectedDate: date,
      messages: messages as Parameters<typeof streamNutritionChat>[0]['messages'],
      effort,
    });

    // Track the in-progress assistant row so we can mark it interrupted if needed.
    let assistantRowId: number | null = null;

    // Consume the stream on the server regardless of client connection, so onFinish fires.
    // This means the run completes even if the client disconnects mid-stream.
    result.consumeStream();

    // Persist assistant message once the run finishes (best-effort, fire-and-forget).
    // Use Promise.resolve() to promote PromiseLike → full Promise so we can use .catch().
    Promise.resolve(result.finishReason)
      .then(async () => {
        try {
          const response = await result.response;
          const assistantMessages = response.messages ?? [];
          // Find the last assistant message
          const lastAssistant = assistantMessages.filter((m) => m.role === 'assistant').pop();
          if (lastAssistant) {
            const msgId = `asst-${Date.now()}`;
            const rawParts = Array.isArray(lastAssistant.content)
              ? lastAssistant.content
              : [{ type: 'text', text: String(lastAssistant.content ?? '') }];
            assistantRowId = await appendMessage(uuid, date, msgId, 'assistant', rawParts);
          }
        } catch {
          // best-effort — don't break anything
        }
      })
      .catch(async () => {
        // Run errored/aborted before finish — mark interrupted if we inserted a row
        if (assistantRowId !== null) {
          await markInterrupted(assistantRowId).catch(() => {});
        }
      });

    // Stream the AI SDK UI message stream to the Express response using the
    // standalone helper (avoids the deprecated result method).
    pipeUIMessageStreamToResponse({
      response: res,
      stream: result.toUIMessageStream({ sendReasoning: true }),
    });
  } catch (error) {
    // Only reached if streamText itself throws before streaming begins
    // #107: log detailed error info so it shows up in Heroku logs
    const err = error as Error;
    console.error('[nutrition/chat] Stream error:', err?.message ?? String(error));
    if (err?.stack) console.error('[nutrition/chat] Stack:', err.stack);
    return handleSqlError(error, res);
  }
});

export default router;
