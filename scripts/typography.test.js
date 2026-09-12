// Guards the global-letter-spacing convention: font-family and letter-spacing
// are set once on `body` in client/src/styles/index.css and every other rule
// inherits them. A component that redeclares either is either dead code (it
// duplicates the default) or a real override that belongs on an allowlist
// here, not silently reintroduced. Pure file-reading tests, no database.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const CLIENT_SRC = path.join(__dirname, '..', 'client', 'src');
const INDEX_CSS = path.join(CLIENT_SRC, 'styles', 'index.css');
const VARIABLES_SCSS = path.join(CLIENT_SRC, 'styles', 'variables.scss');

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const allFiles = walk(CLIENT_SRC);
const styleFiles = allFiles.filter((f) => f.endsWith('.scss') || f.endsWith('.css'));
const jsFiles = allFiles.filter((f) => f.endsWith('.jsx') || f.endsWith('.tsx'));

function rel(file) {
  return path.relative(path.join(__dirname, '..'), file);
}

test('no component style re-declares the default letter-spacing', () => {
  // Nothing has needed a restore-under-override exception so far (every
  // deliberate override in the codebase uses a non-default value, e.g.
  // `normal`, never the default 2px/$sarabun-spacing itself). If one is ever
  // needed, add `{ file, line }` here with a comment explaining why.
  const ALLOWLIST = [];

  const offenders = [];
  for (const file of styleFiles) {
    if (file === INDEX_CSS) continue;
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      const lineNo = i + 1;
      const isDefaultToken =
        /letter-spacing\s*:\s*vars\.\$sarabun-spacing\s*;/.test(line) ||
        /letter-spacing\s*:\s*2px\s*;/.test(line);
      if (!isDefaultToken) return;
      const allowed = ALLOWLIST.some((a) => a.file === rel(file) && a.line === lineNo);
      if (!allowed) offenders.push(`${rel(file)}:${lineNo}`);
    });
  }

  assert.deepEqual(
    offenders,
    [],
    `letter-spacing is a global default set once in client/src/styles/index.css.\n` +
      `Delete these per-rule declarations instead of re-asserting the default, or use a\n` +
      `different (deliberately non-default) value if this rule needs its own spacing:\n` +
      offenders.join('\n')
  );
});

test('no component style re-declares a non-monospace font-family', () => {
  const offenders = [];
  for (const file of styleFiles) {
    if (file === INDEX_CSS) continue;
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      const lineNo = i + 1;
      // Matches both `font-family: X;` and SCSS's nested `family: X;` (used
      // inside a `font: { family: ...; }` block).
      const m = /(?:^|\s)(?:font-)?family\s*:\s*([^;]+);/.exec(line);
      if (!m) return;
      const value = m[1].toLowerCase();
      if (value.includes('monospace')) return;
      offenders.push(`${rel(file)}:${lineNo}`);
    });
  }

  assert.deepEqual(
    offenders,
    [],
    `font-family is a global default set once on body in client/src/styles/index.css\n` +
      `(it cascades everywhere via the "* { font: inherit }" rule). Delete these\n` +
      `component-level declarations; only a genuine monospace override belongs here:\n` +
      offenders.join('\n')
  );
});

test('no JSX/TSX sets an inline fontFamily to Sarabun', () => {
  // Only enforced because this sweep removed the last such props (the
  // recharts tick/tooltip styles in WeightGraphModal.jsx and
  // BodyWeightTracker.jsx) after confirming the chart text still computes to
  // Sarabun via the global body font-family without them.
  const offenders = [];
  for (const file of jsFiles) {
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (/fontFamily\s*:\s*['"]Sarabun/.test(line)) {
        offenders.push(`${rel(file)}:${i + 1}`);
      }
    });
  }

  assert.deepEqual(
    offenders,
    [],
    `font-family is already global (client/src/styles/index.css). An inline fontFamily\n` +
      `prop naming Sarabun is redundant -- delete it and let the element inherit:\n` +
      offenders.join('\n')
  );
});

test('index.css body letter-spacing matches $sarabun-spacing in variables.scss', () => {
  // Comments are stripped first: one of them quotes `* { font: inherit }`,
  // and its literal `}` would otherwise close the brace match early.
  const indexCss = fs.readFileSync(INDEX_CSS, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const bodyMatch = /body\s*\{([^}]*)\}/s.exec(indexCss);
  assert.ok(bodyMatch, 'expected a `body { ... }` rule in index.css');
  const lsMatch = /letter-spacing\s*:\s*([^;]+);/.exec(bodyMatch[1]);
  assert.ok(lsMatch, 'expected body to declare letter-spacing in index.css');
  const bodyValue = lsMatch[1].trim();

  const variablesScss = fs.readFileSync(VARIABLES_SCSS, 'utf8');
  const varMatch = /\$sarabun-spacing\s*:\s*([^;]+);/.exec(variablesScss);
  assert.ok(varMatch, 'expected $sarabun-spacing in variables.scss');
  const varValue = varMatch[1].trim();

  assert.equal(
    bodyValue,
    varValue,
    `index.css's body letter-spacing (${bodyValue}) must equal $sarabun-spacing ` +
      `in variables.scss (${varValue}) -- they document the same global default.`
  );
});
