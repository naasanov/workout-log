import { randomBytes } from 'crypto';
import { ResultSetHeader, RowDataPacket } from 'mysql2';
import { Router } from 'express';
import { parseISO } from 'date-fns';
import pool from '../database';
import handleSqlError from '../utils/handleSqlError';
import { validateId, validateLabel, validateVariation } from '../utils/validation';
import { authenticateApiKey, hashApiKey } from '../middleware/apiKey';
import { authenticateToken } from './auth';
import SqlError from '../utils/sqlErrors';
import { streamNutritionChat } from '../services/nutrition/agent';
import * as nutritionStore from '../services/nutrition/store';
import type { EntryInput } from '../schemas/nutrition';
import * as workoutsStore from '../services/workouts';
import * as habitsStore from '../services/habits/store';
const { NO_REFERENCE_ERROR, WRONG_VALUE_ERROR } = SqlError;

const router = Router();

// ---------------------------------------------------------------------------
// API Key management — JWT auth (owner manages their own keys)
// ---------------------------------------------------------------------------

router.post('/keys', authenticateToken, async (req, res): Promise<any> => {
    const { uuid } = res.locals.user;
    const { label } = req.body;

    const rawKey = randomBytes(32).toString('hex');
    const keyHash = hashApiKey(rawKey);

    let result: ResultSetHeader;
    try {
        [result] = await pool.query<ResultSetHeader>(`
            INSERT INTO api_keys (key_hash, label, user_uuid)
            VALUES (?, ?, UUID_TO_BIN(?))
        `, [keyHash, label ?? null, uuid]);
    } catch (error) {
        return handleSqlError(error, res);
    }

    res.status(201).json({
        data: { id: result.insertId, key: rawKey, label: label ?? null },
        message: "API key created. Store the key securely — it will not be shown again."
    });
});

router.get('/keys', authenticateToken, async (req, res): Promise<any> => {
    const { uuid } = res.locals.user;

    let data: RowDataPacket[];
    try {
        [data] = await pool.query<RowDataPacket[]>(`
            SELECT id, label, created_at, last_used_at
            FROM api_keys
            WHERE user_uuid = UUID_TO_BIN(?)
            ORDER BY created_at DESC
        `, [uuid]);
    } catch (error) {
        return handleSqlError(error, res);
    }

    res.status(200).json({ data, message: "Successfully retrieved API keys" });
});

router.delete('/keys/:id', authenticateToken, async (req, res): Promise<any> => {
    const { uuid } = res.locals.user;
    const keyId = req.params.id;
    if (!validateId(keyId, res)) return;

    let data: ResultSetHeader;
    try {
        [data] = await pool.query<ResultSetHeader>(`
            DELETE FROM api_keys
            WHERE id = ? AND user_uuid = UUID_TO_BIN(?)
        `, [keyId, uuid]);
    } catch (error) {
        return handleSqlError(error, res);
    }

    if (data.affectedRows === 0) {
        return res.status(404).json({ message: `No API key with id ${keyId} found for this user` });
    }

    res.status(200).json({ message: `Successfully revoked API key with id ${keyId}` });
});

// ---------------------------------------------------------------------------
// All routes below require API key auth
// ---------------------------------------------------------------------------

router.use(authenticateApiKey);

// ---------------------------------------------------------------------------
// Workouts (sections)
// ---------------------------------------------------------------------------

router.get('/workouts', async (req, res): Promise<any> => {
    const { uuid } = res.locals.user;

    let sections: workoutsStore.SectionSummary[];
    try {
        sections = await workoutsStore.listSectionsForUser(uuid);
    } catch (error) {
        return handleSqlError(error, res);
    }

    // Drop showItems: this endpoint's wire shape has only ever been {id, label}.
    const data = sections.map(({ id, label }) => ({ id, label }));
    res.status(200).json({ data, message: "Successfully retrieved workouts" });
});

router.post('/workouts', async (req, res): Promise<any> => {
    const { uuid } = res.locals.user;
    const { name } = req.body;
    if (!validateLabel(name, res)) return;

    let id: number;
    try {
        id = await workoutsStore.createSection(uuid, name);
    } catch (error) {
        return handleSqlError(error, res);
    }

    res.status(201).json({
        data: { id },
        message: `Successfully created workout with id ${id}`
    });
});

