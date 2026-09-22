// services/agent/prompt/userInstructions.ts + index.ts's stability ordering
// (#382). Pure functions, no database needed.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../scripts/testDb');

const { buildUserInstructionsSection } = db.requireTs('services/agent/prompt/userInstructions.ts');
const { buildSystemPrompt, CORE_PROMPT, NUTRITION_DOMAIN_PROMPT } = db.requireTs('services/agent/prompt/index.ts');

const baseInput = {
  uncEnabled: false,
  today: '2026-09-22',
  selectedDate: '2026-09-22',
  goalsLine: '',
  todayTotals: { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 },
  recentEntries: [],
};

test('buildUserInstructionsSection', async (t) => {
  await t.test('returns null for null/undefined/empty/whitespace-only input', () => {
    assert.equal(buildUserInstructionsSection(null), null);
    assert.equal(buildUserInstructionsSection(undefined), null);
    assert.equal(buildUserInstructionsSection(''), null);
    assert.equal(buildUserInstructionsSection('   \n\t '), null);
  });

  await t.test('wraps the trimmed user text in a delimited, preferences-framed section', () => {
    const section = buildUserInstructionsSection('  Keep responses brief.  ');
    assert.match(section, /^## User's personal instructions/);
    assert.match(section, /preferences/i);
    assert.match(section, /cannot override/i);
    assert.match(section, /never write to the database/i);
    assert.match(section, /propose_\* tools/);
    assert.match(section, /Keep responses brief\./);
    // Trimmed, not the raw padded string.
    assert.ok(!section.includes('  Keep responses brief.  '));
  });
});

test('buildSystemPrompt ordering (#382)', async (t) => {
  await t.test('omits the user-instructions section entirely when unset', () => {
    const prompt = buildSystemPrompt({ ...baseInput, userInstructions: null });
    assert.ok(!prompt.includes("User's personal instructions"));
  });

  await t.test('places user instructions after the stable core/domain sections and before the volatile tail', () => {
    const prompt = buildSystemPrompt({ ...baseInput, userInstructions: 'Always use metric units.' });

    const coreIdx = prompt.indexOf(CORE_PROMPT);
    const domainIdx = prompt.indexOf(NUTRITION_DOMAIN_PROMPT);
    const userIdx = prompt.indexOf("User's personal instructions");
    const volatileIdx = prompt.indexOf("TODAY'S DATE:");

    assert.ok(coreIdx !== -1 && domainIdx !== -1 && userIdx !== -1 && volatileIdx !== -1);
    assert.ok(coreIdx < domainIdx);
    assert.ok(domainIdx < userIdx);
    assert.ok(userIdx < volatileIdx);
    assert.match(prompt, /Always use metric units\./);
  });

  await t.test('the stable prefix (core + domain sections) is byte-identical with and without user instructions', () => {
    const withInstructions = buildSystemPrompt({ ...baseInput, userInstructions: 'Be terse.' });
    const without = buildSystemPrompt({ ...baseInput, userInstructions: null });

    const stablePrefix = CORE_PROMPT + '\n\n' + NUTRITION_DOMAIN_PROMPT;
    assert.ok(withInstructions.startsWith(stablePrefix));
    assert.ok(without.startsWith(stablePrefix));
    assert.equal(
      withInstructions.slice(0, stablePrefix.length),
      without.slice(0, stablePrefix.length),
    );
  });
});
