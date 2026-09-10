// Tests for scripts/migrate.js: the statement splitter (pure, no DB needed)
// and the release-phase apply/exit-code behavior (spawned as a real child
// process against a scratch schema, mirroring how Heroku's release phase and
// scripts/testDb.js both invoke it).
//
// Requires a reachable database (see scripts/testDb.js). If none is
// reachable, every DB-backed test here is skipped (not failed).
//
// Run with: node --test tests/migrate.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { spawnSync } = require('child_process');
const mysql = require('mysql2/promise');
const db = require('../scripts/testDb');
const { splitStatements } = require('../scripts/migrate');

const REPO_ROOT = path.join(__dirname, '..');
const REAL_MIGRATIONS_DIR = path.join(REPO_ROOT, 'migrations');

// Dedicated scratch schema for this file only -- never the shared
// workout_log_test(_migrate) schema other test files migrate and query.
const SCRATCH_DB = 'workout_log_test_migrate_scratch';

test('splitStatements', async (t) => {
  await t.test('splits plain statements on semicolons', () => {
    const stmts = splitStatements('SELECT 1; SELECT 2;');
    assert.deepEqual(stmts, ['SELECT 1', 'SELECT 2']);
  });

  await t.test('a semicolon inside a -- line comment does not split the statement', () => {
    const sql = 'CREATE TABLE foo (\n  id INT -- default; still one statement\n);';
    const stmts = splitStatements(sql);
    assert.equal(stmts.length, 1);
    assert.match(stmts[0], /CREATE TABLE foo/);
  });

  await t.test('a semicolon inside a /* */ block comment does not split the statement', () => {
    const sql = 'CREATE TABLE foo (/* a; b */ id INT);';
    const stmts = splitStatements(sql);
    assert.equal(stmts.length, 1);
  });

  await t.test('a semicolon inside a quoted COMMENT string does not split the statement', () => {
    const sql = "CREATE TABLE foo (\n  id INT COMMENT 'see foo; bar'\n);";
    const stmts = splitStatements(sql);
    assert.equal(stmts.length, 1);
    assert.match(stmts[0], /see foo; bar/);
  });

  await t.test('doubled single quotes inside a literal do not end the string early', () => {
    const sql = "INSERT INTO foo (name) VALUES ('it''s; fine');";
    const stmts = splitStatements(sql);
    assert.equal(stmts.length, 1);
  });

  await t.test('a backslash-escaped quote inside a literal does not end the string early', () => {
    const sql = "INSERT INTO foo (name) VALUES ('a\\'; b');";
    const stmts = splitStatements(sql);
    assert.equal(stmts.length, 1);
  });

  await t.test('a semicolon inside a double-quoted literal does not split the statement', () => {
    const sql = 'INSERT INTO foo (name) VALUES ("a; b");';
    const stmts = splitStatements(sql);
    assert.equal(stmts.length, 1);
  });

  await t.test('empty statements between stray semicolons are dropped', () => {
    const stmts = splitStatements('SELECT 1;;  ;SELECT 2;');
    assert.deepEqual(stmts, ['SELECT 1', 'SELECT 2']);
  });

  await t.test('a trailing statement with no closing semicolon is still included', () => {
    const stmts = splitStatements('SELECT 1; SELECT 2');
    assert.deepEqual(stmts, ['SELECT 1', 'SELECT 2']);
  });

  await t.test('throws loudly on DELIMITER instead of mangling the split', () => {
    const sql = 'DELIMITER $$\nCREATE PROCEDURE foo() BEGIN SELECT 1; END$$\nDELIMITER ;';
    assert.throws(() => splitStatements(sql));
  });
});

