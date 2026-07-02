// Nutrition data access — the single place that touches the food_* / nutrition_goals
// tables. Called by BOTH routes/nutrition.ts and (Phase 2) the agent tools.
//
// CONTRACT (signatures fixed in design; S1 fills in the bodies):
//   - Use the mysql2 promise pool from ../../database and utils/withTransaction
//     for multi-table writes (entry + ingredients).
//   - Scope every query to the user: `WHERE user_uuid = UUID_TO_BIN(?)`.
//   - Entry-level totals are RECOMPUTED server-side as the SUM of the entry's
//     ingredient rows (do not trust a client-sent entry total).
//   - Normalize DATE columns to 'YYYY-MM-DD' before returning.
import { RowDataPacket, ResultSetHeader } from 'mysql2';
import { PoolConnection } from 'mysql2/promise';
import pool from '../../database';
import withTransaction from '../../utils/withTransaction';
import {
  EntryInput,
  EntryRow,
  DayResponse,
  Goals,
  IngredientRow,
  CustomFoodInput,
  CustomFoodRow,
  CustomServing,
  IngredientInput as IngredientInputSchema,
} from '../../schemas/nutrition';
import { FoodSearchResult } from '../../schemas/nutrition';

/** Sum ingredient macros to produce entry-level totals. */
function sumIngredients(ingredients: IngredientInput[]): {
  calories: number; protein_g: number; carbs_g: number; fat_g: number;
} {
  return ingredients.reduce(
    (acc, ing) => ({
      calories: acc.calories + ing.calories,
      protein_g: acc.protein_g + ing.protein_g,
      carbs_g: acc.carbs_g + ing.carbs_g,
      fat_g: acc.fat_g + ing.fat_g,
    }),
    { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 },
  );
}

/** Sum ingredient macros INCLUDING micros (for custom foods/meals). */
function sumIngredientsFull(ingredients: IngredientInputFull[]): {
  calories: number; protein_g: number; carbs_g: number; fat_g: number;
  fiber_g: number | null; sugar_g: number | null; sodium_mg: number | null;
  total_grams: number;
} {
  let calories = 0, protein_g = 0, carbs_g = 0, fat_g = 0;
  let fiber_g = 0, sugar_g = 0, sodium_mg = 0;
  let hasFiber = false, hasSugar = false, hasSodium = false;
  let total_grams = 0;

  for (const ing of ingredients) {
    calories += ing.calories;
    protein_g += ing.protein_g;
    carbs_g += ing.carbs_g;
    fat_g += ing.fat_g;
    total_grams += ing.grams;
    if (ing.fiber_g != null) { fiber_g += ing.fiber_g; hasFiber = true; }
    if (ing.sugar_g != null) { sugar_g += ing.sugar_g; hasSugar = true; }
    if (ing.sodium_mg != null) { sodium_mg += ing.sodium_mg; hasSodium = true; }
  }

  return {
    calories, protein_g, carbs_g, fat_g, total_grams,
    fiber_g: hasFiber ? fiber_g : null,
    sugar_g: hasSugar ? sugar_g : null,
    sodium_mg: hasSodium ? sodium_mg : null,
  };
}

type IngredientInput = { calories: number; protein_g: number; carbs_g: number; fat_g: number };
type IngredientInputFull = {
  calories: number; protein_g: number; carbs_g: number; fat_g: number; grams: number;
  fiber_g?: number | null; sugar_g?: number | null; sodium_mg?: number | null;
};

