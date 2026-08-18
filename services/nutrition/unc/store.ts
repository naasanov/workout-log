// DB access layer for UNC dining cache tables (unc_recipes, unc_menu_days, unc_menu_items).
// Pure persistence -- no network calls live here (those belong in scrape.ts / index.ts),
// mirroring the split in services/nutrition/store.ts (data access) vs providers.ts
// (external fetches). Table shapes: migrations/018_unc_dining.sql.
import { RowDataPacket } from 'mysql2';
import pool from '../../../database';
import withTransaction from '../../../utils/withTransaction';
import { UncMenuItem, UncPerServing, parsePeriodLabel } from './scrape';

/** A recipe cache row as stored/read from unc_recipes. `dietary` has no equivalent
 *  column on the scraper's UncRecipe (recipe.php panel) -- it only ever comes from the
 *  menu item's own `prop-*` classes -- so callers must supply it explicitly. */
export type RecipeCacheRow = {
  recipe_number: number;
  name: string;
  serving_label: string | null;
  per_serving: UncPerServing;
  allergens: string[];
  dietary: string[];
  ingredients: string | null;
};

/** Freshness metadata for a stored location/date menu day, without loading items. */
export type MenuDayMeta = {
  fetched_at: Date;
  item_count: number;
};

function splitCsv(value: string | null): string[] {
  if (!value) return [];
  return value.split(',').map((v) => v.trim()).filter((v) => v.length > 0);
}

function joinCsv(values: string[]): string | null {
  return values.length > 0 ? values.join(',') : null;
}

function rowToRecipeCacheRow(row: RowDataPacket): RecipeCacheRow {
  return {
    recipe_number: row.recipe_number as number,
    name: row.name as string,
    serving_label: (row.serving_label as string | null) ?? null,
    per_serving: {
      calories: row.calories ?? null,
      protein_g: row.protein_g ?? null,
      carbs_g: row.carbs_g ?? null,
      fat_g: row.fat_g ?? null,
      fiber_g: row.fiber_g ?? null,
      sugar_g: row.sugar_g ?? null,
      added_sugar_g: row.added_sugar_g ?? null,
      sodium_mg: row.sodium_mg ?? null,
      cholesterol_mg: row.cholesterol_mg ?? null,
      sat_fat_g: row.sat_fat_g ?? null,
      trans_fat_g: row.trans_fat_g ?? null,
      calcium_mg: row.calcium_mg ?? null,
      iron_mg: row.iron_mg ?? null,
      potassium_mg: row.potassium_mg ?? null,
      vitamin_d_mcg: row.vitamin_d_mcg ?? null,
    },
    allergens: splitCsv(row.allergens as string | null),
    dietary: splitCsv(row.dietary as string | null),
    ingredients: (row.ingredients as string | null) ?? null,
  };
}

/** Which of these recipe_numbers already have a permanently-cached row. */
export async function getCachedRecipeNumbers(recipeNumbers: number[]): Promise<Set<number>> {
  if (recipeNumbers.length === 0) return new Set();
  const placeholders = recipeNumbers.map(() => '?').join(', ');
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT recipe_number FROM unc_recipes WHERE recipe_number IN (${placeholders})`,
    recipeNumbers,
  );
  return new Set(rows.map((r) => r.recipe_number as number));
}

/** Fetch cached recipe rows keyed by recipe_number (missing numbers simply absent from the map). */
export async function getRecipesByNumbers(recipeNumbers: number[]): Promise<Map<number, RecipeCacheRow>> {
  const map = new Map<number, RecipeCacheRow>();
  if (recipeNumbers.length === 0) return map;
  const placeholders = recipeNumbers.map(() => '?').join(', ');
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT * FROM unc_recipes WHERE recipe_number IN (${placeholders})`,
    recipeNumbers,
  );
  for (const row of rows) {
    const rec = rowToRecipeCacheRow(row);
    map.set(rec.recipe_number, rec);
  }
  return map;
}

/** Permanently cache recipe rows. recipe_number is UNC's own stable global id, so this
 *  is effectively insert-once; ON DUPLICATE KEY UPDATE is only a safety net against a
 *  race between two concurrent fetches of the same never-before-seen recipe_number. */
export async function saveRecipes(rows: RecipeCacheRow[]): Promise<void> {
  if (rows.length === 0) return;
  const placeholders = rows.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
  const values: unknown[] = [];
  for (const r of rows) {
    const p = r.per_serving;
    values.push(
      r.recipe_number, r.name, r.serving_label,
      p.calories, p.protein_g, p.carbs_g, p.fat_g,
      p.fiber_g, p.sugar_g, p.added_sugar_g,
      p.sodium_mg, p.cholesterol_mg,
      p.sat_fat_g, p.trans_fat_g,
      p.calcium_mg, p.iron_mg, p.potassium_mg, p.vitamin_d_mcg,
      joinCsv(r.allergens), joinCsv(r.dietary), r.ingredients,
      new Date(),
    );
  }
  await pool.query(
    `INSERT INTO unc_recipes
       (recipe_number, name, serving_label, calories, protein_g, carbs_g, fat_g,
        fiber_g, sugar_g, added_sugar_g, sodium_mg, cholesterol_mg,
        sat_fat_g, trans_fat_g, calcium_mg, iron_mg, potassium_mg, vitamin_d_mcg,
        allergens, dietary, ingredients, fetched_at)
     VALUES ${placeholders}
     ON DUPLICATE KEY UPDATE
       name = VALUES(name), serving_label = VALUES(serving_label),
       calories = VALUES(calories), protein_g = VALUES(protein_g), carbs_g = VALUES(carbs_g), fat_g = VALUES(fat_g),
       fiber_g = VALUES(fiber_g), sugar_g = VALUES(sugar_g), added_sugar_g = VALUES(added_sugar_g),
       sodium_mg = VALUES(sodium_mg), cholesterol_mg = VALUES(cholesterol_mg),
       sat_fat_g = VALUES(sat_fat_g), trans_fat_g = VALUES(trans_fat_g),
       calcium_mg = VALUES(calcium_mg), iron_mg = VALUES(iron_mg), potassium_mg = VALUES(potassium_mg), vitamin_d_mcg = VALUES(vitamin_d_mcg),
       allergens = VALUES(allergens), dietary = VALUES(dietary), ingredients = VALUES(ingredients),
       fetched_at = VALUES(fetched_at)`,
    values,
  );
}

