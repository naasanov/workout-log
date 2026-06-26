// Nutrition AI agent — Phase 2.
// Runs a tool-calling loop via the Vercel AI SDK's streamText, returning
// the StreamTextResult for the route to pipe to the HTTP response.
import { streamText, tool, stepCountIs, hasToolCall, convertToModelMessages } from 'ai';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod';
import { proposeEntryArgsSchema } from '../../schemas/nutrition';
import * as store from './store';
import * as providers from './providers';
import { recordUsage } from './usage';

export interface NutritionChatOptions {
  userUuid: string;
  /** ISO-8601 date string: YYYY-MM-DD — the day the user is currently viewing */
  selectedDate: string;
  /** Raw useChat UI messages from the client (array of UIMessage-like objects without id) */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  messages: any[];
  /** Reasoning effort: none | minimal | low | medium | high (default: medium) */
  effort?: 'none' | 'minimal' | 'low' | 'medium' | 'high';
}

/** Build a compact text summary of recent entries for the system prompt context block. */
function summariseEntries(
  entries: Awaited<ReturnType<typeof store.recentEntries>>,
): string {
  if (entries.length === 0) return '(none)';
  return entries
    .map((e) => {
      const macros = `${Math.round(e.calories)} kcal, ${Math.round(e.protein_g)}g P, ${Math.round(e.carbs_g)}g C, ${Math.round(e.fat_g)}g F`;
      return `  • ${e.date} ${e.meal}: ${e.name} — ${macros}`;
    })
    .join('\n');
}