/** Fetch ingredients for a given entry id using the provided connection or pool. */
async function fetchIngredients(entryId: number): Promise<IngredientRow[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, name, grams, source, source_ref, calories, protein_g, carbs_g, fat_g
     FROM food_entry_ingredients
     WHERE entry_id = ?
     ORDER BY id ASC`,
    [entryId],
  );
  return rows as IngredientRow[];
}

/** Day view: overall totals + entries (each with ingredients) for one local date. */
export async function getDay(userUuid: string, date: string): Promise<DayResponse> {
  const [entryRows] = await pool.query<RowDataPacket[]>(
    `SELECT id, BIN_TO_UUID(user_uuid) as user_uuid, date, logged_at, meal, name, source,
            calories, protein_g, carbs_g, fat_g, fiber_g, sugar_g, sodium_mg, barcode
     FROM food_entries
     WHERE user_uuid = UUID_TO_BIN(?) AND date = ?
     ORDER BY logged_at ASC`,
    [userUuid, date],
  );

  const entries: EntryRow[] = [];
  for (const row of entryRows) {
    const ingredients = await fetchIngredients(row.id as number);
    const totals = sumIngredients(ingredients);
    entries.push({
      id: row.id as number,
      date: (row.date instanceof Date ? row.date.toISOString() : String(row.date)).slice(0, 10),
      logged_at: row.logged_at as string,
      meal: row.meal,
      name: row.name,
      source: row.source,
      calories: totals.calories,
      protein_g: totals.protein_g,
      carbs_g: totals.carbs_g,
      fat_g: totals.fat_g,
      fiber_g: null,
      sugar_g: null,
      sodium_mg: null,
      barcode: row.barcode ?? null,
      ingredients,
    });
  }

  const dayTotals = {
    calories: entries.reduce((s, e) => s + e.calories, 0),
    protein_g: entries.reduce((s, e) => s + e.protein_g, 0),
    carbs_g: entries.reduce((s, e) => s + e.carbs_g, 0),
    fat_g: entries.reduce((s, e) => s + e.fat_g, 0),
    fiber_g: 0,
    sugar_g: 0,
    sodium_mg: 0,
  };

  return { date, totals: dayTotals, entries };
}

/** Single entry with its ingredients, or null if not found / not owned. */
export async function getEntry(userUuid: string, id: number): Promise<EntryRow | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, date, logged_at, meal, name, source, calories, protein_g, carbs_g, fat_g,
            fiber_g, sugar_g, sodium_mg, barcode
     FROM food_entries
     WHERE id = ? AND user_uuid = UUID_TO_BIN(?)`,
    [id, userUuid],
  );
  if (rows.length === 0) return null;
  const row = rows[0];
  const ingredients = await fetchIngredients(id);
  const totals = sumIngredients(ingredients);
  return {
    id: row.id as number,
    date: (row.date instanceof Date ? row.date.toISOString() : String(row.date)).slice(0, 10),
    logged_at: row.logged_at as string,
    meal: row.meal,
    name: row.name,
    source: row.source,
    calories: totals.calories,
    protein_g: totals.protein_g,
    carbs_g: totals.carbs_g,
    fat_g: totals.fat_g,
    fiber_g: null,
    sugar_g: null,
    sodium_mg: null,
    barcode: row.barcode ?? null,
    ingredients,
  };
}

/** Insert entry + ingredients in one transaction; totals = sum of ingredients. */
export async function createEntry(
  userUuid: string,
  input: EntryInput,
): Promise<{ id: number; totals: EntryRow }> {
  const totals = sumIngredients(input.ingredients);

  const id = await withTransaction(async (conn) => {
    const [result] = await conn.query<ResultSetHeader>(
      `INSERT INTO food_entries
         (user_uuid, date, meal, name, source, calories, protein_g, carbs_g, fat_g,
          fiber_g, sugar_g, sodium_mg, barcode, raw_llm_json)
       VALUES (UUID_TO_BIN(?), ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, NULL)`,
      [
        userUuid,
        input.localDate,
        input.meal,
        input.name,
        input.source,
        totals.calories,
        totals.protein_g,
        totals.carbs_g,
        totals.fat_g,
        input.barcode ?? null,
      ],
    );
    const entryId = result.insertId;

    if (input.ingredients.length > 0) {
      const placeholders = input.ingredients.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
      const values: unknown[] = [];
      for (const ing of input.ingredients) {
        values.push(entryId, ing.name, ing.grams, ing.source, ing.source_ref ?? null,
          ing.calories, ing.protein_g, ing.carbs_g, ing.fat_g);
      }
      await conn.query(
        `INSERT INTO food_entry_ingredients (entry_id, name, grams, source, source_ref, calories, protein_g, carbs_g, fat_g)
         VALUES ${placeholders}`,
        values,
      );
    }

    return entryId;
  });

  const entry = await getEntry(userUuid, id);
  return { id, totals: entry! };
}

