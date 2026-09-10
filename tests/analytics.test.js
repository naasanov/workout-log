// Tests for services/analytics/index.ts's querySeries -- the one general
// cross-domain time-series query. Unlike the other tests/*.test.js files,
// there is no route here yet (a later wave wires this up as an agent tool),
// so this calls the service function directly against a real MySQL schema,
// following the same db harness bodyWeight.test.js uses.
//
// Requires a reachable database (see scripts/testDb.js). If none is
// reachable, every test here is skipped (not failed) so `npm test` still
// passes for someone who hasn't started Docker.
//
// Run with: DB_NAME=workout_log_test_analytics npm test
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseISO } = require('date-fns');
const db = require('../scripts/testDb');

// `date` may be a bare 'YYYY-MM-DD' or a full ISO datetime string; mysql2
// only accepts the latter form as a raw string bind for a DATETIME column,
// so this always goes through a Date object instead. parseISO (not the
// native Date constructor) matches routes/bodyWeight.ts and every other
// caller in this codebase: it treats a bare date as LOCAL midnight, while
// native Date treats it as UTC midnight -- mismatching that would shift
// every date by the server's UTC offset.
async function seedBodyWeight(pool, uuid, weight, date) {
  await pool.query(
    `INSERT INTO body_weight (user_uuid, weight, date) VALUES (UUID_TO_BIN(?), ?, ?)`,
    [uuid, weight, parseISO(date)],
  );
}

async function seedFoodEntry(pool, uuid, date, macros = {}) {
  const { calories = 0, protein_g = 0, carbs_g = 0, fat_g = 0, fiber_g = null } = macros;
  await pool.query(
    `INSERT INTO food_entries (user_uuid, date, logged_at, meal, name, source, calories, protein_g, carbs_g, fat_g, fiber_g)
     VALUES (UUID_TO_BIN(?), ?, NOW(), 'lunch', 'Test Food', 'manual', ?, ?, ?, ?, ?)`,
    [uuid, date, calories, protein_g, carbs_g, fat_g, fiber_g],
  );
}

async function seedHabitTally(pool, uuid, habitName, date, count) {
  await pool.query(
    `INSERT INTO habit_tallies (user_uuid, habit_name, date, count, range_start, range_end)
     VALUES (UUID_TO_BIN(?), ?, ?, ?, '08:00:00', '08:00:00')`,
    [uuid, habitName, date, count],
  );
}

// Builds a fresh section -> movement -> variation chain owned by uuid, and
// returns the variation_id. variation_history is seeded separately with
// seedHistory so tests control exact dates/values instead of going through
// appendHistoryIfChanged's change-detection.
async function createVariationChain(pool, uuid) {
  const [sectionResult] = await pool.query(
    `INSERT INTO sections (user_uuid, label) VALUES (UUID_TO_BIN(?), 'Section')`,
    [uuid],
  );
  const [movementResult] = await pool.query(
    `INSERT INTO movements (section_id, label) VALUES (?, 'Movement')`,
    [sectionResult.insertId],
  );
  const [variationResult] = await pool.query(
    `INSERT INTO variations (movement_id, label, weight, reps, date) VALUES (?, 'Variation', NULL, 0, NOW())`,
    [movementResult.insertId],
  );
  return variationResult.insertId;
}

async function seedHistory(pool, variationId, weight, reps, date) {
  await pool.query(
    `INSERT INTO variation_history (variation_id, weight, reps, date) VALUES (?, ?, ?, ?)`,
    [variationId, weight, reps, parseISO(date)],
  );
}

function pointsByDate(result) {
  return Object.fromEntries(result.points.map((p) => [p.bucketStart, p.value]));
}

