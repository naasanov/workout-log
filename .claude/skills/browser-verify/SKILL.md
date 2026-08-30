---
name: browser-verify
description: Runtime-verify a change in this repo (workout-log) by driving the real app in a browser — auth, dev-stack boot, and DOM gotchas are pre-solved here so you don't rediscover them by trial and error. Use before merging/reporting a fix done, for issue-orchestrator's validate step, or any time you'd otherwise reach for the Playwright MCP browser tools on this repo.
---

# Browser Verify (workout-log)

Runtime validation catches what `tsc`/build cannot: a Y-axis silently anchored
at 0, a CSS specificity loss, a modal that discards data on Escape. This skill
exists because doing that validation the first time cost ~15 MCP tool calls
and a lot of rediscovery (wrong ports, wrong CORS origin, wrong selectors).
Everything found is captured here so it costs one read instead of a repeat.

## Two ways to verify — pick deliberately

**Standalone script (default).** For a known, repeatable check: seed fixture
data, drive the UI, assert on computed DOM/values, clean up. One Bash call
runs the whole thing in an isolated Node+Playwright process; only the final
result (stdout) enters your context — not a snapshot per step. Use this for
almost everything, including issue-orchestrator's step-9 validation.

**Interactive Playwright MCP tools.** For genuine exploratory debugging where
you don't yet know what's wrong and need to see the DOM/screenshot after each
action to decide the next one. Expensive in context (full accessibility
snapshot per call) — only reach for it when you actually need that
step-by-step visibility.

A standalone script cannot attach to the MCP's own open browser tab — its
Chrome is launched with `--remote-debugging-pipe` (anonymous OS pipe to its
direct parent process), not `--remote-debugging-port`, so there's no
websocket endpoint an external process could connect to. This isn't a
limitation in practice: `lib/browser.mjs` launches its own throwaway browser
per script, which is what makes the "batch the whole flow, return one result"
model work at all.

## Setup (once per checkout)

```
cd .claude/skills/browser-verify && npm install && npx playwright install chromium
```

This installs into an isolated `package.json` here — it does **not** touch
the project's own `package.json`/`package-lock.json`.

## Writing a new check

Copy `examples/verify-weight-graph.mjs`'s shape rather than editing it in
place. The pattern:

```js
import { launchAuthed, teardown, waitFor } from '../lib/browser.mjs';

const { page, api, appBase, browser } = await launchAuthed();
let sectionId;
try {
  // 1. seed fixtures via `api` (fast — no UI clicks)
  // 2. page.goto(appBase), drive the UI for the thing under test
  // 3. assert on computed DOM state (page.evaluate), not screenshots
  console.log('RESULT', JSON.stringify(result));
} finally {
  if (sectionId) await api.delete(`sections/${sectionId}`); // cascades: movements, variations, history
  await teardown({ browser, api });
}
```

Run it: `node .claude/skills/browser-verify/examples/your-script.mjs`

### Test data convention

