// Server-side macro resolution for propose_entry (#325): the model may hand over a
// `base` nutrition record (per100g or per_serving, copied verbatim from a search/
// barcode/UNC lookup) plus the quantity actually eaten, instead of computing
// calories/protein_g/carbs_g/fat_g itself via the calculator tool. Covers both the
// schema-level validation (proposeIngredientArgsSchema) and the resolver
// (resolveProposeIngredient) that scales a base into the resolved shape the client
// has always received.
//
// Pure schema/handler tests — no database or network access needed.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const db = require('../scripts/testDb');

let proposeIngredientArgsSchema;
let proposeEntryToolArgsSchema;
let proposeEntryArgsSchema;
let resolveProposeIngredient;

test.before(() => {
  ({ proposeIngredientArgsSchema, proposeEntryToolArgsSchema, proposeEntryArgsSchema } = db.requireTs(
    path.join(__dirname, '../schemas/nutrition.ts'),
  ));
  ({ resolveProposeIngredient } = db.requireTs(path.join(__dirname, '../services/agent/tools/nutrition.ts')));
});

// A per100g base as search_foods would return it.
const PER_100G_BASE = {
  calories: 200,
  protein_g: 10,
  carbs_g: 20,
  fat_g: 5,
  fiber_g: 2,
  sugar_g: 3,
  sodium_mg: 50,
};

// A per_serving base as UNC's search_unc_foods/get_unc_menu would return it.
const PER_SERVING_BASE = {
  calories: 300,
  protein_g: 9,
  carbs_g: 33,
  fat_g: 12,
  fiber_g: null,
  sugar_g: null,
  sodium_mg: 600,
};

function baseIngredient(overrides = {}) {
  return {
    name: 'Chicken breast',
    source: 'usda',
    source_ref: '12345',
    grams: 150,
    base: { per100g: PER_100G_BASE },
    ...overrides,
  };
}

function resolvedIngredient(overrides = {}) {
  return {
    name: 'Peanut butter (estimated)',
    source: 'manual',
    grams: 32,
    calories: 190,
    protein_g: 7,
    carbs_g: 6,
    fat_g: 16,
    ...overrides,
  };
}

test('proposeIngredientArgsSchema accepts a per100g base + grams and resolveProposeIngredient scales it correctly', () => {
  const input = baseIngredient({ grams: 150 });
  const parsed = proposeIngredientArgsSchema.parse(input);
  const resolved = resolveProposeIngredient(parsed);

  assert.equal(resolved.calories, 300); // 200 * 1.5
  assert.equal(resolved.protein_g, 15); // 10 * 1.5
  assert.equal(resolved.carbs_g, 30); // 20 * 1.5
  assert.equal(resolved.fat_g, 7.5); // 5 * 1.5
  assert.equal(resolved.fiber_g, 3); // 2 * 1.5
  assert.equal(resolved.sugar_g, 4.5); // 3 * 1.5
  assert.equal(resolved.sodium_mg, 75); // 50 * 1.5
  // The base record itself must not leak into the resolved/echoed shape.
  assert.equal(resolved.base, undefined);
  assert.equal(resolved.grams, 150);
});

test('resolveProposeIngredient handles a gram quantity against a per-100g base (round number)', () => {
  const parsed = proposeIngredientArgsSchema.parse(baseIngredient({ grams: 50 }));
  const resolved = resolveProposeIngredient(parsed);

  assert.equal(resolved.calories, 100); // 200 * 0.5
  assert.equal(resolved.protein_g, 5);
  assert.equal(resolved.carbs_g, 10);
  assert.equal(resolved.fat_g, 2.5);
});

test('resolveProposeIngredient handles a fractional serving (1/3) against a per_serving base', () => {
  const input = {
    name: 'UNC pizza slice',
    source: 'unc',
    source_ref: '999',
    grams: null,
    serving_qty: 1 / 3,
    serving_label: '1 slice',
    base: { per_serving: PER_SERVING_BASE },
  };
  const parsed = proposeIngredientArgsSchema.parse(input);
  const resolved = resolveProposeIngredient(parsed);

  assert.equal(resolved.calories, 100); // 300 / 3
  assert.equal(resolved.protein_g, 3); // 9 / 3
  assert.equal(resolved.carbs_g, 11); // 33 / 3
  assert.equal(resolved.fat_g, 4); // 12 / 3
  assert.equal(resolved.sodium_mg, 200); // 600 / 3
  // Null micros in the base stay null rather than becoming 0.
  assert.equal(resolved.fiber_g, null);
  assert.equal(resolved.sugar_g, null);
  assert.equal(resolved.serving_qty, 1 / 3);
  assert.equal(resolved.serving_label, '1 slice');
});