test('migrate.js apply/exit-code behavior', async (t) => {
  const available = await db.isDbReachable();
  if (!available) {
    t.skip('No reachable database on 127.0.0.1:3307. Start it with: docker compose up -d (see scripts/testDb.js).');
    return;
  }

  async function adminConnect() {
    db.applyTestEnv();
    return mysql.createConnection({
      host: process.env.DB_HOST,
      port: parseInt(process.env.DB_PORT, 10),
      user: process.env.DB_USERNAME,
      password: process.env.DB_PASSWORD,
    });
  }

  async function resetScratchSchema() {
    const conn = await adminConnect();
    try {
      await conn.query(`DROP DATABASE IF EXISTS \`${SCRATCH_DB}\``);
      await conn.query(`CREATE DATABASE \`${SCRATCH_DB}\``);
    } finally {
      await conn.end();
    }
  }

  async function withScratchConn(fn) {
    db.applyTestEnv();
    const conn = await mysql.createConnection({
      host: process.env.DB_HOST,
      port: parseInt(process.env.DB_PORT, 10),
      user: process.env.DB_USERNAME,
      password: process.env.DB_PASSWORD,
      database: SCRATCH_DB,
    });
    try {
      return await fn(conn);
    } finally {
      await conn.end();
    }
  }

  function runMigrate(migrationsDir) {
    db.applyTestEnv();
    const env = { ...process.env, DB_NAME: SCRATCH_DB, MIGRATIONS_DIR: migrationsDir };
    delete env.JAWSDB_URL;
    return spawnSync('node', ['scripts/migrate.js'], {
      cwd: REPO_ROOT,
      env,
      encoding: 'utf8',
    });
  }

  function writeFixture(dir, filename, sql) {
    fs.writeFileSync(path.join(dir, filename), sql, 'utf8');
  }

  function mkFixtureDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'migrate-test-'));
  }

  t.beforeEach(async () => {
    await resetScratchSchema();
  });

  t.after(async () => {
    const conn = await adminConnect();
    try {
      await conn.query(`DROP DATABASE IF EXISTS \`${SCRATCH_DB}\``);
    } finally {
      await conn.end();
    }
  });

  await t.test('migrations 001-023 from the real migrations directory all apply cleanly to a fresh schema', async () => {
    const realFiles = fs.readdirSync(REAL_MIGRATIONS_DIR).filter(f => f.endsWith('.sql'));
    const result = runMigrate(REAL_MIGRATIONS_DIR);
    assert.equal(result.status, 0, `migrate.js exited ${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);

    const [rows] = await withScratchConn(conn => conn.execute('SELECT filename FROM schema_migrations'));
    const recorded = new Set(rows.map(r => r.filename));
    for (const file of realFiles) {
      assert.ok(recorded.has(file), `expected ${file} to be recorded in schema_migrations`);
    }
  });

  await t.test('a comment containing a semicolon applies as one statement, not fragments', async () => {
    const dir = mkFixtureDir();
    writeFixture(dir, '001_comment_semicolon.sql', [
      '-- a note about defaults; do not treat this as a statement boundary',
      'CREATE TABLE widgets (',
      '  id INT AUTO_INCREMENT PRIMARY KEY,',
      '  name VARCHAR(64) NOT NULL',
      ');',
    ].join('\n'));

    const result = runMigrate(dir);
    assert.equal(result.status, 0, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);

    const [tables] = await withScratchConn(conn => conn.execute(
      "SELECT TABLE_NAME FROM information_schema.tables WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'widgets'",
      [SCRATCH_DB],
    ));
    assert.equal(tables.length, 1);
  });

  await t.test('a semicolon inside a quoted COMMENT string applies correctly', async () => {
    const dir = mkFixtureDir();
    writeFixture(dir, '001_quoted_comment.sql', [
      'CREATE TABLE widgets (',
      "  id INT AUTO_INCREMENT PRIMARY KEY COMMENT 'see foo; bar'",
      ');',
    ].join('\n'));

    const result = runMigrate(dir);
    assert.equal(result.status, 0, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);

    const [cols] = await withScratchConn(conn => conn.execute(
      "SELECT COLUMN_COMMENT FROM information_schema.columns WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'widgets' AND COLUMN_NAME = 'id'",
      [SCRATCH_DB],
    ));
    assert.equal(cols[0].COLUMN_COMMENT, 'see foo; bar');
  });

  await t.test('-- line comments and /* */ block comments are both handled in the same file', async () => {
    const dir = mkFixtureDir();
    writeFixture(dir, '001_mixed_comments.sql', [
      '-- top-of-file note; with a semicolon',
      'CREATE TABLE widgets (',
      '  /* inline note; with a semicolon */',
      '  id INT AUTO_INCREMENT PRIMARY KEY,',
      '  name VARCHAR(64) NOT NULL -- trailing note; with a semicolon',
      ');',
    ].join('\n'));

    const result = runMigrate(dir);
    assert.equal(result.status, 0, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);

    const [tables] = await withScratchConn(conn => conn.execute(
      "SELECT TABLE_NAME FROM information_schema.tables WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'widgets'",
      [SCRATCH_DB],
    ));
    assert.equal(tables.length, 1);
  });

  await t.test('a broken migration exits non-zero and is not recorded in schema_migrations', async () => {
    const dir = mkFixtureDir();
    writeFixture(dir, '001_broken.sql', [
      'CREATE TABLE widgets (id INT AUTO_INCREMENT PRIMARY KEY);',
      'THIS IS NOT VALID SQL;',
    ].join('\n'));

    const result = runMigrate(dir);
    assert.notEqual(result.status, 0);

    const [rows] = await withScratchConn(conn => conn.execute('SELECT filename FROM schema_migrations'));
    assert.deepEqual(rows.map(r => r.filename), []);
  });

  await t.test('a broken migration blocks any later file from running', async () => {
    const dir = mkFixtureDir();
    writeFixture(dir, '001_broken.sql', 'THIS IS NOT VALID SQL;');
    writeFixture(dir, '002_would_succeed.sql', 'CREATE TABLE widgets (id INT AUTO_INCREMENT PRIMARY KEY);');

    const result = runMigrate(dir);
    assert.notEqual(result.status, 0);

    const [tables] = await withScratchConn(conn => conn.execute(
      "SELECT TABLE_NAME FROM information_schema.tables WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'widgets'",
      [SCRATCH_DB],
    ));
    assert.equal(tables.length, 0, 'the later, independently-valid file must not have run');
  });

  await t.test('re-running after a successful apply is a no-op (the file is skipped)', async () => {
    const dir = mkFixtureDir();
    writeFixture(dir, '001_widgets.sql', 'CREATE TABLE widgets (id INT AUTO_INCREMENT PRIMARY KEY);');

    const first = runMigrate(dir);
    assert.equal(first.status, 0, `stdout:\n${first.stdout}\nstderr:\n${first.stderr}`);

    const second = runMigrate(dir);
    assert.equal(second.status, 0, `stdout:\n${second.stdout}\nstderr:\n${second.stderr}`);
    assert.match(second.stdout, /skip\s+001_widgets\.sql/);

    const [rows] = await withScratchConn(conn => conn.execute('SELECT filename FROM schema_migrations'));
    assert.deepEqual(rows.map(r => r.filename), ['001_widgets.sql']);
  });

  await t.test('errno 1050 (table exists) is tolerated as a warning and the file is recorded', async () => {
    const dir = mkFixtureDir();
    writeFixture(dir, '001_create.sql', 'CREATE TABLE widgets (id INT AUTO_INCREMENT PRIMARY KEY);');
    const first = runMigrate(dir);
    assert.equal(first.status, 0, `stdout:\n${first.stdout}\nstderr:\n${first.stderr}`);

    // No IF NOT EXISTS: creating the same table again raises errno 1050.
    writeFixture(dir, '002_recreate.sql', 'CREATE TABLE widgets (id INT AUTO_INCREMENT PRIMARY KEY);');
    const second = runMigrate(dir);
    assert.equal(second.status, 0, `stdout:\n${second.stdout}\nstderr:\n${second.stderr}`);
    assert.match(second.stdout, /warn\s+002_recreate\.sql/);

    const [rows] = await withScratchConn(conn => conn.execute('SELECT filename FROM schema_migrations'));
    assert.deepEqual(rows.map(r => r.filename).sort(), ['001_create.sql', '002_recreate.sql']);
  });

  await t.test('errno 1060 (duplicate column) is tolerated as a warning and the file is recorded', async () => {
    const dir = mkFixtureDir();
    writeFixture(dir, '001_create.sql', 'CREATE TABLE widgets (id INT AUTO_INCREMENT PRIMARY KEY);');
    const first = runMigrate(dir);
    assert.equal(first.status, 0, `stdout:\n${first.stdout}\nstderr:\n${first.stderr}`);

    // id already exists: adding it again raises errno 1060.
    writeFixture(dir, '002_dup_column.sql', 'ALTER TABLE widgets ADD COLUMN id INT;');
    const second = runMigrate(dir);
    assert.equal(second.status, 0, `stdout:\n${second.stdout}\nstderr:\n${second.stderr}`);
    assert.match(second.stdout, /warn\s+002_dup_column\.sql/);

    const [rows] = await withScratchConn(conn => conn.execute('SELECT filename FROM schema_migrations'));
    assert.deepEqual(rows.map(r => r.filename).sort(), ['001_create.sql', '002_dup_column.sql']);
  });
});
