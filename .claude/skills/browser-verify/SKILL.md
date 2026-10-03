---
name: browser-verify
description: Runtime-verify a change in this repo (workout-log) by driving the real app in a browser. One call boots the dev stack (MySQL, server, vite), auth and DOM selectors are pre-solved, so you don't rediscover ports, CORS, or stale selectors by trial and error. Use before merging/reporting a fix done, for issue-orchestrator's validate step, or any time you'd otherwise reach for the Playwright MCP browser tools on this repo.
---

# Browser Verify (workout-log)

Runtime validation catches what `tsc`/build cannot: a Y-axis silently anchored
at 0, a CSS specificity loss, a modal that discards data on Escape. This
skill exists so that's one `node` call instead of ~10 hand-copied shell
commands plus a round of selector rediscovery.

## Setup (once per checkout)

```
cd .claude/skills/browser-verify && npm install && npx playwright install chromium
```

Isolated `package.json` here: it does **not** touch the project's own
`package.json`/`package-lock.json`.

## The happy path

```js
import { launchAuthed, teardown, waitFor } from '../lib/browser.mjs';
import * as sel from '../lib/selectors.mjs';

const { page, api, appBase, browser, stack } = await launchAuthed({ stack: true });
try {
  await page.goto(`${appBase}/?tab=nutrition`); // tabs are a query param, not a route
  await sel.openChat(page);
  await page.fill(sel.chatComposer, 'hello');
  await page.click(sel.chatSend);
  // ...assert on computed DOM state (page.evaluate), not screenshots...
} finally {
  await teardown({ browser, api, stack });
}
```

`{ stack: true }` boots MySQL + the server + vite for you (see below) and
`teardown` stops them. If a stack is already running and you know its ports,
`launchAuthed({ apiBase, appBase })` skips booting one, same as before.

## Two ways to verify: pick deliberately

**Standalone script (default).** For a known, repeatable check: seed fixture
data, drive the UI, assert on computed DOM/values, clean up. One Bash call
runs the whole thing in an isolated Node+Playwright process; only the final
result (stdout) enters your context. Use this for almost everything.

**Interactive Playwright MCP tools.** For genuine exploratory debugging where
you don't yet know what's wrong and need to see the DOM/screenshot after each
action to decide the next one. Expensive in context (full accessibility
snapshot per call): only reach for it when you need that step-by-step
visibility. A standalone script can't attach to the MCP's own browser tab
(it launches with `--remote-debugging-pipe`, not a websocket port), which is
fine: `lib/browser.mjs` launches its own throwaway browser per script anyway.

## Writing a new check

Copy `examples/verify-weight-graph.mjs`'s shape. Seed via `api` (fast, no UI
clicks), drive the UI through `lib/selectors.mjs` rather than hand-rolling
selectors, assert on `page.evaluate` output, clean up in `finally`.

Run it: `node .claude/skills/browser-verify/examples/your-script.mjs`

### Test data convention

Prefix every fixture label with `ZZTEST`. `DELETE /api/sections/:id` cascades
to movements → variations → variation_history, so deleting the one seeded
section cleans up everything under it. As a safety net against a killed
process leaking rows, sweep leftovers directly:

```
docker exec workout-log-db-1 mysql -udev -pdev workout_log -e \
  "DELETE FROM sections WHERE label LIKE 'ZZTEST%';"
```

Some scenarios can't be created through the API at all (e.g. a legacy history
row with `reps IS NULL`, which the schema now forbids on insert). Seed those
directly with `docker exec ... mysql -udev -pdev workout_log -e "INSERT..."`
and clean up the same way.

## What `startStack` does

`lib/stack.mjs`'s `startStack(opts)` (used by `launchAuthed({ stack: true })`)
runs from either the main checkout or any worktree:

- Picks two free ports (tries 5055/5056 first, else any free pair).
- Reuses MySQL on `127.0.0.1:3307` if something's already listening there
  (and tells you which `docker ps` container it is); otherwise runs
  `docker compose up -d` itself. Either way, runs `npm run db:setup`
  (idempotent: migrations + the `dev@dev.com`/`dev` seed).
