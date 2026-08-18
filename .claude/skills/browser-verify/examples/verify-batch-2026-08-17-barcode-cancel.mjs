// #251 — barcode scanner Cancel must be tappable inside the IngredientSheet
// Radix dialog ("manual add food" mode).
//
// The bug: <BarcodeScanner> was a sibling of <Dialog.Content> inside
// <Dialog.Portal>. Radix's modal Content marks everything outside its DOM
// subtree inert (pointer-events: none + aria-hidden), so Cancel painted but
// never received input. The fix nests it inside Content.
//
// This asserts what the user actually experiences — would a tap at Cancel's
// own center coordinates land on Cancel — not merely "is it in the DOM".
//
// SELECTOR WARNING (cost two runs): there are TWO BarcodeScanner instances
// and TWO `_sheet_` elements on this page. NutritionChat renders its own
// scan button + scanner inline in MAIN, which precede the body-appended
// dialog portal in DOM order, so a bare querySelector picks the CHAT's, not
// the sheet's — and `el.click()` fires it even though it's inert, so the
// mistake looks exactly like "the fix didn't work". Anchor off the
// ingredient-name input's own [role=dialog] instead.
import { launchAuthed, teardown, waitFor } from '../lib/browser.mjs';

const { page, api, appBase, browser } = await launchAuthed({
  launchOptions: {
    // MUST be the full Chromium build. Playwright's default headless
    // "chromium-headless-shell" has no media stack — getUserMedia rejects
    // with NotSupportedError, BarcodeScanner's catch-block calls onClose(),
    // and the overlay unmounts instantly.
    channel: 'chromium',
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-capture'],
  },
  contextOptions: { permissions: ['camera'] },
});

// Serialized into the page in several evaluates below.
const SHEET = `(() => {
  const i = document.querySelector('input[aria-label="Ingredient name"]');
  return i ? i.closest('[role="dialog"]') : null;
})()`;

const results = {};
const consoleErrors = [];
page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });

async function probe(label, width, height, { openDropdown = false } = {}) {
  await page.setViewportSize({ width, height });
  await page.goto(`${appBase}/?tab=nutrition`);
  await waitFor(page, () => [...document.querySelectorAll('button')].some(b => b.textContent.includes('Add food')), { timeout: 25000 });
  await page.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent.includes('Add food')).click());
  await waitFor(page, () => !!document.querySelector('button[aria-label="Add ingredient"]'));
  await page.evaluate(() => document.querySelector('button[aria-label="Add ingredient"]').click());
  await waitFor(page, () => !!document.querySelector('input[aria-label="Ingredient name"]'));

  // Optionally leave the search dropdown open first. Nesting the scanner
  // inside .sheet (z-index 1101, a stacking context) means its z-index 1102
  // now resolves WITHIN that context, where .searchDropdown sits at 1200 —
  // so the dropdown could paint over the scanner.
  if (openDropdown) {
    await page.evaluate(() => {
      const i = document.querySelector('input[aria-label="Ingredient name"]');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(i, 'chicken');
      i.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await new Promise(r => setTimeout(r, 1500));
  }
  const dropdownOpenBefore = await page.evaluate(`(() => {
    const sheet = ${SHEET};
    return [...sheet.querySelectorAll('*')].some(el => /_searchDropdown_/.test((el.className||'').toString()) && el.getBoundingClientRect().height > 0);
  })()`);

  await page.evaluate(`${SHEET}.querySelector('button[aria-label="Scan barcode"]').click()`);
  await waitFor(page, () => {
    const i = document.querySelector('input[aria-label="Ingredient name"]');
    const sheet = i && i.closest('[role="dialog"]');
    return !!sheet && !!sheet.querySelector('button[aria-label="Close barcode scanner"]');
  }, { timeout: 15000 });
  await new Promise(r => setTimeout(r, 1500)); // let getUserMedia + decode settle

  const measured = await page.evaluate(`(() => {
    const sheet = ${SHEET};
    const btn = sheet.querySelector('button[aria-label="Close barcode scanner"]');
    const r = btn.getBoundingClientRect();
    const cx = Math.round(r.left + r.width / 2);
    const cy = Math.round(r.top + r.height / 2);
    const hit = document.elementFromPoint(cx, cy);
    const overlay = btn.closest('div[class*="_overlay_"]');
    const orect = overlay && overlay.getBoundingClientRect();
    const dd = [...sheet.querySelectorAll('*')].find(el => /_searchDropdown_/.test((el.className||'').toString()) && el.getBoundingClientRect().height > 0);
    return {
      scannerNestedInDialog: !!btn.closest('[role="dialog"]'),
      cancelSize: { w: Math.round(r.width), h: Math.round(r.height) },
      hitIsCancel: !!hit && (hit === btn || btn.contains(hit)),
      hitTag: hit ? hit.tagName + '.' + (hit.className||'').toString().slice(0,40) : null,
      pointerEvents: getComputedStyle(btn).pointerEvents,
      ariaHiddenAncestor: !!btn.closest('[aria-hidden="true"]'),
      overlayCoversViewport: orect ? (Math.round(orect.width) >= window.innerWidth - 1 && Math.round(orect.height) >= window.innerHeight - 1) : null,
      overlaySize: orect ? { w: Math.round(orect.width), h: Math.round(orect.height) } : null,
      viewport: { w: window.innerWidth, h: window.innerHeight },
      dropdownPaintsOverScanner: !!dd,
      videoPresent: !!sheet.querySelector('video'),
      sheetInlineTransformWhileOpen: sheet.style.transform || '(unset)',
    };
  })()`);

  // Click it the way a real user would — real input events, full
  // actionability/hit-test checks, not el.click().
  let closedByRealClick;
  try {
    const box = await page.evaluate(`(() => {
      const b = ${SHEET}.querySelector('button[aria-label="Close barcode scanner"]');
      const r = b.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`);
    await page.mouse.click(box.x, box.y);
    await new Promise(r => setTimeout(r, 800));
    closedByRealClick = await page.evaluate(`(() => {
      const sheet = ${SHEET};
      return !!sheet && !sheet.querySelector('button[aria-label="Close barcode scanner"]');
    })()`);
  } catch (e) {
    closedByRealClick = `click failed: ${String(e).split('\n')[0]}`;
  }

  const afterClose = await page.evaluate(`(() => {
    const sheet = ${SHEET};
    if (!sheet) return { sheetStillOpen: false };
    const nameInput = sheet.querySelector('input[aria-label="Ingredient name"]');
    const nr = nameInput.getBoundingClientRect();
    const nhit = document.elementFromPoint(Math.round(nr.left + nr.width/2), Math.round(nr.top + nr.height/2));
    return {
      sheetStillOpen: true,
      // The fix sets inline transform:none while the scanner is open; it must
      // come back off afterwards or desktop centering stays broken.
      sheetInlineTransformAfter: sheet.style.transform || '(unset)',
      sheetComputedTransformAfter: getComputedStyle(sheet).transform,
      sheetVerticallyCentered: (() => {
        const r = sheet.getBoundingClientRect();
        return { top: Math.round(r.top), height: Math.round(r.height), viewportH: window.innerHeight };
      })(),
      nameInputStillClickable: !!nhit && (nhit === nameInput || nameInput.contains(nhit)),
    };
  })()`);

  results[label] = { dropdownOpenBefore, ...measured, closedByRealClick, ...afterClose };
}

try {
  await probe('mobile-390', 390, 844);
  await probe('desktop-1280', 1280, 900);
  await probe('desktop-1280-dropdown-open', 1280, 900, { openDropdown: true });
  results.consoleErrors = consoleErrors.filter(e => !/favicon|React DevTools/i.test(e));
  console.log('RESULT', JSON.stringify(results, null, 2));
} finally {
  await teardown({ browser, api });
}