// Scoped to the caller via store.deleteSection, which matches on user_uuid.
// A workout id owned by someone else 404s rather than deleting, so ids stay
// unenumerable across accounts.
router.delete('/workouts/:id', async (req, res): Promise<any> => {
    const { uuid } = res.locals.user;
    const workoutId = req.params.id;
    if (!validateId(workoutId, res)) return;

    let deleted: boolean;
    try {
        deleted = await workoutsStore.deleteSection(uuid, workoutId);
    } catch (error) {
        return handleSqlError(error, res, {
            [WRONG_VALUE_ERROR]: [400, "Workout id must be a positive integer"]
        });
    }

    if (!deleted) {
        return res.status(404).json({ message: `No workout with id ${workoutId}` });
    }

    res.status(200).json({ message: `Successfully deleted workout with id ${workoutId}` });
});

// ---------------------------------------------------------------------------
// Movements
// ---------------------------------------------------------------------------

router.get('/movements', async (req, res): Promise<any> => {
    const workoutId = req.query.workoutId as string;
    if (!workoutId) {
        return res.status(400).json({ message: "Query parameter workoutId is required" });
    }
    if (!validateId(workoutId, res)) return;
    const { uuid } = res.locals.user;

    // The original query joined through sections so a foreign/nonexistent
    // workoutId silently produced zero rows rather than a 404 -- reproduced
    // here by skipping the list call (not returning early) when unowned.
    let data: workoutsStore.MovementSummary[] = [];
    try {
        if (await workoutsStore.ownsSection(uuid, workoutId)) {
            data = await workoutsStore.listMovementsForSection(workoutId);
        }
    } catch (error) {
        return handleSqlError(error, res);
    }

    res.status(200).json({ data, message: `Successfully retrieved movements for workout ${workoutId}` });
});

// store.createMovement also inserts a default "Variation" child row (see
// services/workouts/movements.ts), which this endpoint has never done. Kept
// inline to avoid that side effect; see the accompanying report.
router.post('/movements', async (req, res): Promise<any> => {
    const { uuid } = res.locals.user;
    const { name, workoutId } = req.body;
    if (!validateLabel(name, res)) return;
    if (!workoutId || !validateId(String(workoutId), res)) return;

    let result: ResultSetHeader;
    try {
        // Checked via store.ownsSection before inserting: a workoutId that
        // exists but belongs to another user 404s here rather than reaching
        // the foreign-key check below, which can't tell the two cases apart.
        if (!(await workoutsStore.ownsSection(uuid, String(workoutId)))) {
            return res.status(404).json({ message: `Workout with id ${workoutId} not found` });
        }
        [result] = await pool.query<ResultSetHeader>(`
            INSERT INTO movements (section_id, label)
            VALUES (?, ?)
        `, [workoutId, name]);
    } catch (error) {
        return handleSqlError(error, res, {
            [NO_REFERENCE_ERROR]: [404, `Workout with id ${workoutId} not found`]
        });
    }

    res.status(201).json({
        data: { id: result.insertId },
        message: `Successfully created movement with id ${result.insertId}`
    });
});

// Scoped to the caller via store.deleteMovement, which joins through the
// owning section. A movement owned by someone else 404s rather than
// deleting, so ids stay unenumerable across accounts.
router.delete('/movements/:id', async (req, res): Promise<any> => {
    const { uuid } = res.locals.user;
    const movementId = req.params.id;
    if (!validateId(movementId, res)) return;

    let deleted: boolean;
    try {
        deleted = await workoutsStore.deleteMovement(uuid, movementId);
    } catch (error) {
        return handleSqlError(error, res, {
            [WRONG_VALUE_ERROR]: [400, "Movement id must be a positive integer"]
        });
    }

    if (!deleted) {
        return res.status(404).json({ message: `No movement with id ${movementId}` });
    }

    res.status(200).json({ message: `Successfully deleted movement with id ${movementId}` });
});

