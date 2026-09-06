// Shared validated shapes for the agent's propose_mutation tool: one
// write-proposal tool covering every "simple" resource -- body weight
// entries, the habit registry, habit tallies, sections, movements,
// variations, and nutrition goals. Each is small (3-6 fields) so its full
// shape is inlined directly in the discriminated union below, rather than
// making the model look it up via describe_resource first.
//
// propose_entry / propose_custom_food (services/agent/tools/nutrition.ts)
// are deliberately NOT folded in here -- food logging is the hot path and
// its schema is deeply nested, and models select by tool name more
// reliably than by an enum discriminator.
import { z } from 'zod';

// Mirrors utils/validation.ts's validateId: a positive integer id.
const idSchema = z.number().int().positive();

// Mirrors utils/validation.ts's validateLabel (sections/movements/variations).
const labelSchema = z.string().min(1).max(50);

// A bare 'YYYY-MM-DD' or a full ISO datetime string -- mirrors how
// services/bodyWeight/store.ts and services/workouts/variations.ts both
// accept either form for their `date` columns.
const dateStringSchema = z.string().min(1);

const localDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const habitNameSchema = z.string().min(1).max(100);

// ---- Body weight entries ----

export const bodyWeightCreateSchema = z.object({
  type: z.literal('body_weight_entry.create'),
  weight: z.number().positive(),
  date: dateStringSchema.optional(),
});

export const bodyWeightUpdateSchema = z.object({
  type: z.literal('body_weight_entry.update'),
  id: idSchema,
  weight: z.number().positive().optional(),
  date: dateStringSchema.optional(),
});

export const bodyWeightDeleteSchema = z.object({
  type: z.literal('body_weight_entry.delete'),
  id: idSchema,
  // Echoed back (not re-fetched) so the confirm card can show what is being
  // destroyed without a round trip.
  weight: z.number().positive(),
  date: dateStringSchema,
});

// ---- Habit registry ----

export const habitCreateSchema = z.object({
  type: z.literal('habit.create'),
  name: habitNameSchema,
});

export const habitUpdateSchema = z.object({
  type: z.literal('habit.update'),
  id: idSchema,
  name: habitNameSchema.optional(),
  ignore_empty_days: z.boolean().optional(),
});

export const habitDeleteSchema = z.object({
  type: z.literal('habit.delete'),
  id: idSchema,
  name: habitNameSchema,
  // Blast radius: deleteHabit cascades to every tally logged under this name.
  tally_count: z.number().int().nonnegative(),
});

// ---- Habit tallies (keyed by habit_name + date, not id -- registry entries
// and their tallies are joined by name, per services/habits/store.ts) ----

export const habitTallyCreateSchema = z.object({
  type: z.literal('habit_tally.create'),
  habit_name: habitNameSchema,
  date: localDateSchema,
  count: z.number().int().positive().optional(),
});

export const habitTallyUpdateSchema = z.object({
  type: z.literal('habit_tally.update'),
  habit_name: habitNameSchema,
  date: localDateSchema,
  count: z.number().int().nonnegative().optional(),
  range_start: z.string().nullable().optional(),
  range_end: z.string().nullable().optional(),
});

export const habitTallyDeleteSchema = z.object({
  type: z.literal('habit_tally.delete'),
  habit_name: habitNameSchema,
  date: localDateSchema,
  count: z.number().int().nonnegative(),
});

// ---- Sections ----

export const sectionCreateSchema = z.object({
  type: z.literal('section.create'),
  label: labelSchema,
});

export const sectionUpdateSchema = z.object({
  type: z.literal('section.update'),
  id: idSchema,
  label: labelSchema.optional(),
  is_open: z.boolean().optional(),
});

export const sectionDeleteSchema = z.object({
  type: z.literal('section.delete'),
  id: idSchema,
  label: labelSchema,
  // Blast radius: a section delete cascades through its movements, their
  // variations, and every variation's history rows (ON DELETE CASCADE, see
  // migrations/001_initial_schema.sql). Both counts must be gathered (e.g.
  // via the read-only list tools) before proposing this delete, so the
  // confirm card can state the true scope of the destruction.
  movement_count: z.number().int().nonnegative(),
  variation_count: z.number().int().nonnegative(),
});