/** Replace an entry's fields + ingredient rows (delete children + reinsert) in a txn. Null if not found. */
export async function updateEntry(
  userUuid: string,
  id: number,
  input: EntryInput,
): Promise<EntryRow | null> {
  const totals = sumIngredients(input.ingredients);

  const updated = await withTransaction(async (conn) => {
    const [check] = await conn.query<ResultSetHeader>(
      `UPDATE food_entries
       SET date = ?, meal = ?, name = ?, source = ?,
           calories = ?, protein_g = ?, carbs_g = ?, fat_g = ?,
           fiber_g = NULL, sugar_g = NULL, sodium_mg = NULL,
           barcode = ?
       WHERE id = ? AND user_uuid = UUID_TO_BIN(?)`,
      [
        input.localDate,
        input.meal,
        input.name,
        input.source,
        totals.calories,
        totals.protein_g,
        totals.carbs_g,
        totals.fat_g,
        input.barcode ?? null,
        id,
        userUuid,
      ],
    );
    if (check.affectedRows === 0) return false;

    await conn.query(`DELETE FROM food_entry_ingredients WHERE entry_id = ?`, [id]);

    if (input.ingredients.length > 0) {
      const placeholders = input.ingredients.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
      const values: unknown[] = [];
      for (const ing of input.ingredients) {
        values.push(id, ing.name, ing.grams, ing.source, ing.source_ref ?? null,
          ing.calories, ing.protein_g, ing.carbs_g, ing.fat_g);
      }
      await conn.query(
        `INSERT INTO food_entry_ingredients (entry_id, name, grams, source, source_ref, calories, protein_g, carbs_g, fat_g)
         VALUES ${placeholders}`,
        values,
      );
    }
    return true;
  });

  if (!updated) return null;
  return getEntry(userUuid, id);
}

/** Delete entry + its ingredients (txn). Returns false when nothing was deleted. */
export async function deleteEntry(userUuid: string, id: number): Promise<boolean> {
  return withTransaction(async (conn) => {
    await conn.query(`DELETE FROM food_entry_ingredients WHERE entry_id = ?`, [id]);
    const [result] = await conn.query<ResultSetHeader>(
      `DELETE FROM food_entries WHERE id = ? AND user_uuid = UUID_TO_BIN(?)`,
      [id, userUuid],
    );
    return result.affectedRows > 0;
  });
}

