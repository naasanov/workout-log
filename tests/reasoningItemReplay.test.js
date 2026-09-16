// Regression test for #355: trimHistoryForReplay dropped an older turn's
// `reasoning` part while keeping its paired `text` part's OpenAI item-id
// metadata. Replaying that text part alone made the SDK reference a stored
// server-side item whose required reasoning partner was gone, which OpenAI's
// Responses API rejects with a 400 ("Item 'msg_...' ... without its required
// 'reasoning' item: 'rs_...'"). Pure function tests, no database needed.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../scripts/testDb');

const { trimHistoryForReplay } = db.requireTs('services/agent/history.ts');
const { convertToModelMessages } = require('ai');

// Shaped like a real captured response: a `reasoning` part and a `text` part
// that share one turn, each carrying OpenAI's Responses-API item id under
// `providerMetadata.openai.itemId` -- exactly what ties them together server-side.
function reasoningPairedTurn(n) {
  return [
    { id: `u${n}`, role: 'user', parts: [{ type: 'text', text: `message ${n}` }] },
    {
      id: `a${n}`,
      role: 'assistant',
      parts: [
        {
          type: 'reasoning',
          text: `thinking ${n}`,
          providerMetadata: { openai: { itemId: `rs_${n}` } },
        },
        {
          type: 'text',
          text: `reply ${n}`,
          providerMetadata: { openai: { itemId: `msg_${n}`, phase: 'final_answer' } },
        },
      ],
    },
  ];
}

function proposeTurn(n) {
  return [
    { id: `u${n}`, role: 'user', parts: [{ type: 'text', text: `message ${n}` }] },
    {
      id: `a${n}`,
      role: 'assistant',
      parts: [
        {
          type: 'tool-propose_mutation',
          toolCallId: `c${n}`,
          state: 'output-available',
          input: { type: 'entry.create', name: 'Coke' },
          output: { echoed: true },
          callProviderMetadata: { openai: { itemId: `fc_${n}` } },
        },
        {
          type: 'text',
          text: `reply ${n}`,
          providerMetadata: { openai: { itemId: `msg_${n}`, phase: 'final_answer' } },
        },
      ],
    },
  ];
}

// 7 user turns of reasoning-paired fixtures: enough to clear the 6th-turn
// threshold (KEEP_FULL_TURNS=2, TRIM_BLOCK_TURNS=4) so the first 4 land in
// the trimmed region and the rest replay untouched.
function conversation(turns, turnBuilder = reasoningPairedTurn) {
  const messages = [];
  for (let n = 1; n <= turns; n++) messages.push(...turnBuilder(n));
  return messages;
}

test('trimHistoryForReplay strips OpenAI item-id metadata from surviving parts (#355)', async (t) => {
  await t.test('an older assistant text part loses its providerMetadata once reasoning is dropped', () => {
    const trimmed = trimHistoryForReplay(conversation(7));
    const a1 = trimmed.find((m) => m.id === 'a1');
    assert.ok(!a1.parts.some((p) => p.type === 'reasoning'), 'reasoning is dropped');
    const textPart = a1.parts.find((p) => p.type === 'text');
    assert.equal(textPart.text, 'reply 1', 'the text content itself is preserved');
    assert.ok(!Object.prototype.hasOwnProperty.call(textPart, 'providerMetadata'), 'providerMetadata is stripped, not just emptied');
  });

  await t.test('an older propose_* tool call loses its item-id metadata too, but keeps its input/output', () => {
    const trimmed = trimHistoryForReplay(conversation(7, proposeTurn));
    const a1 = trimmed.find((m) => m.id === 'a1');
    const toolPart = a1.parts.find((p) => p.type === 'tool-propose_mutation');
    assert.ok(!Object.prototype.hasOwnProperty.call(toolPart, 'callProviderMetadata'));
    assert.deepEqual(toolPart.input, { type: 'entry.create', name: 'Coke' });
    assert.deepEqual(toolPart.output, { echoed: true });
    const textPart = a1.parts.find((p) => p.type === 'text');
    assert.ok(!Object.prototype.hasOwnProperty.call(textPart, 'providerMetadata'));
  });

  await t.test('untrimmed recent turns keep their reasoning and item-id metadata exactly as received', () => {
    const messages = conversation(7);
    const trimmed = trimHistoryForReplay(messages);
    const a7 = trimmed.find((m) => m.id === 'a7');
    const original = messages.find((m) => m.id === 'a7');
    assert.equal(a7, original, 'recent turns pass through by reference, untouched');
    assert.ok(a7.parts.some((p) => p.type === 'reasoning'));
    assert.equal(a7.parts.find((p) => p.type === 'text').providerMetadata.openai.itemId, 'msg_7');
  });

  await t.test('short conversations under the trim threshold keep every item id untouched', () => {
    const messages = conversation(5);
    const trimmed = trimHistoryForReplay(messages);
    assert.deepEqual(trimmed, messages);
    const a1 = trimmed.find((m) => m.id === 'a1');
    assert.equal(a1.parts.find((p) => p.type === 'text').providerMetadata.openai.itemId, 'msg_1');
  });

  // The actual failure mode: with the stripped metadata, convertToModelMessages
  // (the exact function services/agent/index.ts calls before streamText) no
  // longer attaches `providerOptions.openai.itemId` to the assistant text
  // content -- the one field the OpenAI provider reads to decide whether to
  // replay a part as a bare `item_reference` instead of inline text. Without
  // it, there is nothing left that requires a matching stored reasoning item.
  await t.test('convertToModelMessages carries no OpenAI itemId for a trimmed turn, but keeps it for a recent one', async () => {
    const trimmed = trimHistoryForReplay(conversation(7));
    const modelMessages = await convertToModelMessages(trimmed);

    const trimmedAssistant = modelMessages.find(
      (m) => m.role === 'assistant' && m.content.some((c) => c.type === 'text' && c.text === 'reply 1'),
    );
    const trimmedText = trimmedAssistant.content.find((c) => c.type === 'text');
    assert.equal(trimmedText.providerOptions, undefined, 'no item_reference is possible without providerOptions');

    const recentAssistant = modelMessages.find(
      (m) => m.role === 'assistant' && m.content.some((c) => c.type === 'text' && c.text === 'reply 7'),
    );
    const recentText = recentAssistant.content.find((c) => c.type === 'text');
    assert.equal(recentText.providerOptions.openai.itemId, 'msg_7', 'recent turns are unaffected');
  });
});
