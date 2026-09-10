// Characterization tests for routes/bodyWeight.ts, pinning its CURRENT
// behavior (including warts) so a later SQL-to-service-module refactor can be
// verified against these as a baseline. Exercises real HTTP requests through
// the actual router against a real MySQL schema (workout_log_test) rather
// than mocking pool.query, since a mock would only prove the SQL string was
// retyped identically -- not that behavior survived a refactor.
//
// Requires a reachable database (see scripts/testDb.js). If none is
// reachable, every test here is skipped (not failed) so `npm test` still
// passes for someone who hasn't started Docker.
//
// Run with: node --test tests/bodyWeight.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../scripts/testDb');

async function post(baseUrl, user, body) {
  const res = await fetch(`${baseUrl}/api/body-weight`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...user.authHeader() },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

async function get(baseUrl, user, query) {
  const qs = query ? `?${new URLSearchParams(query).toString()}` : '';
  const res = await fetch(`${baseUrl}/api/body-weight${qs}`, { headers: user.authHeader() });
  return { status: res.status, body: await res.json() };
}

async function del(baseUrl, user, id) {
  const res = await fetch(`${baseUrl}/api/body-weight/${id}`, {
    method: 'DELETE',
    headers: user.authHeader(),
  });
  return { status: res.status, body: await res.json() };
}

async function patch(baseUrl, user, id, body) {
  const res = await fetch(`${baseUrl}/api/body-weight/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...user.authHeader() },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

test('bodyWeight routes', async (t) => {
  const available = await db.isDbReachable();
  if (!available) {
    t.skip('No reachable database on 127.0.0.1:3307. Start it with: docker compose up -d, then npm run db:setup (see scripts/testDb.js).');
    return;
  }

  await db.setupTestDb();
  const bodyWeight = db.requireTs('routes/bodyWeight.ts').default;
  const { server, baseUrl } = await db.startTestServer('/api/body-weight', bodyWeight);

  t.beforeEach(async () => {
    await db.resetDb();
  });

  t.after(async () => {
    await db.stopTestServer(server);
    await db.closePool();
  });

  await t.test('rejects an unauthenticated request', async () => {
    const res = await fetch(`${baseUrl}/api/body-weight`);
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.message, 'Unauthorized: access token required');
  });

  await t.test('rejects a request with a garbage bearer token', async () => {
    const res = await fetch(`${baseUrl}/api/body-weight`, {
      headers: { Authorization: 'Bearer not-a-real-token' },
    });
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.message, 'Forbidden access token');
  });

  await t.test('GET / returns an empty list for a user with no entries', async () => {
    const user = await db.createTestUser();
    const { status, body } = await get(baseUrl, user);
    assert.equal(status, 200);
    assert.deepEqual(body.data, []);
    assert.equal(body.message, 'Successfully retrieved body weight entries');
  });

  await t.test('POST / creates an entry and responds with its id', async () => {
    const user = await db.createTestUser();
    const { status, body } = await post(baseUrl, user, { weight: 150.5, date: '2024-01-01' });
    assert.equal(status, 201);
    assert.equal(typeof body.data.id, 'number');
    assert.equal(body.message, 'Successfully logged body weight');
  });

  await t.test('POST / with no date defaults the date to now', async () => {
    const user = await db.createTestUser();
    const before = Date.now();
    const { status } = await post(baseUrl, user, { weight: 150 });
    const after = Date.now();
    assert.equal(status, 201);

    const { body: listBody } = await get(baseUrl, user);
    const storedDate = new Date(listBody.data[0].date).getTime();
    assert.ok(storedDate >= before - 1000 && storedDate <= after + 1000);
  });

  await t.test('POST / rejects a missing weight', async () => {
    const user = await db.createTestUser();
    const { status, body } = await post(baseUrl, user, { date: '2024-01-01' });
    assert.equal(status, 400);
    assert.equal(body.message, 'weight must be a positive number');
  });

  await t.test('POST / rejects a zero or negative weight', async () => {
    const user = await db.createTestUser();
    for (const weight of [0, -5]) {
      const { status, body } = await post(baseUrl, user, { weight });
      assert.equal(status, 400);
      assert.equal(body.message, 'weight must be a positive number');
    }
  });

  await t.test('POST / rejects a weight sent as a numeric string', async () => {
    // typeof weight !== 'number' rejects "150" even though it parses cleanly.
    const user = await db.createTestUser();
    const { status, body } = await post(baseUrl, user, { weight: '150' });
    assert.equal(status, 400);
    assert.equal(body.message, 'weight must be a positive number');
  });

  await t.test('POST / with an unparseable date string 500s instead of 400ing (current wart)', async () => {
    // parseISO('not-a-date') yields an Invalid Date; mysql2 sends that as NULL,
    // and the `date` column is NOT NULL, so the insert throws and falls through
    // to handleSqlError's generic 500. There is no date-format validation here.
    const user = await db.createTestUser();
    const { status, body } = await post(baseUrl, user, { weight: 150, date: 'not-a-date' });
    assert.equal(status, 500);
    assert.equal(body.message, 'Internal Server Error');
  });

  await t.test('GET / orders entries by date ascending regardless of insertion order', async () => {
    const user = await db.createTestUser();
    await post(baseUrl, user, { weight: 100, date: '2024-03-01' });
    await post(baseUrl, user, { weight: 110, date: '2024-01-01' });
    await post(baseUrl, user, { weight: 120, date: '2024-02-01' });

    const { status, body } = await get(baseUrl, user);
    assert.equal(status, 200);
    const dates = body.data.map((row) => row.date);
    const sorted = [...dates].sort();
    assert.deepEqual(dates, sorted);
    assert.deepEqual(body.data.map((row) => row.weight), [110, 120, 100]);
  });

  await t.test('GET / only returns the authenticated user\'s own entries', async () => {
    const userA = await db.createTestUser();
    const userB = await db.createTestUser();
    await post(baseUrl, userA, { weight: 100, date: '2024-01-01' });
    await post(baseUrl, userB, { weight: 200, date: '2024-01-02' });
    await post(baseUrl, userB, { weight: 210, date: '2024-01-03' });

    const { body: bodyA } = await get(baseUrl, userA);
    const { body: bodyB } = await get(baseUrl, userB);
    assert.equal(bodyA.data.length, 1);
    assert.equal(bodyA.data[0].weight, 100);
    assert.equal(bodyB.data.length, 2);
  });

  await t.test('DELETE /:id removes an entry the user owns', async () => {
    const user = await db.createTestUser();
    const { body: created } = await post(baseUrl, user, { weight: 100, date: '2024-01-01' });
    const id = created.data.id;

    const { status, body } = await del(baseUrl, user, id);
    assert.equal(status, 200);
    assert.equal(body.message, `Successfully deleted body weight entry with id ${id}`);

    const { body: listBody } = await get(baseUrl, user);
    assert.deepEqual(listBody.data, []);
  });

  await t.test('DELETE /:id 404s for a non-existent id', async () => {
    const user = await db.createTestUser();
    const { status, body } = await del(baseUrl, user, 999999);
    assert.equal(status, 404);
    assert.equal(body.message, 'No body weight entry with id 999999 found for this user');
  });

  await t.test('DELETE /:id 404s when the id belongs to another user', async () => {
    const userA = await db.createTestUser();
    const userB = await db.createTestUser();
    const { body: created } = await post(baseUrl, userB, { weight: 200, date: '2024-01-01' });
    const id = created.data.id;

    const { status, body } = await del(baseUrl, userA, id);
    assert.equal(status, 404);
    assert.equal(body.message, `No body weight entry with id ${id} found for this user`);

    // confirm it wasn't actually deleted out from under userB
    const { body: listBody } = await get(baseUrl, userB);
    assert.equal(listBody.data.length, 1);
  });

  await t.test('DELETE /:id rejects a non-integer id before touching the database', async () => {
    const user = await db.createTestUser();
    const { status, body } = await del(baseUrl, user, 'abc');
    assert.equal(status, 400);
    assert.equal(body.message, 'Request parameter id must be a positive integer');
  });

  await t.test('DELETE /:id rejects id 0 (positive-integer check excludes zero)', async () => {
    const user = await db.createTestUser();
    const { status, body } = await del(baseUrl, user, 0);
    assert.equal(status, 400);
    assert.equal(body.message, 'Request parameter id must be a positive integer');
  });

  await t.test('GET / with both from and to returns only entries within the inclusive range', async () => {
    const user = await db.createTestUser();
    await post(baseUrl, user, { weight: 100, date: '2024-01-01' });
    await post(baseUrl, user, { weight: 110, date: '2024-01-05' });
    await post(baseUrl, user, { weight: 120, date: '2024-01-10' });

    const { status, body } = await get(baseUrl, user, { from: '2024-01-02', to: '2024-01-08' });
    assert.equal(status, 200);
    assert.deepEqual(body.data.map((row) => row.weight), [110]);
  });

  await t.test('GET / from/to boundaries are inclusive', async () => {
    const user = await db.createTestUser();
    await post(baseUrl, user, { weight: 100, date: '2024-01-01' });
    await post(baseUrl, user, { weight: 110, date: '2024-01-05' });
    await post(baseUrl, user, { weight: 120, date: '2024-01-10' });

    const { status, body } = await get(baseUrl, user, { from: '2024-01-01', to: '2024-01-10' });
    assert.equal(status, 200);
    assert.deepEqual(body.data.map((row) => row.weight), [100, 110, 120]);
  });

  await t.test('GET / with only from returns entries on or after that date', async () => {
    const user = await db.createTestUser();
    await post(baseUrl, user, { weight: 100, date: '2024-01-01' });
    await post(baseUrl, user, { weight: 110, date: '2024-01-05' });

    const { status, body } = await get(baseUrl, user, { from: '2024-01-05' });
    assert.equal(status, 200);
    assert.deepEqual(body.data.map((row) => row.weight), [110]);
  });

  await t.test('GET / with only to returns entries on or before that date', async () => {
    const user = await db.createTestUser();
    await post(baseUrl, user, { weight: 100, date: '2024-01-01' });
    await post(baseUrl, user, { weight: 110, date: '2024-01-05' });

    const { status, body } = await get(baseUrl, user, { to: '2024-01-01' });
    assert.equal(status, 200);
    assert.deepEqual(body.data.map((row) => row.weight), [100]);
  });

  await t.test('GET / with a bare-date to includes an entry logged later that same day', async () => {
    // date is DATETIME; to=2024-01-05 (no time) must mean "through the end of
    // Jan 5", not midnight at its start, or a same-day weigh-in would be lost.
    const user = await db.createTestUser();
    await post(baseUrl, user, { weight: 100, date: '2024-01-01' });
    await post(baseUrl, user, { weight: 110, date: '2024-01-05T18:30:00Z' });

    const { status, body } = await get(baseUrl, user, { to: '2024-01-05' });
    assert.equal(status, 200);
    assert.deepEqual(body.data.map((row) => row.weight), [100, 110]);
  });

  await t.test('GET / with a full ISO datetime to excludes a later entry that same day', async () => {
    const user = await db.createTestUser();
    await post(baseUrl, user, { weight: 100, date: '2024-01-01' });
    await post(baseUrl, user, { weight: 110, date: '2024-01-05T18:30:00Z' });

    const { status, body } = await get(baseUrl, user, { to: '2024-01-05T10:00:00Z' });
    assert.equal(status, 200);
    assert.deepEqual(body.data.map((row) => row.weight), [100]);
  });

  await t.test('GET / with a range excluding all entries returns an empty list', async () => {
    const user = await db.createTestUser();
    await post(baseUrl, user, { weight: 100, date: '2024-01-01' });

    const { status, body } = await get(baseUrl, user, { from: '2024-02-01', to: '2024-03-01' });
    assert.equal(status, 200);
    assert.deepEqual(body.data, []);
  });

  await t.test('there is no PUT endpoint; only PATCH updates an entry', async () => {
    const user = await db.createTestUser();
    const res = await fetch(`${baseUrl}/api/body-weight/1`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...user.authHeader() },
      body: JSON.stringify({ weight: 100 }),
    });
    // No PUT handler is registered for this router, so Express falls through
    // with its default 404 rather than the route's own JSON 404s.
    assert.equal(res.status, 404);
  });

  // ── PATCH /:id ────────────────────────────────────────────────────────────

  await t.test('PATCH /:id updates weight and date together', async () => {
    const user = await db.createTestUser();
    const { body: created } = await post(baseUrl, user, { weight: 150, date: '2024-01-01' });
    const id = created.data.id;

    const { status, body } = await patch(baseUrl, user, id, { weight: 160, date: '2024-02-01' });
    assert.equal(status, 200);
    assert.equal(body.message, `Successfully updated body weight entry with id ${id}`);

    const { body: listBody } = await get(baseUrl, user);
    assert.equal(listBody.data[0].weight, 160);
    assert.equal(new Date(listBody.data[0].date).toISOString().slice(0, 10), '2024-02-01');
  });

  await t.test('PATCH /:id with only weight leaves the stored date unchanged', async () => {
    const user = await db.createTestUser();
    const { body: created } = await post(baseUrl, user, { weight: 150, date: '2024-01-01' });
    const id = created.data.id;

    const { status } = await patch(baseUrl, user, id, { weight: 175 });
    assert.equal(status, 200);

    const { body: listBody } = await get(baseUrl, user);
    assert.equal(listBody.data[0].weight, 175);
    assert.equal(new Date(listBody.data[0].date).toISOString().slice(0, 10), '2024-01-01');
  });

  await t.test('PATCH /:id with only date leaves the stored weight unchanged', async () => {
    const user = await db.createTestUser();
    const { body: created } = await post(baseUrl, user, { weight: 150, date: '2024-01-01' });
    const id = created.data.id;

    const { status } = await patch(baseUrl, user, id, { date: '2024-03-01' });
    assert.equal(status, 200);

    const { body: listBody } = await get(baseUrl, user);
    assert.equal(listBody.data[0].weight, 150);
    assert.equal(new Date(listBody.data[0].date).toISOString().slice(0, 10), '2024-03-01');
  });

  await t.test('PATCH /:id rejects a body with neither weight nor date', async () => {
    const user = await db.createTestUser();
    const { body: created } = await post(baseUrl, user, { weight: 150, date: '2024-01-01' });

    const { status, body } = await patch(baseUrl, user, created.data.id, {});
    assert.equal(status, 400);
    assert.equal(body.message, 'Request body must include weight and/or date');
  });

  await t.test('PATCH /:id rejects a zero or negative weight', async () => {
    const user = await db.createTestUser();
    const { body: created } = await post(baseUrl, user, { weight: 150, date: '2024-01-01' });
    for (const weight of [0, -5]) {
      const { status, body } = await patch(baseUrl, user, created.data.id, { weight });
      assert.equal(status, 400);
      assert.equal(body.message, 'weight must be a positive number');
    }
  });

  await t.test('PATCH /:id rejects a weight sent as a numeric string', async () => {
    const user = await db.createTestUser();
    const { body: created } = await post(baseUrl, user, { weight: 150, date: '2024-01-01' });

    const { status, body } = await patch(baseUrl, user, created.data.id, { weight: '160' });
    assert.equal(status, 400);
    assert.equal(body.message, 'weight must be a positive number');
  });

  await t.test('PATCH /:id returns 400, not 500, for a malformed date', async () => {
    // Unlike POST /, which lets an Invalid Date reach the NOT NULL `date`
    // column and 500s, PATCH validates the date string before writing.
    const user = await db.createTestUser();
    const { body: created } = await post(baseUrl, user, { weight: 150, date: '2024-01-01' });

    const { status, body } = await patch(baseUrl, user, created.data.id, { date: 'not-a-date' });
    assert.equal(status, 400);
    assert.equal(body.message, 'date must be a valid ISO 8601 date string');
  });

  await t.test('PATCH /:id 404s for a non-existent id', async () => {
    const user = await db.createTestUser();
    const { status, body } = await patch(baseUrl, user, 999999, { weight: 160 });
    assert.equal(status, 404);
    assert.equal(body.message, 'No body weight entry with id 999999 found for this user');
  });

  await t.test('PATCH /:id 404s when the id belongs to another user, indistinguishably from a non-existent id', async () => {
    const userA = await db.createTestUser();
    const userB = await db.createTestUser();
    const { body: created } = await post(baseUrl, userB, { weight: 200, date: '2024-01-01' });
    const id = created.data.id;

    const { status, body } = await patch(baseUrl, userA, id, { weight: 999 });
    assert.equal(status, 404);
    assert.equal(body.message, `No body weight entry with id ${id} found for this user`);

    // confirm it wasn't actually modified out from under userB
    const { body: listBody } = await get(baseUrl, userB);
    assert.equal(listBody.data[0].weight, 200);
  });

  await t.test('PATCH /:id rejects a non-integer id before touching the database', async () => {
    const user = await db.createTestUser();
    const { status, body } = await patch(baseUrl, user, 'abc', { weight: 160 });
    assert.equal(status, 400);
    assert.equal(body.message, 'Request parameter id must be a positive integer');
  });
});
