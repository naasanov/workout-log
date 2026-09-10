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

// ---- Batch references ----
// A batch item may name itself with `ref` so a LATER item in the same batch
// can point at the record it will create instead of a real id, which does
// not exist yet at propose time. A pointer is the string "ref:<name>" so it
// shares a field with a literal numeric id without ambiguity (real ids are
// numbers; only this one string shape means "resolve me").

const refNameSchema = z
  .string()
  .regex(/^[a-zA-Z][a-zA-Z0-9_]{0,31}$/, 'ref must start with a letter and contain only letters, digits, or underscores (max 32 chars)');

const refPointerSchema = z
  .string()
  .regex(/^ref:[a-zA-Z][a-zA-Z0-9_]{0,31}$/, 'a ref pointer must look like "ref:<name>"');

const idOrRefSchema = z.union([idSchema, refPointerSchema]);

// ---- Body weight entries ----

export const bodyWeightCreateSchema = z.object({
  type: z.literal('body_weight_entry.create'),
  weight: z.number().positive(),
  date: dateStringSchema.optional(),
});

// update schemas carry the target's current values as current_<field>, echoed
// from the read that produced the id, so the confirm card can show what is
// changing ("weight: 185 -> 183") without ever showing the id.
export const bodyWeightUpdateSchema = z.object({
  type: z.literal('body_weight_entry.update'),
  id: idSchema,
  current_weight: z.number().positive(),
  current_date: dateStringSchema,
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
  current_name: habitNameSchema,
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
  // Names this item so a later movement.create in the same batch can point
  // at the section this creates via "ref:<name>" instead of a real id.
  ref: refNameSchema.optional(),
});

export const sectionUpdateSchema = z.object({
  type: z.literal('section.update'),
  id: idSchema,
  current_label: labelSchema,
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
  // Either a real section id, or "ref:<name>" naming a section.create item
  // earlier in the same batch (see idOrRefSchema above).
  section_id: idOrRefSchema,
  // The owning section's display name, required so the confirm card can
  // show "<exercise> in <section name>" rather than a bare section id. The
  // model already has this in hand from the list_resources call that
  // produced section_id, or from the section.create item it just wrote.
  section_name: labelSchema,
  label: labelSchema,
  // Names this item so a later variation.create in the same batch can point
  // at the exercise this creates via "ref:<name>" instead of a real id.
  ref: refNameSchema.optional(),
});

export const movementUpdateSchema = z.object({
  type: z.literal('movement.update'),
  id: idSchema,
  section_name: labelSchema,
  current_label: labelSchema,
  label: labelSchema,
});

export const movementDeleteSchema = z.object({
  type: z.literal('movement.delete'),
  id: idSchema,
  section_name: labelSchema,
  label: labelSchema,
  // Blast radius: deleting a movement cascades to its variations.
  variation_count: z.number().int().nonnegative(),
});

// ---- Variations ----

export const variationCreateSchema = z.object({
  type: z.literal('variation.create'),
  // Either a real movement (exercise) id, or "ref:<name>" naming a
  // movement.create item earlier in the same batch (see idOrRefSchema above).
  movement_id: idOrRefSchema,
  // The owning exercise's display name (the API calls it a movement, but
  // every user-facing surface says "exercise"), required so the confirm
  // card can show "<variation> in <exercise name>" rather than a bare
  // movement id. The model already has this from the list_resources call
  // that produced movement_id, or from the movement.create item it just wrote.
  exercise_name: labelSchema,
  label: labelSchema,
  weight: z.number().nonnegative().optional(),
  reps: z.number().int().nonnegative().optional(),
  date: dateStringSchema.optional(),
  // Names this item for a later batch item to reference (rarely needed --
  // variations aren't usually parents of anything else -- but kept for
  // consistency with the other two create schemas).
  ref: refNameSchema.optional(),
  // True only for the FIRST variation added to an exercise that was just
  // created (this batch, or an earlier confirmed turn) and has not been
  // edited since. Every movement.create auto-inserts one placeholder
  // variation labelled "Variation" -- setting this tells the executor to
  // PATCH that placeholder instead of inserting a second variation. Never
  // set it for a second or later variation on the same exercise.
  replace_placeholder: z.boolean().optional(),
});