/** Read goals (returns an all-null object if none set). */
export async function getGoals(userUuid: string): Promise<Goals> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT calories, protein_g, carbs_g, fat_g
     FROM nutrition_goals
     WHERE user_uuid = UUID_TO_BIN(?)`,
    [userUuid],
  );
  if (rows.length === 0) {
    return { calories: null, protein_g: null, carbs_g: null, fat_g: null };
  }
  const row = rows[0];
  return {
    calories: row.calories ?? null,
    protein_g: row.protein_g ?? null,
    carbs_g: row.carbs_g ?? null,
    fat_g: row.fat_g ?? null,
  };
}

/** Upsert goals by user_uuid; returns the stored goals. */
export async function putGoals(userUuid: string, goals: Goals): Promise<Goals> {
  await pool.query(
    `INSERT INTO nutrition_goals (user_uuid, calories, protein_g, carbs_g, fat_g)
     VALUES (UUID_TO_BIN(?), ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       calories = VALUES(calories),
       protein_g = VALUES(protein_g),
       carbs_g = VALUES(carbs_g),
       fat_g = VALUES(fat_g)`,
    [
      userUuid,
      goals.calories ?? null,
      goals.protein_g ?? null,
      goals.carbs_g ?? null,
      goals.fat_g ?? null,
    ],
  );
  return getGoals(userUuid);
}

// ---- Memory (Phase 2/3) — signatures defined now, implemented later ----
/** Last `days` days of entries for agent context injection (newest first). */
export async function recentEntries(userUuid: string, days: number): Promise<EntryRow[]> {
  const [entryRows] = await pool.query<RowDataPacket[]>(
    `SELECT id, BIN_TO_UUID(user_uuid) as user_uuid, date, logged_at, meal, name, source,
            calories, protein_g, carbs_g, fat_g, fiber_g, sugar_g, sodium_mg, barcode
     FROM food_entries
     WHERE user_uuid = UUID_TO_BIN(?)
       AND date >= CURDATE() - INTERVAL ? DAY
     ORDER BY date DESC, logged_at DESC`,
    [userUuid, days],
  );

  const entries: EntryRow[] = [];
  for (const row of entryRows) {
    const ingredients = await fetchIngredients(row.id as number);
    const totals = sumIngredients(ingredients);
    entries.push({
      id: row.id as number,
      date: (row.date instanceof Date ? row.date.toISOString() : String(row.date)).slice(0, 10),
      logged_at: row.logged_at as string,
      meal: row.meal,
      name: row.name,
      source: row.source,
      calories: totals.calories,
      protein_g: totals.protein_g,
      carbs_g: totals.carbs_g,
      fat_g: totals.fat_g,
      fiber_g: null,
      sugar_g: null,
      sodium_mg: null,
      barcode: row.barcode ?? null,
      ingredients,
    });
  }
  return entries;
}

/** FULLTEXT/LIKE search over past entry names; returns up to 10 matching entries with ingredients. */
export async function searchFoodHistory(userUuid: string, query: string): Promise<EntryRow[]> {
  const likePattern = `%${query.replace(/[%_\\]/g, '\\$&')}%`;
  const [entryRows] = await pool.query<RowDataPacket[]>(
    `SELECT id, BIN_TO_UUID(user_uuid) as user_uuid, date, logged_at, meal, name, source,
            calories, protein_g, carbs_g, fat_g, fiber_g, sugar_g, sodium_mg, barcode
     FROM food_entries
     WHERE user_uuid = UUID_TO_BIN(?)
       AND name LIKE ?
     ORDER BY date DESC, logged_at DESC
     LIMIT 10`,
    [userUuid, likePattern],
  );

  const entries: EntryRow[] = [];
  for (const row of entryRows) {
    const ingredients = await fetchIngredients(row.id as number);
    const totals = sumIngredients(ingredients);
    entries.push({
      id: row.id as number,
      date: (row.date instanceof Date ? row.date.toISOString() : String(row.date)).slice(0, 10),
      logged_at: row.logged_at as string,
      meal: row.meal,
      name: row.name,
      source: row.source,
      calories: totals.calories,
      protein_g: totals.protein_g,
      carbs_g: totals.carbs_g,
      fat_g: totals.fat_g,
      fiber_g: null,
      sugar_g: null,
      sodium_mg: null,
      barcode: row.barcode ?? null,
      ingredients,
    });
  }
  return entries;
}

// ---- Custom Foods & Meals ----

/** Derive per100g from total batch macros + total_grams. Guards against zero total_grams. */
function derivePer100g(
  calories: number, protein_g: number, carbs_g: number, fat_g: number,
  fiber_g: number | null, sugar_g: number | null, sodium_mg: number | null,
  total_grams: number,
) {
  const scale = total_grams > 0 ? 100 / total_grams : 0;
  return {
    calories: calories * scale,
    protein_g: protein_g * scale,
    carbs_g: carbs_g * scale,
    fat_g: fat_g * scale,
    fiber_g: fiber_g != null ? fiber_g * scale : null,
    sugar_g: sugar_g != null ? sugar_g * scale : null,
    sodium_mg: sodium_mg != null ? sodium_mg * scale : null,
  };
}

/** Re-resolve fractional servings' grams from the updated total_grams. */
function resolveServingGrams(
  servings: CustomFoodInput['servings'],
  total_grams: number,
): CustomFoodInput['servings'] {
  return servings.map((s) => ({
    ...s,
    grams: s.def_type === 'fraction' ? s.def_value * total_grams : s.def_value,
  }));
}

/** Fetch custom_food_ingredients for a given custom_food_id. */
async function fetchCustomIngredients(customFoodId: number): Promise<Array<IngredientInputSchema & { id: number }>> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, name, grams, source, source_ref, calories, protein_g, carbs_g, fat_g,
            fiber_g, sugar_g, sodium_mg
     FROM custom_food_ingredients
     WHERE custom_food_id = ?
     ORDER BY id ASC`,
    [customFoodId],
  );
  return rows as Array<IngredientInputSchema & { id: number }>;
}

