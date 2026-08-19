// Unit tests for the DB-orchestration half of scripts/redactOldChatImages.js
// that doesn't require a real database connection: cutoff-date math, and the
// OPTIMIZE TABLE catch-22 handling (occurrence 2 of the chat_messages
// storage incident — see that file's header for the full story). Uses fake
// `pool` objects (just an object with a `query` method) rather than a real
// mysql2 pool, the same way the row-scan loops only ever call `pool.query`.
//
// The row-scan passes themselves (runImageRedactionPass/
// runToolPayloadTrimPass) are exercised end-to-end against the local dev DB
// as part of manual/PR verification (see PR description) rather than here,
// since faking mysql2's query() well enough to be a meaningful test of the
// SQL itself would mostly just be re-testing the fake. What IS unit-tested
// here is the malformed-JSON-row tolerance, using a fake pool that returns a
// non-JSON `parts` value, to confirm a single bad row can't crash the job.
//
// Run with: node --test scripts/redactOldChatImages.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  hoursAgo,
  daysAgo,
  toMysqlDatetime,
  envPositiveInt,
  optimizeTable,
  runImageRedactionPass,
  runToolPayloadTrimPass,
} = require('./redactOldChatImages');

test('hoursAgo/daysAgo/toMysqlDatetime compute the expected UTC cutoff', () => {
  const now = new Date('2026-08-19T15:30:00.000Z');
  assert.equal(toMysqlDatetime(hoursAgo(now, 6)), '2026-08-19 09:30:00');
  assert.equal(toMysqlDatetime(daysAgo(now, 7)), '2026-08-12 15:30:00');
});

test('envPositiveInt falls back on unset, empty, non-numeric, zero, or negative values', () => {
  const cases = [undefined, '', 'abc', '0', '-5'];
  for (const raw of cases) {
    delete process.env.TEST_RETENTION_VAR;
    if (raw !== undefined) process.env.TEST_RETENTION_VAR = raw;
    assert.equal(envPositiveInt('TEST_RETENTION_VAR', 6), 6, `input ${JSON.stringify(raw)}`);
  }
  delete process.env.TEST_RETENTION_VAR;
});

test('envPositiveInt uses a valid positive override', () => {
  process.env.TEST_RETENTION_VAR = '12';
  assert.equal(envPositiveInt('TEST_RETENTION_VAR', 6), 12);
  delete process.env.TEST_RETENTION_VAR;
});

// --- optimizeTable: the catch-22 path -----------------------------------
//
// This is the part of the fix that CANNOT be exercised against the local
// dev DB (revoking INSERT locally isn't practical), so per the acceptance
// criteria it's proven here instead: a fake pool whose query() throws a
// simulated ER_TABLEACCESS_DENIED_ERROR, exactly as mysql2 would surface a
// real 1142 from a quota-revoked JawsDB instance.

function fakeLogger() {
  const calls = { log: [], error: [] };
  return {
    calls,
    log: (...args) => calls.log.push(args),
    error: (...args) => calls.error.push(args),
  };
}

test('optimizeTable catches ER_TABLEACCESS_DENIED_ERROR, logs an actionable message, and does not throw', async () => {
  const err = new Error('INSERT command denied to user \'app\'@\'%\' for table \'chat_messages\'');
  err.code = 'ER_TABLEACCESS_DENIED_ERROR';
  err.errno = 1142;
  const pool = { query: async () => { throw err; } };
  const log = fakeLogger();

  const result = await optimizeTable(pool, log);

  assert.deepEqual(result, { ok: false, reason: 'insert_privilege_revoked' });
  assert.equal(log.calls.error.length, 1);
  const message = log.calls.error[0][0];
  assert.match(message, /catch-22/);
  assert.match(message, /OPTIMIZE TABLE/);
  assert.match(message, /TRUNCATE|DELETE|plan upgrade/);
});

test('optimizeTable succeeds and logs when the query succeeds', async () => {
  let ranQuery = null;
  const pool = { query: async (sql) => { ranQuery = sql; return [{}]; } };
  const log = fakeLogger();

  const result = await optimizeTable(pool, log);

  assert.deepEqual(result, { ok: true });
  assert.match(ranQuery, /OPTIMIZE TABLE chat_messages/);
  assert.equal(log.calls.log.length, 1);
  assert.equal(log.calls.error.length, 0);
});

test('optimizeTable rethrows unexpected (non-privilege) errors rather than swallowing them', async () => {
  const err = new Error('connection lost');
  err.code = 'PROTOCOL_CONNECTION_LOST';
  const pool = { query: async () => { throw err; } };
  const log = fakeLogger();

  await assert.rejects(() => optimizeTable(pool, log), /connection lost/);
});

// --- row-scan passes: malformed parts tolerance --------------------------

test('runImageRedactionPass skips a row with unparseable parts instead of throwing', async () => {
  const pool = {
    query: async (sql) => {
      if (sql.startsWith('SELECT')) {
        return [[
          { id: 1, parts: 'not valid json{{{' },
          {
            id: 2,
            parts: JSON.stringify([
              { type: 'file', mediaType: 'image/jpeg', url: 'data:image/jpeg;base64,AAAA' },
            ]),
          },
        ]];
      }
      return [{}];
    },
  };

  const stats = await runImageRedactionPass(pool, new Date());
  assert.equal(stats.scanned, 2);
  assert.equal(stats.redacted, 1); // row 1 skipped, row 2 redacted
});

test('runToolPayloadTrimPass skips a row with unparseable parts instead of throwing', async () => {
  const pool = {
    query: async (sql) => {
      if (sql.startsWith('SELECT')) {
        return [[
          { id: 1, parts: '[[[not json' },
          {
            id: 2,
            parts: JSON.stringify([
              { type: 'tool-calculator', toolCallId: 'x', state: 'output-available', input: {}, output: {} },
            ]),
          },
        ]];
      }
      return [{}];
    },
  };

  const stats = await runToolPayloadTrimPass(pool, new Date());
  assert.equal(stats.scanned, 2);
  assert.equal(stats.trimmed, 1);
});
