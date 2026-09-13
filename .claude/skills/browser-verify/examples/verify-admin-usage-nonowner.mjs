// Verifies the owner-only AI usage dashboard (#325) is fully hidden for a
// NON-owner: no nav entry, and a direct ?tab=admin-usage URL falls back to
// the normal homepage tab rather than showing the dashboard or an error. Run
// against a server started with an OWNER_EMAIL that is NOT dev@dev.com.
//
// Run: node .claude/skills/browser-verify/examples/verify-admin-usage-nonowner.mjs

import { launchAuthed, teardown, waitFor } from '../lib/browser.mjs';

async function main() {
  const { page, api, appBase, browser } = await launchAuthed({
    apiBase: 'http://localhost:5095/api/',
    appBase: 'http://localhost:5096',
    contextOptions: { viewport: { width: 390, height: 844 } },
  });

  try {
    // 1. Confirm the server itself now says dev@dev.com is not the owner.
    const adminRes = await api.get('admin/usage');
    const adminStatus = adminRes.status();

    // 2. Nav drawer: no "AI Usage" entry anywhere in the list.
    await page.goto(appBase);
    await waitFor(page, () => !!document.querySelector('button[aria-label="Open navigation menu"]'), { timeout: 20000 });
    await page.click('button[aria-label="Open navigation menu"]');
    await waitFor(page, () => document.querySelector('[role="dialog"][aria-label="Navigation menu"]')?.className.includes('drawerOpen'));
    // Give the owner-probe query time to resolve (it fails fast against a 404).
    await new Promise((r) => setTimeout(r, 1000));
    const navEntries = await page.evaluate(() => [...document.querySelectorAll('nav[aria-label="Main navigation"] button')].map((b) => b.textContent));

    // 3. Direct URL access falls back to the normal homepage tab, not the
    // dashboard and not an error page.
    await page.evaluate(() => document.querySelector('button[aria-label="Close navigation menu"]')?.click());
    await page.goto(appBase + '/?tab=admin-usage');
    await waitFor(page, () => !!document.querySelector('button[aria-label="Open navigation menu"]'), { timeout: 20000 });
    await new Promise((r) => setTimeout(r, 1500));
    const result = await page.evaluate(() => ({
      url: location.href,
      hasEstimatedCost: [...document.querySelectorAll('span')].some((s) => s.textContent === 'Estimated cost'),
      hasChart: !!document.querySelector('.recharts-surface'),
      bodyText: document.body.textContent.slice(0, 300),
    }));

    console.log('RESULT', JSON.stringify({ adminStatus, navEntries, result }, null, 2));
  } finally {
    await teardown({ browser, api });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
