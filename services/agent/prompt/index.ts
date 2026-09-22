// Composes the assembled system prompt from separate stable/volatile pieces.
import { CORE_PROMPT } from './core';
import { NUTRITION_DOMAIN_PROMPT, UNC_DINING_PROMPT } from './nutrition';
import { buildVolatileContext, VolatileContextInput, ConfirmedResult } from './context';
import { buildUserInstructionsSection } from './userInstructions';

export interface BuildSystemPromptInput extends VolatileContextInput {
  uncEnabled: boolean;
  /** The user's own free-text agent preferences (#382), or null/undefined when unset. */
  userInstructions?: string | null;
}

/**
 * Assemble the system prompt in STABILITY order, not narrative order:
 *   1. CORE_PROMPT — shared role/rules, byte-identical on every request.
 *   2. Per-domain stable sections (nutrition, then UNC dining if enabled) —
 *      identical for a given account across requests.
 *   3. The user's own instructions (#382), when set — per-account but stable
 *      across a given account's requests, unlike the volatile tail below.
 *   4. The volatile tail from buildVolatileContext — date, goals, today's
 *      totals, recent meals, autoConfirm/deniedProposalCount flags — which
 *      can differ on every single request.
 *
 * The system prompt and tool schemas sit in the request's cacheable prefix.
 * Any volatile text placed BEFORE stable text invalidates the provider's
 * cache for everything after it, so nothing volatile may precede stable
 * content here. Do not "clean up" this ordering by moving the date or user
 * context earlier for readability — that would defeat prompt caching.
 */
export function buildSystemPrompt(input: BuildSystemPromptInput): string {
  const sections = [CORE_PROMPT, NUTRITION_DOMAIN_PROMPT];
  if (input.uncEnabled) sections.push(UNC_DINING_PROMPT);
  const userSection = buildUserInstructionsSection(input.userInstructions);
  if (userSection) sections.push(userSection);
  sections.push(buildVolatileContext(input));
  return sections.join('\n\n');
}

export { CORE_PROMPT, NUTRITION_DOMAIN_PROMPT, UNC_DINING_PROMPT };
export { buildUserInstructionsSection };
export type { ConfirmedResult };
