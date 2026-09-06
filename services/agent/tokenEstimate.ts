// Rough, tokenizer-free token accounting for the assembled system prompt and
// tool schemas, so later optimization work has a before/after number without
// pulling in a tokenizer dependency (e.g. tiktoken) just to measure size.
//
// Method: characters / 4. This approximates OpenAI's ~4-chars-per-token
// average for English text (documented by OpenAI's own tokenizer guidance)
// and is intentionally conservative for structured JSON, which tends to run
// slightly denser than prose. It is an estimate, not a byte-exact count —
// good enough to compare prompt variants, not to predict billed usage.
import type { ToolSet } from 'ai';
import { asSchema } from 'ai';

const CHARS_PER_TOKEN = 4;

/** Estimate the token count of a plain text string. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Estimate the token count of a tool set's schemas as sent to the model:
 * each tool's name, description, and JSON Schema (derived from its Zod
 * input schema via the 'ai' package's own asSchema helper — no extra
 * dependency needed since 'ai' already normalizes Zod/JSON schemas this way).
 */
export async function estimateToolSetTokens(tools: ToolSet): Promise<number> {
  let total = 0;
  for (const [name, def] of Object.entries(tools)) {
    total += estimateTokens(name);
    const description = (def as { description?: string }).description;
    if (description) total += estimateTokens(description);

    const inputSchema = (def as { inputSchema?: unknown }).inputSchema;
    if (inputSchema) {
      try {
        const schema = asSchema(inputSchema as never);
        const jsonSchema = await schema.jsonSchema;
        total += estimateTokens(JSON.stringify(jsonSchema));
      } catch {
        // Provider-defined tools (e.g. openai.tools.webSearch()) may not carry
        // a Zod/JSON schema at all — skip rather than fail the whole estimate.
      }
    }
  }
  return total;
}

export interface TokenReport {
  systemPromptTokens: number;
  toolSchemaTokens: number;
  totalTokens: number;
}

/** Measure the assembled system prompt + tool schemas together for logging/instrumentation. */
export async function reportTokenUsage(system: string, tools: ToolSet): Promise<TokenReport> {
  const systemPromptTokens = estimateTokens(system);
  const toolSchemaTokens = await estimateToolSetTokens(tools);
  return {
    systemPromptTokens,
    toolSchemaTokens,
    totalTokens: systemPromptTokens + toolSchemaTokens,
  };
}
