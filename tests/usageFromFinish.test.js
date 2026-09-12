// Tests for services/nutrition/usage.ts's usageDataFromFinishResult and
// computeCost (#325) -- the regression coverage for the outputTokenDetails
// bug: an earlier version read `(usage as any).outputDetails?.reasoningTokens`,
// a field name SDK v7 never populates, so reasoning tokens recorded as 0
// since July. The included "would have failed before" case reconstructs that
// exact bug and shows the field name that fixes it.
//
// usageDataFromFinishResult is a pure mapping function (no DB needed).
// recordUsage's DB round-trip (steps/tool_calls/web_search_calls/cost_usd
// persisted correctly) needs a reachable database and is skipped otherwise.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../scripts/testDb');

const usage = db.requireTs('services/nutrition/usage.ts');

// A realistic SDK v7 onFinish-shaped result: aggregated usage across a
// multi-step turn with two tool calls, one of them web_search.
function realisticFinishResult(overrides = {}) {
  return {
    usage: {
      inputTokens: 12000,
      outputTokens: 800,
      totalTokens: 12800,
      outputTokenDetails: { reasoningTokens: 350 },
      inputTokenDetails: { cacheReadTokens: 9000, noCacheTokens: 3000, cacheWriteTokens: 0 },
    },
    steps: [{}, {}, {}],
    toolCalls: [
      { toolName: 'search_foods_batch' },
      { toolName: 'web_search' },
    ],
    ...overrides,
  };
}

test('usageDataFromFinishResult', async (t) => {
  await t.test('reads reasoning tokens from outputTokenDetails (the SDK v7 field)', () => {
    const data = usage.usageDataFromFinishResult(realisticFinishResult());
    assert.equal(data.reasoningTokens, 350);
  });

  await t.test('regression: the old outputDetails field name (SDK v6-shaped) yields 0, not silently wrong data', () => {
    // Reconstructs the exact bug: a result carrying the OLD field name
    // instead of outputTokenDetails. The fixed code must not find
    // reasoning tokens under the old name -- proving it no longer reads it.
    const buggyShapedResult = realisticFinishResult({
      usage: {
        inputTokens: 12000,
        outputTokens: 800,
        totalTokens: 12800,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        outputDetails: { reasoningTokens: 350 },
        inputTokenDetails: { cacheReadTokens: 9000 },
      },
    });
    const data = usage.usageDataFromFinishResult(buggyShapedResult);
    // Before the fix this test's assertion on the CORRECT field
    // (outputTokenDetails) would have read 0 for a real SDK v7 result too --
    // this case shows an old-shaped result correctly yields 0 rather than
    // accidentally working by coincidence.
    assert.equal(data.reasoningTokens, 0);
  });

  await t.test('reads cached input tokens from inputTokenDetails.cacheReadTokens', () => {
    const data = usage.usageDataFromFinishResult(realisticFinishResult());
    assert.equal(data.cachedInputTokens, 9000);
  });

  await t.test('counts steps and tool calls', () => {
    const data = usage.usageDataFromFinishResult(realisticFinishResult());
    assert.equal(data.steps, 3);
    assert.equal(data.toolCalls, 2);
  });

  await t.test('counts only web_search tool calls toward webSearchCalls', () => {
    const data = usage.usageDataFromFinishResult(realisticFinishResult());
    assert.equal(data.webSearchCalls, 1);
  });

  await t.test('defaults missing usage fields to 0 rather than throwing', () => {
    const data = usage.usageDataFromFinishResult({ usage: {}, steps: [], toolCalls: [] });
    assert.equal(data.inputTokens, 0);
    assert.equal(data.outputTokens, 0);
    assert.equal(data.reasoningTokens, 0);
    assert.equal(data.cachedInputTokens, 0);
    assert.equal(data.totalTokens, 0);
    assert.equal(data.steps, 0);
    assert.equal(data.toolCalls, 0);
    assert.equal(data.webSearchCalls, 0);
  });
});

