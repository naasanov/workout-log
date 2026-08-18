// Runtime validation: UNC serving-basis ingredients (feat/unc-dining).
// A UNC dining item has per-serving macros and NO gram weight. This proves the
// row renders by its serving label, that editing quantity 1 -> 2 exactly
// doubles macros, and that the serving basis survives a save round-trip.
import { launchAuthed, teardown, waitFor } from '../lib/browser.mjs';

const { page, api, appBase, browser } = await launchAuthed();
const result = {};
let entryId = null;
const errs = [];
page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });

const today = new Date().toISOString().slice(0, 10);
const PS = { calories: 1070, protein_g: 51, carbs_g: 86, fat_g: 60, fiber_g: 6, sugar_g: 5, sodium_mg: 2650 };
const sheet = () => page.evaluate(() => {
  const i = document.querySelector('input[aria-label="Ingredient name"]');
  const d = i.closest('[role=dialog]');
  const val = al => (d.querySelector(`input[aria-label="${al}"]`) || {}).value;
  return {
    text: d.innerText.replace(/\n+/g, ' | ').slice(0, 300),
    qty: val('Quantity'), kcal: val('Calories'), prot: val('Protein g'),
    carbs: val('Carbs g'), fat: val('Fat g'),
    hasUnitSelect: !!d.querySelector('select'),
  };
});

try {
  const create = await api.post('nutrition/entries', {
    data: {
      localDate: today, meal: 'dinner', name: 'ZZTEST UNC Burrito', source: 'text',
      ingredients: [{
        name: 'ZZTEST Smothered Beef Burrito', grams: null, serving_qty: 1,
        serving_label: '1 each', source: 'unc', source_ref: '11852', ...PS,
      }],
    },
  });
  if (!create.ok()) throw new Error(`create failed ${create.status()} ${await create.text()}`);
  entryId = (await create.json()).data.id;

  // A. server round-trip keeps grams NULL and the serving fields intact
  const ing0 = (await (await api.get(`nutrition/entries/${entryId}`)).json()).data.ingredients[0];
  result.A_serverRoundTrip = {
    grams: ing0.grams, serving_qty: ing0.serving_qty, serving_label: ing0.serving_label, source: ing0.source,
    pass: ing0.grams === null && Number(ing0.serving_qty) === 1 && ing0.serving_label === '1 each' && ing0.source === 'unc',
  };

  await page.goto(`${appBase}/?tab=nutrition`);
  await waitFor(page, () => document.body.textContent.includes('ZZTEST UNC Burrito'), { timeout: 30000 });

  // Entry rows have no click handler — edit via the row's Options dots menu.
  // GOTCHA: two "Edit" buttons exist; the off-canvas nav drawer's (_editBtn_*,
  // off-screen at negative x) precedes this one in DOM order, so a bare text
  // match clicks nothing. Scope to the entry dropdown's menuitem.
  await page.evaluate(() => document.querySelector('button[aria-label="Options for ZZTEST UNC Burrito"]').click());
  await waitFor(page, () => [...document.querySelectorAll('[role=menuitem][class*="_entryDropdownItem_"]')]
    .some(b => /^edit$/i.test(b.textContent.trim())), { timeout: 10000 });
  await page.evaluate(() => [...document.querySelectorAll('[role=menuitem][class*="_entryDropdownItem_"]')]
    .find(b => /^edit$/i.test(b.textContent.trim())).click());
  await waitFor(page, () => document.body.textContent.includes('Edit Food Entry'), { timeout: 15000 });

  // open the ingredient card -> IngredientSheet
  await page.evaluate(() => {
    const d = [...document.querySelectorAll('[role=dialog]')].find(x => x.innerText.includes('Edit Food Entry'));
    [...d.querySelectorAll('button[class*="_card_"]')].find(b => b.textContent.includes('ZZTEST Smothered')).click();
  });
  await waitFor(page, () => !!document.querySelector('input[aria-label="Ingredient name"]'), { timeout: 15000 });

  // B. serving row shows its label, offers no gram unit, invents no weight
  const before = await sheet();
  result.B_servingRowDisplay = {
    ...before,
    pass: /1 each/.test(before.text) && before.hasUnitSelect === false
       && !/\(\d+\s?g\)/.test(before.text) && before.qty === '1' && before.kcal === '1070',
  };

  // C. quantity 1 -> 2 doubles macros exactly
  await page.evaluate(() => {
    const d = document.querySelector('input[aria-label="Ingredient name"]').closest('[role=dialog]');
    const q = d.querySelector('input[aria-label="Quantity"]');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(q, '2');
    q.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await new Promise(r => setTimeout(r, 900));
  const after = await sheet();
  result.C_doubling = {
    qty: after.qty, kcal: after.kcal, prot: after.prot, carbs: after.carbs, fat: after.fat,
    pass: after.qty === '2' && Number(after.kcal) === 2140 && Number(after.prot) === 102
       && Number(after.carbs) === 172 && Number(after.fat) === 120,
  };

  // D. Done -> Save changes -> persisted with serving basis intact
  await page.evaluate(() => {
    const d = document.querySelector('input[aria-label="Ingredient name"]').closest('[role=dialog]');
    [...d.querySelectorAll('button')].find(b => /^done$/i.test(b.textContent.trim())).click();
  });
  await new Promise(r => setTimeout(r, 700));
  await page.evaluate(() => {
    const d = [...document.querySelectorAll('[role=dialog]')].find(x => x.innerText.includes('Edit Food Entry'));
    [...d.querySelectorAll('button')].find(b => /save changes/i.test(b.textContent.trim())).click();
  });
  await new Promise(r => setTimeout(r, 2500));
  const p0 = (await (await api.get(`nutrition/entries/${entryId}`)).json()).data.ingredients[0];
  result.D_persisted = {
    grams: p0.grams, serving_qty: p0.serving_qty, serving_label: p0.serving_label,
    calories: p0.calories, protein_g: p0.protein_g,
    pass: p0.grams === null && Number(p0.serving_qty) === 2
       && p0.calories === 2140 && p0.protein_g === 102 && p0.serving_label === '1 each',
  };

  result.consoleErrors = errs.slice(0, 5);
  result.OVERALL = ['A_serverRoundTrip', 'B_servingRowDisplay', 'C_doubling', 'D_persisted']
    .every(k => result[k]?.pass) ? 'PASS' : 'FAIL';
  console.log('RESULT', JSON.stringify(result, null, 2));
} catch (e) {
  result.error = String(e);
  result.consoleErrors = errs.slice(0, 5);
  try { result.bodyDump = await page.evaluate(() => document.body.innerText.replace(/\n+/g, ' | ').slice(0, 700)); } catch {}
  console.log('RESULT', JSON.stringify(result, null, 2));
} finally {
  if (entryId) await api.delete(`nutrition/entries/${entryId}`).catch(() => {});
  await teardown({ browser, api });
}
