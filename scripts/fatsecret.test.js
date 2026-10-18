// Unit tests for the FatSecret food source: description parsing, serving mapping,
// object-vs-array normalization, error handling, cache TTL, and source merge ordering.
// Fixtures are real API responses; HTTP is mocked with undici's MockAgent. No database.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
require('ts-node').register({ transpileOnly: true });
const { MockAgent, setGlobalDispatcher, getGlobalDispatcher } = require('undici');
const fs = require('../services/nutrition/fatsecret.ts');
const { mergeSourceResults } = require('../services/nutrition/providers.ts');
const { proposeIngredientArgsSchema, foodSearchResultSchema } = require('../shared/nutrition.ts');
const fx = require('./fixtures/fatsecret.json');

test('parseFoodDescription reads basis and macros', () => {
  const p = fs.parseFoodDescription(
    'Per 1 bottle - Calories: 230kcal | Fat: 3.50g | Carbs: 8.00g | Protein: 42.00g',
  );
  assert.deepEqual(p, { basis: '1 bottle', calories: 230, fat_g: 3.5, carbs_g: 8, protein_g: 42 });
  assert.equal(fs.parseFoodDescription('garbage'), null);
  assert.equal(fs.parseFoodDescription(undefined), null);
});

test('serving-basis description maps to per_serving with a label and no per100g', () => {
  const [top] = fs.mapSearchResponse(fx.search_fairlife, 3);
  assert.equal(top.source, 'fatsecret');
  assert.equal(top.source_ref, '34120117');
  assert.equal(top.name, 'Core Power Elite Strawberry Protein Shake');
  assert.equal(top.per100g, null);
  assert.equal(top.serving_label, '1 bottle');
  assert.equal(top.per_serving.protein_g, 42);
  assert.ok(foodSearchResultSchema.safeParse(top).success);
});

test('gram-basis description maps to per100g normalized from the stated weight', () => {
  const [veg, kibe] = fs.mapSearchResponse(fx.search_egg, 4);
  assert.equal(veg.per100g.calories, 20);
  assert.equal(veg.per_serving ?? null, null);
  assert.equal(kibe.per100g.calories, 142.39);
  assert.equal(kibe.per100g.protein_g, 10.11);
  assert.ok(foodSearchResultSchema.safeParse(kibe).success);
});

test('brand names are prefixed except when the name already starts with the brand', () => {
  const [boston] = fs.mapSearchResponse(fx.search_dunkin, 1);
  assert.equal(boston.name, "Dunkin' Donuts Boston Kreme Donut");
  assert.equal(boston.serving_label, '1 serving');
  const m = fs.mapSearchItem({
    food_id: '1',
    food_name: 'Core Power Shake',
    brand_name: 'Core Power',
    food_description: 'Per 1 bottle - Calories: 1kcal | Fat: 1g | Carbs: 1g | Protein: 1g',
  });
  assert.equal(m.name, 'Core Power Shake');
});

test('foods.food as a single object, an array, or missing all normalize', () => {
  const one = { foods: { food: fx.search_dunkin.foods.food[0] } };
  assert.equal(fs.mapSearchResponse(one, 5).length, 1);
  assert.equal(fs.mapSearchResponse(fx.search_dunkin, 2).length, 2);
  assert.deepEqual(fs.mapSearchResponse({ foods: {} }, 5), []);
  assert.deepEqual(fs.mapSearchResponse({ error: { code: 14, message: 'x' } }, 5), []);
});

test('detail with a single serving object and ml metric stays on the serving basis', () => {
  const food = fs.mapFoodDetail(fx.detail_fairlife);
  assert.equal(food.servings.length, 1);
  assert.equal(food.servings[0].grams, null);
  assert.equal(fs.detailPer100g(food), null);
  assert.deepEqual(fs.detailPortions(food), []);
  const [top] = fs.mapSearchResponse(fx.search_fairlife, 1);
  const upgraded = fs.applyDetail(top, food);
  assert.equal(upgraded.per100g, null);
  assert.equal(upgraded.per_serving.sodium_mg, 250);
  assert.equal(upgraded.per_serving.sugar_g, 7);
});

test('detail with an array of gram servings yields per100g and portions', () => {
  const food = fs.mapFoodDetail(fx.detail_generic_array);
  assert.equal(food.servings.length, 4);
  const per100g = fs.detailPer100g(food);
  assert.equal(per100g.calories, 20);
  assert.equal(per100g.fiber_g, 1.4);
  const portions = fs.detailPortions(food);
  assert.deepEqual(portions.map((p) => p.label), ['serving (28g)', 'oz', 'cup']);
  assert.equal(portions.find((p) => p.label === 'cup').grams, 120);
  const [top] = fs.mapSearchResponse(fx.search_egg, 1);
  const upgraded = fs.applyDetail(top, food);
  assert.equal(upgraded.per100g.sodium_mg, 17);
  assert.equal(upgraded.per_serving, null);
  assert.equal(upgraded.portions.length, 3);
});

test('a serving-only restaurant item has no portions and keeps per_serving', () => {
  const food = fs.mapFoodDetail(fx.detail_dunkin);
  assert.deepEqual(fs.detailPortions(food), []);
  const [top] = fs.mapSearchResponse(fx.search_dunkin, 1);
  assert.equal(fs.applyDetail(top, food).per_serving.fiber_g, 1);
});

