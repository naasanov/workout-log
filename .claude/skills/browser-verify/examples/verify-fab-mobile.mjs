// Repro: tapping the chat FAB opens the sheet on desktop but reportedly not
// in an iPhone-sized touch viewport. Runs the same tap in both and compares
// the sheet's resulting height, plus what element is actually at the tap point.
import { launchAuthed, teardown } from '../lib/browser.mjs';

const IPHONE_15_PRO_MAX = { width: 430, height: 932 };
const DESKTOP = { width: 1280, height: 900 };

async function probe(label, viewport, touch) {
  const { page, api, appBase, browser } = await launchAuthed({
    contextOptions: {
      viewport,
      hasTouch: touch,
      isMobile: touch,
      deviceScaleFactor: touch ? 3 : 1,
      userAgent: touch
        ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
        : undefined,
    },
  });

  const out = { label, viewport, touch };
  try {
    await page.goto(`${appBase}/?tab=workouts`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2500);

    const fab = await page.evaluate(() => {
      const el = document.querySelector('button[class*="floatingChatBtn"]');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return {
        rect: { x: r.x, y: r.y, w: r.width, h: r.height, cx: r.x + r.width / 2, cy: r.y + r.height / 2 },
        touchAction: cs.touchAction,
        pointerEvents: cs.pointerEvents,
        zIndex: cs.zIndex,
        visible: r.width > 0 && r.height > 0,
      };
    });
    out.fab = fab;
    if (!fab) { out.error = 'FAB not found'; return out; }

    // What does the browser think is on top at the FAB's center?
    out.hitTest = await page.evaluate(({ cx, cy }) => {
      const el = document.elementFromPoint(cx, cy);
      if (!el) return null;
      const owner = el.closest('button,[role=button]') || el;
      return {
        tag: el.tagName,
        cls: String(el.className).slice(0, 90),
        ownerCls: String(owner.className).slice(0, 90),
        isFab: /floatingChatBtn/.test(String(owner.className)),
      };
    }, fab.rect);

    const sheetHeight = () => page.evaluate(() => {
      const s = document.querySelector('div[class*="_sheet_"]');
      return s ? Math.round(s.getBoundingClientRect().height) : -1;
    });
    out.sheetBefore = await sheetHeight();

    // Touch first when the context has touch, since that is the input path
    // DevTools device emulation actually dispatches.
    if (touch) {
      await page.touchscreen.tap(fab.rect.cx, fab.rect.cy);
      await page.waitForTimeout(1500);
      out.sheetAfterTouchTap = await sheetHeight();
    }

    if ((out.sheetAfterTouchTap ?? 0) <= 50) {
      await page.mouse.click(fab.rect.cx, fab.rect.cy);
      await page.waitForTimeout(1500);
      out.sheetAfterMouseClick = await sheetHeight();
    }

    out.opened = Math.max(out.sheetAfterTouchTap ?? 0, out.sheetAfterMouseClick ?? 0) > 50;
  } catch (e) {
    out.error = String(e).slice(0, 200);
  } finally {
    await teardown({ browser, api });
  }
  return out;
}

// Drag-to-open regression check: a touch swipe upward starting on the FAB
// should drag the sheet open, same as the tap does. Uses CDP touch events
// (Playwright's touchscreen API has no multi-step swipe) so the gesture
// covers more than the 10px tap threshold and crosses the open midpoint.
async function probeDrag(label, viewport) {
  const { page, api, appBase, browser, context } = await launchAuthed({
    contextOptions: {
      viewport,
      hasTouch: true,
      isMobile: true,
      deviceScaleFactor: 3,
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    },
  });

  const out = { label, viewport };
  try {
    await page.goto(`${appBase}/?tab=workouts`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2500);

    const rect = await page.evaluate(() => {
      const r = document.querySelector('button[class*="floatingChatBtn"]').getBoundingClientRect();
      return { cx: Math.round(r.x + r.width / 2), cy: Math.round(r.y + r.height / 2) };
    });

    const sheetHeight = () => page.evaluate(() => {
      const s = document.querySelector('div[class*="_sheet_"]');
      return s ? Math.round(s.getBoundingClientRect().height) : -1;
    });
    out.sheetBefore = await sheetHeight();

    const cdp = await context.newCDPSession(page);
    const steps = 8;
    const totalDrag = Math.round(viewport.height * 0.6); // well past the midpoint snap
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: rect.cx, y: rect.cy, id: 1 }],
    });
    for (let i = 1; i <= steps; i++) {
      const y = rect.cy - Math.round((totalDrag * i) / steps);
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: rect.cx, y, id: 1 }],
      });
      await page.waitForTimeout(30);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(1000);

    out.sheetAfterDrag = await sheetHeight();
    out.opened = out.sheetAfterDrag > 50;
  } catch (e) {
    out.error = String(e).slice(0, 200);
  } finally {
    await teardown({ browser, api });
  }
  return out;
}

const desktop = await probe('desktop', DESKTOP, false);
const mobile = await probe('iphone-15-pro-max', IPHONE_15_PRO_MAX, true);
const drag = await probeDrag('iphone-15-pro-max-drag', IPHONE_15_PRO_MAX);
console.log('RESULT', JSON.stringify({ desktop, mobile, drag }, null, 2));
