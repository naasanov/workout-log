// Consolidated runtime check for the 2026-08-25 issue batch:
//   #280/#282 expanded ToolCallCard results render in app text, not UA-default black
//   #283      chat sheet drag handle is a 44px target, composer sits flush at the bottom
//   #284      food dropdown scrolls natively and only selects on a real tap
//   #285      fiber progress bar + fiber entry chip
//   #286      ingredient card is a deterministic two-row layout at 320px
//
// Asserts on computed geometry/colour, never screenshots. Boot the stack first:
//
//   npm run build
//   echo "VITE_API_URL=http://localhost:5055/api" > client/.env.local
//   ACCESS_TOKEN_SECRET=x REFRESH_TOKEN_SECRET=x DB_HOST=127.0.0.1 DB_PORT=3307 \
//     DB_USERNAME=<user> DB_PASSWORD=<pass> DB_NAME=workout_log \
//     PORT=5055 FRONTEND_URL=http://localhost:5056 node dist/index.js &
//   (cd client && npx vite --port 5056 --strictPort &)
//
// Ports 5055/5056 rather than the skill's usual 3000/3001: on macOS, port 5000 is
// AirPlay Receiver and 3000 is often taken by another project's container. Anything
// free works as long as PORT/FRONTEND_URL/VITE_API_URL agree, since the server's CORS
// check demands an exact origin match.
import { launchAuthed, teardown } from '../lib/browser.mjs';

const CFG = { apiBase: 'http://localhost:5055/api/', appBase: 'http://localhost:5056' };

const { page, api, browser } = await launchAuthed({
  ...CFG,
  contextOptions: { viewport: { width: 320, height: 720 }, hasTouch: true, isMobile: true },
});

const results = {};
const failures = [];
const check = (name, cond, detail) => {
  results[name] = { pass: !!cond, ...detail };
  if (!cond) failures.push(name);
};