test('a fatsecret serving-basis ingredient is accepted by the propose_entry schema', () => {
  const [top] = fs.mapSearchResponse(fx.search_fairlife, 1);
  const parsed = proposeIngredientArgsSchema.safeParse({
    name: top.name,
    source: 'fatsecret',
    source_ref: top.source_ref,
    grams: null,
    serving_qty: 1,
    serving_label: top.serving_label,
    base: { per_serving: top.per_serving },
  });
  assert.ok(parsed.success, JSON.stringify(parsed.error?.issues));
});

test('TtlCache expires entries and bounds its size', () => {
  let now = 1000;
  const c = new fs.TtlCache(100, () => now, 2);
  c.set('a', 1);
  assert.equal(c.get('a'), 1);
  now += 99;
  assert.equal(c.get('a'), 1);
  now += 1;
  assert.equal(c.get('a'), undefined);
  c.set('a', 1);
  c.set('b', 2);
  c.set('c', 3);
  assert.equal(c.get('a'), undefined);
  assert.equal(c.get('c'), 3);
});

const mk = (source, name) => ({ name, source, source_ref: name, per100g: { calories: 1, protein_g: 1, carbs_g: 1, fat_g: 1 } });

test('merge keeps USDA first unless the FatSecret top matches the query better', () => {
  const usda = [mk('usda', 'Milk shake chocolate'), mk('usda', 'b'), mk('usda', 'c'), mk('usda', 'd'), mk('usda', 'e')];
  const fsr = [mk('fatsecret', 'Core Power Elite Strawberry'), mk('fatsecret', 'f2'), mk('fatsecret', 'f3'), mk('fatsecret', 'f4')];
  const branded = mergeSourceResults(usda, fsr, 'core power elite strawberry');
  assert.equal(branded.length, 7);
  assert.equal(branded[0].source, 'fatsecret');
  const generic = mergeSourceResults([mk('usda', 'Egg whole raw')], [mk('fatsecret', 'Raw Vegetable')], 'egg whole raw');
  assert.deepEqual(generic.map((r) => r.source), ['usda', 'fatsecret']);
  assert.equal(mergeSourceResults(usda, [], 'x').length, 5);
  assert.deepEqual(mergeSourceResults([], [mk('fatsecret', 'a')], 'x').map((r) => r.source), ['fatsecret']);
});

test('unconfigured credentials skip FatSecret silently', async () => {
  const saved = { id: process.env.FATSECRET_CLIENT_ID, secret: process.env.FATSECRET_CLIENT_SECRET };
  delete process.env.FATSECRET_CLIENT_ID;
  delete process.env.FATSECRET_CLIENT_SECRET;
  try {
    assert.deepEqual(await fs.searchFatSecret('anything', 3), []);
    assert.equal(await fs.getFatSecretFood('1'), null);
  } finally {
    if (saved.id !== undefined) process.env.FATSECRET_CLIENT_ID = saved.id;
    if (saved.secret !== undefined) process.env.FATSECRET_CLIENT_SECRET = saved.secret;
  }
});

test('HTTP: token is reused, results are cached, and API errors resolve to []', async () => {
  const saved = { id: process.env.FATSECRET_CLIENT_ID, secret: process.env.FATSECRET_CLIENT_SECRET, proxy: process.env.QUOTAGUARDSTATIC_URL };
  process.env.FATSECRET_CLIENT_ID = 'id';
  process.env.FATSECRET_CLIENT_SECRET = 'secret';
  delete process.env.QUOTAGUARDSTATIC_URL;
  fs._resetFatSecretStateForTests();
  const original = getGlobalDispatcher();
  const agent = new MockAgent();
  agent.disableNetConnect();
  setGlobalDispatcher(agent);
  const oauth = agent.get('https://oauth.fatsecret.com');
  const api = agent.get('https://platform.fatsecret.com');
  try {
    oauth.intercept({ path: '/connect/token', method: 'POST' }).reply(200, { access_token: 't1', expires_in: 86400 }).times(1);
    api.intercept({ path: (p) => p.includes('foods.search') && p.includes('dunkin') }).reply(200, fx.search_dunkin).times(1);
    const first = await fs.searchFatSecret('dunkin', 3);
    assert.equal(first.length, 3);
    // Second identical search is served from the cache (no second interceptor registered).
    assert.equal((await fs.searchFatSecret('Dunkin', 3)).length, 3);

    api.intercept({ path: (p) => p.includes('foods.search') && p.includes('limited') }).reply(200, {
      error: { code: 14, message: 'User is performing too many actions: please try again later' },
    });
    assert.deepEqual(await fs.searchFatSecret('limited', 3), []);

    api.intercept({ path: (p) => p.includes('foods.search') && p.includes('boom') }).reply(500, 'nope');
    assert.deepEqual(await fs.searchFatSecret('boom', 3), []);

    api.intercept({ path: (p) => p.includes('food.get.v2') }).reply(200, fx.detail_generic_array).times(1);
    const portions = await fs.getFatSecretPortions('6223');
    assert.equal(portions.length, 3);
    assert.equal((await fs.getFatSecretPortions('6223')).length, 3);
  } finally {
    await agent.close();
    setGlobalDispatcher(original);
    fs._resetFatSecretStateForTests();
    for (const [k, v] of [['FATSECRET_CLIENT_ID', saved.id], ['FATSECRET_CLIENT_SECRET', saved.secret], ['QUOTAGUARDSTATIC_URL', saved.proxy]]) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});
