/**
 * Registers nutrition's tool renderers into the generic agent's registry:
 * propose_entry (inline EntryEditor), propose_custom_food (inline
 * MealBuilder), and calculator/convert_to_grams as hidden deterministic
 * helpers a production incident found littering the timeline with no UI
 * ever reading them back (2,114 stored calculator calls in one case).
 *
 * Importing this module for its side effect (see Workouts.tsx) is what
 * makes propose_entry/propose_custom_food render as confirm cards instead
 * of falling back to the generic ToolCallCard.
 */
import { useQueryClient } from '@tanstack/react-query';
import { useCreateEntry, useCreateCustomFood, nutritionKeys } from './api';
import EntryEditor from './EntryEditor';
import MealBuilder from './MealBuilder';
import { registerToolRenderer } from '../agent/registry';
import type { ToolRendererProps } from '../agent/registry';
import type {
  EntryEditorMode,
  ProposeEntryArgs,
  EntryInput,
  ProposeCustomFoodArgs,
  CustomFoodInput,
} from './types';

function rawArgsOf<T>(part: ToolRendererProps['part']): T {
  return (part.state === 'output-available'
    ? (part as { output: unknown }).output
    : (part as { input: unknown }).input) as T;
}

// propose_entry renders as an inline EntryEditor card. By the time this
// component is invoked the registry has already confirmed the part's state
// is input-available/output-available (see ProcessTimeline's classifier),
// so `rawArgs` always has real proposal data to show.
function ProposeEntryRenderer({ part, context, resolve }: ToolRendererProps) {
  const today = new Date().toISOString().slice(0, 10);
  // rawArgs is safe to read before output-available (rawArgsOf falls back to
  // the tool's input), so the proposal's own date can drive the create/invalidate
  // hook below without breaking the rules of hooks.
  const rawArgs = rawArgsOf<ProposeEntryArgs>(part);
  const proposalDate = rawArgs.date ?? context.selectedDate ?? today;
  const createEntry = useCreateEntry(proposalDate);
  const qc = useQueryClient();

  // The tool's input may carry a base nutrition record instead of macros, which the
  // server resolves into the output. EntryEditor seeds its rows once on mount, so it
  // waits for that output rather than mounting on the unresolved input.
  if (part.state !== 'output-available') return null;

  const mode: EntryEditorMode = { kind: 'proposal', date: proposalDate, proposal: rawArgs };

  function handleDeny() {
    resolve('denied', 'entry');
  }

  async function handleConfirm(input: EntryInput) {
    await createEntry.mutateAsync(input);
    // The editor lets the user change the date before confirming. createEntry's
    // own invalidation targets proposalDate (its day for cache purposes); if the
    // user picked a different day, invalidate that one too so it refreshes.
    if (input.localDate !== proposalDate) {
      qc.invalidateQueries({ queryKey: nutritionKeys.day(input.localDate) });
    }
    // Include the entry name in the confirmed line so the outcome reads as
    // more than just "done".
    const entryName = (input as unknown as { name?: string }).name ?? '';
    resolve('confirmed', 'entry', entryName ? `Logged: ${entryName}` : 'Entry logged!');
  }

  return (
    <EntryEditor
      open={true}
      inline={true}
      mode={mode}
      onClose={handleDeny}
      onConfirm={handleConfirm}
      onDeny={handleDeny}
    />
  );
}

// propose_custom_food renders as an inline pre-filled MealBuilder card.
function ProposeCustomFoodRenderer({ part, resolve }: ToolRendererProps) {
  const createCustomFood = useCreateCustomFood();
  const rawArgs = rawArgsOf<ProposeCustomFoodArgs>(part);

  function handleDeny() {
    resolve('denied', 'custom_food');
  }

  async function handleConfirm(payload: CustomFoodInput) {
    const saved = await createCustomFood.mutateAsync(payload);
    resolve('confirmed', 'custom_food', `Saved: ${saved.name}`);
  }

  return (
    <MealBuilder
      open={true}
      kind={rawArgs.kind}
      proposalArgs={rawArgs}
      onClose={handleDeny}
      onDenyProposal={handleDeny}
      onConfirmProposal={handleConfirm}
    />
  );
}

registerToolRenderer('propose_entry', { kind: 'proposal', Component: ProposeEntryRenderer });
registerToolRenderer('propose_custom_food', { kind: 'proposal', Component: ProposeCustomFoodRenderer });
registerToolRenderer('calculator', { kind: 'hidden' });
registerToolRenderer('convert_to_grams', { kind: 'hidden' });