test('analytics querySeries', async (t) => {
  const available = await db.isDbReachable();
  if (!available) {
    t.skip('No reachable database on 127.0.0.1:3307. Start it with: docker compose up -d, then npm run db:setup (see scripts/testDb.js).');
    return;
  }

  await db.setupTestDb();
  const { querySeries, AnalyticsError } = db.requireTs('services/analytics/index.ts');
  const pool = db.getPool();

  t.beforeEach(async () => {
    await db.resetDb();
  });

  t.after(async () => {
    await db.closePool();
  });

  // ---- body_weight ----

  await t.test('body_weight: day bucketing returns one point per calendar day', async () => {
    const user = await db.createTestUser();
    await seedBodyWeight(pool, user.uuid, 100, '2024-01-01');
    await seedBodyWeight(pool, user.uuid, 101, '2024-01-02');
    await seedBodyWeight(pool, user.uuid, 99, '2024-01-03');

    const result = await querySeries(user.uuid, {
      metric: 'body_weight', from: '2024-01-01', to: '2024-01-03', bucket: 'day',
    });
    assert.equal(result.agg, 'avg');
    assert.deepEqual(pointsByDate(result), {
      '2024-01-01': 100, '2024-01-02': 101, '2024-01-03': 99,
    });
  });

  await t.test('body_weight: multiple same-day entries average into one day value', async () => {
    const user = await db.createTestUser();
    await seedBodyWeight(pool, user.uuid, 68, '2024-01-04T06:00:00Z');
    await seedBodyWeight(pool, user.uuid, 70, '2024-01-04T20:00:00Z');

    const result = await querySeries(user.uuid, {
      metric: 'body_weight', from: '2024-01-04', to: '2024-01-04', bucket: 'day',
    });
    assert.equal(result.points.length, 1);
    assert.equal(result.points[0].value, 69);
  });

  await t.test('body_weight: a bare-date `to` includes an entry logged late that same day', async () => {
    const user = await db.createTestUser();
    await seedBodyWeight(pool, user.uuid, 100, '2024-01-01');
    await seedBodyWeight(pool, user.uuid, 110, '2024-01-05T23:30:00Z');

    const result = await querySeries(user.uuid, {
      metric: 'body_weight', from: '2024-01-01', to: '2024-01-05', bucket: 'day',
    });
    assert.deepEqual(pointsByDate(result), { '2024-01-01': 100, '2024-01-05': 110 });
  });

  await t.test('body_weight: week bucketing on a non-aligned window still lands on calendar weeks', async () => {
    const user = await db.createTestUser();
    // 2024-01-01 is a Monday. Window (Thu Jan 4 - Wed Jan 10) straddles two
    // calendar weeks even though it starts and ends mid-week.
    await seedBodyWeight(pool, user.uuid, 100, '2024-01-04');
    await seedBodyWeight(pool, user.uuid, 102, '2024-01-06');
    await seedBodyWeight(pool, user.uuid, 98, '2024-01-09');

    const result = await querySeries(user.uuid, {
      metric: 'body_weight', from: '2024-01-04', to: '2024-01-10', bucket: 'week',
    });
    const byWeek = pointsByDate(result);
    assert.equal(byWeek['2024-01-01'], 101); // avg(100, 102)
    assert.equal(byWeek['2024-01-08'], 98);
  });

  await t.test('body_weight: month bucketing groups by calendar month', async () => {
    const user = await db.createTestUser();
    await seedBodyWeight(pool, user.uuid, 100, '2024-01-25');
    await seedBodyWeight(pool, user.uuid, 102, '2024-01-31');
    await seedBodyWeight(pool, user.uuid, 98, '2024-02-05');

    const result = await querySeries(user.uuid, {
      metric: 'body_weight', from: '2024-01-25', to: '2024-02-05', bucket: 'month',
    });
    const byMonth = pointsByDate(result);
    assert.equal(byMonth['2024-01-01'], 101);
    assert.equal(byMonth['2024-02-01'], 98);
  });

  // ---- regression slope ----

  await t.test('regression slope is correct for a known synthetic linear ramp', async () => {
    const user = await db.createTestUser();
    const start = 80;
    const perDay = -0.2;
    for (let i = 0; i < 30; i++) {
      const date = new Date(Date.UTC(2024, 0, 1 + i));
      await seedBodyWeight(pool, user.uuid, start + perDay * i, date.toISOString().slice(0, 10));
    }

    const result = await querySeries(user.uuid, {
      metric: 'body_weight', from: '2024-01-01', to: '2024-01-30', bucket: 'day',
    });
    assert.equal(result.summary.count, 30);
    assert.ok(
      Math.abs(result.summary.slopePerWeek - perDay * 7) < 0.01,
      `expected slope near ${perDay * 7}, got ${result.summary.slopePerWeek}`,
    );
    assert.ok(result.summary.r2 > 0.999, `expected r2 near 1, got ${result.summary.r2}`);
  });

  // ---- nutrition ----

  await t.test('nutrition.calories: day totals sum multiple entries, bucket defaults to averaging days', async () => {
    const user = await db.createTestUser();
    await seedFoodEntry(pool, user.uuid, '2024-01-01', { calories: 1000 });
    await seedFoodEntry(pool, user.uuid, '2024-01-01', { calories: 500 });
    await seedFoodEntry(pool, user.uuid, '2024-01-02', { calories: 1800 });

    const dayResult = await querySeries(user.uuid, {
      metric: 'nutrition.calories', from: '2024-01-01', to: '2024-01-02', bucket: 'day',
    });
    assert.deepEqual(pointsByDate(dayResult), { '2024-01-01': 1500, '2024-01-02': 1800 });

    const weekResult = await querySeries(user.uuid, {
      metric: 'nutrition.calories', from: '2024-01-01', to: '2024-01-02', bucket: 'week',
    });
    assert.equal(weekResult.agg, 'avg');
    assert.equal(weekResult.points[0].value, 1650); // avg(1500, 1800)
  });

  await t.test('nutrition.fiber_g: null fiber entries count as zero, not NaN', async () => {
    const user = await db.createTestUser();
    await seedFoodEntry(pool, user.uuid, '2024-01-01', { calories: 100, fiber_g: null });
    await seedFoodEntry(pool, user.uuid, '2024-01-01', { calories: 100, fiber_g: 5 });

    const result = await querySeries(user.uuid, {
      metric: 'nutrition.fiber_g', from: '2024-01-01', to: '2024-01-01', bucket: 'day',
    });
    assert.equal(result.points[0].value, 5);
  });

  await t.test('nutrition: explicit agg overrides the metric default', async () => {
    const user = await db.createTestUser();
    await seedFoodEntry(pool, user.uuid, '2024-01-01', { calories: 1000 });
    await seedFoodEntry(pool, user.uuid, '2024-01-02', { calories: 2000 });

    const result = await querySeries(user.uuid, {
      metric: 'nutrition.calories', from: '2024-01-01', to: '2024-01-02', bucket: 'week', agg: 'max',
    });
    assert.equal(result.agg, 'max');
    assert.equal(result.points[0].value, 2000);
  });

  // ---- habits ----

  await t.test('habit tallies: sum by default, per bucket', async () => {
    const user = await db.createTestUser();
    await seedHabitTally(pool, user.uuid, 'meditate', '2024-01-01', 1);
    await seedHabitTally(pool, user.uuid, 'meditate', '2024-01-02', 2);
    await seedHabitTally(pool, user.uuid, 'meditate', '2024-01-08', 3);

    const result = await querySeries(user.uuid, {
      metric: 'habit:meditate', from: '2024-01-01', to: '2024-01-14', bucket: 'week',
    });
    assert.equal(result.agg, 'sum');
    const byWeek = pointsByDate(result);
    assert.equal(byWeek['2024-01-01'], 3);
    assert.equal(byWeek['2024-01-08'], 3);
  });

  await t.test('habit tallies: an unregistered habit name (no habits row) still returns its tallies', async () => {
    const user = await db.createTestUser();
    await seedHabitTally(pool, user.uuid, 'never-registered', '2024-01-01', 5);

    const result = await querySeries(user.uuid, {
      metric: 'habit:never-registered', from: '2024-01-01', to: '2024-01-01', bucket: 'day',
    });
    assert.equal(result.points[0].value, 5);
  });

  await t.test('habit tallies: a name containing SQL metacharacters is bound safely, not injected', async () => {
    const user = await db.createTestUser();
    const weirdName = "foo' OR '1'='1";
    await seedHabitTally(pool, user.uuid, weirdName, '2024-01-01', 4);
    await seedHabitTally(pool, user.uuid, 'other-habit', '2024-01-01', 99);

    const result = await querySeries(user.uuid, {
      metric: `habit:${weirdName}`, from: '2024-01-01', to: '2024-01-01', bucket: 'day',
    });
    assert.equal(result.points.length, 1);
    assert.equal(result.points[0].value, 4);
  });

  // ---- exercise ----

  await t.test('exercise: weight/reps/e1rm read variation_history and default to the day/bucket max', async () => {
    const user = await db.createTestUser();
    const variationId = await createVariationChain(pool, user.uuid);
    await seedHistory(pool, variationId, 100, 5, '2024-01-01T10:00:00Z');
    await seedHistory(pool, variationId, 105, 5, '2024-01-01T18:00:00Z'); // same day, heavier set
    await seedHistory(pool, variationId, 110, 3, '2024-01-02T10:00:00Z');

    const weightResult = await querySeries(user.uuid, {
      metric: `exercise:${variationId}.weight`, from: '2024-01-01', to: '2024-01-02', bucket: 'day',
    });
    assert.equal(weightResult.agg, 'max');
    assert.deepEqual(pointsByDate(weightResult), { '2024-01-01': 105, '2024-01-02': 110 });

    const repsResult = await querySeries(user.uuid, {
      metric: `exercise:${variationId}.reps`, from: '2024-01-01', to: '2024-01-02', bucket: 'day',
    });
    assert.deepEqual(pointsByDate(repsResult), { '2024-01-01': 5, '2024-01-02': 3 });

    const e1rmResult = await querySeries(user.uuid, {
      metric: `exercise:${variationId}.e1rm`, from: '2024-01-01', to: '2024-01-02', bucket: 'day',
    });
    // Epley: weight * (1 + reps/30). Day 1's best set is the 105x5 set (both
    // 100x5 and 105x5 give the same reps, so the heavier weight wins on MAX).
    // Tolerance accounts for variation_history.weight being a single-precision
    // FLOAT column, not exact base-10 arithmetic.
    assert.ok(Math.abs(e1rmResult.points[0].value - 105 * (1 + 5 / 30)) < 1e-3);
    assert.ok(Math.abs(e1rmResult.points[1].value - 110 * (1 + 3 / 30)) < 1e-3);
  });

  await t.test('exercise: a variation with no history returns an empty series, not an error', async () => {
    const user = await db.createTestUser();
    const variationId = await createVariationChain(pool, user.uuid);

    const result = await querySeries(user.uuid, {
      metric: `exercise:${variationId}.weight`, from: '2024-01-01', to: '2024-01-31', bucket: 'day',
    });
    assert.deepEqual(result.points, []);
    assert.equal(result.summary.count, 0);
  });

  await t.test('exercise: reps IS NULL history rows are excluded from the reps metric', async () => {
    const user = await db.createTestUser();
    const variationId = await createVariationChain(pool, user.uuid);
    // Legacy row predating reps tracking (see appendHistoryIfChanged's comment).
    await seedHistory(pool, variationId, 100, null, '2024-01-01T10:00:00Z');

    const weightResult = await querySeries(user.uuid, {
      metric: `exercise:${variationId}.weight`, from: '2024-01-01', to: '2024-01-01', bucket: 'day',
    });
    assert.equal(weightResult.points.length, 1);

    const repsResult = await querySeries(user.uuid, {
      metric: `exercise:${variationId}.reps`, from: '2024-01-01', to: '2024-01-01', bucket: 'day',
    });
    assert.deepEqual(repsResult.points, []);
  });

  // ---- empty / single-point windows ----

  await t.test('an empty window returns zeroed-out stats, never NaN', async () => {
    const user = await db.createTestUser();
    await seedBodyWeight(pool, user.uuid, 100, '2024-05-01');

    const result = await querySeries(user.uuid, {
      metric: 'body_weight', from: '2024-01-01', to: '2024-01-31', bucket: 'day',
    });
    assert.deepEqual(result.points, []);
    assert.deepEqual(result.summary, {
      count: 0, mean: null, first: null, last: null, min: null, max: null,
      change: null, slopePerWeek: null, r2: null,
    });
    assert.equal(result.coverage.daysWithData, 0);
    assert.equal(result.coverage.daysInWindow, 31);
    assert.equal(result.coverage.coverage, 0);
    for (const value of Object.values(result.summary)) {
      assert.ok(!Number.isNaN(value));
    }
  });

  await t.test('a single-point window does not divide by zero', async () => {
    const user = await db.createTestUser();
    await seedBodyWeight(pool, user.uuid, 150, '2024-01-01');

    const result = await querySeries(user.uuid, {
      metric: 'body_weight', from: '2024-01-01', to: '2024-01-01', bucket: 'day',
    });
    assert.equal(result.summary.count, 1);
    assert.equal(result.summary.mean, 150);
    assert.equal(result.summary.first, 150);
    assert.equal(result.summary.last, 150);
    assert.equal(result.summary.change, 0);
    assert.equal(result.summary.slopePerWeek, null);
    assert.equal(result.summary.r2, null);
  });

  // ---- coverage ----

  await t.test('coverage reports the fraction of the window that actually has data', async () => {
    const user = await db.createTestUser();
    await seedBodyWeight(pool, user.uuid, 100, '2024-01-01');
    await seedBodyWeight(pool, user.uuid, 101, '2024-01-02');

    const result = await querySeries(user.uuid, {
      metric: 'body_weight', from: '2024-01-01', to: '2024-01-10', bucket: 'day',
    });
    assert.equal(result.coverage.daysWithData, 2);
    assert.equal(result.coverage.daysInWindow, 10);
    assert.equal(result.coverage.coverage, 0.2);
  });

  // ---- per-user isolation ----

  await t.test('per-user isolation: another user\'s body-weight data never appears', async () => {
    const userA = await db.createTestUser();
    const userB = await db.createTestUser();
    await seedBodyWeight(pool, userA.uuid, 100, '2024-01-01');
    await seedBodyWeight(pool, userB.uuid, 200, '2024-01-01');

    const result = await querySeries(userA.uuid, {
      metric: 'body_weight', from: '2024-01-01', to: '2024-01-01', bucket: 'day',
    });
    assert.equal(result.points.length, 1);
    assert.equal(result.points[0].value, 100);
  });

  await t.test('per-user isolation: an exercise metric never reaches another user\'s variation', async () => {
    const userA = await db.createTestUser();
    const userB = await db.createTestUser();
    const variationId = await createVariationChain(pool, userB.uuid);
    await seedHistory(pool, variationId, 999, 5, '2024-01-01T10:00:00Z');

    const result = await querySeries(userA.uuid, {
      metric: `exercise:${variationId}.weight`, from: '2024-01-01', to: '2024-01-01', bucket: 'day',
    });
    assert.deepEqual(result.points, []);
  });

  await t.test('per-user isolation: a habit tally with the same name for another user is excluded', async () => {
    const userA = await db.createTestUser();
    const userB = await db.createTestUser();
    await seedHabitTally(pool, userA.uuid, 'meditate', '2024-01-01', 1);
    await seedHabitTally(pool, userB.uuid, 'meditate', '2024-01-01', 50);

    const result = await querySeries(userA.uuid, {
      metric: 'habit:meditate', from: '2024-01-01', to: '2024-01-01', bucket: 'day',
    });
    assert.equal(result.points[0].value, 1);
  });

  // ---- validation / injection ----

  await t.test('rejects an unknown metric', async () => {
    const user = await db.createTestUser();
    await assert.rejects(
      () => querySeries(user.uuid, { metric: 'not_a_real_metric', from: '2024-01-01', to: '2024-01-01' }),
      AnalyticsError,
    );
  });

  await t.test('rejects an injection-shaped metric string instead of reaching SQL', async () => {
    const user = await db.createTestUser();
    const badMetrics = [
      "body_weight; DROP TABLE users;--",
      "exercise:1 OR 1=1.weight",
      "nutrition.calories'; DROP TABLE food_entries;--",
      "exercise:abc.weight",
      "nutrition.not_a_field",
      "",
    ];
    for (const metric of badMetrics) {
      await assert.rejects(
        () => querySeries(user.uuid, { metric, from: '2024-01-01', to: '2024-01-01' }),
        AnalyticsError,
        `expected "${metric}" to be rejected`,
      );
    }

    // The table really is still there.
    const [rows] = await pool.query('SELECT 1 FROM users WHERE user_uuid = UUID_TO_BIN(?)', [user.uuid]);
    assert.equal(rows.length, 1);
  });

  await t.test('rejects an invalid bucket and an invalid agg', async () => {
    const user = await db.createTestUser();
    await assert.rejects(
      () => querySeries(user.uuid, { metric: 'body_weight', from: '2024-01-01', to: '2024-01-01', bucket: 'fortnight' }),
      AnalyticsError,
    );
    await assert.rejects(
      () => querySeries(user.uuid, { metric: 'body_weight', from: '2024-01-01', to: '2024-01-01', agg: 'median' }),
      AnalyticsError,
    );
  });

  await t.test('rejects a `to` before `from`', async () => {
    const user = await db.createTestUser();
    await assert.rejects(
      () => querySeries(user.uuid, { metric: 'body_weight', from: '2024-01-10', to: '2024-01-01' }),
      AnalyticsError,
    );
  });
});
