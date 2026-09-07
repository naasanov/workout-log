// Characterization tests for routes/chat.ts -- the global (not date-keyed)
// AI chat HTTP surface built on services/conversations/store.ts. Exercises
// real HTTP requests through the actual router against a real MySQL schema
// rather than mocking pool.query, mirroring tests/bodyWeight.test.js.
//
// POST /api/chat itself calls the OpenAI-backed streamChat and cannot be
// exercised end-to-end without a live model key -- see the explicit skip
// below. Everything reachable without invoking the model (auth, body
// validation, and active-conversation resolution via GET /active, which
// shares its resolveActiveConversationId helper with POST /api/chat) is
// covered here.
//
// Requires a reachable database (see scripts/testDb.js). If none is
// reachable, every test here is skipped (not failed) so `npm test` still
// passes for someone who hasn't started Docker.
//
// Run with: DB_NAME=workout_log_test_chat npm test
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../scripts/testDb');

async function post(baseUrl, user, path, body) {
  const res = await fetch(`${baseUrl}/api/chat${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(user ? user.authHeader() : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function get(baseUrl, user, path) {
  const res = await fetch(`${baseUrl}/api/chat${path}`, {
    headers: user ? user.authHeader() : {},
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function del(baseUrl, user, path) {
  const res = await fetch(`${baseUrl}/api/chat${path}`, {
    method: 'DELETE',
    headers: user ? user.authHeader() : {},
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

test('chat routes', async (t) => {
  const available = await db.isDbReachable();
  if (!available) {
    t.skip('No reachable database on 127.0.0.1:3307. Start it with: docker compose up -d, then npm run db:setup (see scripts/testDb.js).');
    return;
  }

  await db.setupTestDb();
  const chat = db.requireTs('routes/chat.ts').default;
  const store = db.requireTs('services/conversations/store.ts');
  const pool = db.getPool();
  const { server, baseUrl } = await db.startTestServer('/api/chat', chat);

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

  t.beforeEach(async () => {
    await db.resetDb();
  });

  t.after(async () => {
    await db.stopTestServer(server);
    await db.closePool();
  });

  // ---- Auth ----

  await t.test('every endpoint rejects an unauthenticated request', async () => {
    const user = await createUser();
    const conv = await store.createConversation(user.uuid);

    for (const call of [
      () => get(baseUrl, null, '/active'),
      () => get(baseUrl, null, '/conversations'),
      () => post(baseUrl, null, '/conversations', {}),
      () => get(baseUrl, null, `/conversations/${conv}`),
      () => post(baseUrl, null, `/conversations/${conv}/archive`, {}),
      () => post(baseUrl, null, `/conversations/${conv}/continue`, {}),
      () => del(baseUrl, null, `/conversations/${conv}`),
      () => get(baseUrl, null, `/conversations/${conv}/resolutions`),
      () => post(baseUrl, null, `/conversations/${conv}/resolutions`, {}),
      () => post(baseUrl, null, '/', { messages: [] }),
    ]) {
      const { status, body } = await call();
      assert.equal(status, 401);
      assert.equal(body.message, 'Unauthorized: access token required');
    }
  });

  // ---- POST / (chat) — everything that doesn't need the model ----

  await t.test('POST / rejects a body whose messages is not an array', async () => {
    const user = await createUser();
    const { status, body } = await post(baseUrl, user, '/', { messages: 'nope' });
    assert.equal(status, 400);
    assert.equal(body.message, 'messages must be an array');
  });

  await t.test('POST / rejects a malformed context', async () => {
    const user = await createUser();
    const { status, body } = await post(baseUrl, user, '/', { messages: [], context: { selectedDate: 'not-a-date' } });
    assert.equal(status, 400);
    assert.equal(body.message, 'context must describe { tab?, selectedDate?, focusedResource? }');
  });

  // POST / itself needs a live OpenAI key to stream a real model response, so
  // it is not exercised end-to-end here. The active-conversation resolution
  // it performs before ever calling the model (resolveActiveConversationId)
  // is the same code path GET /active uses, and is covered by the tests
  // below instead.
  await t.test('POST / streaming a real model response (skipped: needs a live OpenAI key)', { skip: true }, () => {});

  // ---- GET /active — conversation resolution without invoking the model ----

  await t.test('GET /active creates a conversation when the user has none', async () => {
    const user = await createUser();
    const { status, body } = await get(baseUrl, user, '/active');
    assert.equal(status, 200);
    assert.equal(body.data.conversation.active, true);
    assert.deepEqual(body.data.messages, []);
  });

  await t.test('GET /active reuses the same conversation on a later call', async () => {
    const user = await createUser();
    const first = await get(baseUrl, user, '/active');
    const second = await get(baseUrl, user, '/active');
    assert.equal(first.body.data.conversation.id, second.body.data.conversation.id);

    const list = await store.listConversations(user.uuid);
    assert.equal(list.length, 1);
  });

  // ---- GET /conversations ----

  await t.test('GET /conversations lists most-recently-updated first', async () => {
    const user = await createUser();
    const idOld = await store.createConversation(user.uuid);
    const idNew = await store.createConversation(user.uuid); // archives idOld
    await pool.query('UPDATE conversations SET updated_at = DATE_SUB(NOW(), INTERVAL 1 DAY) WHERE id = ?', [idOld]);

    const { status, body } = await get(baseUrl, user, '/conversations');
    assert.equal(status, 200);
    assert.deepEqual(body.data.map((c) => c.id), [idNew, idOld]);
  });

  await t.test('GET /conversations includes each row\'s message count and a preview of its most recent message', async () => {
    const user = await createUser();
    const id = await store.createConversation(user.uuid);
    await store.appendMessage(user.uuid, id, 'm1', 'user', [{ type: 'text', text: 'first message' }]);
    await store.appendMessage(user.uuid, id, 'm2', 'assistant', [{ type: 'text', text: 'latest reply' }]);

    const { status, body } = await get(baseUrl, user, '/conversations');
    assert.equal(status, 200);
    assert.equal(body.data[0].message_count, 2);
    assert.equal(body.data[0].preview, 'latest reply');
  });

  await t.test('GET /conversations only returns the caller\'s own conversations', async () => {
    const userA = await createUser();
    const userB = await createUser();
    await store.createConversation(userA.uuid);
    await store.createConversation(userB.uuid);
    await store.createConversation(userB.uuid);

    const { body: bodyA } = await get(baseUrl, userA, '/conversations');
    const { body: bodyB } = await get(baseUrl, userB, '/conversations');
    assert.equal(bodyA.data.length, 1);
    assert.equal(bodyB.data.length, 2);
  });

  // ---- POST /conversations (new chat) ----

  await t.test('POST /conversations starts a new chat and archives the previous active one', async () => {
    const user = await createUser();
    const idOld = await store.createConversation(user.uuid);

    const { status, body } = await post(baseUrl, user, '/conversations', {});
    assert.equal(status, 201);
    assert.equal(body.data.conversation.active, true);
    assert.notEqual(body.data.conversation.id, idOld);

    const { body: oldConv } = await get(baseUrl, user, `/conversations/${idOld}`);
    assert.equal(oldConv.data.conversation.active, false);
    assert.notEqual(oldConv.data.conversation.archived_at, null);
  });

  // ---- GET /conversations/:id ----

  await t.test('GET /conversations/:id returns the conversation with its messages in order', async () => {
    const user = await createUser();
    const id = await store.createConversation(user.uuid);
    await store.appendMessage(user.uuid, id, 'm1', 'user', [{ type: 'text', text: 'hello' }]);
    await store.appendMessage(user.uuid, id, 'm2', 'assistant', [{ type: 'text', text: 'hi there' }]);

    const { status, body } = await get(baseUrl, user, `/conversations/${id}`);
    assert.equal(status, 200);
    assert.equal(body.data.conversation.id, id);
    assert.deepEqual(body.data.messages.map((m) => m.message_id), ['m1', 'm2']);
    assert.deepEqual(body.data.messages.map((m) => m.role), ['user', 'assistant']);
  });

  await t.test('GET /conversations/:id 404s for a non-existent id', async () => {
    const user = await createUser();
    const { status, body } = await get(baseUrl, user, '/conversations/999999');
    assert.equal(status, 404);
    assert.equal(body.message, 'Conversation 999999 not found');
  });

  await t.test('GET /conversations/:id 404s when the conversation belongs to another user', async () => {
    const userA = await createUser();
    const userB = await createUser();
    const idA = await store.createConversation(userA.uuid);

    const { status, body } = await get(baseUrl, userB, `/conversations/${idA}`);
    assert.equal(status, 404);
    assert.equal(body.message, `Conversation ${idA} not found`);
  });

  // ---- archive / continue ----

  await t.test('POST /conversations/:id/archive archives an active conversation', async () => {
    const user = await createUser();
    const id = await store.createConversation(user.uuid);

    const { status, body } = await post(baseUrl, user, `/conversations/${id}/archive`, {});
    assert.equal(status, 200);
    assert.equal(body.data.conversation.active, false);
    assert.notEqual(body.data.conversation.expires_at, null);
  });

  await t.test('POST /conversations/:id/archive 404s for another user\'s conversation', async () => {
    const userA = await createUser();
    const userB = await createUser();
    const idA = await store.createConversation(userA.uuid);

    const { status } = await post(baseUrl, userB, `/conversations/${idA}/archive`, {});
    assert.equal(status, 404);
  });

  await t.test('POST /conversations/:id/continue reactivates an archived conversation and resets its expiry', async () => {
    const user = await createUser();
    const id1 = await store.createConversation(user.uuid);
    const id2 = await store.createConversation(user.uuid); // archives id1

    const { status, body } = await post(baseUrl, user, `/conversations/${id1}/continue`, {});
    assert.equal(status, 200);
    assert.equal(body.data.conversation.active, true);
    assert.equal(body.data.conversation.archived_at, null);
    assert.equal(body.data.conversation.expires_at, null);

    // Only one active conversation may exist -- continuing id1 must have archived id2.
    const { body: conv2 } = await get(baseUrl, user, `/conversations/${id2}`);
    assert.equal(conv2.data.conversation.active, false);
  });

  await t.test('POST /conversations/:id/continue 404s for another user\'s conversation', async () => {
    const userA = await createUser();
    const userB = await createUser();
    const idA = await store.createConversation(userA.uuid);
    await store.archiveConversation(userA.uuid, idA);

    const { status } = await post(baseUrl, userB, `/conversations/${idA}/continue`, {});
    assert.equal(status, 404);
  });

  // ---- delete ----

  await t.test('DELETE /conversations/:id removes the conversation, its messages, and its resolutions', async () => {
    const user = await createUser();
    const id = await store.createConversation(user.uuid);
    await store.appendMessage(user.uuid, id, 'm1', 'user', [{ type: 'text', text: 'hi' }]);
    await store.saveResolution(user.uuid, id, 'call_1', 'entry', 'confirmed', 'Banana');

    const { status, body } = await del(baseUrl, user, `/conversations/${id}`);
    assert.equal(status, 200);
    assert.equal(body.message, `Conversation ${id} deleted`);

    const { status: getStatus } = await get(baseUrl, user, `/conversations/${id}`);
    assert.equal(getStatus, 404);

    const [msgRows] = await pool.query('SELECT * FROM chat_messages WHERE conversation_id = ?', [id]);
    const [resRows] = await pool.query('SELECT * FROM proposal_resolutions WHERE conversation_id = ?', [id]);
    assert.equal(msgRows.length, 0);
    assert.equal(resRows.length, 0);
  });

  await t.test('DELETE /conversations/:id 404s for another user\'s conversation and leaves it intact', async () => {
    const userA = await createUser();
    const userB = await createUser();
    const idA = await store.createConversation(userA.uuid);

    const { status } = await del(baseUrl, userB, `/conversations/${idA}`);
    assert.equal(status, 404);

    const { status: getStatus } = await get(baseUrl, userA, `/conversations/${idA}`);
    assert.equal(getStatus, 200);
  });

  // ---- proposal resolutions ----

  await t.test('POST then GET /conversations/:id/resolutions round-trips a resolution', async () => {
    const user = await createUser();
    const id = await store.createConversation(user.uuid);

    const postResult = await post(baseUrl, user, `/conversations/${id}/resolutions`, {
      toolCallId: 'call_abc',
      kind: 'entry',
      status: 'confirmed',
      displayName: 'Logged: Apple',
    });
    assert.equal(postResult.status, 204);

    const { status, body } = await get(baseUrl, user, `/conversations/${id}/resolutions`);
    assert.equal(status, 200);
    assert.deepEqual(body.data, [
      { tool_call_id: 'call_abc', kind: 'entry', status: 'confirmed', display_name: 'Logged: Apple', result: null },
    ]);
  });

  await t.test('POST /conversations/:id/resolutions accepts and round-trips a structured result', async () => {
    const user = await createUser();
    const id = await store.createConversation(user.uuid);

    const postResult = await post(baseUrl, user, `/conversations/${id}/resolutions`, {
      toolCallId: 'call_batch_1',
      kind: 'batch',
      status: 'confirmed',
      displayName: 'Push Day: Bench Press',
      result: [{ ref: 'sec1', id: 501 }, { ref: 'ex1', id: 502 }],
    });
    assert.equal(postResult.status, 204);

    const { status, body } = await get(baseUrl, user, `/conversations/${id}/resolutions`);
    assert.equal(status, 200);
    assert.deepEqual(body.data[0].result, [{ ref: 'sec1', id: 501 }, { ref: 'ex1', id: 502 }]);
  });

  await t.test('POST /conversations/:id/resolutions accepts any resource kind, not just nutrition\'s original two', async () => {
    // kind is a free-form resource tag as of migrations/024_generalize_proposal_kind.sql
    // (e.g. body_weight_entry.delete) -- not limited to 'entry'/'custom_food'.
    const user = await createUser();
    const id = await store.createConversation(user.uuid);

    const { status } = await post(baseUrl, user, `/conversations/${id}/resolutions`, {
      toolCallId: 'call_abc',
      kind: 'body_weight_entry.delete',
      status: 'confirmed',
    });
    assert.equal(status, 204);

    const { body } = await get(baseUrl, user, `/conversations/${id}/resolutions`);
    assert.equal(body.data[0].kind, 'body_weight_entry.delete');
  });

  await t.test('POST /conversations/:id/resolutions rejects a non-string kind', async () => {
    const user = await createUser();
    const id = await store.createConversation(user.uuid);

    const { status, body } = await post(baseUrl, user, `/conversations/${id}/resolutions`, {
      toolCallId: 'call_abc',
      kind: 123,
      status: 'confirmed',
    });
    assert.equal(status, 400);
    assert.equal(body.message, 'kind must be a non-empty string of at most 32 characters');
  });

  await t.test('resolutions endpoints 404 for another user\'s conversation', async () => {
    const userA = await createUser();
    const userB = await createUser();
    const idA = await store.createConversation(userA.uuid);

    const getResult = await get(baseUrl, userB, `/conversations/${idA}/resolutions`);
    assert.equal(getResult.status, 404);

    const postResult = await post(baseUrl, userB, `/conversations/${idA}/resolutions`, {
      toolCallId: 'call_x',
      kind: 'entry',
      status: 'confirmed',
    });
    assert.equal(postResult.status, 404);
  });
});
