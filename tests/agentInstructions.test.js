// GET/PUT /users/agent-instructions (#382), exercised through the real
// routes/users.ts endpoints against a real MySQL schema, the same way
// tests/tabPreferences.test.js does.
//
// Requires a reachable database (see scripts/testDb.js). If none is
// reachable, every test here is skipped (not failed) so `npm test` still
// passes for someone who hasn't started Docker.
//
// Run with: DB_NAME=workout_log_test_instructions node --test tests/agentInstructions.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../scripts/testDb');

async function get(baseUrl, user) {
  const res = await fetch(`${baseUrl}/api/users/agent-instructions`, { headers: user.authHeader() });
  return { status: res.status, body: await res.json() };
}

async function put(baseUrl, user, instructions) {
  const res = await fetch(`${baseUrl}/api/users/agent-instructions`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...user.authHeader() },
    body: JSON.stringify({ instructions }),
  });
  return { status: res.status, body: await res.json() };
}

test('agent instructions routes', async (t) => {
  const available = await db.isDbReachable();
  if (!available) {
    t.skip('No reachable database on 127.0.0.1:3307. Start it with: docker compose up -d, then npm run db:setup (see scripts/testDb.js).');
    return;
  }

  await db.setupTestDb();
  const users = db.requireTs('routes/users.ts').default;
  const { server, baseUrl } = await db.startTestServer('/api/users', users);

  t.beforeEach(async () => {
    await db.resetDb();
  });

  t.after(async () => {
    await db.stopTestServer(server);
    await db.closePool();
  });

  await t.test('rejects an unauthenticated GET', async () => {
    const res = await fetch(`${baseUrl}/api/users/agent-instructions`);
    assert.equal(res.status, 401);
  });

  await t.test('rejects an unauthenticated PUT', async () => {
    const res = await fetch(`${baseUrl}/api/users/agent-instructions`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instructions: 'hi' }),
    });
    assert.equal(res.status, 401);
  });

  await t.test('GET returns null for a user who has never set instructions', async () => {
    const user = await db.createTestUser();
    const { status, body } = await get(baseUrl, user);
    assert.equal(status, 200);
    assert.deepEqual(body.data, { instructions: null });
  });

  await t.test('PUT then GET round-trips the saved text', async () => {
    const user = await db.createTestUser();
    const { status, body: putBody } = await put(baseUrl, user, 'Always respond in metric units.');
    assert.equal(status, 200);
    assert.deepEqual(putBody.data, { instructions: 'Always respond in metric units.' });

    const { body: getBody } = await get(baseUrl, user);
    assert.deepEqual(getBody.data, { instructions: 'Always respond in metric units.' });
  });

  await t.test('PUT trims surrounding whitespace before saving', async () => {
    const user = await db.createTestUser();
    await put(baseUrl, user, '   Be concise.   ');

    const { body } = await get(baseUrl, user);
    assert.deepEqual(body.data, { instructions: 'Be concise.' });
  });

  await t.test('PUT with a whitespace-only value saves as null', async () => {
    const user = await db.createTestUser();
    // First set a real value, so this proves it actually clears it.
    await put(baseUrl, user, 'Be concise.');
    const { status, body } = await put(baseUrl, user, '   \n\t  ');
    assert.equal(status, 200);
    assert.deepEqual(body.data, { instructions: null });

    const { body: getBody } = await get(baseUrl, user);
    assert.deepEqual(getBody.data, { instructions: null });
  });

  await t.test('PUT rejects text over 1000 characters', async () => {
    const user = await db.createTestUser();
    const { status } = await put(baseUrl, user, 'a'.repeat(1001));
    assert.equal(status, 400);
  });

  await t.test('PUT accepts exactly 1000 characters', async () => {
    const user = await db.createTestUser();
    const text = 'a'.repeat(1000);
    const { status, body } = await put(baseUrl, user, text);
    assert.equal(status, 200);
    assert.equal(body.data.instructions, text);
  });

  await t.test('each user\'s instructions are isolated from the other\'s', async () => {
    const userA = await db.createTestUser();
    const userB = await db.createTestUser();
    await put(baseUrl, userA, 'User A preferences.');
    await put(baseUrl, userB, 'User B preferences.');

    const { body: bodyA } = await get(baseUrl, userA);
    const { body: bodyB } = await get(baseUrl, userB);
    assert.deepEqual(bodyA.data, { instructions: 'User A preferences.' });
    assert.deepEqual(bodyB.data, { instructions: 'User B preferences.' });
  });
});
