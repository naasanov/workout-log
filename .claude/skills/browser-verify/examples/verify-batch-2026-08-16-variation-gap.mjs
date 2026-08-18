// Runtime validation for issue #241 (batch 2026-08-16).
// Measures the right-hand button group of a variation row in BOTH layouts,
// with 1 variation (no delete button) and 2 variations (delete button present).
import { launchAuthed, teardown, waitFor } from '../lib/browser.mjs';

const { page, api, appBase, browser } = await launchAuthed();
const result = {};
let sectionId = null;

const errs = [];
page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });

// Runs in the page: measure the LAST variation button group on screen.
const measure = () => {
  const groups = [...document.querySelectorAll('div[class*="rightGroup"]')];
  if (groups.length === 0) return { error: 'no rightGroup found' };
  const g = groups[groups.length - 1];
  const gr = g.getBoundingClientRect();
  const kids = [...g.children].map(el => {
    const r = el.getBoundingClientRect();
    return {
      tag: el.tagName,
      cls: (el.className || '').toString().replace(/_[A-Za-z0-9-]+$/,''),
      w: Math.round(r.width * 100) / 100,
      right: Math.round(r.right * 100) / 100,
    };
  });
  const last = kids[kids.length - 1];
  return {
    groupWidth: Math.round(gr.width * 100) / 100,
    groupRight: Math.round(gr.right * 100) / 100,
    childCount: kids.length,
    children: kids,
    // px of dead space between the last painted child and the group's edge
    trailingGap: last ? Math.round((gr.right - last.right) * 100) / 100 : null,
    hasNoRemoveSpacer: !!g.querySelector('[class*="noRemove"]'),
    deleteButtons: g.querySelectorAll('button[class*="delete"]').length,
  };
};

try {
  const s = await api.post('sections', { data: { label: 'ZZTEST Section' } });
  sectionId = (await s.json()).data.sectionId;
  await api.patch(`sections/${sectionId}`, { data: { is_open: true } });
  const m = await api.post(`movements/${sectionId}`, { data: { label: 'ZZTEST Movement' } });
  const movementId = (await m.json()).data.movementId;
  result.fixture = { sectionId, movementId };

  const load = async (w, h) => {
    await page.setViewportSize({ width: w, height: h });
    await page.goto(appBase);
    await waitFor(page, () => document.body.innerText.includes('ZZTEST Movement'), { timeout: 25000 });
    await waitFor(page, () => document.querySelectorAll('div[class*="rightGroup"]').length > 0);
    await new Promise(r => setTimeout(r, 400));
  };

  // ---- ONE variation (movement creation auto-inserts exactly one) ----------
  await load(1280, 900);
  result.desktop_1var = await page.evaluate(measure);
  await load(390, 844);
  result.mobile_1var = await page.evaluate(measure);

  // ---- TWO variations: delete button must come back ------------------------
  await api.post(`variations/${movementId}`, { data: { label: 'ZZTEST Var 2', weight: 100, reps: 5 } });
  await load(1280, 900);
  result.desktop_2var = await page.evaluate(measure);
  await load(390, 844);
  result.mobile_2var = await page.evaluate(measure);

  result.consoleErrors = errs;
  console.log('RESULT', JSON.stringify(result, null, 2));
} catch (e) {
  console.log('FAILED', e.message);
  console.log('PARTIAL', JSON.stringify(result, null, 2));
  process.exitCode = 1;
} finally {
  if (sectionId) await api.delete(`sections/${sectionId}`).catch(() => {});
  await teardown({ browser, api });
}
