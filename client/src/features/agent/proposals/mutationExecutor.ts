// Performs the actual write for a confirmed propose_mutation proposal.
// propose_mutation itself is echo-only (services/agent/tools/mutations.ts) —
// the client is the one REST call away from actually changing data, exactly
// like propose_entry/propose_custom_food's confirm handlers.
//
// A batch (see schemas/mutations.ts's mutationBatchSchema) runs as an
// ordered sequence of these same REST calls, resolving "ref:<name>" pointers
// against ids produced by earlier items. There is no server-side
// transaction, so a failure partway through leaves the earlier items
// genuinely applied — see executeMutationBatch's doc comment for how that's
// reported rather than hidden.
import clientApi from '../../../api/clientApi.js';
import queryClient from '../../../api/queryClient.js';
import type { MutationInput } from './mutationTypes';

// ---------------------------------------------------------------------------
// Mutation type -> invalidated query keys.
//
// A partial-key array invalidates every query whose own key starts with it
// (React Query's default, non-exact match), so ['movements'] here covers
// every per-section movements query without needing to know section ids.
//
// `satisfies Record<KnownMutationType, ...>` makes the mapping exhaustive at
// compile time for every type this file currently knows about; the runtime
// lookup in queryKeysForMutationType is the backstop for a mutation type
// that a future server change adds before this map is updated (the client's
// MutationInput['type'] is a loose string, not a literal union, precisely so
// the echo-only card keeps rendering unknown types instead of refusing them
// — see mutationTypes.ts).
// ---------------------------------------------------------------------------

type KnownMutationType =
  | 'body_weight_entry.create' | 'body_weight_entry.update' | 'body_weight_entry.delete'
  | 'habit.create' | 'habit.update' | 'habit.delete'
  | 'habit_tally.create' | 'habit_tally.update' | 'habit_tally.delete'
  | 'section.create' | 'section.update' | 'section.delete'
  | 'movement.create' | 'movement.update' | 'movement.delete'
  | 'variation.create' | 'variation.update' | 'variation.delete'
  | 'nutrition_goals.update';

const MUTATION_QUERY_KEYS = {
  'body_weight_entry.create': [['body-weight']],
  'body_weight_entry.update': [['body-weight']],
  'body_weight_entry.delete': [['body-weight']],

  'habit.create': [['habits-registry']],
  'habit.update': [['habits-registry'], ['habits']],
  'habit.delete': [['habits-registry'], ['habits']],

  'habit_tally.create': [['habits']],
  'habit_tally.update': [['habits']],
  'habit_tally.delete': [['habits']],

  'section.create': [['sections']],
  'section.update': [['sections']],
  // Cascades through movements and their variations server-side.
  'section.delete': [['sections'], ['movements'], ['variations']],

  'movement.create': [['movements']],
  'movement.update': [['movements']],
  // Cascades through the movement's variations server-side.
  'movement.delete': [['movements'], ['variations']],

  'variation.create': [['variations']],
  'variation.update': [['variations']],
  'variation.delete': [['variations']],

  'nutrition_goals.update': [['nutrition', 'goals']],
} satisfies Record<KnownMutationType, ReadonlyArray<ReadonlyArray<unknown>>>;

function queryKeysForMutationType(type: string): ReadonlyArray<ReadonlyArray<unknown>> {
  const keys = (MUTATION_QUERY_KEYS as Record<string, ReadonlyArray<ReadonlyArray<unknown>>>)[type];
  if (!keys) {
    // A mutation type with no invalidation entry would otherwise leave the
    // UI silently stale — surface it loudly instead of skipping it.
    console.error(`[mutationExecutor] no query-key invalidation mapped for mutation type "${type}"`);
    return [];
  }
  return keys;
}

/** Invalidates the union of query keys for every given mutation type, once. */
function invalidateForTypes(types: string[]): void {
  const seen = new Set<string>();
  for (const type of types) {
    for (const key of queryKeysForMutationType(type)) {
      const cacheKey = JSON.stringify(key);
      if (seen.has(cacheKey)) continue;
      seen.add(cacheKey);
      queryClient.invalidateQueries({ queryKey: key as unknown[] });
    }
  }
}

// ---------------------------------------------------------------------------
// Ref resolution — see schemas/mutations.ts's REF_FIELD_RULES. The server
// already rejects forward/self/unknown/duplicate/wrong-type refs at
// validation time, so a well-formed batch always has what it needs; this
// still throws rather than guessing if something is unresolved, since
// silently writing under the wrong parent id is worse than failing loudly.
// ---------------------------------------------------------------------------

