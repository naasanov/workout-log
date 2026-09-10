// GFM tables in the AI chat at 390px: injects an assistant message by intercepting
// /api/chat/active (nothing persisted), then measures cell wrapping and horizontal scroll.
// Expects the API on 5055 and vite on 5056; screenshots land in /tmp.
import { launchAuthed, teardown, waitFor } from '../lib/browser.mjs';

const { page, api, appBase, browser } = await launchAuthed({
  apiBase: 'http://localhost:5055/api/',
  appBase: 'http://localhost:5056',
  contextOptions: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
});
const sleep = ms => new Promise(r => setTimeout(r, ms));
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
page.on('pageerror', e => errors.push('pageerror: ' + e.message.slice(0, 200)));

const TABLE_MD = [
  'Here is your week:',
  '',
  '| Day | Calories | Protein | Carbs | Fat | Fiber | Sodium | Notes about the day |',
  '| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |',
  '| Monday | 2,140 | 162 g | 210 g | 71 g | 31 g | 2,300 mg | ~~Skipped~~ ate a late dinner |',
  '| Tuesday | 1,980 | 150 g | 190 g | 66 g | 28 g | 2,100 mg | See https://example.com |',
  '',
  '- [x] Logged every meal',
  '',
  '| Food | Grams | kcal |',
  '| --- | ---: | ---: |',
  '| Grilled chicken breast | 150 | 248 |',
  '| Brown rice | 200 | 222 |',
].join('\n');

await page.route('**/api/chat/active', async route => {
  const res = await route.fetch();
  const body = await res.json();
  const now = new Date().toISOString();
  body.data.messages = [
    ...(body.data.messages ?? []),
    { id: 'zztest-u1', role: 'user', parts: [{ type: 'text', text: 'ZZTEST show a table' }], interrupted: false, created_at: now },
    { id: 'zztest-a1', role: 'assistant', parts: [{ type: 'text', text: TABLE_MD }], interrupted: false, created_at: now },
  ];
  await route.fulfill({ response: res, json: body });
});

try {
  await page.goto(`${appBase}/?tab=nutrition`);
  await waitFor(page, () => !!document.querySelector('button[aria-label^="Open "][aria-label$=" chat"]'), { timeout: 25000 }).catch(() => {});
  const opened = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button[aria-label^="Open "][aria-label$=" chat"]')].find(x => x.checkVisibility());
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, label: b.getAttribute('aria-label') };
  });
  if (opened) { await page.mouse.click(opened.x, opened.y); await sleep(1500); }
  if (!opened) {
    await page.focus('[aria-label="Expand AI chat"]').catch(() => {});
    await page.keyboard.press('Enter');
  }
  await waitFor(page, () => [...document.querySelectorAll('table')].some(t => t.textContent.includes('Monday')), { timeout: 20000 });
  await sleep(500);
  const R = await page.evaluate(() => {
    const t = [...document.querySelectorAll('table')].find(t => t.textContent.includes('Monday'));
    const wrap = t.parentElement;
    const cs = getComputedStyle(wrap);
    const th = t.querySelector('th'), td = t.querySelector('td');
    const bubble = t.closest('[class*="bubbleMarkdown"]');
    const cb = bubble?.querySelector('input[type=checkbox]');
    return {
      wrapperClass: wrap.className, wrapperOverflowX: cs.overflowX,
      wrapperClient: wrap.clientWidth, tableScrollWidth: wrap.scrollWidth, scrollsInside: wrap.scrollWidth > wrap.clientWidth,
      bubbleWidth: bubble?.getBoundingClientRect().width,
      rows: t.querySelectorAll('tr').length, ths: t.querySelectorAll('th').length,
      thWeight: getComputedStyle(th).fontWeight, tdBorder: getComputedStyle(td).borderTopWidth + ' ' + getComputedStyle(td).borderTopStyle,
      tdPadding: getComputedStyle(td).padding, tdLetterSpacing: getComputedStyle(td).letterSpacing, tdFont: getComputedStyle(td).fontSize,
      numericAlign: getComputedStyle(t.querySelectorAll('td')[1]).textAlign,
      del: !!t.querySelector('del'), link: t.querySelector('a')?.getAttribute('href'),
      checkbox: cb ? { disabled: cb.disabled, checked: cb.checked } : null,
      rawPipesVisible: bubble?.textContent.includes('| ---'),
      pageScrollX: document.documentElement.scrollWidth - window.innerWidth,
    };
  });
  R.errors = errors;
  R.opened = opened;
  R.visibleTables = await page.evaluate(() => [...document.querySelectorAll('table')].map(t => ({ wrapW: t.parentElement.clientWidth, rowsH: [...t.querySelectorAll('tr')].map(r => Math.round(r.getBoundingClientRect().height)), vis: t.checkVisibility({ opacityProperty: true, visibilityProperty: true }), rect: t.getBoundingClientRect().toJSON(), wraps: t.querySelector('td').getClientRects().length, tdH: t.querySelector('td').getBoundingClientRect().height })));
  await page.screenshot({ path: '/tmp/pr335-page.png' });
  const loc = page.locator('table').filter({ hasText: 'Monday' }).first();
  await loc.scrollIntoViewIfNeeded().catch(() => {});
  await sleep(800);
  await loc.locator('xpath=ancestor::*[contains(@class,"bubbleMarkdown")]').screenshot({ path: '/tmp/pr335-table.png' }).catch(e => R.shotErr = e.message.slice(0,200));
  console.log('RESULT', JSON.stringify(R));
} finally {
  await teardown({ browser, api });
}
