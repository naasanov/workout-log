// Feedback launched from an agent chat carries a chatId: it must be a positive
// integer, lands in the GitHub issue body, and makes the message optional.
// Skipped when no database is reachable.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../scripts/testDb');

test('feedback chatId', async (t) => {
  if (!(await db.isDbReachable())) {
    t.skip('No reachable database. See scripts/testDb.js.');
    return;
  }
  await db.setupTestDb();

  const express = require('express');
  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.use('/api/feedback', db.requireTs('routes/feedback.ts').default);
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const originalFetch = global.fetch;
  const originalToken = process.env.GITHUB_TOKEN;
  let issues = [];
  global.fetch = async (url, init) => {
    const href = typeof url === 'string' ? url : String(url?.url ?? url);
    if (href.startsWith('https://api.github.com/')) {
      issues.push(JSON.parse(init.body));
      return new Response(JSON.stringify({ number: 7 }), { status: 201 });
    }
    return originalFetch(url, init);
  };
  process.env.GITHUB_TOKEN = 'test-token';

  t.beforeEach(async () => {
    await db.resetDb();
    issues = [];
  });
  t.after(async () => {
    global.fetch = originalFetch;
    if (originalToken === undefined) delete process.env.GITHUB_TOKEN;
    else process.env.GITHUB_TOKEN = originalToken;
    await db.stopTestServer(server);
    await db.closePool();
  });

  async function post(user, body) {
    const res = await originalFetch(`${baseUrl}/api/feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...user.authHeader() },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  }

  await t.test('chatId and message both appear in the issue body', async () => {
    const user = await db.createTestUser();
    const { status } = await post(user, { chatId: 123, message: 'The agent got confused.' });
    assert.equal(status, 200);
    assert.match(issues[0].body, /\*\*Chat ID:\*\* 123/);
    assert.match(issues[0].body, /The agent got confused\./);
  });

  await t.test('chatId without a message is accepted and still in the issue', async () => {
    const user = await db.createTestUser();
    const { status } = await post(user, { chatId: 55 });
    assert.equal(status, 200);
    assert.match(issues[0].body, /\*\*Chat ID:\*\* 55/);
    assert.match(issues[0].title, /Chat #55 feedback/);
  });

  await t.test('empty message without a chatId is still rejected', async () => {
    const user = await db.createTestUser();
    const { status, body } = await post(user, { message: '' });
    assert.equal(status, 400);
    assert.match(body.message, /add a message/i);
  });

  await t.test('invalid chatId values are rejected', async () => {
    const user = await db.createTestUser();
    for (const chatId of [0, -3, 1.5, '12', null, 'abc']) {
      const { status } = await post(user, { chatId, message: 'hi there' });
      assert.equal(status, 400, `chatId ${JSON.stringify(chatId)}`);
    }
    assert.equal(issues.length, 0);
  });
});
