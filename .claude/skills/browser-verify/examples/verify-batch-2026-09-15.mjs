// Runtime validation for the 2026-09-15 issue batch (PRs #356/#357/#359/#360).
// Measures computed DOM/API state rather than eyeballing screenshots.
//
// Two traps this script exists to avoid repeating:
//  - A relative `/api/...` fetch from the page resolves against the VITE origin,
//    not the API server, and vite answers unknown paths with index.html. That
//    looks like a 200 with an empty body, i.e. a passing check on a server that
//    was never contacted. Use the `api` request context (absolute + bearer).
//  - Seeding feedback through POST /feedback leaves issue_number NULL, so the
//    changelog badge never renders. The badge keys off issue_number.
import mysql from 'mysql2/promise';
import { launchAuthed, teardown, waitFor } from '../lib/browser.mjs';

const apiBase = 'http://localhost:5055/api/';
const appBase = 'http://localhost:5056';
const BADGE_ISSUE = 340; // tagged on the 2026-09-12 changelog entry

const db = await mysql.createConnection({
  host: '127.0.0.1', port: 3307, user: 'dev', password: 'dev', database: 'workout_log',
});

const results = {};
const { page, api, browser } = await launchAuthed({ apiBase, appBase });
let seededFeedbackId = null;
let seededConversationId = null;
let reusedConversation = false;

