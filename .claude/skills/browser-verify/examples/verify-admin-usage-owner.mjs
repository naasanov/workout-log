// Verifies the owner-only AI usage dashboard (#325) for the OWNER account:
// nav entry appears, range chips change the numbers, both charts render, no
// horizontal scroll at 390px. Run against a server started with
// OWNER_EMAIL=dev@dev.com. See ../SKILL.md.
//
// Run: node .claude/skills/browser-verify/examples/verify-admin-usage-owner.mjs

import { launchAuthed, teardown, waitFor } from '../lib/browser.mjs';

async function main() {
  const { page, api, appBase, browser } = await launchAuthed({
    apiBase: 'http://localhost:5095/api/',
    appBase: 'http://localhost:5096',
    contextOptions: { viewport: { width: 390, height: 844 } },
  });

  try {
    await page.goto(appBase);
    await waitFor(page, () => !!document.querySelector('button[aria-label="Open navigation menu"]'), { timeout: 20000 });

    // Open the nav drawer and confirm the owner-only entry point is present.
    await page.click('button[aria-label="Open navigation menu"]');
    await waitFor(page, () => document.querySelector('[role="dialog"][aria-label="Navigation menu"]')?.className.includes('drawerOpen'));
    const hasNavEntry = await waitFor(
      page,
      () => [...document.querySelectorAll('nav[aria-label="Main navigation"] button')].some((b) => b.textContent === 'AI Usage'),
      { timeout: 10000 },
    ).then(() => true).catch(() => false);

    // Click into the dashboard.
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('nav[aria-label="Main navigation"] button')].find((b) => b.textContent === 'AI Usage');
      btn.click();
    });
    await waitFor(page, () => [...document.querySelectorAll('span')].some((s) => s.textContent === 'Estimated cost'), { timeout: 10000 });
    await waitFor(page, () => document.querySelectorAll('.recharts-surface').length >= 2, { timeout: 10000 });

    function readTiles() {
      return [...document.querySelectorAll('[class*="statTile"]')].map((tile) => {
        const label = tile.querySelector('[class*="statLabel"]')?.textContent;
        const value = tile.querySelector('[class*="statValue"]')?.textContent;
        return [label, value];
      });
    }

    const tiles30d = await page.evaluate(readTiles);
    const chartCount30d = await page.evaluate(() => document.querySelectorAll('.recharts-surface').length);
    const scroll = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      innerWidth: window.innerWidth,
    }));

    // Switch to the 7D chip and confirm the numbers actually change (fewer
    // seeded rows fall in a 7-day window than the 30-day default).
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('[class*="rangeChip"]')].find((b) => b.textContent === '7D');
      btn.click();
    });
    await new Promise((r) => setTimeout(r, 500));
    const tiles7d = await page.evaluate(readTiles);

    console.log('RESULT', JSON.stringify({ hasNavEntry, tiles30d, tiles7d, chartCount30d, scroll }, null, 2));
  } finally {
    await teardown({ browser, api });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
