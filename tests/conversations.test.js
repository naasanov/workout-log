// Tests for services/conversations/store.ts -- the conversation-first data
// layer behind the (former) date-keyed nutrition chat transcript, plus the
// migrations/023_conversations.sql backfill that repoints pre-existing
// chat_messages / proposal_resolutions rows at it.
//
// services/nutrition/transcripts.ts (the legacy (user, date)-keyed bridge
// built on top of this store) is exercised by tests/nutrition.test.js, which
// must keep passing unmodified -- that is the proof the re-keying preserved
// the existing contract. This file covers the new, conversation-first API
// directly: CRUD, the one-active-conversation invariant, message/resolution
// round-tripping, the dropped-tool-part write-time filter, and the backfill.
//
// Requires a reachable database (see scripts/testDb.js). If none is
// reachable, every test here is skipped (not failed).
//
// Run with: DB_NAME=workout_log_test_conv npm test
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { execFileSync } = require('child_process');
const db = require('../scripts/testDb');

const REPO_ROOT = path.join(__dirname, '..');

test('conversations store', async (t) => {
  const available = await db.isDbReachable();
  if (!available) {
    t.skip('No reachable database on 127.0.0.1:3307. Start it with: docker compose up -d, then npm run db:setup (see scripts/testDb.js).');
    return;
  }

  await db.setupTestDb();
  const store = db.requireTs('services/conversations/store.ts');
  const pool = db.getPool();

  // See tests/nutrition.test.js for why this retries: an intermittent
  // (~1-10%) read-your-own-write miss on the shared test pool right after a
  // TRUNCATE, unrelated to anything in this file.
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

  // Re-runs scripts/migrate.js as a child process against the test schema,
  // mirroring testDb.js's own (unexported) runMigrations() -- used only by
  // the backfill test below, which needs migration 023 to run a second time
  // against rows it deliberately leaves conversation_id-less beforehand.
  function rerunMigrate() {
    execFileSync('node', ['scripts/migrate.js'], { cwd: REPO_ROOT, env: process.env, stdio: 'pipe' });
  }

  t.beforeEach(async () => {
    await db.resetDb();
  });

  t.after(async () => {
    await db.closePool();
  });

  // ---- Conversation CRUD ----

  await t.test('createConversation starts a new active conversation', async () => {
    const user = await createUser();
    const id = await store.createConversation(user.uuid);

    const list = await store.listConversations(user.uuid);
    assert.equal(list.length, 1);
    assert.equal(list[0].id, id);
    assert.equal(list[0].active, true);
    assert.equal(list[0].archived_at, null);
    assert.equal(list[0].title, null);
  });

  await t.test('starting a new conversation archives the previously active one', async () => {
    const user = await createUser();
    const id1 = await store.createConversation(user.uuid);
    const id2 = await store.createConversation(user.uuid);

    const list = await store.listConversations(user.uuid);
    const conv1 = list.find((c) => c.id === id1);
    const conv2 = list.find((c) => c.id === id2);
    assert.equal(conv1.active, false);
    assert.notEqual(conv1.archived_at, null);
    assert.equal(conv2.active, true);
    assert.equal(list.filter((c) => c.active).length, 1);
  });

  await t.test('one active conversation per user is enforced at the DB level', async () => {
    const user = await createUser();
    await store.createConversation(user.uuid);

    // Bypass the store's archive-then-insert logic and try to insert a
    // second active row directly -- the active_slot unique index must
    // reject this even when application code doesn't guard it.
    await assert.rejects(
      pool.query('INSERT INTO conversations (user_uuid) VALUES (UUID_TO_BIN(?))', [user.uuid]),
      (err) => err.code === 'ER_DUP_ENTRY',
    );
  });

  await t.test('the active_slot invariant is scoped per user', async () => {
    const userA = await createUser();
    const userB = await createUser();
    await store.createConversation(userA.uuid);

    // A second user's active conversation must not be blocked by userA's.
    await assert.doesNotReject(store.createConversation(userB.uuid));
  });

  await t.test('archiveConversation archives an active conversation and sets an expiry', async () => {
    const user = await createUser();
    const id = await store.createConversation(user.uuid);

    await store.archiveConversation(user.uuid, id);

    const { conversation } = await store.getConversation(user.uuid, id);
    assert.equal(conversation.active, false);
    assert.notEqual(conversation.archived_at, null);
    assert.notEqual(conversation.expires_at, null);
  });

  await t.test('archiveConversation is idempotent on an already-archived conversation', async () => {
    const user = await createUser();
    const id = await store.createConversation(user.uuid);
    await store.archiveConversation(user.uuid, id);
    const first = (await store.getConversation(user.uuid, id)).conversation;

    await store.archiveConversation(user.uuid, id);
    const second = (await store.getConversation(user.uuid, id)).conversation;

    assert.equal(second.archived_at, first.archived_at);
    assert.equal(second.expires_at, first.expires_at);
  });

  await t.test('continueConversation reactivates an archived conversation and clears its expiry', async () => {
    const user = await createUser();
    const id1 = await store.createConversation(user.uuid);
    const id2 = await store.createConversation(user.uuid); // archives id1

    await store.continueConversation(user.uuid, id1);

    const list = await store.listConversations(user.uuid);
    const conv1 = list.find((c) => c.id === id1);
    const conv2 = list.find((c) => c.id === id2);
    assert.equal(conv1.active, true);
    assert.equal(conv1.archived_at, null);
    assert.equal(conv1.expires_at, null);
    // Continuing id1 must have archived id2, since only one can be active.
    assert.equal(conv2.active, false);
    assert.equal(list.filter((c) => c.active).length, 1);
  });

  await t.test('getConversation returns null for a non-existent id or a conversation the caller does not own', async () => {
    const userA = await createUser();
    const userB = await createUser();
    const idA = await store.createConversation(userA.uuid);

    assert.equal(await store.getConversation(userA.uuid, 999999), null);
    assert.equal(await store.getConversation(userB.uuid, idA), null);
  });

  await t.test('deleteConversation removes the conversation and its messages/resolutions', async () => {
    const user = await createUser();
    const id = await store.createConversation(user.uuid);
    await store.appendMessage(user.uuid, id, 'm1', 'user', [{ type: 'text', text: 'hi' }]);
    await store.saveResolution(user.uuid, id, 'call_1', 'entry', 'confirmed', 'Banana');

    await store.deleteConversation(user.uuid, id);

    assert.equal(await store.getConversation(user.uuid, id), null);
    const [msgRows] = await pool.query('SELECT * FROM chat_messages WHERE conversation_id = ?', [id]);
    const [resRows] = await pool.query('SELECT * FROM proposal_resolutions WHERE conversation_id = ?', [id]);
    assert.equal(msgRows.length, 0);
    assert.equal(resRows.length, 0);
  });

  // ---- Messages ----

  await t.test('appendMessage + getConversation preserve insertion order and round-trip parts JSON exactly', async () => {
    const user = await createUser();
    const id = await store.createConversation(user.uuid);
    const partsA = [{ type: 'text', text: 'Hello' }];
    const partsB = [{ type: 'tool-search_foods', toolCallId: 'call_1', input: { nested: { a: [1, 2, 3] }, flag: true } }];
    const partsC = [{ type: 'text', text: 'Goodbye' }];

    await store.appendMessage(user.uuid, id, 'msg-1', 'user', partsA);
    await store.appendMessage(user.uuid, id, 'msg-2', 'assistant', partsB);
    await store.appendMessage(user.uuid, id, 'msg-3', 'user', partsC);

    const { messages } = await store.getConversation(user.uuid, id);
    assert.equal(messages.length, 3);
    assert.deepEqual(messages.map((m) => m.message_id), ['msg-1', 'msg-2', 'msg-3']);
    assert.deepEqual(messages.map((m) => m.role), ['user', 'assistant', 'user']);
    assert.deepEqual(messages[1].parts, partsB);
    assert.equal(messages.every((m) => m.interrupted === false), true);
  });

  await t.test('markInterrupted flags only the targeted row', async () => {
    const user = await createUser();
    const id = await store.createConversation(user.uuid);
    const id1 = await store.appendMessage(user.uuid, id, 'm1', 'user', [{ type: 'text', text: 'a' }]);
    const id2 = await store.appendMessage(user.uuid, id, 'm2', 'assistant', [{ type: 'text', text: 'b' }]);
    await store.markInterrupted(id2);

    const { messages } = await store.getConversation(user.uuid, id);
    assert.equal(messages.find((m) => m.id === id1).interrupted, false);
    assert.equal(messages.find((m) => m.id === id2).interrupted, true);
  });

  await t.test('appendMessage drops calculator and convert_to_grams tool parts, keeping other tool parts intact', async () => {
    const user = await createUser();
    const id = await store.createConversation(user.uuid);
    const parts = [
      { type: 'text', text: 'Logging your lunch' },
      { type: 'tool-calculator', toolCallId: 'c1', state: 'output-available', input: { expression: '1+1' }, output: 2 },
      { type: 'tool-convert_to_grams', toolCallId: 'c2', state: 'output-available', input: { amount: 1, unit: 'oz' }, output: { grams: 28 } },
      { type: 'tool-search_foods', toolCallId: 'c3', state: 'output-available', input: { query: 'apple' }, output: { results: [] } },
    ];

    await store.appendMessage(user.uuid, id, 'm1', 'assistant', parts);

    const { messages } = await store.getConversation(user.uuid, id);
    const stored = messages[0].parts;
    assert.equal(stored.length, 2);
    assert.deepEqual(stored.map((p) => p.type), ['text', 'tool-search_foods']);
    // The surviving tool part keeps its full payload -- only calculator /
    // convert_to_grams are stripped, not tool parts generally.
    assert.deepEqual(stored[1].input, { query: 'apple' });
    assert.deepEqual(stored[1].output, { results: [] });
  });

  await t.test('appendMessage sets the conversation title from the truncated first user message, and never overwrites it', async () => {
    const user = await createUser();
    const id = await store.createConversation(user.uuid);
    const longText = '  ' + 'a'.repeat(100) + '  ';

    await store.appendMessage(user.uuid, id, 'm1', 'user', [{ type: 'text', text: longText }]);
    const { conversation: after1 } = await store.getConversation(user.uuid, id);
    assert.equal(after1.title, `${'a'.repeat(80)}…`);

    await store.appendMessage(user.uuid, id, 'm2', 'user', [{ type: 'text', text: 'a completely different message' }]);
    const { conversation: after2 } = await store.getConversation(user.uuid, id);
    assert.equal(after2.title, after1.title);
  });

  await t.test('appendMessage stores a short first message as the title verbatim (trimmed, no ellipsis)', async () => {
    const user = await createUser();
    const id = await store.createConversation(user.uuid);
    await store.appendMessage(user.uuid, id, 'm1', 'user', [{ type: 'text', text: '  Hi there  ' }]);

    const { conversation } = await store.getConversation(user.uuid, id);
    assert.equal(conversation.title, 'Hi there');
  });

  await t.test('listConversations orders most-recently-updated first', async () => {
    const user = await createUser();
    const idOld = await store.createConversation(user.uuid);
    const idNew = await store.createConversation(user.uuid); // archives idOld

    // Force a deterministic ordering rather than relying on real-time gaps.
    await pool.query('UPDATE conversations SET updated_at = DATE_SUB(NOW(), INTERVAL 1 DAY) WHERE id = ?', [idOld]);

    const list = await store.listConversations(user.uuid);
    assert.deepEqual(list.map((c) => c.id), [idNew, idOld]);
  });

  await t.test('conversations and messages are isolated per user', async () => {
    const userA = await createUser();
    const userB = await createUser();
    const idA = await store.createConversation(userA.uuid);
    const idB = await store.createConversation(userB.uuid);
    await store.appendMessage(userA.uuid, idA, 'a1', 'user', [{ type: 'text', text: 'from A' }]);
    await store.appendMessage(userB.uuid, idB, 'b1', 'user', [{ type: 'text', text: 'from B' }]);

    const listA = await store.listConversations(userA.uuid);
    const listB = await store.listConversations(userB.uuid);
    assert.deepEqual(listA.map((c) => c.id), [idA]);
    assert.deepEqual(listB.map((c) => c.id), [idB]);
    assert.equal(listA[0].title, 'from A');
    assert.equal(listB[0].title, 'from B');

    const { messages: messagesA } = await store.getConversation(userA.uuid, idA);
    assert.equal(messagesA.length, 1);
    assert.equal(messagesA[0].message_id, 'a1');
  });

  await t.test('listConversations still lists a conversation with zero messages, untitled', async () => {
    const user = await createUser();
    const id = await store.createConversation(user.uuid);

    const list = await store.listConversations(user.uuid);
    assert.equal(list.length, 1);
    assert.equal(list[0].id, id);
    assert.equal(list[0].title, null);
  });

  // ---- Proposal resolutions ----

  await t.test('saveResolution + getResolutions round-trip, and a re-save upserts rather than duplicating', async () => {
    const user = await createUser();
    const id = await store.createConversation(user.uuid);

    await store.saveResolution(user.uuid, id, 'call_abc', 'entry', 'confirmed', 'Logged: Apple');
    let rows = await store.getResolutions(id);
    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0], {
      tool_call_id: 'call_abc', kind: 'entry', status: 'confirmed', display_name: 'Logged: Apple', result: null,
    });

    await store.saveResolution(user.uuid, id, 'call_abc', 'entry', 'denied', null);
    rows = await store.getResolutions(id);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].status, 'denied');
    assert.equal(rows[0].display_name, null);
  });

  await t.test('saveResolution + getResolutions round-trip a structured result', async () => {
    const user = await createUser();
    const id = await store.createConversation(user.uuid);

    await store.saveResolution(
      user.uuid, id, 'call_batch_1', 'batch', 'confirmed', 'Push Day: Bench Press',
      null, [{ ref: 'sec1', id: 10 }, { ref: 'ex1', id: 22 }],
    );

    const rows = await store.getResolutions(id);
    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0].result, [{ ref: 'sec1', id: 10 }, { ref: 'ex1', id: 22 }]);

    // Re-saving without a result (e.g. the same toolCallId denied instead)
    // clears the previously stored result rather than leaving it stale.
    await store.saveResolution(user.uuid, id, 'call_batch_1', 'batch', 'denied', null);
    const after = await store.getResolutions(id);
    assert.equal(after[0].result, null);
  });

  await t.test('proposal resolutions are isolated per conversation, including the same toolCallId in two different chats', async () => {
    const user = await createUser();
    const id1 = await store.createConversation(user.uuid);
    const id2 = await store.createConversation(user.uuid);

    await store.saveResolution(user.uuid, id1, 'call_shared', 'entry', 'confirmed', 'A');
    await store.saveResolution(user.uuid, id2, 'call_shared', 'entry', 'denied', 'B');

    const rows1 = await store.getResolutions(id1);
    const rows2 = await store.getResolutions(id2);
    assert.equal(rows1[0].status, 'confirmed');
    assert.equal(rows2[0].status, 'denied');
  });

  await t.test('clearResolutions removes all resolutions for a conversation only', async () => {
    const user = await createUser();
    const id1 = await store.createConversation(user.uuid);
    const id2 = await store.createConversation(user.uuid);
    await store.saveResolution(user.uuid, id1, 'call_1', 'entry', 'confirmed', 'A');
    await store.saveResolution(user.uuid, id2, 'call_2', 'entry', 'confirmed', 'B');

    await store.clearResolutions(id1);

    assert.equal((await store.getResolutions(id1)).length, 0);
    assert.equal((await store.getResolutions(id2)).length, 1);
  });

  // ---- Backfill (migrations/023_conversations.sql) ----

  await t.test('backfill assigns one conversation per distinct (user, date) and re-points proposal_resolutions to match, idempotently', async () => {
    const userA = await createUser();
    const userB = await createUser();

    // Simulate pre-migration rows: real (user, date) history with no
    // conversation_id yet, as scripts/migrate.js would find them mid-deploy
    // on a production database that predates migration 023.
    async function insertLegacyMessage(user, date, messageId, role, text) {
      await pool.query(
        `INSERT INTO chat_messages (user_uuid, date, conversation_id, message_id, role, parts)
         VALUES (UUID_TO_BIN(?), ?, NULL, ?, ?, ?)`,
        [user.uuid, date, messageId, role, JSON.stringify([{ type: 'text', text }])],
      );
    }
    async function insertLegacyResolution(user, date, toolCallId) {
      await pool.query(
        `INSERT INTO proposal_resolutions (user_uuid, date, conversation_id, tool_call_id, kind, status, display_name)
         VALUES (UUID_TO_BIN(?), ?, NULL, ?, 'entry', 'confirmed', 'Banana')`,
        [user.uuid, date, toolCallId],
      );
    }

    await insertLegacyMessage(userA, '2024-05-01', 'a1', 'user', 'Hi from A day 1');
    await insertLegacyMessage(userA, '2024-05-01', 'a2', 'assistant', 'reply');
    await insertLegacyMessage(userA, '2024-05-02', 'a3', 'user', 'Hi from A day 2');
    await insertLegacyMessage(userB, '2024-05-01', 'b1', 'user', 'Hi from B day 1');
    await insertLegacyResolution(userA, '2024-05-01', 'call_1');

    // Re-run migration 023 against these now-existing conversation_id-less
    // rows -- this exercises the actual backfill SQL, not a reimplementation
    // of it.
    await pool.query("DELETE FROM schema_migrations WHERE filename = '023_conversations.sql'");
    rerunMigrate();

    const [msgRows] = await pool.query(
      `SELECT message_id, conversation_id FROM chat_messages WHERE message_id IN ('a1','a2','a3','b1')`,
    );
    const byMsg = Object.fromEntries(msgRows.map((r) => [r.message_id, r.conversation_id]));

    assert.ok(byMsg.a1, 'a1 should have a conversation_id');
    assert.equal(byMsg.a1, byMsg.a2, 'same user+date messages share one conversation');
    assert.notEqual(byMsg.a1, byMsg.a3, 'different dates get different conversations');
    assert.notEqual(byMsg.a1, byMsg.b1, 'different users get different conversations');
    for (const convId of Object.values(byMsg)) assert.notEqual(convId, null);

    // Distinct (user, date) pairs among the seeded rows: (A,05-01), (A,05-02), (B,05-01) = 3.
    const distinctConvIds = new Set(Object.values(byMsg));
    assert.equal(distinctConvIds.size, 3);

    // proposal_resolutions from the same (user, date) as a1/a2 must land on
    // the same conversation.
    const [[resRow]] = await pool.query(
      `SELECT conversation_id FROM proposal_resolutions WHERE tool_call_id = 'call_1'`,
    );
    assert.equal(resRow.conversation_id, byMsg.a1);

    // Idempotency: re-running again (forcing the migration to execute a
    // second time) must not create additional conversations or reassign ids,
    // since every row already has a conversation_id.
    await pool.query("DELETE FROM schema_migrations WHERE filename = '023_conversations.sql'");
    rerunMigrate();

    const [afterRows] = await pool.query(
      `SELECT message_id, conversation_id FROM chat_messages WHERE message_id IN ('a1','a2','a3','b1')`,
    );
    const byMsgAfter = Object.fromEntries(afterRows.map((r) => [r.message_id, r.conversation_id]));
    assert.deepEqual(byMsgAfter, byMsg);

    const [[{ total }]] = await pool.query('SELECT COUNT(*) as total FROM conversations');
    assert.equal(total, distinctConvIds.size);
  });
});
