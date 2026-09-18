// Tests for the actual-billed-cost overlay on routes/admin.ts's GET /usage
// (#352 remainder), backed by services/nutrition/openaiCosts.ts. Exercises
// real HTTP requests through the actual router against a real MySQL schema
// for the estimate side, mirroring tests/adminUsage.test.js, but stubs
// global fetch for the external OpenAI Costs API call -- never mock
// pool.query, only the outbound HTTP to a third party.
//
// Requires a reachable database (see scripts/testDb.js). If none is
// reachable, every test here is skipped (not failed) so `npm test` still
// passes for someone who hasn't started Docker.
//
// Run with: DB_NAME=workout_log_test_openaicost npm run test:file tests/adminOpenAiCosts.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../scripts/testDb');

// Captured before any test stubs global.fetch, since the tests below replace
// global.fetch to intercept the OpenAI Costs API call, and this helper's own
// request to the local test server must not go through that stub.
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

function bucket(day, ...values) {
  return {
    object: 'bucket',
    start_time: daySeconds(day),
    end_time: daySeconds(day) + 86_400,
    results: values.map((value) => ({
      object: 'organization.costs.result',
      amount: { value, currency: 'usd' },
      line_item: null,
      project_id: null,
      organization_id: 'org-test',
    })),
  };
}

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

