// Template: drive the Peak chat end to end (open, send, wait for a real reply)
// and read the agent instructions modal's hint copy. Boots its own stack so
// it's runnable standalone; pass AGENT_MODEL via stackOptions.env to check a
// specific model (this makes one real model call when OPENAI_API_KEY is
// available from the main checkout's .env; harmless to run repeatedly).
//
// Run: node .claude/skills/browser-verify/examples/verify-chat-agent-model.mjs [screenshot-path]

import path from 'node:path';
import os from 'node:os';
import { launchAuthed, teardown, waitFor } from '../lib/browser.mjs';
import * as sel from '../lib/selectors.mjs';

const SHOT = process.argv[2] ?? path.join(os.tmpdir(), 'browser-verify-agent-model.png');

async function main() {
  const { page, api, browser, stack } = await launchAuthed({
    stack: true,
    stackOptions: { env: { AGENT_MODEL: 'gpt-5.4-mini' } },
  });
  const result = {};
  const consoleErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });

  try {
    await sel.openChat(page);
    await page.fill(sel.chatComposer, 'Reply with exactly the word: pong');
    await page.click(sel.chatSend);
    await waitFor(
      page,
      () => /\bpong\b/i.test([...document.querySelectorAll('[class*="message"]')].map((e) => e.textContent).join(' ')),
      { timeout: 60000 },
    );
    result.replied = true;

    // openChat() taps the FAB, which jumps straight to fully expanded (see
    // AgentChat.tsx's pointerup tap-threshold logic): the header and its
    // gear button are already visible, no separate expand step needed.
    await sel.openAgentInstructions(page);
    result.hint = await page.evaluate(
      (textareaSel) => document.querySelector(textareaSel).closest('[role=dialog]').querySelector('p').textContent,
      sel.agentInstructionsTextarea,
    );
    await page.screenshot({ path: SHOT });
    result.screenshot = SHOT;
    result.consoleErrors = consoleErrors;
    console.log('RESULT', JSON.stringify(result));
  } finally {
    await teardown({ browser, api, stack });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
