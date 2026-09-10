/**
 * Registers nutrition's tool renderers into the generic agent's registry:
 * propose_entry (inline EntryEditor), propose_custom_food (inline
 * MealBuilder), and calculator/convert_to_grams as hidden deterministic
 * helpers a production incident found littering the timeline with no UI
 * ever reading them back (2,114 stored calculator calls in one case).
 *
 * Importing this module for its side effect (see Workouts.jsx) is what
 * makes propose_entry/propose_custom_food render as confirm cards instead
 * of falling back to the generic ToolCallCard.
 */
import { useCreateEntry, useCreateCustomFood } from './api';
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
  const selectedDate = context.selectedDate ?? new Date().toISOString().slice(0, 10);
  const createEntry = useCreateEntry(selectedDate);

  const rawArgs = rawArgsOf<ProposeEntryArgs>(part);
  const mode: EntryEditorMode = { kind: 'proposal', date: selectedDate, proposal: rawArgs };

  function handleDeny() {
    resolve('denied', 'entry');
  }

  async function handleConfirm(input: EntryInput) {
    await createEntry.mutateAsync(input);
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
