// Unit tests for client/src/utils/localDate.ts. Pure date logic, no database.
// Run under other zones with e.g. TZ=America/New_York npm run test:file scripts/localDate.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  getTodayLocalDate,
  getLocalTimeHHmm,
  toLocalDateString,
  parseLocalDate,
  shiftLocalDate,
  localDateToISO,
} = require('../client/src/utils/localDate.ts');

test('parseLocalDate yields local midnight of that calendar day', () => {
  const d = parseLocalDate('2026-10-18');
  assert.deepEqual([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()], [2026, 9, 18, 0]);
});

test('localDateToISO round-trips to the same local calendar day', () => {
  for (const s of ['2026-01-01', '2026-03-08', '2026-11-01', '2026-12-31']) {
    const back = new Date(localDateToISO(s));
    assert.equal(toLocalDateString(back), s);
    assert.equal(back.getHours(), 12);
  }
});

test('shiftLocalDate crosses month, year, and DST boundaries by calendar day', () => {
  assert.equal(shiftLocalDate('2026-01-31', 1), '2026-02-01');
  assert.equal(shiftLocalDate('2026-01-01', -1), '2025-12-31');
  assert.equal(shiftLocalDate('2026-03-08', 1), '2026-03-09');
  assert.equal(shiftLocalDate('2026-11-01', 1), '2026-11-02');
});

test('getTodayLocalDate matches the local calendar day', () => {
  assert.equal(getTodayLocalDate(), toLocalDateString(new Date()));
});

test('getLocalTimeHHmm is zero-padded 24-hour HH:mm', () => {
  assert.match(getLocalTimeHHmm(), /^([01]\d|2[0-3]):[0-5]\d$/);
});
