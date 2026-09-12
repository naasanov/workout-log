// Nutrition domain tools: food search/history, goals, unit/arithmetic
// helpers, entry/custom-food proposals, and UNC campus dining (gated).
// Moved essentially verbatim from the former services/nutrition/agent.ts.
import { tool } from 'ai';
import type { ToolSet } from 'ai';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod';
import {
  proposeEntryArgsSchema,
  proposeEntryToolArgsSchema,
  proposeCustomFoodArgsSchema,
} from '../../../schemas/nutrition';
import type { Per100g, ProposeIngredient, ProposeIngredientArgs } from '../../../schemas/nutrition';
import * as store from '../../nutrition/store';
import * as providers from '../../nutrition/providers';
import { searchUncFoods, getUncMenu, listUncLocations, getUncFood } from '../../nutrition/unc';
import type { ToolContext, ToolModule } from './registry';

/** Rounds to one decimal place — matches convert_to_grams's rounding below and the
 *  "round to one decimal" rule the prompt used to ask the model to apply itself. */
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Scales a per100g/per_serving nutrient record by `factor` (grams/100 for a
 *  per100g base, serving_qty for a per_serving base) into the six macro fields
 *  propose_entry has always echoed. Null micros stay null rather than becoming 0. */
function scaleBase(per: Per100g, factor: number) {
  return {
    calories: round1(per.calories * factor),
    protein_g: round1(per.protein_g * factor),
    carbs_g: round1(per.carbs_g * factor),
    fat_g: round1(per.fat_g * factor),
    fiber_g: per.fiber_g != null ? round1(per.fiber_g * factor) : null,
    sugar_g: per.sugar_g != null ? round1(per.sugar_g * factor) : null,
    sodium_mg: per.sodium_mg != null ? round1(per.sodium_mg * factor) : null,
  };
}

/**
 * Resolves one propose_entry ingredient argument into the fully-resolved shape the
 * client has always received. When `base` is set, scales it by the ingredient's
 * grams (per100g base) or serving_qty (per_serving base) instead of requiring the
 * model to compute macros itself. An already-resolved ingredient (no `base`) passes
 * through unchanged — proposeIngredientArgsSchema guarantees one shape or the other.
 */
export function resolveProposeIngredient(ing: ProposeIngredientArgs): ProposeIngredient {
  const { base, ...rest } = ing;
  if (base == null) {
    return rest as ProposeIngredient;
  }
  const scaled =
    base.per100g != null
      ? scaleBase(base.per100g, (rest.grams ?? 0) / 100)
      : scaleBase(base.per_serving!, rest.serving_qty ?? 0);
  return { ...rest, ...scaled } as ProposeIngredient;
}

/**
 * Builds the nutrition domain's tools for one request. UNC dining tools
 * (search_unc_foods, get_unc_menu, list_unc_locations, get_unc_food) are
 * built only when ctx.flags.unc_dining is on, and spread into the returned
 * ToolSet — when the flag is off, `uncTools` is `{}` and those four tool
 * names are entirely absent from what the model sees (not present-but-refusing).
 */
