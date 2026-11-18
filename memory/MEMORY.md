# Memory Index

Version-controlled project memory, shared by interactive sessions and the factory pipeline. One line per entry: `- [Title](file.md) — hook`. Keep this file an index only; content lives in the entry files.

## Entry format

Each entry is one file in `memory/` holding one fact:

```markdown
---
name: <short-kebab-case-slug, matches the filename>
description: <one-line summary used to judge relevance>
type: feedback | project | reference
applies-to: <optional: comma-separated path globs, or all>
---

<the fact. For feedback/project entries, follow with **Why:** and **How to apply:** lines. Link related entries with [[their-name]].>
```

`applies-to` marks lessons tied to code: the factory build pipeline pastes every entry whose globs match a unit's files into that unit's agent briefs. Add it to any entry about how code in a specific area must be written or tested.

This repo is public: no secrets, emails, user data or private ops details. Personal working preferences belong in the user's own Claude memory, not here. Don't duplicate what `CLAUDE.md` or the code already says. Before adding an entry, check for one that covers it and update that instead. Delete entries that turn out to be wrong.

## Entries

- [Prefer structural fixes](prefers-structural-fix-over-heuristic.md) — one user action = one request; no server-side dedupe windows
- [Changelog on merge](changelog-on-merge.md) — ship the changelog entry with user-visible work, unasked
- [Impactful tech debt](tech-debt-should-be-impactful.md) — tech-debt picks must prevent real future problems
- [Assistant proposal confirm paths](assistant-proposal-confirm-paths.md) — food proposals confirm via EntryEditor, not MutationProposalCard
