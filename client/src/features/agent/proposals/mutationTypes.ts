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

/** Split "resource.op" into its parts; op is undefined if the type is malformed. */
export function parseMutationType(type: string): { resource: string; op: MutationOp | undefined } {
  const dot = type.indexOf('.');
  if (dot === -1) return { resource: type, op: undefined };
  const resource = type.slice(0, dot);
  const op = type.slice(dot + 1) as MutationOp;
  return { resource, op: (op === 'create' || op === 'update' || op === 'delete') ? op : undefined };
}

export const RESOURCE_LABELS: Record<string, string> = {
  body_weight_entry: 'body weight entry',
  habit: 'habit',
  habit_tally: 'habit tally',
  section: 'section',
  movement: 'movement',
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
  movement_count: 'movement(s)',
  variation_count: 'variation(s)',
  tally_count: 'tally row(s)',
};
