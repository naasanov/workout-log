// Characterization tests for routes/apiV1.ts, pinning its CURRENT behavior
// (warts included) so the SQL-to-service-module refactor can be verified
// against these as a baseline. Exercises real HTTP requests through the
// actual router against a real MySQL schema, mirroring tests/bodyWeight.test.js.
//
// apiV1 is authenticated by X-API-Key rather than a JWT, except for the
// /keys management routes themselves, which use the normal JWT auth so an
// owner can mint/list/revoke their own keys. Tests below mint a key through
// that route, then use it as any external client would.
//
// Requires a reachable database (see scripts/testDb.js). If none is
// reachable, every test here is skipped (not failed) so `npm test` still
// passes for someone who hasn't started Docker.
//
// Run with: DB_NAME=workout_log_test_api node --test tests/apiV1.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../scripts/testDb');

const BASE = '/api/v1';

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function req(baseUrl, method, path, { apiKey, token, body, query } = {}) {
  const qs = query ? `?${new URLSearchParams(query).toString()}` : '';
  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers['X-API-Key'] = apiKey;
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${baseUrl}${BASE}${path}${qs}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json() };
}

// Mints a fresh API key for a test user through the JWT-authenticated /keys
// route -- exercising the same minting path a real owner would use, rather
// than reaching into the api_keys table directly.
async function mintApiKey(baseUrl, user, label) {
  const { status, body } = await req(baseUrl, 'POST', '/keys', {
    token: user.token,
    body: { label: label ?? null },
  });
  assert.equal(status, 201);
  return body.data.key;
}

