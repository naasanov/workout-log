// Unit test for the USDA FDC search request builder. No network or database.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildUsdaSearchRequest } = require('../services/nutrition/providers.ts');

test('search is a POST with a JSON body carrying all four data types', () => {
  const { url, init } = buildUsdaSearchRequest('pupusa cheese', 'k&1');
  assert.equal(url, 'https://api.nal.usda.gov/fdc/v1/foods/search?api_key=k%261');
  assert.equal(init.method, 'POST');
  assert.equal(init.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(init.body), {
    query: 'pupusa cheese',
    dataType: ['Foundation', 'SR Legacy', 'Branded', 'Survey (FNDDS)'],
    pageSize: 25,
  });
});
