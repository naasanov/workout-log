// Assembles a request's full tool set from independent per-domain modules,
// so new domains (workouts, goals, etc.) register alongside nutrition without
// this file or callers needing to change per-domain internals.
import type { ToolSet } from 'ai';
import { analyticsTools } from './analytics';

/**
 * Shared per-request context handed to every domain's tool builder. Domains
 * read only the fields they need; extend this as new domains require more.
 */
export interface ToolContext {
  userUuid: string;
  /** ISO-8601 date string: YYYY-MM-DD — the day the user is currently viewing */
  selectedDate: string;
  flags: {
    unc_dining: boolean;
  };
}

/**
 * A domain module contributes zero or more tools for a given request. It
 * returns `{}` (not a disabled/refusing tool) when a feature flag is off, so
 * the gated tool names are entirely absent from the assembled set.
 */
export type ToolModule = (ctx: ToolContext) => ToolSet;

/** Merge every registered domain module's tools into one ToolSet for a request. */
export function assembleTools(modules: ToolModule[], ctx: ToolContext): ToolSet {
  return modules.reduce<ToolSet>((acc, buildModule) => ({ ...acc, ...buildModule(ctx) }), {});
}

/**
 * Wave 3 read-only tool modules: query_series plus generic list_resources /
 * get_resource reads over workouts, body weight, and habits. Not yet merged
 * into index.ts's TOOL_MODULES -- a later wave combines this with nutrition
 * and mutation tools into one request-level tool set.
 */
export const readToolModules: ToolModule[] = [analyticsTools];
