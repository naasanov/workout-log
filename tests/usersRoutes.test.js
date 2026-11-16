// routes/users.ts exposes only the caller's own account: no listing, lookup,
// update or delete of other users, and no password hash in any response.
//
// Run with: DB_NAME=workout_log_test_users node --test tests/usersRoutes.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../scripts/testDb');

test('users routes', async (t) => {
  const available = await db.isDbReachable();
  if (!available) {
    t.skip('No reachable database on 127.0.0.1:3307. Start it with: docker compose up -d, then npm run db:setup (see scripts/testDb.js).');
    return;
  }

  await db.setupTestDb();
  const users = db.requireTs('routes/users.ts').default;
  const { server, baseUrl } = await db.startTestServer('/api/users', users);

  t.beforeEach(async () => {
    await db.resetDb();
  });

  t.after(async () => {
    await db.stopTestServer(server);
    await db.closePool();
  });

  await t.test('GET / returns the caller without a password field', async () => {
    const user = await db.createTestUser();
    const res = await fetch(`${baseUrl}/api/users`, { headers: user.authHeader() });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body.data, { uuid: user.uuid, email: user.email });
  });

  await t.test('cross-user and legacy routes are gone', async () => {
    const me = await db.createTestUser();
    const other = await db.createTestUser();
    const json = { 'Content-Type': 'application/json', ...me.authHeader() };
    const calls = [
      ['GET', '/all'],
      ['GET', `/email/${encodeURIComponent(other.email)}`],
      ['GET', `/uuid/${other.uuid}`],
      ['DELETE', `/${other.uuid}`],
      ['PATCH', '', { password: 'plaintext' }],
      ['POST', '', { email: 'new@example.com', password: 'x' }],
    ];
    for (const [method, path, body] of calls) {
      const res = await fetch(`${baseUrl}/api/users${path}`, {
        method,
        headers: json,
        body: body ? JSON.stringify(body) : undefined,
      });
      assert.equal(res.status, 404, `${method} /api/users${path}`);
    }

    // The other account still exists and the caller's password is unchanged.
    const res = await fetch(`${baseUrl}/api/users`, { headers: other.authHeader() });
    assert.equal(res.status, 200);
    const [[row]] = await db.getPool().query('SELECT password FROM users WHERE email = ?', [me.email]);
    assert.notEqual(row.password, 'plaintext');
  });
});
