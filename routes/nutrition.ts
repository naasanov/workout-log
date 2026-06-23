import { Router } from 'express';
import { authenticateToken } from './auth';
import { validateId } from '../utils/validation';
import handleSqlError from '../utils/handleSqlError';
import { User } from '../types';
import { entryInputSchema, goalsSchema } from '../schemas/nutrition';
import * as store from '../services/nutrition/store';
import { searchFoods, lookupBarcode } from '../services/nutrition/providers';

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

// GET /foods/search?q=...
router.get('/foods/search', async (req, res): Promise<any> => {
  const q = (req.query.q ?? '') as string;
  if (!q.trim()) {
    return res.status(400).json({ message: 'Query parameter q is required' });
  }

  try {
    const data = await searchFoods(q.trim());
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

export default router;
