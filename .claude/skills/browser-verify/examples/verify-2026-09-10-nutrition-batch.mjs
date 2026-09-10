// Nutrition tracker batch: icon today button, row tap opens the editor, even totals
// spacing with no goals, Cancel keeps the manual-add draft. Pass --mobile for 390px.
// Expects the API on 5055 and vite on 5056; restores goals and deletes its entry.
import { launchAuthed, teardown, waitFor } from '../lib/browser.mjs';

const mobile = process.argv.includes('--mobile');
const { page, api, appBase, browser } = await launchAuthed({
  apiBase: 'http://localhost:5055/api/',
  appBase: 'http://localhost:5056',
  ...(mobile ? { contextOptions: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } } : {}),
});
const sleep = ms => new Promise(r => setTimeout(r, ms));
const consoleErrors = [];
page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200)); });
page.on('pageerror', e => consoleErrors.push('pageerror: ' + e.message.slice(0, 200)));

function localDate(d = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
const today = localDate();
const R = {};
let entryId;
let savedGoals;

const headings = () => page.evaluate(() => [...document.querySelectorAll('h2')].filter(h => h.getBoundingClientRect().height > 0).map(h => h.textContent));

try {
  // Fixtures: one entry today; goals cleared (restored in finally)
  const g = await api.get('nutrition/goals');
  savedGoals = (await g.json()).data ?? null;
  R.savedGoals = savedGoals;
  const e = await api.post('nutrition/entries', { data: {
    localDate: today, meal: 'lunch', name: 'ZZTEST Wave1 Entry', source: 'manual',
    ingredients: [{ name: 'ZZTEST rice', grams: 100, source: 'manual', calories: 130, protein_g: 3, carbs_g: 28, fat_g: 0 }],
  } });
  const ej = await e.json();
  entryId = ej.data?.id ?? ej.data?.entry?.id ?? ej.id;
  R.entrySeed = { status: e.status(), entryId };

  await page.goto(`${appBase}/?tab=nutrition`);
  await waitFor(page, () => [...document.querySelectorAll('div[class*="entryRow"]')].some(r => r.textContent.includes('ZZTEST Wave1 Entry')), { timeout: 25000 });

  // #331: today button shows an icon, not text
  await page.evaluate(() => document.querySelector('button[aria-label="Previous day"]').click());
  await waitFor(page, () => !!document.querySelector('button[aria-label="Jump to today"]'));
  R.i331 = await page.evaluate(() => {
    const b = document.querySelector('button[aria-label="Jump to today"]');
    const prev = document.querySelector('button[aria-label="Previous day"]');
    const svg = b.querySelector('svg');
    const rb = b.getBoundingClientRect(), rp = prev.getBoundingClientRect();
    return { text: b.textContent.trim(), svgClass: svg?.getAttribute('class'), svgSize: svg ? [svg.getBoundingClientRect().width, svg.getBoundingClientRect().height] : null,
      title: b.getAttribute('title'), btn: [rb.width, rb.height], prevBtn: [rp.width, rp.height] };
  });
  await page.evaluate(() => document.querySelector('button[aria-label="Jump to today"]').click());
  await waitFor(page, () => !document.querySelector('button[aria-label="Jump to today"]'));

  // #332: no goals, measure space above and below the calories number
  await api.put('nutrition/goals', { data: { calories: null, protein_g: null, carbs_g: null, fat_g: null, fiber_g: null } });
  await page.reload();
  await waitFor(page, () => !!document.querySelector('span[class*="caloriesBig"]'), { timeout: 20000 });
  await sleep(800);
  const measure = () => page.evaluate(() => {
    const big = document.querySelector('span[class*="caloriesBig"]');
    const card = big.closest('div[class*="totalsCard"]');
    const rc = card.getBoundingClientRect(), rb = big.getBoundingClientRect();
    return { above: +(rb.top - rc.top).toFixed(1), below: +(rc.bottom - rb.bottom).toFixed(1), cardH: +rc.height.toFixed(1),
      children: card.children.length, emptyChildren: [...card.children].filter(c => c.children.length === 0 && !c.textContent.trim()).length };
  });
  R.i332_noGoals = await measure();
  await api.put('nutrition/goals', { data: { calories: 2000, protein_g: 150, carbs_g: null, fat_g: null, fiber_g: null } });
  await page.reload();
  await waitFor(page, () => !!document.querySelector('span[class*="caloriesBig"]'), { timeout: 20000 });
  await sleep(800);
  R.i332_withGoals = await measure();

  // #326: tapping the row opens the editor; the menu does not
  await waitFor(page, () => [...document.querySelectorAll('div[class*="entryRow"]')].some(r => r.textContent.includes('ZZTEST Wave1 Entry')), { timeout: 20000 });
  const rowCenter = await page.evaluate(() => {
    const row = [...document.querySelectorAll('div[class*="entryRow"]')].find(r => r.textContent.includes('ZZTEST Wave1 Entry'));
    row.scrollIntoView({ block: 'center' });
    const name = [...row.querySelectorAll('*')].find(el => el.children.length === 0 && el.textContent.includes('ZZTEST Wave1 Entry'));
    const r = (name ?? row).getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, role: row.getAttribute('role') ?? row.querySelector('[role=button]')?.getAttribute('role'), tabIndex: row.tabIndex };
  });
  await page.mouse.click(rowCenter.x, rowCenter.y);
  await sleep(700);
  R.i326_rowTap = { ...rowCenter, headings: await headings() };
  const editName = await page.evaluate(() => document.querySelector('input[placeholder="e.g. Chicken salad"]')?.value);
  R.i326_rowTap.editorName = editName;
  await page.keyboard.press('Escape'); await sleep(600);

  const menuBtn = await page.evaluate(() => {
    const row = [...document.querySelectorAll('div[class*="entryRow"]')].find(r => r.textContent.includes('ZZTEST Wave1 Entry'));
    const b = row.querySelector('div[class*="entryMenuWrapper"] button');
    const r = b.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await page.mouse.click(menuBtn.x, menuBtn.y);
  await sleep(500);
  R.i326_menuTap = { headings: await headings(), menuItems: await page.evaluate(() => [...document.querySelectorAll('[role=menuitem]')].filter(m => m.getBoundingClientRect().height > 0).map(m => m.textContent.trim())) };
  // close menu via outside click
  await page.mouse.click(5, 5); await sleep(400);
  R.i326_menuClosed = await page.evaluate(() => [...document.querySelectorAll('[role=menuitem]')].filter(m => m.getBoundingClientRect().height > 0).length === 0);
  R.i326_afterOutside = { headings: await headings() };

  // keyboard: focus row, press Enter
  await page.evaluate(() => {
    const row = [...document.querySelectorAll('div[class*="entryRow"]')].find(r => r.textContent.includes('ZZTEST Wave1 Entry'));
    (row.getAttribute('role') === 'button' ? row : row.querySelector('[role=button]'))?.focus();
  });
  await page.keyboard.press('Enter'); await sleep(600);
  R.i326_keyboard = { headings: await headings() };
  await page.keyboard.press('Escape'); await sleep(600);

  // #328 partial: Cancel keeps the draft
  await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('peak.entryDraft')).forEach(k => localStorage.removeItem(k)));
  await page.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent.includes('Add food') && b.getBoundingClientRect().height > 0).click());
  await waitFor(page, () => [...document.querySelectorAll('h2')].some(h => h.textContent === 'Add Food Entry'));
  await page.locator('input[placeholder="e.g. Chicken salad"]').fill('ZZTEST cancel draft');
  await sleep(800);
  await page.evaluate(() => {
    const d = [...document.querySelectorAll('h2')].find(h => h.textContent === 'Add Food Entry').closest('[role=dialog]');
    [...d.querySelectorAll('button')].find(b => b.textContent.trim() === 'Cancel').click();
  });
  await sleep(600);
  R.i328_afterCancel = await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('peak.entryDraft')));
  await page.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent.includes('Add food') && b.getBoundingClientRect().height > 0).click());
  await sleep(700);
  R.i328_reopened = await page.evaluate(() => ({ name: document.querySelector('input[placeholder="e.g. Chicken salad"]')?.value, note: document.body.textContent.includes('Restored your unsaved entry') }));
  await page.keyboard.press('Escape'); await sleep(400);

  R.consoleErrors = consoleErrors;
  console.log('RESULT', JSON.stringify(R));
} finally {
  await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('peak.entryDraft')).forEach(k => localStorage.removeItem(k))).catch(() => {});
  if (entryId) await api.delete(`nutrition/entries/${entryId}`).catch(() => {});
  if (savedGoals !== undefined) await api.put('nutrition/goals', { data: savedGoals ?? { calories: null, protein_g: null, carbs_g: null, fat_g: null, fiber_g: null } }).catch(() => {});
  await teardown({ browser, api });
}
