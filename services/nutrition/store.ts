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
import pool from '../../database';
import withTransaction from '../../utils/withTransaction';
import { EntryInput, EntryRow, DayResponse, Goals, IngredientRow } from '../../schemas/nutrition';

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

type IngredientInput = { calories: number; protein_g: number; carbs_g: number; fat_g: number };

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
