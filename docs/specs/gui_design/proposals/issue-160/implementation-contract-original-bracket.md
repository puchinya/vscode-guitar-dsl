# Issue #160 — Implementation Contract v2-B: Original, font-free score bracket

> 2026-10-30 user decision: Reject the earlier v2-A plan to reuse Bravura glyph contours. This amendment replaces only the bracket-shape and associated reference/test clauses of approved v2; all other v2 obligations continue. Repository approval must be renewed for the changed decisions.

## 1. Repository Baseline
- Issue #160; existing open PR #161 and branch `feature/160-standard-score-brace-connectors`. Do not open a new PR.
- `docs/specs/guitardsl-syntax.md` §11: `mel:` = vocal; rendered TAB/rhythm = guitar. Voice+guitar = outer bracket; guitar TAB+rhythm = brace; three staves = outer bracket plus inner brace.
- `src/render/svg.ts::renderStaffGroupConnector()` draws the pure decoration. `src/render/layout.ts::SystemGeometry` determines actual stave intervals, `src/render/notation.ts::measureBounds()` common measure x. Page/continuous Preview and PDF share the system SVG per `docs/design/preview-rendering-and-export.md`.
- Tests: `tests/unit/render-melody.test.ts`, `render-tab.test.ts`, `render-advanced.test.ts`, `tests/unit/fixtures/legacy-render-hashes.json`. Status: `docs/status/implementation-status.md`.

## 2. Architecture Decisions
- **Original artwork**: Create a conventional engraved bracket with a smooth, ascending flared upper terminal; vertically mirror it for the lower terminal. The curve is authored directly in SVG system units and must not be copied, traced or converted from any music font.
- Canonical cap: `M 0 0 L 3.5 0 C 7.2 -0.2 10.9 -1.8 13.4 -4.8 C 14.8 -6.5 15.5 -8.3 15.7 -10 C 15.75 -10.7 16.35 -10.7 16.4 -10 C 16.7 -6.1 14.8 -2.4 11.2 0.15 C 8.9 1.8 6.4 3 3.5 3.7 L 0 3.7 Z`.
- Draw top at `translate(x top)` with no scale; bottom at `translate(x bottom) scale(1 -1)`. Stem: filled `<rect>` width **3.5** and height `bottom-top`. Stem x=**6** for a standalone 2-staff bracket and x=**-23** for outer 3-staff bracket. Tip reaches local x≈16.7; clearance to standalone staff x=25 is ≥2.3 and nested guitar brace x=0 is ≥6.3.
- Keep exactly one left connector x=25 and the existing `measureBounds()`-based gap connectors. All parts remain in one `<g class="staff-group-connector" pointer-events="none">`; same render path for Preview and PDF.
- **No music-font glyphs or dependencies**: no new font files, font-loader, `@font-face`, `<text>` substitution, `<use>` reference, external URL, or copied Bravura SVG outlines. Existing unrelated UI fonts are out of scope.
- Reject the superseded Bravura U+E003/U+E004 v2-A outline and its original license/contract text. Preserve existing guitar-brace geometry, score layout, language syntax, editing and playback architecture.

## 3. Exact Change Set
- `src/render/svg.ts`: `STAFF_BRACKET_CAP_PATH` is the original curve above. Generate two paths and one fixed-width variable-height rect. No height-dependent cap scale or font-based identifiers.
- `docs/specs/gui_design/proposals/issue-160/staff-bracket-reference.svg` and `nested-staff-group-reference.svg`: update cap/rect to the same original geometry; retain inner guitar brace.
- `tests/unit/render-melody.test.ts` and `render-tab.test.ts`: verify canonical path, mirrored lower cap, no stretching, exact width/x, no font/reference tags and correct role matrix.
- Remove unused `docs/specs/gui_design/proposals/issue-160/BRAVURA-OFL.txt` and `implementation-contract-bravura-amendment.md`; replace with this v2-B amendment. Do not edit historical approval comments.
- Update `docs/specs/guitardsl-syntax.md` §11, `docs/design/preview-rendering-and-export.md`, `docs/status/implementation-status.md`; sync `ai/skills/guitardsl-language/references/guitardsl-syntax.md`, `docs/help/help-manifest.json` and only visually approved affected SVG regression hashes.