try {
  const [[dev]] = await db.query(
    "SELECT BIN_TO_UUID(user_uuid) AS uuid FROM users WHERE email = 'dev@dev.com'",
  );
  const devUuid = dev.uuid;

  // ---- fixtures ---------------------------------------------------------
  const [fb] = await db.query(
    `INSERT INTO feedback (user_uuid, category, tool, message, issue_number)
     VALUES (UUID_TO_BIN(?), 'idea', 'other', 'ZZTEST changelog badge fixture', ?)`,
    [devUuid, BADGE_ISSUE],
  );
  seededFeedbackId = fb.insertId;

  // A propose_entry tool part carrying an explicit past date (#344). Chat parts
  // render tool cards straight from the DB, so this needs no AI turn.
  const proposalDate = '2026-09-10';
  // At most one active conversation per user is a DB-enforced invariant
  // (uniq_user_active_slot), and loading the app already created one, so reuse
  // whichever is active rather than inserting a second.
  const [activeRows] = await db.query(
    `SELECT id FROM conversations WHERE user_uuid = UUID_TO_BIN(?) AND archived_at IS NULL LIMIT 1`,
    [devUuid],
  );
  if (activeRows.length > 0) {
    seededConversationId = activeRows[0].id;
    reusedConversation = true;
  } else {
    const [conv] = await db.query(
      `INSERT INTO conversations (user_uuid, title) VALUES (UUID_TO_BIN(?), 'ZZTEST proposal')`,
      [devUuid],
    );
    seededConversationId = conv.insertId;
  }
  const proposalParts = [{
    type: 'tool-propose_entry',
    toolCallId: 'zztest-call-1',
    state: 'output-available',
    input: {},
    output: {
      date: proposalDate,
      meal: 'lunch',
      name: 'ZZTEST Proposed Food',
      source: 'manual',
      ingredients: [{
        name: 'ZZTEST ingredient', grams: 100, calories: 200,
        protein_g: 10, carbs_g: 20, fat_g: 5, source: 'manual',
      }],
    },
  }];
  // chat_messages carries a legacy `date` column alongside conversation_id.
  await db.query(
    `INSERT INTO chat_messages (conversation_id, user_uuid, date, message_id, role, parts, interrupted)
     VALUES (?, UUID_TO_BIN(?), ?, 'zztest-msg-1', 'assistant', ?, 0)`,
    [seededConversationId, devUuid, proposalDate, JSON.stringify(proposalParts)],
  );

  // ---- #353: destructive color tokens -----------------------------------
  await page.goto(appBase, { waitUntil: 'domcontentloaded' });
  await waitFor(page, () => document.styleSheets.length > 0, { timeout: 20000 });

  results.colors = await page.evaluate(() => {
    const hits = { error: [], errorStrong: [], oldRed: [] };
    for (const sheet of document.styleSheets) {
      let rules;
      try { rules = sheet.cssRules; } catch { continue; }
      for (const rule of rules) {
        const text = rule.cssText || '';
        if (/#ed1518/i.test(text) || /rgb\(237,\s*21,\s*24\)/i.test(text)) hits.oldRed.push(text.slice(0, 80));
        if (/#e97272/i.test(text) || /rgb\(233,\s*114,\s*114\)/i.test(text)) hits.error.push(text.slice(0, 80));
        if (/#b3342f/i.test(text) || /rgb\(179,\s*52,\s*47\)/i.test(text)) hits.errorStrong.push(text.slice(0, 80));
      }
    }
    return {
      newErrorRules: hits.error.length,
      errorStrongRules: hits.errorStrong.length,
      oldSaturatedRedRules: hits.oldRed.length,
      errorStrongSamples: hits.errorStrong,
    };
  });

  // ---- #351: changelog badge -------------------------------------------
  results.submittedIssues = await (await api.get('feedback/my-issues')).json();

  await page.goto(appBase, { waitUntil: 'domcontentloaded' });
  await waitFor(page, () => document.querySelectorAll('button').length > 3, { timeout: 20000 });
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find(b =>
      /what.s new|changelog|release/i.test(
        `${b.getAttribute('aria-label') || ''} ${b.title || ''}`));
    if (btn) btn.click();
  });
  await new Promise(r => setTimeout(r, 1500));

  results.changelogBadge = await page.evaluate(() => {
    const badges = [...document.querySelectorAll('[class*="submittedBadge"]')];
    return {
      badgeCount: badges.length,
      badgeTexts: badges.map(b => b.textContent.trim()),
      modalOpen: !!document.querySelector('[class*="entryTitle"], [class*="entryDate"]'),
    };
  });

  // ---- #344: proposal card carries the proposed date ---------------------
  await page.goto(`${appBase}/?tab=nutrition`, { waitUntil: 'domcontentloaded' });
  await waitFor(page, () => !!document.querySelector('button[aria-label*="AI chat"]'), { timeout: 20000 });
  const fab = await page.$('button[aria-label*="Open"][aria-label*="AI chat"]');
  if (fab) {
    const box = await fab.boundingBox();
    if (box) await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  }
  await new Promise(r => setTimeout(r, 2500));

  results.proposalDate = await page.evaluate((expected) => {
    const dates = [...document.querySelectorAll('input[type="date"]')].map(i => ({
      value: i.value,
      visible: i.checkVisibility?.() ?? true,
    }));
    return {
      expected,
      dateInputs: dates,
      matchesProposal: dates.some(d => d.value === expected),
      proposalCardPresent: /ZZTEST Proposed Food/.test(document.body.innerText),
    };
  }, proposalDate);

  // ---- #360: usage report shape + param validation -----------------------
  const usageRes = await api.get('admin/usage?from=2026-09-01&to=2026-09-15');
  const usageBody = await usageRes.json();
  results.usageApi = {
    status: usageRes.status(),
    keys: Object.keys(usageBody?.data ?? {}),
    hasByUser: Array.isArray(usageBody?.data?.byUser),
  };
  const badUuid = await api.get('admin/usage?from=2026-09-01&to=2026-09-15&userUuid=not-a-uuid');
  results.usageValidation = { malformedUserUuidStatus: badUuid.status() };

  console.log('RESULT', JSON.stringify(results, null, 2));
} finally {
  // Only the seeded message is ours when the conversation was reused; dropping
  // the conversation itself would take real data with it.
  if (seededConversationId) {
    await db.query(
      `DELETE FROM chat_messages WHERE conversation_id = ? AND message_id = 'zztest-msg-1'`,
      [seededConversationId],
    );
    if (!reusedConversation) {
      await db.query('DELETE FROM conversations WHERE id = ?', [seededConversationId]);
    }
  }
  if (seededFeedbackId) await db.query('DELETE FROM feedback WHERE id = ?', [seededFeedbackId]);
  await db.end();
  await teardown({ browser, api });
}