test('admin usage actual-cost (OpenAI Costs API) overlay', async (t) => {
  const available = await db.isDbReachable();
  if (!available) {
    t.skip('No reachable database on 127.0.0.1:3307. Start it with: docker compose up -d, then npm run db:setup (see scripts/testDb.js).');
    return;
  }

  await db.setupTestDb();
  const admin = db.requireTs('routes/admin.ts').default;
  const { _clearActualCostCache } = db.requireTs('services/nutrition/openaiCosts.ts');
  const { server, baseUrl } = await db.startTestServer('/api/admin', admin);

  const originalOwnerEmail = process.env.OWNER_EMAIL;
  const originalAdminKey = process.env.OPENAI_ADMIN_KEY;
  const originalProjectId = process.env.OPENAI_PROJECT_ID;
  const originalFetch = global.fetch;

  t.beforeEach(async () => {
    await db.resetDb();
    delete process.env.OWNER_EMAIL;
    delete process.env.OPENAI_ADMIN_KEY;
    delete process.env.OPENAI_PROJECT_ID;
    _clearActualCostCache();
    global.fetch = originalFetch;
  });

  t.after(async () => {
    if (originalOwnerEmail === undefined) delete process.env.OWNER_EMAIL;
    else process.env.OWNER_EMAIL = originalOwnerEmail;
    if (originalAdminKey === undefined) delete process.env.OPENAI_ADMIN_KEY;
    else process.env.OPENAI_ADMIN_KEY = originalAdminKey;
    if (originalProjectId === undefined) delete process.env.OPENAI_PROJECT_ID;
    else process.env.OPENAI_PROJECT_ID = originalProjectId;
    global.fetch = originalFetch;
    await db.stopTestServer(server);
    await db.closePool();
  });

  await t.test('GET /usage returns actualCost: null when OPENAI_ADMIN_KEY is unset', async () => {
    const owner = await db.createTestUser();
    process.env.OWNER_EMAIL = owner.email;
    let fetchCalls = 0;
    global.fetch = async () => { fetchCalls += 1; throw new Error('should not be called'); };

    const { status, body } = await get(baseUrl, owner, '/usage?from=2026-08-10&to=2026-08-11');
    assert.equal(status, 200);
    assert.equal(body.data.actualCost, null);
    assert.equal(fetchCalls, 0);
  });

  await t.test('GET /usage aggregates OpenAI bucket results into a per-day actual cost', async () => {
    const owner = await db.createTestUser();
    process.env.OWNER_EMAIL = owner.email;
    process.env.OPENAI_ADMIN_KEY = 'test-admin-key';

    global.fetch = async () => jsonResponse(200, {
      object: 'page',
      data: [
        bucket('2026-08-15', 1.5, 0.25), // two results, same day -- must sum
        bucket('2026-08-16', 2.0),
      ],
      has_more: false,
      next_page: null,
    });

    const { status, body } = await get(baseUrl, owner, '/usage?from=2026-08-15&to=2026-08-16');
    assert.equal(status, 200);
    const { actualCost } = body.data;
    assert.equal(actualCost.status, 'ok');
    assert.equal(actualCost.daily.length, 2);
    const day15 = actualCost.daily.find((d) => d.date === '2026-08-15');
    const day16 = actualCost.daily.find((d) => d.date === '2026-08-16');
    assert.ok(Math.abs(day15.costUsd - 1.75) < 1e-9);
    assert.ok(Math.abs(day16.costUsd - 2.0) < 1e-9);
    assert.ok(Math.abs(actualCost.totalUsd - 3.75) < 1e-9);
  });

  await t.test('GET /usage follows next_page/has_more pagination across multiple requests', async () => {
    const owner = await db.createTestUser();
    process.env.OWNER_EMAIL = owner.email;
    process.env.OPENAI_ADMIN_KEY = 'test-admin-key';

    const calls = [];
    global.fetch = async (url) => {
      calls.push(url);
      const page = new URL(url).searchParams.get('page');
      if (!page) {
        return jsonResponse(200, {
          object: 'page',
          data: [bucket('2026-08-20', 1.0)],
          has_more: true,
          next_page: 'cursor-abc',
        });
      }
      assert.equal(page, 'cursor-abc');
      return jsonResponse(200, {
        object: 'page',
        data: [bucket('2026-08-21', 2.0)],
        has_more: false,
        next_page: null,
      });
    };

    const { status, body } = await get(baseUrl, owner, '/usage?from=2026-08-20&to=2026-08-21');
    assert.equal(status, 200);
    assert.equal(calls.length, 2);
    const { actualCost } = body.data;
    assert.equal(actualCost.status, 'ok');
    assert.equal(actualCost.daily.length, 2);
    assert.ok(Math.abs(actualCost.totalUsd - 3.0) < 1e-9);
  });

  await t.test('GET /usage includes project_ids in the request when OPENAI_PROJECT_ID is set', async () => {
    const owner = await db.createTestUser();
    process.env.OWNER_EMAIL = owner.email;
    process.env.OPENAI_ADMIN_KEY = 'test-admin-key';
    process.env.OPENAI_PROJECT_ID = 'proj_a, proj_b';

    let seenProjectIds = null;
    global.fetch = async (url) => {
      seenProjectIds = new URL(url).searchParams.getAll('project_ids');
      return jsonResponse(200, { object: 'page', data: [], has_more: false, next_page: null });
    };

    const { status } = await get(baseUrl, owner, '/usage?from=2026-08-22&to=2026-08-22');
    assert.equal(status, 200);
    assert.deepEqual(seenProjectIds, ['proj_a', 'proj_b']);
  });

  await t.test('GET /usage returns the estimate plus an unavailable actualCost when the OpenAI API errors', async () => {
    const owner = await db.createTestUser();
    process.env.OWNER_EMAIL = owner.email;
    process.env.OPENAI_ADMIN_KEY = 'test-admin-key';
    global.fetch = async () => jsonResponse(500, { error: 'boom' });

    const { status, body } = await get(baseUrl, owner, '/usage?from=2026-08-23&to=2026-08-23');
    assert.equal(status, 200);
    assert.ok(body.data.totals, 'estimate totals must still be present');
    const { actualCost } = body.data;
    assert.equal(actualCost.status, 'unavailable');
    assert.equal(actualCost.totalUsd, null);
    assert.equal(actualCost.daily.length, 0);
    assert.ok(actualCost.message);
  });

  await t.test('GET /usage returns an unavailable actualCost when fetch itself throws (e.g. timeout)', async () => {
    const owner = await db.createTestUser();
    process.env.OWNER_EMAIL = owner.email;
    process.env.OPENAI_ADMIN_KEY = 'test-admin-key';
    global.fetch = async () => { throw new Error('network timeout'); };

    const { status, body } = await get(baseUrl, owner, '/usage?from=2026-08-24&to=2026-08-24');
    assert.equal(status, 200);
    assert.equal(body.data.actualCost.status, 'unavailable');
  });

  await t.test('GET /usage still 404s a non-owner even when OPENAI_ADMIN_KEY is set', async () => {
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
