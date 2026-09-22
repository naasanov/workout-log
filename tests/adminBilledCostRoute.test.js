// Route-level tests for the billedCost field on routes/admin.ts's GET /usage
// (#377, #378): apportioning OpenAI's per-day billed total across users by
// their estimated-cost share. Exercises real HTTP requests through the actual
// router against a real MySQL schema for the estimate side, mirroring
// tests/adminOpenAiCosts.test.js, and stubs global fetch for the outbound
// OpenAI Costs API call -- never mock pool.query, only the third-party HTTP.
//
// Requires a reachable database (see scripts/testDb.js). If none is
// reachable, every test here is skipped (not failed) so `npm test` still
// passes for someone who hasn't started Docker.
//
// Run with: DB_NAME=workout_log_test_admincost npm run test:file tests/adminBilledCostRoute.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseISO } = require('date-fns');
const db = require('../scripts/testDb');

const realFetch = global.fetch;

async function get(baseUrl, user, path) {
  const res = await realFetch(`${baseUrl}/api/admin${path}`, {
    headers: user ? user.authHeader() : {},
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

function daySeconds(day) {
  return Math.floor(Date.parse(`${day}T00:00:00.000Z`) / 1000);
}

function bucket(day, value) {
  return {
    object: 'bucket',
    start_time: daySeconds(day),
    end_time: daySeconds(day) + 86_400,
    results: [{ object: 'organization.costs.result', amount: { value, currency: 'usd' }, line_item: null, project_id: null, organization_id: 'org-test' }],
  };
}

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

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

test('admin usage billedCost (apportioned OpenAI billing) on GET /usage', async (t) => {
  const available = await db.isDbReachable();
  if (!available) {
    t.skip('No reachable database on 127.0.0.1:3307. Start it with: docker compose up -d, then npm run db:setup (see scripts/testDb.js).');
    return;
  }

  await db.setupTestDb();
  const admin = db.requireTs('routes/admin.ts').default;
  const pool = db.getPool();
  const { _clearActualCostCache } = db.requireTs('services/nutrition/openaiCosts.ts');
  const { server, baseUrl } = await db.startTestServer('/api/admin', admin);

  const originalOwnerEmail = process.env.OWNER_EMAIL;
  const originalAdminKey = process.env.OPENAI_ADMIN_KEY;
  const originalFetch = global.fetch;

  t.beforeEach(async () => {
    await db.resetDb();
    delete process.env.OWNER_EMAIL;
    delete process.env.OPENAI_ADMIN_KEY;
    _clearActualCostCache();
    global.fetch = originalFetch;
  });

  t.after(async () => {
    if (originalOwnerEmail === undefined) delete process.env.OWNER_EMAIL;
    else process.env.OWNER_EMAIL = originalOwnerEmail;
    if (originalAdminKey === undefined) delete process.env.OPENAI_ADMIN_KEY;
    else process.env.OPENAI_ADMIN_KEY = originalAdminKey;
    global.fetch = originalFetch;
    await db.stopTestServer(server);
    await db.closePool();
  });

  await t.test('billedCost is null when OPENAI_ADMIN_KEY is unset', async () => {
    const owner = await db.createTestUser();
    process.env.OWNER_EMAIL = owner.email;
    await seedUsage(pool, owner.uuid, { costUsd: 0.02, createdAt: '2026-08-15T10:00:00' });

    const { status, body } = await get(baseUrl, owner, '/usage?from=2026-08-15&to=2026-08-16');
    assert.equal(status, 200);
    assert.equal(body.data.billedCost, null);
  });

  await t.test('billedCost apportions a day\'s billed total across users by estimated-cost share', async () => {
    const owner = await db.createTestUser();
    const other = await db.createTestUser();
    process.env.OWNER_EMAIL = owner.email;
    process.env.OPENAI_ADMIN_KEY = 'test-admin-key';

    // owner: $0.03 estimated on 08-15, other: $0.01 -- a 3:1 split.
    await seedUsage(pool, owner.uuid, { costUsd: 0.03, createdAt: '2026-08-15T10:00:00' });
    await seedUsage(pool, other.uuid, { costUsd: 0.01, createdAt: '2026-08-15T11:00:00' });
    global.fetch = async () => jsonResponse(200, {
      object: 'page',
      data: [bucket('2026-08-15', 0.08)],
      has_more: false,
      next_page: null,
    });

    const { status, body } = await get(baseUrl, owner, '/usage?from=2026-08-15&to=2026-08-15');
    assert.equal(status, 200);
    const { billedCost } = body.data;
    assert.ok(billedCost, 'billedCost must be present once the Costs API returns data');
    assert.ok(Math.abs(billedCost.totalUsd - 0.08) < 1e-9);
    assert.equal(billedCost.estimatedDayCount, 0);
    assert.equal(billedCost.unattributedUsd, 0);

    const ownerRow = billedCost.byUser.find((u) => u.userUuid === owner.uuid);
    const otherRow = billedCost.byUser.find((u) => u.userUuid === other.uuid);
    assert.ok(Math.abs(ownerRow.billedCostUsd - 0.06) < 1e-9, 'owner had 3/4 of the estimated cost, so 3/4 of the $0.08 billed');
    assert.ok(Math.abs(otherRow.billedCostUsd - 0.02) < 1e-9, 'other had 1/4 of the estimated cost, so 1/4 of the $0.08 billed');
  });

  await t.test('billedCost?userUuid narrows totalUsd/daily to that user, keeping byUser/unattributedUsd range-wide', async () => {
    const owner = await db.createTestUser();
    const other = await db.createTestUser();
    process.env.OWNER_EMAIL = owner.email;
    process.env.OPENAI_ADMIN_KEY = 'test-admin-key';

    await seedUsage(pool, owner.uuid, { costUsd: 0.03, createdAt: '2026-08-15T10:00:00' });
    await seedUsage(pool, other.uuid, { costUsd: 0.01, createdAt: '2026-08-15T11:00:00' });
    global.fetch = async () => jsonResponse(200, {
      object: 'page',
      data: [bucket('2026-08-15', 0.08)],
      has_more: false,
      next_page: null,
    });

    const { status, body } = await get(baseUrl, owner, `/usage?from=2026-08-15&to=2026-08-15&userUuid=${other.uuid}`);
    assert.equal(status, 200);
    const { billedCost } = body.data;
    assert.ok(Math.abs(billedCost.totalUsd - 0.02) < 1e-9, 'narrowed to just other\'s 1/4 apportioned share');
    assert.equal(billedCost.byUser.length, 2, 'byUser stays the full, unfiltered breakdown');
  });

  await t.test('a day with billed cost but zero estimated usage stays unattributed, not dropped from totalUsd', async () => {
    const owner = await db.createTestUser();
    process.env.OWNER_EMAIL = owner.email;
    process.env.OPENAI_ADMIN_KEY = 'test-admin-key';

    await seedUsage(pool, owner.uuid, { costUsd: 0.02, createdAt: '2026-08-15T10:00:00' });
    global.fetch = async () => jsonResponse(200, {
      object: 'page',
      data: [bucket('2026-08-15', 0.05), bucket('2026-08-16', 0.10)],
      has_more: false,
      next_page: null,
    });

    const { status, body } = await get(baseUrl, owner, '/usage?from=2026-08-15&to=2026-08-16');
    assert.equal(status, 200);
    const { billedCost } = body.data;
    assert.ok(Math.abs(billedCost.totalUsd - 0.15) < 1e-9);
    assert.ok(Math.abs(billedCost.unattributedUsd - 0.10) < 1e-9, '08-16 was billed but nobody used the app that day');
    assert.equal(billedCost.byUser.length, 1);
  });

  await t.test('a day missing from the Costs API response falls back to its estimate and is flagged', async () => {
    const owner = await db.createTestUser();
    process.env.OWNER_EMAIL = owner.email;
    process.env.OPENAI_ADMIN_KEY = 'test-admin-key';

    await seedUsage(pool, owner.uuid, { costUsd: 0.02, createdAt: '2026-08-15T10:00:00' });
    await seedUsage(pool, owner.uuid, { costUsd: 0.03, createdAt: '2026-08-16T10:00:00' });
    // Only 08-15 has been reported; 08-16 (e.g. "today") hasn't been billed yet.
    global.fetch = async () => jsonResponse(200, {
      object: 'page',
      data: [bucket('2026-08-15', 0.02)],
      has_more: false,
      next_page: null,
    });

    const { status, body } = await get(baseUrl, owner, '/usage?from=2026-08-15&to=2026-08-16');
    assert.equal(status, 200);
    const { billedCost } = body.data;
    assert.equal(billedCost.estimatedDayCount, 1);
    const day16 = billedCost.daily.find((d) => d.day === '2026-08-16');
    assert.equal(day16.estimated, true);
    assert.ok(Math.abs(day16.billedCostUsd - 0.03) < 1e-9);
    assert.ok(Math.abs(billedCost.totalUsd - 0.05) < 1e-9);
  });

  await t.test('billedCost is null (estimate-only fallback) when the Costs API call fails', async () => {
    const owner = await db.createTestUser();
    process.env.OWNER_EMAIL = owner.email;
    process.env.OPENAI_ADMIN_KEY = 'test-admin-key';
    await seedUsage(pool, owner.uuid, { costUsd: 0.02, createdAt: '2026-08-15T10:00:00' });
    global.fetch = async () => jsonResponse(500, { error: 'boom' });

    const { status, body } = await get(baseUrl, owner, '/usage?from=2026-08-15&to=2026-08-15');
    assert.equal(status, 200);
    assert.ok(body.data.totals, 'estimate totals must still be present');
    assert.equal(body.data.actualCost.status, 'unavailable');
    assert.equal(body.data.billedCost, null);
  });

  await t.test('still 404s a non-owner even with OPENAI_ADMIN_KEY set', async () => {
    const owner = await db.createTestUser();
    const other = await db.createTestUser();
    process.env.OWNER_EMAIL = owner.email;
    process.env.OPENAI_ADMIN_KEY = 'test-admin-key';
    let fetchCalls = 0;
    global.fetch = async () => { fetchCalls += 1; throw new Error('should not be called'); };

    const { status, body } = await get(baseUrl, other, '/usage');
    assert.equal(status, 404);
    assert.equal(body.message, 'Not found');
    assert.equal(fetchCalls, 0);
  });
});
