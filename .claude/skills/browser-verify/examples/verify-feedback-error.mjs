// Template: the feedback modal's error state when GitHub issue creation
// fails (502), and that the draft survives both the error and a
// Cancel+reopen. Boots its own stack with a deliberately bad GITHUB_TOKEN so
// routes/feedback.ts's createGithubIssue() fails fast with a 401 from GitHub.
//
// Run: node .claude/skills/browser-verify/examples/verify-feedback-error.mjs [token] [screenshot-path]

import path from 'node:path';
import os from 'node:os';
import mysql from 'mysql2/promise'; // resolves to the repo's own dependency, not a local one
import { launchAuthed, teardown, waitFor } from '../lib/browser.mjs';
import * as sel from '../lib/selectors.mjs';

const GITHUB_TOKEN = process.argv[2] ?? 'invalid-local-test-token';
const SHOT = process.argv[3] ?? path.join(os.tmpdir(), 'browser-verify-feedback-error.png');

async function main() {
  const { page, api, browser, stack } = await launchAuthed({
    stack: true,
    stackOptions: { env: { GITHUB_TOKEN } },
  });
  const result = {};

  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await sel.openFeedback(page);
    await page.selectOption(sel.feedbackCategory, 'bug');
    await page.fill(sel.feedbackMessage, 'ZZTEST feedback error state check');

    const resP = page.waitForResponse((r) => r.url().endsWith('/api/feedback') && r.request().method() === 'POST');
    await page.click(sel.feedbackSubmit);
    const res = await resP;
    result.status = res.status();

    await waitFor(page, () => !!document.querySelector('[class*="errorMsg"]'));
    result.error = await page.evaluate((errSel) => {
      const el = document.querySelector(errSel);
      const cs = getComputedStyle(el);
      return { text: el.textContent, bg: cs.backgroundColor, color: cs.color, border: cs.borderTopColor };
    }, sel.feedbackErrorMsg);

    result.draftAfterError = await page.evaluate(
      ({ msgSel, catSel }) => ({
        message: document.querySelector(msgSel).value,
        category: document.querySelector(catSel).value,
        successShown: document.body.innerText.includes('Thanks!'),
      }),
      { msgSel: sel.feedbackMessage, catSel: sel.feedbackCategory },
    );

    await page.screenshot({ path: SHOT });
    result.screenshot = SHOT;

    await page.click(sel.feedbackCancel);
    await page.waitForTimeout(500);
    await sel.openFeedback(page);
    result.draftAfterReopen = await page.evaluate(
      ({ msgSel, errSel }) => ({
        message: document.querySelector(msgSel).value,
        errorStillShown: !!document.querySelector(errSel),
      }),
      { msgSel: sel.feedbackMessage, errSel: sel.feedbackErrorMsg },
    );

    console.log('RESULT', JSON.stringify(result, null, 1));
  } finally {
    // POST /feedback has no DELETE counterpart (a real submission is meant
    // to stick around), so sweep the ZZTEST row directly instead.
    try {
      const conn = await mysql.createConnection({
        host: '127.0.0.1', port: 3307, user: 'dev', password: 'dev', database: 'workout_log',
      });
      await conn.query("DELETE FROM feedback WHERE message LIKE 'ZZTEST%'");
      await conn.end();
    } catch {
      // best-effort cleanup only
    }
    await teardown({ browser, api, stack });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
