// Tests for #354 -- auto-archiving a chat conversation once it is both from
// an earlier local day than the client's current date AND more than an hour
// old, so a first-of-a-new-day chat starts fresh while a still-active
// midnight-snack conversation survives the day boundary.
//
// Two parts:
//   1. store.shouldAutoArchive -- a pure predicate, no DB needed.
//   2. GET /api/chat/active -- the actual route wiring, including the query
//      param validation and the "skip auto-archive entirely" behavior for a
//      missing/malformed client date, and the empty-conversation exception.
//      Requires a reachable database (see scripts/testDb.js); every test in
//      part 2 is skipped (not failed) if none is reachable.
//
// Run with: DB_NAME=workout_log_test_archive npm run test:file tests/autoArchiveChat.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../scripts/testDb');

db.applyTestEnv();
const store = db.requireTs('services/conversations/store.ts');

// ---------------------------------------------------------------------------
// Part 1: shouldAutoArchive -- pure, no DB.
// ---------------------------------------------------------------------------

test('shouldAutoArchive', async (t) => {
  await t.test('archives when the conversation is from an earlier local day and over an hour old', () => {
    // UTC updatedAt of 2026-09-14T23:00:00Z, client at UTC+0 (offset 0): local
    // day is 2026-09-14, a day before the client's 2026-09-15. now is 2 hours later.
    const updatedAt = new Date('2026-09-14T23:00:00Z');
    const now = new Date('2026-09-15T01:00:00Z');
    assert.equal(store.shouldAutoArchive(updatedAt, '2026-09-15', 0, now), true);
  });

  await t.test('does not archive when the conversation is from an earlier day but still within the hour (midnight snack)', () => {
    const updatedAt = new Date('2026-09-14T23:50:00Z');
    const now = new Date('2026-09-15T00:10:00Z'); // only 20 minutes later
    assert.equal(store.shouldAutoArchive(updatedAt, '2026-09-15', 0, now), false);
  });

  await t.test('does not archive when the conversation is over an hour old but from the same local day', () => {
    const updatedAt = new Date('2026-09-15T01:00:00Z');
    const now = new Date('2026-09-15T03:00:00Z'); // 2 hours later, same day
    assert.equal(store.shouldAutoArchive(updatedAt, '2026-09-15', 0, now), false);
  });

  await t.test('does not archive when neither condition holds', () => {
    const updatedAt = new Date('2026-09-15T02:50:00Z');
    const now = new Date('2026-09-15T03:00:00Z');
    assert.equal(store.shouldAutoArchive(updatedAt, '2026-09-15', 0, now), false);
  });

  await t.test('resolves the local day using the client offset, not the raw UTC day', () => {
    // 2026-09-15T02:00:00Z is already the 15th in UTC, but a client at
    // UTC-5 (offset +300, e.g. US Eastern) sees local 2026-09-14 21:00 --
    // still "yesterday" from that client's perspective.
    const updatedAt = new Date('2026-09-15T02:00:00Z');
    const now = new Date('2026-09-15T05:00:00Z'); // 3 hours later
    assert.equal(store.shouldAutoArchive(updatedAt, '2026-09-15', 300, now), true);
    // The same instant, compared against a client whose local day already
    // matches (offset 0, UTC): not from an earlier day, so no archive.
    assert.equal(store.shouldAutoArchive(updatedAt, '2026-09-15', 0, now), false);
  });

  await t.test('a positive offset (west of UTC) and a negative offset (east of UTC) both resolve correctly', () => {
    // UTC+14 (Kiribati, offset -840): 2026-09-15T00:30Z is already local
    // 2026-09-15T14:30, so "today" -- not stale even though it's old.
    const updatedAtEast = new Date('2026-09-15T00:30:00Z');
    const nowEast = new Date('2026-09-15T05:00:00Z');
    assert.equal(store.shouldAutoArchive(updatedAtEast, '2026-09-15', -840, nowEast), false);

    // UTC-12 (Baker Island, offset +720): 2026-09-15T10:00Z is local
    // 2026-09-14T22:00, still yesterday.
    const updatedAtWest = new Date('2026-09-15T10:00:00Z');
    const nowWest = new Date('2026-09-15T13:00:00Z');
    assert.equal(store.shouldAutoArchive(updatedAtWest, '2026-09-15', 720, nowWest), true);
  });
});

// ---------------------------------------------------------------------------
// Part 2: GET /api/chat/active -- route wiring against a real schema.
// ---------------------------------------------------------------------------