export const variationUpdateSchema = z.object({
  type: z.literal('variation.update'),
  id: idSchema,
  exercise_name: labelSchema,
  current_label: labelSchema,
  // The stored record being replaced, so the card reads "weight: 115 -> 135".
  current_weight: z.number().nonnegative().nullable().optional(),
  current_reps: z.number().int().nonnegative().optional(),
  label: labelSchema.optional(),
  weight: z.number().nonnegative().nullable().optional(),
  reps: z.number().int().nonnegative().optional(),
  date: dateStringSchema.optional(),
  notes: z.string().max(2000).nullable().optional(),
});

export const variationDeleteSchema = z.object({
  type: z.literal('variation.delete'),
  id: idSchema,
  exercise_name: labelSchema,
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

// ---- Batches ----
// propose_mutation accepts either ONE mutation (the shape above, unchanged)
// or { mutations: [...] } -- an ORDERED list executed together under a
// single confirmation. Both shapes are accepted (rather than always wrapping
// in an array) so the common single-change case stays exactly as terse as it
// was, while a multi-change proposal (e.g. logging a whole workout) gets one
// card instead of one per change.
//
// The executor MUST run a batch's items in array order and resolve each
// "ref:<name>" pointer to the real id produced by the earlier item whose
// `ref` equals <name> -- refs only ever point backward, which the validation
// below also enforces, so a single left-to-right pass always has what it
// needs.

export const MUTATION_BATCH_MAX_ITEMS = 40;

// Fields that MAY hold a ref pointer instead of a real id, and which
// producing item type they must resolve against. Kept to exactly the two
// parent-id fields that motivate batching (section -> exercise -> variation)
// rather than generalized to every id-shaped field.
const REF_FIELD_RULES: Partial<Record<MutationType, { field: 'section_id' | 'movement_id'; expects: MutationType }>> = {
  'movement.create': { field: 'section_id', expects: 'section.create' },
  'variation.create': { field: 'movement_id', expects: 'movement.create' },
};

function parseRefPointer(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const match = /^ref:([a-zA-Z][a-zA-Z0-9_]{0,31})$/.exec(value);
  return match ? match[1] : null;
}

export const mutationBatchSchema = z
  .object({
    mutations: z.array(mutationInputSchema).min(1).max(MUTATION_BATCH_MAX_ITEMS),
  })
  .superRefine((batch, ctx) => {
    // Maps a ref name to the item type that defined it. Populated strictly
    // left-to-right, AFTER an item's own ref pointer(s) are checked -- so a
    // self-reference or a forward reference is rejected the same way an
    // unknown ref is: the name simply isn't in this map yet.
    const definedRefs = new Map<string, MutationType>();

    batch.mutations.forEach((item, index) => {
      const rule = REF_FIELD_RULES[item.type];
      if (rule) {
        const fieldValue = (item as unknown as Record<string, unknown>)[rule.field];
        const refName = parseRefPointer(fieldValue);
        if (refName !== null) {
          const definedAs = definedRefs.get(refName);
          if (definedAs === undefined) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['mutations', index, rule.field],
              message: `Unknown ref "${refName}" -- refs must name an earlier batch item's "ref" field.`,
            });
          } else if (definedAs !== rule.expects) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['mutations', index, rule.field],
              message: `ref "${refName}" points at a "${definedAs}" item, but ${item.type} needs a "${rule.expects}" ref.`,
            });
          }
        }
      }

      const ref = (item as unknown as Record<string, unknown>).ref;
      if (typeof ref === 'string') {
        if (definedRefs.has(ref)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['mutations', index, 'ref'],
            message: `Duplicate ref "${ref}" -- each ref name must be unique within the batch.`,
          });
        } else {
          definedRefs.set(ref, item.type);
        }
      }
    });
  });
export type MutationBatchInput = z.infer<typeof mutationBatchSchema>;