/** Fetch custom_food_servings for a given custom_food_id. */
async function fetchCustomServings(customFoodId: number): Promise<Array<CustomServing & { id: number; sort_order: number }>> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, label, def_type, def_value, grams, sort_order
     FROM custom_food_servings
     WHERE custom_food_id = ?
     ORDER BY sort_order ASC, id ASC`,
    [customFoodId],
  );
  return rows as Array<CustomServing & { id: number; sort_order: number }>;
}

/** Assemble a full CustomFoodRow from a raw DB row + its children. */
async function buildCustomFoodRow(row: RowDataPacket): Promise<CustomFoodRow> {
  const id = row.id as number;
  const ingredients = await fetchCustomIngredients(id);
  const servings = await fetchCustomServings(id);

  const total_grams = row.total_grams as number;
  const calories = row.calories as number;
  const protein_g = row.protein_g as number;
  const carbs_g = row.carbs_g as number;
  const fat_g = row.fat_g as number;
  const fiber_g = row.fiber_g as number | null;
  const sugar_g = row.sugar_g as number | null;
  const sodium_mg = row.sodium_mg as number | null;

  const per100g = derivePer100g(calories, protein_g, carbs_g, fat_g, fiber_g, sugar_g, sodium_mg, total_grams);

  return {
    id,
    kind: row.kind as 'food' | 'meal',
    status: row.status as 'draft' | 'saved',
    name: row.name as string,
    notes: (row.notes as string | null) ?? null,
    total_grams,
    calories,
    protein_g,
    carbs_g,
    fat_g,
    fiber_g,
    sugar_g,
    sodium_mg,
    per100g,
    ingredients,
    servings,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

/**
 * Delete empty drafts (name blank AND no ingredients) for a user.
 * Called as best-effort cleanup — errors are silently swallowed.
 */
async function cleanupEmptyDrafts(userUuid: string): Promise<void> {
  try {
    const [drafts] = await pool.query<RowDataPacket[]>(
      `SELECT cf.id FROM custom_foods cf
       WHERE cf.user_uuid = UUID_TO_BIN(?)
         AND cf.status = 'draft'
         AND (cf.name = '' OR cf.name IS NULL)
         AND NOT EXISTS (
           SELECT 1 FROM custom_food_ingredients cfi WHERE cfi.custom_food_id = cf.id
         )`,
      [userUuid],
    );
    for (const draft of drafts) {
      const draftId = draft.id as number;
      await pool.query(`DELETE FROM custom_food_servings WHERE custom_food_id = ?`, [draftId]);
      await pool.query(`DELETE FROM custom_food_ingredients WHERE custom_food_id = ?`, [draftId]);
      await pool.query(`DELETE FROM custom_foods WHERE id = ?`, [draftId]);
    }
  } catch {
    // best-effort; don't break the caller
  }
}

/**
 * Compute batch totals for a custom food input, depending on kind.
 * - meal: sums ingredient rows (including micros).
 * - food: uses macro values from the single ingredient row (if present).
 */
function computeBatchTotals(input: CustomFoodInput): {
  total_grams: number; calories: number; protein_g: number; carbs_g: number; fat_g: number;
  fiber_g: number | null; sugar_g: number | null; sodium_mg: number | null;
} {
  if (input.kind === 'meal') {
    return sumIngredientsFull(input.ingredients);
  }
  // food mode: macro values come from the single ingredient row (if present)
  if (input.ingredients.length > 0) {
    const ing = input.ingredients[0];
    return {
      total_grams: ing.grams,
      calories: ing.calories,
      protein_g: ing.protein_g,
      carbs_g: ing.carbs_g,
      fat_g: ing.fat_g,
      fiber_g: ing.fiber_g ?? null,
      sugar_g: ing.sugar_g ?? null,
      sodium_mg: ing.sodium_mg ?? null,
    };
  }
  return { total_grams: 0, calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: null, sugar_g: null, sodium_mg: null };
}

/** Insert ingredient and serving child rows inside an open transaction connection. */
async function upsertChildren(
  conn: PoolConnection,
  customFoodId: number,
  input: CustomFoodInput,
  resolvedServings: CustomFoodInput['servings'],
): Promise<void> {
  await conn.query(`DELETE FROM custom_food_ingredients WHERE custom_food_id = ?`, [customFoodId]);
  if (input.ingredients.length > 0) {
    const placeholders = input.ingredients.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
    const values: unknown[] = [];
    for (const ing of input.ingredients) {
      values.push(
        customFoodId, ing.name, ing.grams, ing.source, ing.source_ref ?? null,
        ing.calories, ing.protein_g, ing.carbs_g, ing.fat_g,
        ing.fiber_g ?? null, ing.sugar_g ?? null, ing.sodium_mg ?? null,
      );
    }
    await conn.query(
      `INSERT INTO custom_food_ingredients
         (custom_food_id, name, grams, source, source_ref, calories, protein_g, carbs_g, fat_g, fiber_g, sugar_g, sodium_mg)
       VALUES ${placeholders}`,
      values,
    );
  }

  await conn.query(`DELETE FROM custom_food_servings WHERE custom_food_id = ?`, [customFoodId]);
  if (resolvedServings.length > 0) {
    const placeholders = resolvedServings.map(() => '(?, ?, ?, ?, ?, ?)').join(', ');
    const values: unknown[] = [];
    for (let i = 0; i < resolvedServings.length; i++) {
      const s = resolvedServings[i];
      values.push(customFoodId, s.label, s.def_type, s.def_value, s.grams, i);
    }
    await conn.query(
      `INSERT INTO custom_food_servings (custom_food_id, label, def_type, def_value, grams, sort_order)
       VALUES ${placeholders}`,
      values,
    );
  }
}

/**
 * Create a custom food/meal.
 * If status='draft', upserts a single draft per (user, kind) to avoid duplicates.
 */
export async function createCustomFood(userUuid: string, input: CustomFoodInput): Promise<CustomFoodRow> {
  const totals = computeBatchTotals(input);
  const resolvedServings = resolveServingGrams(input.servings, totals.total_grams);

  if (input.status === 'draft') {
    const [existingRows] = await pool.query<RowDataPacket[]>(
      `SELECT id FROM custom_foods
       WHERE user_uuid = UUID_TO_BIN(?) AND status = 'draft' AND kind = ?
       ORDER BY id ASC LIMIT 1`,
      [userUuid, input.kind],
    );

    if (existingRows.length > 0) {
      const id = existingRows[0].id as number;
      await withTransaction(async (conn) => {
        await conn.query(
          `UPDATE custom_foods
           SET name = ?, notes = ?, total_grams = ?, calories = ?, protein_g = ?,
               carbs_g = ?, fat_g = ?, fiber_g = ?, sugar_g = ?, sodium_mg = ?
           WHERE id = ?`,
          [
            input.name, input.notes ?? null,
            totals.total_grams, totals.calories, totals.protein_g,
            totals.carbs_g, totals.fat_g, totals.fiber_g ?? null,
            totals.sugar_g ?? null, totals.sodium_mg ?? null,
            id,
          ],
        );
        await upsertChildren(conn, id, input, resolvedServings);
      });
      return (await getCustomFood(userUuid, id))!;
    }
  }

  const id = await withTransaction(async (conn) => {
    const [result] = await conn.query<ResultSetHeader>(
      `INSERT INTO custom_foods
         (user_uuid, kind, status, name, notes, total_grams, calories, protein_g, carbs_g, fat_g, fiber_g, sugar_g, sodium_mg)
       VALUES (UUID_TO_BIN(?), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        userUuid, input.kind, input.status, input.name, input.notes ?? null,
        totals.total_grams, totals.calories, totals.protein_g,
        totals.carbs_g, totals.fat_g, totals.fiber_g ?? null,
        totals.sugar_g ?? null, totals.sodium_mg ?? null,
      ],
    );
    const newId = result.insertId;
    await upsertChildren(conn, newId, input, resolvedServings);
    return newId;
  });

  return (await getCustomFood(userUuid, id))!;
}

