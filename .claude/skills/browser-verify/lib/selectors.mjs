// Named, checked selectors for the DOM elements this skill's scripts target
// most often. Every string here was grepped against the live client source
// (not copied from SKILL.md prose) as of the date in the function/selector's
// comment — when the client changes a label, id, or class prefix, fix the
// selector here and rerun examples/smoke-selectors.mjs, rather than leaving
// stale prose somewhere else.
//
// Plain CSS selector strings are usable directly with Playwright locators or
// inside page.evaluate. A few elements need usage rules beyond "find it" (a
// specific click method, a wait after clicking); those are exported as small
// helpers instead of comments so the rule can't be skipped by accident.

// ---- AI chat (client/src/features/agent/AgentChat.tsx) --------------------

// srLabel defaults to 'AI chat' and the FAB's aria-label template appends
// ' chat', so the rendered label is "Open AI chat chat", not "Open <Tab> AI
// chat" as you'd guess from the visible tab title.
export const chatFab = 'button[aria-label="Open AI chat chat"]';
export const chatComposer = 'textarea[aria-label="Chat message"]';
export const chatSend = 'button[aria-label="Send"]';
export const chatStop = 'button[aria-label="Stop generation"]';
export const chatNewConversation = 'button[aria-label="Start a new chat"]';
export const chatReconnect = 'button[aria-label="Reconnect"]';
export const chatCollapseHeaderBtn = 'button[aria-label="Collapse"]';
export const agentInstructionsGear = 'button[aria-label="Agent instructions"]';
export const agentInstructionsTextarea = '#agent-instructions-textarea';

// The drag handle has no onClick — it's a role=button div wired only to
// pointer events (the drag gesture) plus an Enter/Space onKeyDown. A
// synthetic or Playwright .click() is a silent no-op; focus it and press
// Enter instead. This one selector covers both states (its label flips).
export const chatSheetHandle = '[aria-label="Expand AI chat"], [aria-label="Collapse AI chat"]';

/**
 * Opens the chat FAB the way a real tap does: a hit-tested mouse click at
 * its center (el.click() leaves the sheet collapsed — see SKILL.md), then
 * waits out the height animation. Throws if the FAB isn't there to click.
 */
export async function openChat(page) {
  await page.waitForSelector(chatFab, { timeout: 20000 });
  const box = await page.locator(chatFab).boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(1500);
}

/**
 * Expands an already-open (peek-height) chat sheet via the drag handle's
 * keyboard path, since neither a synthetic nor real click fires its no-op
 * onClick. Use after openChat() when you need the expanded header controls.
 */
export async function expandChatSheet(page) {
  await page.locator('[aria-label="Expand AI chat"]').focus();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
}

export async function openAgentInstructions(page) {
  await page.click(agentInstructionsGear);
  await page.waitForSelector(agentInstructionsTextarea, { timeout: 10000 });
}

// ---- Feedback (client/src/components/Header.jsx, .../FeedbackModal.tsx) ---

export const feedbackButton = 'button[aria-label="Send feedback"]';
export const feedbackCategory = '#fb-category';
export const feedbackTool = '#fb-tool';
export const feedbackMessage = '#fb-message';
export const feedbackErrorMsg = '[class*="errorMsg"]';

// A bare `button[type=submit]` / `button:has-text("Cancel")` can resolve to
// a different form's button first; always scope through the feedback form.
export const feedbackSubmit = 'form:has(#fb-message) button[type=submit]';
export const feedbackCancel = 'form:has(#fb-message) button:has-text("Cancel")';

export async function openFeedback(page) {
  await page.waitForSelector(feedbackButton, { timeout: 20000 });
  await page.click(feedbackButton);
  await page.waitForSelector(feedbackMessage, { timeout: 10000 });
}

// ---- Nutrition (client/src/features/nutrition/NutritionTracker.tsx, -------
//                 .../IngredientSheet.tsx) -----------------------------------

// `input[type="date"]` matches at least twice (the Body Weight tab renders
// one too, earlier in DOM order), so scope via the uniquely-labelled
// "Previous day" button that sits beside the nutrition one.
export function nutritionDateInput(page) {
  return page.locator('button[aria-label="Previous day"]').locator('xpath=..').locator('input[type="date"]');
}

export const entryRow = '[class*="entryRow"]'; // role="button"; Enter/Space work too

/**
 * The IngredientSheet is a Radix Dialog portaled to the body, and
 * `div[class*="_sheet_"]` / `[role=dialog]` both match more than one element
 * on the nutrition tab (the chat's own sheet, the off-canvas nav drawer).
 * Anchor off content that's unique to this sheet instead.
 */
export function ingredientSheetDialog(page) {
  return page.locator('input[aria-label="Ingredient name"]').locator('xpath=ancestor::*[@role="dialog"]');
}

// Reads "Done", not "Add", once "Add ingredient" reuses the editor's
// existing empty row (the default new-entry state) rather than inserting one.
export const ingredientSheetDone = 'button[class*="doneBtn"]';

// Dropdown options in the ingredient search list fire on pointerdown, not
// click (IngredientSheet.tsx) — a plain Playwright/DOM .click() does nothing.
// Dispatch a real pointerdown, or use page.mouse down/up at the option's box.

// ---- Workouts (client/src/components/variation/{Thin,Wide}Variation.jsx) --

// There is no per-variation row wrapper: name cell, weight, reps, and
// buttons are flat siblings from the same .map(), so scope by DOM order
// (the Nth name cell corresponds to the Nth button of each kind) rather
// than .closest().
export const variationNameCell = 'div[class*="_nameCell_"]';
export const variationGraphBtn = 'button[class*="graphBtn"]'; // no aria-label; class-only
