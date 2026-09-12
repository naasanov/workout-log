// Tests for routes/admin.ts's GET /usage -- the owner-only aggregate AI
// usage dashboard endpoint (#325). Exercises real HTTP requests through the
// actual router against a real MySQL schema, mirroring tests/chatRoutes.test.js.
//
// Requires a reachable database (see scripts/testDb.js). If none is
// reachable, every test here is skipped (not failed) so `npm test` still
// passes for someone who hasn't started Docker.
//
// Run with: DB_NAME=workout_log_test_admin npm test
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseISO } = require('date-fns');
const db = require('../scripts/testDb');

async function get(baseUrl, user, path) {
  const res = await fetch(`${baseUrl}/api/admin${path}`, {
    headers: user ? user.authHeader() : {},
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

// Inserts one ai_usage row directly, bypassing services/nutrition/usage.ts's
// recordUsage so a test controls created_at exactly (needed for the
// DATETIME-boundary case) rather than relying on NOW().
async function seedUsage(pool, uuid, overrides = {}) {
  const {
    model = 'gpt-5.5',
    inputTokens = 1000,
    cachedInputTokens = 200,
    outputTokens = 300,
    reasoningTokens = 50,
    totalTokens = inputTokens + outputTokens,
    steps = 2,
    toolCalls = 3,
    webSearchCalls = 0,
    costUsd = 0.01,
    createdAt = null,
  } = overrides;

  const columns = 'user_uuid, model, input_tokens, cached_input_tokens, output_tokens, reasoning_tokens, total_tokens, steps, tool_calls, web_search_calls, cost_usd';
  const values = [uuid, model, inputTokens, cachedInputTokens, outputTokens, reasoningTokens, totalTokens, steps, toolCalls, webSearchCalls, costUsd];

  if (createdAt) {
    await pool.query(
      `INSERT INTO ai_usage (created_at, ${columns}) VALUES (?, UUID_TO_BIN(?), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [parseISO(createdAt), ...values],
    );
  } else {
    await pool.query(
      `INSERT INTO ai_usage (${columns}) VALUES (UUID_TO_BIN(?), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      values,
    );
  }
}

test('admin usage routes', async (t) => {
  const available = await db.isDbReachable();
  if (!available) {
    t.skip('No reachable database on 127.0.0.1:3307. Start it with: docker compose up -d, then npm run db:setup (see scripts/testDb.js).');
    return;
  }

  await db.setupTestDb();
  const admin = db.requireTs('routes/admin.ts').default;
  const pool = db.getPool();
  const { server, baseUrl } = await db.startTestServer('/api/admin', admin);

  const originalOwnerEmail = process.env.OWNER_EMAIL;

  t.beforeEach(async () => {
    await db.resetDb();
    delete process.env.OWNER_EMAIL;
  });

  t.after(async () => {
    if (originalOwnerEmail === undefined) delete process.env.OWNER_EMAIL;
    else process.env.OWNER_EMAIL = originalOwnerEmail;
    await db.stopTestServer(server);
    await db.closePool();
  });

  await t.test('GET /usage rejects an unauthenticated request', async () => {
    const { status, body } = await get(baseUrl, null, '/usage');
    assert.equal(status, 401);
    assert.equal(body.message, 'Unauthorized: access token required');
  });

  await t.test('GET /usage 404s when OWNER_EMAIL is unset, even for a real user', async () => {
    const user = await db.createTestUser();
    const { status, body } = await get(baseUrl, user, '/usage');
    assert.equal(status, 404);
    assert.equal(body.message, 'Not found');
  });

  await t.test('GET /usage 404s for an authenticated user who is not the owner', async () => {
    const owner = await db.createTestUser();
    const other = await db.createTestUser();
    process.env.OWNER_EMAIL = owner.email;

    const { status, body } = await get(baseUrl, other, '/usage');
    assert.equal(status, 404);
    assert.equal(body.message, 'Not found');
  });

  await t.test('GET /usage returns aggregates for the owner, across all users', async () => {
    const owner = await db.createTestUser();
    const other = await db.createTestUser();
    process.env.OWNER_EMAIL = owner.email;

    await seedUsage(pool, owner.uuid, {
      inputTokens: 1000, cachedInputTokens: 400, outputTokens: 200, reasoningTokens: 50,
      totalTokens: 1200, steps: 3, toolCalls: 4, webSearchCalls: 1, costUsd: 0.02,
      createdAt: '2026-08-15T10:00:00',
    });
    await seedUsage(pool, other.uuid, {
      inputTokens: 500, cachedInputTokens: 100, outputTokens: 100, reasoningTokens: 10,
      totalTokens: 600, steps: 2, toolCalls: 1, webSearchCalls: 0, costUsd: 0.01,
      createdAt: '2026-08-15T11:00:00',
    });
    // A different day -- must land in its own daily bucket, not get merged.
    await seedUsage(pool, owner.uuid, {
      inputTokens: 300, cachedInputTokens: 0, outputTokens: 50, reasoningTokens: 5,
      totalTokens: 350, steps: 1, toolCalls: 0, webSearchCalls: 0, costUsd: 0.005,
      createdAt: '2026-08-16T09:00:00',
    });

    const { status, body } = await get(baseUrl, owner, '/usage?from=2026-08-15&to=2026-08-16');
    assert.equal(status, 200);

    const { totals, daily } = body.data;
    assert.equal(totals.turns, 3);
    assert.equal(totals.uncachedInputTokens, (1000 - 400) + (500 - 100) + (300 - 0));
    assert.equal(totals.cachedInputTokens, 400 + 100 + 0);
    assert.equal(totals.outputTokens, 200 + 100 + 50);
    assert.equal(totals.reasoningTokens, 50 + 10 + 5);
    assert.equal(totals.steps, 3 + 2 + 1);
    assert.equal(totals.modelCalls, totals.steps);
    assert.equal(totals.toolCalls, 4 + 1 + 0);
    assert.equal(totals.webSearchCalls, 1);
    assert.ok(Math.abs(totals.costUsd - (0.02 + 0.01 + 0.005)) < 1e-9);

    assert.equal(daily.length, 2);
    const day15 = daily.find((d) => d.day === '2026-08-15');
    const day16 = daily.find((d) => d.day === '2026-08-16');
    assert.equal(day15.turns, 2);
    assert.equal(day16.turns, 1);
    assert.equal(day16.uncachedInputTokens, 300);
  });

  await t.test('GET /usage treats a bare `to` date as through the end of that day (DATETIME gotcha)', async () => {
    const owner = await db.createTestUser();
    process.env.OWNER_EMAIL = owner.email;

    // Late in the day on the `to` date -- must still be included.
    await seedUsage(pool, owner.uuid, { createdAt: '2026-08-15T23:59:00' });
    // Just past midnight the next day -- must be excluded.
    await seedUsage(pool, owner.uuid, { createdAt: '2026-08-16T00:00:01' });

    const { status, body } = await get(baseUrl, owner, '/usage?from=2026-08-15&to=2026-08-15');
    assert.equal(status, 200);
    assert.equal(body.data.totals.turns, 1);
  });

  await t.test('GET /usage accepts a raw user uuid in OWNER_EMAIL', async () => {
    const owner = await db.createTestUser();
    process.env.OWNER_EMAIL = owner.uuid;

    const { status } = await get(baseUrl, owner, '/usage');
    assert.equal(status, 200);
  });
});
