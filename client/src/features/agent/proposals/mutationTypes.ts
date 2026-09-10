// Client-side mirror of the backend contract in schemas/mutations.ts (kept in
// sync by hand, same convention as features/nutrition/types.ts). Only the
// shape is mirrored here — validation stays server-side; propose_mutation is
// echo-only, so whatever the model produced is exactly what's shown/executed.

export type MutationOp = 'create' | 'update' | 'delete';

export type MutationResource =
  | 'body_weight_entry'
  | 'habit'
  | 'habit_tally'
  | 'section'
  | 'movement'
  | 'variation'
  | 'nutrition_goals';

export interface MutationInput {
  // e.g. "body_weight_entry.create", "section.delete"
  type: string;
  [field: string]: unknown;
}

/** A batch proposal's shape: propose_mutation's alternate `{ mutations }` input. */
export interface MutationBatchInput {
  mutations: MutationInput[];
}

/** Split "resource.op" into its parts; op is undefined if the type is malformed. */
export function parseMutationType(type: string): { resource: string; op: MutationOp | undefined } {
  const dot = type.indexOf('.');
  if (dot === -1) return { resource: type, op: undefined };
  const resource = type.slice(0, dot);
  const op = type.slice(dot + 1) as MutationOp;
  return { resource, op: (op === 'create' || op === 'update' || op === 'delete') ? op : undefined };
}

// The API resource is `movement`, but every user-facing surface in the app
// calls one an exercise (see Section.jsx's Add Exercise), so proposals say
// exercise too rather than exposing the internal name.
export const RESOURCE_LABELS: Record<string, string> = {
  body_weight_entry: 'body weight entry',
  habit: 'habit',
  habit_tally: 'habit tally',
  section: 'section',
  movement: 'exercise',
  variation: 'variation',
  nutrition_goals: 'nutrition goals',
};

export function resourceLabel(resource: string): string {
  return RESOURCE_LABELS[resource] ?? resource.replace(/_/g, ' ');
}

// Fields that are cascade-count metadata on a delete proposal rather than
// data about the record itself — shown with a distinct, cautionary treatment.
export const CASCADE_COUNT_FIELDS = new Set(['movement_count', 'variation_count', 'tally_count']);

export const CASCADE_COUNT_LABELS: Record<string, string> = {
  movement_count: 'exercise(s)',
  variation_count: 'variation(s)',
  tally_count: 'tally row(s)',
};

// Database ids never mean anything to a user, so no proposal card renders
// them as a field — an explicit set here rather than checks scattered across
// render sites, so a field added later fails safe (hidden by default). The
// values stay in the payload; mutationExecutor.ts needs them for the URL.
// `ref` is included too: it's a batch's own bookkeeping name (see
// schemas/mutations.ts), never data about the record itself, and a
// section_id/movement_id holding a "ref:<name>" pointer is hidden the same
// way a real id is — nothing about either means anything to the user.
// replace_placeholder rides along for the same reason: it steers whether the
// write patches an exercise's default set or adds one, which is execution
// detail, not something the user is deciding on.
export const HIDDEN_ID_FIELDS = new Set([
  'id', 'section_id', 'movement_id', 'variation_id', 'ref', 'replace_placeholder',
]);

// A proposal on a child resource carries its parent's display name in this
// field (see schemas/mutations.ts), keyed by resource. Used for the summary
// sent back to the agent ("Bench Press in Push").
export const PARENT_NAME_FIELDS: Record<string, string> = {
  movement: 'section_name',
  variation: 'exercise_name',
};

// Card labels for fields whose key names the parent rather than the value.
export const FIELD_LABELS: Record<string, string> = {
  section_name: 'section',
  exercise_name: 'exercise',
  habit_name: 'habit',
};

// Where a record sits and what it is called lead the card, in this order;
// every other field follows in payload order.
export const LEADING_FIELDS = ['section_name', 'exercise_name', 'habit_name', 'label', 'name'];

// update proposals echo a field's stored value as current_<field>; the card
// pairs it with <field> to render "weight: 115 → 135".
export const CURRENT_VALUE_PREFIX = 'current_';
