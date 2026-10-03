// Tests for resolveAgentModel (services/agent/index.ts, #396): the single
// place that resolves which OpenAI model the agent runs on, so the model
// passed to openai(...) and the model recorded via recordUsage(...) always agree.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../scripts/testDb');

db.applyTestEnv();
const agent = db.requireTs('services/agent/index.ts');

test('resolveAgentModel', async (t) => {
  const original = process.env.AGENT_MODEL;
  t.afterEach(() => {
    if (original === undefined) delete process.env.AGENT_MODEL; else process.env.AGENT_MODEL = original;
  });

  await t.test('defaults to gpt-5.6-terra when AGENT_MODEL is unset', () => {
    delete process.env.AGENT_MODEL;
    assert.equal(agent.resolveAgentModel(), 'gpt-5.6-terra');
    assert.equal(agent.resolveAgentModel(), agent.DEFAULT_AGENT_MODEL);
  });

  await t.test('defaults to gpt-5.6-terra when AGENT_MODEL is blank', () => {
    process.env.AGENT_MODEL = '';
    assert.equal(agent.resolveAgentModel(), 'gpt-5.6-terra');
  });

  await t.test('defaults to gpt-5.6-terra when AGENT_MODEL is whitespace-only', () => {
    process.env.AGENT_MODEL = '   ';
    assert.equal(agent.resolveAgentModel(), 'gpt-5.6-terra');
  });

  await t.test('uses AGENT_MODEL when set', () => {
    process.env.AGENT_MODEL = 'gpt-5.4-mini';
    assert.equal(agent.resolveAgentModel(), 'gpt-5.4-mini');
  });
});
