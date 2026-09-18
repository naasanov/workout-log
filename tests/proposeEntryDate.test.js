// #344: propose_entry could not express a date, so the agent could only ever
// log to the day the user was viewing ("today"), never "yesterday" or a named
// day. Covers the new optional `date` field on proposeEntryToolArgsSchema /
// proposeEntryArgsSchema, and that the propose_entry tool's inputSchema
// surfaces it with a description for the model.
//
// Pure schema/handler tests — no database or network access needed.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const db = require('../scripts/testDb');

let proposeEntryToolArgsSchema;
let proposeEntryArgsSchema;
let resolveProposeIngredient;
let nutritionTools;

test.before(() => {
  ({ proposeEntryToolArgsSchema, proposeEntryArgsSchema } = db.requireTs(
    path.join(__dirname, '../shared/nutrition.ts'),
  ));
  ({ resolveProposeIngredient, nutritionTools } = db.requireTs(
    path.join(__dirname, '../services/agent/tools/nutrition.ts'),
  ));
});

function resolvedIngredient(overrides = {}) {
  return {
    name: 'Banana',
    source: 'manual',
    grams: 120,
    calories: 105,
    protein_g: 1,
    carbs_g: 27,
    fat_g: 0.4,
    ...overrides,
  };
}

function baseArgs(overrides = {}) {
  return {
    meal: 'snack',
    name: 'Banana',
    source: 'text',
    ingredients: [resolvedIngredient()],
    ...overrides,
  };
}

test('proposeEntryToolArgsSchema accepts a payload with no date at all (omitting it keeps today\'s behavior)', () => {
  const result = proposeEntryToolArgsSchema.safeParse(baseArgs());
  assert.equal(result.success, true);
  assert.equal(result.data.date, undefined);
});

test('proposeEntryToolArgsSchema accepts a well-formed YYYY-MM-DD date', () => {
  const result = proposeEntryToolArgsSchema.safeParse(baseArgs({ date: '2026-09-14' }));
  assert.equal(result.success, true);
  assert.equal(result.data.date, '2026-09-14');
});

test('proposeEntryToolArgsSchema rejects a malformed date', () => {
  for (const bad of ['09/14/2026', '2026-9-14', 'yesterday', '2026-09-14T00:00:00Z']) {
    const result = proposeEntryToolArgsSchema.safeParse(baseArgs({ date: bad }));
    assert.equal(result.success, false, `expected "${bad}" to be rejected`);
  }
});

test('proposeEntryArgsSchema (the resolved/echoed shape) also accepts an optional date', () => {
  const withDate = proposeEntryArgsSchema.safeParse(baseArgs({ date: '2026-09-14' }));
  assert.equal(withDate.success, true);
  assert.equal(withDate.data.date, '2026-09-14');

  const withoutDate = proposeEntryArgsSchema.safeParse(baseArgs());
  assert.equal(withoutDate.success, true);
  assert.equal(withoutDate.data.date, undefined);
});

test('a full propose_entry payload with a date survives resolveProposeIngredient + re-parse unchanged', () => {
  const args = baseArgs({
    date: '2026-09-14',
    ingredients: [
      {
        name: 'Chicken breast',
        source: 'usda',
        source_ref: '12345',
        grams: 150,
        base: { per100g: { calories: 200, protein_g: 10, carbs_g: 20, fat_g: 5 } },
      },
    ],
  });
  const parsedArgs = proposeEntryToolArgsSchema.parse(args);
  assert.equal(parsedArgs.date, '2026-09-14');

  const resolvedArgs = proposeEntryArgsSchema.parse({
    ...parsedArgs,
    ingredients: parsedArgs.ingredients.map(resolveProposeIngredient),
  });
  assert.equal(resolvedArgs.date, '2026-09-14');
  assert.equal(resolvedArgs.ingredients[0].calories, 300); // 200 * 1.5
});

test("the propose_entry tool's inputSchema documents date and keeps it optional", () => {
  const ctx = { userUuid: 'test-uuid', selectedDate: '2026-09-15', flags: { unc_dining: false } };
  const tools = nutritionTools(ctx);
  const dateField = tools.propose_entry.inputSchema.shape.date;

  assert.ok(dateField, 'propose_entry inputSchema must expose a date field');
  assert.match(dateField.description || '', /YYYY-MM-DD/);
  assert.match(dateField.description || '', /Omit for the day the user is currently viewing/);

  // Still optional — a payload without it must still validate against the
  // tool's own inputSchema (not just the shared/nutrition.ts copy).
  const result = tools.propose_entry.inputSchema.safeParse(baseArgs());
  assert.equal(result.success, true);
});
