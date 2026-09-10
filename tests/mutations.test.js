// Tests for the cross-domain mutation-proposal tools (schemas/mutations.ts,
// services/agent/tools/mutations.ts): propose_mutation and describe_resource.
// Calls each tool's execute() function directly against a real MySQL schema
// rather than going through a live model, following the same convention as
// tests/agentTools.test.js / tests/bodyWeight.test.js.
//
// Also covers the generalized proposal-resolution mechanism
// (services/conversations/store.ts) for a non-nutrition resource, and the
// nutrition goals merge-vs-replace change (services/nutrition/store.ts).
//
// Requires a reachable database (see scripts/testDb.js). If none is
// reachable, every test here is skipped (not failed) so `npm test` still
// passes for someone who hasn't started Docker.
//
// Run with: DB_NAME=workout_log_test_mut npm test
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../scripts/testDb');

// One valid payload per resource/op combination the discriminated union
// covers. Each is expected to parse successfully AND round-trip unchanged
// through propose_mutation's execute (which only echoes validated args).
const VALID_PAYLOADS = [
  { type: 'body_weight_entry.create', weight: 150.5, date: '2024-01-01' },
  { type: 'body_weight_entry.update', id: 1, current_weight: 150, current_date: '2024-01-01', weight: 152 },
  { type: 'body_weight_entry.delete', id: 1, weight: 150, date: '2024-01-01' },

  { type: 'habit.create', name: 'Meditate' },
  { type: 'habit.update', id: 2, current_name: 'Meditate', name: 'Meditate daily', ignore_empty_days: true },
  { type: 'habit.delete', id: 2, name: 'Meditate', tally_count: 5 },

  { type: 'habit_tally.create', habit_name: 'Meditate', date: '2024-01-01', count: 1 },
  { type: 'habit_tally.update', habit_name: 'Meditate', date: '2024-01-01', count: 2, range_start: '08:00', range_end: '08:15' },
  { type: 'habit_tally.delete', habit_name: 'Meditate', date: '2024-01-01', count: 2 },

  { type: 'section.create', label: 'Push Day' },
  { type: 'section.update', id: 3, current_label: 'Push Day', label: 'Push Day (updated)', is_open: false },
  { type: 'section.delete', id: 3, label: 'Push Day', movement_count: 4, variation_count: 9 },

  { type: 'movement.create', section_id: 3, section_name: 'Push Day', label: 'Bench Press' },
  { type: 'movement.update', id: 4, section_name: 'Push Day', current_label: 'Bench Press', label: 'Incline Bench Press' },
  { type: 'movement.delete', id: 4, section_name: 'Push Day', label: 'Bench Press', variation_count: 3 },

  { type: 'variation.create', movement_id: 4, exercise_name: 'Bench Press', label: 'Barbell', weight: 135, reps: 5, date: '2024-01-01' },
  { type: 'variation.update', id: 5, exercise_name: 'Bench Press', current_label: 'Barbell', current_weight: 135, current_reps: 5, weight: 145, reps: 5, notes: 'Felt strong' },
  { type: 'variation.delete', id: 5, exercise_name: 'Bench Press', label: 'Barbell', weight: 145, reps: 5 },

  { type: 'nutrition_goals.update', calories: 2000, protein_g: null },
];

