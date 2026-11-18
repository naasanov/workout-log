---
name: assistant-proposal-confirm-paths
description: Which component confirms which assistant proposal; food proposals are not in MutationProposalCard
type: project
applies-to: client/src/features/agent/**, client/src/features/nutrition/**
---

Assistant proposals reach the database through client-side confirm handlers, and they are split by tool. `propose_mutation` (body weight, habits, sections, movements, variations, nutrition goals) renders `MutationProposalCard.tsx`. Food proposals (`propose_entry`) render `EntryEditor` in proposal mode through `ProposeEntryRenderer`, and `propose_custom_food` renders `MealBuilder` through `ProposeCustomFoodRenderer`, both in `client/src/features/nutrition/NutritionToolRenderers.tsx`. No `propose_mutation` type carries a food entry.

**Why:** issue #436 (double-tap Confirm logs a food twice) was first scoped to `MutationProposalCard.tsx`, which never touches food entries; review caught it and the fix had to be widened to the renderers and `EntryEditor`.

**How to apply:** for any "proposal Confirm" bug, trace the issue's repro to the tool name first. A confirm path needs a synchronous `useRef` in-flight lock (React state alone lets a fast second tap through), released only on failure. Other confirm-time checks, such as the 5000 kcal confirm (`entryKcalNeedsConfirm` in `ingredientMath.ts`), belong in `EntryEditor` so manual and proposal saves share them. See [[prefers-structural-fix-over-heuristic]].
