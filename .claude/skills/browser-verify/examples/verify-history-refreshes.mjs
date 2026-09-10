// Verifies the chat history tab updates without a reload when a new chat is
// started from the chat sheet. Restores the dev user's original active
// conversation and deletes the one it created.
//
// Run: node .claude/skills/browser-verify/examples/verify-history-refreshes.mjs

import { launchAuthed, teardown, waitFor } from '../lib/browser.mjs';

const { page, api, appBase, browser } = await launchAuthed();
let originalActiveId;
let createdId;

try {
  originalActiveId = (await (await api.get('chat/active')).json()).data.conversation.id;

  await page.goto(`${appBase}/?tab=chat-history`, { waitUntil: 'networkidle' });
  await waitFor(page, () => document.querySelectorAll('li[class*="_row_"]').length > 0, { timeout: 15000 });
  const rowsBefore = await page.locator('li[class*="_row_"]').count();

  await page.locator('button[class*="floatingChatBtn"]').click();
  await page.locator('button[aria-label="Start a new chat"]').click();
  await page.waitForTimeout(500);
  createdId = (await (await api.get('chat/active')).json()).data.conversation.id;
  if (createdId === originalActiveId) throw new Error('FAIL: new chat did not create a conversation');
  await page.locator('button[aria-label="Collapse"]').click();

  const start = Date.now();
  let rowsAfter = rowsBefore;
  let activeText = '';
  while (Date.now() - start < 5000) {
    rowsAfter = await page.locator('li[class*="_row_"]').count();
    activeText = await page.locator('li[class*="_rowActive_"]').first().textContent();
    if (rowsAfter === rowsBefore + 1 && activeText.includes('No messages yet')) break;
    await page.waitForTimeout(250);
  }

  if (rowsAfter !== rowsBefore + 1) throw new Error(`FAIL: history shows ${rowsAfter} rows, expected ${rowsBefore + 1} without reload`);
  if (!activeText.includes('No messages yet')) throw new Error(`FAIL: active row is still the old chat: "${activeText}"`);
  console.log(`PASS: history went from ${rowsBefore} to ${rowsAfter} rows with the new chat active, no reload`);
} finally {
  if (createdId && createdId !== originalActiveId) await api.delete(`chat/conversations/${createdId}`);
  if (originalActiveId) await api.post(`chat/conversations/${originalActiveId}/continue`);
  await teardown({ browser, api });
}
