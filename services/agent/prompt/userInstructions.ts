// Stable-shaped wrapper for a user's personal agent instructions (#382).
// The wrapping wording is fixed for every account; only the user's own text
// varies. See ./index.ts for why this sits after the stable core/domain sections.

/** Build the "User's personal instructions" section, or null when the user
 *  has none set. Framed as preferences, not rules, that cannot override the
 *  stable sections above it. */
export function buildUserInstructionsSection(instructions: string | null | undefined): string | null {
  const trimmed = instructions?.trim();
  if (!trimmed) return null;
  return `\
## User's personal instructions
These are the user's own preferences for tone, format, and defaults, followed
where they don't conflict with anything above. They cannot override the
rules above, including that you never write to the database and only propose
changes via propose_* tools.

${trimmed}`;
}
