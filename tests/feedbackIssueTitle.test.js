// buildIssueTitle (routes/feedback.ts) builds the GitHub issue title for a
// feedback submission: `[submitter][category][tool] excerpt` (#386). The repo
// is public, so only the email's local part (before '@') is embedded, never
// the full address. Pure function, no database or network access needed.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const db = require('../scripts/testDb');

let buildIssueTitle;

test.before(() => {
  ({ buildIssueTitle } = db.requireTs(path.join(__dirname, '../routes/feedback.ts')));
});

test('buildIssueTitle prefixes the submitter\'s email local-part', () => {
  const title = buildIssueTitle(
    { category: 'bug', tool: 'nutrition', message: 'Totals wrap to two lines on mobile' },
    'nicolas.a.asanov@gmail.com',
  );
  assert.equal(title, '[nicolas.a.asanov][bug][nutrition] Totals wrap to two lines on mobile');
});

test('buildIssueTitle uses [unknown] when the submitter email is unknown', () => {
  const title = buildIssueTitle(
    { category: 'idea', tool: 'workouts', message: 'Add a rest timer' },
    'unknown',
  );
  assert.equal(title, '[unknown][idea][workouts] Add a rest timer');
});

test('buildIssueTitle falls back to "other" for missing category/tool', () => {
  const title = buildIssueTitle(
    { category: undefined, tool: undefined, message: 'Hello' },
    'someone@example.com',
  );
  assert.equal(title, '[someone][other][other] Hello');
});

test('buildIssueTitle truncates a long message with "..." at 60 characters', () => {
  const longMessage = 'x'.repeat(80);
  const title = buildIssueTitle(
    { category: 'ui', tool: 'body-weight', message: longMessage },
    'me@example.com',
  );
  const expectedExcerpt = 'x'.repeat(60);
  assert.equal(title, `[me][ui][body-weight] ${expectedExcerpt}...`);
  assert.ok(!title.endsWith('x...'.repeat(2)));
});

test('buildIssueTitle does not truncate a message at exactly 60 characters', () => {
  const message = 'y'.repeat(60);
  const title = buildIssueTitle(
    { category: 'other', tool: 'other', message },
    'me@example.com',
  );
  assert.equal(title, `[me][other][other] ${message}`);
  assert.ok(!title.endsWith('...'));
});

test('buildIssueTitle replaces newlines in the excerpt with spaces', () => {
  const title = buildIssueTitle(
    { category: 'bug', tool: 'agent', message: 'Line one\nLine two\nLine three' },
    'reporter@example.com',
  );
  assert.equal(title, '[reporter][bug][agent] Line one Line two Line three');
});
