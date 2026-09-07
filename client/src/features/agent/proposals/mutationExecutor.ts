// Performs the actual write for a confirmed propose_mutation proposal.
// propose_mutation itself is echo-only (services/agent/tools/mutations.ts) —
// the client is the one REST call away from actually changing data, exactly
// like propose_entry/propose_custom_food's confirm handlers.
//
// Not every (resource, op) pair the schema allows has a matching REST
// endpoint today (body_weight_entry.update and habit_tally.delete have none)
// -- those throw a clear error rather than silently pretending to succeed.
import clientApi from '../../../api/clientApi.js';
import type { MutationInput } from './mutationTypes';

export async function executeMutation(input: MutationInput): Promise<void> {
  switch (input.type) {
    case 'body_weight_entry.create':
      await clientApi.post('/body-weight', { weight: input.weight, date: input.date });
      return;
    case 'body_weight_entry.delete':
      await clientApi.delete(`/body-weight/${input.id}`);
      return;
    case 'body_weight_entry.update':
      throw new Error('Updating a body weight entry is not supported yet.');

    case 'habit.create':
      await clientApi.post('/habits', { name: input.name });
      return;
    case 'habit.update':
      // The habits PATCH route branches on which field is present rather than
      // accepting both in one call — send each field it actually included.
      if (input.name !== undefined) {
        await clientApi.patch(`/habits/${input.id}`, { name: input.name });
      }
      if (input.ignore_empty_days !== undefined) {
        await clientApi.patch(`/habits/${input.id}`, { ignore_empty_days: input.ignore_empty_days });
      }
      return;
    case 'habit.delete':
      await clientApi.delete(`/habits/${input.id}`);
      return;

    case 'habit_tally.create':
      await clientApi.post(`/habits/${encodeURIComponent(String(input.habit_name))}/tally`, { localDate: input.date });
      // The tally endpoint upserts count=1 (or increments); a requested count
      // greater than that needs a follow-up PATCH to set it explicitly.
      if (typeof input.count === 'number' && input.count > 1) {
        await clientApi.patch(`/habits/${encodeURIComponent(String(input.habit_name))}/${input.date}`, { count: input.count });
      }
      return;
    case 'habit_tally.update':
      await clientApi.patch(`/habits/${encodeURIComponent(String(input.habit_name))}/${input.date}`, {
        count: input.count,
        range_start: input.range_start,
        range_end: input.range_end,
      });
      return;
    case 'habit_tally.delete':
      throw new Error('Deleting a habit tally is not supported yet.');

    case 'section.create':
      await clientApi.post('/sections', { label: input.label });
      return;
    case 'section.update':
      await clientApi.patch(`/sections/${input.id}`, { label: input.label, is_open: input.is_open });
      return;
    case 'section.delete':
      await clientApi.delete(`/sections/${input.id}`);
      return;

    case 'movement.create':
      await clientApi.post(`/movements/${input.section_id}`, { label: input.label });
      return;
    case 'movement.update':
      await clientApi.patch(`/movements/${input.id}`, { label: input.label });
      return;
    case 'movement.delete':
      await clientApi.delete(`/movements/${input.id}`);
      return;

    case 'variation.create':
      await clientApi.post(`/variations/${input.movement_id}`, {
        label: input.label,
        weight: input.weight,
        reps: input.reps,
        date: input.date,
      });
      return;
    case 'variation.update':
      await clientApi.patch(`/variations/${input.id}`, {
        label: input.label,
        weight: input.weight,
        reps: input.reps,
        date: input.date,
        notes: input.notes,
      });
      return;
    case 'variation.delete':
      await clientApi.delete(`/variations/${input.id}`);
      return;

    case 'nutrition_goals.update':
      await clientApi.put('/nutrition/goals', {
        calories: input.calories,
        protein_g: input.protein_g,
        carbs_g: input.carbs_g,
        fat_g: input.fat_g,
        fiber_g: input.fiber_g,
      });
      return;

    default:
      throw new Error(`Unknown mutation type "${input.type}".`);
  }
}
