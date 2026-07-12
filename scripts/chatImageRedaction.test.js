// Focused unit test for the pure redaction logic used by
// scripts/redactOldChatImages.js. Uses Node's built-in test runner (no repo
// test framework is configured for the backend, so this avoids adding one
// just for this) — run with: node --test scripts/chatImageRedaction.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { redactParts } = require('./chatImageRedaction');

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