- Builds the server env from the MAIN checkout's `.env` if present (a
  worktree has none of its own, but its secrets like `OPENAI_API_KEY` are
  still useful), then forces `DB_*`, `PORT`, `FRONTEND_URL` (CORS needs an
  exact origin match), and `ACCESS_TOKEN_SECRET`/`REFRESH_TOKEN_SECRET`
  (falls back to `x`), then applies `opts.env` last.
- Installs `node_modules` (server and `client/`) if missing, `npm run build`s
  the server unless `opts.build === false`, writes `client/.env.local`
  (refuses to clobber one pointing elsewhere unless `opts.force`), and spawns
  `node dist/index.js` + `npx vite --strictPort`.
- Waits for both, reading the server's own log line ("Server running on
  port") rather than trusting a status code: on macOS, port 5000 answers
  HTTP as AirPlay Receiver even when your server died of `EADDRINUSE`.
- Returns `{ apiBase, appBase, stop, logs }`. `stop()` kills exactly what it
  spawned and is idempotent (also runs on process exit/SIGINT); `logs()`
  returns the server log text, useful for asserting on a line like
  `[feedback] issue creation failed: 401`.

Options: `env`/`unsetEnv` (server env overrides, e.g. `{ GITHUB_TOKEN:
'invalid' }` or `{ AGENT_MODEL: 'gpt-5.4-mini' }`), `build: false`, `force:
true`, `stopDb: true` (let `stop()` run `docker compose down`, only if this
call started the container), `serverPort`/`clientPort` hints.

### Manual fallback

If you need the stack up without a script driving it:

```
docker compose up -d
DB_HOST=127.0.0.1 DB_PORT=3307 DB_USERNAME=dev DB_PASSWORD=dev DB_NAME=workout_log npm run db:setup
ACCESS_TOKEN_SECRET=x REFRESH_TOKEN_SECRET=x DB_PORT=3307 PORT=5055 \
  FRONTEND_URL=http://localhost:5056 node dist/index.js &
echo "VITE_API_URL=http://localhost:5055/api" > client/.env.local
(cd client && npx vite --port 5056 --strictPort &)
```

**Standing login**: `dev@dev.com` / `dev`, seeded by `npm run db:setup`
(`scripts/seedDev.js` / `seeds/dev_user.sql`). No signup/cleanup needed;
`lib/browser.mjs` defaults to it.

## Behavior gotchas (not selectors: those live in `lib/selectors.mjs`)

- **Tabs are a query param, not a route.** `/?tab=nutrition`; `/nutrition`
  renders the shell with no tracker in it.
- **Every tab panel is in the DOM at once**; inactive ones are merely
  invisible. A selector resolving proves nothing about interactability: a
  `.click()` on an element in a non-active tab hangs the full 30s with
  "element is not visible". Navigate to the right `?tab=` first, and read
  that message as "wrong tab", not "wrong selector".
- **A relative `fetch('/api/...')` inside `page.evaluate` hits vite, not the
  API server**: it resolves against the page's own origin, and vite answers
  unknown paths with `index.html`. This comes back `status: 200` with an
  empty body and looks like a pass against a server it never contacted.
  Always assert API shape through the `api` request context (absolute +
  bearer token); keep `page.evaluate` for DOM only.
- **`page.waitForFunction()` was unreliable** in this setup on predicates
  `page.evaluate()` confirmed were already true. Use `lib/browser.mjs`'s
  `waitFor(page, predicate, opts)` instead: a manual evaluate-in-a-loop,
  proven reliable end-to-end. It forwards no extra args into the predicate;
  close over the value or inline it in the predicate body.
- **`npm test`/`npm run verify` want `root`/`root`, not `dev`/`dev`.**
  `scripts/testDb.js` defaults to the root DB user because it creates/drops
  schemas. Copying the server boot line's `DB_USERNAME=dev` onto a test run
  fails every DB-backed test with `ER_DBACCESS_DENIED_ERROR`.
- **`resetDb()` uses `DELETE`, not `TRUNCATE`**; ids keep climbing across
  tests. Never assert a literal id value: seed and read back instead.
- **`chat_messages` has a legacy non-null `date` column** alongside
  `conversation_id`; a direct INSERT that omits it fails.