// Malformed payloads that must be rejected at the schema level -- i.e.
// mutationInputSchema.safeParse(...).success is false -- rather than being
// allowed through to propose_mutation's output.
const MALFORMED_PAYLOADS = [
  { type: 'body_weight_entry.create', date: '2024-01-01' }, // missing weight
  { type: 'body_weight_entry.create', weight: 0 }, // weight must be > 0
  { type: 'habit.create', name: '' }, // name must be non-empty
  { type: 'habit.create', name: 'x'.repeat(101) }, // name too long
  { type: 'section.create', label: 'x'.repeat(51) }, // label too long
  { type: 'section.delete', id: 3, label: 'Push Day' }, // missing cascade counts
  { type: 'movement.create', label: 'Bench Press' }, // missing section_id
  { type: 'movement.create', section_id: 3, label: 'Bench Press' }, // missing section_name
  { type: 'movement.create', section_id: 3, section_name: '', label: 'Bench Press' }, // section_name must be non-empty
  { type: 'variation.create', movement_id: 4, label: 'Barbell' }, // missing exercise_name
  { type: 'variation.create', movement_id: 4, exercise_name: '', label: 'Barbell' }, // exercise_name must be non-empty
  { type: 'variation.update', id: 5, exercise_name: 'Bench Press', current_label: 'Barbell', reps: -1 }, // reps must be >= 0
  // update/delete proposals must name what they target, since the card never shows ids
  { type: 'variation.update', id: 5, weight: 145, reps: 5 }, // missing exercise_name and current_label
  { type: 'variation.delete', id: 5, label: 'Barbell' }, // missing exercise_name
  { type: 'movement.update', id: 4, label: 'Incline Bench Press' }, // missing section_name and current_label
  { type: 'movement.delete', id: 4, label: 'Bench Press', variation_count: 3 }, // missing section_name
  { type: 'section.update', id: 3, label: 'Push Day (updated)' }, // missing current_label
  { type: 'habit.update', id: 2, name: 'Meditate daily' }, // missing current_name
  { type: 'body_weight_entry.update', id: 1, weight: 152 }, // missing current_weight and current_date
  { type: 'nutrition_goals.update', calories: -5 }, // calories must be >= 0
  { type: 'habit.delete', id: 1.5, name: 'Meditate', tally_count: 0 }, // id must be an integer
  { type: 'unknown_resource.create', foo: 'bar' }, // no matching union member
  {}, // no discriminator at all
];