// ---------------------------------------------------------------------------
// Variations
// ---------------------------------------------------------------------------

router.get('/variations', async (req, res): Promise<any> => {
    const movementId = req.query.movementId as string;
    if (!movementId) {
        return res.status(400).json({ message: "Query parameter movementId is required" });
    }
    if (!validateId(movementId, res)) return;
    const { uuid } = res.locals.user;

    // Mirrors the movements route above: a foreign/nonexistent movementId
    // produces an empty list rather than a 404, matching the original join.
    let data: { id: number; label: string; weight: number | null; reps: number; date: Date | string }[] = [];
    try {
        if (await workoutsStore.ownsMovement(uuid, movementId)) {
            const rows = await workoutsStore.listVariationsForMovement(movementId);
            // Drop `notes`: this endpoint's wire shape has never included it.
            data = rows.map(({ id, label, weight, reps, date }) => ({ id, label, weight, reps, date }));
        }
    } catch (error) {
        return handleSqlError(error, res);
    }

    res.status(200).json({ data, message: `Successfully retrieved variations for movement ${movementId}` });
});

router.post('/variations', async (req, res): Promise<any> => {
    const { uuid } = res.locals.user;
    const { label, weight, reps, movementId } = req.body;
    if (!validateLabel(label, res)) return;
    if (!movementId || !validateId(String(movementId), res)) return;

    const body = { label, weight, reps };
    if (!validateVariation(body, res)) return;

    let id: number;
    try {
        // Checked via store.ownsMovement before creating: a movementId that
        // exists but belongs to another user 404s here rather than reaching
        // the foreign-key check below, which can't tell the two cases apart.
        if (!(await workoutsStore.ownsMovement(uuid, String(movementId)))) {
            return res.status(404).json({ message: `Movement with id ${movementId} not found` });
        }
        // reps defaulted to 0 here (not left undefined) because the shared
        // insert binds it positionally, and an undefined reps would send a
        // literal SQL NULL against the NOT NULL column.
        id = await workoutsStore.createVariation(movementId, label, weight, reps ?? 0, new Date());
    } catch (error) {
        return handleSqlError(error, res, {
            [NO_REFERENCE_ERROR]: [404, `Movement with id ${movementId} not found`]
        });
    }

    res.status(201).json({
        data: { id },
        message: `Successfully created variation with id ${id}`
    });
});

router.patch('/variations/:id', async (req, res): Promise<any> => {
    const { uuid } = res.locals.user;
    const variationId = req.params.id;
    if (!validateId(variationId, res)) return;

    const allowedFields = ['label', 'weight', 'reps', 'date'];
    const invalidFields = Object.keys(req.body).filter(key => !allowedFields.includes(key));
    if (invalidFields.length > 0) {
        return res.status(400).json({
            message: `Invalid fields: ${invalidFields.join(', ')}. Allowed: ${allowedFields.join(', ')}.`
        });
    }
    if (!validateVariation(req.body, res)) return;
    if (req.body.date) {
        req.body.date = new Date(parseISO(req.body.date));
    }

    let updated: boolean;
    try {
        // Checked via store.ownsVariation before updating, so a variation
        // owned by someone else 404s here -- and the history insert below
        // never runs, since it's gated behind the same success path.
        if (!(await workoutsStore.ownsVariation(uuid, variationId))) {
            return res.status(404).json({ message: `No variation with id ${variationId}` });
        }
        updated = await workoutsStore.updateVariationFields(variationId, req.body);
    } catch (error) {
        return handleSqlError(error, res);
    }

    if (!updated) {
        return res.status(404).json({ message: `No variation with id ${variationId}` });
    }

    // Kept inline rather than store.appendHistoryIfChanged: that helper only
    // fires on the variation's post-update weight, dedupes against the latest
    // history row, and also records reps -- three behavior differences from
    // this endpoint's always-insert, weight-only, req.body-driven history log.
    if ('weight' in req.body && req.body.weight != null) {
        const historyDate = req.body.date ?? new Date();
        pool.query<ResultSetHeader>(`
            INSERT INTO variation_history (variation_id, weight, date)
            VALUES (?, ?, ?)
        `, [variationId, req.body.weight, historyDate]).catch(() => {});
    }

    res.status(200).json({ message: `Successfully updated variation with id ${variationId}` });
});

