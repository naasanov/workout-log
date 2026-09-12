# workout-log

Express + TypeScript + MySQL server at the repo root, React + Vite client under `client/`.
They are **separate npm projects**: the client has its own `package.json` and `node_modules`,
and Heroku installs it independently (`heroku-postbuild`).

## Validating a change

Always use these scripts rather than invoking the underlying tools by hand. They exist
because the hand-rolled equivalents are several times slower.

| Command | What it does |
|---|---|
| `npm run typecheck` | Server types, via `tsgo` |
| `npm run typecheck:client` | Client types, via `tsgo` (delegates into `client/`) |
| `npm test` | Full server suite, ~500 tests |
| `npm run test:file tests/foo.test.js` | One test file, the usual inner loop |
| `npm run verify` | Both typechecks plus the full suite; the pre-commit gate |

**Use `tsgo`, not `tsc`, for type checking.** It comes from the `@typescript/native-preview`
dependency and is roughly 2x faster on the server and 6x on the client. `npm run build` still
uses `tsc`, because that one emits the deployed JavaScript and swapping the emitting compiler
is a different risk from swapping a checker that only reports.

`vite build` transpiles per file and does **not** check types across files, so a green client
build proves imports resolve, not that types line up. Run `npm run typecheck:client` too.

## Tests

`node:test`, no framework. Server tests live in `tests/`; `scripts/*.test.js` are pure unit
tests needing no database.

DB-backed tests run against a dedicated schema on the dev MySQL container, created and
migrated automatically by `scripts/testDb.js`. Start the database first:

```
docker compose up -d
```

Without it, DB-backed tests **skip** rather than fail, so `npm test` still passes.

Two things to know before writing tests:

- **`DB_NAME` must contain `_test`.** The harness refuses anything else, because `resetDb()`
  empties every table. To run concurrently with someone else, take your own schema:
  `DB_NAME=workout_log_test_mine npm run test:file tests/foo.test.js`.
- **`resetDb()` uses `DELETE`, not `TRUNCATE`**, so `AUTO_INCREMENT` is not reset and ids
  climb across tests within a file. Never assert a literal id value.

Test files share one schema and empty it between tests, which is why `npm test` passes
`--test-concurrency=1`. Leave that flag alone.

Do not mock `pool.query` in tests that cover SQL. Most of these are characterization tests
guarding a refactor, and a mock only asserts the query string was retyped identically.

## Conventions that bite

- **Ownership scoping.** Every query is scoped by `user_uuid`, and a resource belonging to
  another user returns **404, not 403**, so ids stay unenumerable. Only `sections` carries
  `user_uuid` in the workouts tree; movements and variations reach it by joining up through
  sections, via the `ownsSection` / `ownsMovement` / `ownsVariation` helpers.
- **The authenticated user is `res.locals.user`**, not `req.user`.
- **Date column types differ.** `body_weight.date`, `variations.date`, and
  `variation_history.date` are `DATETIME`; `food_entries.date` and `habit_tallies.date` are
  `DATE`. A bare `YYYY-MM-DD` upper bound against a `DATETIME` column must resolve to the
  start of the next day compared with `<`, or it silently drops that whole day. See
  `resolveTo` in `services/bodyWeight/store.ts`.
- **`habit_tallies` joins the habits registry by `habit_name`, not id**, and tallies can
  exist for names with no registry row.
- **Migrations** are applied by `scripts/migrate.js` and tracked in `schema_migrations`.
  Errors 1050 and 1060 are tolerated so re-runs are safe. It runs in Heroku's release phase,
  so a failing migration blocks the deploy by design.
- **Font-family and letter-spacing are global** (`body` in `client/src/styles/index.css`);
  don't set them in component styles except a deliberate override. `scripts/typography.test.js`
  enforces it. Font sizes are still set per component.

## Changelog

The in-app What's New list is `client/src/config/changelog.js`, maintained by hand. **When a
user-visible change merges to master, add it there** in the same batch; nothing generates it.

- Write bullets for users, not PR titles. Refactors, chores, tests, and dev tooling stay out.
- Tag a bullet `{ text, issues: [n] }` only when a PR actually **closed** that issue. A PR that only
  references an issue, or a fix that leaves the issue open, gets an untagged string, because the tag
  badges the bullet for whoever filed that issue.
- Ship new bullets under a **new, later date**, never appended to an existing entry. The header's
  unread dot fires only when `LATEST_CHANGELOG_DATE` is later than the date a user last saw
  (`client/src/components/Header.jsx`), so bullets added under an old date notify nobody.

## The agent

`services/agent/` holds the AI chat. Its system prompt is assembled in **stability order**:
stable core, then stable per-domain sections, then volatile context last. The prompt and tool
schemas occupy the request's cacheable prefix, so volatile text placed ahead of stable text
invalidates the cache for everything after it. Do not reorder it for readability.

The agent **never writes to the database**. It calls a `propose_*` tool that validates and
echoes its arguments; the user confirms in the UI and the client performs the write.