test('resolveProposeIngredient passes an already-resolved ingredient through unchanged', () => {
  const input = resolvedIngredient();
  const parsed = proposeIngredientArgsSchema.parse(input);
  const resolved = resolveProposeIngredient(parsed);

  assert.equal(resolved.calories, 190);
  assert.equal(resolved.protein_g, 7);
  assert.equal(resolved.carbs_g, 6);
  assert.equal(resolved.fat_g, 16);
  assert.equal(resolved.base, undefined);
  assert.equal(resolved.name, 'Peanut butter (estimated)');
});

test('proposeIngredientArgsSchema rejects an ingredient with neither direct macros nor a base', () => {
  const input = {
    name: 'Mystery food',
    source: 'manual',
    grams: 100,
  };
  const result = proposeIngredientArgsSchema.safeParse(input);
  assert.equal(result.success, false);
  const messages = result.error.issues.map((i) => i.message).join(' ');
  assert.match(messages, /base nutrition record/);
});

test('proposeIngredientArgsSchema rejects an ingredient with both direct macros and a base', () => {
  const input = baseIngredient({
    calories: 999,
    protein_g: 999,
    carbs_g: 999,
    fat_g: 999,
  });
  const result = proposeIngredientArgsSchema.safeParse(input);
  assert.equal(result.success, false);
  const messages = result.error.issues.map((i) => i.message).join(' ');
  assert.match(messages, /not set both/);
});

test('proposeIngredientArgsSchema rejects a per100g base with no grams to scale by', () => {
  const input = {
    name: 'Chicken breast',
    source: 'usda',
    source_ref: '12345',
    base: { per100g: PER_100G_BASE },
  };
  const result = proposeIngredientArgsSchema.safeParse(input);
  assert.equal(result.success, false);
  const messages = result.error.issues.map((i) => i.message).join(' ');
  assert.match(messages, /scales by grams/);
});

test('proposeIngredientArgsSchema rejects a per_serving base with no serving_qty to scale by', () => {
  const input = {
    name: 'UNC pizza slice',
    source: 'unc',
    source_ref: '999',
    serving_label: '1 slice',
    base: { per_serving: PER_SERVING_BASE },
  };
  const result = proposeIngredientArgsSchema.safeParse(input);
  assert.equal(result.success, false);
  const messages = result.error.issues.map((i) => i.message).join(' ');
  assert.match(messages, /scales by serving_qty/);
});

test('proposeIngredientArgsSchema rejects a base with both per100g and per_serving set', () => {
  const input = baseIngredient({ base: { per100g: PER_100G_BASE, per_serving: PER_SERVING_BASE } });
  const result = proposeIngredientArgsSchema.safeParse(input);
  assert.equal(result.success, false);
});

test('a full propose_entry payload with a mix of base and already-resolved ingredients resolves to a valid ProposeEntryArgs', () => {
  const args = {
    meal: 'lunch',
    name: 'Chicken and peanut sauce',
    source: 'mixed',
    ingredients: [baseIngredient({ grams: 150 }), resolvedIngredient()],
  };
  const parsedArgs = proposeEntryToolArgsSchema.parse(args);
  const resolvedArgs = proposeEntryArgsSchema.parse({
    ...parsedArgs,
    ingredients: parsedArgs.ingredients.map(resolveProposeIngredient),
  });

  assert.equal(resolvedArgs.ingredients.length, 2);
  assert.equal(resolvedArgs.ingredients[0].calories, 300);
  assert.equal(resolvedArgs.ingredients[1].calories, 190);
  // Every ingredient in the resolved shape must carry plain numeric macros.
  for (const ing of resolvedArgs.ingredients) {
    assert.equal(typeof ing.calories, 'number');
    assert.equal(typeof ing.protein_g, 'number');
    assert.equal(typeof ing.carbs_g, 'number');
    assert.equal(typeof ing.fat_g, 'number');
  }
});
