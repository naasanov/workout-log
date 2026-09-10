// Verifies the client half of batched agent proposals end to end:
//   1. A 3-item batch (section.create -> movement.create -> variation.create
//      with replace_placeholder) renders as ONE card with ONE Confirm.
//   2. Confirming it creates all three records with correct parent links,
//      and the exercise ends up with EXACTLY ONE variation -- the whole
//      point of the placeholder-replace rule (movement.create auto-inserts
//      a placeholder; replace_placeholder patches it instead of adding a
//      second row).
//   3. The new section/exercise/variation appear on the Workouts tab behind
//      the chat sheet with NO page reload -- proving the React Query
//      invalidation wired up in mutationExecutor.ts actually refreshes the
//      page, which is the bug this batch of work fixes.
//   4. The resolution posted back to the server carries kind:"batch" and a
//      result array of {ref, id} parallel to the mutations, which is what
//      lets the agent act on what it just created next turn.
//
// Seeds a chat_messages row directly (see SKILL.md's "Chat-message parts
// render tool cards straight from the DB" note) with a propose_mutation
// tool part whose output is a batch payload -- no live model turn needed.
// Starts a brand-new conversation (archives, doesn't destroy, the dev
// user's current one) so the seeded message is the only content on the
// page, same pattern as verify-mutation-card-no-ids.mjs.
//
// Run: node .claude/skills/browser-verify/examples/verify-batch-mutation-card.mjs

import { execSync } from 'node:child_process';
import { launchAuthed, teardown, waitFor } from '../lib/browser.mjs';

const sql = q => execSync(
  `docker exec agent-chat-global-db-1 mysql -udev -pdev workout_log -N -B -e ${JSON.stringify(q)}`,
  { encoding: 'utf8' },
).trim();

const SECTION_LABEL = 'ZZTEST Push Day';
const MOVEMENT_LABEL = 'ZZTEST Bench Press';
const VARIATION_LABEL = 'ZZTEST Barbell';

const BATCH_PAYLOAD = {
  mutations: [
    { type: 'section.create', label: SECTION_LABEL, ref: 'sec1' },
    { type: 'movement.create', section_id: 'ref:sec1', section_name: SECTION_LABEL, label: MOVEMENT_LABEL, ref: 'ex1' },
    {
      type: 'variation.create',
      movement_id: 'ref:ex1',
      exercise_name: MOVEMENT_LABEL,
      label: VARIATION_LABEL,
      weight: 135,
      reps: 5,
      replace_placeholder: true,
    },
  ],
};

const TOOL_CALL_ID = 'call_zztest_batch_1';

const { page, api, appBase, browser } = await launchAuthed();
let newConversationId;
let originalActiveId;
let sectionId;

