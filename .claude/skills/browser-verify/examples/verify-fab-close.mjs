// Regression check for the FAB's touchstart guard: suppressing the ghost
// click must not stop a genuine outside tap from closing the sheet. Opens
// via the FAB, then taps near the top of the screen, on the overlay.
import { launchAuthed, teardown } from '../lib/browser.mjs';

async function run(label, touch) {
  const { page, api, appBase, browser } = await launchAuthed({
    contextOptions: {
      viewport: touch ? { width: 430, height: 932 } : { width: 1280, height: 900 },
      hasTouch: touch,
      isMobile: touch,
      deviceScaleFactor: touch ? 3 : 1,
    },
  });
  const out = { label };
  try {
    await page.goto(`${appBase}/?tab=workouts`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2500);

    const rect = await page.evaluate(() => {
      const r = document.querySelector('button[class*="floatingChatBtn"]').getBoundingClientRect();
      return { cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
    });

    const h = () => page.evaluate(() => {
      const s = document.querySelector('div[class*="_sheet_"]');
      return s ? Math.round(s.getBoundingClientRect().height) : -1;
    });

    if (touch) await page.touchscreen.tap(rect.cx, rect.cy);
    else await page.mouse.click(rect.cx, rect.cy);
    await page.waitForTimeout(1200);
    out.afterOpen = await h();

    // Tap the overlay well above the sheet's top edge.
    if (touch) await page.touchscreen.tap(215, 40);
    else await page.mouse.click(640, 40);
    await page.waitForTimeout(1200);
    out.afterOutsideTap = await h();
    out.opened = out.afterOpen > 50;
    out.closed = out.afterOutsideTap <= 50;
  } catch (e) {
    out.error = String(e).slice(0, 160);
  } finally {
    await teardown({ browser, api });
  }
  return out;
}

console.log('RESULT', JSON.stringify({
  mouse: await run('desktop-mouse', false),
  touch: await run('iphone-touch', true),
}, null, 2));
