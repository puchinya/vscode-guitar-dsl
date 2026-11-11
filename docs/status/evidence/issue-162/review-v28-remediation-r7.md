# PR #163 Contract v28 review remediation r7

The painted-clearance implementation and regression test were committed and pushed as `e9c5538d230c695a1f4f34dabbec454eafd75dff`. The successful full-suite rerun below used that exact source/test HEAD; this note and the evidence index are documentation-only follow-up changes.

## Review findings

- **A/P2 painted clearance:** adjacent marks are fitted using their type-specific minimum CSS gap, reserving the gap on both halves of the combined-width budget. The compact wave width falls back to its canonical `data-guide-wave-width` when a detached template path cannot provide a nonzero `getBBox()`. Impossible fixed-center pairs retain their SVG event and accessible name, shrink to nonoverlap where possible, and set an explicit blocked marker on each event and its lane.
- **B/P2 fixture provenance:** assertion messages now describe the v24 material as a reference-derived or illustrative fixture and keep the numeric sequence/Fraction checks without claiming exact source-image correspondence.
- **A/P1 full test gate:** full `npm test` passed on the post-push source HEAD `e9c5538d230c695a1f4f34dabbec454eafd75dff`: 1,236 unit tests, 136 E2E tests, 6 pending, 0 failures; the E2E host exited with code 0. An earlier same-source full run reported 1,236 unit / 133 E2E passing, 6 pending, and three failures (the crossfade timeout at 120 seconds, 400px lyric-fade timeout at 90 seconds, and P136 changed-tab-order assertion). The later full rerun passed all three affected tests; the earlier intermittent failure cause remains undetermined and is not presented as fixed. Both timeout tests also pass individually. The same-environment `origin/main` baseline `998c27b7197c0ed0f12864676aee7fccac02c48f` passed with 1,225 unit tests, 123 E2E tests, and 6 pending.

## Current-HEAD checks and visual evidence

- PASS: `npm run compile:all` (also invoked by the focused E2E runs), `npm run check:help`, `npm run check:ai`, `git diff --check`, `validate-docs --issue 162`, and `verify-implementation-contract 162`.
- PASS: `Issue #162 compact strokes enforce painted clearances at 400px and 600px`; it starts with positive subminimum painted gaps and verifies wave/arrow ≥1 CSS px, wave/wave ≥0.25 CSS px, event/name retention, and explicit blocked state for impossible pairs.
- PASS: focused crossfade and lyric-fade E2Es.
- PASS: four screenshot-matrix runs produced 16 current-tree PNGs and 16 SHA-bound JSON sidecars for 400/600 CSS px × grid8/grid16 × JA/EN × Light/Dark. Their minimum painted wave/arrow clearance is 1.018px at 400px and 1.283px at 600px; every screenshot has four measure cards, complete chord diagrams, and the next-chord card. The current matrix is indexed in [README.md](README.md).

The corrected fixture still does not establish an exact mapping to the partial source crop. That claim remains **NOT RUN** under Contract v28.
