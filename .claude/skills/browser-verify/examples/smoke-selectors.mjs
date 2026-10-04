// Boots the stack, seeds minimal ZZTEST fixtures, visits every tab/modal
// selectors.mjs cares about, and asserts each exported selector actually
// resolves (and is visible where it should be). Run this after any client
// change that touches an element selectors.mjs names, instead of trusting
// prose: a stale selector here fails loudly with a JSON report instead of
// costing a 20s timeout mid-script somewhere else.
//
// Run: node .claude/skills/browser-verify/examples/smoke-selectors.mjs

import { launchAuthed, teardown, waitFor } from '../lib/browser.mjs';
import * as sel from '../lib/selectors.mjs';

function localDateStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail: detail ?? null });
}

async function expectVisible(name, locator) {
  try {
    await locator.first().waitFor({ state: 'visible', timeout: 10000 });
    record(name, true);
  } catch (err) {
    record(name, false, err.message.split('\n')[0]);
  }
}

async function main() {
  const { page, api, appBase, browser, stack } = await launchAuthed({ stack: true });
  let sectionId;
  let entryId;

  try {
    // ---- fixtures ----
    const section = await (await api.post('sections', { data: { label: 'ZZTEST Section' } })).json();
    sectionId = section.data.sectionId;
    const movement = await (
      await api.post(`movements/${sectionId}`, { data: { label: 'ZZTEST Movement' } })
    ).json();
    const variation = await (
      await api.post(`variations/${movement.data.movementId}`, {
        data: { label: 'ZZTEST Variation', weight: 100, reps: 5 },
      })
    ).json();
    void variation;

    const entry = await (
      await api.post('nutrition/entries', {
        data: {
          localDate: localDateStr(),
          meal: 'snack',
          name: 'ZZTEST Entry',
          source: 'manual',
          ingredients: [
            { name: 'ZZTEST Ingredient', grams: 100, source: 'manual', calories: 100, protein_g: 1, carbs_g: 1, fat_g: 1 },
          ],
        },
      })
    ).json();
    entryId = entry.data.id;

    // ---- Workouts tab ----
    await page.goto(`${appBase}/?tab=workouts`);
    await waitFor(
      page,
      () => [...document.querySelectorAll('span')].some((s) => s.textContent === 'ZZTEST Variation'),
      { timeout: 20000 },
    );

    await expectVisible('chatFab', page.locator(sel.chatFab));
    await expectVisible('feedbackButton', page.locator(sel.feedbackButton));

    const nameCellIdx = await page.evaluate(() => {
      const cells = [...document.querySelectorAll('div[class*="_nameCell_"]')];
      return cells.findIndex((c) => c.querySelector('span')?.textContent === 'ZZTEST Variation');
    });
    record('variationNameCell', nameCellIdx >= 0, nameCellIdx < 0 ? 'ZZTEST Variation name cell not found' : null);
    const graphBtnCount = await page.locator(sel.variationGraphBtn).count();
    record('variationGraphBtn', nameCellIdx >= 0 && graphBtnCount > nameCellIdx);

    // ---- Peak chat ----
    await sel.openChat(page);
    await expectVisible('chatComposer', page.locator(sel.chatComposer));
    await expectVisible('chatSend', page.locator(sel.chatSend));
    // Tapping the FAB jumps straight to fully expanded (see AgentChat.tsx's
    // pointerup tap-threshold logic), so the handle now reads "Collapse".
    await expectVisible('chatSheetHandle', page.locator(sel.chatSheetHandle));

    await sel.openAgentInstructions(page);
    await expectVisible('agentInstructionsTextarea', page.locator(sel.agentInstructionsTextarea));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    // Collapse via the header button, then exercise the keyboard-only expand
    // path (the drag handle has no onClick, so this is the only way in).
    await page.click(sel.chatCollapseHeaderBtn);
    await page.waitForTimeout(500);
    await sel.expandChatSheet(page);
    await expectVisible('agentInstructionsGear', page.locator(sel.agentInstructionsGear));

    // Collapse again: the expanded sheet renders a full-screen overlay
    // (AgentChat.tsx's `styles.overlay`) that intercepts clicks elsewhere.
    await page.click(sel.chatCollapseHeaderBtn);
    await page.waitForTimeout(500);

    // ---- Feedback modal ----
    await sel.openFeedback(page);
    await expectVisible('feedbackCategory', page.locator(sel.feedbackCategory));
    await expectVisible('feedbackTool', page.locator(sel.feedbackTool));
    await expectVisible('feedbackMessage', page.locator(sel.feedbackMessage));
    record('feedbackSubmit', (await page.locator(sel.feedbackSubmit).count()) === 1);
    record('feedbackCancel', (await page.locator(sel.feedbackCancel).count()) === 1);
    await page.click(sel.feedbackCancel);
    await page.waitForTimeout(300);

    // ---- Nutrition tab ----
    await page.goto(`${appBase}/?tab=nutrition`);
    await waitFor(
      page,
      () => [...document.querySelectorAll('[class*="entryRow"]')].some((e) => e.textContent.includes('ZZTEST Entry')),
      { timeout: 20000 },
    );
    await expectVisible('entryRow', page.locator(sel.entryRow).filter({ hasText: 'ZZTEST Entry' }));
    await expectVisible('nutritionDateInput', sel.nutritionDateInput(page));

    await page.click('button:has-text("Add food")');
    await page.waitForSelector('button[aria-label="Add ingredient"]', { timeout: 10000 });
    await page.click('button[aria-label="Add ingredient"]');
    await expectVisible('ingredientSheetDialog', sel.ingredientSheetDialog(page));

    const miss = results.filter((r) => !r.ok);
    console.log('RESULT', JSON.stringify({ total: results.length, passed: results.length - miss.length, results }, null, 1));
    if (miss.length > 0) process.exitCode = 1;
  } finally {
    if (entryId) await api.delete(`nutrition/entries/${entryId}`).catch(() => {});
    if (sectionId) await api.delete(`sections/${sectionId}`).catch(() => {});
    await teardown({ browser, api, stack });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