- **At most one active conversation per user** (`uniq_user_active_slot`), and
  loading the app already creates one. Reuse the row where `archived_at IS
  NULL` for seeding rather than inserting a second, and in cleanup delete
  only your own seeded `chat_messages`, never the conversation itself.
- **Chat-message parts render tool cards straight from the DB.** Seeding a
  `chat_messages` row (`role='assistant'`, a `parts` JSON array with
  `{"type":"tool-search_foods","state":"output-available","output":[...]}`)
  is enough to inspect a `ToolCallCard` with no AI turn.
- **The changelog "You submitted this!" badge keys off `feedback.issue_number`.**
  Posting through `POST /feedback` leaves it NULL (set later when the row
  syncs to GitHub); seed the row directly with an `issue_number` that
  `client/src/config/changelog.js` actually tags.
- recharts' Y-axis tick **labels** live in a sibling group,
  `.recharts-yAxis-tick-labels`, not inside the `.recharts-yAxis` `<g>`.
- **First load against a cold `vite`** compiles SCSS on demand and can take
  several seconds beyond normal fetch+render; give first waits 15-20s+
  headroom. Fast on every later load against the same long-lived process.
- **Camera/`getUserMedia` needs the full Chromium build.** The default
  headless `chromium-headless-shell` has no media stack: `getUserMedia`
  rejects `NotSupportedError` and `BarcodeScanner` unmounts itself via its
  catch-block `onClose()`. Launch with `channel: 'chromium'` plus
  `args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-capture']`
  and `contextOptions: { permissions: ['camera'] }` (`launchAuthed` passes
  both through).
- **An expanded chat sheet renders a full-screen overlay** (`AgentChat.tsx`'s
  `styles.overlay`) that intercepts clicks on everything else on the page.
  Collapse it before interacting with anything outside the chat.
- **`el.click()` bypasses hit-testing** and will "succeed" on an element
  something else covers or that's inert (`pointer-events: none`). When the
  actual question is "can a user hit this", use `page.mouse.click(x, y)` at
  the element's center instead; reserve `page.evaluate(() => el.click())`
  for routing around an overlay that's a known false positive (e.g. a
  swipe-affordance that periodically animates over a row).
- **To simulate a *silently* dead stream** (not a loud disconnect), intercept
  the request and never settle it: `page.route('**/nutrition/chat', async
  () => {})`. The fetch stays open, nothing rejects. DevTools
  offline/throttling does NOT reproduce this: that's a fetch rejection,
  an already-handled path.
- **Render arbitrary chat messages without an AI turn** by intercepting the
  hydrate call: `page.route('**/api/chat/active', ...)`, `route.fetch()`,
  push a message onto `body.data.messages`, `route.fulfill({ response,
  json: body })`. Nothing is persisted, so there's no cleanup.
- CSS attribute selectors (`input[value=...]`) only see an input's *initial*
  attribute, never React's live controlled value. Read `.value` inside
  `evaluate`/`waitFor` instead.
- Route paths are not guessable: grep `index.ts` for the mount. A wrong path
  returns vite's HTML, which fails as `SyntaxError: Unexpected token '<'`
  rather than a clean 404.
- `users.user_uuid`, not `users.uuid`. `SELECT BIN_TO_UUID(user_uuid) AS uuid
  FROM users WHERE email = 'dev@dev.com'` gets the dev user's uuid.

## Cleanup checklist after any verification session

- Delete ZZTEST fixtures (the API cascade above, or the direct SQL sweep).
- If you called `startStack`/`launchAuthed({ stack: true })` yourself and let
  `teardown`/`stop()` run, this is already done. If you booted the stack by
  hand, kill your `node dist/index.js`/`vite` processes and remove
  `client/.env.local` if you created it.
- `docker compose down` only if you started the container AND nothing else
  (another session, another worktree) is using host port 3307: `docker ps`
  first. Never pass `-v`; the volume is what makes the next boot fast.

## Keeping this current

When a selector breaks, fix it in `lib/selectors.mjs` and rerun
`node examples/smoke-selectors.mjs`: don't append prose here. This file is
for behavior that costs a wrong assumption, not DOM trivia that costs a
`grep`.