// Scoped to the caller via store.deleteVariation, which joins through the
// owning movement and section. A variation owned by someone else 404s
// rather than deleting, so ids stay unenumerable across accounts.
router.delete('/variations/:id', async (req, res): Promise<any> => {
    const { uuid } = res.locals.user;
    const variationId = req.params.id;
    if (!validateId(variationId, res)) return;

    let deleted: boolean;
    try {
        deleted = await workoutsStore.deleteVariation(uuid, variationId);
    } catch (error) {
        return handleSqlError(error, res, {
            [WRONG_VALUE_ERROR]: [400, "Variation id must be a positive integer"]
        });
    }

    if (!deleted) {
        return res.status(404).json({ message: `No variation with id ${variationId}` });
    }

    res.status(200).json({ message: `Successfully deleted variation with id ${variationId}` });
});

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

// Scoped to the caller via store.ownsVariation, checked before reading
// history. A variation owned by someone else 404s so ids stay unenumerable.
router.get('/history/:variationId', async (req, res): Promise<any> => {
    const { uuid } = res.locals.user;
    const variationId = req.params.variationId;
    if (!validateId(variationId, res)) return;

    let history: workoutsStore.HistoryEntry[];
    try {
        if (!(await workoutsStore.ownsVariation(uuid, variationId))) {
            return res.status(404).json({ message: `No variation with id ${variationId}` });
        }
        history = await workoutsStore.getHistory(variationId);
    } catch (error) {
        return handleSqlError(error, res);
    }

    // Drop `reps`: this endpoint's wire shape has always been weight-only,
    // unlike the main API's equivalent which also returns reps.
    const data = history.map(({ weight, date }) => ({ weight, date }));

    res.status(200).json({
        data,
        message: `Successfully retrieved history for variation with id ${variationId}`
    });
});

// ---------------------------------------------------------------------------
// Summary — structured overview for AI consumption
// ---------------------------------------------------------------------------

router.get('/summary', async (req, res): Promise<any> => {
    const { uuid } = res.locals.user;

    type SummaryMovement = { id: number; label: string; workoutId: number };
    type SummaryVariation = {
        id: number; movementId: number; label: string;
        weight: number | null; reps: number; date: Date | string;
    };

    let sections: { id: number; label: string }[] = [];
    const movements: SummaryMovement[] = [];
    let variations: SummaryVariation[] = [];
    // Keyed by variationId; each entry is the 10 most recent points, newest first.
    const historyByVariation: Record<number, { weight: number | null; date: Date | string }[]> = {};

    try {
        const sectionRows = await workoutsStore.listSectionsForUser(uuid);
        sections = sectionRows.map(({ id, label }) => ({ id, label }));

        if (sections.length === 0) {
            return res.status(200).json({ data: [], message: "No workouts found" });
        }

        // No bulk "movements for many sections" service call exists, so this
        // fetches per section -- same rows as the original single IN (?) query.
        for (const section of sections) {
            const sectionMovements = await workoutsStore.listMovementsForSection(String(section.id));
            for (const m of sectionMovements) {
                movements.push({ id: m.id, label: m.label, workoutId: section.id });
            }
        }

        if (movements.length === 0) {
            const data = sections.map(s => ({ ...s, movements: [] }));
            return res.status(200).json({ data, message: "Summary retrieved" });
        }

        const movementIds = movements.map(m => String(m.id));
        const variationRows = await workoutsStore.listVariationsByMovementIds(movementIds);
        // Drop `notes`: this endpoint's variation shape has never included it.
        variations = variationRows.map(({ id, movement_id, label, weight, reps, date }) => ({
            id, movementId: movement_id, label, weight, reps, date
        }));

        // No bulk "history for many variations" service call exists, so this
        // fetches per variation. getHistory is oldest-first; take the most
        // recent 10 and reverse to match this endpoint's newest-first order.
        for (const v of variations) {
            const fullHistory = await workoutsStore.getHistory(String(v.id));
            historyByVariation[v.id] = fullHistory
                .slice(-10)
                .reverse()
                .map(({ weight, date }) => ({ weight, date }));
        }
    } catch (error) {
        return handleSqlError(error, res);
    }

    // Group variations by movementId
    const variationsByMovement: Record<number, any[]> = {};
    for (const v of variations) {
        if (!variationsByMovement[v.movementId]) variationsByMovement[v.movementId] = [];
        variationsByMovement[v.movementId].push({
            id: v.id,
            label: v.label,
            currentWeight: v.weight,
            currentReps: v.reps,
            lastUpdated: v.date,
            recentHistory: historyByVariation[v.id] ?? []
        });
    }

    // Group movements by sectionId
    const movementsBySection: Record<number, any[]> = {};
    for (const m of movements) {
        if (!movementsBySection[m.workoutId]) movementsBySection[m.workoutId] = [];
        movementsBySection[m.workoutId].push({
            id: m.id,
            label: m.label,
            variations: variationsByMovement[m.id] ?? []
        });
    }

    const data = sections.map(s => ({
        id: s.id,
        label: s.label,
        movements: movementsBySection[s.id] ?? []
    }));

    res.status(200).json({ data, message: "Summary retrieved successfully" });
});