/** Fetch a single custom food/meal by id, scoped to the user. Returns null if not found. */
export async function getCustomFood(userUuid: string, id: number): Promise<CustomFoodRow | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, kind, status, name, notes, total_grams, calories, protein_g, carbs_g, fat_g,
            fiber_g, sugar_g, sodium_mg, created_at, updated_at
     FROM custom_foods
     WHERE id = ? AND user_uuid = UUID_TO_BIN(?)`,
    [id, userUuid],
  );
  if (rows.length === 0) return null;
  return buildCustomFoodRow(rows[0]);
}

/** List all custom foods/meals for a user, optionally filtered by status. */
export async function listCustomFoods(userUuid: string, status?: 'draft' | 'saved'): Promise<CustomFoodRow[]> {
  await cleanupEmptyDrafts(userUuid);

  const params: unknown[] = [userUuid];
  let where = 'WHERE user_uuid = UUID_TO_BIN(?)';
  if (status) {
    where += ' AND status = ?';
    params.push(status);
  }

  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, kind, status, name, notes, total_grams, calories, protein_g, carbs_g, fat_g,
            fiber_g, sugar_g, sodium_mg, created_at, updated_at
     FROM custom_foods
     ${where}
     ORDER BY updated_at DESC`,
    params,
  );

  const results: CustomFoodRow[] = [];
  for (const row of rows) {
    results.push(await buildCustomFoodRow(row));
  }
  return results;
}

