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

test('buildVolatileContext localTime (#411)', async (t) => {
  const { buildVolatileContext } = db.requireTs('services/agent/prompt/context.ts');

  await t.test('renders a USER LOCAL TIME line under the date when given', () => {
    const block = buildVolatileContext(volatileInput({ localTime: '13:05' }));
    assert.match(block, /^TODAY'S DATE: 2026-09-17\nUSER LOCAL TIME: 13:05\n/);
  });

  await t.test('omits the line when absent', () => {
    assert.ok(!buildVolatileContext(volatileInput()).includes('USER LOCAL TIME'));
  });

  await t.test('local time lives only in the volatile tail of the system prompt', () => {
    const { buildSystemPrompt } = db.requireTs('services/agent/prompt/index.ts');
    const withTime = buildSystemPrompt({ uncEnabled: false, userInstructions: null, ...volatileInput({ localTime: '13:05' }) });
    const without = buildSystemPrompt({ uncEnabled: false, userInstructions: null, ...volatileInput() });
    const cut = without.indexOf("TODAY'S DATE");
    assert.equal(withTime.slice(0, cut), without.slice(0, cut), 'stable prefix is unchanged by localTime');
  });
});

test('nutrition prompt asks (#411) and web-search fallback (#414)', () => {
  const { NUTRITION_DOMAIN_PROMPT: p } = db.requireTs('services/agent/prompt/nutrition.ts');
  assert.ok(!p.includes('say so and ask the user'));
  assert.ok(!/based on context or ask/.test(p));
  assert.match(p, /near-miss counts as no match/);
  assert.match(p, /LAST resort/);
  assert.match(p, /ALWAYS estimate quantities from the photo/);
});

test('nutrition prompt covers every mentioned item and never drops silently (#420)', () => {
  const { NUTRITION_DOMAIN_PROMPT: p } = db.requireTs('services/agent/prompt/nutrition.ts');
  assert.match(p, /Every food or drink the user mentions .* MUST be covered by a `propose_entry` in that same turn/);
  assert.match(p, /compose a best estimate from standard components/);
  assert.match(p, /a drink alongside a meal/);
  assert.match(p, /Dropped item:.*MUST name that item and why/);
  assert.match(p, /Never leave an item out silently/);
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

  await t.test('rejects a malformed or non-string localTime', async () => {
    const user = await createUser();
    for (const localTime of ['25:00', '1:05', '13:5', 'noon', 1305]) {
      const { status, body } = await post('/', user, { messages: [], localTime });
      assert.equal(status, 400, String(localTime));
      assert.equal(body.message, 'localTime must be an HH:mm 24-hour time string');
    }
  });

  await t.test('a well-formed localTime passes validation and reaches the context check', async () => {
    const user = await createUser();
    const { status, body } = await post('/', user, {
      messages: [],
      localTime: '13:05',
      context: { selectedDate: 'not-a-date' },
    });
    assert.equal(status, 400);
    assert.equal(body.message, 'context must describe { tab?, selectedDate?, focusedResource? }');
  });
});
