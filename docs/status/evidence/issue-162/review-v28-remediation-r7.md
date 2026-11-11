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

## Follow-up to review #5866486811

Verification was rerun at PR source/test HEAD `35eb30c9655671696f55e5d4a55534f31d4c6996` on macOS 25.6.0 arm64, Node 26.7.0, VS Code 1.146.0.

- **PASS — configured `verify_final`:** `python3 -m agent_workflow run-hook verify_final` completed with four project commands and `returncode: 0` for each: `npm run compile`, `npm test`, `npm run vscode:prepublish`, and `npx @vscode/vsce ls`.
- **PASS — package contents:** `npx @vscode/vsce ls` exited 0 and listed 1,607 files. All 20 required Help, AI reference, Audio MIR runtime/WASM, notices, and curated sample paths were present; none of the prohibited development paths, source/test/docs/scripts/Rust trees, `.ts`, or `.map` files were present. Captured listing: `/private/tmp/issue162-vsce-ls-35eb30c.txt`.
- **PASS — full E2E stability:** `env -u ELECTRON_RUN_AS_NODE -u NODE_OPTIONS npm run verify:e2e-stability -- --runs 5` passed 5/5 independent fresh-process/fresh-profile runs. Every run reported 136 passing and 6 pending; durations were 195.4s, 191.3s, 193.0s, 186.8s, and 188.2s. Commit recorded by the runner: `35eb30c9655671696f55e5d4a55534f31d4c6996`. No retries were performed.
- **PASS — focused stability:** the testing.md series `--runs 3 --grep 'P136 Preview|ED-05|ED-01/ED-02 CodeLens opens the Inspector'` passed 3/3; each fresh profile ran 3 tests, 0 pending, with durations 9.1s, 9.0s, and 8.9s.
- **Cause classification:** the earlier same-source full run's crossfade timeout, lyric-fade timeout, and PB05/P136 tab-order failure did not recur in the five-run series or the focused series. Their original cause remains **undetermined**; this evidence establishes current non-reproduction, not a root-cause fix.

The r7 screenshot/source-crop fidelity claim remains **NOT RUN** under Contract v28. The current stability and package checks do not change that scope.
