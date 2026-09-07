// Verifies that propose_mutation confirm cards never surface a raw database
// id, and that a create-with-parent proposal (movement.create) instead
// renders the parent's display name legibly ("<exercise> in <section>").
//
// Rather than injecting into the dev user's real (long-running) active
// conversation, this starts a brand-new one via POST /api/chat/conversations
// (archives the current one — recoverable, not destroyed) so the seeded
// message is the only content on the page and DOM assertions aren't
// fighting a large unrelated transcript. Restores the original active
// conversation in `finally` via POST /conversations/:id/continue.
//
// Seeds a chat_messages row directly (see SKILL.md's "Chat-message parts
// render tool cards straight from the DB" note) with a propose_mutation tool
// part whose output is a movement.create payload — no live model turn
// needed.
//
// Run: node .claude/skills/browser-verify/examples/verify-mutation-card-no-ids.mjs

import { execSync } from 'node:child_process';
import { launchAuthed, teardown, waitFor } from '../lib/browser.mjs';

const sql = q => execSync(
  `docker exec agent-chat-global-db-1 mysql -udev -pdev workout_log -N -B -e ${JSON.stringify(q)}`,
  { encoding: 'utf8' },
).trim();

const { page, api, appBase, browser } = await launchAuthed();
let newConversationId;
let originalActiveId;

// Three payloads covering the classes of id-leak this change addresses:
//  1. movement.create — a create-with-parent proposal (section).
//  2. variation.create — a create-with-parent proposal (exercise/movement).
//  3. section.delete — an update/delete proposal that already carries a
//     label, but previously also rendered its raw `id` as its own field.
const CASES = [
  {
    messageId: 'zztest-msg-1',
    toolCallId: 'call_zztest_movement_create_1',
    payload: {
      type: 'movement.create',
      section_id: 3,
      section_name: 'ZZTEST Push Day',
      label: 'ZZTEST Bench Press',
    },
    expectRelationship: 'ZZTEST Bench Press in ZZTEST Push Day',
  },
  {
    messageId: 'zztest-msg-2',
    toolCallId: 'call_zztest_variation_create_1',
    payload: {
      type: 'variation.create',
      movement_id: 7,
      exercise_name: 'ZZTEST Bench Press',
      label: 'ZZTEST Barbell',
      weight: 135,
      reps: 5,
    },
    expectRelationship: 'ZZTEST Barbell in ZZTEST Bench Press',
  },
  {
    messageId: 'zztest-msg-3',
    toolCallId: 'call_zztest_section_delete_1',
    payload: {
      type: 'section.delete',
      id: 9,
      label: 'ZZTEST Section To Delete',
      movement_count: 2,
      variation_count: 5,
    },
    expectRelationship: null,
  },
];

try {
  const activeRes = await api.get('chat/active');
  if (!activeRes.ok()) throw new Error(`GET /chat/active failed: ${activeRes.status()}`);
  originalActiveId = (await activeRes.json()).data.conversation.id;

  const newConvRes = await api.post('chat/conversations');
  if (!newConvRes.ok()) throw new Error(`POST /chat/conversations failed: ${newConvRes.status()}`);
  newConversationId = (await newConvRes.json()).data.conversation.id;

  const uuidHex = sql(`SELECT HEX(user_uuid) FROM users WHERE email='dev@dev.com';`);
  if (!uuidHex) throw new Error('dev user not found');

  for (const c of CASES) {
    const parts = [
      {
        type: 'tool-propose_mutation',
        toolCallId: c.toolCallId,
        state: 'output-available',
        input: c.payload,
        output: c.payload,
      },
    ];
    sql(
      `INSERT INTO chat_messages (user_uuid, conversation_id, message_id, role, parts) ` +
      `VALUES (UNHEX('${uuidHex}'), ${newConversationId}, '${c.messageId}', 'assistant', ` +
      `${JSON.stringify(JSON.stringify(parts))});`,
    );
  }

  await page.goto(appBase);
  // First load against a cold vite dev server compiles SCSS on demand — give
  // it real headroom rather than the default.
  await waitFor(
    page,
    () => [...document.querySelectorAll('button')].some((b) => b.textContent === 'Confirm'),
    { timeout: 20000 },
  );

  // Each proposal card is `<div class="card">title, [relationship], fields,
  // actions(Deny, Confirm)</div>` (see MutationProposalCard.tsx) — the
  // card element is the Deny button's grandparent. Read every card's full
  // text at once, then match each expected case by a marker string unique
  // to its payload (the label).
  const allCards = await page.evaluate(() => {
    return [...document.querySelectorAll('button')]
      .filter((b) => b.textContent === 'Deny')
      .map((denyBtn) => denyBtn.parentElement.parentElement.textContent);
  });

  console.log('All confirm-card texts found:', JSON.stringify(allCards, null, 2));

  for (const c of CASES) {
    const marker = c.payload.label;
    const cardText = allCards.find((t) => t.includes(marker));
    if (!cardText) throw new Error(`FAIL [${c.messageId}]: no card found containing label "${marker}"`);

    const mentionsBareId = /\bid\b/i.test(cardText);
    const mentionsMovementWord = /\bmovement\b/i.test(cardText);
    if (mentionsBareId) throw new Error(`FAIL [${c.messageId}]: card text matches /\\bid\\b/ — "${cardText}"`);
    if (mentionsMovementWord) throw new Error(`FAIL [${c.messageId}]: card says "movement" instead of "exercise" — "${cardText}"`);

    if (c.expectRelationship) {
      if (!cardText.includes(c.expectRelationship)) {
        throw new Error(`FAIL [${c.messageId}]: expected relationship line "${c.expectRelationship}" not found — "${cardText}"`);
      }
    } else {
      // The delete case: id (9) must not appear as a raw value anywhere,
      // and its label/cascade counts must still be legible.
      if (!cardText.includes(c.payload.label)) throw new Error(`FAIL [${c.messageId}]: label not shown — "${cardText}"`);
      if (!/2 exercise/.test(cardText) || !/5 variation/.test(cardText)) {
        throw new Error(`FAIL [${c.messageId}]: cascade counts not shown legibly — "${cardText}"`);
      }
    }
    console.log(`PASS [${c.messageId}]:`, JSON.stringify(cardText));
  }

  console.log('PASS: all cases — no id surfaced, parent names rendered, "exercise" terminology used');
} finally {
  if (newConversationId) await api.delete(`chat/conversations/${newConversationId}`);
  if (originalActiveId) await api.post(`chat/conversations/${originalActiveId}/continue`);
  await teardown({ browser, api });
}
