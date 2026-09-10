// Characterization tests for routes/nutrition.ts and services/nutrition/store.ts,
// pinning CURRENT behavior so the upcoming services/agent/ restructure and the
// chat-transcript re-keying (user, date) -> conversation can be verified against
// these as a baseline. Exercises real HTTP requests through the actual router
// against a real MySQL schema (workout_log_test) rather than mocking pool.query.
//
// Out of scope (needs network + API keys, explicitly excluded by the task):
//   - POST /chat (live OpenAI call)
//   - GET /foods/search (USDA / OpenFoodFacts)
//   - GET /barcode/:code (OpenFoodFacts)
//   - GET /portions (USDA / OpenFoodFacts)
// Each is skipped explicitly below with a comment, not stubbed.
//
// Requires a reachable database (see scripts/testDb.js). If none is reachable,
// every test here is skipped (not failed) so `npm test` still passes for
// someone who hasn't started Docker.
//
// Run with: node --test tests/nutrition.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../scripts/testDb');

function ing(overrides = {}) {
  return {
    name: 'Ingredient',
    grams: 100,
    source: 'manual',
    calories: 100,
    protein_g: 10,
    carbs_g: 10,
    fat_g: 10,
    ...overrides,
  };
}

function entryBody(overrides = {}) {
  return {
    localDate: '2024-01-01',
    meal: 'breakfast',
    name: 'Test Meal',
    source: 'manual',
    ingredients: [ing()],
    ...overrides,
  };
}

async function post(baseUrl, user, path, body) {
  const res = await fetch(`${baseUrl}/api/nutrition${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...user.authHeader() },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : undefined };
}

async function patch(baseUrl, user, path, body) {
  const res = await fetch(`${baseUrl}/api/nutrition${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...user.authHeader() },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : undefined };
}

async function get(baseUrl, user, path) {
  const res = await fetch(`${baseUrl}/api/nutrition${path}`, { headers: user.authHeader() });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : undefined };
}

