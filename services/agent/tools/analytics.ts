// Read-only cross-domain agent tools: query_series (the analytics
// time-series query) plus generic list_resources/get_resource reads spanning
// workouts, body weight, and habits. Two generic resource-discriminated
// tools are used instead of one tool per resource kind to keep the
// cacheable tool-schema prefix small (see services/agent/tokenEstimate.ts).
import { tool } from 'ai';
import type { ToolSet } from 'ai';
import { z } from 'zod';
import { querySeries, AnalyticsError } from '../../analytics';
import * as workoutResources from './workouts';
import { listBodyWeight } from './bodyWeight';
import { listHabitsResource, listHabitTallies } from './habits';
import type { ToolContext, ToolModule } from './registry';

type Resource =
  | 'workout_tree'
  | 'section'
  | 'movement'
  | 'variation'
  | 'variation_history'
  | 'body_weight'
  | 'habit'
  | 'habit_tally';

const RESOURCES: [Resource, ...Resource[]] = [
  'workout_tree', 'section', 'movement', 'variation', 'variation_history', 'body_weight', 'habit', 'habit_tally',
];

/** Strips mysql2 Date objects etc. down to plain JSON, matching the round-trip pattern in tools/nutrition.ts. */
function toJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

async function listResource(
  userUuid: string,
  resource: Resource,
  parentId: string | undefined,
  from: string | undefined,
  to: string | undefined,
) {
  switch (resource) {
    case 'workout_tree':
      return workoutResources.getWorkoutTree(userUuid);
    case 'section':
      return workoutResources.listSections(userUuid);
    case 'movement': {
      if (!parentId) return { error: 'parent_id (sectionId) is required for resource "movement"' };
      const result = await workoutResources.listMovements(userUuid, parentId);
      return result ?? { error: 'Section not found' };
    }
    case 'variation': {
      if (!parentId) return { error: 'parent_id (movementId) is required for resource "variation"' };
      const result = await workoutResources.listVariations(userUuid, parentId);
      return result ?? { error: 'Movement not found' };
    }
    case 'variation_history': {
      if (!parentId) return { error: 'parent_id (variationId) is required for resource "variation_history"' };
      const result = await workoutResources.listVariationHistory(userUuid, parentId, from, to);
      if (result === null) return { error: 'Variation not found' };
      return {
        entries: result,
        note: result.length === 0
          ? 'No history rows -- this variation may simply never have been edited via PATCH, not necessarily untrained.'
          : undefined,
      };
    }
    case 'body_weight':
      return listBodyWeight(userUuid, from, to);
    case 'habit':
      return listHabitsResource(userUuid);
    case 'habit_tally': {
      if (!parentId) return { error: 'parent_id (habitName) is required for resource "habit_tally"' };
      return listHabitTallies(userUuid, parentId, from, to);
    }
    default:
      return { error: `Unknown resource: ${resource}` };
  }
}

async function getResource(userUuid: string, resource: Resource, id: string) {
  switch (resource) {
    case 'section': {
      const result = await workoutResources.getSection(userUuid, id);
      return result ?? { error: 'Section not found' };
    }
    case 'movement': {
      const result = await workoutResources.getMovement(userUuid, id);
      return result ?? { error: 'Movement not found' };
    }
    case 'variation': {
      const result = await workoutResources.getVariation(userUuid, id);
      return result ?? { error: 'Variation not found' };
    }
    default:
      return { error: `Resource "${resource}" has no single-item lookup; use list_resources instead.` };
  }
}

export const analyticsTools: ToolModule = ({ userUuid }: ToolContext): ToolSet => ({
  /** Thin wrapper over services/analytics's querySeries -- the cross-domain trend workhorse. */
  query_series: tool({
    description:
      'Query a bucketed time series for one metric with summary statistics -- never raw rows, so a multi-month trend costs a small fixed number of tokens. Metric identifiers: \'body_weight\'; \'nutrition.<calories|protein_g|carbs_g|fat_g|fiber_g>\'; \'habit:<habitName>\'; \'exercise:<variationId>.<weight|reps|e1rm>\' (get variationId via list_resources/get_resource on \'variation\'). summary.slopePerWeek (a least-squares fit, with summary.r2 as its goodness-of-fit) is the correct way to describe a trend -- NOT summary.change (last minus first), which on daily body weight mostly measures water weight rather than a real trend. Check coverage.coverage (daysWithData / daysInWindow) before answering confidently: a low ratio means a sparsely-logged window, so say that rather than generalizing from a handful of points.',
    inputSchema: z.object({
      metric: z.string().describe('Metric id, e.g. "body_weight", "nutrition.protein_g", "habit:Meditate", "exercise:42.weight".'),
      from: z.string().describe('Inclusive lower bound, YYYY-MM-DD or ISO datetime.'),
      to: z.string().describe('Upper bound, YYYY-MM-DD or ISO datetime; a bare date means through the end of that day.'),
      bucket: z.enum(['day', 'week', 'month']).optional().describe('Bucket width, default day.'),
      agg: z.enum(['avg', 'sum', 'min', 'max', 'last']).optional().describe("Per-bucket aggregation; defaults to the metric's natural one."),
    }),
    execute: async ({ metric, from, to, bucket, agg }) => {
      try {
        return toJson(await querySeries(userUuid, { metric, from, to, bucket, agg }));
      } catch (err) {
        if (err instanceof AnalyticsError) return { error: err.message };
        throw err;
      }
    },
  }),

  /** Generic list across every readable resource kind, discriminated by `resource`. */
  list_resources: tool({
    description:
      'List the user\'s own records for one resource kind. \'workout_tree\': every section with its exercises (movements) and their variations\' current weight/reps, in one call, no parent_id; prefer it over walking section/movement/variation one level at a time. \'section\': top-level, no parent_id. \'movement\': parent_id = sectionId. \'variation\': parent_id = movementId. \'variation_history\': parent_id = variationId, supports from/to -- a variation never edited via PATCH has ZERO history rows, meaning unedited, not untrained. \'body_weight\': no parent_id, supports from/to. \'habit\': the habit registry, no parent_id. \'habit_tally\': parent_id = habitName (tallies are matched by name and can exist for a name no longer in the registry), supports from/to.',
    inputSchema: z.object({
      resource: z.enum(RESOURCES),
      parent_id: z.string().optional().describe('Required for movement/variation/variation_history/habit_tally; see tool description for what it means per kind.'),
      from: z.string().optional().describe('Inclusive lower bound; applies to body_weight/variation_history/habit_tally.'),
      to: z.string().optional().describe('Upper bound; applies to body_weight/variation_history/habit_tally.'),
    }),
    execute: async ({ resource, parent_id, from, to }) =>
      toJson(await listResource(userUuid, resource, parent_id, from, to)),
  }),

  /** Generic single-item fetch, discriminated by `resource`. Only id-addressable kinds support this. */
  get_resource: tool({
    description:
      'Fetch a single record by id. Only \'section\', \'movement\', and \'variation\' support single-item lookup -- other resource kinds have no single-row identity; use list_resources for those instead.',
    inputSchema: z.object({
      resource: z.enum(RESOURCES),
      id: z.string().describe("The record's own id."),
    }),
    execute: async ({ resource, id }) => toJson(await getResource(userUuid, resource, id)),
  }),
});
