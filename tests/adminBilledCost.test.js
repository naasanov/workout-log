// Pure unit tests for apportionBilledCost/narrowBilledCostToUser/toBilledCostReport
// in services/nutrition/usage.ts (#377, #378): splitting each day's OpenAI-billed
// total across users by their share of that day's estimated cost. No DB or network
// involved, so these run without docker compose.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../scripts/testDb');

db.applyTestEnv();
const usage = db.requireTs('services/nutrition/usage.ts');
const { apportionBilledCost, narrowBilledCostToUser, toBilledCostReport } = usage;

test('apportionBilledCost splits a day proportionally to each user\'s estimated share', () => {
  const estimates = [
    { day: '2026-09-10', userUuid: 'user-a', costUsd: 3 },
    { day: '2026-09-10', userUuid: 'user-b', costUsd: 1 },
  ];
  const billedByDay = new Map([['2026-09-10', 8]]);

  const result = apportionBilledCost(estimates, billedByDay);

  assert.equal(result.totalUsd, 8);
  assert.equal(result.unattributedUsd, 0);
  assert.equal(result.estimatedDayCount, 0);
  assert.equal(result.daily.length, 1);
  assert.deepEqual(result.daily[0], { day: '2026-09-10', billedUsd: 8, estimated: false });

  const byUser = new Map(result.byUser.map((u) => [u.userUuid, u.billedUsd]));
  assert.ok(Math.abs(byUser.get('user-a') - 6) < 1e-9, 'user-a had 3/4 of the day\'s estimate, so 3/4 of the $8 billed');
  assert.ok(Math.abs(byUser.get('user-b') - 2) < 1e-9, 'user-b had 1/4 of the day\'s estimate, so 1/4 of the $8 billed');
});

test('apportionBilledCost keeps a day\'s billed cost as unattributed when nobody used it that day', () => {
  const estimates = [
    { day: '2026-09-10', userUuid: 'user-a', costUsd: 2 },
  ];
  // A day OpenAI billed for, but with no matching ai_usage rows at all.
  const billedByDay = new Map([
    ['2026-09-10', 5],
    ['2026-09-11', 3],
  ]);

  const result = apportionBilledCost(estimates, billedByDay);

  assert.equal(result.totalUsd, 8);
  assert.equal(result.unattributedUsd, 3, 'the day with billed cost but zero estimated usage stays unattributed');
  assert.equal(result.byUser.length, 1);
  assert.ok(Math.abs(result.byUser[0].billedUsd - 5) < 1e-9);

  const day11 = result.daily.find((d) => d.day === '2026-09-11');
  assert.equal(day11.billedUsd, 3);
  assert.equal(day11.estimated, false, 'billed data exists for this day, it just has no attributable user');
});

test('apportionBilledCost falls back to the estimate for a day missing from the billed map, flagged estimated', () => {
  const estimates = [
    { day: '2026-09-10', userUuid: 'user-a', costUsd: 4 },
    { day: '2026-09-11', userUuid: 'user-a', costUsd: 1.5 },
  ];
  // Only 09-10 has been reported by the Costs API; 09-11 (e.g. today) hasn't yet.
  const billedByDay = new Map([['2026-09-10', 4]]);

  const result = apportionBilledCost(estimates, billedByDay);

  assert.equal(result.estimatedDayCount, 1);
  const day10 = result.daily.find((d) => d.day === '2026-09-10');
  const day11 = result.daily.find((d) => d.day === '2026-09-11');
  assert.equal(day10.estimated, false);
  assert.equal(day11.estimated, true);
  assert.ok(Math.abs(day11.billedUsd - 1.5) < 1e-9, 'the fallback day uses its estimated total as the billed figure');
  assert.ok(Math.abs(result.totalUsd - 5.5) < 1e-9);
});

test('apportionBilledCost sums per-user (+ unattributed) back to the billed total within a cent', () => {
  const estimates = [
    { day: '2026-09-01', userUuid: 'user-a', costUsd: 1.234 },
    { day: '2026-09-01', userUuid: 'user-b', costUsd: 2.766 },
    { day: '2026-09-02', userUuid: 'user-a', costUsd: 0.5 },
  ];
  const billedByDay = new Map([
    ['2026-09-01', 10.0],
    ['2026-09-02', 0.75],
    ['2026-09-03', 2.2], // billed with no estimates at all that day -- fully unattributed
  ]);

  const result = apportionBilledCost(estimates, billedByDay);

  const reconstructed = result.byUser.reduce((sum, u) => sum + u.billedUsd, 0) + result.unattributedUsd;
  assert.ok(Math.abs(reconstructed - result.totalUsd) < 0.01);
  assert.ok(Math.abs(result.totalUsd - 12.95) < 1e-9);
});

test('apportionBilledCost falls back to estimates on every day when billedByDay is empty (Costs API unavailable)', () => {
  const estimates = [
    { day: '2026-09-10', userUuid: 'user-a', costUsd: 2 },
    { day: '2026-09-11', userUuid: 'user-a', costUsd: 3 },
  ];

  const result = apportionBilledCost(estimates, new Map());

  assert.equal(result.estimatedDayCount, 2);
  assert.ok(result.daily.every((d) => d.estimated));
  assert.ok(Math.abs(result.totalUsd - 5) < 1e-9);
  assert.equal(result.unattributedUsd, 0);
});

test('narrowBilledCostToUser reports only one user\'s daily/total share, keeping unattributed/byUser range-wide', () => {
  const estimates = [
    { day: '2026-09-10', userUuid: 'user-a', costUsd: 3 },
    { day: '2026-09-10', userUuid: 'user-b', costUsd: 1 },
    { day: '2026-09-11', userUuid: 'user-b', costUsd: 2 },
  ];
  const billedByDay = new Map([
    ['2026-09-10', 8],
    ['2026-09-11', 5],
  ]);
  const full = apportionBilledCost(estimates, billedByDay);

  const narrowed = narrowBilledCostToUser(full, 'user-a');
  assert.ok(Math.abs(narrowed.totalUsd - 6) < 1e-9, 'user-a only has a share of the 09-10 total');
  assert.equal(narrowed.daily.length, 2, 'every day in range appears, even ones user-a had no usage on');
  const day11 = narrowed.daily.find((d) => d.day === '2026-09-11');
  assert.equal(day11.billedCostUsd, 0);
  assert.equal(narrowed.unattributedUsd, full.unattributedUsd);
  assert.deepEqual(narrowed.byUser, full.byUser.map((u) => ({ userUuid: u.userUuid, billedCostUsd: u.billedUsd })));
});

test('toBilledCostReport reshapes the full apportionment without narrowing it', () => {
  const estimates = [{ day: '2026-09-10', userUuid: 'user-a', costUsd: 1 }];
  const billedByDay = new Map([['2026-09-10', 2]]);
  const full = apportionBilledCost(estimates, billedByDay);

  const report = toBilledCostReport(full);
  assert.equal(report.totalUsd, full.totalUsd);
  assert.equal(report.unattributedUsd, full.unattributedUsd);
  assert.equal(report.estimatedDayCount, full.estimatedDayCount);
  assert.deepEqual(report.daily, full.daily.map((d) => ({ day: d.day, billedCostUsd: d.billedUsd, estimated: d.estimated })));
  assert.deepEqual(report.byUser, full.byUser.map((u) => ({ userUuid: u.userUuid, billedCostUsd: u.billedUsd })));
});