test('apiV1 routes', async (t) => {
  const available = await db.isDbReachable();
  if (!available) {
    t.skip('No reachable database on 127.0.0.1:3307. Start it with: docker compose up -d, then npm run db:setup (see scripts/testDb.js).');
    return;
  }

  await db.setupTestDb();
  const apiV1 = db.requireTs('routes/apiV1.ts').default;
  const { server, baseUrl } = await db.startTestServer(BASE, apiV1);

  t.beforeEach(async () => {
    await db.resetDb();
  });

  t.after(async () => {
    await db.stopTestServer(server);
    await db.closePool();
  });

  // ── API key management (JWT-authenticated) ──────────────────────────────

  await t.test('POST /keys requires a JWT, not an API key', async () => {
    const { status, body } = await req(baseUrl, 'POST', '/keys', { body: { label: 'x' } });
    assert.equal(status, 401);
    assert.equal(body.message, 'Unauthorized: access token required');
  });

  await t.test('POST /keys creates a key; the raw key is only ever shown once', async () => {
    const user = await db.createTestUser();
    const { status, body } = await req(baseUrl, 'POST', '/keys', {
      token: user.token,
      body: { label: 'my key' },
    });
    assert.equal(status, 201);
    assert.equal(typeof body.data.key, 'string');
    assert.equal(body.data.label, 'my key');
    assert.equal(typeof body.data.id, 'number');
  });

  await t.test('GET /keys lists only the caller\'s own keys, never the raw key value', async () => {
    const userA = await db.createTestUser();
    const userB = await db.createTestUser();
    await mintApiKey(baseUrl, userA, 'a1');
    await mintApiKey(baseUrl, userB, 'b1');
    await mintApiKey(baseUrl, userB, 'b2');

    const { status, body } = await req(baseUrl, 'GET', '/keys', { token: userA.token });
    assert.equal(status, 200);
    assert.equal(body.data.length, 1);
    assert.equal(body.data[0].label, 'a1');
    assert.equal(body.data[0].key, undefined);
  });

  await t.test('DELETE /keys/:id revokes a key; it stops authenticating afterward', async () => {
    const user = await db.createTestUser();
    const { body: created } = await req(baseUrl, 'POST', '/keys', { token: user.token, body: {} });
    const rawKey = created.data.key;
    const keyId = created.data.id;

    const before = await req(baseUrl, 'GET', '/workouts', { apiKey: rawKey });
    assert.equal(before.status, 200);

    const del = await req(baseUrl, 'DELETE', `/keys/${keyId}`, { token: user.token });
    assert.equal(del.status, 200);

    const after = await req(baseUrl, 'GET', '/workouts', { apiKey: rawKey });
    assert.equal(after.status, 401);
  });

  await t.test('DELETE /keys/:id 404s for another user\'s key', async () => {
    const userA = await db.createTestUser();
    const userB = await db.createTestUser();
    const { body: created } = await req(baseUrl, 'POST', '/keys', { token: userB.token, body: {} });

    const { status } = await req(baseUrl, 'DELETE', `/keys/${created.data.id}`, { token: userA.token });
    assert.equal(status, 404);
  });

  // ── API key auth on every route below ───────────────────────────────────

  await t.test('rejects a request with no API key', async () => {
    const { status, body } = await req(baseUrl, 'GET', '/workouts');
    assert.equal(status, 401);
    assert.match(body.message, /API key required/);
  });

  await t.test('rejects a request with a bad API key', async () => {
    const { status, body } = await req(baseUrl, 'GET', '/workouts', { apiKey: 'not-a-real-key' });
    assert.equal(status, 401);
    assert.match(body.message, /invalid API key/);
  });

  // ── Workouts ─────────────────────────────────────────────────────────────

  await t.test('POST /workouts creates a workout; GET /workouts lists it as {id, label}', async () => {
    const user = await db.createTestUser();
    const apiKey = await mintApiKey(baseUrl, user);

    const created = await req(baseUrl, 'POST', '/workouts', { apiKey, body: { name: 'Push Day' } });
    assert.equal(created.status, 201);
    assert.equal(typeof created.body.data.id, 'number');

    const list = await req(baseUrl, 'GET', '/workouts', { apiKey });
    assert.equal(list.status, 200);
    assert.deepEqual(list.body.data, [{ id: created.body.data.id, label: 'Push Day' }]);
  });

  await t.test('GET /workouts only returns the authenticated user\'s own workouts', async () => {
    const userA = await db.createTestUser();
    const userB = await db.createTestUser();
    const keyA = await mintApiKey(baseUrl, userA);
    const keyB = await mintApiKey(baseUrl, userB);

    await req(baseUrl, 'POST', '/workouts', { apiKey: keyA, body: { name: 'A workout' } });
    await req(baseUrl, 'POST', '/workouts', { apiKey: keyB, body: { name: 'B workout 1' } });
    await req(baseUrl, 'POST', '/workouts', { apiKey: keyB, body: { name: 'B workout 2' } });

    const listA = await req(baseUrl, 'GET', '/workouts', { apiKey: keyA });
    const listB = await req(baseUrl, 'GET', '/workouts', { apiKey: keyB });
    assert.equal(listA.body.data.length, 1);
    assert.equal(listB.body.data.length, 2);
  });

  await t.test('POST /workouts rejects a missing/invalid label', async () => {
    const user = await db.createTestUser();
    const apiKey = await mintApiKey(baseUrl, user);
    const { status, body } = await req(baseUrl, 'POST', '/workouts', { apiKey, body: {} });
    assert.equal(status, 400);
    assert.equal(body.message, 'Request body must include a non-null label');
  });

  await t.test('DELETE /workouts/:id deletes a workout the user owns', async () => {
    const user = await db.createTestUser();
    const apiKey = await mintApiKey(baseUrl, user);
    const { body: created } = await req(baseUrl, 'POST', '/workouts', { apiKey, body: { name: 'W' } });

    const del = await req(baseUrl, 'DELETE', `/workouts/${created.data.id}`, { apiKey });
    assert.equal(del.status, 200);

    const list = await req(baseUrl, 'GET', '/workouts', { apiKey });
    assert.deepEqual(list.body.data, []);
  });

  await t.test('DELETE /workouts/:id 404s for a nonexistent id', async () => {
    const user = await db.createTestUser();
    const apiKey = await mintApiKey(baseUrl, user);
    const { status } = await req(baseUrl, 'DELETE', '/workouts/999999', { apiKey });
    assert.equal(status, 404);
  });

  await t.test('DELETE /workouts/:id 404s for another user\'s workout, leaving it intact', async () => {
    const owner = await db.createTestUser();
    const attacker = await db.createTestUser();
    const ownerKey = await mintApiKey(baseUrl, owner);
    const attackerKey = await mintApiKey(baseUrl, attacker);

    const { body: created } = await req(baseUrl, 'POST', '/workouts', { apiKey: ownerKey, body: { name: 'Mine' } });

    const del = await req(baseUrl, 'DELETE', `/workouts/${created.data.id}`, { apiKey: attackerKey });
    assert.equal(del.status, 404);

    const list = await req(baseUrl, 'GET', '/workouts', { apiKey: ownerKey });
    assert.deepEqual(list.body.data, [{ id: created.data.id, label: 'Mine' }]);
  });

  // ── Movements ────────────────────────────────────────────────────────────

  await t.test('GET /movements requires workoutId', async () => {
    const user = await db.createTestUser();
    const apiKey = await mintApiKey(baseUrl, user);
    const { status, body } = await req(baseUrl, 'GET', '/movements', { apiKey });
    assert.equal(status, 400);
    assert.equal(body.message, 'Query parameter workoutId is required');
  });

  await t.test('GET /movements returns an empty list for a workoutId the caller doesn\'t own', async () => {
    const userA = await db.createTestUser();
    const userB = await db.createTestUser();
    const keyA = await mintApiKey(baseUrl, userA);
    const keyB = await mintApiKey(baseUrl, userB);
    const { body: workout } = await req(baseUrl, 'POST', '/workouts', { apiKey: keyA, body: { name: 'A' } });

    const { status, body } = await req(baseUrl, 'GET', '/movements', {
      apiKey: keyB,
      query: { workoutId: String(workout.data.id) },
    });
    assert.equal(status, 200);
    assert.deepEqual(body.data, []);
  });

  await t.test('POST /movements creates a movement; GET /movements lists it as {id, label}', async () => {
    const user = await db.createTestUser();
    const apiKey = await mintApiKey(baseUrl, user);
    const { body: workout } = await req(baseUrl, 'POST', '/workouts', { apiKey, body: { name: 'W' } });

    const created = await req(baseUrl, 'POST', '/movements', {
      apiKey,
      body: { name: 'Bench Press', workoutId: workout.data.id },
    });
    assert.equal(created.status, 201);

    const list = await req(baseUrl, 'GET', '/movements', { apiKey, query: { workoutId: String(workout.data.id) } });
    assert.equal(list.status, 200);
    assert.deepEqual(list.body.data, [{ id: created.body.data.id, label: 'Bench Press' }]);
  });

  await t.test('POST /movements 404s for a nonexistent workoutId', async () => {
    const user = await db.createTestUser();
    const apiKey = await mintApiKey(baseUrl, user);
    const { status } = await req(baseUrl, 'POST', '/movements', { apiKey, body: { name: 'X', workoutId: 999999 } });
    assert.equal(status, 404);
  });

  await t.test('POST /movements 404s for another user\'s workoutId, without creating a movement', async () => {
    const owner = await db.createTestUser();
    const attacker = await db.createTestUser();
    const ownerKey = await mintApiKey(baseUrl, owner);
    const attackerKey = await mintApiKey(baseUrl, attacker);
    const { body: workout } = await req(baseUrl, 'POST', '/workouts', { apiKey: ownerKey, body: { name: 'W' } });

    const created = await req(baseUrl, 'POST', '/movements', {
      apiKey: attackerKey,
      body: { name: 'Sneaky', workoutId: workout.data.id },
    });
    assert.equal(created.status, 404);

    const list = await req(baseUrl, 'GET', '/movements', { apiKey: ownerKey, query: { workoutId: String(workout.data.id) } });
    assert.deepEqual(list.body.data, []);
  });

  await t.test('DELETE /movements/:id deletes a movement', async () => {
    const user = await db.createTestUser();
    const apiKey = await mintApiKey(baseUrl, user);
    const { body: workout } = await req(baseUrl, 'POST', '/workouts', { apiKey, body: { name: 'W' } });
    const { body: movement } = await req(baseUrl, 'POST', '/movements', {
      apiKey,
      body: { name: 'M', workoutId: workout.data.id },
    });

    const del = await req(baseUrl, 'DELETE', `/movements/${movement.data.id}`, { apiKey });
    assert.equal(del.status, 200);

    const list = await req(baseUrl, 'GET', '/movements', { apiKey, query: { workoutId: String(workout.data.id) } });
    assert.deepEqual(list.body.data, []);
  });

  await t.test('DELETE /movements/:id 404s for another user\'s movement, leaving it intact', async () => {
    const owner = await db.createTestUser();
    const attacker = await db.createTestUser();
    const ownerKey = await mintApiKey(baseUrl, owner);
    const attackerKey = await mintApiKey(baseUrl, attacker);
    const { body: workout } = await req(baseUrl, 'POST', '/workouts', { apiKey: ownerKey, body: { name: 'W' } });
    const { body: movement } = await req(baseUrl, 'POST', '/movements', {
      apiKey: ownerKey,
      body: { name: 'M', workoutId: workout.data.id },
    });

    const del = await req(baseUrl, 'DELETE', `/movements/${movement.data.id}`, { apiKey: attackerKey });
    assert.equal(del.status, 404);

    const list = await req(baseUrl, 'GET', '/movements', { apiKey: ownerKey, query: { workoutId: String(workout.data.id) } });
    assert.deepEqual(list.body.data, [{ id: movement.data.id, label: 'M' }]);
  });

  // ── Variations ───────────────────────────────────────────────────────────

  async function createWorkoutMovement(apiKey) {
    const { body: workout } = await req(baseUrl, 'POST', '/workouts', { apiKey, body: { name: 'W' } });
    const { body: movement } = await req(baseUrl, 'POST', '/movements', {
      apiKey,
      body: { name: 'M', workoutId: workout.data.id },
    });
    return { workoutId: workout.data.id, movementId: movement.data.id };
  }

  await t.test('GET /variations requires movementId', async () => {
    const user = await db.createTestUser();
    const apiKey = await mintApiKey(baseUrl, user);
    const { status, body } = await req(baseUrl, 'GET', '/variations', { apiKey });
    assert.equal(status, 400);
    assert.equal(body.message, 'Query parameter movementId is required');
  });

  await t.test('POST /variations creates a variation with defaulted reps; GET lists {id,label,weight,reps,date}', async () => {
    const user = await db.createTestUser();
    const apiKey = await mintApiKey(baseUrl, user);
    const { movementId } = await createWorkoutMovement(apiKey);

    const created = await req(baseUrl, 'POST', '/variations', {
      apiKey,
      body: { label: 'Barbell', weight: 135, movementId },
    });
    assert.equal(created.status, 201);

    const list = await req(baseUrl, 'GET', '/variations', { apiKey, query: { movementId: String(movementId) } });
    assert.equal(list.status, 200);
    assert.equal(list.body.data.length, 1);
    const v = list.body.data[0];
    assert.equal(v.id, created.body.data.id);
    assert.equal(v.label, 'Barbell');
    assert.equal(v.weight, 135);
    assert.equal(v.reps, 0);
    assert.ok(v.date);
    assert.equal(v.notes, undefined);
  });

  await t.test('POST /variations 404s for another user\'s movementId, without creating a variation', async () => {
    const owner = await db.createTestUser();
    const attacker = await db.createTestUser();
    const ownerKey = await mintApiKey(baseUrl, owner);
    const attackerKey = await mintApiKey(baseUrl, attacker);
    const { movementId } = await createWorkoutMovement(ownerKey);

    const created = await req(baseUrl, 'POST', '/variations', {
      apiKey: attackerKey,
      body: { label: 'Sneaky', movementId },
    });
    assert.equal(created.status, 404);

    const list = await req(baseUrl, 'GET', '/variations', { apiKey: ownerKey, query: { movementId: String(movementId) } });
    assert.deepEqual(list.body.data, []);
  });

  await t.test('GET /variations returns an empty list for a movementId the caller doesn\'t own', async () => {
    const userA = await db.createTestUser();
    const userB = await db.createTestUser();
    const keyA = await mintApiKey(baseUrl, userA);
    const keyB = await mintApiKey(baseUrl, userB);
    const { movementId } = await createWorkoutMovement(keyA);

    const { status, body } = await req(baseUrl, 'GET', '/variations', {
      apiKey: keyB,
      query: { movementId: String(movementId) },
    });
    assert.equal(status, 200);
    assert.deepEqual(body.data, []);
  });

  await t.test('PATCH /variations/:id updates fields and rejects disallowed ones', async () => {
    const user = await db.createTestUser();
    const apiKey = await mintApiKey(baseUrl, user);
    const { movementId } = await createWorkoutMovement(apiKey);
    const { body: created } = await req(baseUrl, 'POST', '/variations', {
      apiKey,
      body: { label: 'Barbell', movementId },
    });
    const variationId = created.data.id;

    const bad = await req(baseUrl, 'PATCH', `/variations/${variationId}`, { apiKey, body: { notAField: 1 } });
    assert.equal(bad.status, 400);

    const ok = await req(baseUrl, 'PATCH', `/variations/${variationId}`, { apiKey, body: { weight: 100, reps: 5 } });
    assert.equal(ok.status, 200);

    const list = await req(baseUrl, 'GET', '/variations', { apiKey, query: { movementId: String(movementId) } });
    assert.equal(list.body.data[0].weight, 100);
    assert.equal(list.body.data[0].reps, 5);
  });

  await t.test('PATCH /variations/:id 404s for another user\'s variation, leaving it and its history unchanged', async () => {
    const owner = await db.createTestUser();
    const attacker = await db.createTestUser();
    const ownerKey = await mintApiKey(baseUrl, owner);
    const attackerKey = await mintApiKey(baseUrl, attacker);
    const { movementId } = await createWorkoutMovement(ownerKey);
    const { body: created } = await req(baseUrl, 'POST', '/variations', {
      apiKey: ownerKey,
      body: { label: 'Barbell', weight: 50, movementId },
    });
    const variationId = created.data.id;

    const patch = await req(baseUrl, 'PATCH', `/variations/${variationId}`, {
      apiKey: attackerKey,
      body: { weight: 999, reps: 99 },
    });
    assert.equal(patch.status, 404);
    await wait(75); // give the (gated-off) history insert a chance to run, if it were going to fire

    const list = await req(baseUrl, 'GET', '/variations', { apiKey: ownerKey, query: { movementId: String(movementId) } });
    assert.equal(list.body.data[0].weight, 50);
    assert.equal(list.body.data[0].reps, 0);

    const history = await req(baseUrl, 'GET', `/history/${variationId}`, { apiKey: ownerKey });
    assert.equal(history.status, 200);
    assert.deepEqual(history.body.data, []);
  });

  await t.test('PATCH /variations/:id with a weight logs a history point (weight-only, no dedupe)', async () => {
    const user = await db.createTestUser();
    const apiKey = await mintApiKey(baseUrl, user);
    const { movementId } = await createWorkoutMovement(apiKey);
    const { body: created } = await req(baseUrl, 'POST', '/variations', {
      apiKey,
      body: { label: 'Barbell', movementId },
    });
    const variationId = created.data.id;

    await req(baseUrl, 'PATCH', `/variations/${variationId}`, { apiKey, body: { weight: 100 } });
    await wait(75); // the history insert is fire-and-forget, not awaited by the route
    await req(baseUrl, 'PATCH', `/variations/${variationId}`, { apiKey, body: { weight: 100 } });
    await wait(75); // same weight logged twice on purpose -- no dedupe, unlike the main API

    const { status, body } = await req(baseUrl, 'GET', `/history/${variationId}`, { apiKey });
    assert.equal(status, 200);
    assert.equal(body.data.length, 2);
    // Weight-only shape: apiV1's history endpoint has never returned reps,
    // unlike the main API's equivalent -- preserved deliberately by the refactor.
    for (const point of body.data) {
      assert.deepEqual(Object.keys(point).sort(), ['date', 'weight']);
      assert.equal(point.weight, 100);
    }
  });

  await t.test('DELETE /variations/:id deletes a variation', async () => {
    const user = await db.createTestUser();
    const apiKey = await mintApiKey(baseUrl, user);
    const { movementId } = await createWorkoutMovement(apiKey);
    const { body: created } = await req(baseUrl, 'POST', '/variations', { apiKey, body: { label: 'B', movementId } });

    const del = await req(baseUrl, 'DELETE', `/variations/${created.data.id}`, { apiKey });
    assert.equal(del.status, 200);

    const list = await req(baseUrl, 'GET', '/variations', { apiKey, query: { movementId: String(movementId) } });
    assert.deepEqual(list.body.data, []);
  });

  await t.test('DELETE /variations/:id 404s for another user\'s variation, leaving it intact', async () => {
    const owner = await db.createTestUser();
    const attacker = await db.createTestUser();
    const ownerKey = await mintApiKey(baseUrl, owner);
    const attackerKey = await mintApiKey(baseUrl, attacker);
    const { movementId } = await createWorkoutMovement(ownerKey);
    const { body: created } = await req(baseUrl, 'POST', '/variations', { apiKey: ownerKey, body: { label: 'B', movementId } });

    const del = await req(baseUrl, 'DELETE', `/variations/${created.data.id}`, { apiKey: attackerKey });
    assert.equal(del.status, 404);

    const list = await req(baseUrl, 'GET', '/variations', { apiKey: ownerKey, query: { movementId: String(movementId) } });
    assert.equal(list.body.data.length, 1);
    assert.equal(list.body.data[0].id, created.data.id);
  });

  // ── History ──────────────────────────────────────────────────────────────

  await t.test('GET /history/:variationId returns an empty list when nothing has been logged', async () => {
    const user = await db.createTestUser();
    const apiKey = await mintApiKey(baseUrl, user);
    const { movementId } = await createWorkoutMovement(apiKey);
    const { body: created } = await req(baseUrl, 'POST', '/variations', { apiKey, body: { label: 'B', movementId } });

    const { status, body } = await req(baseUrl, 'GET', `/history/${created.data.id}`, { apiKey });
    assert.equal(status, 200);
    assert.deepEqual(body.data, []);
  });

  await t.test('GET /history/:variationId 404s for another user\'s variation', async () => {
    const owner = await db.createTestUser();
    const attacker = await db.createTestUser();
    const ownerKey = await mintApiKey(baseUrl, owner);
    const attackerKey = await mintApiKey(baseUrl, attacker);
    const { movementId } = await createWorkoutMovement(ownerKey);
    const { body: created } = await req(baseUrl, 'POST', '/variations', { apiKey: ownerKey, body: { label: 'B', movementId } });
    await req(baseUrl, 'PATCH', `/variations/${created.data.id}`, { apiKey: ownerKey, body: { weight: 100 } });
    await wait(75);

    const { status } = await req(baseUrl, 'GET', `/history/${created.data.id}`, { apiKey: attackerKey });
    assert.equal(status, 404);

    const ownerView = await req(baseUrl, 'GET', `/history/${created.data.id}`, { apiKey: ownerKey });
    assert.equal(ownerView.status, 200);
    assert.equal(ownerView.body.data.length, 1);
  });

  // ── Summary ──────────────────────────────────────────────────────────────

  await t.test('GET /summary returns the exact nested sections -> movements -> variations -> history shape', async () => {
    const user = await db.createTestUser();
    const apiKey = await mintApiKey(baseUrl, user);
    const { workoutId, movementId } = await createWorkoutMovement(apiKey);
    const { body: variation } = await req(baseUrl, 'POST', '/variations', {
      apiKey,
      body: { label: 'Barbell', movementId },
    });
    const variationId = variation.data.id;

    await req(baseUrl, 'PATCH', `/variations/${variationId}`, { apiKey, body: { weight: 100, reps: 5 } });
    await wait(75);
    await req(baseUrl, 'PATCH', `/variations/${variationId}`, { apiKey, body: { weight: 110, reps: 5 } });
    await wait(75);

    const { status, body } = await req(baseUrl, 'GET', '/summary', { apiKey });
    assert.equal(status, 200);
    assert.equal(body.data.length, 1);

    const section = body.data[0];
    assert.deepEqual(Object.keys(section).sort(), ['id', 'label', 'movements']);
    assert.equal(section.id, workoutId);
    assert.equal(section.label, 'W');
    assert.equal(section.movements.length, 1);

    const movement = section.movements[0];
    assert.deepEqual(Object.keys(movement).sort(), ['id', 'label', 'variations']);
    assert.equal(movement.id, movementId);
    assert.equal(movement.label, 'M');
    assert.equal(movement.variations.length, 1);

    const v = movement.variations[0];
    assert.deepEqual(
      Object.keys(v).sort(),
      ['currentReps', 'currentWeight', 'id', 'label', 'lastUpdated', 'recentHistory'].sort(),
    );
    assert.equal(v.id, variationId);
    assert.equal(v.label, 'Barbell');
    assert.equal(v.currentWeight, 110);
    assert.equal(v.currentReps, 5);
    assert.ok(v.lastUpdated);
    assert.equal(v.recentHistory.length, 2);
    // Newest first, weight-only points (no reps).
    assert.deepEqual(Object.keys(v.recentHistory[0]).sort(), ['date', 'weight']);
    assert.equal(v.recentHistory[0].weight, 110);
    assert.equal(v.recentHistory[1].weight, 100);
  });

  await t.test('GET /summary returns an empty array for a user with no workouts', async () => {
    const user = await db.createTestUser();
    const apiKey = await mintApiKey(baseUrl, user);
    const { status, body } = await req(baseUrl, 'GET', '/summary', { apiKey });
    assert.equal(status, 200);
    assert.deepEqual(body.data, []);
    assert.equal(body.message, 'No workouts found');
  });

  await t.test('GET /summary includes a workout with an empty movements array when it has none', async () => {
    const user = await db.createTestUser();
    const apiKey = await mintApiKey(baseUrl, user);
    await req(baseUrl, 'POST', '/workouts', { apiKey, body: { name: 'Empty' } });

    const { status, body } = await req(baseUrl, 'GET', '/summary', { apiKey });
    assert.equal(status, 200);
    assert.equal(body.data.length, 1);
    assert.deepEqual(body.data[0].movements, []);
  });

  await t.test('GET /summary only reflects the authenticated user\'s own data', async () => {
    const userA = await db.createTestUser();
    const userB = await db.createTestUser();
    const keyA = await mintApiKey(baseUrl, userA);
    const keyB = await mintApiKey(baseUrl, userB);
    await req(baseUrl, 'POST', '/workouts', { apiKey: keyA, body: { name: 'A' } });
    await req(baseUrl, 'POST', '/workouts', { apiKey: keyB, body: { name: 'B' } });

    const { body } = await req(baseUrl, 'GET', '/summary', { apiKey: keyA });
    assert.equal(body.data.length, 1);
    assert.equal(body.data[0].label, 'A');
  });

  // ── Habits ───────────────────────────────────────────────────────────────

  await t.test('GET /habits is empty until a tally exists, then lists distinct names', async () => {
    const user = await db.createTestUser();
    const apiKey = await mintApiKey(baseUrl, user);

    const empty = await req(baseUrl, 'GET', '/habits', { apiKey });
    assert.equal(empty.status, 200);
    assert.deepEqual(empty.body.data, []);

    await req(baseUrl, 'POST', '/habits/meditate/tally', { apiKey, body: {} });
    const after = await req(baseUrl, 'GET', '/habits', { apiKey });
    assert.deepEqual(after.body.data, ['meditate']);
  });

  await t.test('POST /habits/:habitName/tally creates then increments; GET lists the tally rows', async () => {
    const user = await db.createTestUser();
    const apiKey = await mintApiKey(baseUrl, user);

    const first = await req(baseUrl, 'POST', '/habits/water/tally', {
      apiKey,
      body: { localDate: '2024-01-01', localTime: '08:00' },
    });
    assert.equal(first.status, 201);
    assert.equal(first.body.data.count, 1);
    assert.equal(first.body.data.range_start, '08:00');
    assert.equal(first.body.data.range_end, '08:00');

    const second = await req(baseUrl, 'POST', '/habits/water/tally', {
      apiKey,
      body: { localDate: '2024-01-01', localTime: '14:30' },
    });
    assert.equal(second.status, 200);
    assert.equal(second.body.data.count, 2);
    // range_start here is read back from the TIME column (unlike the insert
    // path above, which echoes the raw request string), so it carries seconds.
    assert.equal(second.body.data.range_start, '08:00:00');
    assert.equal(second.body.data.range_end, '14:30');

    const list = await req(baseUrl, 'GET', '/habits/water', { apiKey });
    assert.equal(list.status, 200);
    assert.equal(list.body.data.length, 1);
    assert.equal(list.body.data[0].count, 2);
  });

  await t.test('GET /habits/:habitName rejects a blank name', async () => {
    const user = await db.createTestUser();
    const apiKey = await mintApiKey(baseUrl, user);
    const { status } = await req(baseUrl, 'GET', '/habits/%20', { apiKey });
    assert.equal(status, 400);
  });

  await t.test('habit tallies are isolated per user', async () => {
    const userA = await db.createTestUser();
    const userB = await db.createTestUser();
    const keyA = await mintApiKey(baseUrl, userA);
    const keyB = await mintApiKey(baseUrl, userB);

    await req(baseUrl, 'POST', '/habits/run/tally', { apiKey: keyA, body: {} });

    const listA = await req(baseUrl, 'GET', '/habits', { apiKey: keyA });
    const listB = await req(baseUrl, 'GET', '/habits', { apiKey: keyB });
    assert.deepEqual(listA.body.data, ['run']);
    assert.deepEqual(listB.body.data, []);
  });

  // ── Nutrition entry (autonomous agent) ──────────────────────────────────

  await t.test('POST /nutrition/entry -- skipped, needs a live OpenAI key', (t2) => {
    // This endpoint drives streamNutritionChat (services/nutrition/agent.ts ->
    // services/agent/streamChat) end to end with autoConfirm: true and no
    // mocking seam for the model. Exercising it here would require a real
    // OpenAI API key and network access, which this suite does not have.
    t2.skip('POST /nutrition/entry requires a live OpenAI key to exercise the agent; not run in this suite.');
  });
});
