// Tests for the Wave 3 read-only agent tools (services/agent/tools/analytics.ts):
// query_series, list_resources, and get_resource. Calls each tool's execute()
// function directly against a real MySQL schema rather than going through a
// live model, following the same db harness bodyWeight.test.js and
// tests/analytics.test.js use.
//
// Requires a reachable database (see scripts/testDb.js). If none is
// reachable, every test here is skipped (not failed) so `npm test` still
// passes for someone who hasn't started Docker.
//
// Run with: DB_NAME=workout_log_test_tools npm test
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseISO } = require('date-fns');
const db = require('../scripts/testDb');

function makeCtx(userUuid) {
  return { userUuid, selectedDate: '2024-01-01', flags: { unc_dining: false } };
}

async function createSection(pool, uuid, label = 'Legs') {
  const [result] = await pool.query(
    `INSERT INTO sections (user_uuid, label) VALUES (UUID_TO_BIN(?), ?)`,
    [uuid, label],
  );
  return result.insertId;
}

async function createMovement(pool, sectionId, label = 'Squat') {
  const [result] = await pool.query(
    `INSERT INTO movements (section_id, label) VALUES (?, ?)`,
    [sectionId, label],
  );
  return result.insertId;
}

async function createVariation(pool, movementId, label = 'Variation', weight = 100, reps = 5) {
  const [result] = await pool.query(
    `INSERT INTO variations (movement_id, label, weight, reps, date) VALUES (?, ?, ?, ?, NOW())`,
    [movementId, label, weight, reps],
  );
  return result.insertId;
}

async function seedHistory(pool, variationId, weight, reps, date) {
  await pool.query(
    `INSERT INTO variation_history (variation_id, weight, reps, date) VALUES (?, ?, ?, ?)`,
    [variationId, weight, reps, parseISO(date)],
  );
}

async function seedBodyWeight(pool, uuid, weight, date) {
  await pool.query(
    `INSERT INTO body_weight (user_uuid, weight, date) VALUES (UUID_TO_BIN(?), ?, ?)`,
    [uuid, weight, parseISO(date)],
  );
}

async function createHabit(pool, uuid, name, ordering = 0) {
  const [result] = await pool.query(
    `INSERT INTO habits (user_uuid, name, ordering) VALUES (UUID_TO_BIN(?), ?, ?)`,
    [uuid, name, ordering],
  );
  return result.insertId;
}

async function seedHabitTally(pool, uuid, habitName, date, count) {
  await pool.query(
    `INSERT INTO habit_tallies (user_uuid, habit_name, date, count, range_start, range_end)
     VALUES (UUID_TO_BIN(?), ?, ?, ?, '08:00:00', '08:00:00')`,
    [uuid, habitName, date, count],
  );
}

