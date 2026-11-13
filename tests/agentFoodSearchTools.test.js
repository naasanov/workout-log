// search_foods / search_foods_batch return the user's food-log history alongside
// provider results in a single call. Store and provider calls are stubbed.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const db = require('../scripts/testDb');

test('search_foods and search_foods_batch return history with results', async () => {
  const store = db.requireTs(path.join(__dirname, '../services/nutrition/store.ts'));
  const providers = db.requireTs(path.join(__dirname, '../services/nutrition/providers.ts'));
  const { nutritionTools } = db.requireTs(path.join(__dirname, '../services/agent/tools/nutrition.ts'));

  const origHistory = store.searchFoodHistory;
  const origSearch = providers.searchAllFoodsWithPortions;
  store.searchFoodHistory = async (_u, q) => [{ name: `${q} entry`, logged_at: new Date('2024-01-01T00:00:00Z') }];
  providers.searchAllFoodsWithPortions = async (_u, q) => [{ name: q, source: 'usda' }];
  try {
    const tools = nutritionTools({ userUuid: 'u', selectedDate: '2024-01-01', flags: { unc_dining: false } });

    const single = await tools.search_foods.execute({ query: 'egg' });
    assert.deepEqual(single, {
      history: [{ name: 'egg entry', logged_at: '2024-01-01T00:00:00.000Z' }],
      results: [{ name: 'egg', source: 'usda' }],
    });

    const batch = await tools.search_foods_batch.execute({ queries: ['egg', 'toast'] });
    assert.deepEqual(batch.map((g) => g.query), ['egg', 'toast']);
    assert.equal(batch[1].history[0].name, 'toast entry');
    assert.equal(batch[1].results[0].name, 'toast');
  } finally {
    store.searchFoodHistory = origHistory;
    providers.searchAllFoodsWithPortions = origSearch;
  }
});

test('search_foods tools degrade per side when history or providers throw', async () => {
  const store = db.requireTs(path.join(__dirname, '../services/nutrition/store.ts'));
  const providers = db.requireTs(path.join(__dirname, '../services/nutrition/providers.ts'));
  const { nutritionTools } = db.requireTs(path.join(__dirname, '../services/agent/tools/nutrition.ts'));

  const origHistory = store.searchFoodHistory;
  const origSearch = providers.searchAllFoodsWithPortions;
  const tools = nutritionTools({ userUuid: 'u', selectedDate: '2024-01-01', flags: { unc_dining: false } });
  try {
    providers.searchAllFoodsWithPortions = async (_u, q) => [{ name: q, source: 'usda' }];
    store.searchFoodHistory = async () => { throw new Error('history down'); };
    assert.deepEqual(await tools.search_foods.execute({ query: 'egg' }), {
      history: [],
      results: [{ name: 'egg', source: 'usda' }],
    });

    store.searchFoodHistory = async (_u, q) => [{ name: `${q} entry` }];
    providers.searchAllFoodsWithPortions = async () => { throw new Error('providers down'); };
    assert.deepEqual(await tools.search_foods.execute({ query: 'egg' }), {
      history: [{ name: 'egg entry' }],
      results: [],
    });

    // Batch: history fails for 'egg' only, providers fail for 'toast' only.
    store.searchFoodHistory = async (_u, q) => {
      if (q === 'egg') throw new Error('history down');
      return [{ name: `${q} entry` }];
    };
    providers.searchAllFoodsWithPortions = async (_u, q) => {
      if (q === 'toast') throw new Error('providers down');
      return [{ name: q, source: 'usda' }];
    };
    const batch = await tools.search_foods_batch.execute({ queries: ['egg', 'toast'] });
    assert.deepEqual(batch, [
      { query: 'egg', history: [], results: [{ name: 'egg', source: 'usda' }] },
      { query: 'toast', history: [{ name: 'toast entry' }], results: [] },
    ]);
  } finally {
    store.searchFoodHistory = origHistory;
    providers.searchAllFoodsWithPortions = origSearch;
  }
});