async function del(baseUrl, user, path) {
  const res = await fetch(`${baseUrl}/api/nutrition${path}`, {
    method: 'DELETE',
    headers: user.authHeader(),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : undefined };
}

async function put(baseUrl, user, path, body) {
  const res = await fetch(`${baseUrl}/api/nutrition${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...user.authHeader() },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : undefined };
}

test('nutrition routes + store', async (t) => {
  const available = await db.isDbReachable();
  if (!available) {
    t.skip('No reachable database on 127.0.0.1:3307. Start it with: docker compose up -d, then npm run db:setup (see scripts/testDb.js).');
    return;
  }

  await db.setupTestDb();
  const nutrition = db.requireTs('routes/nutrition.ts').default;
  const store = db.requireTs('services/nutrition/store.ts');
  const transcripts = db.requireTs('services/nutrition/transcripts.ts');
  const { server, baseUrl } = await db.startTestServer('/api/nutrition', nutrition);
  const pool = db.getPool();

  // Returns the DB server's own CURDATE() offset by `days`, formatted as
  // YYYY-MM-DD, so boundary assertions never depend on the test runner's
  // local timezone matching the DB server's.
  async function dbDate(days) {
    const [[row]] = await pool.query(
      `SELECT DATE_FORMAT(CURDATE() - INTERVAL ? DAY, '%Y-%m-%d') as d`,
      [days],
    );
    return row.d;
  }

  // scripts/testDb.js's createTestUser occasionally throws "Cannot read
  // properties of undefined (reading 'uuid')" -- an intermittent (~1-10%)
  // read-your-own-write miss on the shared test pool immediately after a
  // TRUNCATE, reproducible with testDb.js alone and unrelated to anything
  // in this file. Retrying is a local workaround; testDb.js itself is owned
  // by a different wave and is not touched here.
  async function createUser(overrides) {
    let lastErr;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await db.createTestUser(overrides);
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr;
  }

  t.beforeEach(async () => {
    await db.resetDb();
  });

  t.after(async () => {
    await db.stopTestServer(server);
    await db.closePool();
  });

  await t.test('skipped: GET /foods/search requires USDA/OpenFoodFacts network access + API keys', () => {});
  await t.test('skipped: GET /barcode/:code requires OpenFoodFacts network access', () => {});
  await t.test('skipped: GET /portions requires USDA/OpenFoodFacts network access', () => {});
  await t.test('skipped: POST /chat requires a live OpenAI call', () => {});

  // ---- Auth ----

  await t.test('rejects an unauthenticated request', async () => {
    const res = await fetch(`${baseUrl}/api/nutrition/goals`);
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.message, 'Unauthorized: access token required');
  });

  await t.test('rejects a request with a garbage bearer token', async () => {
    const res = await fetch(`${baseUrl}/api/nutrition/goals`, {
      headers: { Authorization: 'Bearer not-a-real-token' },
    });
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.message, 'Forbidden access token');
  });

  // ---- Entries CRUD ----

  await t.test('POST /entries creates an entry with multiple ingredients and sums totals', async () => {
    const user = await createUser();
    const body = entryBody({
      ingredients: [
        ing({ name: 'Chicken Breast', grams: 150, calories: 250, protein_g: 47, carbs_g: 0, fat_g: 5.4 }),
        ing({ name: 'Rice', grams: 200, calories: 260, protein_g: 5.4, carbs_g: 56, fat_g: 0.6, fiber_g: 1.2 }),
      ],
    });
    const { status, body: resBody } = await post(baseUrl, user, '/entries', body);
    assert.equal(status, 201);
    assert.equal(resBody.message, 'Entry created');
    assert.equal(typeof resBody.data.id, 'number');
    assert.equal(resBody.data.calories, 510);
    assert.equal(resBody.data.protein_g, 52.4);
    assert.equal(resBody.data.carbs_g, 56);
    assert.equal(Math.round(resBody.data.fat_g * 10) / 10, 6.0);
    // Only one ingredient set fiber_g -> entry total is that ingredient's value, not null.
    assert.equal(resBody.data.fiber_g, 1.2);
    // Neither ingredient set sugar_g/sodium_mg -> entry total is null, not 0.
    assert.equal(resBody.data.sugar_g, null);
    assert.equal(resBody.data.sodium_mg, null);
  });

  await t.test('POST /entries rejects an invalid body (bad meal enum)', async () => {
    const user = await createUser();
    const { status, body } = await post(baseUrl, user, '/entries', entryBody({ meal: 'brunch' }));
    assert.equal(status, 400);
    assert.equal(typeof body.message, 'string');
  });

  await t.test('POST /entries rejects an ingredient with both grams and serving basis', async () => {
    const user = await createUser();
    const { status } = await post(baseUrl, user, '/entries', entryBody({
      ingredients: [ing({ grams: 100, serving_qty: 1, serving_label: 'cup' })],
    }));
    assert.equal(status, 400);
  });

  await t.test('GET /entries/:id round-trips ingredients (name, grams, source, macros)', async () => {
    const user = await createUser();
    const body = entryBody({
      ingredients: [
        ing({ name: 'Chicken Breast', grams: 150, source: 'usda', source_ref: '12345', calories: 250, protein_g: 47, carbs_g: 0, fat_g: 5.4 }),
        ing({ name: 'Rice', grams: 200, calories: 260, protein_g: 5.4, carbs_g: 56, fat_g: 0.6, fiber_g: 1.2 }),
      ],
    });
    const { body: created } = await post(baseUrl, user, '/entries', body);
    const id = created.data.id;

    const { status, body: got } = await get(baseUrl, user, `/entries/${id}`);
    assert.equal(status, 200);
    assert.equal(got.data.id, id);
    assert.equal(got.data.date, '2024-01-01');
    assert.equal(got.data.meal, 'breakfast');
    assert.equal(got.data.ingredients.length, 2);
    assert.equal(got.data.ingredients[0].name, 'Chicken Breast');
    assert.equal(got.data.ingredients[0].grams, 150);
    assert.equal(got.data.ingredients[0].source, 'usda');
    assert.equal(got.data.ingredients[0].source_ref, '12345');
    assert.equal(got.data.ingredients[1].name, 'Rice');
    assert.equal(got.data.ingredients[1].fiber_g, 1.2);
  });

  await t.test('GET /entries/:id 404s for a non-existent id', async () => {
    const user = await createUser();
    const { status, body } = await get(baseUrl, user, '/entries/999999');
    assert.equal(status, 404);
    assert.equal(body.message, 'Entry 999999 not found');
  });

  await t.test('GET /entries/:id 404s when the entry belongs to another user', async () => {
    const userA = await createUser();
    const userB = await createUser();
    const { body: created } = await post(baseUrl, userB, '/entries', entryBody());
    const id = created.data.id;

    const { status } = await get(baseUrl, userA, `/entries/${id}`);
    assert.equal(status, 404);
  });

  await t.test('GET /entries/:id rejects a non-integer id before touching the database', async () => {
    const user = await createUser();
    const { status, body } = await get(baseUrl, user, '/entries/abc');
    assert.equal(status, 400);
    assert.equal(body.message, 'Request parameter id must be a positive integer');
  });

  await t.test('PATCH /entries/:id replaces fields and ingredients, recomputing totals', async () => {
    const user = await createUser();
    const { body: created } = await post(baseUrl, user, '/entries', entryBody());
    const id = created.data.id;

    const { status, body } = await patch(baseUrl, user, `/entries/${id}`, entryBody({
      meal: 'dinner',
      name: 'Updated Meal',
      ingredients: [ing({ name: 'New Ingredient', grams: 50, calories: 40, protein_g: 4, carbs_g: 4, fat_g: 1 })],
    }));
    assert.equal(status, 200);
    assert.equal(body.data.meal, 'dinner');
    assert.equal(body.data.name, 'Updated Meal');
    assert.equal(body.data.calories, 40);
    assert.equal(body.data.ingredients.length, 1);
    assert.equal(body.data.ingredients[0].name, 'New Ingredient');
  });

  await t.test('PATCH /entries/:id 404s for a non-existent id', async () => {
    const user = await createUser();
    const { status, body } = await patch(baseUrl, user, '/entries/999999', entryBody());
    assert.equal(status, 404);
    assert.equal(body.message, 'Entry 999999 not found');
  });

  await t.test('PATCH /entries/:id 404s when the entry belongs to another user', async () => {
    const userA = await createUser();
    const userB = await createUser();
    const { body: created } = await post(baseUrl, userB, '/entries', entryBody());
    const id = created.data.id;

    const { status } = await patch(baseUrl, userA, `/entries/${id}`, entryBody({ name: 'Hijacked' }));
    assert.equal(status, 404);

    const { body: stillB } = await get(baseUrl, userB, `/entries/${id}`);
    assert.equal(stillB.data.name, 'Test Meal');
  });

  await t.test('DELETE /entries/:id removes an entry the user owns', async () => {
    const user = await createUser();
    const { body: created } = await post(baseUrl, user, '/entries', entryBody());
    const id = created.data.id;

    const { status, body } = await del(baseUrl, user, `/entries/${id}`);
    assert.equal(status, 200);
    assert.equal(body.message, `Entry ${id} deleted`);

    const { status: getStatus } = await get(baseUrl, user, `/entries/${id}`);
    assert.equal(getStatus, 404);
  });

  await t.test('DELETE /entries/:id 404s when the entry belongs to another user', async () => {
    const userA = await createUser();
    const userB = await createUser();
    const { body: created } = await post(baseUrl, userB, '/entries', entryBody());
    const id = created.data.id;

    const { status } = await del(baseUrl, userA, `/entries/${id}`);
    assert.equal(status, 404);

    const { status: stillThere } = await get(baseUrl, userB, `/entries/${id}`);
    assert.equal(stillThere, 200);
  });

  // ---- GET /day/:date ----

  await t.test('GET /day/:date rejects a malformed date', async () => {
    const user = await createUser();
    const { status, body } = await get(baseUrl, user, '/day/not-a-date');
    assert.equal(status, 400);
    assert.equal(body.message, 'date must be in YYYY-MM-DD format');
  });

  await t.test('GET /day/:date returns zeroed totals and no entries for a day with none', async () => {
    const user = await createUser();
    const { status, body } = await get(baseUrl, user, '/day/2024-06-01');
    assert.equal(status, 200);
    assert.deepEqual(body.data.entries, []);
    assert.deepEqual(body.data.totals, {
      calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0, sugar_g: 0, sodium_mg: 0,
    });
  });

  await t.test('GET /day/:date sums calories/protein/carbs/fat/fiber/sugar/sodium precisely across meals', async () => {
    const user = await createUser();
    const date = '2024-07-04';

    // breakfast: fiber, sugar, sodium all set
    await post(baseUrl, user, '/entries', entryBody({
      localDate: date, meal: 'breakfast', name: 'Breakfast',
      ingredients: [ing({ grams: 100, calories: 200, protein_g: 10, carbs_g: 20, fat_g: 5, fiber_g: 2, sugar_g: 3, sodium_mg: 50 })],
    }));
    // lunch: no fiber/sugar/sodium on any ingredient -> entry totals are null
    await post(baseUrl, user, '/entries', entryBody({
      localDate: date, meal: 'lunch', name: 'Lunch',
      ingredients: [ing({ grams: 150, calories: 300, protein_g: 25, carbs_g: 30, fat_g: 10 })],
    }));
    // dinner: two ingredients, fiber only on one, sugar+sodium only on the other
    await post(baseUrl, user, '/entries', entryBody({
      localDate: date, meal: 'dinner', name: 'Dinner',
      ingredients: [
        ing({ name: 'C', grams: 80, calories: 150, protein_g: 12, carbs_g: 10, fat_g: 6, fiber_g: 1 }),
        ing({ name: 'D', grams: 120, calories: 250, protein_g: 20, carbs_g: 25, fat_g: 8, sugar_g: 5, sodium_mg: 80 }),
      ],
    }));
    // a different day, must not be included
    await post(baseUrl, user, '/entries', entryBody({ localDate: '2024-07-05', name: 'Other day' }));
    // a different user, same day, must not be included
    const otherUser = await createUser();
    await post(baseUrl, otherUser, '/entries', entryBody({ localDate: date, name: 'Other user' }));

    const { status, body } = await get(baseUrl, user, `/day/${date}`);
    assert.equal(status, 200);
    assert.equal(body.data.entries.length, 3);
    assert.deepEqual(body.data.totals, {
      calories: 900,
      protein_g: 67,
      carbs_g: 85,
      fat_g: 29,
      // lunch entry's fiber_g/sugar_g/sodium_mg are null (no ingredient set them);
      // the day-total reducer folds a null entry total to 0, not "unknown".
      fiber_g: 3,
      sugar_g: 8,
      sodium_mg: 130,
    });
  });

  // ---- Goals ----

  await t.test('GET /goals returns an all-null object when no goals row exists', async () => {
    const user = await createUser();
    const { status, body } = await get(baseUrl, user, '/goals');
    assert.equal(status, 200);
    assert.deepEqual(body.data, { calories: null, protein_g: null, carbs_g: null, fat_g: null, fiber_g: null });
  });

  await t.test('PUT /goals stores and GET /goals reflects the same values', async () => {
    const user = await createUser();
    const goals = { calories: 2000, protein_g: 150, carbs_g: 250, fat_g: 70, fiber_g: 30 };
    const { status, body } = await put(baseUrl, user, '/goals', goals);
    assert.equal(status, 200);
    assert.deepEqual(body.data, goals);

    const { body: fetched } = await get(baseUrl, user, '/goals');
    assert.deepEqual(fetched.data, goals);
  });

  await t.test('PUT /goals merges: an absent field leaves the stored value unchanged', async () => {
    const user = await createUser();
    await put(baseUrl, user, '/goals', { calories: 2000, protein_g: 150, carbs_g: 250, fat_g: 70, fiber_g: 30 });
    const { status, body } = await put(baseUrl, user, '/goals', { calories: 1800 });
    assert.equal(status, 200);
    assert.deepEqual(body.data, { calories: 1800, protein_g: 150, carbs_g: 250, fat_g: 70, fiber_g: 30 });

    const { body: fetched } = await get(baseUrl, user, '/goals');
    assert.deepEqual(fetched.data, { calories: 1800, protein_g: 150, carbs_g: 250, fat_g: 70, fiber_g: 30 });
  });

  await t.test('PUT /goals clears a field when it is explicitly set to null', async () => {
    const user = await createUser();
    await put(baseUrl, user, '/goals', { calories: 2000, protein_g: 150, carbs_g: 250, fat_g: 70, fiber_g: 30 });
    const { status, body } = await put(baseUrl, user, '/goals', { protein_g: null });
    assert.equal(status, 200);
    assert.deepEqual(body.data, { calories: 2000, protein_g: null, carbs_g: 250, fat_g: 70, fiber_g: 30 });

    const { body: fetched } = await get(baseUrl, user, '/goals');
    assert.deepEqual(fetched.data, { calories: 2000, protein_g: null, carbs_g: 250, fat_g: 70, fiber_g: 30 });
  });

  // ---- Custom Foods ----

  await t.test('POST /custom-foods (kind: food) uses the single ingredient row as totals, not a sum', async () => {
    const user = await createUser();
    const { status, body } = await post(baseUrl, user, '/custom-foods', {
      kind: 'food', status: 'saved', name: 'Protein Bar',
      ingredients: [ing({ name: 'Bar', grams: 50, calories: 100, protein_g: 10, carbs_g: 5, fat_g: 2, fiber_g: 1, sugar_g: 2, sodium_mg: 30 })],
      servings: [],
    });
    assert.equal(status, 201);
    assert.equal(body.data.kind, 'food');
    assert.equal(body.data.status, 'saved');
    assert.equal(body.data.total_grams, 50);
    assert.equal(body.data.calories, 100);
    assert.deepEqual(body.data.per100g, {
      calories: 200, protein_g: 20, carbs_g: 10, fat_g: 4, fiber_g: 2, sugar_g: 4, sodium_mg: 60,
    });
  });

  await t.test('POST /custom-foods (kind: meal) sums all ingredient rows', async () => {
    const user = await createUser();
    const { status, body } = await post(baseUrl, user, '/custom-foods', {
      kind: 'meal', status: 'saved', name: 'Meal Prep',
      ingredients: [
        ing({ name: 'A', grams: 100, calories: 100, protein_g: 10, carbs_g: 10, fat_g: 10 }),
        ing({ name: 'B', grams: 100, calories: 200, protein_g: 20, carbs_g: 20, fat_g: 5 }),
      ],
      servings: [],
    });
    assert.equal(status, 201);
    assert.equal(body.data.kind, 'meal');
    assert.equal(body.data.total_grams, 200);
    assert.equal(body.data.calories, 300);
    assert.equal(body.data.protein_g, 30);
    assert.equal(body.data.fat_g, 15);
  });

  await t.test('POST /custom-foods with status draft upserts a single draft per (user, kind)', async () => {
    const user = await createUser();
    const { body: first } = await post(baseUrl, user, '/custom-foods', {
      kind: 'food', status: 'draft', name: 'Draft A', ingredients: [], servings: [],
    });
    const { body: second } = await post(baseUrl, user, '/custom-foods', {
      kind: 'food', status: 'draft', name: 'Draft B', ingredients: [], servings: [],
    });
    // Same id -- the second POST overwrote the first draft rather than creating a new row.
    assert.equal(second.data.id, first.data.id);
    assert.equal(second.data.name, 'Draft B');

    const { body: list } = await get(baseUrl, user, '/custom-foods?status=draft');
    assert.equal(list.data.length, 1);
  });

  await t.test('GET /custom-foods rejects an invalid status filter', async () => {
    const user = await createUser();
    const { status, body } = await get(baseUrl, user, '/custom-foods?status=archived');
    assert.equal(status, 400);
    assert.equal(body.message, 'status must be "draft" or "saved"');
  });

  await t.test('GET /custom-foods lists only the authenticated user\'s items, filterable by status', async () => {
    const userA = await createUser();
    const userB = await createUser();
    await post(baseUrl, userA, '/custom-foods', { kind: 'food', status: 'saved', name: 'A Saved', ingredients: [], servings: [] });
    await post(baseUrl, userA, '/custom-foods', { kind: 'meal', status: 'draft', name: 'A Draft', ingredients: [], servings: [] });
    await post(baseUrl, userB, '/custom-foods', { kind: 'food', status: 'saved', name: 'B Saved', ingredients: [], servings: [] });

    const { body: allA } = await get(baseUrl, userA, '/custom-foods');
    assert.equal(allA.data.length, 2);
    const { body: savedA } = await get(baseUrl, userA, '/custom-foods?status=saved');
    assert.equal(savedA.data.length, 1);
    assert.equal(savedA.data[0].name, 'A Saved');
  });

  await t.test('GET /custom-foods/:id 404s for a non-existent id and for another user\'s item', async () => {
    const userA = await createUser();
    const userB = await createUser();
    const { body: created } = await post(baseUrl, userB, '/custom-foods', { kind: 'food', status: 'saved', name: 'B Food', ingredients: [], servings: [] });

    const { status: missing } = await get(baseUrl, userA, '/custom-foods/999999');
    assert.equal(missing, 404);
    const { status: notOwned } = await get(baseUrl, userA, `/custom-foods/${created.data.id}`);
    assert.equal(notOwned, 404);
  });

  await t.test('PATCH /custom-foods/:id updates fields and recomputes totals', async () => {
    const user = await createUser();
    const { body: created } = await post(baseUrl, user, '/custom-foods', {
      kind: 'food', status: 'draft', name: 'Draft', ingredients: [], servings: [],
    });
    const { status, body } = await patch(baseUrl, user, `/custom-foods/${created.data.id}`, {
      kind: 'food', status: 'saved', name: 'Finished',
      ingredients: [ing({ grams: 100, calories: 100, protein_g: 10, carbs_g: 10, fat_g: 10 })],
      servings: [],
    });
    assert.equal(status, 200);
    assert.equal(body.data.status, 'saved');
    assert.equal(body.data.name, 'Finished');
    assert.equal(body.data.calories, 100);
  });

  await t.test('DELETE /custom-foods/:id removes it and 404s on retry / for another user', async () => {
    const userA = await createUser();
    const userB = await createUser();
    const { body: created } = await post(baseUrl, userA, '/custom-foods', { kind: 'food', status: 'saved', name: 'Mine', ingredients: [], servings: [] });
    const id = created.data.id;

    const { status: notOwned } = await del(baseUrl, userB, `/custom-foods/${id}`);
    assert.equal(notOwned, 404);

    const { status: ok } = await del(baseUrl, userA, `/custom-foods/${id}`);
    assert.equal(ok, 200);
    const { status: again } = await del(baseUrl, userA, `/custom-foods/${id}`);
    assert.equal(again, 404);
  });

  await t.test('POST /custom-foods/:id/duplicate always creates a fresh draft, even from a saved source', async () => {
    const user = await createUser();
    const { body: created } = await post(baseUrl, user, '/custom-foods', {
      kind: 'meal', status: 'saved', name: 'Original',
      ingredients: [ing({ grams: 100, calories: 100, protein_g: 10, carbs_g: 10, fat_g: 10 })],
      servings: [],
    });
    const { status, body: dup1 } = await post(baseUrl, user, `/custom-foods/${created.data.id}/duplicate`, {});
    assert.equal(status, 201);
    assert.equal(dup1.data.status, 'draft');
    assert.notEqual(dup1.data.id, created.data.id);
    assert.equal(dup1.data.name, 'Original');

    // Duplicating again does NOT merge into dup1 (unlike POST .../custom-foods
    // with status: draft) -- it always inserts a brand-new row.
    const { body: dup2 } = await post(baseUrl, user, `/custom-foods/${created.data.id}/duplicate`, {});
    assert.notEqual(dup2.data.id, dup1.data.id);

    const { body: drafts } = await get(baseUrl, user, '/custom-foods?status=draft');
    assert.equal(drafts.data.length, 2);
  });

  await t.test('POST /custom-foods/:id/duplicate 404s for a non-existent id', async () => {
    const user = await createUser();
    const { status } = await post(baseUrl, user, '/custom-foods/999999/duplicate', {});
    assert.equal(status, 404);
  });

  await t.test('GET /custom-foods/recent returns saved custom foods logged via from_custom_food_id, most-recent first', async () => {
    const user = await createUser();
    const { body: foodA } = await post(baseUrl, user, '/custom-foods', { kind: 'food', status: 'saved', name: 'Food A', ingredients: [], servings: [] });
    const { body: foodB } = await post(baseUrl, user, '/custom-foods', { kind: 'meal', status: 'saved', name: 'Food B', ingredients: [], servings: [] });

    const { body: loggedA } = await post(baseUrl, user, '/entries', entryBody({ name: 'Logged A', from_custom_food_id: foodA.data.id }));
    const { body: loggedB } = await post(baseUrl, user, '/entries', entryBody({ name: 'Logged B', from_custom_food_id: foodB.data.id }));
    // logged_at is DATETIME (second precision) and defaults to CURRENT_TIMESTAMP,
    // so two POSTs made back-to-back can tie; force a deterministic gap here so
    // "most-recently-logged first" is asserting real ORDER BY behavior, not a coin flip.
    await pool.query('UPDATE food_entries SET logged_at = DATE_SUB(NOW(), INTERVAL 10 MINUTE) WHERE id = ?', [loggedA.data.id]);
    await pool.query('UPDATE food_entries SET logged_at = NOW() WHERE id = ?', [loggedB.data.id]);

    const { status, body } = await get(baseUrl, user, '/custom-foods/recent');
    assert.equal(status, 200);
    assert.equal(body.data.length, 2);
    // most-recently-logged first
    assert.equal(body.data[0].name, 'Food B');
    assert.equal(body.data[0].kind, 'meal');

    const { body: limited } = await get(baseUrl, user, '/custom-foods/recent?limit=1');
    assert.equal(limited.data.length, 1);
    assert.equal(limited.data[0].name, 'Food B');
  });

  // ---- store.recentEntries boundary semantics ----

  await t.test('store.recentEntries(uuid, days) includes date == cutoff and excludes date == cutoff - 1', async () => {
    const user = await createUser();
    const days = 7;
    const cutoffDate = await dbDate(days); // CURDATE() - 7 days, inclusive per the SQL
    const beyondCutoffDate = await dbDate(days + 1); // CURDATE() - 8 days, should be excluded
    const todayDate = await dbDate(0);

    await post(baseUrl, user, '/entries', entryBody({ localDate: todayDate, name: 'Today' }));
    await post(baseUrl, user, '/entries', entryBody({ localDate: cutoffDate, name: 'Exactly at cutoff' }));
    await post(baseUrl, user, '/entries', entryBody({ localDate: beyondCutoffDate, name: 'One day past cutoff' }));

    const entries = await store.recentEntries(user.uuid, days);
    const names = entries.map((e) => e.name).sort();
    assert.deepEqual(names, ['Exactly at cutoff', 'Today']);
  });

  await t.test('store.recentEntries(uuid, 0) only includes today', async () => {
    const user = await createUser();
    const todayDate = await dbDate(0);
    const yesterdayDate = await dbDate(1);

    await post(baseUrl, user, '/entries', entryBody({ localDate: todayDate, name: 'Today' }));
    await post(baseUrl, user, '/entries', entryBody({ localDate: yesterdayDate, name: 'Yesterday' }));

    const entries = await store.recentEntries(user.uuid, 0);
    assert.deepEqual(entries.map((e) => e.name), ['Today']);
  });

  await t.test('store.recentEntries orders newest first (date DESC, logged_at DESC) and is per-user scoped', async () => {
    const userA = await createUser();
    const userB = await createUser();
    const olderDate = await dbDate(3);
    const newerDate = await dbDate(1);

    await post(baseUrl, userA, '/entries', entryBody({ localDate: olderDate, name: 'Older' }));
    await post(baseUrl, userA, '/entries', entryBody({ localDate: newerDate, name: 'Newer' }));
    await post(baseUrl, userB, '/entries', entryBody({ localDate: newerDate, name: 'Other user' }));

    const entries = await store.recentEntries(userA.uuid, 30);
    assert.deepEqual(entries.map((e) => e.name), ['Newer', 'Older']);
  });

  // ---- Transcripts ----

  await t.test('appendMessage + getTranscript preserve insertion order and round-trip parts JSON exactly', async () => {
    const user = await createUser();
    const date = '2024-02-02';
    const partsA = [{ type: 'text', text: 'Hello' }];
    const partsB = [{ type: 'tool-call', toolCallId: 'call_1', args: { nested: { a: [1, 2, 3] }, flag: true } }];
    const partsC = [{ type: 'text', text: 'Goodbye' }];

    await transcripts.appendMessage(user.uuid, date, 'msg-1', 'user', partsA);
    await transcripts.appendMessage(user.uuid, date, 'msg-2', 'assistant', partsB);
    await transcripts.appendMessage(user.uuid, date, 'msg-3', 'user', partsC);

    const rows = await transcripts.getTranscript(user.uuid, date);
    assert.equal(rows.length, 3);
    assert.deepEqual(rows.map((r) => r.message_id), ['msg-1', 'msg-2', 'msg-3']);
    assert.deepEqual(rows.map((r) => r.role), ['user', 'assistant', 'user']);
    assert.deepEqual(rows[1].parts, partsB);
    assert.equal(rows.every((r) => r.interrupted === false), true);
  });

  await t.test('markInterrupted flags only the targeted row', async () => {
    const user = await createUser();
    const date = '2024-02-03';
    const id1 = await transcripts.appendMessage(user.uuid, date, 'm1', 'user', [{ type: 'text', text: 'a' }]);
    const id2 = await transcripts.appendMessage(user.uuid, date, 'm2', 'assistant', [{ type: 'text', text: 'b' }]);
    await transcripts.markInterrupted(id2);

    const rows = await transcripts.getTranscript(user.uuid, date);
    const row1 = rows.find((r) => r.id === id1);
    const row2 = rows.find((r) => r.id === id2);
    assert.equal(row1.interrupted, false);
    assert.equal(row2.interrupted, true);
  });

  await t.test('getTranscript / clearTranscript are isolated per user and per date', async () => {
    const userA = await createUser();
    const userB = await createUser();
    const date1 = '2024-02-04';
    const date2 = '2024-02-05';

    await transcripts.appendMessage(userA.uuid, date1, 'a1', 'user', [{ type: 'text', text: 'A/date1' }]);
    await transcripts.appendMessage(userA.uuid, date2, 'a2', 'user', [{ type: 'text', text: 'A/date2' }]);
    await transcripts.appendMessage(userB.uuid, date1, 'b1', 'user', [{ type: 'text', text: 'B/date1' }]);

    assert.equal((await transcripts.getTranscript(userA.uuid, date1)).length, 1);
    assert.equal((await transcripts.getTranscript(userB.uuid, date1)).length, 1);

    const deletedCount = await transcripts.clearTranscript(userA.uuid, date1);
    assert.equal(deletedCount, 1);
    assert.equal((await transcripts.getTranscript(userA.uuid, date1)).length, 0);
    // Unaffected: same user different date, and different user same date.
    assert.equal((await transcripts.getTranscript(userA.uuid, date2)).length, 1);
    assert.equal((await transcripts.getTranscript(userB.uuid, date1)).length, 1);
  });

  await t.test('GET /chat/transcript route matches the store, and rejects a malformed date', async () => {
    const user = await createUser();
    const date = '2024-02-06';
    await transcripts.appendMessage(user.uuid, date, 'r1', 'user', [{ type: 'text', text: 'hi' }]);

    const { status, body } = await get(baseUrl, user, `/chat/transcript?date=${date}`);
    assert.equal(status, 200);
    assert.equal(body.data.length, 1);
    assert.equal(body.data[0].message_id, 'r1');

    const { status: badStatus, body: badBody } = await get(baseUrl, user, '/chat/transcript?date=nope');
    assert.equal(badStatus, 400);
    assert.equal(badBody.message, 'date query param must be in YYYY-MM-DD format');
  });

  await t.test('DELETE /chat/transcript clears both the transcript AND that day\'s proposal resolutions (#186)', async () => {
    const user = await createUser();
    const date = '2024-02-07';
    await transcripts.appendMessage(user.uuid, date, 'm1', 'user', [{ type: 'text', text: 'hi' }]);
    await post(baseUrl, user, '/chat/resolutions', {
      date, toolCallId: 'call_1', kind: 'entry', status: 'confirmed', displayName: 'Logged: Banana',
    });

    const res = await fetch(`${baseUrl}/api/nutrition/chat/transcript?date=${date}`, {
      method: 'DELETE',
      headers: user.authHeader(),
    });
    assert.equal(res.status, 204);

    const { body: transcriptAfter } = await get(baseUrl, user, `/chat/transcript?date=${date}`);
    assert.deepEqual(transcriptAfter.data, []);
    const { body: resolutionsAfter } = await get(baseUrl, user, `/chat/resolutions?date=${date}`);
    assert.deepEqual(resolutionsAfter.data, []);
  });

  // ---- Proposal resolutions ----

  await t.test('POST + GET /chat/resolutions round-trip a saved resolution', async () => {
    const user = await createUser();
    const date = '2024-03-01';
    const { status } = await post(baseUrl, user, '/chat/resolutions', {
      date, toolCallId: 'call_abc', kind: 'entry', status: 'confirmed', displayName: 'Logged: Apple',
    });
    assert.equal(status, 204);

    const { body } = await get(baseUrl, user, `/chat/resolutions?date=${date}`);
    assert.equal(body.data.length, 1);
    assert.deepEqual(body.data[0], {
      tool_call_id: 'call_abc', kind: 'entry', status: 'confirmed', display_name: 'Logged: Apple',
    });
  });

  await t.test('POST /chat/resolutions upserts on (user, date, toolCallId) -- a re-post overwrites, not duplicates', async () => {
    const user = await createUser();
    const date = '2024-03-02';
    await post(baseUrl, user, '/chat/resolutions', {
      date, toolCallId: 'call_xyz', kind: 'entry', status: 'confirmed', displayName: 'Logged: Toast',
    });
    await post(baseUrl, user, '/chat/resolutions', {
      date, toolCallId: 'call_xyz', kind: 'entry', status: 'denied', displayName: null,
    });

    const { body } = await get(baseUrl, user, `/chat/resolutions?date=${date}`);
    assert.equal(body.data.length, 1);
    assert.equal(body.data[0].status, 'denied');
    assert.equal(body.data[0].display_name, null);
  });

  await t.test('proposal resolutions are isolated per user', async () => {
    const userA = await createUser();
    const userB = await createUser();
    const date = '2024-03-03';
    await post(baseUrl, userA, '/chat/resolutions', {
      date, toolCallId: 'call_shared_id', kind: 'entry', status: 'confirmed', displayName: 'A',
    });
    await post(baseUrl, userB, '/chat/resolutions', {
      date, toolCallId: 'call_shared_id', kind: 'entry', status: 'denied', displayName: 'B',
    });

    const { body: bodyA } = await get(baseUrl, userA, `/chat/resolutions?date=${date}`);
    const { body: bodyB } = await get(baseUrl, userB, `/chat/resolutions?date=${date}`);
    assert.equal(bodyA.data[0].status, 'confirmed');
    assert.equal(bodyB.data[0].status, 'denied');
  });

  await t.test('POST /chat/resolutions rejects a malformed date in the body', async () => {
    const user = await createUser();
    const { status } = await post(baseUrl, user, '/chat/resolutions', {
      date: 'not-a-date', toolCallId: 'call_1', kind: 'entry', status: 'confirmed',
    });
    assert.equal(status, 400);
  });
});