test('agent read tools (query_series, list_resources, get_resource)', async (t) => {
  const available = await db.isDbReachable();
  if (!available) {
    t.skip('No reachable database on 127.0.0.1:3307. Start it with: docker compose up -d, then npm run db:setup (see scripts/testDb.js).');
    return;
  }

  await db.setupTestDb();
  const { analyticsTools } = db.requireTs('services/agent/tools/analytics.ts');
  const pool = db.getPool();

  t.beforeEach(async () => {
    await db.resetDb();
  });

  t.after(async () => {
    await db.closePool();
  });

  // ---- assembled tool set (services/agent/index.ts) ----

  await t.test('the assembled tool set includes the mutation tools and the read tools alongside nutrition', async () => {
    const { TOOL_MODULES } = db.requireTs('services/agent/index.ts');
    const { assembleTools } = db.requireTs('services/agent/tools/registry.ts');

    const ctx = { userUuid: 'unused-for-assembly', selectedDate: '2024-01-01', flags: { unc_dining: false } };
    const names = Object.keys(assembleTools(TOOL_MODULES, ctx));

    // Mutation tools (services/agent/tools/mutations.ts) actually registered.
    assert.ok(names.includes('propose_mutation'), 'propose_mutation missing from assembled tool set');
    assert.ok(names.includes('describe_resource'), 'describe_resource missing from assembled tool set');

    // Read tools (services/agent/tools/analytics.ts, via readToolModules) actually registered.
    assert.ok(names.includes('query_series'), 'query_series missing from assembled tool set');
    assert.ok(names.includes('list_resources'), 'list_resources missing from assembled tool set');
    assert.ok(names.includes('get_resource'), 'get_resource missing from assembled tool set');

    // Sanity: the pre-existing nutrition module is still present too, so this
    // test fails loudly if a future refactor drops any one module rather than
    // silently losing the others.
    assert.ok(names.includes('propose_entry'), 'propose_entry missing from assembled tool set');
  });

  // ---- sections ----

  await t.test('list_resources("section") lists only the caller\'s sections', async () => {
    const userA = await db.createTestUser();
    const userB = await db.createTestUser();
    await createSection(pool, userA.uuid, 'Legs');
    await createSection(pool, userB.uuid, 'Arms');

    const tools = analyticsTools(makeCtx(userA.uuid));
    const result = await tools.list_resources.execute({ resource: 'section' });
    assert.equal(result.length, 1);
    assert.equal(result[0].label, 'Legs');
  });

  await t.test('get_resource("section") errors for another user\'s section', async () => {
    const userA = await db.createTestUser();
    const userB = await db.createTestUser();
    const sectionId = await createSection(pool, userB.uuid);

    const tools = analyticsTools(makeCtx(userA.uuid));
    const result = await tools.get_resource.execute({ resource: 'section', id: String(sectionId) });
    assert.ok(result.error);
  });

  await t.test('get_resource("section") returns the owned section', async () => {
    const user = await db.createTestUser();
    const sectionId = await createSection(pool, user.uuid, 'Legs');

    const tools = analyticsTools(makeCtx(user.uuid));
    const result = await tools.get_resource.execute({ resource: 'section', id: String(sectionId) });
    assert.equal(result.label, 'Legs');
  });

  // ---- movements ----

  await t.test('list_resources("movement") requires parent_id and enforces section ownership', async () => {
    const userA = await db.createTestUser();
    const userB = await db.createTestUser();
    const sectionId = await createSection(pool, userB.uuid);
    await createMovement(pool, sectionId, 'Bench');

    const tools = analyticsTools(makeCtx(userA.uuid));

    const missing = await tools.list_resources.execute({ resource: 'movement' });
    assert.ok(missing.error);

    const forbidden = await tools.list_resources.execute({ resource: 'movement', parent_id: String(sectionId) });
    assert.ok(forbidden.error);
  });

  await t.test('list_resources("movement") and get_resource("movement") return owned data', async () => {
    const user = await db.createTestUser();
    const sectionId = await createSection(pool, user.uuid);
    const movementId = await createMovement(pool, sectionId, 'Bench');

    const tools = analyticsTools(makeCtx(user.uuid));
    const list = await tools.list_resources.execute({ resource: 'movement', parent_id: String(sectionId) });
    assert.equal(list.length, 1);
    assert.equal(list[0].label, 'Bench');

    const single = await tools.get_resource.execute({ resource: 'movement', id: String(movementId) });
    assert.equal(single.label, 'Bench');
  });

  // ---- variations ----

  await t.test('list_resources("variation") and get_resource("variation") return owned data', async () => {
    const user = await db.createTestUser();
    const sectionId = await createSection(pool, user.uuid);
    const movementId = await createMovement(pool, sectionId);
    const variationId = await createVariation(pool, movementId, 'Barbell', 135, 5);

    const tools = analyticsTools(makeCtx(user.uuid));
    const list = await tools.list_resources.execute({ resource: 'variation', parent_id: String(movementId) });
    assert.equal(list.length, 1);
    assert.equal(list[0].weight, 135);

    const single = await tools.get_resource.execute({ resource: 'variation', id: String(variationId) });
    assert.equal(single.reps, 5);
  });

  await t.test('list_resources("variation") errors when the movement belongs to another user', async () => {
    const userA = await db.createTestUser();
    const userB = await db.createTestUser();
    const sectionId = await createSection(pool, userB.uuid);
    const movementId = await createMovement(pool, sectionId);

    const tools = analyticsTools(makeCtx(userA.uuid));
    const result = await tools.list_resources.execute({ resource: 'variation', parent_id: String(movementId) });
    assert.ok(result.error);
  });

  // ---- variation_history ----

  await t.test('list_resources("variation_history") returns entries within range, ordered ascending', async () => {
    const user = await db.createTestUser();
    const sectionId = await createSection(pool, user.uuid);
    const movementId = await createMovement(pool, sectionId);
    const variationId = await createVariation(pool, movementId);
    await seedHistory(pool, variationId, 100, 5, '2024-01-01');
    await seedHistory(pool, variationId, 105, 5, '2024-01-08');
    await seedHistory(pool, variationId, 110, 5, '2024-01-15');

    const tools = analyticsTools(makeCtx(user.uuid));
    const result = await tools.list_resources.execute({
      resource: 'variation_history', parent_id: String(variationId), from: '2024-01-01', to: '2024-01-08',
    });
    assert.equal(result.entries.length, 2);
    assert.equal(result.entries[0].weight, 100);
    assert.equal(result.entries[1].weight, 105);
  });

  await t.test('list_resources("variation_history") flags a never-PATCHed variation with a note, not an error', async () => {
    const user = await db.createTestUser();
    const sectionId = await createSection(pool, user.uuid);
    const movementId = await createMovement(pool, sectionId);
    const variationId = await createVariation(pool, movementId);

    const tools = analyticsTools(makeCtx(user.uuid));
    const result = await tools.list_resources.execute({ resource: 'variation_history', parent_id: String(variationId) });
    assert.deepEqual(result.entries, []);
    assert.ok(result.note && /never/i.test(result.note));
  });

  await t.test('list_resources("variation_history") errors for another user\'s variation', async () => {
    const userA = await db.createTestUser();
    const userB = await db.createTestUser();
    const sectionId = await createSection(pool, userB.uuid);
    const movementId = await createMovement(pool, sectionId);
    const variationId = await createVariation(pool, movementId);

    const tools = analyticsTools(makeCtx(userA.uuid));
    const result = await tools.list_resources.execute({ resource: 'variation_history', parent_id: String(variationId) });
    assert.ok(result.error);
  });

  // ---- body_weight ----

  await t.test('list_resources("body_weight") respects range params and per-user isolation', async () => {
    const userA = await db.createTestUser();
    const userB = await db.createTestUser();
    await seedBodyWeight(pool, userA.uuid, 180, '2024-01-01');
    await seedBodyWeight(pool, userA.uuid, 178, '2024-01-10');
    await seedBodyWeight(pool, userB.uuid, 200, '2024-01-05');

    const tools = analyticsTools(makeCtx(userA.uuid));
    const all = await tools.list_resources.execute({ resource: 'body_weight' });
    assert.equal(all.length, 2);

    const ranged = await tools.list_resources.execute({ resource: 'body_weight', from: '2024-01-05', to: '2024-01-10' });
    assert.equal(ranged.length, 1);
    assert.equal(ranged[0].weight, 178);
  });

  await t.test('get_resource("body_weight") reports no single-item lookup', async () => {
    const user = await db.createTestUser();
    const tools = analyticsTools(makeCtx(user.uuid));
    const result = await tools.get_resource.execute({ resource: 'body_weight', id: '1' });
    assert.ok(result.error);
  });

  // ---- habits ----

  await t.test('list_resources("habit") and ("habit_tally") isolate per user and support range params', async () => {
    const userA = await db.createTestUser();
    const userB = await db.createTestUser();
    await createHabit(pool, userA.uuid, 'Meditate', 0);
    await createHabit(pool, userB.uuid, 'Read', 0);
    await seedHabitTally(pool, userA.uuid, 'Meditate', '2024-01-01', 1);
    await seedHabitTally(pool, userA.uuid, 'Meditate', '2024-01-08', 1);
    await seedHabitTally(pool, userB.uuid, 'Read', '2024-01-01', 1);

    const tools = analyticsTools(makeCtx(userA.uuid));
    const habits = await tools.list_resources.execute({ resource: 'habit' });
    assert.equal(habits.length, 1);
    assert.equal(habits[0].name, 'Meditate');

    const tallies = await tools.list_resources.execute({
      resource: 'habit_tally', parent_id: 'Meditate', from: '2024-01-05', to: '2024-01-31',
    });
    assert.equal(tallies.length, 1);
  });

  await t.test('list_resources("habit_tally") returns tallies for a name with no registry row', async () => {
    // habit_tallies joins the registry by name, not id, and a tally can exist
    // for a name that was never registered (or has since been deleted).
    const user = await db.createTestUser();
    await seedHabitTally(pool, user.uuid, 'Unregistered', '2024-01-01', 2);

    const tools = analyticsTools(makeCtx(user.uuid));
    const tallies = await tools.list_resources.execute({ resource: 'habit_tally', parent_id: 'Unregistered' });
    assert.equal(tallies.length, 1);
    assert.equal(tallies[0].count, 2);
  });

  // ---- unknown resource ----

  await t.test('an unknown resource value is rejected by both tools', async () => {
    const user = await db.createTestUser();
    const tools = analyticsTools(makeCtx(user.uuid));

    const listResult = await tools.list_resources.execute({ resource: 'bogus' });
    assert.ok(listResult.error);

    const getResult = await tools.get_resource.execute({ resource: 'bogus', id: '1' });
    assert.ok(getResult.error);
  });

  // ---- query_series ----

  await t.test('query_series returns bucketed points, slope/r2, and coverage for a seeded trend', async () => {
    const user = await db.createTestUser();
    for (let i = 0; i < 14; i++) {
      const date = new Date(Date.UTC(2024, 0, 1 + i)).toISOString().slice(0, 10);
      await seedBodyWeight(pool, user.uuid, 180 - i * 0.1, date);
    }

    const tools = analyticsTools(makeCtx(user.uuid));
    const result = await tools.query_series.execute({
      metric: 'body_weight', from: '2024-01-01', to: '2024-01-14', bucket: 'day',
    });
    assert.equal(result.points.length, 14);
    assert.ok(result.summary.slopePerWeek < 0);
    assert.ok(result.summary.r2 > 0.9);
    assert.equal(result.coverage.daysInWindow, 14);
    assert.equal(result.coverage.daysWithData, 14);
    assert.equal(result.coverage.coverage, 1);
  });

  await t.test('query_series surfaces an invalid metric as a structured error, not a throw', async () => {
    const user = await db.createTestUser();
    const tools = analyticsTools(makeCtx(user.uuid));
    const result = await tools.query_series.execute({ metric: 'not-a-real-metric', from: '2024-01-01', to: '2024-01-02' });
    assert.ok(result.error);
  });

  await t.test('query_series is scoped per user', async () => {
    const userA = await db.createTestUser();
    const userB = await db.createTestUser();
    await seedBodyWeight(pool, userA.uuid, 150, '2024-01-01');
    await seedBodyWeight(pool, userB.uuid, 250, '2024-01-01');

    const tools = analyticsTools(makeCtx(userA.uuid));
    const result = await tools.query_series.execute({
      metric: 'body_weight', from: '2024-01-01', to: '2024-01-01', bucket: 'day',
    });
    assert.equal(result.points[0].value, 150);
  });
});
