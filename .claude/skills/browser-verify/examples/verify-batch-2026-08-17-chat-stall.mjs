// #252 — stall watchdog: a chat stream that dies SILENTLY must stop spinning
// forever and auto-recover the reply the server already persisted.
//
// Simulating the real failure faithfully is the whole point here. A devtools
// "offline" toggle produces a LOUD fetch rejection, which the pre-existing
// #154 path already handled — it is not this bug. The bug is a socket that
// goes quiet without ever rejecting, so `status` stays 'streaming' forever.
// We reproduce that exactly by intercepting POST /nutrition/chat and simply
// never answering it: the request stays open, nothing errors, the client
// believes it is still streaming.
//
// Meanwhile we write into `chat_messages` directly, standing in for what
// routes/nutrition.ts's server-side tee()/consumeStream drain would have
// persisted while the client was disconnected.
import { execSync } from 'node:child_process';
import { launchAuthed, teardown, waitFor } from '../lib/browser.mjs';

const today = new Date();
const DATE = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

const sql = q => execSync(
  `docker exec workout-log-db-1 mysql -udev -pdev workout_log -N -B -e ${JSON.stringify(q)}`,
  { encoding: 'utf8' },
).trim();

const uuidHex = sql(`SELECT HEX(user_uuid) FROM users WHERE email='dev@dev.com';`);
if (!uuidHex) throw new Error('dev user not found');

const insertMsg = (msgId, role, parts) => sql(
  `INSERT INTO chat_messages (user_uuid, date, message_id, role, parts) VALUES (UNHEX('${uuidHex}'), '${DATE}', '${msgId}', '${role}', ${JSON.stringify(JSON.stringify(parts)).replace(/'/g, "\\'")});`
);

// Start from a clean slate for today so endsInDanglingUser() is unambiguous.
sql(`DELETE FROM chat_messages WHERE user_uuid=UNHEX('${uuidHex}') AND date='${DATE}';`);

const { page, api, appBase, browser } = await launchAuthed();
const timeline = [];
const t0 = Date.now();
const mark = (label, extra = {}) => timeline.push({ at: `${Math.round((Date.now() - t0) / 1000)}s`, label, ...extra });

const probeUI = () => page.evaluate(() => {
  const txt = document.body.innerText;
  return {
    stopButtonPresent: !!document.querySelector('button[aria-label="Stop generation"]'),
    sendButtonPresent: !!document.querySelector('button[aria-label="Send"]'),
    reconnecting: txt.includes('Reconnecting…'),
    stillWorking: txt.includes('Assistant is still working…'),
    recoveredReplyVisible: txt.includes('ZZTEST recovered assistant reply'),
    errorBubble: /something went wrong|error/i.test(txt) && !txt.includes('ZZTEST'),
  };
});

try {
  // Hang the chat request open forever: no response, no error, no close.
  await page.route('**/nutrition/chat', async () => { /* never settle */ });

  await page.goto(`${appBase}/?tab=nutrition`);
  await waitFor(page, () => !!document.querySelector('textarea[placeholder="Describe what you ate…"]'), { timeout: 25000 });

  await page.evaluate(() => {
    const ta = document.querySelector('textarea[placeholder="Describe what you ate…"]');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    setter.call(ta, 'ZZTEST how many calories in an apple');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await waitFor(page, () => !!document.querySelector('button[aria-label="Send"]'), { timeout: 10000 });
  await page.evaluate(() => document.querySelector('button[aria-label="Send"]').click());

  // The intercepted request never reaches the server, so stand in for the
  // user row the route would have persisted before streaming.
  insertMsg(`user-${Date.now()}`, 'user', [{ type: 'text', text: 'ZZTEST how many calories in an apple' }]);

  await new Promise(r => setTimeout(r, 3000));
  mark('t+3s (streaming, watchdog should NOT have fired)', await probeUI());

  await new Promise(r => setTimeout(r, 42000));
  mark('t+45s (still under the 60s threshold)', await probeUI());

  // Cross the 60s threshold (+ up to one 5s check interval, + slack).
  await new Promise(r => setTimeout(r, 30000));
  const afterStall = await probeUI();
  mark('t+75s (watchdog should have fired: stop() + poll armed)', afterStall);

  // Now the server "finishes": the drained stream persists the assistant
  // reply. The armed poll should pick it up within ~3s.
  insertMsg(`asst-${Date.now()}`, 'assistant', [{ type: 'text', text: 'ZZTEST recovered assistant reply' }]);
  await new Promise(r => setTimeout(r, 9000));
  mark('t+84s (poll should have recovered the reply)', await probeUI());

  console.log('RESULT', JSON.stringify({ date: DATE, timeline }, null, 2));
} finally {
  sql(`DELETE FROM chat_messages WHERE user_uuid=UNHEX('${uuidHex}') AND date='${DATE}';`);
  await teardown({ browser, api });
}