export const nutritionTools: ToolModule = ({ userUuid, selectedDate, flags }: ToolContext): ToolSet => {
  const uncEnabled = flags.unc_dining;

  const uncTools: ToolSet = uncEnabled
    ? {
        /** Thin wrapper over unc/index.ts's searchUncFoods — per-serving UNC results. */
        search_unc_foods: tool({
          description:
            'Search UNC campus dining for a food by name on a given date. Returns per-serving nutrition — UNC does NOT publish gram weights, so log these by servings (serving_qty + serving_label), never convert to grams. Prefer this over get_unc_menu when the user names a specific food they want to log.',
          inputSchema: z.object({
            query: z.string().describe('Food name to search for, e.g. "burrito" or "chicken tenders".'),
            date: z
              .string()
              .optional()
              .describe('YYYY-MM-DD, default today. Max today+31 — later dates return not_published: true (UNC has not published that far out yet).'),
            location: z
              .string()
              .optional()
              .describe('UNC dining location slug or friendly name to narrow the search, e.g. "chase" or "Top of Lenoir". Omit to search all locations that publish nutrition.'),
          }),
          execute: async ({ query, date, location }) => searchUncFoods(query, date, location),
        }),

        /**
         * Thin wrapper over unc/index.ts's getUncMenu. `meal_period` is a MEAL
         * PERIOD, not a food or an id — spelled out explicitly below because a
         * reviewer previously misread it as a food-name filter.
         */
        get_unc_menu: tool({
          description:
            'What is being served at UNC dining on a date, grouped by location → meal period → station. This tool is also the source of operating HOURS — every period in the result carries start_time/end_time, so it answers "when does Chase close?" just as well as "what\'s for dinner". If the user only wants hours or what\'s open (no menu items needed), prefer list_unc_locations instead — it is cheaper since it returns no menu items. Each item returns ONLY { recipe_number, name, location_slug, location_name, meal_period, station, menu_date } by default — no allergens, dietary tags, serving_label, or nutrition. Pass include_nutrition: true to add per_serving macros, include_dietary: true to add allergens/dietary tags, or use search_unc_foods when the user names one specific food. To filter the menu itself rather than just annotate it, pass dietary (e.g. ["halal", "vegan"] — keeps items matching ANY of the given tags) and/or exclude_allergens (e.g. ["peanuts", "shellfish"] — drops items containing ANY of the given tags); both are case-insensitive, and either one automatically forces allergens/dietary onto the surviving items so you can see why they matched.',
          inputSchema: z.object({
            date: z
              .string()
              .optional()
              .describe('YYYY-MM-DD, default today. Max today+31 (UNC\'s published horizon) — later dates return not_published: true.'),
            meal_period: z
              .string()
              .optional()
              .describe(
                'A MEAL PERIOD, NOT a food name and NOT an id — e.g. "breakfast", "lunch", "dinner", "late night", "open", or "now" (matches whichever period is open right now). Matched loosely against UNC\'s own period labels. Never pass a food name in this field. Omit to return the whole day across all periods.',
              ),
            location: z
              .string()
              .optional()
              .describe('UNC dining location slug or friendly name, e.g. "chase" or "Top of Lenoir". Omit to include every location open in that period.'),
            station: z.string().optional().describe('Narrow to one station within a location, e.g. "Pizza".'),
            include_nutrition: z
              .boolean()
              .optional()
              .describe('When true, attaches full per-serving macros (per_serving) to every item — the response gets large. Default false omits it.'),
            include_dietary: z
              .boolean()
              .optional()
              .describe('When true, attaches allergens and dietary tags (allergens, dietary) to every item. Default false omits them, unless dietary or exclude_allergens is passed, which forces them on for the surviving items.'),
            dietary: z
              .array(z.string())
              .optional()
              .describe('Only keep items matching ANY of these dietary tags (case-insensitive), e.g. ["halal", "vegan"] to answer "what\'s halal today". Forces allergens/dietary onto the output.'),
            exclude_allergens: z
              .array(z.string())
              .optional()
              .describe('Drop items containing ANY of these allergen tags (case-insensitive), e.g. ["peanuts", "shellfish"]. Forces allergens/dietary onto the output.'),
          }),
          execute: async ({ date, meal_period, location, station, include_nutrition, include_dietary, dietary, exclude_allergens }) =>
            getUncMenu({
              date, mealPeriod: meal_period, location, station,
              includeNutrition: include_nutrition, includeDietary: include_dietary,
              dietary, excludeAllergens: exclude_allergens,
            }),
        }),

        /** Thin wrapper over unc/index.ts's listUncLocations — cheap hours/status lookup. */
        list_unc_locations: tool({
          description:
            'Which UNC dining locations exist, whether each has a published menu for a date, and their operating hours (periods with start_time/end_time). Returns NO menu items — this is the cheaper choice when the user only wants to know what\'s open or when somewhere closes. Use get_unc_menu instead when they also want to know what food is being served.',
          inputSchema: z.object({
            date: z.string().optional().describe('YYYY-MM-DD, default today.'),
          }),
          execute: async ({ date }) => listUncLocations(date),
        }),

        /** Thin wrapper over unc/index.ts's getUncFood — full nutrition by recipe_number. */
        get_unc_food: tool({
          description:
            'Full nutrition for one UNC dining item by recipe_number, typically after browsing a menu with get_unc_menu or search_unc_foods. Returns per-serving macros — UNC does not publish gram weights, so log this by servings, never convert to grams.',
          inputSchema: z.object({
            recipe_number: z.number().int().describe('UNC\'s global recipe id (stable across dates/locations), e.g. from a prior search_unc_foods or get_unc_menu result.'),
            date: z
              .string()
              .optional()
              .describe('YYYY-MM-DD, used to compute where/when this item is available that day. Default today.'),
          }),
          execute: async ({ recipe_number, date }) => getUncFood(recipe_number, date),
        }),
      }
    : {};

  return {
    /** Source-agnostic food search: user's custom foods/meals first, then USDA/OFF.
     *  Returns per-100g macros + portions attached to the top result. */
    search_foods: tool({
      description:
        'Search for a SINGLE food in the food database (USDA, Open Food Facts, and the user\'s saved custom foods/meals). Returns up to 5 candidates with per-100g macros, and portions (household serving sizes) attached to the top result. Results may include custom items (source: \'custom\') — prefer those when they match what the user describes. Use search_foods_batch instead when the user describes two or more foods at once.',
      inputSchema: z.object({
        query: z.string().describe('Food name or description to search for, e.g. "banana" or "chicken breast raw"'),
      }),
      execute: async ({ query }) => providers.searchAllFoodsWithPortions(userUuid, query),
    }),

    /** Batched food search — one call for multi-item meals. Portions on top result per query. */
    search_foods_batch: tool({
      description:
        'Search for multiple foods in one call. Use this when the user describes two or more distinct foods in a single message (e.g. "rice, chicken, and broccoli"). Searches the food database (USDA, Open Food Facts, and the user\'s saved custom foods/meals). Runs all searches in parallel and returns results grouped per query, with portions attached to the top result of each query.',
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
            results: await providers.searchAllFoodsWithPortions(userUuid, query),
          })),
        );
        return results;
      },
    }),

    /** Household serving sizes for a food (USDA FDC or OFF). */
    get_portions: tool({
      description:
        'Fetch household serving sizes (e.g. "1 medium", "1 cup") for a food from USDA FDC or OFF. Call this after search_foods to help convert a described portion to grams. Not needed if portions are already attached to the search result.',
      inputSchema: z.object({
        source: z.enum(['usda', 'off']).describe('Data source the food came from'),
        ref: z.string().describe('source_ref from a search_foods result'),
      }),
      execute: async ({ source, ref }) => providers.getPortions(source, ref),
    }),

    /** Batch-fetch portions for multiple foods in one call. */
    get_portions_batch: tool({
      description:
        'Fetch household serving sizes for multiple foods in one call. Use this when you need portions for several foods at once (e.g. results from search_foods_batch that are missing portions). Returns portions per item.',
      inputSchema: z.object({
        items: z
          .array(
            z.object({
              source: z.enum(['usda', 'off']).describe('Data source the food came from'),
              ref: z.string().describe('source_ref from the search result'),
            }),
          )
          .min(1)
          .describe('Array of {source, ref} pairs to fetch portions for'),
      }),
      execute: async ({ items }) => providers.getPortionsBatch(items),
    }),

    /** Search the user's own food log history. */
    search_food_history: tool({
      description:
        "Search the user's past food log entries by name. Useful to reuse a previous entry's ingredient breakdown (including the serving size) instead of re-searching the food database.",
      inputSchema: z.object({
        query: z.string().describe('Food name or keyword to search for in past entries'),
      }),
      // JSON round-trip: store rows carry mysql2 Date objects (logged_at) which
      // the AI SDK rejects as non-JSON tool output — normalize to plain JSON.
      execute: async ({ query }) =>
        JSON.parse(JSON.stringify(await store.searchFoodHistory(userUuid, query))),
    }),

    /** Batched food-history search — one call for multi-item meals. */
    search_food_history_batch: tool({
      description:
        "Search the user's past food log entries for two or more foods at once (e.g. a multi-item meal like \"eggs, toast, and coffee\"). Runs all searches in parallel and returns results grouped per query. Use this instead of multiple search_food_history calls when the user describes several distinct foods in one message.",
      inputSchema: z.object({
        queries: z
          .array(z.string())
          .min(2)
          .describe('Array of food names/keywords to search for in past entries, e.g. ["eggs", "toast", "coffee"]'),
      }),
      // JSON round-trip: store rows carry mysql2 Date objects (logged_at) which
      // the AI SDK rejects as non-JSON tool output — normalize to plain JSON.
      execute: async ({ queries }) =>
        JSON.parse(JSON.stringify(await store.searchFoodHistoryBatch(userUuid, queries))),
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
        'Convert a weight amount from a given unit to grams. For WEIGHT-BASED foods only. Handles: lb/lbs/pound, oz/ounce, kg, g, mg. Returns null with a note for volume units (ml, cup, tbsp, tsp) since those require density. Never call this on a UNC dining item (source: \'unc\') — UNC publishes no gram weight for its servings, so any conversion would be fabricated; log those with serving_qty + serving_label instead.',
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
     * Safe arithmetic calculator — use for any non-trivial math (gram/macro scaling,
     * portion multiplication, summing macros, etc.). NEVER use web_search for math.
     * Supports +  -  *  /  parentheses, and decimal numbers.
     */
    calculator: tool({
      description:
        'Evaluate a simple arithmetic expression and return the numeric result. Use this for any non-trivial calculation: macro scaling (per100g × grams/100), portion multiplication, unit conversions, totalling macros, etc. Supports +, -, *, /, parentheses, and decimal numbers. Example input: "0.28 * 210". NEVER use web_search for arithmetic — use this tool instead.',
      inputSchema: z.object({
        expression: z
          .string()
          .describe(
            'A math expression using +, -, *, /, parentheses, and decimal numbers. E.g. "0.28 * 210" or "(100 + 50) / 3".',
          ),
      }),
      execute: async ({ expression }) => {
        // Safe recursive-descent evaluator — NO eval() / Function().
        // Grammar: expr = term (('+' | '-') term)*
        //          term = factor (('*' | '/') factor)*
        //          factor = '-' factor | '(' expr ')' | number
        const src = expression.replace(/\s+/g, '');
        let pos = 0;

        function peek(): string {
          return src[pos] ?? '';
        }
        function consume(): string {
          return src[pos++] ?? '';
        }

        function parseNumber(): number {
          let s = '';
          if (peek() === '.') s += '0';
          while (/[\d.]/.test(peek())) s += consume();
          if (!s) throw new Error(`Unexpected character '${peek()}' at position ${pos}`);
          return parseFloat(s);
        }

        function parseFactor(): number {
          if (peek() === '-') {
            consume();
            return -parseFactor();
          }
          if (peek() === '+') {
            consume();
            return parseFactor();
          }
          if (peek() === '(') {
            consume(); // '('
            const val = parseExpr();
            if (peek() !== ')') throw new Error('Missing closing parenthesis');
            consume(); // ')'
            return val;
          }
          return parseNumber();
        }

        function parseTerm(): number {
          let val = parseFactor();
          while (peek() === '*' || peek() === '/') {
            const op = consume();
            const right = parseFactor();
            if (op === '*') val *= right;
            else {
              if (right === 0) throw new Error('Division by zero');
              val /= right;
            }
          }
          return val;
        }

        function parseExpr(): number {
          let val = parseTerm();
          while (peek() === '+' || peek() === '-') {
            const op = consume();
            const right = parseTerm();
            if (op === '+') val += right;
            else val -= right;
          }
          return val;
        }

        try {
          const result = parseExpr();
          if (pos !== src.length) {
            throw new Error(`Unexpected token '${src[pos]}' at position ${pos}`);
          }
          return { result, expression };
        } catch (err) {
          return { error: (err as Error).message, expression };
        }
      },
    }),

    /**
     * Web search — fallback for foods not in the food database (e.g. local restaurant
     * items, branded boba). Only use after search_foods / search_foods_batch return
     * nothing useful (and no scanned-barcode grounding is available). Always cite
     * the source URL in your reply. Use ingredient source: 'manual' for web-derived items.
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
        'Propose a structured food entry for the user to review and confirm. Call this once you are confident about food identity and portion. For a weight-based ingredient, include quantity, unit (a real household serving label), portions list, and grams = quantity × unit_grams. For a SERVING-BASIS ingredient with no gram weight (e.g. a UNC dining item), instead set serving_qty (how many servings) and serving_label (the serving as published, e.g. "½ cup"), leave grams null, and set source: \'unc\'. Every ingredient must set EXACTLY ONE basis — grams, OR serving_qty + serving_label — never both, never neither. Do NOT compute macros yourself: pass base (the per100g or per_serving record exactly as a search/barcode/UNC tool returned it) alongside grams or serving_qty, and the server scales it into calories/protein_g/carbs_g/fat_g. Only set those macro fields directly when you have no base record (a freeform estimate). The user will see an editor pre-filled with these values and can adjust before saving.',
      inputSchema: proposeEntryToolArgsSchema,
      execute: async (args) => {
        const resolved = proposeEntryArgsSchema.parse({
          ...args,
          ingredients: args.ingredients.map(resolveProposeIngredient),
        });
        return JSON.parse(JSON.stringify(resolved));
      },
    }),

    /**
     * propose_custom_food: echoes its validated args as output so the stream
     * terminates cleanly. The client renders an inline MealBuilder pre-filled with
     * these values; on confirm it POSTs to /nutrition/custom-foods itself.
     * The agent does NOT write to the DB — this is a proposal-and-confirm flow.
     */
    propose_custom_food: tool({
      description:
        'Propose creating a reusable custom food or meal for the user\'s library. Call this when the user explicitly asks to save something for future reuse (e.g. "save this as my usual X", "add this to my library"). Set kind (food/meal), name, optional notes, ingredients with macros, and optional custom servings. The user will review the pre-filled form and can edit before confirming. Do NOT call this just because the user logged something once.',
      inputSchema: proposeCustomFoodArgsSchema,
      execute: async (args) => JSON.parse(JSON.stringify(args)),
    }),

    ...uncTools,
  };
};
