// Tests for the per-user breakdown and user filter added to routes/admin.ts's
// GET /usage (#352). Exercises real HTTP requests through the actual router
// against a real MySQL schema, mirroring tests/adminUsage.test.js.
//
// Requires a reachable database (see scripts/testDb.js). If none is
// reachable, every test here is skipped (not failed) so `npm test` still
// passes for someone who hasn't started Docker.
//
// Run with: DB_NAME=workout_log_test_usage npm run test:file tests/adminUsageByUser.test.js
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
// recordUsage so a test controls created_at exactly, the same helper as
// tests/adminUsage.test.js.
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

test('admin usage by-user breakdown and filter', async (t) => {
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

  await t.test('GET /usage includes a byUser row per user with usage in range, owner included', async () => {
    const owner = await db.createTestUser();
    const other = await db.createTestUser();
    process.env.OWNER_EMAIL = owner.email;

    await seedUsage(pool, owner.uuid, { costUsd: 0.02, createdAt: '2026-08-15T10:00:00' });
    await seedUsage(pool, other.uuid, { costUsd: 0.01, createdAt: '2026-08-15T11:00:00' });

    const { status, body } = await get(baseUrl, owner, '/usage?from=2026-08-15&to=2026-08-16');
    assert.equal(status, 200);

    const { byUser } = body.data;
    assert.equal(byUser.length, 2);
    const ownerRow = byUser.find((r) => r.userUuid === owner.uuid);
    const otherRow = byUser.find((r) => r.userUuid === other.uuid);
    assert.ok(ownerRow, 'owner must appear in the breakdown, not just other users');
    assert.ok(otherRow);
    assert.equal(ownerRow.email, owner.email);
    assert.equal(otherRow.email, other.email);
    assert.ok(Math.abs(ownerRow.costUsd - 0.02) < 1e-9);
    assert.ok(Math.abs(otherRow.costUsd - 0.01) < 1e-9);
  });

  await t.test('GET /usage?userUuid narrows totals and daily to that user without double- or under-counting', async () => {
    const owner = await db.createTestUser();
    const other = await db.createTestUser();
    process.env.OWNER_EMAIL = owner.email;

    await seedUsage(pool, owner.uuid, { costUsd: 0.02, steps: 3, createdAt: '2026-08-15T10:00:00' });
    await seedUsage(pool, other.uuid, { costUsd: 0.01, steps: 5, createdAt: '2026-08-15T11:00:00' });

    const { status, body } = await get(
      baseUrl,
      owner,
      `/usage?from=2026-08-15&to=2026-08-16&userUuid=${other.uuid}`,
    );
    assert.equal(status, 200);
    assert.equal(body.data.totals.turns, 1);
    assert.equal(body.data.totals.steps, 5);
    assert.ok(Math.abs(body.data.totals.costUsd - 0.01) < 1e-9);
    assert.equal(body.data.daily.length, 1);
    assert.equal(body.data.daily[0].turns, 1);

    // byUser stays the full, unfiltered breakdown so a client-side filter
    // control still has every user to choose from.
    assert.equal(body.data.byUser.length, 2);
  });

  await t.test('GET /usage?userUuid rejects a malformed uuid with 400', async () => {
    const owner = await db.createTestUser();
    process.env.OWNER_EMAIL = owner.email;

    const { status, body } = await get(baseUrl, owner, '/usage?userUuid=not-a-uuid');
    assert.equal(status, 400);
    assert.match(body.message, /userUuid/);
  });

  await t.test('GET /usage still 404s a non-owner even when they pass userUuid', async () => {
    const owner = await db.createTestUser();
    const other = await db.createTestUser();
    process.env.OWNER_EMAIL = owner.email;

    const { status, body } = await get(baseUrl, other, `/usage?userUuid=${other.uuid}`);
    assert.equal(status, 404);
    assert.equal(body.message, 'Not found');
  });

  await t.test('GET /usage byUser surfaces a user with no matching users row (e.g. a deleted account)', async () => {
    const owner = await db.createTestUser();
    const deletedUser = await db.createTestUser();
    process.env.OWNER_EMAIL = owner.email;

    await seedUsage(pool, deletedUser.uuid, { costUsd: 0.03, createdAt: '2026-08-15T10:00:00' });
    // users.email is NOT NULL, so "no email on file" is modeled by the account
    // itself being gone; ai_usage has no FK to users, so its rows outlive it.
    await pool.query('DELETE FROM users WHERE user_uuid = UUID_TO_BIN(?)', [deletedUser.uuid]);

    const { status, body } = await get(baseUrl, owner, '/usage?from=2026-08-15&to=2026-08-16');
    assert.equal(status, 200);

    const row = body.data.byUser.find((r) => r.userUuid === deletedUser.uuid);
    assert.ok(row, 'a user with no matching users row must still appear in the breakdown');
    assert.equal(row.email, null);
  });
});