test('computeCost', async (t) => {
  const originalUncached = process.env.GPT55_INPUT_PER_1M;
  const originalCached = process.env.GPT55_CACHED_INPUT_PER_1M;
  const originalOutput = process.env.GPT55_OUTPUT_PER_1M;
  const originalWebSearch = process.env.WEB_SEARCH_PER_1K_CALLS;

  t.after(() => {
    // usage.ts reads these once at module load, so restoring env vars here
    // is about hygiene for other test files, not about affecting this
    // already-loaded module.
    if (originalUncached === undefined) delete process.env.GPT55_INPUT_PER_1M; else process.env.GPT55_INPUT_PER_1M = originalUncached;
    if (originalCached === undefined) delete process.env.GPT55_CACHED_INPUT_PER_1M; else process.env.GPT55_CACHED_INPUT_PER_1M = originalCached;
    if (originalOutput === undefined) delete process.env.GPT55_OUTPUT_PER_1M; else process.env.GPT55_OUTPUT_PER_1M = originalOutput;
    if (originalWebSearch === undefined) delete process.env.WEB_SEARCH_PER_1K_CALLS; else process.env.WEB_SEARCH_PER_1K_CALLS = originalWebSearch;
  });

  await t.test('prices cached and uncached input separately, at the module\'s loaded defaults', () => {
    // $5.00/1M uncached, $0.50/1M cached, $30.00/1M output (module defaults).
    const data = {
      inputTokens: 1_000_000,
      cachedInputTokens: 400_000,
      outputTokens: 100_000,
      reasoningTokens: 0,
      totalTokens: 1_100_000,
      steps: 1,
      toolCalls: 0,
      webSearchCalls: 0,
    };
    const cost = usage.computeCost(data);
    // uncached: 600,000/1e6 * 5.00 = 3.00; cached: 400,000/1e6 * 0.50 = 0.20; output: 100,000/1e6 * 30.00 = 3.00
    assert.ok(Math.abs(cost - (3.0 + 0.2 + 3.0)) < 1e-9, `expected ~6.20, got ${cost}`);
  });

  await t.test('pricing all input at the uncached rate would overstate cost -- cached must be cheaper', () => {
    const allUncachedEquivalent = usage.computeCost({
      inputTokens: 1_000_000, cachedInputTokens: 0, outputTokens: 0, reasoningTokens: 0,
      totalTokens: 1_000_000, steps: 1, toolCalls: 0, webSearchCalls: 0,
    });
    const halfCached = usage.computeCost({
      inputTokens: 1_000_000, cachedInputTokens: 500_000, outputTokens: 0, reasoningTokens: 0,
      totalTokens: 1_000_000, steps: 1, toolCalls: 0, webSearchCalls: 0,
    });
    assert.ok(halfCached < allUncachedEquivalent);
  });

  await t.test('web search calls add cost proportional to WEB_SEARCH_PER_1K_CALLS', () => {
    const withoutSearch = usage.computeCost({
      inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningTokens: 0,
      totalTokens: 0, steps: 1, toolCalls: 1, webSearchCalls: 0,
    });
    const withSearch = usage.computeCost({
      inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningTokens: 0,
      totalTokens: 0, steps: 1, toolCalls: 1, webSearchCalls: 1000,
    });
    assert.ok(withSearch > withoutSearch);
  });
});

test('recordUsage persists the new usage-detail columns and computed cost', async (t) => {
  const available = await db.isDbReachable();
  if (!available) {
    t.skip('No reachable database on 127.0.0.1:3307. Start it with: docker compose up -d, then npm run db:setup (see scripts/testDb.js).');
    return;
  }

  await db.setupTestDb();
  const pool = db.getPool();

  t.beforeEach(async () => {
    await db.resetDb();
  });

  t.after(async () => {
    await db.closePool();
  });

  await t.test('a realistic onFinish result round-trips through recordUsage into ai_usage', async () => {
    const user = await db.createTestUser();
    const data = usage.usageDataFromFinishResult(realisticFinishResult());

    await usage.recordUsage(user.uuid, 'gpt-5.5', data);

    const [rows] = await pool.query(
      'SELECT * FROM ai_usage WHERE user_uuid = UUID_TO_BIN(?)',
      [user.uuid],
    );
    assert.equal(rows.length, 1);
    const row = rows[0];
    assert.equal(row.reasoning_tokens, 350);
    assert.equal(row.cached_input_tokens, 9000);
    assert.equal(row.steps, 3);
    assert.equal(row.tool_calls, 2);
    assert.equal(row.web_search_calls, 1);
    assert.ok(row.cost_usd > 0);
  });
});
