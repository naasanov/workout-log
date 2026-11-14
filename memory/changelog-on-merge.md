---
name: changelog-on-merge
description: Update the in-app changelog whenever user-visible work merges; never wait to be asked
type: feedback
applies-to: client/src/**
---

When user-visible PRs merge to master in workout-log, update `client/src/config/changelog.js`
in the same batch and land it as its own small PR, without being asked. The repo's CLAUDE.md
documents the format rules (bullets written for users, `{ text, issues: [n] }` only when a PR
actually closed that issue, always a new later date); what this memory adds is that shipping
it is not optional and not a follow-up question.

**Why:** the user asked "you know to update the changelog when we merge right?" after a batch
where every PR was held unmerged. The header's unread dot only fires when
`LATEST_CHANGELOG_DATE` is newer than what a user last saw, so a missed or back-dated entry
notifies nobody and the work lands invisibly.

**How to apply:** after the user-visible PRs of a batch merge, write the bullets, open a
separate changelog PR, and say it is up. If merging is on hold, the changelog is blocked on the merge, not skipped: say so
explicitly in the batch summary so it is not forgotten.
