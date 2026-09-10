// Unit tests for the assistant-text citation stripper
// (client/src/features/agent/citations.ts). Pure string logic, no database.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

// The client is an ES module package, so this loads through Node's native
// type stripping rather than the server's CommonJS ts-node hook.
const load = import(path.join(__dirname, '../client/src/features/agent/citations.ts'));
let stripCitationTokens;
test.before(async () => {
  ({ stripCitationTokens } = await load);
});

test('leaves hyphenated text such as dates and splits intact', () => {
  const text = 'Proposing **3 tallies** for today (**2026-09-10**) on your Push-Pull-Legs split, 3-5 sets.';
  assert.equal(stripCitationTokens(text), text);
});

test('strips a private-use-delimited citation span', () => {
  assert.equal(stripCitationTokens('Oats are filling.citeturn0search1 Eat up.'), 'Oats are filling. Eat up.');
});

test('strips bare cite and turn tokens', () => {
  assert.equal(stripCitationTokens('Good source citeturn1view1 here'), 'Good source  here');
  assert.equal(stripCitationTokens('Protein matters turn0search1 a lot'), 'Protein matters a lot');
});
