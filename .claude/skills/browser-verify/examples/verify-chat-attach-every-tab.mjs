// The AI chat's photo-attach and barcode-scan composer buttons used to be
// wired only while the nutrition tab was active. This checks they now show
// on every tab (workouts included), while the copy (placeholder, empty-hint,
// accessible label) still reads correctly per tab.
//
// The chat mounts once page-wide and every tab panel stays in the DOM at
// once (only display:none toggles) — so each probe navigates to its own
// `?tab=` before touching the FAB, and re-navigates for the next tab so the
// sheet starts collapsed again rather than carrying state across probes.
//
// SELECTOR WARNING: there are two <BarcodeScanner> mount points on the
// nutrition tab (the chat's own, and the separate "Add food" ingredient
// sheet's, portaled later in the DOM). This script never opens "Add food",
// so a bare `button[aria-label="Scan barcode"]` only ever matches the
// chat's — but it's scoped to `div[class*="_sheet_"]` anyway for safety.
import { launchAuthed, teardown, waitFor } from '../lib/browser.mjs';

const { page, api, appBase, browser } = await launchAuthed();

async function probe(tab) {
  await page.goto(`${appBase}/?tab=${tab}`, { waitUntil: 'networkidle' });
  await waitFor(page, () => !!document.querySelector('button[class*="floatingChatBtn"]'), { timeout: 20000 });

  // Tap (not drag) the FAB — a tap opens the sheet fully expanded.
  const fabBox = await page.evaluate(() => {
    const r = document.querySelector('button[class*="floatingChatBtn"]').getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await page.mouse.click(fabBox.x, fabBox.y);
  await waitFor(page, () => {
    const sheet = document.querySelector('div[class*="_sheet_"]');
    return !!sheet && sheet.getBoundingClientRect().height > 50;
  }, { timeout: 10000 });

  const result = await page.evaluate(() => {
    const sheet = document.querySelector('div[class*="_sheet_"]');
    const attachBtn = sheet.querySelector('button[aria-label="Attach photo"]');
    const scanBtn = sheet.querySelector('button[aria-label="Scan barcode"]');
    const libraryBtn = sheet.querySelector('button[aria-label="Attach from photo library"]');
    const textarea = sheet.querySelector('textarea[aria-label="Chat message"]');
    const emptyHint = sheet.querySelector('[class*="emptyHint"] p');
    return {
      dialogAriaLabel: sheet.getAttribute('aria-label'),
      srOnlyText: sheet.querySelector('[class*="srOnly"]')?.textContent ?? null,
      hasAttachPhotoBtn: !!attachBtn,
      hasScanBarcodeBtn: !!scanBtn,
      hasLibraryBtn: !!libraryBtn,
      placeholder: textarea?.getAttribute('placeholder') ?? null,
      emptyHintText: emptyHint?.textContent ?? null,
    };
  });

  return { tab, ...result };
}

const results = {};
try {
  for (const tab of ['workouts', 'nutrition', 'habits', 'body-weight']) {
    results[tab] = await probe(tab);
  }
  console.log('RESULT', JSON.stringify(results, null, 2));
} finally {
  await teardown({ browser, api });
}
