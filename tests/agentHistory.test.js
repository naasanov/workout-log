// Tests for services/agent/history.ts's trimHistoryForReplay -- the
// history-trim policy from #325. Pure function, no database or model call
// needed.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../scripts/testDb');

const { trimHistoryForReplay, KEEP_FULL_TURNS } = db.requireTs('services/agent/history.ts');

// Turn 1 (oldest): assistant reasoned, ran a search-foods lookup, then replied.
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

// Turn 2: user attaches a photo and a scanned barcode; assistant proposes a mutation.
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
    {
      type: 'tool-propose_mutation',
      toolCallId: 'c2',
      state: 'output-available',
      input: { type: 'entry.create', name: 'Coke' },
      output: { echoed: true },
    },
    { type: 'text', text: 'Proposed logging it.' },
  ],
};

// Turn 3 (2nd-to-last): reasoning + a calculator call -- must survive untouched.
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

// Turn 4 (last): plain exchange.
const u4 = { id: 'u4', role: 'user', parts: [{ type: 'text', text: 'Thanks!' }] };
const a4 = { id: 'a4', role: 'assistant', parts: [{ type: 'text', text: "You're welcome." }] };

const olderTurns = [u1, a1, u2, a2];
const recentTurns = [u3, a3, u4, a4];
const fullConversation = [...olderTurns, ...recentTurns];

test('trimHistoryForReplay', async (t) => {
  await t.test('KEEP_FULL_TURNS is 2 (last 2 turns stay intact)', () => {
    assert.equal(KEEP_FULL_TURNS, 2);
  });

  await t.test('a conversation of KEEP_FULL_TURNS turns or fewer is unchanged', () => {
    const twoTurns = [u3, a3, u4, a4];
    const trimmed = trimHistoryForReplay(twoTurns);
    assert.deepEqual(trimmed, twoTurns);
    twoTurns.forEach((m, i) => assert.equal(trimmed[i], m, 'messages within the kept window are passed through by reference'));

    const oneTurn = [u4, a4];
    assert.deepEqual(trimHistoryForReplay(oneTurn), oneTurn);

    assert.deepEqual(trimHistoryForReplay([]), []);
  });

  await t.test('the last 2 turns are replayed byte-identical (same references)', () => {
    const trimmed = trimHistoryForReplay(fullConversation);
    const recentSlice = trimmed.slice(trimmed.length - recentTurns.length);
    assert.deepEqual(recentSlice, recentTurns);
    recentTurns.forEach((m, i) => assert.equal(recentSlice[i], m));
  });

  await t.test('an older assistant turn keeps text, drops reasoning, and placeholders the search-foods payload', () => {
    const trimmed = trimHistoryForReplay(fullConversation);
    const trimmedA1 = trimmed.find((m) => m.id === 'a1');

    assert.ok(!trimmedA1.parts.some((p) => p.type === 'reasoning'), 'reasoning must be dropped');
    assert.ok(!trimmedA1.parts.some((p) => p.type === 'tool-search_foods_batch'), 'the raw search tool part must not survive');
    assert.ok(
      trimmedA1.parts.some((p) => p.type === 'text' && p.text.includes('search_foods_batch')),
      'a compact placeholder naming the tool must replace it, so the model knows a lookup happened',
    );
    assert.ok(trimmedA1.parts.some((p) => p.type === 'text' && p.text === 'It has 450 calories.'), 'the text reply survives');
  });

  await t.test('an older assistant turn keeps every propose_* tool call untouched', () => {
    const trimmed = trimHistoryForReplay(fullConversation);
    const trimmedA2 = trimmed.find((m) => m.id === 'a2');
    assert.deepEqual(trimmedA2, a2, 'propose_* turns are the actionable record of what was offered and must not be altered');
  });

  await t.test('an older user turn keeps barcode grounding data and placeholders the old image', () => {
    const trimmed = trimHistoryForReplay(fullConversation);
    const trimmedU2 = trimmed.find((m) => m.id === 'u2');

    assert.ok(!trimmedU2.parts.some((p) => p.type === 'file'), 'the raw image part must not survive');
    assert.ok(
      trimmedU2.parts.some((p) => p.type === 'data-barcodeAttachment' && p.data.code === '049000028911'),
      'barcode grounding must survive so streamChat can still replay it',
    );
    assert.ok(trimmedU2.parts.some((p) => p.type === 'text' && p.text === 'Here is what I ate'), 'text survives');
  });

  await t.test('an older turn with a calculator call gets it placeholdered, not kept', () => {
    // Reuse the fixture but push the calculator-bearing turn (currently a3,
    // in the kept window) back into the trimmed region by adding two more
    // recent turns after it.
    const u5 = { id: 'u5', role: 'user', parts: [{ type: 'text', text: 'one more thing' }] };
    const a5 = { id: 'a5', role: 'assistant', parts: [{ type: 'text', text: 'sure' }] };
    const conversation = [...olderTurns, u3, a3, u4, a4, u5, a5];

    const trimmed = trimHistoryForReplay(conversation);
    const trimmedA3 = trimmed.find((m) => m.id === 'a3');

    assert.ok(!trimmedA3.parts.some((p) => p.type === 'tool-calculator'), 'the raw calculator payload must not survive');
    assert.ok(
      trimmedA3.parts.some((p) => p.type === 'text' && p.text.includes('calculator')),
      'a placeholder must name the calculator tool',
    );
    assert.ok(!trimmedA3.parts.some((p) => p.type === 'reasoning'), 'reasoning must still be dropped');
  });

  await t.test('never mutates the input messages or their parts', () => {
    const before = JSON.parse(JSON.stringify(fullConversation));
    trimHistoryForReplay(fullConversation);
    assert.deepEqual(fullConversation, before);
  });
});