/** Update a custom food/meal. Returns null if not found / not owned. */
export async function updateCustomFood(
  userUuid: string,
  id: number,
  input: CustomFoodInput,
): Promise<CustomFoodRow | null> {
  const totals = computeBatchTotals(input);
  const resolvedServings = resolveServingGrams(input.servings, totals.total_grams);

  const updated = await withTransaction(async (conn) => {
    const [check] = await conn.query<ResultSetHeader>(
      `UPDATE custom_foods
       SET kind = ?, status = ?, name = ?, notes = ?, total_grams = ?,
           calories = ?, protein_g = ?, carbs_g = ?, fat_g = ?,
           fiber_g = ?, sugar_g = ?, sodium_mg = ?
       WHERE id = ? AND user_uuid = UUID_TO_BIN(?)`,
      [
        input.kind, input.status, input.name, input.notes ?? null,
        totals.total_grams, totals.calories, totals.protein_g,
        totals.carbs_g, totals.fat_g, totals.fiber_g ?? null,
        totals.sugar_g ?? null, totals.sodium_mg ?? null,
        id, userUuid,
      ],
    );
    if (check.affectedRows === 0) return false;
    await upsertChildren(conn, id, input, resolvedServings);
    return true;
  });

  if (!updated) return null;
  return getCustomFood(userUuid, id);
}

/** Hard delete a custom food/meal + its children. Returns false if not found. */
export async function deleteCustomFood(userUuid: string, id: number): Promise<boolean> {
  return withTransaction(async (conn) => {
    const [check] = await conn.query<RowDataPacket[]>(
      `SELECT id FROM custom_foods WHERE id = ? AND user_uuid = UUID_TO_BIN(?)`,
      [id, userUuid],
    );
    if (check.length === 0) return false;

    await conn.query(`DELETE FROM custom_food_ingredients WHERE custom_food_id = ?`, [id]);
    await conn.query(`DELETE FROM custom_food_servings WHERE custom_food_id = ?`, [id]);
    const [result] = await conn.query<ResultSetHeader>(
      `DELETE FROM custom_foods WHERE id = ? AND user_uuid = UUID_TO_BIN(?)`,
      [id, userUuid],
    );
    return result.affectedRows > 0;
  });
}

/**
 * Clone a saved custom food/meal into a new draft row (duplicate-as-template).
 * Always inserts a fresh row (does not merge into any existing draft).
 * Returns null if the source is not found / not owned.
 */
