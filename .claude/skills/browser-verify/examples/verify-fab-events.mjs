// Instruments which pointer/touch events the chat FAB actually receives on a
// touch tap versus a mouse click, to explain why the sheet opens for one and
// not the other.
import { launchAuthed, teardown } from '../lib/browser.mjs';

const { page, api, appBase, browser } = await launchAuthed({
  contextOptions: {
    viewport: { width: 430, height: 932 },
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 3,
  },
});

try {
  await page.goto(`${appBase}/?tab=workouts`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);

  const rect = await page.evaluate(() => {
    const el = document.querySelector('button[class*="floatingChatBtn"]');
    const r = el.getBoundingClientRect();
    window.__ev = [];
    for (const type of [
      'pointerdown', 'pointermove', 'pointerup', 'pointercancel',
      'touchstart', 'touchend', 'touchcancel', 'click', 'lostpointercapture',
    ]) {
      el.addEventListener(type, (e) => {
        window.__ev.push({
          type,
          pointerType: e.pointerType ?? null,
          clientY: e.clientY ?? null,
          defaultPrevented: e.defaultPrevented,
        });
      }, true);
    }
    return { cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
  });

  await page.touchscreen.tap(rect.cx, rect.cy);
  await page.waitForTimeout(1200);

  const touchEvents = await page.evaluate(() => {
    const ev = window.__ev.slice();
    window.__ev = [];
    const s = document.querySelector('div[class*="_sheet_"]');
    return { ev, sheet: s ? Math.round(s.getBoundingClientRect().height) : -1 };
  });

  await page.mouse.click(rect.cx, rect.cy);
  await page.waitForTimeout(1200);

  const mouseEvents = await page.evaluate(() => {
    const s = document.querySelector('div[class*="_sheet_"]');
    return { ev: window.__ev.slice(), sheet: s ? Math.round(s.getBoundingClientRect().height) : -1 };
  });

  console.log('RESULT', JSON.stringify({
    touch: { sheetHeight: touchEvents.sheet, events: touchEvents.ev },
    mouse: { sheetHeight: mouseEvents.sheet, events: mouseEvents.ev },
  }, null, 2));
} finally {
  await teardown({ browser, api });
}
