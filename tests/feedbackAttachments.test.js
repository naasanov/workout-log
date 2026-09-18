// Covers the self-hosted feedback-attachment flow (#358): screenshots are
// saved in feedback_attachments and served back publicly by an unguessable
// token, instead of being committed to a GitHub branch the token can't write
// to. Exercises real HTTP requests through the actual routers against a real
// MySQL schema (see scripts/testDb.js) rather than mocking pool.query.
//
// Mounts routes/feedbackAttachments.ts ahead of routes/feedback.ts, same
// order as index.ts, so the public route is reachable before
// authenticateToken (installed by feedback.ts's router.use) ever runs.
//
// Requires a reachable database. If none is reachable, every test here is
// skipped (not failed) so `npm test` still passes without Docker running.
//
// Run with: DB_NAME=workout_log_test_feedbackimg node --test tests/feedbackAttachments.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../scripts/testDb');

// A valid 1x1 transparent PNG, well under the 5MB attachment cap.
const PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

async function startFeedbackServer() {
  const express = require('express');
  const feedback = db.requireTs('routes/feedback.ts').default;
  const feedbackAttachments = db.requireTs('routes/feedbackAttachments.ts').default;

  const app = express();
  app.use(express.json({ limit: '10mb' }));
  // Mirrors index.ts: the public router is mounted ahead of the
  // authenticated one so its route wins the match before auth runs.
  app.use('/api/feedback/attachments', feedbackAttachments);
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

test('feedback attachment self-hosting', async (t) => {
  const available = await db.isDbReachable();
  if (!available) {
    t.skip('No reachable database on 127.0.0.1:3307. Start it with: docker compose up -d, then npm run db:setup (see scripts/testDb.js).');
    return;
  }

  await db.setupTestDb();
  // No GITHUB_TOKEN: createGithubIssue returns immediately, so issue
  // creation is a no-op and never makes a real network call in tests.
  delete process.env.GITHUB_TOKEN;
  const { server, baseUrl } = await startFeedbackServer();

  t.beforeEach(async () => {
    await db.resetDb();
  });

  t.after(async () => {
    await db.stopTestServer(server);
    await db.closePool();
  });

  await t.test('POST / with an attachment stores it under a public token', async () => {
    const user = await db.createTestUser();
    const { status } = await submitFeedback(baseUrl, user, {
      message: 'Something looks off here.',
      attachments: [PNG_DATA_URL],
    });
    assert.equal(status, 200);

    const pool = db.getPool();
    const [rows] = await pool.query(
      `SELECT fa.public_token, fa.mime_type
       FROM feedback_attachments fa
       JOIN feedback f ON f.id = fa.feedback_id
       WHERE f.user_uuid = UUID_TO_BIN(?)`,
      [user.uuid],
    );
    assert.equal(rows.length, 1);
    assert.match(rows[0].public_token, /^[0-9a-f]{32}$/);
    assert.equal(rows[0].mime_type, 'image/png');
  });

  await t.test('GET /attachments/:token returns the identical bytes and content type without auth', async () => {
    const user = await db.createTestUser();
    await submitFeedback(baseUrl, user, {
      message: 'Screenshot attached.',
      attachments: [PNG_DATA_URL],
    });

    const pool = db.getPool();
    const [[row]] = await pool.query(
      `SELECT fa.public_token
       FROM feedback_attachments fa
       JOIN feedback f ON f.id = fa.feedback_id
       WHERE f.user_uuid = UUID_TO_BIN(?)`,
      [user.uuid],
    );

    // Deliberately no Authorization header: GitHub's image proxy fetches this unauthenticated.
    const res = await fetch(`${baseUrl}/api/feedback/attachments/${row.public_token}`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'image/png');
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.match(res.headers.get('cache-control') ?? '', /immutable/);

    const expectedBytes = Buffer.from(PNG_DATA_URL.slice(PNG_DATA_URL.indexOf(',') + 1), 'base64');
    const actualBytes = Buffer.from(await res.arrayBuffer());
    assert.ok(actualBytes.equals(expectedBytes));
  });

  await t.test('GET /attachments/:token 404s for a well-formed but unknown token', async () => {
    const res = await fetch(`${baseUrl}/api/feedback/attachments/${'a'.repeat(32)}`);
    assert.equal(res.status, 404);
  });

  await t.test('GET /attachments/:token 404s for a malformed token', async () => {
    const tooShort = await fetch(`${baseUrl}/api/feedback/attachments/abc123`);
    assert.equal(tooShort.status, 404);

    const notHex = await fetch(`${baseUrl}/api/feedback/attachments/${'z'.repeat(32)}`);
    assert.equal(notHex.status, 404);

    const pathTraversal = await fetch(`${baseUrl}/api/feedback/attachments/${encodeURIComponent('../auth')}`);
    assert.equal(pathTraversal.status, 404);
  });

  await t.test('other /api/feedback routes still require auth', async () => {
    const postRes = await fetch(`${baseUrl}/api/feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'no auth header' }),
    });
    assert.equal(postRes.status, 401);
    const postBody = await postRes.json();
    assert.equal(postBody.message, 'Unauthorized: access token required');

    const myIssuesRes = await fetch(`${baseUrl}/api/feedback/my-issues`);
    assert.equal(myIssuesRes.status, 401);
  });
});
