// Volatile per-request prompt context: today's date, the user's goals/totals,
// recent meals, and per-turn flags. Every value here can differ between two
// requests from the SAME account, which is exactly why it is assembled
// separately and placed last by ./index.ts rather than inlined earlier.
import type { recentEntries } from '../../nutrition/store';

export interface VolatileContextInput {
  /** ISO-8601 date string: YYYY-MM-DD — the day the user is currently viewing */
  selectedDate: string;
  /** Name of the client tab the user is currently on (e.g. "workouts", "nutrition"). */
  tab?: string;
  /** The specific resource the user is currently focused on within their tab, if any. */
  focusedResource?: { type: string; id: string | number };
  goalsLine: string;
  todayTotals: { calories: number; protein_g: number; carbs_g: number; fat_g: number };
  recentEntries: Awaited<ReturnType<typeof recentEntries>>;
  /** When true, instructs the agent to log the entry immediately without asking follow-up questions. */
  autoConfirm?: boolean;
  /**
   * How many proposals the user denied since their previous message. Transient
   * per-turn signal (the client passes it in the request body) folded into the
   * system prompt so the agent reconsiders — kept out of the visible user message.
   */
  deniedProposalCount?: number;
}

/** Build a compact text summary of recent entries for the system prompt context block. */
function summariseEntries(entries: VolatileContextInput['recentEntries']): string {
  if (entries.length === 0) return '(none)';
  return entries
    .map((e) => {
      const macros = `${Math.round(e.calories)} kcal, ${Math.round(e.protein_g)}g P, ${Math.round(e.carbs_g)}g C, ${Math.round(e.fat_g)}g F`;
      return `  • ${e.date} ${e.meal}: ${e.name} — ${macros}`;
    })
    .join('\n');
}

/** Assemble the volatile tail of the system prompt from this request's context. */
export function buildVolatileContext({
  selectedDate,
  tab,
  focusedResource,
  goalsLine,
  todayTotals,
  recentEntries,
  autoConfirm,
  deniedProposalCount,
}: VolatileContextInput): string {
  let block = `\
TODAY'S DATE: ${selectedDate}

## User context
**Goals:** ${goalsLine || 'not set'}
**Today (${selectedDate}) so far:** ${Math.round(todayTotals.calories)} kcal, ${Math.round(todayTotals.protein_g)}g P, ${Math.round(todayTotals.carbs_g)}g C, ${Math.round(todayTotals.fat_g)}g F

**Recent meals (last 3 days):**
${summariseEntries(recentEntries)}`;

  // Where the user is looking right now, for resolving vague references like
  // "this exercise" or "today" -- not a restriction on what you may query.
  // You can still look up any resource on any tab.
  const location = [
    tab ? `tab: ${tab}` : null,
    focusedResource ? `focused on ${focusedResource.type} #${focusedResource.id}` : null,
  ].filter(Boolean).join(', ');
  if (location) {
    block += `\n\n**Viewing:** ${location} -- resolves vague refs like "this"/"today"; not restrictive, query any resource.`;
  }

  if (autoConfirm) {
    block += '\n\nIMPORTANT: This is an automated API call. Do NOT ask any follow-up questions. Do NOT ask for confirmation. Log the food entry immediately based on the prompt provided. Use your best judgment on quantities and macros. Call propose_entry as soon as you have identified the food and estimated the portion.';
  }

  const denied = deniedProposalCount ?? 0;
  if (denied > 0) {
    block += `\n\nIMPORTANT: The user just DENIED your ${denied > 1 ? 'previous proposals' : 'previous proposal'} (the propose_entry/propose_custom_food card${denied > 1 ? 's' : ''} above). Do not simply re-send the same proposal — reconsider your approach based on their latest message, and adjust the food, portion, or macros accordingly before proposing again.`;
  }

  return block;
}