Prefix every fixture label with `ZZTEST` (`ZZTEST Section`, `ZZTEST
Movement`, ...). `DELETE /api/sections/:id` cascades to movements →
variations → variation_history, so deleting the one seeded section cleans up
everything under it. As a safety net against a killed process leaking rows
(finally didn't save you once during testing — root cause untracked), you can
always sweep leftovers directly:

```
docker exec workout-log-db-1 mysql -udev -pdev workout_log -e \
  "DELETE FROM sections WHERE label LIKE 'ZZTEST%';"
```
(cascades the same way via FK constraints).

Some scenarios can't be created through the API at all — e.g. a legacy
history row with `reps IS NULL` (the schema now forbids null on insert). For
those, seed directly with `docker exec ... mysql -udev -pdev workout_log -e
"INSERT INTO ..."` and clean up the same way.

## Booting the dev stack

```
docker compose up -d                                                    # MySQL on host port 3307
DB_HOST=127.0.0.1 DB_PORT=3307 DB_USERNAME=dev DB_PASSWORD=dev \
  DB_NAME=workout_log npm run db:setup                                  # schema + dev@dev.com seed
ACCESS_TOKEN_SECRET=x REFRESH_TOKEN_SECRET=x \
  DB_PORT=3307 PORT=3000 FRONTEND_URL=http://localhost:3001 node dist/index.js &   # after `npm run build`
echo "VITE_API_URL=http://localhost:3000/api" > client/.env.local
cd client && npm run dev &                                              # vite on 3001
```

**Ports 3000/3001 are only the default, and both are frequently taken** — on
macOS port 5000 is AirPlay Receiver (it answers with a plausible HTTP status,
so a health check "succeeds" while your server actually died of `EADDRINUSE`
in the background), and 3000 is often another project's container. Any free
pair works, e.g. 5055/5056, as long as `PORT`, `FRONTEND_URL`, `VITE_API_URL`
and the script's `apiBase`/`appBase` all agree — the server's CORS check
demands an exact origin match. `launchAuthed({ apiBase, appBase })` takes the
override. Always read the server log after boot rather than trusting a
`curl` status code.

Why each var is needed, all discovered by hitting the failure first:
- `docker compose up -d` alone does **not** create any tables anymore —
  `docker-entrypoint-initdb.d` used to mount a stale subset of migrations
  (only through `006`, the repo has 17), and did so without recording
  anything in `schema_migrations`, so it silently disagreed with
  `scripts/migrate.js` about what schema state the DB was in. Schema is now
  owned entirely by `npm run migrate` (also what runs in Heroku's release
  phase, so this is the same code path as production); `npm run db:setup`
  runs that plus the dev-user seed in one step. This is required on both a
  brand-new volume **and** an existing one from before this change — an old
  volume's tables didn't come from `migrate.js`, so `schema_migrations` is
  still empty on it and needs a first `db:setup` run too.
- **The full `DB_*` set, not just `DB_PORT`.** `migrate.js`/`seedDev.js` read
  `DB_HOST`/`DB_USERNAME`/`DB_PASSWORD`/`DB_NAME` straight from `process.env`
  and do **not** load the root `.env` — so passing only `DB_PORT` fails with
  `ER_ACCESS_DENIED_ERROR (1045)` even from the main checkout, where `.env`
  exists. The values above are the ones `docker-compose.yml` provisions
  (`dev`/`dev`/`workout_log`); they're dev-container credentials, not secrets.
  Before debugging this, check whether the DB is *already* migrated — it
  usually is, and the whole step is skippable:
  `docker exec workout-log-db-1 mysql -udev -pdev workout_log -e "SELECT COUNT(*) FROM schema_migrations;"`
  (the table's column is `filename`, not `name`).
- `DB_PORT=3307` — matches `docker-compose.yml`'s host port mapping; both the
  server's and `migrate.js`'s own default is 3306 (bare MySQL default), which
  nothing is listening on locally. Needed on the `db:setup` line and the
  server boot line separately — `migrate.js`/`seedDev.js` don't load `.env`
  the way the server does, so pass it inline for both.
- `ACCESS_TOKEN_SECRET` / `REFRESH_TOKEN_SECRET` — the server signs/verifies
  JWTs with these (`routes/auth.ts`) and has no fallback; without them, login
  fails. They normally live in the gitignored root `.env`, which **does not
  exist in a fresh git worktree** (worktrees don't inherit untracked files
  from the main checkout) — so in a worktree you must pass them explicitly,
  even a throwaway value works fine for local verification since nothing
  validates them against anything else.
- `PORT=3000` and `FRONTEND_URL=http://localhost:3001` — the server's CORS
  origin check requires an **exact** match with the page's origin (see
  `index.ts`); get either port wrong and every request fails client-side with
  a CORS error, not a helpful server-side one.
- `client/.env.local` with `VITE_API_URL` — without it the client defaults to
  relative `/api`, which resolves against the vite dev server's own origin
  (3001), not the API server (3000). This file is gitignored; it didn't exist
  before a verification session and doesn't need to survive after one.
- The Docker volume persists across `docker compose down` (no `-v`), so
  schema/migrations and the seeded `dev@dev.com` user are usually already
  there on a second run — `npm run db:setup` is idempotent (migrations record
  themselves in `schema_migrations`; the seed is `INSERT IGNORE`), so it's
  always safe to re-run rather than guessing whether you need to.
- **A worktree that runs `docker compose` from its own directory gets its own
  project** (Compose derives the project name from the directory name by
  default) and therefore its own `db_data` volume — it does **not** share the
  main checkout's database, so it starts empty and needs its own `db:setup`
  run. Don't assume the main checkout's seeded data is visible there.

  **But do not read that as isolation.** Worktree isolation covers files and
  git state; it does not extend to processes or host resources. Two things
  break the assumption:
  - **Host port 3307 is a single global resource.** Separate Compose projects
    still cannot both bind it, so only one of these databases can be running
    at a time regardless of how many volumes exist.
  - **A session that just connects to `127.0.0.1:3307` is using whichever
    container currently holds the port** — usually the main checkout's. It
    never ran Compose, so it never got a project or a volume of its own.

  The general rule: anything keyed off the *directory name* rather than the
  worktree path will silently converge. Check `docker ps` before assuming the
  database in front of you is yours, and before `docker compose down` (see
  the cleanup checklist).

**Standing login**: `dev@dev.com` / `dev` — created by `npm run db:setup`
(specifically `scripts/seedDev.js`, which applies `seeds/dev_user.sql`). No
signup/cleanup needed; `lib/browser.mjs` defaults to it.

## DOM facts already paid for (don't rediscover these)

- **Tabs are a query param, not a route.** The nutrition tracker is at
  `/?tab=nutrition`; navigating to `/nutrition` renders the app shell with no
  tracker in it and every selector then times out for the wrong reason.
- **Nutrition entry rows are not clickable.** Editing an entry is behind the
  row's three-dots `EntryMenu`: click the first `button` inside
  `[class*=entryRow]`, then the `Edit` item. Clicking the entry name does
  nothing and looks like a broken selector.
- **`entryInputSchema` wants `localDate`, not `date`**, plus a top-level
  `source` (`'manual'` for fixtures). Seeding with `date` fails validation.
- **Seed the entry's date from the LOCAL calendar day, not
  `toISOString()`.** The tracker defaults to the browser's local day, so a
  UTC-derived date files the fixture on a day the UI isn't showing and the
  entry appears to vanish.
- **Chat-message parts render tool cards straight from the DB.** Seeding a
  `chat_messages` row (`role='assistant'`, `parts` = a JSON array containing
  `{"type":"tool-search_foods","state":"output-available","output":[...]}`)
  is enough to inspect a `ToolCallCard` without an AI turn.
- **Chat elements overlap enough to defeat Playwright actionability.**
  Expanding a tool card via `locator.click()` fails with `_reasoningToggle_`
  / `_messages_` "intercepts pointer events"; call the DOM `.click()` inside
  `page.evaluate` instead.
- `[role=dialog]` matches the **off-canvas nav drawer**, not just real
  modals. Scope with `.closest('[role=dialog]')` from an element already
  inside your target modal, never query `[role=dialog]` directly.
- A hidden nutrition composer `<textarea placeholder="Describe what you
  ate…">` shadows a bare `textarea` selector. Scope by placeholder or another
  attribute unique to your target.
- Editable text fields (`client/src/components/Editable.jsx`) render a plain
  `<span>{value}</span>` by default and only become an `<input>` once clicked
  into edit mode. Match the span's `textContent`, not an input's `.value`,
  unless you've actually clicked to edit.
- **There is no per-variation row wrapper.** Every variation under one
  movement renders its name cell, weight, reps, and buttons as flat siblings
  — `.closest()` from a label finds nothing because there's no containing
  element. Scope by DOM order instead: the Nth name-cell (`div[class*=
  "_nameCell_"]`) corresponds to the Nth button of that kind, since both come
  from the same `.map()`.
- The graph button has no `aria-label` (class-only). Match via
  `button[class*="graphBtn"]`; CSS-module hashes change, the semantic prefix
  doesn't.
- Playwright's `request` baseURL joining treats a **leading `/`** on a
  request path as absolute-from-origin, silently dropping a `/api` path
  segment in the base. Keep `apiBase` slash-terminated and call endpoints
  without a leading slash (`api.post('sections', ...)`, not `'/sections'`).
- A section-header swipe-to-remove overlay (`_remove_<hash>`) periodically
  animates over the row and fails Playwright's actionability hit-test,
  hanging a normal `.click()` indefinitely even though a real user could
  click it fine. Route around it with a native DOM click via `page.evaluate(()
  => el.click())` when this happens.
- `page.waitForFunction()` was unreliable in this setup on predicates that
  plain `page.evaluate()` confirmed were already true (tried both default and
  interval polling) — root cause not tracked down. `lib/browser.mjs` exports
  `waitFor(page, predicate, opts)`, a manual evaluate-in-a-loop, which was
  proven reliable end-to-end. Prefer it over `waitForFunction`.
- CSS attribute selectors (`input[value=...]`) only see an input's *initial*
  attribute, never React's live controlled value as a DOM property — a
  selector-based wait can time out while the value is visibly on screen.
  Read `.value` inside `evaluate`/`waitFor` instead.
- recharts' Y-axis tick **labels** are not inside the `.recharts-yAxis` `<g>`
  — they're a sibling group, `.recharts-yAxis-tick-labels`. Query that class
  for tick text, not a descendant of `.recharts-yAxis`.
- First page load against a **cold** `vite` dev process compiles SCSS on
  demand and can take several seconds beyond normal fetch+render. Give first
  waits real headroom (15-20s); it's fast on every subsequent load against
  the same long-lived process.
- **`div[class*="_sheet_"]` matches TWO elements** on the nutrition tab:
  NutritionChat's own composer sheet (`_sheet_vydzr_*`, first in DOM) and the
  portaled IngredientSheet dialog (`_sheet_1ofci_*`). A bare `querySelector`
  gets the chat's. Anchor off content instead —
  `document.querySelector('input[aria-label="Ingredient name"]').closest('[role=dialog]')`.
- **There are TWO `<BarcodeScanner>` instances**, and the same shadowing trap:
  NutritionChat renders a scan button + scanner inline in `MAIN`, which
  precede the body-appended dialog portal in DOM order. So a bare
  `button[aria-label="Scan barcode"]` / `button[aria-label="Close barcode
  scanner"]` resolves to the *chat's*, not the sheet's. Worse, while a Radix
  modal is open the chat's copy is inert (`pointer-events: none`,
  `aria-hidden` ancestor) — but `page.evaluate(() => el.click())` fires it
  anyway, so you get a real scanner overlay that is genuinely untappable.
  That looks precisely like "the fix under test didn't work" (cost two runs
  on #251). Scope to the dialog, and prefer `page.mouse.click(x, y)` at the
  element's center over `el.click()` when the *point* of the check is whether
  something is tappable — `el.click()` bypasses hit-testing entirely and will
  happily "succeed" on an inert element.
- **Camera/`getUserMedia` needs the full Chromium build.** Playwright's
  default headless `chromium-headless-shell` has no media stack:
  `getUserMedia` rejects with `NotSupportedError`, and `BarcodeScanner`'s
  catch-block calls `onClose()`, so the overlay unmounts a moment after it
  appears. Launch with `channel: 'chromium'` plus
  `args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-capture']`
  and `contextOptions: { permissions: ['camera'] }`. `lib/browser.mjs`'s
  `launchAuthed` takes `launchOptions` / `contextOptions` passthroughs for this.
- **To simulate a *silently* dead stream** (not a loud disconnect), intercept
  the request and never settle it: `page.route('**/nutrition/chat', async () => {})`.
  The fetch stays open, nothing rejects, and `useChat` keeps `status ===
  'streaming'` — which is the actual #252 failure. Devtools offline/throttling
  does NOT reproduce it; that produces a fetch rejection, which is the
  already-handled path. Pair it with direct `chat_messages` inserts to stand in
  for what the server's `tee()`/`consumeStream` drain persists while the
  client is disconnected.
- **Tab query-param values are lowercase kebab-case**, from
  `client/src/config/tabs.js`: `workouts`, `body-weight`, `habits`,
  `nutrition`. `?tab=Nutrition` (title case) is not valid and silently falls
  back to Workouts.
- **Every tab panel is in the DOM at once; inactive ones are merely
  invisible.** So `querySelector` finding your element proves nothing about
  whether you can interact with it — a Playwright `.click()` on an element in
  a non-active tab hangs the full 30s with `element is not visible` while the
  selector itself resolves fine. Navigate to the right `?tab=` first, and read
  "resolved to <button …> but not visible" as "wrong tab", not "wrong selector".
- **`input[type="date"]` matches at least twice** — the Body Weight tab renders
  one and it precedes the nutrition date-nav's in DOM order, so a bare
  selector silently reads the wrong field (its value looks plausible, which is
  what makes this expensive). Scope via a uniquely-labelled sibling:
  `document.querySelector('button[aria-label="Previous day"]').parentElement.querySelector('input[type="date"]')`.
- **`waitFor(page, predicate, opts)` takes no trailing args to forward into the
  predicate** (unlike Playwright's own `waitForFunction`). Passing a 4th
  argument is silently ignored and the predicate's parameter arrives
  `undefined` — which surfaces as a confusing timeout rather than an error.
  Close over the value or inline it in the predicate body.
- **The chat sheet's drag handle has no `onClick`.** `[aria-label="Expand AI
  chat"]` is a `role=button` div wired only to pointer events (the drag
  gesture) and an Enter/Space `onKeyDown`. A synthetic `.click()` or
  Playwright `.click()` therefore does nothing at all, the sheet never
  expands, and every selector for something inside the expanded header (the
  #297 Reconnect button, Clear, Collapse) times out looking like a wrong
  selector. Focus it and press Enter instead.
- **`page.mouse.click(x, y)` at an element's center is the right tool when
  the question is "can a user actually hit this".** `el.click()` bypasses hit
  testing and will succeed on an element something else covers, which is
  exactly the bug class the header buttons keep producing.
- The API routes require an `Authorization: Bearer <accessToken>` header —
  the refresh-token cookie alone (which is all the *browser* needs, since the
  React app exchanges it for an access token on load) is **not** accepted by
  `authenticateToken` in `routes/auth.ts`. `lib/browser.mjs` wires up both
  separately: cookie for the browser context, bearer header for the `api`
  request context used to seed/clean fixtures.

## Cleanup checklist after any verification session

- Delete ZZTEST fixtures (the API cascade above, or the direct SQL sweep).
- `docker compose down` — but **check first whether anything else is using it.**
  The compose project binds host port 3307, and a second Claude session or a
  sibling worktree may be pointed at that same container even though it has
  its own checkout (a worktree only gets its own compose project if it
  actually runs `docker compose` from its own directory — one that connects
  to 127.0.0.1:3307 is using YOURS). Tearing it down mid-session breaks their
  connections and surfaces as a confusing app-level error on their end, not
  an obvious "container is gone". `docker ps --format '{{.Names}}'` plus a
  quick ask beats an apology. Data is safe either way as long as you never
  pass `-v` — the volume is what makes the next boot fast.
- Kill any `node dist/index.js` / `vite` processes you started.
- Remove `client/.env.local` if you created it (gitignored, no repo impact,
  but no reason to leave stray files).
