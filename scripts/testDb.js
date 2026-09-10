// Test database harness for route-level characterization tests under tests/*.test.js.
//
// Uses a separate schema (workout_log_test) on the SAME MySQL container that
// docker-compose.yml / DB_PORT=3307 already point at, rather than a second
// container or host port -- other Claude sessions share this Docker daemon
// and its ports, so a second published port would collide.
//
// All of this only takes effect if the relevant DB_* env vars are not already
// set by the caller, so `npm test` still works unmodified in CI/dev setups
// that configure their own env.
'use strict';

const path = require('path');
const { execFileSync } = require('child_process');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');

const REPO_ROOT = path.join(__dirname, '..');

const TEST_DB_DEFAULTS = {
  DB_HOST: '127.0.0.1',
  DB_PORT: '3307',
  // root, not the `dev` app user: creating/dropping the workout_log_test schema
  // requires privileges dev (scoped to `workout_log` only) does not have.
  DB_USERNAME: 'root',
  DB_PASSWORD: 'root',
  DB_NAME: 'workout_log_test',
  ACCESS_TOKEN_SECRET: 'test-access-token-secret',
  REFRESH_TOKEN_SECRET: 'test-refresh-token-secret',
};

function applyTestEnv() {
  // JAWSDB_URL takes precedence in database.ts, so a leaked production-style
  // env var would silently redirect tests at a real database. Never test against that.
  delete process.env.JAWSDB_URL;
  for (const [key, value] of Object.entries(TEST_DB_DEFAULTS)) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

let tsNodeRegistered = false;
function requireTs(modulePath) {
  if (!tsNodeRegistered) {
    require('ts-node').register({ transpileOnly: true });
    tsNodeRegistered = true;
  }
  const resolved = path.isAbsolute(modulePath) ? modulePath : path.join(REPO_ROOT, modulePath);
  return require(resolved);
}

// Lazily loaded so requiring this module never itself requires mysql2/express
// before applyTestEnv() has had a chance to run.
function getPool() {
  applyTestEnv();
  return requireTs(path.join(REPO_ROOT, 'database.ts')).default;
}

async function isDbReachable() {
  applyTestEnv();
  const mysql = require('mysql2/promise');
  let conn;
  try {
    conn = await mysql.createConnection({
      host: process.env.DB_HOST,
      port: parseInt(process.env.DB_PORT, 10),
      user: process.env.DB_USERNAME,
      password: process.env.DB_PASSWORD,
      connectTimeout: 2000,
    });
    await conn.ping();
    return true;
  } catch {
    return false;
  } finally {
    if (conn) await conn.end().catch(() => {});
  }
}

async function ensureSchemaExists() {
  applyTestEnv();
  const mysql = require('mysql2/promise');
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT, 10),
    user: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
  });
  try {
    await conn.query(`CREATE DATABASE IF NOT EXISTS \`${process.env.DB_NAME}\``);
  } finally {
    await conn.end();
  }
}

// Destructive helpers below create schemas and truncate every table, so the
// target must be a dedicated test schema. Callers that set DB_NAME themselves
// keep control, but never at the cost of pointing this at dev or production.
function assertTestSchema() {
  applyTestEnv();
  // A trailing suffix is allowed so concurrent runs can each take their own
  // schema (workout_log_test_habits and so on) without truncating each other.
  const name = process.env.DB_NAME;
  if (!name || !/_test(_|$)/.test(name)) {
    throw new Error(
      `Refusing to run destructive test setup against DB_NAME="${name}". ` +
        'The test schema name must contain "_test".',
    );
  }
}

// Runs the exact same scripts/migrate.js used for dev/production, as a child
// process pointed at the test schema, so migration behavior is never reimplemented.
function runMigrations() {
  applyTestEnv();
  execFileSync('node', ['scripts/migrate.js'], {
    cwd: REPO_ROOT,
    env: process.env,
    stdio: 'pipe',
  });
}

// Full one-time setup: create the schema if absent and bring it up to date.
// Safe to call repeatedly -- migrate.js already tracks applied migrations.
async function setupTestDb() {
  assertTestSchema();
  await ensureSchemaExists();
  runMigrations();
}

// Empties every table in the test schema except schema_migrations, so each
// test starts from an empty-but-migrated database. FK checks are toggled off
// for the duration so table order doesn't matter.
//
// DELETE, not TRUNCATE: TRUNCATE drops/recreates each InnoDB tablespace even
// when empty (~46ms/table) while DELETE costs ~45ms for the whole schema.
// Ids do not reset between tests within a file as a result; no test may rely on one starting at 1.
async function resetDb() {
  assertTestSchema();
  const pool = getPool();
  const [rows] = await pool.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = ? AND table_name != 'schema_migrations'`,
    [process.env.DB_NAME]
  );
  await pool.query('SET FOREIGN_KEY_CHECKS = 0');
  for (const row of rows) {
    const table = row.table_name ?? row.TABLE_NAME;
    await pool.query(`DELETE FROM \`${table}\``);
  }
  await pool.query('SET FOREIGN_KEY_CHECKS = 1');
}

// Mirrors auth.ts's generateAccessToken (same secret env var, same payload
// shape, same expiry) without importing it, since it isn't exported.
function signAccessToken(uuid) {
  applyTestEnv();
  return jwt.sign({ uuid }, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '15m' });
}

// Inserts a user directly (bypassing the signup route) and returns its uuid,
// credentials, and a ready-to-use bearer token for route tests.
async function createTestUser({ email, password = 'password123' } = {}) {
  const pool = getPool();
  const uniqueEmail = email ?? `test-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const hashed = await bcrypt.hash(password, 10);

  await pool.query('INSERT INTO users (email, password) VALUES (?, ?)', [uniqueEmail, hashed]);
  const [[row]] = await pool.query(
    'SELECT BIN_TO_UUID(user_uuid) as uuid FROM users WHERE email = ?',
    [uniqueEmail]
  );

  return {
    uuid: row.uuid,
    email: uniqueEmail,
    password,
    token: signAccessToken(row.uuid),
    authHeader: () => ({ Authorization: `Bearer ${signAccessToken(row.uuid)}` }),
  };
}

// Mounts a router (already `require`d/transpiled by the caller via requireTs)
// on a fresh express() app and starts it on an ephemeral port. index.ts is
// left untouched -- this rebuilds just enough of the app for one router.
async function startTestServer(mountPath, router) {
  const express = require('express');
  const app = express();
  app.use(express.json());
  app.use(mountPath, router);

  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();
  return { server, baseUrl: `http://127.0.0.1:${port}` };
}

function stopTestServer(server) {
  return new Promise((resolve) => server.close(resolve));
}

async function closePool() {
  const pool = getPool();
  await pool.end();
}

module.exports = {
  applyTestEnv,
  requireTs,
  getPool,
  isDbReachable,
  setupTestDb,
  resetDb,
  createTestUser,
  signAccessToken,
  startTestServer,
  stopTestServer,
  closePool,
};
