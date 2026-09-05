// Characterization tests for routes/habits.ts, pinning its CURRENT behavior
// (including warts) so a later SQL-to-service-module refactor can be
// verified against these as a baseline. Exercises real HTTP requests through
// the actual router against a real MySQL schema (workout_log_test) rather
// than mocking pool.query, since a mock would only prove the SQL string was
// retyped identically -- not that behavior survived a refactor.
//
// habit_tallies joins to habits by name, not by id, and the tally endpoints
// (GET/POST/PATCH under /:habitName) never check the habits registry at all.
// Several tests below exist specifically to pin that decoupling and what it
// does to renames and deletes.
//
// Requires a reachable database (see scripts/testDb.js). If none is
// reachable, every test here is skipped (not failed) so `npm test` still
// passes for someone who hasn't started Docker.
//
// Run with: node --test tests/habits.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../scripts/testDb');

async function listHabits(baseUrl, user) {
  const res = await fetch(`${baseUrl}/api/habits`, { headers: user.authHeader() });
  return { status: res.status, body: await res.json() };
}

async function createHabit(baseUrl, user, body) {
  const res = await fetch(`${baseUrl}/api/habits`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...user.authHeader() },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

async function patchHabit(baseUrl, user, id, body) {
  const res = await fetch(`${baseUrl}/api/habits/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...user.authHeader() },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

async function deleteHabit(baseUrl, user, id) {
  const res = await fetch(`${baseUrl}/api/habits/${id}`, {
    method: 'DELETE',
    headers: user.authHeader(),
  });
  return { status: res.status, body: await res.json() };
}

async function getTallies(baseUrl, user, habitName) {
  const res = await fetch(`${baseUrl}/api/habits/${encodeURIComponent(habitName)}`, {
    headers: user.authHeader(),
  });
  return { status: res.status, body: await res.json() };
}

async function postTally(baseUrl, user, habitName, body = {}) {
  const res = await fetch(`${baseUrl}/api/habits/${encodeURIComponent(habitName)}/tally`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...user.authHeader() },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

async function patchTally(baseUrl, user, habitName, date, body) {
  const res = await fetch(`${baseUrl}/api/habits/${encodeURIComponent(habitName)}/${date}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...user.authHeader() },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

// GET /:habitName's `date` field comes straight off a DATE column with no
// dateStrings option set, so mysql2 hands back a JS Date (local midnight)
// and res.json() serializes it as a full UTC ISO timestamp. Reconstructing
// the calendar date via local getters undoes that round trip regardless of
// which way the local UTC offset points.
function dateOnly(value) {
  const d = new Date(value);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

test('habits routes', async (t) => {
  const available = await db.isDbReachable();
  if (!available) {
    t.skip('No reachable database on 127.0.0.1:3307. Start it with: docker compose up -d, then npm run db:setup (see scripts/testDb.js).');
    return;
  }

  await db.setupTestDb();
  const habits = db.requireTs('routes/habits.ts').default;
  const { server, baseUrl } = await db.startTestServer('/api/habits', habits);

  t.beforeEach(async () => {
    await db.resetDb();
  });

  t.after(async () => {
    await db.stopTestServer(server);
    await db.closePool();
  });

  // ── Auth ──────────────────────────────────────────────────────────────────

  await t.test('rejects an unauthenticated request', async () => {
    const res = await fetch(`${baseUrl}/api/habits`);
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.message, 'Unauthorized: access token required');
  });

  await t.test('rejects a request with a garbage bearer token', async () => {
    const res = await fetch(`${baseUrl}/api/habits`, {
      headers: { Authorization: 'Bearer not-a-real-token' },
    });
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.message, 'Forbidden access token');
  });

  // ── GET / ─────────────────────────────────────────────────────────────────

  await t.test('GET / returns an empty list for a user with no habits', async () => {
    const user = await db.createTestUser();
    const { status, body } = await listHabits(baseUrl, user);
    assert.equal(status, 200);
    assert.deepEqual(body.data, []);
    assert.equal(body.message, 'Successfully retrieved habits');
  });

  await t.test('GET / orders habits by ordering ascending, matching creation order', async () => {
    const user = await db.createTestUser();
    await createHabit(baseUrl, user, { name: 'reading' });
    await createHabit(baseUrl, user, { name: 'flossing' });
    await createHabit(baseUrl, user, { name: 'meditation' });

    const { body } = await listHabits(baseUrl, user);
    assert.deepEqual(body.data.map((h) => h.name), ['reading', 'flossing', 'meditation']);
    assert.deepEqual(body.data.map((h) => h.ordering), [0, 1, 2]);
  });

  await t.test('GET / only returns the authenticated user\'s own habits', async () => {
    const userA = await db.createTestUser();
    const userB = await db.createTestUser();
    await createHabit(baseUrl, userA, { name: 'reading' });
    await createHabit(baseUrl, userB, { name: 'flossing' });
    await createHabit(baseUrl, userB, { name: 'meditation' });

    const { body: bodyA } = await listHabits(baseUrl, userA);
    const { body: bodyB } = await listHabits(baseUrl, userB);
    assert.equal(bodyA.data.length, 1);
    assert.equal(bodyA.data[0].name, 'reading');
    assert.equal(bodyB.data.length, 2);
  });

  // ── POST / ────────────────────────────────────────────────────────────────

  await t.test('POST / creates a habit with ordering 0 and default ignore_empty_days', async () => {
    const user = await db.createTestUser();
    const { status, body } = await createHabit(baseUrl, user, { name: 'reading' });
    assert.equal(status, 201);
    assert.equal(body.data.name, 'reading');
    assert.equal(body.data.ordering, 0);
    assert.equal(typeof body.data.id, 'number');
    assert.equal(body.message, 'Habit "reading" created');

    const { body: listBody } = await listHabits(baseUrl, user);
    assert.equal(listBody.data[0].ignore_empty_days, 1);
  });

  await t.test('POST / trims whitespace and caps the name at 100 characters', async () => {
    const user = await db.createTestUser();
    const longName = 'x'.repeat(150);
    const { status, body } = await createHabit(baseUrl, user, { name: `  ${longName}  ` });
    assert.equal(status, 201);
    assert.equal(body.data.name, longName.slice(0, 100));
    assert.equal(body.data.name.length, 100);
  });

  await t.test('POST / rejects a missing name', async () => {
    const user = await db.createTestUser();
    const { status, body } = await createHabit(baseUrl, user, {});
    assert.equal(status, 400);
    assert.equal(body.message, 'name is required');
  });

  await t.test('POST / rejects a whitespace-only name', async () => {
    const user = await db.createTestUser();
    const { status, body } = await createHabit(baseUrl, user, { name: '   ' });
    assert.equal(status, 400);
    assert.equal(body.message, 'name is required');
  });

  await t.test('POST / rejects a duplicate name for the same user with 409', async () => {
    const user = await db.createTestUser();
    await createHabit(baseUrl, user, { name: 'reading' });
    const { status, body } = await createHabit(baseUrl, user, { name: 'reading' });
    assert.equal(status, 409);
    assert.equal(body.message, 'Habit "reading" already exists');
  });

  await t.test('POST / allows two different users to each have a habit with the same name', async () => {
    const userA = await db.createTestUser();
    const userB = await db.createTestUser();
    const { status: statusA } = await createHabit(baseUrl, userA, { name: 'reading' });
    const { status: statusB } = await createHabit(baseUrl, userB, { name: 'reading' });
    assert.equal(statusA, 201);
    assert.equal(statusB, 201);
  });

  await t.test('POST / assigns the next ordering after the current max, not the count', async () => {
    // If a middle habit is deleted, the next created habit continues from
    // MAX(ordering)+1 rather than backfilling the gap or using COUNT(*).
    const user = await db.createTestUser();
    const { body: h1 } = await createHabit(baseUrl, user, { name: 'a' });
    await createHabit(baseUrl, user, { name: 'b' });
    await deleteHabit(baseUrl, user, h1.data.id);

    const { body: h3 } = await createHabit(baseUrl, user, { name: 'c' });
    assert.equal(h3.data.ordering, 2);
  });

  // ── PATCH /:id ────────────────────────────────────────────────────────────

  await t.test('PATCH /:id rejects a non-numeric id', async () => {
    const user = await db.createTestUser();
    const { status, body } = await patchHabit(baseUrl, user, 'abc', { name: 'new' });
    assert.equal(status, 400);
    assert.equal(body.message, 'Invalid habit id');
  });

  await t.test('PATCH /:id (wart) parseInt allows a numeric-prefixed id like "12abc"', async () => {
    // parseInt('12abc', 10) === 12, not NaN, so the isNaN guard lets this through.
    const user = await db.createTestUser();
    const { body: created } = await createHabit(baseUrl, user, { name: 'reading' });
    const { status } = await patchHabit(baseUrl, user, `${created.data.id}abc`, { name: 'books' });
    assert.equal(status, 200);
  });

  await t.test('PATCH /:id renames a habit and cascades the rename to its tallies', async () => {
    const user = await db.createTestUser();
    const { body: created } = await createHabit(baseUrl, user, { name: 'reading' });
    await postTally(baseUrl, user, 'reading', { localDate: '2024-01-01', localTime: '09:00' });

    const { status, body } = await patchHabit(baseUrl, user, created.data.id, { name: 'books' });
    assert.equal(status, 200);
    assert.deepEqual(body.data, { id: created.data.id, name: 'books' });
    assert.equal(body.message, 'Habit renamed to "books"');

    const { body: oldTallies } = await getTallies(baseUrl, user, 'reading');
    const { body: newTallies } = await getTallies(baseUrl, user, 'books');
    assert.deepEqual(oldTallies.data, []);
    assert.equal(newTallies.data.length, 1);
    assert.equal(newTallies.data[0].habit_name, 'books');
  });

  await t.test('PATCH /:id rejects a missing name when not toggling ignore_empty_days', async () => {
    const user = await db.createTestUser();
    const { body: created } = await createHabit(baseUrl, user, { name: 'reading' });
    const { status, body } = await patchHabit(baseUrl, user, created.data.id, {});
    assert.equal(status, 400);
    assert.equal(body.message, 'name is required');
  });

  await t.test('PATCH /:id 404s renaming a non-existent habit', async () => {
    const user = await db.createTestUser();
    const { status, body } = await patchHabit(baseUrl, user, 999999, { name: 'books' });
    assert.equal(status, 404);
    assert.equal(body.message, 'Habit not found');
  });

  await t.test('PATCH /:id 404s renaming another user\'s habit and leaves it untouched', async () => {
    const userA = await db.createTestUser();
    const userB = await db.createTestUser();
    const { body: created } = await createHabit(baseUrl, userB, { name: 'reading' });

    const { status, body } = await patchHabit(baseUrl, userA, created.data.id, { name: 'hijacked' });
    assert.equal(status, 404);
    assert.equal(body.message, 'Habit not found');

    const { body: listBody } = await listHabits(baseUrl, userB);
    assert.equal(listBody.data[0].name, 'reading');
  });

  await t.test('PATCH /:id renaming to a name already used by the same user returns 409', async () => {
    const user = await db.createTestUser();
    await createHabit(baseUrl, user, { name: 'reading' });
    const { body: created2 } = await createHabit(baseUrl, user, { name: 'flossing' });

    const { status, body } = await patchHabit(baseUrl, user, created2.data.id, { name: 'reading' });
    assert.equal(status, 409);
    assert.equal(body.message, 'Habit "reading" already exists');
  });

  await t.test('PATCH /:id toggles ignore_empty_days and ignores a name sent alongside it', async () => {
    // When ignore_empty_days is present the route takes that branch entirely
    // and never looks at `name`, even if both fields are sent in the same body.
    const user = await db.createTestUser();
    const { body: created } = await createHabit(baseUrl, user, { name: 'reading' });

    const { status, body } = await patchHabit(baseUrl, user, created.data.id, {
      ignore_empty_days: false,
      name: 'should-be-ignored',
    });
    assert.equal(status, 200);
    assert.deepEqual(body, { message: 'Updated' });

    const { body: listBody } = await listHabits(baseUrl, user);
    assert.equal(listBody.data[0].name, 'reading');
    assert.equal(listBody.data[0].ignore_empty_days, 0);
  });

  await t.test('PATCH /:id rejects a non-boolean ignore_empty_days', async () => {
    const user = await db.createTestUser();
    const { body: created } = await createHabit(baseUrl, user, { name: 'reading' });
    const { status, body } = await patchHabit(baseUrl, user, created.data.id, { ignore_empty_days: 'yes' });
    assert.equal(status, 400);
    assert.equal(body.message, 'ignore_empty_days must be a boolean');
  });

  await t.test('PATCH /:id 404s toggling ignore_empty_days on a non-existent habit', async () => {
    const user = await db.createTestUser();
    const { status, body } = await patchHabit(baseUrl, user, 999999, { ignore_empty_days: true });
    assert.equal(status, 404);
    assert.equal(body.message, 'Habit 999999 not found');
  });

  await t.test('PATCH /:id 404s toggling ignore_empty_days on another user\'s habit', async () => {
    const userA = await db.createTestUser();
    const userB = await db.createTestUser();
    const { body: created } = await createHabit(baseUrl, userB, { name: 'reading' });

    const { status } = await patchHabit(baseUrl, userA, created.data.id, { ignore_empty_days: false });
    assert.equal(status, 404);

    const { body: listBody } = await listHabits(baseUrl, userB);
    assert.equal(listBody.data[0].ignore_empty_days, 1);
  });

  // ── DELETE /:id ───────────────────────────────────────────────────────────

  await t.test('DELETE /:id removes the habit and its tallies', async () => {
    const user = await db.createTestUser();
    const { body: created } = await createHabit(baseUrl, user, { name: 'reading' });
    await postTally(baseUrl, user, 'reading', { localDate: '2024-01-01', localTime: '09:00' });

    const { status, body } = await deleteHabit(baseUrl, user, created.data.id);
    assert.equal(status, 200);
    assert.equal(body.message, 'Habit "reading" and its tallies deleted');

    const { body: listBody } = await listHabits(baseUrl, user);
    assert.deepEqual(listBody.data, []);

    // (wart) GET tallies never checks the registry, so this 200s with an
    // empty array rather than 404ing for a habit that no longer exists.
    const { status: tallyStatus, body: tallyBody } = await getTallies(baseUrl, user, 'reading');
    assert.equal(tallyStatus, 200);
    assert.deepEqual(tallyBody.data, []);
  });

  await t.test('DELETE /:id rejects a non-numeric id', async () => {
    const user = await db.createTestUser();
    const { status, body } = await deleteHabit(baseUrl, user, 'abc');
    assert.equal(status, 400);
    assert.equal(body.message, 'Invalid habit id');
  });

  await t.test('DELETE /:id 404s a non-existent habit', async () => {
    const user = await db.createTestUser();
    const { status, body } = await deleteHabit(baseUrl, user, 999999);
    assert.equal(status, 404);
    assert.equal(body.message, 'Habit not found');
  });

  await t.test('DELETE /:id 404s another user\'s habit and leaves it and its tallies intact', async () => {
    const userA = await db.createTestUser();
    const userB = await db.createTestUser();
    const { body: created } = await createHabit(baseUrl, userB, { name: 'reading' });
    await postTally(baseUrl, userB, 'reading', { localDate: '2024-01-01', localTime: '09:00' });

    const { status, body } = await deleteHabit(baseUrl, userA, created.data.id);
    assert.equal(status, 404);
    assert.equal(body.message, 'Habit not found');

    const { body: listBody } = await listHabits(baseUrl, userB);
    assert.equal(listBody.data.length, 1);
    const { body: tallyBody } = await getTallies(baseUrl, userB, 'reading');
    assert.equal(tallyBody.data.length, 1);
  });

  // ── GET /:habitName (tallies) ────────────────────────────────────────────

  await t.test('GET /:habitName returns tallies sorted by date descending', async () => {
    const user = await db.createTestUser();
    await createHabit(baseUrl, user, { name: 'reading' });
    await postTally(baseUrl, user, 'reading', { localDate: '2024-01-01', localTime: '09:00' });
    await postTally(baseUrl, user, 'reading', { localDate: '2024-03-01', localTime: '09:00' });
    await postTally(baseUrl, user, 'reading', { localDate: '2024-02-01', localTime: '09:00' });

    const { status, body } = await getTallies(baseUrl, user, 'reading');
    assert.equal(status, 200);
    assert.deepEqual(body.data.map((r) => dateOnly(r.date)), ['2024-03-01', '2024-02-01', '2024-01-01']);
    assert.equal(body.message, 'Successfully retrieved habit tallies for reading');
  });

  await t.test('GET /:habitName (wart) serializes date as a full UTC timestamp, not a plain YYYY-MM-DD string', async () => {
    // No dateStrings option is set, so the DATE column comes back as a JS
    // Date (local midnight) that JSON serializes with a time-of-day and a
    // "Z" suffix, e.g. "2024-01-01T05:00:00.000Z" rather than "2024-01-01".
    const user = await db.createTestUser();
    await postTally(baseUrl, user, 'reading', { localDate: '2024-01-01', localTime: '09:00' });
    const { body } = await getTallies(baseUrl, user, 'reading');
    assert.match(body.data[0].date, /^2024-01-01T\d{2}:00:00\.000Z$/);
    assert.notEqual(body.data[0].date, '2024-01-01');
  });

  await t.test('GET /:habitName (wart) 200s with an empty list for a habit name never registered', async () => {
    // The tally endpoints never check the habits registry, so any name works.
    const user = await db.createTestUser();
    const { status, body } = await getTallies(baseUrl, user, 'never-created');
    assert.equal(status, 200);
    assert.deepEqual(body.data, []);
  });

  await t.test('GET /:habitName only returns the authenticated user\'s own tallies', async () => {
    const userA = await db.createTestUser();
    const userB = await db.createTestUser();
    await postTally(baseUrl, userA, 'reading', { localDate: '2024-01-01', localTime: '09:00' });
    await postTally(baseUrl, userB, 'reading', { localDate: '2024-01-02', localTime: '09:00' });

    const { body: bodyA } = await getTallies(baseUrl, userA, 'reading');
    assert.equal(bodyA.data.length, 1);
    assert.equal(dateOnly(bodyA.data[0].date), '2024-01-01');
  });

  // ── POST /:habitName/tally ────────────────────────────────────────────────

  await t.test('POST /:habitName/tally (wart) creates a tally row even if no habit with that name exists', async () => {
    const user = await db.createTestUser();
    const { status, body } = await postTally(baseUrl, user, 'ghost-habit', {
      localDate: '2024-01-01',
      localTime: '09:00',
    });
    assert.equal(status, 201);
    assert.equal(body.data.count, 1);
    // (wart) the freshly-inserted response echoes the raw client HH:mm
    // string back verbatim, not a DB round trip -- so no seconds component,
    // unlike what a subsequent GET of the same row would return.
    assert.equal(body.data.range_start, '09:00');
    assert.equal(body.data.range_end, '09:00');
    assert.equal(body.message, 'Tally added for ghost-habit on 2024-01-01');

    // habits registry is untouched -- the tally exists with no matching habit row.
    const { body: listBody } = await listHabits(baseUrl, user);
    assert.deepEqual(listBody.data, []);
  });

  await t.test('POST /:habitName/tally increments count and pushes range_end, keeping range_start', async () => {
    const user = await db.createTestUser();
    await postTally(baseUrl, user, 'reading', { localDate: '2024-01-01', localTime: '09:00' });
    const { status, body } = await postTally(baseUrl, user, 'reading', {
      localDate: '2024-01-01',
      localTime: '10:30',
    });
    assert.equal(status, 200);
    assert.equal(body.data.count, 2);
    // (wart) range_start is read back from the DB (so it has seconds), but
    // range_end is the raw client HH:mm string being written, not re-read --
    // the two fields in the same response come from different sources.
    assert.equal(body.data.range_start, '09:00:00');
    assert.equal(body.data.range_end, '10:30');
    assert.equal(body.message, 'Tally incremented for reading on 2024-01-01');
  });

  await t.test('POST /:habitName/tally falls back to the current UTC date/time when omitted', async () => {
    const user = await db.createTestUser();
    const before = Date.now();
    const { status, body } = await postTally(baseUrl, user, 'reading', {});
    const after = Date.now();
    assert.equal(status, 201);

    const expectedDate = new Date(before).toISOString().slice(0, 10);
    const alsoAcceptableDate = new Date(after).toISOString().slice(0, 10);
    assert.ok(body.data.date === expectedDate || body.data.date === alsoAcceptableDate);
  });

  await t.test('POST /:habitName/tally (wart) ignores a malformed localTime/localDate and falls back silently', async () => {
    // No 400 is returned for a bad localTime/localDate -- the regex checks
    // just fail open to the current-UTC fallback instead of validating input.
    const user = await db.createTestUser();
    const { status, body } = await postTally(baseUrl, user, 'reading', {
      localTime: 'not-a-time',
      localDate: 'not-a-date',
    });
    assert.equal(status, 201);
    assert.match(body.data.date, /^\d{4}-\d{2}-\d{2}$/);
  });

  await t.test('POST /:habitName/tally isolates counts per user for the same habit name and date', async () => {
    const userA = await db.createTestUser();
    const userB = await db.createTestUser();
    await postTally(baseUrl, userA, 'reading', { localDate: '2024-01-01', localTime: '09:00' });
    await postTally(baseUrl, userB, 'reading', { localDate: '2024-01-01', localTime: '09:00' });
    await postTally(baseUrl, userB, 'reading', { localDate: '2024-01-01', localTime: '10:00' });

    const { body: tallyA } = await getTallies(baseUrl, userA, 'reading');
    const { body: tallyB } = await getTallies(baseUrl, userB, 'reading');
    assert.equal(tallyA.data[0].count, 1);
    assert.equal(tallyB.data[0].count, 2);
  });

  // ── PATCH /:habitName/:date ───────────────────────────────────────────────

  await t.test('PATCH /:habitName/:date rejects a malformed date', async () => {
    const user = await db.createTestUser();
    const { status, body } = await patchTally(baseUrl, user, 'reading', '01-01-2024', { count: 5 });
    assert.equal(status, 400);
    assert.equal(body.message, 'date must be in YYYY-MM-DD format');
  });

  await t.test('PATCH /:habitName/:date rejects a non-integer or negative count', async () => {
    const user = await db.createTestUser();
    await postTally(baseUrl, user, 'reading', { localDate: '2024-01-01', localTime: '09:00' });
    for (const count of [-1, 1.5, 'five']) {
      const { status, body } = await patchTally(baseUrl, user, 'reading', '2024-01-01', { count });
      assert.equal(status, 400);
      assert.equal(body.message, 'count must be a non-negative integer');
    }
  });

  await t.test('PATCH /:habitName/:date rejects an empty body with no fields to update', async () => {
    const user = await db.createTestUser();
    await postTally(baseUrl, user, 'reading', { localDate: '2024-01-01', localTime: '09:00' });
    const { status, body } = await patchTally(baseUrl, user, 'reading', '2024-01-01', {});
    assert.equal(status, 400);
    assert.equal(body.message, 'No fields to update');
  });

  await t.test('PATCH /:habitName/:date updates count and range fields for an existing tally', async () => {
    const user = await db.createTestUser();
    await postTally(baseUrl, user, 'reading', { localDate: '2024-01-01', localTime: '09:00' });

    const { status, body } = await patchTally(baseUrl, user, 'reading', '2024-01-01', {
      count: 7,
      range_start: '08:00',
      range_end: '12:00',
    });
    assert.equal(status, 200);
    assert.equal(body.message, 'Successfully updated tally for reading on 2024-01-01');

    const { body: tallyBody } = await getTallies(baseUrl, user, 'reading');
    assert.equal(tallyBody.data[0].count, 7);
    assert.equal(tallyBody.data[0].range_start, '08:00:00');
    assert.equal(tallyBody.data[0].range_end, '12:00:00');
  });

  await t.test('PATCH /:habitName/:date (wart) accepts range_start/range_end as null to clear them, unvalidated', async () => {
    // Only `count` is type/range checked; range_start/range_end pass through
    // as-is, including null, with no format validation at all.
    const user = await db.createTestUser();
    await postTally(baseUrl, user, 'reading', { localDate: '2024-01-01', localTime: '09:00' });

    const { status } = await patchTally(baseUrl, user, 'reading', '2024-01-01', {
      range_start: null,
      range_end: null,
    });
    assert.equal(status, 200);

    const { body: tallyBody } = await getTallies(baseUrl, user, 'reading');
    assert.equal(tallyBody.data[0].range_start, null);
    assert.equal(tallyBody.data[0].range_end, null);
  });

  await t.test('PATCH /:habitName/:date 404s when no tally exists for that date', async () => {
    const user = await db.createTestUser();
    const { status, body } = await patchTally(baseUrl, user, 'reading', '2024-01-01', { count: 5 });
    assert.equal(status, 404);
    assert.equal(body.message, 'No tally found for reading on 2024-01-01');
  });

  await t.test('PATCH /:habitName/:date cannot touch another user\'s tally', async () => {
    const userA = await db.createTestUser();
    const userB = await db.createTestUser();
    await postTally(baseUrl, userB, 'reading', { localDate: '2024-01-01', localTime: '09:00' });

    const { status } = await patchTally(baseUrl, userA, 'reading', '2024-01-01', { count: 99 });
    assert.equal(status, 404);

    const { body: tallyBody } = await getTallies(baseUrl, userB, 'reading');
    assert.equal(tallyBody.data[0].count, 1);
  });

  // ── Rename/delete vs. name-based tally join: deeper warts ───────────────────

  await t.test('(wart) renaming a habit to a name with a same-date orphaned tally silently fails to migrate that one row', async () => {
    // habit_tallies has a UNIQUE(user_uuid, habit_name, date). If an orphaned
    // tally already sits under the target name for a given date (created via
    // the tally endpoints without ever registering that habit), the rename's
    // best-effort `UPDATE habit_tallies SET habit_name = ?` hits a duplicate
    // key for that one date, throws, and is swallowed (only console.error'd).
    // The habits registry still reports success and the new name, while that
    // one tally row is left behind under the old, now-unregistered name.
    const user = await db.createTestUser();
    const { body: created } = await createHabit(baseUrl, user, { name: 'a' });
    await postTally(baseUrl, user, 'a', { localDate: '2024-01-01', localTime: '09:00' });
    // Orphaned tally under 'b': no habit named 'b' is ever registered.
    await postTally(baseUrl, user, 'b', { localDate: '2024-01-01', localTime: '10:00' });

    const { status, body } = await patchHabit(baseUrl, user, created.data.id, { name: 'b' });
    // The registry rename itself succeeds -- 'b' is free in the habits table.
    assert.equal(status, 200);
    assert.equal(body.data.name, 'b');

    // The colliding-date tally never made it from 'a' to 'b': it's still
    // sitting under 'a', which is no longer a registered habit for anyone.
    const { body: orphaned } = await getTallies(baseUrl, user, 'a');
    const { body: renamed } = await getTallies(baseUrl, user, 'b');
    assert.equal(orphaned.data.length, 1);
    assert.equal(orphaned.data[0].count, 1);
    // 'b' still only has its original pre-existing row (count 1, range 10:00),
    // not two rows and not the renamed one merged in.
    assert.equal(renamed.data.length, 1);
    assert.equal(renamed.data[0].range_start, '10:00:00');
  });

  await t.test('(wart) deleting a habit does not touch tallies left under a name it was never registered as', async () => {
    // Tallies are matched to a habit purely by current habit_name. A tally
    // row created for a name the registry never had (or no longer has) is
    // invisible to DELETE /:id, which only deletes rows matching the
    // habit's own name at delete time.
    const user = await db.createTestUser();
    await postTally(baseUrl, user, 'orphan', { localDate: '2024-01-01', localTime: '09:00' });
    const { body: created } = await createHabit(baseUrl, user, { name: 'reading' });
    await postTally(baseUrl, user, 'reading', { localDate: '2024-01-02', localTime: '09:00' });

    await deleteHabit(baseUrl, user, created.data.id);

    const { body: orphanTallies } = await getTallies(baseUrl, user, 'orphan');
    assert.equal(orphanTallies.data.length, 1);
  });
});
