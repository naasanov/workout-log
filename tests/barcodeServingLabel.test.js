// lookupBarcode surfaces Open Food Facts' serving_size text ("3 slices (63 g)")
// as serving_description, so the agent can scale a serving to a unit count (#329).
// Stubs globalThis.fetch, so no database or network access is needed.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const db = require('../scripts/testDb');

let lookupBarcode;

test.before(() => {
  ({ lookupBarcode } = db.requireTs(path.join(__dirname, '../services/nutrition/providers.ts')));
});

function offProductPayload(productOverrides = {}) {
  return {
    status: 1,
    product: {
      product_name: 'Sliced Cheddar Cheese',
      nutriments: {
        'energy-kcal_100g': 400,
        proteins_100g: 25,
        carbohydrates_100g: 1,
        fat_100g: 33,
      },
      serving_quantity: 63,
      serving_size: '3 slices (63 g)',
      ...productOverrides,
    },
  };
}

function stubFetch(payload) {
  const original = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => payload,
  });
  return () => {
    globalThis.fetch = original;
  };
}

test('lookupBarcode returns serving_description and serving_grams from OFF serving_size/serving_quantity', async () => {
  const restore = stubFetch(offProductPayload());
  try {
    const result = await lookupBarcode('1111111111111');
    assert.ok(result);
    assert.equal(result.serving_description, '3 slices (63 g)');
    assert.equal(result.serving_grams, 63);
  } finally {
    restore();
  }
});

test('lookupBarcode returns serving_description: null when OFF has no serving_size', async () => {
  const payload = offProductPayload();
  delete payload.product.serving_size;
  const restore = stubFetch(payload);
  try {
    const result = await lookupBarcode('2222222222222');
    assert.ok(result);
    assert.equal(result.serving_description, null);
  } finally {
    restore();
  }
});

test('lookupBarcode returns serving_description: null when OFF sends an empty/whitespace serving_size', async () => {
  const restore = stubFetch(offProductPayload({ serving_size: '   ' }));
  try {
    const result = await lookupBarcode('3333333333333');
    assert.ok(result);
    assert.equal(result.serving_description, null);
  } finally {
    restore();
  }
});