test('mutation proposal tools', async (t) => {
  const available = await db.isDbReachable();
  if (!available) {
    t.skip('No reachable database on 127.0.0.1:3307. Start it with: docker compose up -d, then npm run db:setup (see scripts/testDb.js).');
    return;
  }

  await db.setupTestDb();
  const { mutationInputSchema, mutationBatchSchema, proposeMutationInputSchema, RESOURCE_NAMES } = db.requireTs('schemas/mutations.ts');
  const { mutationTools } = db.requireTs('services/agent/tools/mutations.ts');
  const conversations = db.requireTs('services/conversations/store.ts');
  const nutritionStore = db.requireTs('services/nutrition/store.ts');

  t.beforeEach(async () => {
    await db.resetDb();
  });

  t.after(async () => {
    await db.closePool();
  });

  const tools = mutationTools({ userUuid: 'unused-in-these-tools' });

  // ---- propose_mutation: valid payloads ----

  for (const payload of VALID_PAYLOADS) {
    await t.test(`propose_mutation validates and echoes ${payload.type}`, async () => {
      const parsed = mutationInputSchema.safeParse(payload);
      assert.equal(parsed.success, true, parsed.success ? '' : JSON.stringify(parsed.error?.issues));

      const output = await tools.propose_mutation.execute(payload);
      assert.deepEqual(output, payload);
    });
  }

  await t.test('propose_mutation covers exactly one op per resource where only one applies (nutrition_goals)', async () => {
    // nutrition_goals is update-only -- create/delete variants don't exist
    // in the union at all, so a caller can't accidentally propose either.
    assert.equal(mutationInputSchema.safeParse({ type: 'nutrition_goals.create' }).success, false);
    assert.equal(mutationInputSchema.safeParse({ type: 'nutrition_goals.delete', id: 1 }).success, false);
  });

  // ---- propose_mutation: malformed payloads never reach output ----

  for (const payload of MALFORMED_PAYLOADS) {
    await t.test(`propose_mutation rejects malformed payload: ${JSON.stringify(payload)}`, async () => {
      const parsed = mutationInputSchema.safeParse(payload);
      assert.equal(parsed.success, false);
    });
  }

  // ---- Batches: propose_mutation({ mutations: [...] }) ----

  await t.test('a single mutation still validates and echoes as a bare object through the tool\'s actual input schema', async () => {
    const payload = { type: 'section.create', label: 'Push Day' };
    const parsed = proposeMutationInputSchema.safeParse(payload);
    assert.equal(parsed.success, true, parsed.success ? '' : JSON.stringify(parsed.error?.issues));

    const output = await tools.propose_mutation.execute(payload);
    assert.deepEqual(output, payload);
  });

  await t.test('a section + exercise + variation batch validates, resolving refs to the right parent type', async () => {
    const batch = {
      mutations: [
        { type: 'section.create', label: 'Push Day', ref: 'sec1' },
        { type: 'movement.create', section_id: 'ref:sec1', section_name: 'Push Day', label: 'Bench Press', ref: 'ex1' },
        {
          type: 'variation.create', movement_id: 'ref:ex1', exercise_name: 'Bench Press',
          label: 'Barbell', weight: 135, reps: 5, replace_placeholder: true,
        },
      ],
    };
    const parsed = mutationBatchSchema.safeParse(batch);
    assert.equal(parsed.success, true, parsed.success ? '' : JSON.stringify(parsed.error?.issues));

    // Also accepted through the tool's actual (single-or-batch) input schema.
    const viaUnion = proposeMutationInputSchema.safeParse(batch);
    assert.equal(viaUnion.success, true);

    const output = await tools.propose_mutation.execute(batch);
    assert.deepEqual(output, batch);
  });

  await t.test('a batch rejects a ref pointer naming an item that has not appeared yet (forward ref)', async () => {
    const batch = {
      mutations: [
        { type: 'movement.create', section_id: 'ref:sec1', section_name: 'Push Day', label: 'Bench Press' },
        { type: 'section.create', label: 'Push Day', ref: 'sec1' },
      ],
    };
    assert.equal(mutationBatchSchema.safeParse(batch).success, false);
  });

  await t.test('a batch rejects a ref pointer naming an item of the wrong kind', async () => {
    const batch = {
      mutations: [
        { type: 'section.create', label: 'Push Day', ref: 'sec1' },
        // movement_id's ref must point at a movement.create, not a section.create.
        { type: 'variation.create', movement_id: 'ref:sec1', exercise_name: 'Bench Press', label: 'Barbell' },
      ],
    };
    assert.equal(mutationBatchSchema.safeParse(batch).success, false);
  });

  await t.test('a batch rejects an unknown ref name entirely', async () => {
    const batch = {
      mutations: [
        { type: 'movement.create', section_id: 'ref:doesnotexist', section_name: 'Push Day', label: 'Bench Press' },
      ],
    };
    assert.equal(mutationBatchSchema.safeParse(batch).success, false);
  });

  await t.test('a batch rejects two items declaring the same ref name', async () => {
    const batch = {
      mutations: [
        { type: 'section.create', label: 'Push Day', ref: 'sec1' },
        { type: 'section.create', label: 'Pull Day', ref: 'sec1' },
      ],
    };
    assert.equal(mutationBatchSchema.safeParse(batch).success, false);
  });

  await t.test('a batch with a literal numeric parent id (no ref) still validates normally', async () => {
    const batch = {
      mutations: [
        { type: 'movement.create', section_id: 3, section_name: 'Push Day', label: 'Bench Press' },
        { type: 'variation.create', movement_id: 4, exercise_name: 'Bench Press', label: 'Barbell', weight: 135, reps: 5 },
      ],
    };
    assert.equal(mutationBatchSchema.safeParse(batch).success, true);
  });

  await t.test('a batch rejects an empty mutations array', async () => {
    assert.equal(mutationBatchSchema.safeParse({ mutations: [] }).success, false);
  });

  await t.test('a batch rejects a malformed item nested inside an otherwise valid batch', async () => {
    const batch = {
      mutations: [
        { type: 'section.create', label: 'Push Day', ref: 'sec1' },
        { type: 'movement.create', section_id: 'ref:sec1', section_name: '', label: 'Bench Press' }, // section_name empty
      ],
    };
    assert.equal(mutationBatchSchema.safeParse(batch).success, false);
  });

  // ---- describe_resource ----

  for (const resource of RESOURCE_NAMES) {
    await t.test(`describe_resource("${resource}") returns fields and ops`, async () => {
      const result = await tools.describe_resource.execute({ resource });
      assert.equal(result.resource, resource);
      assert.ok(Array.isArray(result.ops) && result.ops.length > 0);
      assert.ok(Array.isArray(result.fields) && result.fields.length > 0);
      for (const field of result.fields) {
        assert.equal(typeof field.name, 'string');
        assert.equal(typeof field.type, 'string');
        assert.equal(typeof field.required, 'boolean');
      }
    });
  }

  await t.test('describe_resource rejects an unknown resource', async () => {
    const result = await tools.describe_resource.execute({ resource: 'not_a_real_resource' });
    assert.ok(result.error);
    assert.match(result.error, /Unknown resource/);
  });

  // ---- proposal resolutions round-trip for a non-nutrition resource ----

  await t.test('a mutation proposal resolution round-trips through the generalized resolutions store', async () => {
    const user = await db.createTestUser();
    const conversationId = await conversations.createConversation(user.uuid);

    // Reuses propose_mutation's own "<resource>.<op>" string as the resolution
    // kind, demonstrating the mechanism is no longer limited to nutrition's
    // original 'entry' | 'custom_food' pair (migrations/024).
    await conversations.saveResolution(
      user.uuid,
      conversationId,
      'call_section_delete_1',
      'section.delete',
      'confirmed',
      'Deleted "Push Day"',
    );

    const rows = await conversations.getResolutions(conversationId);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].tool_call_id, 'call_section_delete_1');
    assert.equal(rows[0].kind, 'section.delete');
    assert.equal(rows[0].status, 'confirmed');
    assert.equal(rows[0].display_name, 'Deleted "Push Day"');
  });

  await t.test('a confirmed batch\'s structured result (created ids, keyed by ref) round-trips through the resolutions store', async () => {
    const user = await db.createTestUser();
    const conversationId = await conversations.createConversation(user.uuid);

    // Shape the client executor is expected to send after confirming the
    // section+exercise+variation batch above: one entry per item, in order,
    // carrying whichever ref named it plus the id the write actually produced.
    const result = [
      { ref: 'sec1', id: 501 },
      { ref: 'ex1', id: 502 },
      { id: 503 },
    ];
    await conversations.saveResolution(
      user.uuid, conversationId, 'call_batch_1', 'batch', 'confirmed', 'Push Day: Bench Press', null, result,
    );

    const rows = await conversations.getResolutions(conversationId);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].kind, 'batch');
    assert.deepEqual(rows[0].result, result);
  });

  await t.test('saving a second resolution for the same tool_call_id overwrites it (upsert)', async () => {
    const user = await db.createTestUser();
    const conversationId = await conversations.createConversation(user.uuid);

    await conversations.saveResolution(user.uuid, conversationId, 'call_habit_1', 'habit.create', 'denied', null);
    await conversations.saveResolution(user.uuid, conversationId, 'call_habit_1', 'habit.create', 'confirmed', 'Meditate');

    const rows = await conversations.getResolutions(conversationId);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].status, 'confirmed');
    assert.equal(rows[0].display_name, 'Meditate');
  });

  // ---- nutrition goals merge semantics (services/nutrition/store.ts) ----

  await t.test('putGoals merges: an absent field preserves the previously stored value', async () => {
    const user = await db.createTestUser();
    await nutritionStore.putGoals(user.uuid, { calories: 2000, protein_g: 150, carbs_g: 250, fat_g: 70, fiber_g: 30 });

    const merged = await nutritionStore.putGoals(user.uuid, { calories: 1800 });
    assert.deepEqual(merged, { calories: 1800, protein_g: 150, carbs_g: 250, fat_g: 70, fiber_g: 30 });
  });

  await t.test('putGoals clears a field only when it is explicitly sent as null', async () => {
    const user = await db.createTestUser();
    await nutritionStore.putGoals(user.uuid, { calories: 2000, protein_g: 150, carbs_g: 250, fat_g: 70, fiber_g: 30 });

    const cleared = await nutritionStore.putGoals(user.uuid, { protein_g: null });
    assert.deepEqual(cleared, { calories: 2000, protein_g: null, carbs_g: 250, fat_g: 70, fiber_g: 30 });
  });
});