/** Kick off the AI chat loop; returns the StreamTextResult for the caller to pipe. */
export async function streamNutritionChat({
  userUuid,
  selectedDate,
  messages,
  effort,
}: NutritionChatOptions) {
  // Fetch context in parallel — degrade gracefully if DB not available
  const [recent, goals, todayDay] = await Promise.all([
    store.recentEntries(userUuid, 3).catch(() => []),
    store.getGoals(userUuid).catch(() => ({ calories: null, protein_g: null, carbs_g: null, fat_g: null })),
    store.getDay(userUuid, selectedDate).catch(() => ({ date: selectedDate, totals: { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0, sugar_g: 0, sodium_mg: 0 }, entries: [] })),
  ]);

  const todayTotals = todayDay.totals;

  const goalsLine = [
    goals.calories != null ? `${goals.calories} kcal` : null,
    goals.protein_g != null ? `${goals.protein_g}g protein` : null,
    goals.carbs_g != null ? `${goals.carbs_g}g carbs` : null,
    goals.fat_g != null ? `${goals.fat_g}g fat` : null,
  ]
    .filter(Boolean)
    .join(', ');

  const system = `\
You are a precise nutrition logging assistant embedded in a workout/nutrition app.

TODAY'S DATE: ${selectedDate}

## Your job
Help the user identify, quantify, and log what they ate. When the user describes food:
1. Search for it with \`search_usda\` (or \`lookup_barcode\` for barcodes) to get accurate per-100g macros — NEVER invent or estimate calories without grounding them in a tool result.
   - For a **multi-item meal** (two or more distinct foods in one message), use ONE \`search_foods_batch\` call with all queries at once instead of multiple \`search_usda\` calls. Use \`search_usda\` only for single-item lookups.
2. Use \`get_portions\` to find common household serving sizes when helpful.
3. Check \`search_food_history\` first for foods the user has logged before — prefer reusing those if the food matches.
4. Estimate the portion in **grams**. When the user gives a weight in non-gram units (lbs, oz, kg, mg, etc.), call \`convert_to_grams\` — do NOT do the arithmetic yourself. Ask one brief clarifying question if the portion or food identity is genuinely ambiguous (e.g. "Was that a small, medium, or large banana?"). Do not ask multiple questions at once.
5. When you are confident about identity + portion, call **\`propose_entry\`** with the fully structured entry. The user will review and confirm in the UI — you do NOT write to the database. After calling propose_entry, tell the user briefly what you proposed (e.g. "I've proposed logging 1 medium banana (118 g, ~105 kcal) for breakfast — check the entry below.").

## Web-search fallback
- Only use \`web_search\` when \`search_usda\`, \`search_foods_batch\`, and \`lookup_barcode\` all return nothing useful (e.g. a local restaurant item, branded boba, or a food not in USDA/OFF).
- Prefer official brand or restaurant nutrition pages. Extract per-serving or per-100g macros.
- **Always cite the source URL** in your reply when using web-search data.
- Use ingredient \`source: 'manual'\` for any web-derived items.
- Be conservative and explicitly note uncertainty: web nutrition data can be inaccurate.

## Rules
- Ground all macros in tool results. If a search returns no results, say so and ask the user for more info.
- Compute ingredient macros as: ingredient_macro = per100g_macro × (grams / 100). Round to one decimal.
- For mixed dishes (e.g. "chicken stir-fry"), break into constituent ingredients, each with their own source_ref.
- Use meal = breakfast / lunch / dinner / snack based on context or ask.
- source should be "text" for text-described food, "photo" for photos, "barcode" for barcode scans, "mixed" for multi-ingredient items assembled from search results.
- Never fabricate a source_ref. Use the fdcId string for USDA items, or OFF product id for barcode/OFF items.

## User context
**Goals:** ${goalsLine || 'not set'}
**Today (${selectedDate}) so far:** ${Math.round(todayTotals.calories)} kcal, ${Math.round(todayTotals.protein_g)}g P, ${Math.round(todayTotals.carbs_g)}g C, ${Math.round(todayTotals.fat_g)}g F

**Recent meals (last 3 days):**
${summariseEntries(recent)}
`;

  const modelMessages = await convertToModelMessages(messages);

  const result = streamText({
    model: openai('gpt-5.5'),
    system,
    messages: modelMessages,
    stopWhen: [stepCountIs(8), hasToolCall('propose_entry')],
    providerOptions: {
      openai: {
        reasoningEffort: effort ?? 'medium',
        reasoningSummary: 'auto',
      },
    },
    onFinish: ({ usage }) => {
      // Best-effort usage recording — never await, never throw.
      const inputTokens = usage.inputTokens ?? 0;
      const outputTokens = usage.outputTokens ?? 0;
      const reasoningTokens = usage.outputTokenDetails?.reasoningTokens ?? 0;
      const totalTokens = usage.totalTokens ?? (inputTokens + outputTokens);
      recordUsage(userUuid, 'gpt-5.5', {
        inputTokens,
        outputTokens,
        reasoningTokens,
        totalTokens,
      });
    },
    tools: {
      /** Full-text food search against USDA FoodData Central (+ OFF fallback). Returns per-100g macros. */
      search_usda: tool({
        description:
          'Search for a SINGLE food in USDA FoodData Central and Open Food Facts. Returns up to 5 candidates with per-100g macros. Use search_foods_batch instead when the user describes two or more foods at once.',
        inputSchema: z.object({
          query: z.string().describe('Food name or description to search for, e.g. "banana" or "chicken breast raw"'),
        }),
        execute: async ({ query }) => providers.searchFoods(query),
      }),

      /** Batched USDA search — one call for multi-item meals. */
      search_foods_batch: tool({
        description:
          'Search for multiple foods in one call. Use this when the user describes two or more distinct foods in a single message (e.g. "rice, chicken, and broccoli"). Runs all searches in parallel and returns results grouped per query.',
        inputSchema: z.object({
          queries: z
            .array(z.string())
            .min(2)
            .describe('Array of food names/descriptions to search for, e.g. ["white rice", "chicken breast", "broccoli"]'),
        }),
        execute: async ({ queries }) => {
          const results = await Promise.all(
            queries.map(async (query) => ({
              query,
              results: await providers.searchFoods(query),
            })),
          );
          return results;
        },
      }),

      /** Open Food Facts barcode lookup. */
      lookup_barcode: tool({
        description:
          'Look up a food product by UPC/EAN barcode via Open Food Facts. Returns per-100g macros or null if not found.',
        inputSchema: z.object({
          code: z.string().describe('Numeric barcode string (UPC-12 or EAN-13)'),
        }),
        execute: async ({ code }) => providers.lookupBarcode(code),
      }),

      /** USDA FDC household serving sizes for a food. */
      get_portions: tool({
        description:
          'Fetch household serving sizes (e.g. "1 medium", "1 cup") for a food from USDA FDC or OFF. Call this after search_usda to help convert a described portion to grams.',
        inputSchema: z.object({
          source: z.enum(['usda', 'off']).describe('Data source the food came from'),
          ref: z.string().describe('source_ref from search_usda or lookup_barcode result'),
        }),
        execute: async ({ source, ref }) => providers.getPortions(source, ref),
      }),

      /** Search the user's own food log history. */
      search_food_history: tool({
        description:
          "Search the user's past food log entries by name. Useful to reuse a previous entry's ingredient breakdown instead of re-searching USDA.",
        inputSchema: z.object({
          query: z.string().describe('Food name or keyword to search for in past entries'),
        }),
        // JSON round-trip: store rows carry mysql2 Date objects (logged_at) which
        // the AI SDK rejects as non-JSON tool output — normalize to plain JSON.
        execute: async ({ query }) =>
          JSON.parse(JSON.stringify(await store.searchFoodHistory(userUuid, query))),
      }),

      /** Fetch the user's nutrition goals and today's running totals. */
      get_goals_and_today: tool({
        description:
          "Fetch the user's daily nutrition goals and today's logged totals. Useful to answer questions like 'how much protein do I have left?'",
        inputSchema: z.object({}),
        execute: async () =>
          JSON.parse(
            JSON.stringify({
              goals: await store.getGoals(userUuid),
              today: (await store.getDay(userUuid, selectedDate)).totals,
            }),
          ),
      }),

      /**
       * Deterministic weight-unit converter. Use this instead of doing math yourself
       * to avoid unit-conversion errors (e.g. lbs→g or oz→g).
       */
      convert_to_grams: tool({
        description:
          'Convert a weight amount from a given unit to grams. Handles: lb/lbs/pound, oz/ounce, kg, g, mg. Returns null with a note for volume units (ml, cup, tbsp, tsp) since those require density.',
        inputSchema: z.object({
          amount: z.number().describe('Numeric quantity to convert, e.g. 1.5'),
          unit: z.string().describe('Unit string, e.g. "lbs", "oz", "kg", "g", "mg"'),
        }),
        execute: async ({ amount, unit }) => {
          const u = unit.trim().toLowerCase();
          const massFactors: Record<string, number> = {
            lb: 453.592,
            lbs: 453.592,
            pound: 453.592,
            pounds: 453.592,
            oz: 28.3495,
            ounce: 28.3495,
            ounces: 28.3495,
            kg: 1000,
            kilogram: 1000,
            kilograms: 1000,
            g: 1,
            gram: 1,
            grams: 1,
            mg: 0.001,
            milligram: 0.001,
            milligrams: 0.001,
          };
          if (u in massFactors) {
            const grams = amount * massFactors[u];
            return { grams: Math.round(grams * 10) / 10, unit: u, original: amount };
          }
          // Volume units — cannot convert without density
          const volumeUnits = ['ml', 'l', 'cup', 'cups', 'tbsp', 'tsp', 'fl oz', 'floz', 'litre', 'liter'];
          if (volumeUnits.some((v) => u === v || u.startsWith(v))) {
            return {
              grams: null,
              note: `Cannot convert volume unit "${unit}" to grams without knowing the food's density. Please estimate grams directly or look up a typical serving weight.`,
            };
          }
          return {
            grams: null,
            note: `Unknown unit "${unit}". Supported mass units: lb/lbs/pound, oz/ounce, kg, g, mg.`,
          };
        },
      }),

      /**
       * Web search — fallback for foods USDA/OFF don't have (e.g. local restaurant items,
       * branded boba). Only use after search_usda / search_foods_batch / lookup_barcode
       * all return nothing useful. Always cite the source URL in your reply.
       * Use ingredient source: 'manual' for web-derived items.
       */
      web_search: openai.tools.webSearch(),

      /**
       * propose_entry: echoes its validated args as output so the stream terminates
       * cleanly. The client reads the output (= the proposal) from the typed tool part
       * and renders it as the EntryEditor in "proposal" mode; on confirm the client
       * adds localDate and POSTs to /api/nutrition/entries itself.
       */
      propose_entry: tool({
        description:
          'Propose a structured food entry for the user to review and confirm. Call this once you are confident about the food identity and portion. The user will see an editor pre-filled with these values and can adjust before saving.',
        inputSchema: proposeEntryArgsSchema,
        execute: async (args) => args,
      }),
    },
  });

  return result;
}