function resolveIdField(value: unknown, refMap: Map<string, number>): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const match = /^ref:([a-zA-Z][a-zA-Z0-9_]{0,31})$/.exec(value);
    if (match) {
      const resolved = refMap.get(match[1]);
      if (resolved === undefined) {
        throw new Error(`Unresolved ref "${value}" — no earlier batch item declared ref "${match[1]}".`);
      }
      return resolved;
    }
  }
  throw new Error(`Expected a numeric id or "ref:<name>" pointer, got ${JSON.stringify(value)}.`);
}

/**
 * Resolves which variation to PATCH for `replace_placeholder: true`.
 * Every movement.create auto-inserts one placeholder variation, so this
 * list is expected to have exactly one row; anything else means the
 * exercise wasn't actually fresh, so this fails loudly rather than picking
 * an arbitrary row or leaving a duplicate.
 */
async function resolvePlaceholderVariationId(movementId: number): Promise<number> {
  const res = await clientApi.get(`/variations/movement/${movementId}`);
  const rows = (res.data.data ?? []) as { id: number }[];
  if (rows.length !== 1) {
    throw new Error(
      `Expected exactly one placeholder variation for exercise ${movementId} to replace, found ${rows.length}.`,
    );
  }
  return rows[0].id;
}

/**
 * Executes one mutation item against the REST API, resolving any
 * "ref:<name>" pointer in its parent-id field first. Returns the id of the
 * affected record when one exists (the new id for a create, the target id
 * for an update/delete), or undefined for name-keyed resources that have no
 * id (habit tallies, nutrition goals).
 */
async function runMutationItem(input: MutationInput, refMap: Map<string, number>): Promise<number | undefined> {
  switch (input.type) {
    case 'body_weight_entry.create': {
      const res = await clientApi.post('/body-weight', { weight: input.weight, date: input.date });
      return res.data.data.id;
    }
    case 'body_weight_entry.delete':
      await clientApi.delete(`/body-weight/${input.id}`);
      return input.id as number;
    case 'body_weight_entry.update':
      await clientApi.patch(`/body-weight/${input.id}`, { weight: input.weight, date: input.date });
      return input.id as number;

    case 'habit.create': {
      const res = await clientApi.post('/habits', { name: input.name });
      return res.data.data.id;
    }
    case 'habit.update':
      // The habits PATCH route branches on which field is present rather than
      // accepting both in one call — send each field it actually included.
      if (input.name !== undefined) {
        await clientApi.patch(`/habits/${input.id}`, { name: input.name });
      }
      if (input.ignore_empty_days !== undefined) {
        await clientApi.patch(`/habits/${input.id}`, { ignore_empty_days: input.ignore_empty_days });
      }
      return input.id as number;
    case 'habit.delete':
      await clientApi.delete(`/habits/${input.id}`);
      return input.id as number;

    case 'habit_tally.create':
      await clientApi.post(`/habits/${encodeURIComponent(String(input.habit_name))}/tally`, { localDate: input.date });
      // The tally endpoint upserts count=1 (or increments); a requested count
      // greater than that needs a follow-up PATCH to set it explicitly.
      if (typeof input.count === 'number' && input.count > 1) {
        await clientApi.patch(`/habits/${encodeURIComponent(String(input.habit_name))}/${input.date}`, { count: input.count });
      }
      return undefined;
    case 'habit_tally.update':
      await clientApi.patch(`/habits/${encodeURIComponent(String(input.habit_name))}/${input.date}`, {
        count: input.count,
        range_start: input.range_start,
        range_end: input.range_end,
      });
      return undefined;
    case 'habit_tally.delete':
      await clientApi.delete(`/habits/${encodeURIComponent(String(input.habit_name))}/${input.date}`);
      return undefined;

    case 'section.create': {
      const res = await clientApi.post('/sections', { label: input.label });
      return res.data.data.sectionId;
    }
    case 'section.update':
      await clientApi.patch(`/sections/${input.id}`, { label: input.label, is_open: input.is_open });
      return input.id as number;
    case 'section.delete':
      await clientApi.delete(`/sections/${input.id}`);
      return input.id as number;

    case 'movement.create': {
      const sectionId = resolveIdField(input.section_id, refMap);
      const res = await clientApi.post(`/movements/${sectionId}`, { label: input.label });
      return res.data.data.movementId;
    }
    case 'movement.update':
      await clientApi.patch(`/movements/${input.id}`, { label: input.label });
      return input.id as number;
    case 'movement.delete':
      await clientApi.delete(`/movements/${input.id}`);
      return input.id as number;

    case 'variation.create': {
      const movementId = resolveIdField(input.movement_id, refMap);
      if (input.replace_placeholder) {
        const placeholderId = await resolvePlaceholderVariationId(movementId);
        await clientApi.patch(`/variations/${placeholderId}`, {
          label: input.label,
          weight: input.weight,
          reps: input.reps,
          date: input.date,
        });
        return placeholderId;
      }
      const res = await clientApi.post(`/variations/${movementId}`, {
        label: input.label,
        weight: input.weight,
        reps: input.reps,
        date: input.date,
      });
      return res.data.data.variationId;
    }
    case 'variation.update':
      await clientApi.patch(`/variations/${input.id}`, {
        label: input.label,
        weight: input.weight,
        reps: input.reps,
        date: input.date,
        notes: input.notes,
      });
      return input.id as number;
    case 'variation.delete':
      await clientApi.delete(`/variations/${input.id}`);
      return input.id as number;

    case 'nutrition_goals.update':
      await clientApi.put('/nutrition/goals', {
        calories: input.calories,
        protein_g: input.protein_g,
        carbs_g: input.carbs_g,
        fat_g: input.fat_g,
        fiber_g: input.fiber_g,
      });
      return undefined;

    default:
      throw new Error(`Unknown mutation type "${(input as { type: string }).type}".`);
  }
}