// ---- Movements ----

export const movementCreateSchema = z.object({
  type: z.literal('movement.create'),
  section_id: idSchema,
  label: labelSchema,
});

export const movementUpdateSchema = z.object({
  type: z.literal('movement.update'),
  id: idSchema,
  label: labelSchema,
});

export const movementDeleteSchema = z.object({
  type: z.literal('movement.delete'),
  id: idSchema,
  label: labelSchema,
  // Blast radius: deleting a movement cascades to its variations.
  variation_count: z.number().int().nonnegative(),
});

// ---- Variations ----

export const variationCreateSchema = z.object({
  type: z.literal('variation.create'),
  movement_id: idSchema,
  label: labelSchema,
  weight: z.number().nonnegative().optional(),
  reps: z.number().int().nonnegative().optional(),
  date: dateStringSchema.optional(),
});

export const variationUpdateSchema = z.object({
  type: z.literal('variation.update'),
  id: idSchema,
  label: labelSchema.optional(),
  weight: z.number().nonnegative().nullable().optional(),
  reps: z.number().int().nonnegative().optional(),
  date: dateStringSchema.optional(),
  notes: z.string().max(2000).nullable().optional(),
});

export const variationDeleteSchema = z.object({
  type: z.literal('variation.delete'),
  id: idSchema,
  label: labelSchema,
  weight: z.number().nullable().optional(),
  reps: z.number().int().nonnegative().optional(),
});

// ---- Nutrition goals ----
// A singleton per user, upserted with merge semantics (see
// services/nutrition/store.ts's putGoals): an absent field leaves the
// stored value alone, an explicit null clears it. There is no id and no
// create/delete op -- "update" (which also creates the row on first use)
// is the only operation this resource supports.

const goalValueSchema = z.number().nonnegative().nullable();

export const nutritionGoalsUpdateSchema = z.object({
  type: z.literal('nutrition_goals.update'),
  calories: goalValueSchema.optional(),
  protein_g: goalValueSchema.optional(),
  carbs_g: goalValueSchema.optional(),
  fat_g: goalValueSchema.optional(),
  fiber_g: goalValueSchema.optional(),
});

export const mutationInputSchema = z.discriminatedUnion('type', [
  bodyWeightCreateSchema,
  bodyWeightUpdateSchema,
  bodyWeightDeleteSchema,
  habitCreateSchema,
  habitUpdateSchema,
  habitDeleteSchema,
  habitTallyCreateSchema,
  habitTallyUpdateSchema,
  habitTallyDeleteSchema,
  sectionCreateSchema,
  sectionUpdateSchema,
  sectionDeleteSchema,
  movementCreateSchema,
  movementUpdateSchema,
  movementDeleteSchema,
  variationCreateSchema,
  variationUpdateSchema,
  variationDeleteSchema,
  nutritionGoalsUpdateSchema,
]);
export type MutationInput = z.infer<typeof mutationInputSchema>;
export type MutationType = MutationInput['type'];

// ---- describe_resource metadata ----
// Hand-authored rather than derived from the zod shapes above, since the
// goal is a terse, model-readable field summary (names/types/units/rules),
// not a full JSON Schema dump -- that's what keeps propose_mutation's own
// inline schemas worth staying terse for.

export const RESOURCE_NAMES = [
  'body_weight_entry',
  'habit',
  'habit_tally',
  'section',
  'movement',
  'variation',
  'nutrition_goals',
] as const;
export type ResourceName = (typeof RESOURCE_NAMES)[number];

export interface ResourceFieldDescription {
  name: string;
  type: string;
  required: boolean;
  notes?: string;
}

export interface ResourceDescription {
  resource: ResourceName;
  ops: Array<'create' | 'update' | 'delete'>;
  fields: ResourceFieldDescription[];
}

