---
name: tech-debt-should-be-impactful
description: The per-batch tech-debt pick must prevent a real future problem; medium refactors are in scope
type: feedback
applies-to: all
---

For the one tech-debt item every issue-orchestrator batch includes, pick something that
actually prevents a future problem. **Medium-sized refactors and migrations are explicitly in
scope.** Do not optimize the choice for small blast radius.

**Why:** the user said "I've seen this and the last couple sessions skip over impactful things
and go for smaller tech debt things for blast radius and such." Three consecutive batches
picked near-zero-risk sweeps (dead CRA test scaffolding, stray screenshots) while real
structural debt sat untouched.

**How to apply:** prefer the thing that will hurt later - a half-finished migration, a
duplicated abstraction drifting out of sync, a hand-maintained mirror that silently rots, a
test that hardcodes shared state and flakes under concurrency. Still require it to be
mechanical rather than an architecture decision, measurable before/after, and one coherent
sweep. Size it like real work for one agent, not a five-minute deletion. Known standing
candidates in workout-log: the ~44 remaining `.jsx`/`.js` files in `client/src` that never got
the TypeScript migration, and `tests/migrate.test.js` hardcoding the schema
`workout_log_test_migrate_scratch` instead of honoring `DB_NAME`, which makes it flake whenever
two sessions run tests at once.