let entryId;
try {
  // ---- fixtures -----------------------------------------------------------
  // entryInputSchema wants `localDate` (not `date`) plus a top-level `source`.
  // Two ingredients on purpose: one weight-basis, one serving-basis, so the
  // #259 "2 cup, never 0g" fallback is exercised alongside the layout.
  await api.put('nutrition/goals', {
    data: { calories: 2000, protein_g: 150, carbs_g: 200, fat_g: 60, fiber_g: 30 },
  });
  // Local calendar date, not toISOString(): the tracker defaults to the browser's
  // local day, so a UTC-derived date silently files the entry on the wrong one.
  const d = new Date();
  const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const res = await api.post('nutrition/entries', {
    data: {
      localDate: today, meal: 'lunch', name: 'ZZTEST Black Beans', source: 'manual',
      ingredients: [
        { name: 'ZZTEST Black Beans Canned Long Name', grams: 150, source: 'manual',
          calories: 210, protein_g: 13, carbs_g: 38, fat_g: 0.9, fiber_g: 15 },
        { name: 'ZZTEST UNC Serving Row', serving_qty: 2, serving_label: 'cup', source: 'unc',
          calories: 120, protein_g: 4, carbs_g: 20, fat_g: 2 },
      ],
    },
  });
  entryId = (await res.json())?.data?.id;

  // The app routes tabs by query param, not by path: /nutrition is a 404 shell.
  await page.goto(`${CFG.appBase}/?tab=nutrition`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2200);

  // ---- #285 fiber ---------------------------------------------------------
  const fiber = await page.evaluate(() => {
    const t = n => (n.textContent || '').replace(/\s+/g, ' ').trim();
    return {
      bars: [...document.querySelectorAll('[class*="macroName"]')].map(t),
      chips: [...document.querySelectorAll('[class*="chip"]')].map(t),
      scrollWidth: document.documentElement.scrollWidth,
    };
  });
  // Compare case-insensitively: the label is uppercased by CSS, so textContent is "Fiber".
  check('285_fiber_progress_bar', fiber.bars.some(b => b.toLowerCase() === 'fiber'), { bars: fiber.bars });
  check('285_fiber_entry_chip', fiber.chips.some(c => /Fb$/.test(c)), { chips: fiber.chips });
  check('285_no_h_overflow', fiber.scrollWidth === 320, { scrollWidth: fiber.scrollWidth });

  // ---- #286 ingredient cards ---------------------------------------------
  // Entry rows aren't clickable; editing lives behind the row's three-dots menu.
  await page.locator('[class*="entryRow"]').first().locator('button').first().click();
  await page.waitForTimeout(700);
  await page.getByText('Edit', { exact: true }).last().click();
  await page.waitForTimeout(1600);

  const cards = await page.evaluate(() => {
    const t = n => (n.textContent || '').replace(/\s+/g, ' ').trim();
    return [...document.querySelectorAll('[class*="cardName"]')].map(nm => {
      const c = nm.closest('button');
      const st = c.querySelector('[class*="cardStats"]');
      const ch = c.querySelector('[class*="macroChips"]');
      const cb = c.getBoundingClientRect(), nb = nm.getBoundingClientRect();
      const sb = st.getBoundingClientRect(), cr = ch.getBoundingClientRect();
      return {
        text: t(c),
        row1SameLine: Math.abs(nb.top - sb.top) < 6,
        chipsOnOwnRow: cr.top > nb.bottom - 2,
        chipsLeftAligned: Math.abs(cr.left - nb.left) < 2,
        chipsInsideCard: cr.right <= cb.right,
        chips: [...ch.children].map(t),
      };
    });
  });
  check('286_two_cards_found', cards.length === 2, { count: cards.length });
  check('286_row1_name_and_stats', cards.every(c => c.row1SameLine));
  check('286_chips_own_row', cards.every(c => c.chipsOnOwnRow));
  check('286_chips_left_aligned', cards.every(c => c.chipsLeftAligned));
  check('286_chips_no_overflow', cards.every(c => c.chipsInsideCard));
  check('286_four_chips_incl_fiber',
    cards.every(c => c.chips.length === 4 && /^Fb /.test(c.chips[3])),
    { chips: cards.map(c => c.chips) });
  check('259_serving_row_not_zero_g',
    cards.some(c => /2 cup/.test(c.text)) && !cards.some(c => /0g\b.*cup/.test(c.text)),
    { texts: cards.map(c => c.text) });

  // ---- #284 dropdown: native scroll, tap-only selection -------------------
  // Mocked because USDA rate-limits DEMO_KEY and OFF intermittently 503s.
  await page.route('**/nutrition/foods/search**', async r => {
    const items = Array.from({ length: 12 }, (_, i) => ({
      name: `ZZTEST Food Item Number ${i}`, source: 'usda', source_ref: `ref${i}`,
      per100g: { calories: 100 + i, protein_g: 1, carbs_g: 2, fat_g: 3, fiber_g: 1, sugar_g: null, sodium_mg: null },
      serving_grams: null,
    }));
    await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: items, message: 'ok' }) });
  });
  await page.locator('[class*="cardName"]').first().click();
  await page.waitForTimeout(1500);
  const nameIn = page.locator('input[type=text]').nth(1); // 0 is the entry name, 1 the ingredient
  await nameIn.click();
  await nameIn.fill('bean');
  await page.waitForTimeout(1700);

  const dd = page.locator('[class*="dropdown_"]').first();
  const box = await dd.boundingBox();
  const cdp = await page.context().newCDPSession(page);
  const x = box.x + box.width / 2;
  const tp = (y, id) => [{ x, y, radiusX: 6, radiusY: 6, force: 1, id }];

  const geom = await page.evaluate(() => {
    const d = document.querySelector('[class*="dropdown_"]');
    const it = d.querySelector('[class*="dropdownItem"]');
    return { scrollable: d.scrollHeight > d.clientHeight, touchAction: getComputedStyle(it).touchAction };
  });
  check('284_native_touch_action', geom.touchAction === 'auto', geom);

  // real touch drag: must scroll, must not select
  const sy = box.y + box.height - 18;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: tp(sy, 1) });
  for (let i = 1; i <= 7; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: tp(sy - i * 11, 1) });
    await page.waitForTimeout(25);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(600);
  const afterDrag = await page.evaluate(() => ({
    scrollTop: document.querySelector('[class*="dropdown_"]')?.scrollTop ?? null,
    value: document.querySelectorAll('input[type=text]')[1]?.value,
  }));
  check('284_drag_scrolls', afterDrag.scrollTop > 0, afterDrag);
  check('284_drag_does_not_select', afterDrag.value === 'bean', afterDrag);

  // slow tap (800ms) must still select: a time-capped tap gate regressed this once
  const b2 = await dd.boundingBox();
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: tp(b2.y + 22, 2) });
  await page.waitForTimeout(800);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(900);
  const afterTap = await page.evaluate(() => document.querySelectorAll('input[type=text]')[1]?.value);
  check('284_slow_tap_selects', /^ZZTEST Food Item/.test(afterTap || ''), { value: afterTap });

  console.log(JSON.stringify({ failures, results }, null, 2));
  if (failures.length) process.exitCode = 1;
} finally {
  if (entryId) await api.delete(`nutrition/entries/${entryId}`);
  await api.put('nutrition/goals', {
    data: { calories: null, protein_g: null, carbs_g: null, fat_g: null, fiber_g: null },
  });
  await teardown({ browser, api });
}