export const RESOURCE_DESCRIPTIONS: Record<ResourceName, ResourceDescription> = {
  body_weight_entry: {
    resource: 'body_weight_entry',
    ops: ['create', 'update', 'delete'],
    fields: [
      { name: 'id', type: 'integer > 0', required: false, notes: 'Required for update/delete.' },
      { name: 'weight', type: 'number > 0', required: true, notes: 'No unit is stored; whatever the user tracks in.' },
      { name: 'date', type: 'YYYY-MM-DD or ISO datetime', required: false, notes: 'Defaults to now on create.' },
    ],
  },
  habit: {
    resource: 'habit',
    ops: ['create', 'update', 'delete'],
    fields: [
      { name: 'id', type: 'integer > 0', required: false, notes: 'Required for update/delete.' },
      { name: 'name', type: 'string, 1-100 chars', required: true, notes: 'Unique per user; renaming cascades to that name\'s tallies.' },
      { name: 'ignore_empty_days', type: 'boolean', required: false, notes: 'Excludes empty days from streak/average math.' },
      { name: 'tally_count', type: 'integer >= 0', required: false, notes: 'Delete only: tallies destroyed alongside the habit.' },
    ],
  },
  habit_tally: {
    resource: 'habit_tally',
    ops: ['create', 'update', 'delete'],
    fields: [
      { name: 'habit_name', type: 'string', required: true, notes: 'Keyed by name, not id; need not match a registered habit.' },
      { name: 'date', type: 'YYYY-MM-DD', required: true },
      { name: 'count', type: 'integer >= 0', required: false, notes: 'Times the habit was logged that day.' },
      { name: 'range_start', type: 'string or null', required: false, notes: 'First logged time that day.' },
      { name: 'range_end', type: 'string or null', required: false, notes: 'Most recent logged time that day.' },
    ],
  },
  section: {
    resource: 'section',
    ops: ['create', 'update', 'delete'],
    fields: [
      { name: 'id', type: 'integer > 0', required: false, notes: 'Required for update/delete.' },
      { name: 'label', type: 'string, 1-50 chars', required: true },
      { name: 'is_open', type: 'boolean', required: false, notes: 'Whether the section is expanded in the UI.' },
      { name: 'movement_count', type: 'integer >= 0', required: false, notes: 'Delete only: movements destroyed alongside it.' },
      { name: 'variation_count', type: 'integer >= 0', required: false, notes: 'Delete only: variations (across all its movements) destroyed alongside it.' },
    ],
  },
  movement: {
    resource: 'movement',
    ops: ['create', 'update', 'delete'],
    fields: [
      { name: 'id', type: 'integer > 0', required: false, notes: 'Required for update/delete.' },
      { name: 'section_id', type: 'integer > 0', required: false, notes: 'Required for create; the owning section.' },
      { name: 'label', type: 'string, 1-50 chars', required: true },
      { name: 'variation_count', type: 'integer >= 0', required: false, notes: 'Delete only: variations destroyed alongside it.' },
    ],
  },
  variation: {
    resource: 'variation',
    ops: ['create', 'update', 'delete'],
    fields: [
      { name: 'id', type: 'integer > 0', required: false, notes: 'Required for update/delete.' },
      { name: 'movement_id', type: 'integer > 0', required: false, notes: 'Required for create; the owning movement.' },
      { name: 'label', type: 'string, 1-50 chars', required: false },
      { name: 'weight', type: 'number >= 0 or null', required: false },
      { name: 'reps', type: 'integer >= 0', required: false },
      { name: 'date', type: 'YYYY-MM-DD or ISO datetime', required: false },
      { name: 'notes', type: 'string, <=2000 chars, or null', required: false, notes: 'update only.' },
    ],
  },
  nutrition_goals: {
    resource: 'nutrition_goals',
    ops: ['update'],
    fields: [
      { name: 'calories', type: 'number >= 0 or null', required: false },
      { name: 'protein_g', type: 'number >= 0 or null', required: false },
      { name: 'carbs_g', type: 'number >= 0 or null', required: false },
      { name: 'fat_g', type: 'number >= 0 or null', required: false },
      { name: 'fiber_g', type: 'number >= 0 or null', required: false, notes: 'Merge semantics: omit a field to leave it unchanged, send null to clear it. No id; there is exactly one goals row per user.' },
    ],
  },
};
