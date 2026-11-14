---
name: prefers-structural-fix-over-heuristic
description: Fix the structural cause (one user action = one request) over server-side time-window heuristics
type: feedback
applies-to: src/**, client/src/**
---

When offered a choice between a server-side coalescing/dedupe heuristic (e.g. "collapse
variation_history rows written within 2 minutes of each other") and a structural client-side
change that makes the wrong request impossible (weight + reps edit together as ONE form → one
PATCH → one history row), the user proposed and chose the structural fix — and declined the
server-side safety net on top of it.

**Why:** a time window silently merges genuinely distinct log events and hides the real problem;
making one user action produce one request means the data is right by construction.

**How to apply:** when triaging a "duplicate/spurious record" bug here, look first at whether the
UI is issuing multiple requests for what the user experiences as a single action, and propose that
fix first. Offer heuristics only as an explicitly-labelled fallback.
