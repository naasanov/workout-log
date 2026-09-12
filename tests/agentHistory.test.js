// services/agent/history.ts trimHistoryForReplay (#325). Pure function, no database needed.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../scripts/testDb');

const { trimHistoryForReplay, KEEP_FULL_TURNS, TRIM_BLOCK_TURNS } = db.requireTs('services/agent/history.ts');

const u1 = { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'What was in the chicken sandwich?' }] };
const a1 = {
  id: 'a1',
  role: 'assistant',
  parts: [
    { type: 'reasoning', text: 'Let me look that up.' },
    {
      type: 'tool-search_foods_batch',
      toolCallId: 'c1',
      state: 'output-available',
      input: { queries: ['chicken sandwich'] },
      output: { results: [{ name: 'Chicken Sandwich', calories: 450 }] },
    },
    { type: 'text', text: 'It has 450 calories.' },
  ],
};

const u2 = {
  id: 'u2',
  role: 'user',
  parts: [
    { type: 'file', mediaType: 'image/jpeg', url: 'data:image/jpeg;base64,AAAA' },
    { type: 'text', text: 'Here is what I ate' },
    { type: 'data-barcodeAttachment', data: { code: '049000028911', product: { name: 'Coke', source: 'off', source_ref: 'x', per100g: {} } } },
  ],
};
const a2 = {
  id: 'a2',
  role: 'assistant',
  parts: [
    { type: 'tool-propose_mutation', toolCallId: 'c2', state: 'output-available', input: { type: 'entry.create', name: 'Coke' }, output: { echoed: true } },
    { type: 'text', text: 'Proposed logging it.' },
  ],
};

const u3 = { id: 'u3', role: 'user', parts: [{ type: 'text', text: 'What about the fries?' }] };
const a3 = {
  id: 'a3',
  role: 'assistant',
  parts: [
    { type: 'reasoning', text: 'Fries are 380 calories per serving.' },
    { type: 'tool-calculator', toolCallId: 'c3', state: 'output-available', input: { expression: '380' }, output: { result: 380 } },
    { type: 'text', text: 'Fries have 380 calories.' },
  ],
};

// Plain turns with a reasoning part, so trimming one visibly changes it.
function plainTurn(n) {
  return [
    { id: `u${n}`, role: 'user', parts: [{ type: 'text', text: `message ${n}` }] },
    { id: `a${n}`, role: 'assistant', parts: [{ type: 'reasoning', text: `thinking ${n}` }, { type: 'text', text: `reply ${n}` }] },
  ];
}

// A conversation of `turns` user turns: the three fixture turns first, then plain turns.
function conversation(turns) {
  const messages = [u1, a1, u2, a2, u3, a3];
  for (let n = 4; n <= turns; n++) messages.push(...plainTurn(n));
  return messages.slice(0, turns * 2);
}

test('trimHistoryForReplay', async (t) => {
  await t.test('keeps 2 full turns and trims in blocks of 4', () => {
    assert.equal(KEEP_FULL_TURNS, 2);
    assert.equal(TRIM_BLOCK_TURNS, 4);
  });

  await t.test('returns short conversations unchanged, by reference', () => {
    for (const turns of [0, 1, 2, 5]) {
      const messages = conversation(turns);
      const trimmed = trimHistoryForReplay(messages);
      assert.equal(trimmed.length, messages.length, `${turns} turns`);
      messages.forEach((m, i) => assert.equal(trimmed[i], m, `${turns} turns, message ${i}`));
    }
  });

  await t.test('at 6 turns, trims the first 4 and replays the last 2 by reference', () => {
    const messages = conversation(6);
    const trimmed = trimHistoryForReplay(messages);
    const recent = messages.slice(8);
    assert.deepEqual(trimmed.slice(-recent.length), recent);
    recent.forEach((m, i) => assert.equal(trimmed[trimmed.length - recent.length + i], m));
    assert.ok(!trimmed.find((m) => m.id === 'a4').parts.some((p) => p.type === 'reasoning'));
  });

  await t.test('an older assistant turn keeps text, drops reasoning, and placeholders a search payload', () => {
    const trimmedA1 = trimHistoryForReplay(conversation(6)).find((m) => m.id === 'a1');
    assert.ok(!trimmedA1.parts.some((p) => p.type === 'reasoning'));
    assert.ok(!trimmedA1.parts.some((p) => p.type === 'tool-search_foods_batch'));
    assert.ok(trimmedA1.parts.some((p) => p.type === 'text' && p.text.includes('search_foods_batch')));
    assert.ok(trimmedA1.parts.some((p) => p.type === 'text' && p.text === 'It has 450 calories.'));
  });

  await t.test('an older assistant turn keeps every propose_* call untouched', () => {
    assert.deepEqual(trimHistoryForReplay(conversation(6)).find((m) => m.id === 'a2'), a2);
  });

  await t.test('an older user turn keeps barcode grounding and placeholders the image', () => {
    const trimmedU2 = trimHistoryForReplay(conversation(6)).find((m) => m.id === 'u2');
    assert.ok(!trimmedU2.parts.some((p) => p.type === 'file'));
    assert.ok(trimmedU2.parts.some((p) => p.type === 'data-barcodeAttachment' && p.data.code === '049000028911'));
    assert.ok(trimmedU2.parts.some((p) => p.type === 'text' && p.text === 'Here is what I ate'));
  });

  await t.test('an older calculator call is placeholdered', () => {
    const trimmedA3 = trimHistoryForReplay(conversation(6)).find((m) => m.id === 'a3');
    assert.ok(!trimmedA3.parts.some((p) => p.type === 'tool-calculator'));
    assert.ok(trimmedA3.parts.some((p) => p.type === 'text' && p.text.includes('calculator')));
    assert.ok(!trimmedA3.parts.some((p) => p.type === 'reasoning'));
  });

  await t.test('the replayed prefix is identical from turn 6 through 9 and only grows at turn 10', () => {
    const at6 = trimHistoryForReplay(conversation(6));
    for (const turns of [7, 8, 9]) {
      const later = trimHistoryForReplay(conversation(turns));
      assert.deepEqual(later.slice(0, at6.length - 4), at6.slice(0, at6.length - 4), `${turns} turns`);
      assert.deepEqual(JSON.stringify(later).slice(0, 200), JSON.stringify(at6).slice(0, 200));
      assert.ok(later.find((m) => m.id === 'a5').parts.some((p) => p.type === 'reasoning'), `${turns} turns keeps turn 5 full`);
    }
    const at10 = trimHistoryForReplay(conversation(10));
    assert.ok(!at10.find((m) => m.id === 'a5').parts.some((p) => p.type === 'reasoning'), 'turn 5 is trimmed at 10 turns');
    assert.ok(at10.find((m) => m.id === 'a9').parts.some((p) => p.type === 'reasoning'), 'turn 9 stays full at 10 turns');
  });

  await t.test('never mutates its input', () => {
    const messages = conversation(10);
    const before = JSON.parse(JSON.stringify(messages));
    trimHistoryForReplay(messages);
    assert.deepEqual(messages, before);
  });
});
