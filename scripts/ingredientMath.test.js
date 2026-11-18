// Unit tests for the pure portions helper in client/src/features/nutrition/ingredientMath.ts.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { withCurrentUnit, entryKcalNeedsConfirm, ENTRY_KCAL_CONFIRM_THRESHOLD } = require('../client/src/features/nutrition/ingredientMath.ts');

test('g is always first and the current non-gram unit is appended when missing', () => {
  assert.deepEqual(withCurrentUnit([], 'cup', 195), [
    { label: 'g', grams: 1 },
    { label: 'cup', grams: 195 },
  ]);
});

test('a unit already in the list is not duplicated, and g is not repeated', () => {
  const list = withCurrentUnit([{ label: 'g', grams: 1 }, { label: 'cup', grams: 195 }], 'cup', 195);
  assert.deepEqual(list.map(p => p.label), ['g', 'cup']);
});

test('a gram row with no other portions stays [g]', () => {
  assert.deepEqual(withCurrentUnit([], 'g', 1), [{ label: 'g', grams: 1 }]);
});

test('entryKcalNeedsConfirm prompts only strictly above the threshold', () => {
  assert.equal(ENTRY_KCAL_CONFIRM_THRESHOLD, 5000);
  assert.equal(entryKcalNeedsConfirm(4999), false);
  assert.equal(entryKcalNeedsConfirm(5000), false);
  assert.equal(entryKcalNeedsConfirm(5000.01), true);
  assert.equal(entryKcalNeedsConfirm(5001), true);
});

test('entryKcalNeedsConfirm is false for 0 and NaN', () => {
  assert.equal(entryKcalNeedsConfirm(0), false);
  assert.equal(entryKcalNeedsConfirm(NaN), false);
});