export interface MutationExecutionResult {
  /** The affected record's id, when this resource has one. */
  id?: number;
}

/** Executes a single (non-batch) confirmed mutation. Unchanged public shape. */
export async function executeMutation(input: MutationInput): Promise<MutationExecutionResult> {
  const id = await runMutationItem(input, new Map());
  invalidateForTypes([input.type]);
  return { id };
}

export interface MutationItemResult {
  /** Present when the item declared a `ref`. */
  ref?: string;
  /** The affected record's id, on success. */
  id?: number;
  /** Present instead of `id` when this item failed. */
  error?: string;
}

export interface BatchExecutionOutcome {
  /** True only if every item in the batch succeeded. */
  ok: boolean;
  /**
   * One entry per ATTEMPTED item, in order. On failure, execution stops
   * immediately — this array then covers every item up to and including the
   * failed one, and nothing after it was attempted at all. See
   * executeMutationBatch's doc comment for why partial application is
   * reported this way rather than hidden or retried.
   */
  results: MutationItemResult[];
}

/**
 * Executes a confirmed batch of mutations in order, resolving "ref:<name>"
 * pointers against ids produced by earlier items.
 *
 * Partial-failure policy: these are independent REST calls with no server
 * transaction, so a failure partway through leaves everything before it
 * genuinely written. Retrying the whole batch would redo those already-
 * applied writes (re-creating the same section a second time, etc.), so
 * this stops at the first failure rather than continuing or restarting, and
 * reports exactly what succeeded — `outcome.ok` is false and the failed
 * item's entry carries `error` instead of `id` — so the caller can tell the
 * user the truth instead of a blanket "done". Query invalidation still runs
 * for every mutation type that did succeed, so the partial result is
 * visible in the UI immediately.
 */
export async function executeMutationBatch(items: MutationInput[]): Promise<BatchExecutionOutcome> {
  const refMap = new Map<string, number>();
  const results: MutationItemResult[] = [];
  const succeededTypes: string[] = [];

  for (const item of items) {
    const ref = typeof item.ref === 'string' ? item.ref : undefined;
    try {
      const id = await runMutationItem(item, refMap);
      if (ref) {
        if (id === undefined) {
          throw new Error(`Item declared ref "${ref}" but its resource has no id to record.`);
        }
        refMap.set(ref, id);
      }
      results.push(ref ? { ref, id } : { id });
      succeededTypes.push(item.type);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to apply this change.';
      results.push(ref ? { ref, error: message } : { error: message });
      invalidateForTypes(succeededTypes);
      return { ok: false, results };
    }
  }

  invalidateForTypes(succeededTypes);
  return { ok: true, results };
}
