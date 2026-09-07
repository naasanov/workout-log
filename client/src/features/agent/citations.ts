// Strip OpenAI-style citation tokens from assistant text.
// Models sometimes emit markers like citeturn1view1 wrapped in private-use-area
// unicode chars (U+E200–U+E2FF range). Strip both the PUA-delimited form and
// any bare "cite…turn…" token so they don't show as garbage in the UI.
// Applied only to assistant text, never to user input.
export function stripCitationTokens(text: string): string {
  return text
    // Remove PUA-delimited citation spans. Models (e.g. some OpenAI runs) emit
    // characters in U+E200-U+E2FF as open/close delimiters around tokens like
    // "turn1view1". Strip the delimiters and any content they enclose.
    .replace(/[-][^-]*[-]/g, '')
    // Also strip bare cite-token patterns that may appear without PUA delimiters,
    // e.g. citeturn1view1 or citeturn0search5.
    .replace(/cite\w*turn\d+\w*/gi, '')
    // Also strip bare "turn0search1"-style tokens with no leading "cite" that
    // sometimes leak straight into the rendered text, e.g. "turn0search1",
    // "turn1view1", "turn0news2" (optionally preceded by a stray space).
    // Matches a run of one or more such tokens as a single unit: back-to-back
    // tokens like "turn3view2turn1view1" have no word boundary at the seam between
    // them, so a \b-anchored match only catches the first one and leaves the rest.
    // Eats one optional space on each side, putting a single space back only
    // when the run sat between two words, so no double space is left behind.
    .replace(/ ?(?:turn\d+[a-z]+\d+)+ ?/gi, m =>
      m.startsWith(' ') && m.endsWith(' ') ? ' ' : '')
    // Trailing whitespace only. A global multi-space collapse here would flatten
    // nested list indentation, markdown hard breaks, and indented code blocks in
    // the assistant's markdown before ReactMarkdown ever parses it.
    .replace(/\s+$/, '');
}
