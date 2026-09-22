// Shared contract for per-user agent instructions (#382): free-text
// preferences folded into the agent's system prompt (see
// services/agent/prompt/userInstructions.ts). The server validates PUT
// requests with this schema; the client imports the type only, so no zod
// runtime code reaches the client bundle.
import { z } from 'zod';

export const AGENT_INSTRUCTIONS_MAX_LENGTH = 1000;

// PUT /users/agent-instructions body. Trimmed before the length check, so
// whitespace alone never counts against the limit; routes/users.ts stores
// a trimmed-empty result as NULL rather than an empty string.
export const agentInstructionsSchema = z.object({
  instructions: z.string().trim().max(AGENT_INSTRUCTIONS_MAX_LENGTH),
});

export type AgentInstructionsInput = z.infer<typeof agentInstructionsSchema>;

// GET/PUT response shape: the stored value, or null when none is set.
export interface AgentInstructionsResponse {
  instructions: string | null;
}
