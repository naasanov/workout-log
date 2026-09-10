// Splits a real touch into separate touchStart / touchEnd via CDP so the
// state between them is observable. If the sheet gains its dragging class
// after touchStart, React's onPointerDown ran; if the sheet is still closed
// after touchEnd, onPointerUp is the one failing.
import { launchAuthed, teardown } from '../lib/browser.mjs';

const { page, api, appBase, browser, context } = await launchAuthed({
  contextOptions: { viewport: { width: 430, height: 932 }, hasTouch: true, isMobile: true, deviceScaleFactor: 3 },
});

const snap = () => page.evaluate(() => {
  const s = document.querySelector('div[class*="_sheet_"]');
  return {
    h: s ? Math.round(s.getBoundingClientRect().height) : -1,
    dragging: s ? /sheetDragging/.test(String(s.className)) : null,
    fab: !!document.querySelector('button[class*="floatingChatBtn"]'),
  };
});

try {
  await page.goto(`${appBase}/?tab=workouts`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);

  const rect = await page.evaluate(() => {
    const r = document.querySelector('button[class*="floatingChatBtn"]').getBoundingClientRect();
    return { cx: Math.round(r.x + r.width / 2), cy: Math.round(r.y + r.height / 2) };
  });

  const cdp = await context.newCDPSession(page);
  const before = await snap();

  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: rect.cx, y: rect.cy, id: 1 }],
  });
  await page.waitForTimeout(400);
  const afterDown = await snap();

  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(900);
  const afterUp = await snap();

  console.log('RESULT', JSON.stringify({ before, afterDown, afterUp }, null, 2));
} finally {
  await teardown({ browser, api });
}
