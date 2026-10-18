// Display-name cleanup for provider food names (USDA Branded descriptions are
// manufacturer-submitted in ALL CAPS). Pure: no I/O, safe to call at mapping time.

const SMALL_WORDS = new Set(['and', 'or', 'of', 'with', 'in', 'on', 'a', 'an', 'the', 'for', 'to']);

// Tokens that stay uppercase when a name is title-cased.
const ACRONYMS = new Set([
  'BBQ', 'USA', 'US', 'USDA', 'MCT', 'DHA', 'BCAA', 'XL', 'XXL', 'II', 'III', 'PB', 'UHT',
]);

// Lowercase suffixes that follow an apostrophe (REESE'S, DON'T, THEY'RE).
const CONTRACTIONS = new Set(['S', 'T', 'RE', 'LL', 'VE', 'D', 'M']);

const UPPERCASE_THRESHOLD = 0.7;

// A unit glued to or following a number, e.g. "42G", "14 FL OZ", "500ML".
const UNIT_AFTER_NUMBER =
  /(\d)(\s*)(fl\.?\s*oz|oz|mcg|mg|kg|g|ml|l|kcal|cal|lbs|lb)(?![A-Za-z])/gi;

function isMostlyUppercase(name: string): boolean {
  const letters = name.replace(/[^A-Za-z]/g, '');
  if (letters.length === 0) return false;
  const upper = letters.replace(/[^A-Z]/g, '').length;
  return upper / letters.length >= UPPERCASE_THRESHOLD;
}

/** Drop a contiguous comma-separated run that is immediately repeated
 *  ("A, B, A, B" -> "A, B"), comparing case-insensitively. */
function collapseRepeatedRuns(name: string): string {
  const parts = name.split(',').map((p) => p.trim());
  let i = 0;
  while (i < parts.length) {
    let collapsed = false;
    for (let k = 1; i + 2 * k <= parts.length; k++) {
      const same = parts
        .slice(i, i + k)
        .every((p, j) => p !== '' && p.toLowerCase() === parts[i + k + j].toLowerCase());
      if (same) {
        parts.splice(i + k, k);
        collapsed = true;
        break;
      }
    }
    if (!collapsed) i++;
  }
  return parts.join(', ');
}

function titleCaseToken(token: string, atStart: boolean): string {
  const m = token.match(/^([^A-Za-z0-9]*)(.*?)([^A-Za-z0-9]*)$/);
  if (!m) return token;
  const [, lead, core, trail] = m;
  if (/\d/.test(core)) return token;
  if (!atStart && SMALL_WORDS.has(core.toLowerCase())) return lead + core.toLowerCase() + trail;
  const cased = core.replace(/[A-Za-z]+/g, (run, offset: number) => {
    if (ACRONYMS.has(run.toUpperCase())) return run.toUpperCase();
    const prev = core[offset - 1];
    if ((prev === "'" || prev === '’') && CONTRACTIONS.has(run.toUpperCase())) {
      return run.toLowerCase();
    }
    return run[0].toUpperCase() + run.slice(1).toLowerCase();
  });
  return lead + cased + trail;
}

function titleCase(name: string): string {
  const tokens = name.split(/\s+/).filter(Boolean);
  return tokens
    .map((tok, i) => {
      const prev = tokens[i - 1];
      const atStart = i === 0 || /[,;:]$/.test(prev) || /^[(\[]/.test(tok);
      return titleCaseToken(tok, atStart);
    })
    .join(' ');
}

/** Make a provider-sourced food name readable: collapse repeated comma runs,
 *  title-case predominantly uppercase names, and lowercase units after numbers. */
export function normalizeFoodName(name: string): string {
  const trimmed = (name ?? '').trim();
  if (!trimmed) return '';
  let out = collapseRepeatedRuns(trimmed);
  if (isMostlyUppercase(out)) out = titleCase(out);
  return out.replace(UNIT_AFTER_NUMBER, (_m, d: string, sp: string, unit: string) => d + sp + unit.toLowerCase());
}
