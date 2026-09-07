// Tests for services/tabPreferences.ts's known_tabs merge, exercised through
// the real GET/PUT /users/tab-preferences endpoints (routes/users.ts) against
// a real MySQL schema, the same way tests/bodyWeight.test.js does.
//
// A "new tab key" is simulated by seeding a row whose known_tabs omits a key
// that is currently canonical (TAB_KEYS), rather than by editing TAB_KEYS
// itself -- that constant, and the tab-history feature it will grow to
// include, belong to a later wave.
//
// Requires a reachable database (see scripts/testDb.js). If none is
// reachable, every test here is skipped (not failed) so `npm test` still
// passes for someone who hasn't started Docker.
//
// Run with: DB_NAME=workout_log_test_tabs node --test tests/tabPreferences.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../scripts/testDb');

async function get(baseUrl, user) {
  const res = await fetch(`${baseUrl}/api/users/tab-preferences`, { headers: user.authHeader() });
  return { status: res.status, body: await res.json() };
}

async function put(baseUrl, user, enabledTabs) {
  const res = await fetch(`${baseUrl}/api/users/tab-preferences`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...user.authHeader() },
    body: JSON.stringify({ enabledTabs }),
  });
  return { status: res.status, body: await res.json() };
}

// Writes a tab_preferences row directly, bypassing the PUT route, so a test
// can set up known_tabs/enabled_tabs combinations the route itself would
// never produce (e.g. a known_tabs missing a currently-canonical key).
async function seedRow(pool, uuid, enabledTabs, knownTabs) {
  await pool.query(
    `INSERT INTO tab_preferences (user_uuid, enabled_tabs, known_tabs)
     VALUES (UUID_TO_BIN(?), CAST(? AS JSON), CAST(? AS JSON))
     ON DUPLICATE KEY UPDATE enabled_tabs = VALUES(enabled_tabs), known_tabs = VALUES(known_tabs)`,
    [uuid, JSON.stringify(enabledTabs), JSON.stringify(knownTabs)],
  );
}

async function readKnownTabs(pool, uuid) {
  const [rows] = await pool.query(
    `SELECT known_tabs FROM tab_preferences WHERE user_uuid = UUID_TO_BIN(?)`,
    [uuid],
  );
  if (rows.length === 0) return null;
  const value = rows[0].known_tabs;
  return typeof value === 'string' ? JSON.parse(value) : value;
}

