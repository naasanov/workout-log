// Characterization tests for #369: the agent's system prompt must reflect the
// user's real local "today", not the day they happen to be viewing, and
// routes/chat.ts must validate/thread a client-sent `today` field the same
// way it already does `selectedDate` (see tests/chatRoutes.test.js for the
// HTTP-testing pattern this borrows).
//
// The buildVolatileContext tests below need no database. The POST / tests
// do (real auth against a real user), and are skipped -- not failed -- when
// none is reachable, matching every other DB-backed suite here.
//
// Run with: DB_NAME=workout_log_test_localtoday npm run test:file tests/agentLocalToday.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../scripts/testDb');

function volatileInput(overrides) {
  return {
    today: '2026-09-17',
    selectedDate: '2026-09-17',
    goalsLine: '',
    todayTotals: { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 },
    recentEntries: [],
    ...overrides,
  };
}

test('buildVolatileContext (#369)', async (t) => {
  const { buildVolatileContext } = db.requireTs('services/agent/prompt/context.ts');

  await t.test('today === selectedDate: a single date line, "Today" totals label', () => {
    const block = buildVolatileContext(volatileInput());
    assert.match(block, /^TODAY'S DATE: 2026-09-17\n/);
    assert.ok(!block.includes('VIEWING DAY'), 'no VIEWING DAY line when the two dates match');
    assert.ok(block.includes('Today (2026-09-17) so far'));
  });

  await t.test('today !== selectedDate: both dates shown, totals labeled with the viewed day', () => {
    const block = buildVolatileContext(volatileInput({ today: '2026-09-17', selectedDate: '2026-09-15' }));
    assert.ok(block.includes("TODAY'S DATE: 2026-09-17"));
    assert.ok(block.includes('VIEWING DAY: 2026-09-15'));
    assert.ok(block.includes('2026-09-15 so far'));
    assert.ok(!block.includes('Today (2026-09-15)'), 'the viewed day is never labeled "Today"');
  });
});

test('POST /api/chat today validation (#369)', async (t) => {
  const available = await db.isDbReachable();
  if (!available) {
    t.skip('No reachable database on 127.0.0.1:3307. Start it with: docker compose up -d, then npm run db:setup (see scripts/testDb.js).');
    return;
  }

  await db.setupTestDb();
  const chat = db.requireTs('routes/chat.ts').default;
  const { server, baseUrl } = await db.startTestServer('/api/chat', chat);

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

  async function post(path, user, body) {
    const res = await fetch(`${baseUrl}/api/chat${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(user ? user.authHeader() : {}) },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  }

  t.beforeEach(async () => {
    await db.resetDb();
  });

  t.after(async () => {
    await db.stopTestServer(server);
    await db.closePool();
  });

  // Every case below is rejected before streamChat/the model is ever invoked,
  // so it is safe to exercise over real HTTP without a live OpenAI key.

  await t.test('rejects a non-date-shaped today', async () => {
    const user = await createUser();
    const { status, body } = await post('/', user, { messages: [], today: 'not-a-date' });
    assert.equal(status, 400);
    assert.equal(body.message, 'today must be a YYYY-MM-DD date string');
  });

  await t.test('rejects a non-string today', async () => {
    const user = await createUser();
    const { status, body } = await post('/', user, { messages: [], today: 20260917 });
    assert.equal(status, 400);
    assert.equal(body.message, 'today must be a YYYY-MM-DD date string');
  });

  await t.test('a well-formed today alongside a malformed context still fails on context', async () => {
    const user = await createUser();
    const { status, body } = await post('/', user, {
      messages: [],
      today: '2026-09-17',
      context: { selectedDate: 'not-a-date' },
    });
    assert.equal(status, 400);
    assert.equal(body.message, 'context must describe { tab?, selectedDate?, focusedResource? }');
  });
});