/** Freshness check for a location/date without paying for the item JOIN. Null = never fetched. */
export async function getMenuDayMeta(slug: string, date: string): Promise<MenuDayMeta | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT fetched_at, item_count FROM unc_menu_days WHERE location_slug = ? AND menu_date = ?`,
    [slug, date],
  );
  if (rows.length === 0) return null;
  return { fetched_at: rows[0].fetched_at as Date, item_count: rows[0].item_count as number };
}

/** MySQL TIME columns come back as 'HH:MM:SS' strings; scrape.ts's convention is 'HH:MM'
 *  (with '24:00' for midnight-as-end-of-day) -- trim to match. */
function timeColToHHMM(value: unknown): string | null {
  if (value == null) return null;
  return String(value).slice(0, 5);
}

/** Reconstruct a location/date's stored items as UncMenuItem[], joining unc_recipes for
 *  name/allergens/dietary (unc_menu_items itself only stores the recipe_number linkage).
 *  If a recipe_number was never successfully cached (a past fetchRecipe failure), that
 *  item's name/allergens/dietary come back empty -- it will be retried the next time
 *  this recipe_number is encountered, since getCachedRecipeNumbers still won't find it. */
export async function getMenuDayItems(slug: string, date: string): Promise<UncMenuItem[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT mi.id, mi.meal_period, mi.period_start, mi.period_end, mi.station, mi.recipe_number,
            r.name AS recipe_name, r.allergens AS recipe_allergens, r.dietary AS recipe_dietary
     FROM unc_menu_items mi
     LEFT JOIN unc_recipes r ON r.recipe_number = mi.recipe_number
     WHERE mi.location_slug = ? AND mi.menu_date = ?
     ORDER BY mi.id ASC`,
    [slug, date],
  );

  return rows.map((row) => {
    const rawPeriod = row.meal_period as string;
    // period_label is derivable from meal_period (the raw tab label) -- no need for a
    // separate column; reuse the exact parser the scraper used to produce it originally.
    const { period_label } = parsePeriodLabel(rawPeriod);
    const name = (row.recipe_name as string | null) ?? '';
    return {
      meal_period: rawPeriod,
      period_label,
      period_start: timeColToHHMM(row.period_start),
      period_end: timeColToHHMM(row.period_end),
      station: row.station as string,
      recipe_number: row.recipe_number as number,
      name,
      allergens: splitCsv(row.recipe_allergens as string | null),
      dietary: splitCsv(row.recipe_dietary as string | null),
      ingredients_search: name,
    };
  });
}

/**
 * Persist a location/date's scraped items (unc_menu_days + unc_menu_items).
 *
 * CRITICAL GUARD: if `items` is empty AND we already have a stored day with
 * item_count > 0, this is a NO-OP on the items themselves (only fetched_at is bumped).
 * WHY: UNC purges past menus after ~5-8 days and returns an ordinary HTTP 200 with zero
 * items for both "nothing published" and "purged" -- there is no way to distinguish an
 * empty response caused by staleness/a transient scrape hiccup from a real "this day
 * has no menu" fact once we already know the day had food. Blindly overwriting here
 * would silently destroy a permanent archive record. This looks like redundant
 * defensiveness -- it is not; do not remove it "to simplify".
 */
export async function saveMenuDay(slug: string, date: string, items: UncMenuItem[]): Promise<void> {
  const fetchedAt = new Date();

  if (items.length === 0) {
    const existing = await getMenuDayMeta(slug, date);
    if (existing && existing.item_count > 0) {
      // Guarded: keep the archived items, just record that we checked (so TTL-driven
      // callers don't hammer the network again immediately).
      await pool.query(
        `UPDATE unc_menu_days SET fetched_at = ? WHERE location_slug = ? AND menu_date = ?`,
        [fetchedAt, slug, date],
      );
      return;
    }
    await pool.query(
      `INSERT INTO unc_menu_days (location_slug, menu_date, fetched_at, item_count)
       VALUES (?, ?, ?, 0)
       ON DUPLICATE KEY UPDATE fetched_at = VALUES(fetched_at), item_count = VALUES(item_count)`,
      [slug, date, fetchedAt],
    );
    return;
  }

  await withTransaction(async (conn) => {
    await conn.query(
      `INSERT INTO unc_menu_days (location_slug, menu_date, fetched_at, item_count)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE fetched_at = VALUES(fetched_at), item_count = VALUES(item_count)`,
      [slug, date, fetchedAt, items.length],
    );
    await conn.query(`DELETE FROM unc_menu_items WHERE location_slug = ? AND menu_date = ?`, [slug, date]);
    const placeholders = items.map(() => '(?, ?, ?, ?, ?, ?, ?)').join(', ');
    const values: unknown[] = [];
    for (const item of items) {
      values.push(slug, date, item.meal_period, item.period_start, item.period_end, item.station, item.recipe_number);
    }
    await conn.query(
      `INSERT INTO unc_menu_items (location_slug, menu_date, meal_period, period_start, period_end, station, recipe_number)
       VALUES ${placeholders}`,
      values,
    );
  });
}
