// Focused unit test for the pure redaction logic used by
// scripts/redactOldChatImages.js. Uses Node's built-in test runner (no repo
// test framework is configured for the backend, so this avoids adding one
// just for this) — run with: node --test scripts/chatImageRedaction.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { redactParts, trimToolPayloads, isInsertPrivilegeError } = require('./chatImageRedaction');

test('redacts an embedded base64 image file part', () => {
  const parts = [
    { type: 'text', text: 'here is a photo' },
    { type: 'file', mediaType: 'image/jpeg', url: 'data:image/jpeg;base64,AAAA' },
  ];
  const { parts: next, changed } = redactParts(parts);
  assert.equal(changed, true);
  assert.deepEqual(next[0], { type: 'text', text: 'here is a photo' });
  assert.deepEqual(next[1], { type: 'data-imageRedacted', data: { mediaType: 'image/jpeg' } });
});

test('redacts a barcode attachment image while keeping code/product', () => {
  const parts = [
    {
      type: 'data-barcodeAttachment',
      data: {
        code: '012345678905',
        imageDataUrl: 'data:image/jpeg;base64,BBBB',
        product: { name: 'Widget Bar' },
      },
    },
  ];
  const { parts: next, changed } = redactParts(parts);
  assert.equal(changed, true);
  assert.equal(next[0].data.imageDataUrl, null);
  assert.equal(next[0].data.imageRedacted, true);
  assert.equal(next[0].data.code, '012345678905');
  assert.deepEqual(next[0].data.product, { name: 'Widget Bar' });
});

test('leaves non-image parts untouched', () => {
  const parts = [
    { type: 'text', text: 'hello' },
    { type: 'tool-someTool', state: 'output-available', output: { ok: true } },
  ];
  const { parts: next, changed } = redactParts(parts);
  assert.equal(changed, false);
  assert.deepEqual(next, parts);
});

test('leaves a barcode attachment with no image untouched', () => {
  const parts = [
    { type: 'data-barcodeAttachment', data: { code: '123', imageDataUrl: null, product: {} } },
  ];
  const { parts: next, changed } = redactParts(parts);
  assert.equal(changed, false);
  assert.deepEqual(next, parts);
});

test('is idempotent — already-redacted parts are left alone on a second pass', () => {
  const parts = [
    { type: 'file', mediaType: 'image/jpeg', url: 'data:image/jpeg;base64,AAAA' },
    {
      type: 'data-barcodeAttachment',
      data: { code: '123', imageDataUrl: 'data:image/jpeg;base64,BBBB', product: {} },
    },
  ];
  const first = redactParts(parts);
  assert.equal(first.changed, true);

  const second = redactParts(first.parts);
  assert.equal(second.changed, false);
  assert.deepEqual(second.parts, first.parts);
});

test('does not redact a non-data-URI file url (e.g. a hosted image link)', () => {
  const parts = [
    { type: 'file', mediaType: 'image/jpeg', url: 'https://example.com/photo.jpg' },
  ];
  const { parts: next, changed } = redactParts(parts);
  assert.equal(changed, false);
  assert.deepEqual(next, parts);
});

test('redactParts on malformed (non-array) input does not throw', () => {
  for (const bad of [null, undefined, 'not an array', 42, { not: 'an array' }]) {
    const { parts, changed } = redactParts(bad);
    assert.equal(changed, false);
    assert.equal(parts, bad);
  }
});

// --- trimToolPayloads --------------------------------------------------

test('trims a tool- part older than the retention window, keeping type/toolCallId/state', () => {
  const parts = [
    {
      type: 'tool-calculator',
      toolCallId: 'call_123',
      state: 'output-available',
      input: { expression: '2 + 2 * (1234567 / 89)' },
      output: { result: 27735.7752809 },
    },
  ];
  const { parts: next, changed } = trimToolPayloads(parts);
  assert.equal(changed, true);
  assert.deepEqual(next[0], {
    type: 'tool-calculator',
    payloadTrimmed: true,
    toolCallId: 'call_123',
    state: 'output-available',
  });
  assert.equal('input' in next[0], false);
  assert.equal('output' in next[0], false);
});

test('trims a tool-search_foods_batch part with a `result` field the same way', () => {
  const parts = [
    {
      type: 'tool-search_foods_batch',
      toolCallId: 'call_456',
      state: 'output-available',
      input: { queries: ['banana', 'oatmeal'] },
      result: { matches: [{ id: 1, name: 'Banana' }] },
    },
  ];
  const { parts: next, changed } = trimToolPayloads(parts);
  assert.equal(changed, true);
  assert.deepEqual(next[0], {
    type: 'tool-search_foods_batch',
    payloadTrimmed: true,
    toolCallId: 'call_456',
    state: 'output-available',
  });
});

test('does not trim text or reasoning parts', () => {
  const parts = [
    { type: 'text', text: 'the calculator said 27735.78' },
    { type: 'reasoning', text: 'let me compute this step by step...' },
  ];
  const { parts: next, changed } = trimToolPayloads(parts);
  assert.equal(changed, false);
  assert.deepEqual(next, parts);
});

test('is idempotent — an already-trimmed tool- part is left alone on a second pass', () => {
  const parts = [
    {
      type: 'tool-calculator',
      toolCallId: 'call_123',
      state: 'output-available',
      input: { expression: '1+1' },
      output: { result: 2 },
    },
  ];
  const first = trimToolPayloads(parts);
  assert.equal(first.changed, true);

  const second = trimToolPayloads(first.parts);
  assert.equal(second.changed, false);
  assert.deepEqual(second.parts, first.parts);
});

test('trimToolPayloads on malformed (non-array) input does not throw', () => {
  for (const bad of [null, undefined, 'not an array', 42, { not: 'an array' }]) {
    const { parts, changed } = trimToolPayloads(bad);
    assert.equal(changed, false);
    assert.equal(parts, bad);
  }
});

test('trimToolPayloads tolerates a tool- part missing toolCallId/state', () => {
  const parts = [{ type: 'tool-web_search', input: { query: 'chicken breast calories' } }];
  const { parts: next, changed } = trimToolPayloads(parts);
  assert.equal(changed, true);
  assert.deepEqual(next[0], { type: 'tool-web_search', payloadTrimmed: true });
});

// --- isInsertPrivilegeError ---------------------------------------------

test('isInsertPrivilegeError recognizes ER_TABLEACCESS_DENIED_ERROR', () => {
  const err = new Error('INSERT command denied to user');
  err.code = 'ER_TABLEACCESS_DENIED_ERROR';
  assert.equal(isInsertPrivilegeError(err), true);
});

test('isInsertPrivilegeError rejects other errors', () => {
  const err = new Error('connection reset');
  err.code = 'ECONNRESET';
  assert.equal(isInsertPrivilegeError(err), false);
  assert.equal(isInsertPrivilegeError(null), false);
  assert.equal(isInsertPrivilegeError(undefined), false);
});
