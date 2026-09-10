// Verifies propose_mutation confirm cards render every proposal as labelled
// parameter rows (parent names included, "old → new" for updates) and never
// surface a raw database id, plus that generic read tools are labelled by the
// resource they target ("List variations", "Look up exercise").
//
// Starts a brand-new conversation (archives, doesn't destroy, the dev user's
// current one) so the seeded messages are the only content on the page, and
// restores the original active conversation in `finally`. Seeds chat_messages
// rows directly (see SKILL.md), so no live model turn is needed.
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

// Each case lists the exact "key: value" rows its card must show, in order.
const CASES = [
  {
    payload: { type: 'movement.create', section_id: 3, section_name: 'ZZ Push', label: 'ZZ Bench Press' },
    rows: ['section: ZZ Push', 'label: ZZ Bench Press'],
  },
  {
    payload: { type: 'variation.create', movement_id: 7, exercise_name: 'ZZ Bench Press', label: 'ZZ Barbell', weight: 135, reps: 5 },
    rows: ['exercise: ZZ Bench Press', 'label: ZZ Barbell', 'weight: 135', 'reps: 5'],
  },
  {
    // A one-item batch renders as a single card; an unchanged label shows once.
    payload: {
      mutations: [{
        type: 'variation.update', id: 20, exercise_name: 'ZZ Incline Press', current_label: 'ZZ Dumbbell',
        label: 'ZZ Dumbbell', current_weight: 125, current_reps: 5, weight: 135, reps: 5,
      }],
    },
    title: 'update variation',
    rows: ['exercise: ZZ Incline Press', 'label: ZZ Dumbbell', 'weight: 125 → 135', 'reps: 5'],
  },
  {
    payload: { type: 'movement.update', id: 4, section_name: 'ZZ Legs', current_label: 'ZZ Squat', label: 'ZZ Back Squat' },
    rows: ['section: ZZ Legs', 'label: ZZ Squat → ZZ Back Squat'],
  },
  {
    payload: { type: 'body_weight_entry.update', id: 1, current_weight: 185, current_date: '2026-09-01', weight: 183 },
    rows: ['weight: 185 → 183', 'date: 2026-09-01'],
  },
  {
    payload: { type: 'section.delete', id: 9, label: 'ZZ Old Section', movement_count: 2, variation_count: 5 },
    rows: ['label: ZZ Old Section'],
    extra: [/2 exercise/, /5 variation/],
  },
];

const READ_TOOLS = [
  { tool: 'list_resources', input: { resource: 'variation', parent_id: '7' }, label: 'List variations' },
  { tool: 'get_resource', input: { resource: 'movement', id: '7' }, label: 'Look up exercise' },
  { tool: 'list_resources', input: { resource: 'workout_tree' }, label: 'List workouts' },
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

  const insert = (messageId, parts) => sql(
    `INSERT INTO chat_messages (user_uuid, conversation_id, message_id, role, parts) ` +
    `VALUES (UNHEX('${uuidHex}'), ${newConversationId}, '${messageId}', 'assistant', ` +
    `${JSON.stringify(JSON.stringify(parts))});`,
  );

  insert('zz-read-tools', [
    ...READ_TOOLS.map((r, i) => ({
      type: `tool-${r.tool}`, toolCallId: `call_zz_read_${i}`, state: 'output-available', input: r.input, output: [],
    })),
    { type: 'text', text: 'ZZ read tools done' },
  ]);
  CASES.forEach((c, i) => insert(`zz-card-${i}`, [{
    type: 'tool-propose_mutation', toolCallId: `call_zz_card_${i}`, state: 'output-available', input: c.payload, output: c.payload,
  }]));

  await page.goto(appBase);
  await waitFor(
    page,
    () => [...document.querySelectorAll('button')].filter((b) => b.textContent === 'Confirm').length >= 6,
    { timeout: 20000 },
  );

  const cards = await page.evaluate(() => [...document.querySelectorAll('button')]
    .filter((b) => b.textContent === 'Deny')
    .map((deny) => {
      const card = deny.parentElement.parentElement;
      const rows = [...card.querySelectorAll('[class*="_fieldKey_"]')]
        .map((k) => `${k.textContent} ${k.nextElementSibling?.textContent ?? ''}`);
      return { title: card.firstElementChild.textContent, rows, text: card.textContent };
    }));

  let failed = false;
  const fail = (msg) => { failed = true; console.log(`FAIL: ${msg}`); };

  CASES.forEach((c, i) => {
    const card = cards[i];
    if (!card) return fail(`case ${i}: no card rendered`);
    if (JSON.stringify(card.rows) !== JSON.stringify(c.rows)) {
      fail(`case ${i} rows ${JSON.stringify(card.rows)} != expected ${JSON.stringify(c.rows)}`);
    }
    if (c.title && card.title !== c.title) fail(`case ${i} title "${card.title}" != "${c.title}"`);
    if (/\bid\b|\bmovement\b|current|→\s*$/i.test(card.text)) fail(`case ${i} leaks internals: "${card.text}"`);
    for (const re of c.extra ?? []) if (!re.test(card.text)) fail(`case ${i} missing ${re}: "${card.text}"`);
    if (!failed) console.log(`PASS case ${i} (${card.title}):`, JSON.stringify(card.rows));
  });

  // Tool steps sit inside the collapsed process timeline; expand it first.
  await page.evaluate(() => {
    for (const b of document.querySelectorAll('button[aria-expanded="false"]')) b.click();
  });
  await page.waitForTimeout(500);
  const pageText = await page.evaluate(() => document.body.innerText);
  for (const r of READ_TOOLS) {
    if (pageText.includes(r.label)) console.log(`PASS tool label: ${r.label}`);
    else fail(`tool label "${r.label}" not found`);
  }
  for (const generic of ['List records', 'Look up record']) {
    if (pageText.includes(generic)) fail(`generic tool label "${generic}" still shown`);
  }

  console.log(failed ? 'SOME CHECKS FAILED' : 'ALL PASS');
} finally {
  if (newConversationId) await api.delete(`chat/conversations/${newConversationId}`);
  if (originalActiveId) await api.post(`chat/conversations/${originalActiveId}/continue`);
  await teardown({ browser, api });
}
