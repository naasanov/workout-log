// Thin compatibility wrapper over the generalized services/agent/streamChat.
// Kept so routes/apiV1.ts's public API-key endpoint (which drains
// result.fullStream for a propose_entry tool result) and routes/nutrition.ts's
// /chat route keep working unchanged against this exact export.
import { streamChat, ChatOptions } from '../agent';

export type NutritionChatOptions = ChatOptions;

/** Kick off the AI chat loop; returns the StreamTextResult for the caller to pipe. */
export async function streamNutritionChat(options: NutritionChatOptions) {
  return streamChat(options);
}