## 4. Implementation Sequence
1. Freeze original cap shape/positions and document amendments.
2. Replace renderer, both SVG design references and tests; remove rejected font-derived artifacts.
3. Synchronize spec/design/status/AI/Help; check and rebaseline only affected SVG snapshots.
4. Capture new actual VS Code Preview/PDF visual evidence at 1x/2x, 2-/3-staff and A5.
5. Refresh contract approval/binding, run all gates, update same PR #161 and exact-HEAD self-review.

## 5. Required Runtime Semantics
- Deterministic pure rendering: 2 caps, one stem per bracket; heights vary only in the stem. No reentrancy state, asynchronous jobs, resource ownership or cleanup needed.
- Single stave no group; voice+guitar outer bracket only; TAB+rhythm inner guitar brace only; all three nested. Existing music features, click targets, playback anchors and PDF invariants unchanged.
- No new assets loaded at runtime; reference SVGs are documentation, not an external resource dependency.

## 6. Non-goals / Forbidden Changes
- No copied font outlines, glyph conversions, music-font imports, UI font changes, new DSL syntax, score repositioning, whole-bracket stretching, new renderer, or redesign of the brace.

## 7. Concrete Tests
- T01 voice+rhythm: precisely 2 identical SVG cap paths and one 3.5-wide stem; top translate only, bottom Y-mirror, x=6; reference matches implementation.
- T02 voice+TAB+rhythm: x=-23 outer bracket, x=0..22 inner brace, shared x=25 line once, two gap connectors per measure boundary, no collision.
- T03 TAB+rhythm without voice: brace only; single-staff and lead-sheet: neither group symbol.
- T04 variable staff spacing: cap coordinates stay constant (no scale other than bottom reflection), stem length changes; 1x/2x renders look like conventional engraved brackets.
- T05 all variants: no `<text>`, `<use>`, font or external resource tags in connector; no new font files; PDF/A5/landscape/no clipping; repeat/TAB/lyrics/edit/playback preserved.
- T06 SVG baseline changes are limited to bracket geometry, reviewed before hash replacement; Help/AI specs synchronized.

## 8. Verification
- `npm run compile`; `npm run test:unit`; `npm run check:help`; `npm run check:ai`; `npm test`; `npm run vscode:prepublish`; `npx @vscode/vsce ls`; `git diff --check origin/main...HEAD`; contract approval verifier; GitHub `agent-required-check`.
- Record NOT RUN/unavailable platforms explicitly; do not claim an unexecuted gate as passing.

## 9. Reviewer Checklist
- [ ] R01 Original SVG Bézier shape, conventional engraved silhouette, no font-derived outline
- [ ] R02 Exactly 2 mirrored fixed-shape caps, 3.5-wide stem and fixed x values
- [ ] R03 No new font assets, loaders, `<text>`, `<use>` or external dependencies
- [ ] R04 Voice/guitar role matrix, inner guitar brace and nesting correct
- [ ] R05 Shared x=25 left connector and measure barlines, no overlaps/clipping
- [ ] R06 Real Preview/PDF evidence for 2-/3-staff, 1x/2x, A5
- [ ] R07 Unit/E2E/snapshot tests, source-reference parity and negative tests pass
- [ ] R08 Spec/design/status/Help/AI/fixtures consistent; superseded artifacts removed
- [ ] R09 Revised contract formally reapproved/rebound; exact-HEAD self-review
- [ ] R10 Same PR #161 pushed with `Closes #160`, review state and PR URL

## 10. Completion Report
- List files changed, commits, R01–R10 results, checks and their actual outcomes, new visual evidence, untested platforms/pending tests, contract deviations, exact HEAD, remaining work and PR URL `https://github.com/puchinya/vscode-guitar-dsl/pull/161`.
- **Blocked** rather than complete if approval/binding, required tests, screenshots or review transition is not finished.

> This document is an Implementation Contract. Do not redesign the architecture during implementation. If a requirement conflicts with repository reality or requires a material design change, do not silently choose an alternative. Report the exact conflict and continue only with independent valid work.