// ---------------------------------------------------------------------------
// Habits (tallies)
// ---------------------------------------------------------------------------

// GET distinct habit names for the user (discover what habits exist). No
// store function covers this: it reads distinct names ever tallied in
// habit_tallies, a different (older) concept from the habits registry table
// that services/habits/store.ts's listHabits reads from. Kept inline.
router.get('/habits', async (req, res): Promise<any> => {
    const { uuid } = res.locals.user;

    let rows: RowDataPacket[];
    try {
        [rows] = await pool.query<RowDataPacket[]>(`
            SELECT DISTINCT habit_name
            FROM habit_tallies
            WHERE user_uuid = UUID_TO_BIN(?)
            ORDER BY habit_name ASC
        `, [uuid]);
    } catch (error) {
        return handleSqlError(error, res);
    }

    const data = rows.map(r => r.habit_name);
    res.status(200).json({ data, message: "Successfully retrieved habits" });
});

// GET all tally rows for a habit (sorted descending by date)
router.get('/habits/:habitName', async (req, res): Promise<any> => {
    const { uuid } = res.locals.user;
    const habitName = req.params.habitName?.trim();
    if (!habitName) {
        return res.status(400).json({ message: "habitName must be a non-empty string" });
    }

    let data: habitsStore.TallyRow[];
    try {
        data = await habitsStore.listTallies(uuid, habitName);
    } catch (error) {
        return handleSqlError(error, res);
    }

    res.status(200).json({
        data,
        message: `Successfully retrieved habit tallies for ${habitName}`
    });
});

// POST a tally — upserts: creates with count=1 or increments count and pushes range_end
router.post('/habits/:habitName/tally', async (req, res): Promise<any> => {
    const { uuid } = res.locals.user;
    const habitName = req.params.habitName?.trim();
    if (!habitName) {
        return res.status(400).json({ message: "habitName must be a non-empty string" });
    }

    // Optionally accept the device's local time so we store the correct local date/time
    const { localTime, localDate } = req.body as { localTime?: string; localDate?: string };

    // Validate localTime is HH:mm
    const timeValue = localTime && /^\d{2}:\d{2}$/.test(localTime) ? localTime : null;
    // Validate localDate is YYYY-MM-DD
    const dateValue = localDate && /^\d{4}-\d{2}-\d{2}$/.test(localDate) ? localDate : null;

    // Fallback: use current UTC time/date if client values missing (e.g. empty body)
    const now = new Date();
    const fallbackDate = now.toISOString().slice(0, 10);
    const fallbackTime = now.toTimeString().slice(0, 5);

    const todayDate = dateValue ?? fallbackDate;
    const currentTime = timeValue ?? fallbackTime;

    let result: habitsStore.TallyUpsertResult;
    try {
        result = await habitsStore.upsertTally(uuid, habitName, todayDate, currentTime);
    } catch (error) {
        return handleSqlError(error, res);
    }

    if (result.created) {
        return res.status(201).json({
            data: result.data,
            message: `Tally added for ${habitName} on ${todayDate}`
        });
    } else {
        return res.status(200).json({
            data: result.data,
            message: `Tally incremented for ${habitName} on ${todayDate}`
        });
    }
});

