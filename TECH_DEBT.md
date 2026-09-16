# Tech Debt Triage

A running list of **medium-to-large** tech debt found while working in this codebase. Tiny
cleanups (a stray file, a lint warning, dead code) do not belong here; fix those in passing or
take them as an issue-orchestrator batch's one tech-debt item.

**Nothing here gets implemented without the repo owner signing off first.** This is a triage
list, not a work queue. An entry earns its place by being written down and argued for, not by
being started.

Entries do not have to match how the codebase does things today. "Stop hand-rolling this and
adopt a library" is exactly the kind of idea this file is for.

## How to add an entry

When you discover something while planning or building a feature, append it with:

- **What** the debt is, concretely, with `path:line` where it helps.
- **Why it will hurt** — the future failure it causes, not a style preference.
- **Size** — S / M / L, as work for one agent.
- **Risk** — what could break, honestly. Deploy-path changes rank highest.
- **Status** — `proposed` / `approved` / `in progress` / `done` / `rejected (why)`.

---

## 1. Migrate from npm to pnpm

**Status:** proposed (owner's idea, 2026-09-15) · **Size:** M · **Risk:** Medium-high (deploy path)

**What.** Replace npm with pnpm in both the root server project and `client/`.

**Why it will hurt / what it fixes.** The immediate driver is agent worktrees. A fresh worktree
has no `node_modules`, and npm's cost to populate one is high enough that agents skip it. That
is not hypothetical: in the 2026-09-15 batch all four agents reported `npm run verify` green
while their worktrees had no `node_modules` at all. `tsgo` resolved via npm's PATH walk-up to
the main checkout, so the server typecheck appeared to pass, while client type declarations
were never resolvable. **The failure was silent, and it made four agent self-reports partly
hollow.** pnpm's content-addressable store means a per-worktree `node_modules` is hardlinks
into a shared store rather than a full copy, so "always install in the worktree" becomes cheap
enough to be the default.

Secondary wins: faster installs generally, and pnpm's non-hoisted layout surfaces phantom
dependencies (packages imported but never declared) that npm's flat tree hides.

**Risk, honestly.**
- **Heroku is the real risk.** Deploys run `heroku-postbuild` (`npm run build && cd client && npm install && npm run build`) plus a `release:` migration phase. Heroku's Node buildpack does detect `pnpm-lock.yaml`, but this is the deploy path, and a mistake here fails the deploy rather than a test. Validate on a staging app or a review app before master.
- **The two projects are deliberately separate** (root and `client/` have their own `package.json`, `node_modules`, and independent Heroku install). Converting them into a pnpm workspace is a bigger change than switching package managers and would rewrite how the client gets installed. Prefer pnpm-in-each-project first; treat the workspace as a separate decision.
- **Non-hoisted layout can break phantom-dependency consumers.** The tree here is large (recharts, zxing, the AI SDK). Escape hatch is `node-linker=hoisted`, but that forfeits much of the benefit, so reach for it only with a named offender.
- Two lockfiles change format (`package-lock.json` → `pnpm-lock.yaml`).

**Cheaper alternative worth weighing first.** Requiring `npm install` in every agent brief, or
having worktree creation run it, fixes the silent-failure problem at near-zero risk. pnpm is
the better end state; it is not the only fix for the symptom that prompted it.

## 2. Finish the client TypeScript migration

**Status:** proposed · **Size:** L (splittable) · **Risk:** Low

**What.** `client/src` is roughly half migrated: ~44 `.jsx`/`.js` files against ~42 `.tsx`/`.ts`.
Untyped holdouts include load-bearing ones: `App.jsx`, `pages/Workouts.jsx`,
`context/UserProvider.jsx`, `components/Header.jsx`, `components/Modal.jsx`,
`components/HabitTracker.jsx`, `components/Editable.jsx`.

**Why it will hurt.** Every feature touching these files gets no type checking, and
`vite build` transpiles per file without cross-file checking, so nothing catches the gap. It
also halves the value of any editor tooling (see the LSP discussion, 2026-09-15). The boundary
between typed and untyped code is where the hand-maintained mirrors in item 3 leak.

**Risk.** Low and incremental. Split by directory (`components/`, then `pages/`, then
`context/` + `hooks/`) so each sweep is one agent's work with a citable before/after count.
Rule: no `any` added to make a file compile.

## 3. Stop hand-maintaining client copies of server types

**Status:** proposed · **Size:** M · **Risk:** Low-medium

**What.** `client/src/features/nutrition/types.ts` and
`client/src/features/adminUsage/types.ts` are hand-written mirrors of server shapes
(`schemas/nutrition.ts`, `getOwnerUsageReport` in `services/nutrition/usage.ts`). Both say so in
a comment and rely on a human keeping them in sync.

**Why it will hurt.** They drift silently — nothing fails when they disagree, because the
boundary is HTTP. Adding one optional field to a propose tool in the 2026-09-15 batch required
editing the schema and hand-editing the mirror; a missed mirror edit is a runtime bug that
typechecks clean on both sides.

**Options.** Generate client types from the Zod schemas (the server already owns them), or
extract a small shared types module both projects import. Generation is likely simpler given
the two projects install independently.

## 4. Replace hand-rolled UI primitives with a component library

**Status:** proposed (owner's idea, 2026-09-15) · **Size:** L · **Risk:** Medium (visual regressions)

**What.** The app hand-rolls primitives that a library solves better:
`components/Editable.jsx`, `Modal.jsx`, `ConfirmModal.jsx`, `DateInput.jsx`,
`CollapseButton.jsx`, `TabsEmptyState.jsx`.

**Why it will hurt.** These carry accessibility and interaction bugs that keep surfacing as
individual issues rather than being fixed once. Known sharp edges already documented in
`.claude/skills/browser-verify/SKILL.md`: `[role=dialog]` matches the nav drawer as well as
real modals; `Editable` renders a `<span>` until clicked, so it is neither an input nor
announced as editable; two `BarcodeScanner` instances shadow each other and one is inert but
still clickable via script.

**Note.** Radix is already a dependency (`vendor-radix` in the build output), so part of this is
adopting what is there rather than introducing something new. Do the audit before picking a
library.

**Risk.** Visual and behavioral regressions across the whole app. Needs runtime verification per
migrated primitive, not just a green build. Migrate one primitive per PR.

## 5. Dependency vulnerability backlog

**Status:** proposed · **Size:** M · **Risk:** Medium (breaking major bumps)

**What.** GitHub reports **83 vulnerabilities on master (1 critical, 40 high, 37 moderate, 5
low)**, surfaced on every push. See the repo's Dependabot alerts.

**Why it will hurt.** The signal is already being ignored because it is noise at this volume,
which is exactly how a real critical gets missed. It is also a deploy-blocking surprise waiting
to happen if a transitive dep is yanked.

**Approach.** Triage into: actually reachable from server code, client-only/build-time, and
dev-only. Fix reachable ones first. Expect some to need major version bumps, which is where the
breakage risk is.

---

## Smaller, but recurring enough to be worth naming

These are below the bar above, but they cost real time repeatedly.

- **`tests/migrate.test.js` hardcodes the schema `workout_log_test_migrate_scratch`** instead of
  honoring `DB_NAME`, so it collides whenever two sessions run tests against the shared dev
  MySQL container. On 2026-09-15 this produced phantom failures for four agents at once, and at
  least one responded with a broad `pkill -f "node --test"` that may have killed another
  session's legitimate run. Make it derive its scratch schema from `DB_NAME`.
- **`chat_messages.interrupted` is written but never read during replay.**
  `store.markInterrupted` sets it, and nothing in `services/agent/history.ts` or
  `services/agent/index.ts` consults it when rebuilding history. Noticed while diagnosing #355;
  not the cause there, but a flag that exists and is never checked is either dead or a latent
  bug.
- **Disconnect detection matches on browser error-message strings**
  (`client/src/features/agent/ErrorBubble.tsx`: `'load failed'`, `'network error'`,
  `'failed to fetch'`, `'aborted'`). Brittle across browser versions and locales; a miss shows
  users a scary error bubble for an ordinary navigation-away.
