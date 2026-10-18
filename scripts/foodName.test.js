// Unit tests for services/nutrition/foodName.ts. Pure string logic, no database.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeFoodName: n } = require('../services/nutrition/foodName.ts');

test('Core Power example normalizes end to end', () => {
  // The provider appends the normalized brand to the normalized description.
  const desc = n('CORE POWER, HIGH PROTEIN MILK SHAKE, STRAWBERRY, BANANA, STRAWBERRY, BANANA');
  const brand = n('FAIR OAKS FARMS BRANDS, INC.');
  assert.equal(`${desc} (${brand})`, 'Core Power, High Protein Milk Shake, Strawberry, Banana (Fair Oaks Farms Brands, Inc.)');
});

test('units after numbers are lowercased, including in mixed-case names', () => {
  assert.equal(n('PROTEIN SHAKE 42G BOTTLE, 14 FL OZ'), 'Protein Shake 42g Bottle, 14 fl oz');
  assert.equal(n('WATER 500ML'), 'Water 500ml');
  assert.equal(n('COOKIES 2 OZ, 100 MG, 50 KCAL'), 'Cookies 2 oz, 100 mg, 50 kcal');
  assert.equal(
    n('Core Power Protein Chocolate Elite 42G Bottle, 14 fl oz (Coca-Cola)'),
    'Core Power Protein Chocolate Elite 42g Bottle, 14 fl oz (Coca-Cola)',
  );
});

test('allowlisted acronyms stay uppercase', () => {
  assert.equal(n('BBQ CHICKEN PIZZA, USA MADE'), 'BBQ Chicken Pizza, USA Made');
  assert.equal(n('MCT OIL WITH DHA'), 'MCT Oil with DHA');
});

test('hyphens and apostrophes', () => {
  assert.equal(n('SUGAR-FREE GUM'), 'Sugar-Free Gum');
  assert.equal(n("REESE'S PEANUT BUTTER CUPS"), "Reese's Peanut Butter Cups");
  assert.equal(n("MOTT'S APPLE SAUCE"), "Mott's Apple Sauce");
});

test('small words are lowercase except at the start or after comma or parenthesis', () => {
  assert.equal(n('MAC AND CHEESE, THE BEST (OF THE WORLD)'), 'Mac and Cheese, The Best (Of the World)');
  assert.equal(n('THE BAR WITH NUTS & SEEDS'), 'The Bar with Nuts & Seeds');
});

test('mixed-case names pass through', () => {
  const sr = 'Beef, ground, 85% lean meat / 15% fat, patty, cooked, broiled';
  assert.equal(n(sr), sr);
  assert.equal(n("Reese's Peanut Butter Cups"), "Reese's Peanut Butter Cups");
});

test('repeated comma runs collapse, other repeats stay', () => {
  assert.equal(n('Milk Shake, Strawberry, Banana, Strawberry, Banana'), 'Milk Shake, Strawberry, Banana');
  assert.equal(n('Chocolate Chocolate Bar'), 'Chocolate Chocolate Bar');
  assert.equal(n('Salt, Pepper, Salt'), 'Salt, Pepper, Salt');
});

test('empty and whitespace input', () => {
  assert.equal(n(''), '');
  assert.equal(n('   '), '');
});