// ---------------------------------------------------------------------------
// Nutrition entry via AI agent (no-confirmation, automated)
// ---------------------------------------------------------------------------

router.post('/nutrition/entry', async (req, res): Promise<any> => {
    const { uuid } = res.locals.user;
    const { prompt, image, date } = req.body as { prompt?: string; image?: string; date?: string };

    if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
        return res.status(400).json({ message: 'prompt is required and must be a non-empty string' });
    }

    const selectedDate = (date && /^\d{4}-\d{2}-\d{2}$/.test(date))
        ? date
        : new Date().toISOString().slice(0, 10);

    // Build a single user message — include the image as a data URL part if provided
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const parts: any[] = [{ type: 'text', text: prompt.trim() }];
    if (image && typeof image === 'string' && image.startsWith('data:')) {
        // Extract mime type and base64 data from the data URL
        const match = image.match(/^data:([^;]+);base64,(.+)$/);
        if (match) {
            parts.push({ type: 'image', image, mimeType: match[1] });
        }
    }

    const messages = [{ role: 'user', parts }];

    const TIMEOUT_MS = 30_000;
    let timedOut = false;
    const timeoutHandle = setTimeout(() => { timedOut = true; }, TIMEOUT_MS);

    try {
        const result = await streamNutritionChat({
            userUuid: uuid,
            selectedDate,
            messages,
            effort: 'low',
            autoConfirm: true,
        });

        // Consume the stream and collect all tool results to find propose_entry output
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let proposedEntry: any = null;

        for await (const part of result.fullStream) {
            if (timedOut) break;
            if (part.type === 'tool-result' && part.toolName === 'propose_entry') {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                proposedEntry = (part as any).output;
                break;
            }
        }

        clearTimeout(timeoutHandle);

        if (timedOut) {
            return res.status(500).json({ message: 'Agent timed out without proposing an entry' });
        }

        if (!proposedEntry) {
            return res.status(500).json({ message: 'Agent did not produce a food entry' });
        }

        // Convert ProposeEntryArgs → EntryInput: add localDate; ingredient mapping below
        const entryInput: EntryInput = {
            localDate: selectedDate,
            meal: proposedEntry.meal,
            name: proposedEntry.name,
            source: proposedEntry.source ?? 'text',
            barcode: proposedEntry.barcode ?? null,
            raw_llm_json: proposedEntry,
            // Ingredients carry EITHER a weight basis (grams) OR a serving basis
            // (serving_qty + serving_label) — never both, never neither (see
            // checkIngredientBasis in schemas/nutrition.ts). A UNC dining ingredient
            // has no gram weight to report, so `grams: null` here is legitimate, not
            // a bug — the serving fields are what make that row meaningful, and both
            // bases must be carried through faithfully for the exactly-one-basis
            // validation to pass.
            ingredients: (proposedEntry.ingredients as any[]).map((ing: any) => ({
                name: ing.name,
                grams: ing.grams ?? null,
                source: ing.source,
                source_ref: ing.source_ref ?? null,
                calories: ing.calories,
                protein_g: ing.protein_g,
                carbs_g: ing.carbs_g,
                fat_g: ing.fat_g,
                fiber_g: ing.fiber_g ?? null,
                sugar_g: ing.sugar_g ?? null,
                sodium_mg: ing.sodium_mg ?? null,
                serving_qty: ing.serving_qty ?? null,
                serving_label: ing.serving_label ?? null,
            })),
        };

        const { id } = await nutritionStore.createEntry(uuid, entryInput);

        return res.status(200).json({
            data: { entryId: id },
            message: 'Food entry added successfully',
        });
    } catch (error) {
        clearTimeout(timeoutHandle);
        return handleSqlError(error, res);
    }
});

export default router;