async function get(baseUrl, user, path) {
  const res = await fetch(`${baseUrl}/api/chat${path}`, {
    headers: user ? user.authHeader() : {},
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

test('GET /active auto-archive (#354)', async (t) => {
  const available = await db.isDbReachable();
  if (!available) {
    t.skip('No reachable database on 127.0.0.1:3307. Start it with: docker compose up -d, then npm run db:setup (see scripts/testDb.js).');
    return;
  }

  await db.setupTestDb();
  const chat = db.requireTs('routes/chat.ts').default;
  const pool = db.getPool();
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

  // Backdates a conversation's created_at/updated_at directly, past the
  // triggers that would otherwise bump updated_at to NOW() on any UPDATE --
  // simulates "this conversation had its last message a day+ ago" without
  // waiting in real time. Distinct created_at keeps it out of the
  // brand-new-and-empty exception.
  async function backdate(conversationId, createdAt, updatedAt) {
    await pool.query('UPDATE conversations SET created_at = ?, updated_at = ? WHERE id = ?', [
      createdAt, updatedAt, conversationId,
    ]);
  }

  t.beforeEach(async () => {
    await db.resetDb();
  });

  t.after(async () => {
    await db.stopTestServer(server);
    await db.closePool();
  });

  await t.test('archives a conversation from an earlier local day (UTC client) and starts a fresh one', async () => {
    const user = await createUser();
    const staleId = await store.createConversation(user.uuid);
    // created_at != updated_at marks this as having had real activity, not a
    // brand-new empty conversation (see the empty-conversation exception below).
    await backdate(staleId, '2026-09-14 07:00:00', '2026-09-14 08:00:00');

    const { status, body } = await get(
      baseUrl, user, '/active?clientLocalDate=2026-09-15&clientOffsetMinutes=0',
    );
    assert.equal(status, 200);
    assert.notEqual(body.data.conversation.id, staleId);
    assert.equal(body.data.conversation.active, true);
    assert.deepEqual(body.data.messages, []);

    const { body: oldConv } = await get(baseUrl, user, `/conversations/${staleId}`);
    assert.equal(oldConv.data.conversation.active, false);
  });

  await t.test('does not archive a conversation from an earlier day that is still within the hour', async () => {
    const user = await createUser();
    const recentId = await store.createConversation(user.uuid);
    // updated 10 minutes before "now" -- backdate created_at too so it isn't
    // treated as brand-new-and-empty, but keep updated_at recent.
    const nowSql = new Date();
    const tenMinAgo = new Date(nowSql.getTime() - 10 * 60 * 1000);
    const twentyMinAgo = new Date(nowSql.getTime() - 20 * 60 * 1000);
    await backdate(
      recentId,
      twentyMinAgo.toISOString().slice(0, 19).replace('T', ' '),
      tenMinAgo.toISOString().slice(0, 19).replace('T', ' '),
    );

    // Client's local date is "tomorrow" relative to updated_at's UTC day in
    // the pathological case where the clock just ticked past midnight --
    // still must not archive because it's under an hour old.
    const clientLocalDate = new Date(nowSql.getTime() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const { status, body } = await get(
      baseUrl, user, `/active?clientLocalDate=${clientLocalDate}&clientOffsetMinutes=0`,
    );
    assert.equal(status, 200);
    assert.equal(body.data.conversation.id, recentId);
  });

  await t.test('does not archive a conversation from today even if over an hour old', async () => {
    const user = await createUser();
    const id = await store.createConversation(user.uuid);
    const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000);
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const todayLocal = new Date().toISOString().slice(0, 10);
    await backdate(
      id,
      threeHoursAgo.toISOString().slice(0, 19).replace('T', ' '),
      twoHoursAgo.toISOString().slice(0, 19).replace('T', ' '),
    );

    const { status, body } = await get(
      baseUrl, user, `/active?clientLocalDate=${todayLocal}&clientOffsetMinutes=0`,
    );
    assert.equal(status, 200);
    assert.equal(body.data.conversation.id, id);
  });

  await t.test('skips auto-archive entirely when clientLocalDate is missing, behaving exactly as before', async () => {
    const user = await createUser();
    const staleId = await store.createConversation(user.uuid);
    await backdate(staleId, '2026-09-14 07:00:00', '2026-09-14 08:00:00');

    const { status, body } = await get(baseUrl, user, '/active');
    assert.equal(status, 200);
    assert.equal(body.data.conversation.id, staleId);
  });

  await t.test('skips auto-archive entirely when clientLocalDate is malformed', async () => {
    const user = await createUser();
    const staleId = await store.createConversation(user.uuid);
    await backdate(staleId, '2026-09-14 07:00:00', '2026-09-14 08:00:00');

    const { status, body } = await get(
      baseUrl, user, '/active?clientLocalDate=not-a-date&clientOffsetMinutes=0',
    );
    assert.equal(status, 200);
    assert.equal(body.data.conversation.id, staleId);
  });

  await t.test('skips auto-archive entirely when clientOffsetMinutes is missing', async () => {
    const user = await createUser();
    const staleId = await store.createConversation(user.uuid);
    await backdate(staleId, '2026-09-14 07:00:00', '2026-09-14 08:00:00');

    const { status, body } = await get(baseUrl, user, '/active?clientLocalDate=2026-09-15');
    assert.equal(status, 200);
    assert.equal(body.data.conversation.id, staleId);
  });

  await t.test('does not churn a brand-new, never-touched conversation even if it is from an earlier day', async () => {
    const user = await createUser();
    const id = await store.createConversation(user.uuid);
    // Never appended-to: created_at === updated_at, backdated a full day.
    await backdate(id, '2026-09-14 08:00:00', '2026-09-14 08:00:00');
    // Redundant given the shared timestamp above, but explicit about intent:
    // this conversation has zero messages.
    const { messages } = await store.getConversation(user.uuid, id);
    assert.equal(messages.length, 0);

    const { status, body } = await get(
      baseUrl, user, '/active?clientLocalDate=2026-09-15&clientOffsetMinutes=0',
    );
    assert.equal(status, 200);
    assert.equal(body.data.conversation.id, id);
  });

  await t.test('archiving preserves an earlier conversation\'s messages, reachable via the conversation list', async () => {
    const user = await createUser();
    const staleId = await store.createConversation(user.uuid);
    await store.appendMessage(user.uuid, staleId, 'm1', 'user', [{ type: 'text', text: 'yesterday' }]);
    await backdate(staleId, '2026-09-14 08:00:00', '2026-09-14 08:00:01');

    const { body } = await get(baseUrl, user, '/active?clientLocalDate=2026-09-15&clientOffsetMinutes=0');
    assert.notEqual(body.data.conversation.id, staleId);

    const { body: oldConv } = await get(baseUrl, user, `/conversations/${staleId}`);
    assert.equal(oldConv.data.messages.length, 1);
    assert.equal(oldConv.data.messages[0].message_id, 'm1');
  });
});
