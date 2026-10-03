// Covers #397: a GitHub issue that can't be created (expired token, network
// error, bad response shape) must surface as an error to the user instead of
// the usual 200 "Thank you!" — while the feedback row itself, saved before
// GitHub is ever contacted, is never rolled back.
//
// Stubs global fetch only for requests to api.github.com; every other
// request (including this test's own calls into the local server started
// below) goes through the real fetch untouched.
//
// Requires a reachable database. If none is reachable, every test here is
// skipped (not failed) so `npm test` still passes without Docker running.
//
// Run with: DB_NAME=workout_log_test_feedback node --test tests/feedbackGithubFailure.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../scripts/testDb');

async function startFeedbackServer() {
  const express = require('express');
  const feedback = db.requireTs('routes/feedback.ts').default;

  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.use('/api/feedback', feedback);

  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();
  return { server, baseUrl: `http://127.0.0.1:${port}` };
}

async function submitFeedback(baseUrl, user, body) {
  const res = await fetch(`${baseUrl}/api/feedback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...user.authHeader() },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

async function issueNumberFor(pool, uuid) {
  const [rows] = await pool.query(
    `SELECT issue_number FROM feedback WHERE user_uuid = UUID_TO_BIN(?)`,
    [uuid],
  );
  return rows;
}

test('feedback GitHub issue creation failure', async (t) => {
  const available = await db.isDbReachable();
  if (!available) {
    t.skip('No reachable database on 127.0.0.1:3307. Start it with: docker compose up -d, then npm run db:setup (see scripts/testDb.js).');
    return;
  }

  await db.setupTestDb();

  const originalFetch = global.fetch;
  const originalToken = process.env.GITHUB_TOKEN;

  // Swapped per-test to control what api.github.com "returns". Every other
  // URL — in particular this test's own requests to the local server above —
  // is passed straight through to the real fetch.
  let githubHandler = null;
  global.fetch = (url, init) => {
    const href = typeof url === 'string' ? url : (url?.url ?? String(url));
    if (href.startsWith('https://api.github.com/')) {
      return githubHandler(url, init);
    }
    return originalFetch(url, init);
  };

  const { server, baseUrl } = await startFeedbackServer();

  t.beforeEach(async () => {
    await db.resetDb();
    githubHandler = null;
  });

  t.after(async () => {
    global.fetch = originalFetch;
    if (originalToken === undefined) delete process.env.GITHUB_TOKEN;
    else process.env.GITHUB_TOKEN = originalToken;
    await db.stopTestServer(server);
    await db.closePool();
  });

  await t.test('GitHub 401 (expired token) -> 502 with a user-readable message, feedback row kept with issue_number NULL', async () => {
    process.env.GITHUB_TOKEN = 'expired-test-token';
    githubHandler = async () => new Response(JSON.stringify({ message: 'Bad credentials' }), { status: 401 });

    const user = await db.createTestUser();
    const { status, body } = await submitFeedback(baseUrl, user, { message: 'Something looks off here.' });
    assert.equal(status, 502);
    assert.match(body.message, /try again/i);

    const pool = db.getPool();
    const rows = await issueNumberFor(pool, user.uuid);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].issue_number, null);
  });

  await t.test('GitHub success -> 200, issue_number recorded on the feedback row', async () => {
    process.env.GITHUB_TOKEN = 'valid-test-token';
    githubHandler = async () => new Response(JSON.stringify({ number: 4242 }), { status: 201 });

    const user = await db.createTestUser();
    const { status, body } = await submitFeedback(baseUrl, user, { message: 'This works great!' });
    assert.equal(status, 200);
    assert.equal(body.message, 'Feedback received. Thank you!');

    const pool = db.getPool();
    const rows = await issueNumberFor(pool, user.uuid);
    assert.equal(rows.length, 1);
    assert.equal(typeof rows[0].issue_number, 'number');
  });

  await t.test('response missing a number -> 502, issue_number stays NULL', async () => {
    process.env.GITHUB_TOKEN = 'valid-test-token';
    githubHandler = async () => new Response(JSON.stringify({ html_url: 'https://github.com/x/y/issues/1' }), { status: 201 });

    const user = await db.createTestUser();
    const { status } = await submitFeedback(baseUrl, user, { message: 'Weird response shape.' });
    assert.equal(status, 502);

    const pool = db.getPool();
    const rows = await issueNumberFor(pool, user.uuid);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].issue_number, null);
  });

  await t.test('network error talking to GitHub -> 502, feedback row kept', async () => {
    process.env.GITHUB_TOKEN = 'valid-test-token';
    githubHandler = async () => { throw new Error('getaddrinfo ENOTFOUND api.github.com'); };

    const user = await db.createTestUser();
    const { status } = await submitFeedback(baseUrl, user, { message: 'Network is down.' });
    assert.equal(status, 502);

    const pool = db.getPool();
    const rows = await issueNumberFor(pool, user.uuid);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].issue_number, null);
  });

  await t.test('no GITHUB_TOKEN -> 200, no GitHub call made, no issue_number', async () => {
    delete process.env.GITHUB_TOKEN;
    githubHandler = async () => { throw new Error('must not call GitHub when GITHUB_TOKEN is unset'); };

    const user = await db.createTestUser();
    const { status, body } = await submitFeedback(baseUrl, user, { message: 'No token configured.' });
    assert.equal(status, 200);
    assert.equal(body.message, 'Feedback received. Thank you!');

    const pool = db.getPool();
    const rows = await issueNumberFor(pool, user.uuid);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].issue_number, null);
  });
});
