// Runtime check for the 2026-08-30 issue batch:
//   #297 reconnect button in the nutrition chat sheet header
//   #296 feedback modal attachment picker (client-side downscale + thumbnail)
//   #295 What's New changelog button + modal, signed in
import { launchAuthed, teardown, waitFor } from '../lib/browser.mjs';

const apiBase = 'http://localhost:5055/api/';
const appBase = 'http://localhost:5056';

const { page, api, browser } = await launchAuthed({ apiBase, appBase });
const result = {};
const consoleErrors = [];
page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', e => consoleErrors.push('pageerror: ' + e.message));

try {
  // ---------------------------------------------------------------- #295
  await page.goto(appBase + '/?tab=nutrition');
  await waitFor(page, () => !!document.querySelector('button[aria-label="What\'s new"]'));
  await page.locator('button[aria-label="What\'s new"]').click();
  await waitFor(page, () => [...document.querySelectorAll('h2')].some(h => /What.s New/.test(h.textContent)));
  result.changelog = await page.evaluate(() => {
    const h = [...document.querySelectorAll('h2')].find(x => /What.s New/.test(x.textContent));
    const modal = h.closest('[role=dialog]');
    return {
      opens: !!modal,
      entryCount: modal.querySelectorAll('h3').length,
      newestDate: modal.querySelector('h3')?.previousElementSibling?.textContent ?? null,
      feedbackBtnStillPresent: !!document.querySelector('button[aria-label="Send feedback"]'),
    };
  });
  await page.keyboard.press('Escape');
  await waitFor(page, () => ![...document.querySelectorAll('h2')].some(h => /What.s New/.test(h.textContent)));

  // ---------------------------------------------------------------- #296
  await page.locator('button[aria-label="Send feedback"]').click();
  await waitFor(page, () => !!document.querySelector('input[type=file]'));
  // 1x1 red PNG
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  await page.setInputFiles('input[type=file]', { name: 'shot.png', mimeType: 'image/png', buffer: png });
  await waitFor(page, () => document.querySelectorAll('img[src^="blob:"], img[src^="data:"]').length > 0, { timeout: 10000 });
  result.attachments = await page.evaluate(() => {
    const input = document.querySelector('input[type=file]');
    const modal = input.closest('[role=dialog]');
    const thumbs = modal.querySelectorAll('img');
    return {
      pickerPresent: true,
      acceptsMultiple: input.multiple,
      accept: input.accept,
      thumbnailCount: thumbs.length,
      removeBtn: !!modal.querySelector('button[aria-label*="Remove"]'),
      sendEnabled: !modal.querySelector('button[type=submit]')?.disabled,
    };
  });
  await page.keyboard.press('Escape');

  // ---------------------------------------------------------------- #297
  await waitFor(page, () => !!document.querySelector('[aria-label="Expand AI chat"], [aria-label="Collapse AI chat"]'));
  // The drag handle is a role=button div wired to pointer events + Enter/Space.
  // It has no onClick, so a synthetic .click() is a no-op; use the keyboard path.
  await page.locator('[aria-label="Expand AI chat"]').focus();
  await page.keyboard.press('Enter');
  await waitFor(page, () => !!document.querySelector('button[aria-label="Reconnect"]'), { timeout: 15000 });
  const before = await page.evaluate(() => {
    const b = document.querySelector('button[aria-label="Reconnect"]');
    const r = b.getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2), disabled: b.disabled, title: b.title };
  });
  // Real hit-test click at the button's center, not el.click(), so an element
  // covering it would fail here the way it would for a user.
  await page.mouse.click(before.x, before.y);
  const after = await page.evaluate(() => {
    const b = document.querySelector('button[aria-label="Reconnect"]');
    return { stillPresent: !!b, chatStillMounted: !!document.querySelector('textarea[placeholder*="Describe what you ate"]') };
  });
  result.reconnect = { ...before, tapTargetOk: before.w >= 36 && before.h >= 36, afterClick: after };

  result.consoleErrors = consoleErrors;
  console.log('RESULT ' + JSON.stringify(result, null, 2));
} catch (err) {
  console.log('FAILED ' + err.message);
  console.log('partial ' + JSON.stringify(result, null, 2));
  console.log('consoleErrors ' + JSON.stringify(consoleErrors, null, 2));
} finally {
  await teardown({ browser, api });
}
