// Polls the sheet height at high frequency across a real touch tap. If the
// sheet opens and then closes again within a few hundred ms, the tap is
// working and something is closing it right after, rather than the tap
// failing to register at all.
import { launchAuthed, teardown } from '../lib/browser.mjs';

const { page, api, appBase, browser } = await launchAuthed({
  contextOptions: { viewport: { width: 430, height: 932 }, hasTouch: true, isMobile: true, deviceScaleFactor: 3 },
});

try {
  await page.goto(`${appBase}/?tab=workouts`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);

  const rect = await page.evaluate(() => {
    const r = document.querySelector('button[class*="floatingChatBtn"]').getBoundingClientRect();
    return { cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
  });

  // Record every sheet-height change plus any click that lands anywhere.
  await page.evaluate(() => {
    window.__trace = [];
    const t0 = performance.now();
    window.__clicks = [];
    document.addEventListener('click', (e) => {
      const el = e.target;
      window.__clicks.push({
        t: Math.round(performance.now() - t0),
        tag: el.tagName,
        cls: String(el.className).slice(0, 70),
      });
    }, true);
    let last = null;
    const tick = () => {
      const s = document.querySelector('div[class*="_sheet_"]');
      const h = s ? Math.round(s.getBoundingClientRect().height) : -1;
      if (h !== last) {
        window.__trace.push({ t: Math.round(performance.now() - t0), h });
        last = h;
      }
      if (performance.now() - t0 < 3000) requestAnimationFrame(tick);
    };
    tick();
  });

  await page.touchscreen.tap(rect.cx, rect.cy);
  await page.waitForTimeout(3200);

  const result = await page.evaluate(() => ({
    heightChanges: window.__trace,
    clicks: window.__clicks,
  }));

  console.log('RESULT', JSON.stringify(result, null, 2));
} finally {
  await teardown({ browser, api });
}
