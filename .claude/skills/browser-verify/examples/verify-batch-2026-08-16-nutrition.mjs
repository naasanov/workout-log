// Runtime validation for issues #245, #246, #247 (batch 2026-08-16).
import { launchAuthed, teardown, waitFor } from '../lib/browser.mjs';

const { page, api, appBase, browser } = await launchAuthed();
const result = {};
let mealId = null;

const errs = [];
page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });

try {
  // ---- fixture: a SAVED custom meal with one defined serving --------------
  const create = await api.post('nutrition/custom-foods', {
    data: {
      kind: 'meal',
      name: 'ZZTEST Chicken Bowl',
      status: 'saved',
      ingredients: [
        { name: 'ZZTEST Chicken', grams: 300, source: 'manual', source_ref: null,
          calories: 495, protein_g: 93, carbs_g: 0, fat_g: 11, fiber_g: null, sugar_g: null, sodium_mg: null },
        { name: 'ZZTEST Rice', grams: 200, source: 'manual', source_ref: null,
          calories: 260, protein_g: 5, carbs_g: 56, fat_g: 1, fiber_g: null, sugar_g: null, sodium_mg: null },
      ],
      servings: [{ label: 'bowl', def_type: 'grams', def_value: 250, grams: 250 }],
    },
  });
  if (!create.ok()) throw new Error(`create failed ${create.status()} ${await create.text()}`);
  mealId = (await create.json()).data.id;
  result.fixture = { mealId, total_grams: 500 };

  const statusOf = async () => {
    const r = await api.get(`nutrition/custom-foods/${mealId}`);
    const j = await r.json();
    return { status: j.data.status, name: j.data.name };
  };
  result.statusAfterCreate = await statusOf();

  // =======================================================================
  // #245 — opening a saved meal in the builder must NOT flip it to draft
  // =======================================================================
  await page.goto(`${appBase}/?tab=nutrition`);
  await waitFor(page, () => !!document.querySelector('button[aria-label="More options"]'), { timeout: 25000 });
  await page.click('button[aria-label="More options"]');
  await waitFor(page, () => [...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'My Foods'));
  await page.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'My Foods').click());
  await waitFor(page, () => !!document.querySelector('[aria-label="My Foods"]'));
  await waitFor(page, () => !!([...document.querySelectorAll('[role=button]')].find(el => el.textContent.includes('ZZTEST Chicken Bowl'))));

  // tap the meal row -> opens MealBuilder
  await page.evaluate(() => [...document.querySelectorAll('[role=button]')]
    .find(el => el.textContent.includes('ZZTEST Chicken Bowl')).click());
  // builder open?
  await waitFor(page, () => !!([...document.querySelectorAll('input')].find(i => i.value === 'ZZTEST Chicken Bowl')));
  result.builderOpened = true;

  // sit well past the 600ms debounce; the old bug PATCHed at ~600ms
  await new Promise(r => setTimeout(r, 3000));
  result.statusAfterJustLooking = await statusOf();

  // close the builder without editing
  await page.evaluate(() => {
    const btns = [...document.querySelectorAll('button')];
    const b = btns.find(x => /^(Cancel|Close)$/i.test(x.textContent.trim()))
           || btns.find(x => /close/i.test(x.getAttribute('aria-label') || ''));
    b && b.click();
  });
  await new Promise(r => setTimeout(r, 1500));
  result.statusAfterClose = await statusOf();

  // ---- now actually EDIT it: must flip to draft ---------------------------
  await waitFor(page, () => !!([...document.querySelectorAll('[role=button]')].find(el => el.textContent.includes('ZZTEST Chicken Bowl'))), { timeout: 25000 });
  await page.evaluate(() => [...document.querySelectorAll('[role=button]')]
    .find(el => el.textContent.includes('ZZTEST Chicken Bowl')).click());
  await waitFor(page, () => !!([...document.querySelectorAll('input')].find(i => i.value === 'ZZTEST Chicken Bowl')));
  const nameSel = 'input';
  await page.evaluate(() => {
    const i = [...document.querySelectorAll('input')].find(x => x.value === 'ZZTEST Chicken Bowl');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(i, 'ZZTEST Chicken Bowl EDITED');
    i.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await new Promise(r => setTimeout(r, 3000));
  result.statusAfterEdit = await statusOf();

  // close builder again
  await page.evaluate(() => {
    const btns = [...document.querySelectorAll('button')];
    const b = btns.find(x => /^(Cancel|Close)$/i.test(x.textContent.trim()))
           || btns.find(x => /close/i.test(x.getAttribute('aria-label') || ''));
    b && b.click();
  });
  await new Promise(r => setTimeout(r, 800));

  // restore to saved + original name so the #246/#247 checks can find it in search
  await api.patch(`nutrition/custom-foods/${mealId}`, {
    data: {
      kind: 'meal', name: 'ZZTEST Chicken Bowl', status: 'saved',
      ingredients: [
        { name: 'ZZTEST Chicken', grams: 300, source: 'manual', source_ref: null,
          calories: 495, protein_g: 93, carbs_g: 0, fat_g: 11, fiber_g: null, sugar_g: null, sodium_mg: null },
        { name: 'ZZTEST Rice', grams: 200, source: 'manual', source_ref: null,
          calories: 260, protein_g: 5, carbs_g: 56, fat_g: 1, fiber_g: null, sugar_g: null, sodium_mg: null },
      ],
      servings: [{ label: 'bowl', def_type: 'grams', def_value: 250, grams: 250 }],
    },
  });

  // =======================================================================
  // #246 / #247 — custom meal in an entry = ONE row + portion dropdown
  // =======================================================================
  await page.goto(`${appBase}/?tab=nutrition`);
  await waitFor(page, () => [...document.querySelectorAll('button')].some(b => b.textContent.includes('Add food')), { timeout: 25000 });
  await page.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent.includes('Add food')).click());
  await waitFor(page, () => !!document.querySelector('button[aria-label="Add ingredient"]'));
  await page.evaluate(() => document.querySelector('button[aria-label="Add ingredient"]').click());
  await waitFor(page, () => !!document.querySelector('input[aria-label="Ingredient name"]'));

  await page.evaluate(() => {
    const i = document.querySelector('input[aria-label="Ingredient name"]');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(i, 'ZZTEST Chicken Bowl');
    i.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await waitFor(page, () => {
    const opts = [...document.querySelectorAll('[role=option]')];
    return opts.some(o => o.textContent.includes('ZZTEST Chicken Bowl'));
  }, { timeout: 20000 });

  result.searchResultText = await page.evaluate(() =>
    [...document.querySelectorAll('[role=option]')].find(o => o.textContent.includes('ZZTEST Chicken Bowl')).textContent);

  // NOTE: dropdown options fire on onPointerDown (IngredientSheet.tsx:88), not
  // onClick — a plain .click() silently does nothing here.
  await page.evaluate(() => [...document.querySelectorAll('[role=option]')]
    .find(o => o.textContent.includes('ZZTEST Chicken Bowl'))
    .dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true })));

  // The sheet should stay open on the single row (NOT close+expand into N rows)
  await new Promise(r => setTimeout(r, 1200));
  result.afterSelect = await page.evaluate(() => {
    const nameInput = document.querySelector('input[aria-label="Ingredient name"]');
    const unit = document.querySelector('select[aria-label="Unit"]');
    const qty = document.querySelector('input[aria-label="Quantity"]');
    return {
      sheetStillOpen: !!nameInput,
      rowName: nameInput ? nameInput.value : null,
      quantity: qty ? qty.value : null,
      unitSelected: unit ? unit.value : null,
      unitOptions: unit ? [...unit.options].map(o => o.textContent) : null,
      calories: (document.querySelector('input[aria-label="Calories"]') || {}).value ?? null,
    };
  });

  // commit the row (Done) and inspect the entry editor
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(x => /^done$/i.test(x.textContent.trim()));
    b && b.click();
  });
  await new Promise(r => setTimeout(r, 1200));

  result.entryEditor = await page.evaluate(() => {
    const nameField = document.querySelector('input[id^="entry-name-"]');
    const rowBtns = [...document.querySelectorAll('button[aria-label^="Edit "]')]
      .map(b => b.getAttribute('aria-label'));
    return { entryName: nameField ? nameField.value : null, ingredientRows: rowBtns };
  });

  result.consoleErrors = errs;
  console.log('RESULT', JSON.stringify(result, null, 2));
} catch (e) {
  console.log('FAILED', e.message);
  console.log('PARTIAL', JSON.stringify(result, null, 2));
  process.exitCode = 1;
} finally {
  if (mealId) await api.delete(`nutrition/custom-foods/${mealId}`).catch(() => {});
  await teardown({ browser, api });
}