try {
  const activeRes = await api.get('chat/active');
  if (!activeRes.ok()) throw new Error(`GET /chat/active failed: ${activeRes.status()}`);
  originalActiveId = (await activeRes.json()).data.conversation.id;

  const newConvRes = await api.post('chat/conversations');
  if (!newConvRes.ok()) throw new Error(`POST /chat/conversations failed: ${newConvRes.status()}`);
  newConversationId = (await newConvRes.json()).data.conversation.id;

  const uuidHex = sql(`SELECT HEX(user_uuid) FROM users WHERE email='dev@dev.com';`);
  if (!uuidHex) throw new Error('dev user not found');

  // Safety net against a leftover row from a previously killed run (cascades
  // through movements/variations the same way the real teardown below does).
  sql(`DELETE FROM sections WHERE label='${SECTION_LABEL}' AND user_uuid=UNHEX('${uuidHex}');`);

  const parts = [
    {
      type: 'tool-propose_mutation',
      toolCallId: TOOL_CALL_ID,
      state: 'output-available',
      input: BATCH_PAYLOAD,
      output: BATCH_PAYLOAD,
    },
  ];
  sql(
    `INSERT INTO chat_messages (user_uuid, conversation_id, message_id, role, parts) ` +
    `VALUES (UNHEX('${uuidHex}'), ${newConversationId}, 'zztest-batch-msg-1', 'assistant', ` +
    `${JSON.stringify(JSON.stringify(parts))});`,
  );

  // Captured independently of the DB round trip below: this repo's running
  // API server (dist/index.js) was built at 15:52, before the commit that
  // added proposal_resolutions.result and its route handling (37f549e,
  // 18:57) -- a pre-existing environment gap, not something this change
  // introduces. Reading the actual outgoing request body proves the CLIENT
  // sends the right payload regardless of whether this particular dev
  // server binary was rebuilt to persist it.
  let resolutionsPostBody = null;
  page.on('request', (req) => {
    if (req.url().includes('/resolutions') && req.method() === 'POST') {
      resolutionsPostBody = req.postData();
    }
  });

  // Explicit ?tab=workouts (query param, not a route -- SKILL.md) so the
  // Workouts panel is the one actually visible on screen, not just present
  // in the DOM with display:none behind whatever tab the dev account
  // defaults to.
  await page.goto(`${appBase}/?tab=workouts`);
  // First load against a cold vite dev server compiles SCSS on demand.
  await waitFor(page, () => !!document.querySelector('[aria-label="Expand AI chat"]'), { timeout: 20000 });

  // The sheet's drag handle has no onClick (SKILL.md) -- it's a role=button
  // div wired only to pointer events plus an Enter/Space onKeyDown, and it's
  // the only way to open the sheet since the sheet itself is
  // height:0/overflow:hidden while collapsed (the FAB sits outside it but
  // its own open logic also lives in a pointerup handler). Focus + Enter is
  // the proven-reliable path here rather than a synthetic click.
  await page.locator('[aria-label="Expand AI chat"]').focus();
  await page.keyboard.press('Enter');
  await waitFor(page, () => {
    const sheet = document.querySelector('[role="dialog"][aria-label$="chat"]');
    return !!sheet && sheet.getBoundingClientRect().height > 100;
  }, { timeout: 10000 });

  // ---- Step 1: batch renders as ONE card with ONE Confirm ----
  await waitFor(page, () => [...document.querySelectorAll('button')].some(b => b.textContent === 'Confirm'), { timeout: 15000 });

  const before = await page.evaluate(() => {
    const confirmBtns = [...document.querySelectorAll('button')].filter(b => b.textContent === 'Confirm');
    const denyBtns = [...document.querySelectorAll('button')].filter(b => b.textContent === 'Deny');
    // Card = Deny button's grandparent (see MutationProposalCard.tsx's .actions > button structure).
    const cards = denyBtns.map(b => b.parentElement.parentElement);
    const batchCard = cards.find(c => c.textContent.includes('Apply 3 changes'));
    return {
      confirmBtnCount: confirmBtns.length,
      denyBtnCount: denyBtns.length,
      batchCardFound: !!batchCard,
      batchCardText: batchCard ? batchCard.textContent : null,
    };
  });

  console.log('Before confirm:', JSON.stringify(before, null, 2));

  if (before.confirmBtnCount !== 1) throw new Error(`FAIL: expected exactly 1 Confirm button, found ${before.confirmBtnCount}`);
  if (before.denyBtnCount !== 1) throw new Error(`FAIL: expected exactly 1 Deny button, found ${before.denyBtnCount}`);
  if (!before.batchCardFound) throw new Error('FAIL: no card found with title "Apply 3 changes"');

  const cardText = before.batchCardText;
  if (!cardText.includes(`section:${SECTION_LABEL}label:${MOVEMENT_LABEL}`)) {
    throw new Error(`FAIL: expected exercise rows "section: ${SECTION_LABEL}", "label: ${MOVEMENT_LABEL}" — got: ${cardText}`);
  }
  if (!cardText.includes(`exercise:${MOVEMENT_LABEL}label:${VARIATION_LABEL}`)) {
    throw new Error(`FAIL: expected variation rows "exercise: ${MOVEMENT_LABEL}", "label: ${VARIATION_LABEL}" — got: ${cardText}`);
  }
  if (!cardText.includes(SECTION_LABEL)) throw new Error(`FAIL: section label not shown — ${cardText}`);
  if (/ref:/i.test(cardText)) throw new Error(`FAIL: a raw "ref:" pointer leaked into the card text — ${cardText}`);
  if (/\bref\b/i.test(cardText)) throw new Error(`FAIL: the internal "ref" field leaked into the card text — ${cardText}`);

  console.log('PASS: batch renders as one card with one Confirm/Deny, no ref pointers or bare ids shown');

  // ---- Step 2 + 3: confirm, then check DB state and live UI update ----
  await page.evaluate(() => {
    const denyBtns = [...document.querySelectorAll('button')].filter(b => b.textContent === 'Deny');
    const card = denyBtns.map(b => b.parentElement.parentElement).find(c => c.textContent.includes('Apply 3 changes'));
    const confirmBtn = [...card.querySelectorAll('button')].find(b => b.textContent === 'Confirm');
    confirmBtn.click();
  });

  // Card resolves into the generic confirmed-summary line once applied.
  await waitFor(page, () => document.body.textContent.includes('Applied 3 changes'), { timeout: 15000 });
  console.log('PASS: card resolved with "Applied 3 changes"');

  // DB state: exactly the records the batch describes, correctly linked,
  // and exactly ONE variation on the exercise (placeholder replaced, not
  // duplicated).
  sectionId = sql(`SELECT section_id FROM sections WHERE label='${SECTION_LABEL}' AND user_uuid=UNHEX('${uuidHex}');`);
  if (!sectionId) throw new Error('FAIL: section was not created');

  const movementId = sql(`SELECT movement_id FROM movements WHERE section_id=${sectionId} AND label='${MOVEMENT_LABEL}';`);
  if (!movementId) throw new Error('FAIL: movement was not created under the new section');

  const variationCount = sql(`SELECT COUNT(*) FROM variations WHERE movement_id=${movementId};`);
  if (variationCount !== '1') {
    throw new Error(`FAIL: expected exactly 1 variation on the new exercise, found ${variationCount} (placeholder rule broken)`);
  }

  const variationRow = sql(`SELECT label, weight, reps FROM variations WHERE movement_id=${movementId};`);
  const [vLabel, vWeight, vReps] = variationRow.split('\t');
  if (vLabel !== VARIATION_LABEL) throw new Error(`FAIL: variation label is "${vLabel}", expected "${VARIATION_LABEL}" (placeholder not replaced, or wrong row)`);
  if (Number(vWeight) !== 135) throw new Error(`FAIL: variation weight is ${vWeight}, expected 135`);
  if (Number(vReps) !== 5) throw new Error(`FAIL: variation reps is ${vReps}, expected 5`);

  console.log(`PASS: DB has section ${sectionId} -> movement ${movementId} -> exactly 1 variation "${vLabel}" (${vWeight}x${vReps})`);

  // ---- The client's outgoing POST /resolutions body: kind "batch", a
  // result array of {ref,id} parallel to the mutations, with the real ids
  // this run's confirm actually produced. ----
  if (!resolutionsPostBody) throw new Error('FAIL: no POST to /resolutions was observed at all');
  const sentBody = JSON.parse(resolutionsPostBody);
  if (sentBody.kind !== 'batch') throw new Error(`FAIL: sent kind is "${sentBody.kind}", expected "batch"`);
  if (sentBody.status !== 'confirmed') throw new Error(`FAIL: sent status is "${sentBody.status}", expected "confirmed"`);
  const result = sentBody.result;
  if (!Array.isArray(result) || result.length !== 3) throw new Error(`FAIL: expected a 3-entry result array, got ${JSON.stringify(result)}`);
  if (result[0].ref !== 'sec1' || String(result[0].id) !== sectionId) throw new Error(`FAIL: result[0] mismatch — ${JSON.stringify(result)}`);
  if (result[1].ref !== 'ex1' || String(result[1].id) !== movementId) throw new Error(`FAIL: result[1] mismatch — ${JSON.stringify(result)}`);
  if (result[2].ref !== undefined) throw new Error(`FAIL: result[2] should have no ref (variation.create declared none) — ${JSON.stringify(result)}`);
  if (result[2].id === undefined) throw new Error(`FAIL: result[2] has no id — ${JSON.stringify(result)}`);

  console.log('PASS: client POSTs kind="batch", status="confirmed", result=', JSON.stringify(result));

  // Cross-check against the DB row this dev server's (possibly stale, see
  // the comment above) build actually persisted -- informational only, not
  // a pass/fail gate, since it depends on that server binary being current.
  const resolutionRow = sql(
    `SELECT kind, status, result FROM proposal_resolutions WHERE conversation_id=${newConversationId} AND tool_call_id='${TOOL_CALL_ID}';`,
  );
  console.log('INFO: DB-persisted resolution row (kind, status, result):', JSON.stringify(resolutionRow));
  if (resolutionRow.endsWith('NULL')) {
    console.log('INFO: result column is NULL server-side -- expected here, since this dev server predates the commit that stores it (see comment above); the client-side contract is already proven by the captured request body.');
  }

  // Live UI update behind the sheet, with NO page.reload() anywhere in this
  // script -- collapse the sheet and read the Workouts tab's DOM directly.
  await page.evaluate(() => {
    const collapseBtn = [...document.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === 'Collapse');
    collapseBtn?.click();
  });
  await waitFor(page, () => {
    const sheet = document.querySelector('[role="dialog"][aria-label$="chat"]');
    return !!sheet && sheet.getBoundingClientRect().height < 50;
  }, { timeout: 10000 });

  // Real on-screen visibility, not just DOM presence: the new section's own
  // header (not nested inside any collapsed accordion) must have a non-zero
  // rendered size on the Workouts panel that's actually the active tab
  // (?tab=workouts, set above).
  const sectionVisible = await page.evaluate((label) => {
    const el = [...document.querySelectorAll('span,div')].find(e => e.children.length === 0 && e.textContent === label);
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }, SECTION_LABEL);
  if (!sectionVisible) throw new Error(`FAIL: new section "${SECTION_LABEL}" is not actually visible on screen on the Workouts tab`);
  console.log('PASS: new section is visibly rendered on the Workouts tab (not just present in a hidden DOM node)');

  const liveText = await page.evaluate(() => document.body.textContent);
  if (!liveText.includes(SECTION_LABEL)) throw new Error(`FAIL: new section "${SECTION_LABEL}" not visible on the Workouts tab without reload`);
  if (!liveText.includes(MOVEMENT_LABEL)) throw new Error(`FAIL: new exercise "${MOVEMENT_LABEL}" not visible on the Workouts tab without reload`);

  // The exercise's variation row isn't fetched until its section is
  // expanded (Section.jsx starts collapsed for a freshly created section
  // unless it auto-opens) -- expand it if needed, then confirm the
  // variation label is visible without ever reloading the page.
  if (!liveText.includes(VARIATION_LABEL)) {
    await page.evaluate((label) => {
      const header = [...document.querySelectorAll('*')].find(el => el.children.length === 0 && el.textContent === label);
      const section = header?.closest('section');
      const collapseBtn = section?.querySelector('button[aria-label*="ollapse"], button[aria-label*="xpand"]');
      collapseBtn?.click();
    }, MOVEMENT_LABEL);
    // waitFor's predicate can't take args passed from Node (it's serialized
    // and run with none) — poll with page.evaluate(fn, arg) directly instead.
    const start = Date.now();
    while (Date.now() - start < 5000) {
      if (await page.evaluate((label) => document.body.textContent.includes(label), VARIATION_LABEL)) break;
      await new Promise(r => setTimeout(r, 300));
    }
  }
  const finalText = await page.evaluate(() => document.body.textContent);
  if (!finalText.includes(VARIATION_LABEL)) throw new Error(`FAIL: new variation "${VARIATION_LABEL}" not visible on the Workouts tab without reload`);

  console.log('PASS: section, exercise, and variation all visible on the Workouts tab with zero page reloads');
  console.log('ALL PASS');
} finally {
  if (sectionId) await api.delete(`sections/${sectionId}`); // cascades: movements, variations, variation_history
  if (newConversationId) await api.delete(`chat/conversations/${newConversationId}`);
  if (originalActiveId) await api.post(`chat/conversations/${originalActiveId}/continue`);
  await teardown({ browser, api });
}
