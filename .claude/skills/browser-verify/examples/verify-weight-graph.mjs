// Template: seed a fixture through the API, drive the real UI, assert on
// computed DOM state, clean up. Copy this file's shape for a new check
// rather than editing it in place: see ../SKILL.md.
//
// Run: node .claude/skills/browser-verify/examples/verify-weight-graph.mjs

import { launchAuthed, teardown, waitFor } from '../lib/browser.mjs';
import * as sel from '../lib/selectors.mjs';

const FIXTURE_LABEL = 'ZZTEST Section'; // ZZTEST prefix = safe to bulk-delete

async function main() {
  const { page, api, appBase, browser, stack } = await launchAuthed({ stack: true });
  let sectionId;

  try {
    // --- seed via API (fast, no UI clicks) ---
    // No leading slash on any path: see the comment on DEFAULTS.apiBase in lib/browser.mjs.
    const section = await (await api.post('sections', { data: { label: FIXTURE_LABEL } })).json();
    sectionId = section.data.sectionId;
    const movement = await (
      await api.post(`movements/${sectionId}`, { data: { label: 'ZZTEST Movement' } })
    ).json();
    const variation = await (
      await api.post(`variations/${movement.data.movementId}`, {
        data: { label: 'ZZTEST Variation', weight: 175, reps: 5 },
      })
    ).json();
    const variationId = variation.data.variationId;

    for (const [weight, reps, date] of [
      [195, 0, '2026-07-15T12:00:00.000Z'],
      [205, 5, '2026-07-22T12:00:00.000Z'],
      [220, 3, '2026-07-29T12:00:00.000Z'],
    ]) {
      await api.patch(`variations/${variationId}`, { data: { weight, reps, date } });
    }

    // --- drive the real UI ---
    // Variation rows have no containing wrapper element (flat siblings from
    // one .map()) and the graph button has no aria-label, so selectors.mjs
    // scopes by DOM order: the Nth name cell pairs with the Nth graph
    // button. See lib/selectors.mjs for the rest of the reasoning.
    //
    // Generous timeout: the FIRST page load against a cold `vite` dev server
    // compiles SCSS on demand and can take several seconds by itself, on top
    // of normal fetch+render. It's fast on every subsequent run against the
    // same long-lived process: this isn't a real app issue.
    await page.goto(appBase);
    await waitFor(
      page,
      () => [...document.querySelectorAll('span')].some((s) => s.textContent === 'ZZTEST Variation'),
      { timeout: 20000 },
    );
    // A `_remove_<hash>` swipe-affordance overlay on the section header
    // periodically animates over the row and intercepts Playwright's
    // actionability hit-test, hanging `.click()` in a retry loop
    // indefinitely even though the button is genuinely clickable to a real
    // user. A native DOM click (no hit-testing) routes around it.
    await page.evaluate(
      ({ nameCellSel, graphBtnSel }) => {
        const nameCells = [...document.querySelectorAll(nameCellSel)];
        const idx = nameCells.findIndex((nc) => nc.querySelector('span')?.textContent === 'ZZTEST Variation');
        document.querySelectorAll(graphBtnSel)[idx].click();
      },
      { nameCellSel: sel.variationNameCell, graphBtnSel: sel.variationGraphBtn },
    );
    await waitFor(page, () => !!document.querySelector('.recharts-surface'));

    // --- assert on computed state, not eyeballed screenshots ---
    // Note: `.recharts-yAxis` (the axis <g>) does NOT contain the tick
    // *labels* in the DOM tree recharts renders: they're a sibling group
    // with class `recharts-yAxis-tick-labels`. Scope to that instead.
    const result = await page.evaluate(() => {
      const ticks = [...document.querySelectorAll('.recharts-yAxis-tick-labels tspan')]
        .map((t) => Number(t.textContent));
      return { yAxisMin: Math.min(...ticks), yAxisMax: Math.max(...ticks), yAxisTicks: ticks };
    });
    console.log('RESULT', JSON.stringify(result));
  } finally {
    // --- cleanup: DELETE cascades sections -> movements -> variations -> history ---
    if (sectionId) await api.delete(`sections/${sectionId}`);
    await teardown({ browser, api, stack });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