export async function duplicateCustomFood(userUuid: string, id: number): Promise<CustomFoodRow | null> {
  const source = await getCustomFood(userUuid, id);
  if (!source) return null;

  const input: CustomFoodInput = {
    kind: source.kind,
    name: source.name,
    notes: source.notes,
    status: 'draft',
    ingredients: source.ingredients,
    servings: source.servings,
  };

  const totals = computeBatchTotals(input);
  const resolvedServings = resolveServingGrams(input.servings, totals.total_grams);

  const newId = await withTransaction(async (conn) => {
    const [result] = await conn.query<ResultSetHeader>(
      `INSERT INTO custom_foods
         (user_uuid, kind, status, name, notes, total_grams, calories, protein_g, carbs_g, fat_g, fiber_g, sugar_g, sodium_mg)
       VALUES (UUID_TO_BIN(?), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        userUuid, input.kind, 'draft', input.name, input.notes ?? null,
        totals.total_grams, totals.calories, totals.protein_g,
        totals.carbs_g, totals.fat_g, totals.fiber_g ?? null,
        totals.sugar_g ?? null, totals.sodium_mg ?? null,
      ],
    );
    const insertedId = result.insertId;
    await upsertChildren(conn, insertedId, input, resolvedServings);
    return insertedId;
  });

  return getCustomFood(userUuid, newId);
}

/**
 * FULLTEXT/LIKE search over saved custom foods/meals.
 * Returns FoodSearchResult-shaped objects (source='custom') with portions attached.
 */
export async function searchCustomFoods(userUuid: string, query: string): Promise<FoodSearchResult[]> {
  const likePattern = `%${query.replace(/[%_\\]/g, '\\$&')}%`;

  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, kind, name, total_grams, calories, protein_g, carbs_g, fat_g,
            fiber_g, sugar_g, sodium_mg
     FROM custom_foods
     WHERE user_uuid = UUID_TO_BIN(?)
       AND status = 'saved'
       AND name LIKE ?
     ORDER BY updated_at DESC
     LIMIT 10`,
    [userUuid, likePattern],
  );

  const results: FoodSearchResult[] = [];
  for (const row of rows) {
    const id = row.id as number;
    const total_grams = row.total_grams as number;
    const per100g = derivePer100g(
      row.calories as number, row.protein_g as number, row.carbs_g as number, row.fat_g as number,
      row.fiber_g as number | null, row.sugar_g as number | null, row.sodium_mg as number | null,
      total_grams,
    );
    const servings = await fetchCustomServings(id);

    const portions: FoodSearchResult['portions'] = [
      { label: 'full batch', grams: total_grams > 0 ? total_grams : 1 },
      ...servings.map((s) => ({ label: s.label, grams: s.grams })),
    ];

    results.push({
      name: row.name as string,
      source: 'custom',
      source_ref: String(id),
      per100g,
      portions,
    });
  }

  return results;
}

/**
 * Most recently logged custom items by joining food_entries.from_custom_food_id.
 * Returns FoodSearchResult-shaped objects for the "Recently used" row in the UI.
 */
export async function recentCustomFoods(userUuid: string, limit = 5): Promise<FoodSearchResult[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT cf.id, cf.kind, cf.name, cf.total_grams, cf.calories, cf.protein_g, cf.carbs_g,
            cf.fat_g, cf.fiber_g, cf.sugar_g, cf.sodium_mg,
            MAX(fe.logged_at) as last_logged
     FROM food_entries fe
     INNER JOIN custom_foods cf ON cf.id = fe.from_custom_food_id
     WHERE fe.user_uuid = UUID_TO_BIN(?)
       AND cf.user_uuid = UUID_TO_BIN(?)
       AND cf.status = 'saved'
     GROUP BY cf.id, cf.kind, cf.name, cf.total_grams, cf.calories, cf.protein_g,
              cf.carbs_g, cf.fat_g, cf.fiber_g, cf.sugar_g, cf.sodium_mg
     ORDER BY last_logged DESC
     LIMIT ?`,
    [userUuid, userUuid, limit],
  );

  const results: FoodSearchResult[] = [];
  for (const row of rows) {
    const id = row.id as number;
    const total_grams = row.total_grams as number;
    const per100g = derivePer100g(
      row.calories as number, row.protein_g as number, row.carbs_g as number, row.fat_g as number,
      row.fiber_g as number | null, row.sugar_g as number | null, row.sodium_mg as number | null,
      total_grams,
    );
    const servings = await fetchCustomServings(id);

    const portions: FoodSearchResult['portions'] = [
      { label: 'full batch', grams: total_grams > 0 ? total_grams : 1 },
      ...servings.map((s) => ({ label: s.label, grams: s.grams })),
    ];

    results.push({
      name: row.name as string,
      source: 'custom',
      source_ref: String(id),
      per100g,
      portions,
    });
  }

  return results;
}
