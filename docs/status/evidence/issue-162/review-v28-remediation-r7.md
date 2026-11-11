# PR #163 Contract v28 review remediation r7

The tested source tree was based on `ef0e8ab91edb84b38fb76eb99cf43f42a86afaa2` with the painted-clearance, E2E, evidence-index, and r7 capture changes in this review remediation.

## Review findings

- **A/P2 painted clearance:** adjacent marks are fitted using their type-specific minimum CSS gap, reserving the gap on both halves of the combined-width budget. The compact wave width falls back to its canonical `data-guide-wave-width` when a detached template path cannot provide a nonzero `getBBox()`. Impossible fixed-center pairs retain their SVG event and accessible name, shrink to nonoverlap where possible, and set an explicit blocked marker on each event and its lane.
- **B/P2 fixture provenance:** assertion messages now describe the v24 material as a reference-derived or illustrative fixture and keep the numeric sequence/Fraction checks without claiming exact source-image correspondence.
- **A/P1 full test gate:** full `npm test` remains **FAIL** and is not reported as a pass. It completed with 1,236 unit tests passing and 133 E2E tests passing, 6 pending, and 3 failures: the Issue #162 crossfade E2E timed out at 120 seconds, the Issue #162 400px lyric-fade E2E timed out at 90 seconds, and P136 reported a changed pre-existing tab inventory. The full-run focus trace shows the crossfade host lost window focus at 97,973ms. Both timeout cases pass when run individually; the crossfade focused run passed in 36.9 seconds and the lyric-fade focused run passed. The same-environment `npm test` baseline at `origin/main` `998c27b7197c0ed0f12864676aee7fccac02c48f` passed with 1,225 unit tests, 123 E2E tests, and 6 pending. The full-suite failures still need their cause resolved or explicitly waived before the test gate can be marked PASS.

## Current-HEAD checks and visual evidence

- PASS: `npm run compile:all` (also invoked by the focused E2E runs), `npm run check:help`, `npm run check:ai`, `git diff --check`, `validate-docs --issue 162`, and `verify-implementation-contract 162`.
- PASS: `Issue #162 compact strokes enforce painted clearances at 400px and 600px`; it starts with positive subminimum painted gaps and verifies wave/arrow ≥1 CSS px, wave/wave ≥0.25 CSS px, event/name retention, and explicit blocked state for impossible pairs.
- PASS: focused crossfade and lyric-fade E2Es.
- PASS: four screenshot-matrix runs produced 16 current-tree PNGs and 16 SHA-bound JSON sidecars for 400/600 CSS px × grid8/grid16 × JA/EN × Light/Dark. Their minimum painted wave/arrow clearance is 1.018px at 400px and 1.283px at 600px; every screenshot has four measure cards, complete chord diagrams, and the next-chord card. The current matrix is indexed in [README.md](README.md).

The corrected fixture still does not establish an exact mapping to the partial source crop. That claim remains **NOT RUN** under Contract v28.