// The tool's actual inputSchema: one mutation, or a batch of them.
export const proposeMutationInputSchema = z.union([mutationInputSchema, mutationBatchSchema]);
export type ProposeMutationInput = z.infer<typeof proposeMutationInputSchema>;

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
      { name: 'current_weight', type: 'number > 0', required: false, notes: 'Required for update: the entry\'s weight before the change.' },
      { name: 'current_date', type: 'YYYY-MM-DD or ISO datetime', required: false, notes: 'Required for update: the entry\'s date before the change.' },
      { name: 'date', type: 'YYYY-MM-DD or ISO datetime', required: false, notes: 'Defaults to now on create.' },
    ],
  },
  habit: {
    resource: 'habit',
    ops: ['create', 'update', 'delete'],
    fields: [
      { name: 'id', type: 'integer > 0', required: false, notes: 'Required for update/delete.' },
      { name: 'name', type: 'string, 1-100 chars', required: true, notes: 'Unique per user; renaming cascades to that name\'s tallies.' },
      { name: 'current_name', type: 'string', required: false, notes: 'Required for update: the habit\'s name before the change.' },
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
      { name: 'current_label', type: 'string', required: false, notes: 'Required for update: the section\'s label before the change.' },
      { name: 'is_open', type: 'boolean', required: false, notes: 'Whether the section is expanded in the UI.' },
      { name: 'movement_count', type: 'integer >= 0', required: false, notes: 'Delete only: movements destroyed alongside it.' },
      { name: 'variation_count', type: 'integer >= 0', required: false, notes: 'Delete only: variations (across all its movements) destroyed alongside it.' },
      { name: 'ref', type: 'string, letters/digits/underscore, max 32 chars', required: false, notes: 'Create only, in a batch: names this item so a later movement.create can target it via section_id: "ref:<name>".' },
    ],
  },
  movement: {
    resource: 'movement',
    ops: ['create', 'update', 'delete'],
    fields: [
      { name: 'id', type: 'integer > 0', required: false, notes: 'Required for update/delete.' },
      { name: 'section_id', type: 'integer > 0, or "ref:<name>"', required: false, notes: 'Required for create; the owning section. In a batch, "ref:<name>" targets an earlier section.create item\'s ref.' },
      { name: 'section_name', type: 'string, 1-50 chars', required: true, notes: 'The owning section\'s display name, from list_resources or from the section.create item. Shown to the user in place of section_id.' },
      { name: 'label', type: 'string, 1-50 chars', required: true },
      { name: 'current_label', type: 'string', required: false, notes: 'Required for update: the exercise\'s label before the change.' },
      { name: 'variation_count', type: 'integer >= 0', required: false, notes: 'Delete only: variations destroyed alongside it.' },
      { name: 'ref', type: 'string, letters/digits/underscore, max 32 chars', required: false, notes: 'Create only, in a batch: names this item so a later variation.create can target it via movement_id: "ref:<name>".' },
    ],
  },
  variation: {
    resource: 'variation',
    ops: ['create', 'update', 'delete'],
    fields: [
      { name: 'id', type: 'integer > 0', required: false, notes: 'Required for update/delete.' },
      { name: 'movement_id', type: 'integer > 0, or "ref:<name>"', required: false, notes: 'Required for create; the owning exercise. In a batch, "ref:<name>" targets an earlier movement.create item\'s ref.' },
      { name: 'exercise_name', type: 'string, 1-50 chars', required: true, notes: 'The owning exercise\'s display name, from list_resources or from the movement.create item. Shown to the user in place of movement_id.' },
      { name: 'label', type: 'string, 1-50 chars', required: false },
      { name: 'current_label', type: 'string', required: false, notes: 'Required for update: the variation\'s label before the change.' },
      { name: 'current_weight', type: 'number >= 0 or null', required: false, notes: 'Update only: the stored weight being replaced.' },
      { name: 'current_reps', type: 'integer >= 0', required: false, notes: 'Update only: the stored reps being replaced.' },
      { name: 'weight', type: 'number >= 0 or null', required: false },
      { name: 'reps', type: 'integer >= 0', required: false },
      { name: 'date', type: 'YYYY-MM-DD or ISO datetime', required: false, notes: 'Defaults to now when weight or reps change.' },
      { name: 'notes', type: 'string, <=2000 chars, or null', required: false, notes: 'update only.' },
      { name: 'replace_placeholder', type: 'boolean', required: false, notes: 'Create only: true for the exercise\'s first variation, to edit its auto-created placeholder instead of adding a second one.' },
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
