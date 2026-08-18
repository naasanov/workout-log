// Shared helpers for standalone Playwright verification scripts in this repo.
// See ../SKILL.md for when to use this vs. the interactive Playwright MCP tools.
//
// Design: log in via a direct API call (captured as storageState) so the
// browser context is already authenticated on first navigation. No UI
// login form, no field-typing, no route-guessing.

import { chromium, request } from 'playwright';

const DEFAULTS = {
  // Trailing slash matters: Playwright's request baseURL joining treats a
  // leading `/` on the request path as origin-absolute, which silently
  // drops the `/api` segment. Keep apiBase slash-terminated and call
  // endpoints WITHOUT a leading slash (e.g. api.post('auth/login', ...)).
  apiBase: 'http://localhost:3000/api/',
  appBase: 'http://localhost:3001',
  email: 'dev@dev.com',
  password: 'dev', // seeds/dev_user.sql — standing local dev account, no signup/cleanup needed
};

/**
 * Launches a throwaway browser already authenticated as the given user.
 *
 * Two auth mechanisms are in play and both are wired up here:
 *   - The browser gets the refresh-token cookie via storageState, so the
 *     React app's own bootstrap (GET /auth/logged-in on load) mints its
 *     access token normally — the real app works exactly as a user would see it.
 *   - `api` is a REST client for direct fixture seeding/cleanup, bypassing
 *     the UI. Routes require an `Authorization: Bearer <accessToken>` header
 *     (the cookie alone is NOT enough for these — see routes/auth.ts
 *     authenticateToken), so the login accessToken is attached to every
 *     call made through `api`.
 *
 * Returns { browser, context, page, api, appBase } — call teardown(handles) when done.
 */
export async function launchAuthed(opts = {}) {
  const cfg = { ...DEFAULTS, ...opts };

  const anon = await request.newContext({ baseURL: cfg.apiBase });
  const loginRes = await anon.post('auth/login', {
    data: { email: cfg.email, password: cfg.password },
  });
  if (!loginRes.ok()) {
    throw new Error(`login failed: ${loginRes.status()} ${await loginRes.text()}`);
  }
  const { data: { accessToken } } = await loginRes.json();
  const storageState = await anon.storageState();
  await anon.dispose();

  const api = await request.newContext({
    baseURL: cfg.apiBase,
    extraHTTPHeaders: { Authorization: `Bearer ${accessToken}` },
  });

  // launchOptions/contextOptions passthrough: needed for flows that require a
  // device permission the headless default denies. The barcode scanner
  // (#251) is the motivating case — `getUserMedia` must resolve or the
  // scanner unmounts itself via its catch-block `onClose()`, so a camera
  // check needs Chromium's fake video device plus a granted permission.
  const browser = await chromium.launch(cfg.launchOptions ?? {});
  const context = await browser.newContext({ storageState, ...(cfg.contextOptions ?? {}) });
  const page = await context.newPage();
  await page.goto(cfg.appBase);

  return { browser, context, page, api, appBase: cfg.appBase };
}

export async function teardown({ browser, api }) {
  await browser?.close();
  await api?.dispose();
}

/**
 * Polls `page.evaluate(predicate)` until it returns truthy.
 *
 * Prefer this over `page.waitForFunction()` in this repo: waitForFunction
 * timed out repeatedly in testing on a condition that plain `evaluate()`
 * confirmed was already true on the page (tried both default rAF-based
 * polling and an explicit interval — same result), for reasons not tracked
 * down. This manual loop is what was actually proven reliable end-to-end.
 *
 * `predicate` must be a plain function with no closure over outer variables
 * (it's serialized and run in the page).
 */
export async function waitFor(page, predicate, { timeout = 20000, interval = 500 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await page.evaluate(predicate)) return;
    await new Promise((r) => setTimeout(r, interval));
  }
  throw new Error(`waitFor: condition not met within ${timeout}ms`);
}

// Known DOM traps in this app (see SKILL.md for details):
//   - `[role=dialog]` matches the off-canvas nav drawer, not just real modals.
//     Scope with `.closest('[role=dialog]')` from an element already inside
//     your target modal instead of querying `[role=dialog]` directly.
//   - A hidden nutrition composer `<textarea placeholder="Describe what you
//     ate…">` shadows generic `textarea` selectors. Scope by a placeholder or
//     other attribute unique to your target.
//   - Editable text fields (label of a section/movement/variation, etc.) are
//     a plain `<span>{value}</span>` until clicked into edit mode, where
//     they become an `<input>`. Match the span's textContent by default —
//     don't assume "editable" implies "always an input" without checking
//     the component (client/src/components/Editable.jsx).