test('tab preferences routes', async (t) => {
  const available = await db.isDbReachable();
  if (!available) {
    t.skip('No reachable database on 127.0.0.1:3307. Start it with: docker compose up -d, then npm run db:setup (see scripts/testDb.js).');
    return;
  }

  await db.setupTestDb();
  const users = db.requireTs('routes/users.ts').default;
  const { TAB_KEYS } = db.requireTs('schemas/tabPreferences.ts');
  const { server, baseUrl } = await db.startTestServer('/api/users', users);
  const pool = db.getPool();

  t.beforeEach(async () => {
    await db.resetDb();
  });

  t.after(async () => {
    await db.stopTestServer(server);
    await db.closePool();
  });

  await t.test('rejects an unauthenticated GET', async () => {
    const res = await fetch(`${baseUrl}/api/users/tab-preferences`);
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.message, 'Unauthorized: access token required');
  });

  await t.test('rejects a GET with a garbage bearer token', async () => {
    const res = await fetch(`${baseUrl}/api/users/tab-preferences`, {
      headers: { Authorization: 'Bearer not-a-real-token' },
    });
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.message, 'Forbidden access token');
  });

  await t.test('rejects an unauthenticated PUT', async () => {
    const res = await fetch(`${baseUrl}/api/users/tab-preferences`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabledTabs: ['workouts'] }),
    });
    assert.equal(res.status, 401);
  });

  await t.test('GET returns [] for a user with no tab_preferences row', async () => {
    const user = await db.createTestUser();
    const { status, body } = await get(baseUrl, user);
    assert.equal(status, 200);
    assert.deepEqual(body.data, []);
  });

  await t.test('a deliberately disabled tab stays disabled after a new tab key is introduced', async () => {
    const user = await db.createTestUser();
    // The last canonical key stands in for a just-added tab: it is the only one
    // missing from known_tabs. Derived from TAB_KEYS so adding a real tab later
    // does not turn this into a two-new-keys case and break the assertion.
    const newKey = TAB_KEYS[TAB_KEYS.length - 1];
    const offered = TAB_KEYS.filter((k) => k !== newKey);
    const disabled = offered[1];
    const enabled = offered.filter((k) => k !== disabled);

    await seedRow(pool, user.uuid, enabled, offered);

    const { status, body } = await get(baseUrl, user);
    assert.equal(status, 200);
    // The new key is adopted; the deliberately disabled one stays off.
    assert.deepEqual(body.data, [...enabled, newKey]);
  });

  await t.test('a brand-new tab key is adopted for a user who has never seen it', async () => {
    const user = await db.createTestUser();
    // Everything except the last canonical key has been offered and enabled,
    // so that key is the single new one. Derived from TAB_KEYS so a future tab
    // addition does not silently make this a two-new-keys case.
    const newKey = TAB_KEYS[TAB_KEYS.length - 1];
    const offered = TAB_KEYS.filter((k) => k !== newKey);

    await seedRow(pool, user.uuid, offered, offered);

    const { status, body } = await get(baseUrl, user);
    assert.equal(status, 200);
    assert.deepEqual(body.data, [...offered, newKey]);

    const knownAfter = await readKnownTabs(pool, user.uuid);
    assert.deepEqual(new Set(knownAfter), new Set(TAB_KEYS));
  });

  await t.test('the merge is idempotent: reading twice does not duplicate or reorder', async () => {
    const user = await db.createTestUser();
    await seedRow(pool, user.uuid, ['nutrition'], ['nutrition']);

    const first = await get(baseUrl, user);
    const second = await get(baseUrl, user);
    assert.deepEqual(first.body.data, second.body.data);

    // no duplicate keys introduced by either read
    assert.equal(new Set(second.body.data).size, second.body.data.length);
    const knownAfter = await readKnownTabs(pool, user.uuid);
    assert.equal(new Set(knownAfter).size, knownAfter.length);
    assert.deepEqual(new Set(knownAfter), new Set(TAB_KEYS));
  });

  await t.test('ordering is preserved for keys the user has explicitly arranged', async () => {
    const user = await db.createTestUser();
    const { status } = await put(baseUrl, user, ['nutrition', 'workouts', 'habits']);
    assert.equal(status, 200);

    const { body } = await get(baseUrl, user);
    assert.deepEqual(body.data, ['nutrition', 'workouts', 'habits']);
  });

  await t.test('PUT then GET does not re-adopt an already-known but disabled tab', async () => {
    const user = await db.createTestUser();
    await put(baseUrl, user, ['workouts']);

    const { body } = await get(baseUrl, user);
    assert.deepEqual(body.data, ['workouts']);
  });

  await t.test('GET only returns the authenticated user\'s own preferences', async () => {
    const userA = await db.createTestUser();
    const userB = await db.createTestUser();
    await put(baseUrl, userA, ['workouts']);
    await put(baseUrl, userB, ['nutrition', 'habits']);

    const { body: bodyA } = await get(baseUrl, userA);
    const { body: bodyB } = await get(baseUrl, userB);
    assert.deepEqual(bodyA.data, ['workouts']);
    assert.deepEqual(bodyB.data, ['nutrition', 'habits']);
  });

  await t.test('PUT rejects an unknown tab key', async () => {
    const user = await db.createTestUser();
    const { status } = await put(baseUrl, user, ['not-a-real-tab']);
    assert.equal(status, 400);
  });

  await t.test('PUT rejects duplicate keys', async () => {
    const user = await db.createTestUser();
    const { status, body } = await put(baseUrl, user, ['workouts', 'workouts']);
    assert.equal(status, 400);
    assert.equal(body.message, 'enabledTabs must not contain duplicates');
  });
});
