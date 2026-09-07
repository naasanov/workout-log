// Discriminates whether React's onPointerDown/onPointerUp handlers actually
// run on a touch tap, by watching the sheet's dragging class (set on down,
// cleared on up) and the FAB's presence (removed once expanded).
import { launchAuthed, teardown } from '../lib/browser.mjs';

const { page, api, appBase, browser } = await launchAuthed({
  contextOptions: { viewport: { width: 430, height: 932 }, hasTouch: true, isMobile: true, deviceScaleFactor: 3 },
});

const snap = () => page.evaluate(() => {
  const sheet = document.querySelector('div[class*="_sheet_"]');
  const fab = document.querySelector('button[class*="floatingChatBtn"]');
  return {
    sheetH: sheet ? Math.round(sheet.getBoundingClientRect().height) : -1,
    sheetCls: sheet ? String(sheet.className) : null,
    dragging: sheet ? /sheetDragging/.test(String(sheet.className)) : null,
    fabPresent: !!fab,
    inlineHeight: sheet ? sheet.style.height || null : null,
  };
});

try {
  await page.goto(`${appBase}/?tab=workouts`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);

  const rect = await page.evaluate(() => {
    const r = document.querySelector('button[class*="floatingChatBtn"]').getBoundingClientRect();
    return { cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
  });

  const before = await snap();

  // Hold the touch down without releasing, to observe the pointerdown state.
  await page.touchscreen.tap(rect.cx, rect.cy);
  await page.waitForTimeout(1500);
  const afterTap = await snap();

  // Now a manual down/up pair with an explicit pause between them.
  await page.evaluate(() => { window.__phase = []; });
  const manual = await page.evaluate(async ({ cx, cy }) => {
    const el = document.querySelector('button[class*="floatingChatBtn"]');
    if (!el) return { skipped: 'no fab' };
    const mk = (type) => new PointerEvent(type, {
      bubbles: true, cancelable: true, composed: true,
      pointerId: 1, pointerType: 'touch', isPrimary: true,
      clientX: cx, clientY: cy,
    });
    const sheetState = () => {
      const s = document.querySelector('div[class*="_sheet_"]');
      return { h: s ? Math.round(s.getBoundingClientRect().height) : -1, drag: s ? /sheetDragging/.test(String(s.className)) : null };
    };
    el.dispatchEvent(mk('pointerdown'));
    await new Promise((r) => setTimeout(r, 300));
    const midDown = sheetState();
    el.dispatchEvent(mk('pointerup'));
    await new Promise((r) => setTimeout(r, 600));
    return { midDown, afterUp: sheetState() };
  }, rect);

  console.log('RESULT', JSON.stringify({ before, afterTap, manual }, null, 2));
} finally {
  await teardown({ browser, api });
}
