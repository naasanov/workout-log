// Unit tests for the pure portions helper in client/src/features/nutrition/ingredientMath.ts.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { withCurrentUnit } = require('../client/src/features/nutrition/ingredientMath.ts');

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
