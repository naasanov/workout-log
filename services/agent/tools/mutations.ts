// Cross-domain write proposals: propose_mutation is one echo-only tool
// covering every "simple" resource (body weight, habits + tallies,
// sections, movements, variations, nutrition goals), plus describe_resource
// so the model can look up a resource's full field detail without that
// detail bloating propose_mutation's own (cacheable) inline schema.
//
// Like propose_entry / propose_custom_food, propose_mutation never writes
// to the database -- it validates its args with Zod and echoes them back as
// output. The client renders a confirm card from that output and performs
// the actual write itself once the user confirms.
import { tool } from 'ai';
import type { ToolSet } from 'ai';
import { z } from 'zod';
import { proposeMutationInputSchema, RESOURCE_NAMES, RESOURCE_DESCRIPTIONS, ResourceName } from '../../../schemas/mutations';

/**
 * Minimal context this module needs. Deliberately NOT imported from
 * services/agent/tools/registry.ts (owned by a sibling wave and edited
 * concurrently) -- this narrower, structurally-compatible shape lets the
 * orchestrator wire mutationTools in as a normal ToolModule later without
 * this file taking on a build-time dependency on registry.ts.
 */
export interface MutationToolContext {
  userUuid: string;
}

/**
 * Builds the cross-domain mutation-proposal tools for one request.
 * propose_entry / propose_custom_food (services/agent/tools/nutrition.ts)
 * are NOT included here -- food logging keeps its own named tools since its
 * schema is deeply nested and models select by tool name more reliably
 * than by an enum discriminator.
 */
export function mutationTools(_ctx: MutationToolContext): ToolSet {
  return {
    propose_mutation: tool({
      description:
        'Propose creating, updating, or deleting records for simple resources: body weight entries, the habit registry, habit tallies, sections, movements, variations, or nutrition goals. Set `type` to "<resource>.<op>" (e.g. "body_weight_entry.create", "section.delete") for ONE change, or pass `{ mutations: [...] }` -- an ordered list of the same shapes -- to bundle several related changes into ONE confirm card (e.g. a section plus its exercises plus their first sets). A later batch item may reference an earlier item\'s new record by giving that earlier item a `ref` and using "ref:<name>" in place of a real id (section_id/movement_id) -- see the batching guidance in your instructions for the full contract, including how to edit a new exercise\'s placeholder variation instead of duplicating it. Never use this for food entries or custom foods/meals -- use propose_entry / propose_custom_food instead. Call describe_resource first if you need more detail than a field name gives you. A delete must include enough context (label/name, and for section/movement/habit the cascade counts) for the user to see what is being destroyed. This only proposes the change(s) -- the user reviews and confirms once in the UI, and the client performs the write(s).',
      inputSchema: proposeMutationInputSchema,
      execute: async (args) => JSON.parse(JSON.stringify(args)),
    }),

    describe_resource: tool({
      description:
        `Look up the fields, types, and validation rules for one resource usable with propose_mutation. Valid resources: ${RESOURCE_NAMES.join(', ')}. Use this when propose_mutation's terse inline schema isn't enough detail on its own.`,
      inputSchema: z.object({
        resource: z.string().describe(`One of: ${RESOURCE_NAMES.join(', ')}`),
      }),
      // Returns { error } rather than throwing for an unknown resource --
      // matches services/agent/tools/analytics.ts's convention so the model
      // can course-correct within the conversation instead of the whole
      // tool call failing.
      execute: async ({ resource }: { resource: string }) => {
        const description = RESOURCE_DESCRIPTIONS[resource as ResourceName];
        if (!description) {
          return { error: `Unknown resource "${resource}". Valid resources: ${RESOURCE_NAMES.join(', ')}.` };
        }
        return description;
      },
    }),
  };
}
