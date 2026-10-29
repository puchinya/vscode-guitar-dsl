# Issue #160 — Bravura Bracket Implementation Contract Amendment (v2-A)

**Decision source:** User-requested change to match standard music-engraving bracket geometry, 2026-10-30. **Scope:** supersedes only the bracket geometry/shape rules of approved Implementation Contract v2, §2.3, §3 and the reference SVG tests that asserted the previous hand-drawn contour. All role classification, guitar brace geometry, common barlines, and no-new-DSL invariants remain authoritative. This amendment requires the repository's contract revision/approval procedure before PR acceptance; do not treat the historical v2 SHA as approval for these changed dimensions.

## 1. Repository Baseline
- Issue #160 / PR #161; previous implementation: `src/render/svg.ts::STAFF_BRACKET_PATH`, `renderStaffGroupConnector()`. Existing v2: `docs/specs/gui_design/proposals/issue-160/implementation-contract.md`.
- Bravura original glyphs: [bracketTop, U+E003](https://github.com/w3c-cg/smufl/blob/gh-pages/font/Bravura.ufo/glyphs/uniE_003.glif) and [bracketBottom, U+E004](https://github.com/w3c-cg/smufl/blob/gh-pages/font/Bravura.ufo/glyphs/uniE_004.glif); SMuFL [Staff brackets and dividers](https://smufl.formats.music/latest/tables/staff-brackets-and-dividers.html) recommends independent terminals and a variable-height stem.
- Bravura copyright Steinberg Media Technologies GmbH; SIL OFL 1.1. Include `docs/specs/gui_design/proposals/issue-160/BRAVURA-OFL.txt` with extracted glyph contours.

## 2. Architecture Decisions
- **Exact source contour**, not hand-approximated: the top terminal is the Bravura `uniE003` outline from the UFO source in its original 1000 design unit coordinates; the bottom is its strict vertical mirror (`uniE004` uses `yScale=-1`). Render SVG filled `<path>` elements with `scale(0.032,-0.032)` and `scale(0.032,0.032)` respectively.
- **Do not vertically stretch glyphs to full multi-staff height.** A separate filled `<rect>` connects terminals, width `125×0.032=4` system units, height `bottom-top` of actual outer staff lines. The top terminal anchor is at `top`, bottom terminal anchor at `bottom`; their designed tips extend 9.44 units beyond the outer lines.
- Positions in system local coordinates: standalone vocal+guitar bracket stem left `x=6`, nested three-staff outer bracket left `x=-23`. Bravura terminal extends `469×0.032=15.008` units right. Thus clearance to staff x=25 is ≈3.992 (standalone) and to nested guitar brace x=0 is ≈7.992. The left connector remains at x=25 and is emitted once.
- Reflected glyphs, rectangle and existing guitar brace all remain in a **single noninteractive** `staff-group-connector` SVG group. Avoid nested `<g>` wrappers that would interfere with the current `staffGroupConnectors()` test helper. Maintain `pointer-events="none"`.
- Preserve `SystemGeometry`, `measureBounds()`, all staff/body geometry, `annotationTop-lift`, Preview/PDF shared SVG, audio/edit source binding, and existing guitar brace shape. No additional fonts loaded at runtime: extracted vector contours remain in SVG output.

## 3. Exact Change Set / Implementation Sequence
1. In `src/render/svg.ts`, replace `STAFF_BRACKET_PATH` and its stretched `scale(1,Y)` with `STAFF_BRACKET_TERMINAL_PATH`, fixed `STAFF_BRACKET_TERMINAL_SCALE=0.032`, `STAFF_BRACKET_STEM_WIDTH=4`, and `staff-bracket`/ `staff-bracket-bottom`/ `staff-bracket-stem` elements. Ensure `fmt(...,5)` preserves exactly `0.032`.
2. Update `staff-bracket-reference.svg` and `nested-staff-group-reference.svg` with the same contours, anchors and rectangle; retain the guitar brace unmodified. Add Bravura OFL text and precise attribution.
3. Update `tests/unit/render-melody.test.ts`, `tests/unit/render-tab.test.ts` to assert both original contours, mirroring, fixed scale, position, stem thickness, 2- and 3-staff behavior, and single staff suppression.
4. Update §11 syntax spec, preview design, status, generated AI syntax reference, Help reviewed section digest. Review and regenerate *only* affected legacy SVG hashes after reviewing why they changed.
5. Capture actual 2-staff and nested 3-staff Preview (Light/Dark) at 1x/2x, page, continuous and PDF, including A5 margin, and add evidence to Issue. Do not confuse design SVG with actual runtime screenshot.
6. Run verification, refresh approval/binding, commit/push to the **same PR #161**, refresh exact-HEAD self-review and completion report.

## 4. Runtime Semantics
- No asynchronous state, no extra ownership or cleanup. Same document renders deterministically; re-rendering does not accumulate symbols.
- Every outer bracket is made of exactly 2 terminal paths and 1 rectangular stem, maintaining constant terminal proportions across any number of staves; exactly one x=25 left line and `measureBounds()`-based gap connectors remain.
- Repeat, volta, TAB technique, tie, edit hit-targets, playback anchors, page sizing and lyric lanes are unchanged. One staff generates no group symbol.

## 5. Non-goals / Rejected Alternatives
- Font dependency, regular text `[`, hand-drawn hooks, whole-bracket height stretch, horizontal squeezing to preserve x=11/-12, moving the score to fit, redesigning the brace or playing/compiling DSL.
- Existing v2 positional values x=11/-12 and stem width1.6 are **explicitly superseded**; no implementer discretion to choose different values without renewed design approval.

## 6. Concrete Tests
- T01 vocal+rhythm: bracket terminal path exactly matches source UFO outline and reference; top/bottom are mirrored without vertical scale change, stem=4, x=6, no brace.
- T02 vocal+TAB+rhythm: outer bracket x=-23, inner guitar brace x=0..22; no overlaps, two gaps per common measure boundary; x=25 connector once.
- T03 2/3 systems at different staff distances: inspect `scale(0.032 ±0.032)` fixed; only rectangle height changes. Include explicit non-rounding assertion and compare Bravura terminal shape at 1x and 2x.
- T04 single-staff, TAB implicit rhythm, verse count, pagebreak/landscape/A5, repeat/tie: no classification or coordinate regression.
- T05 Preview and PDF share the same SVG; screenshot each combination and inspect no clipping in left page margin.
- T06 historical hash diffs must be limited to authorized bracket geometry; record exact changed fixture keys, reapprove baseline before changing it.

## 7. Verification
`npm run compile`; `npm run test:unit`; `npm run check:help`; `npm run check:ai`; `npm test` (VS Code E2E outside sandbox per `docs/agents/testing.md`); `npm run vscode:prepublish`; `npx @vscode/vsce ls`; `git diff --check`; contract binding/approval verifier; `agent-required-check`. Record unavailable platforms as NOT RUN.

## 8. Reviewer Checklist
- [ ] R01 Exact Bravura bracketTop and mirrored bracketBottom shapes verified against source, license included
- [ ] R02 Original glyph ratios never distorted; SVG scale retains 0.032 without rounding
- [ ] R03 Stem fixed width 4, adjustable height, seamless terminal junction
- [ ] R04 Standalone x=6, nested x=-23, no staff/brace overlap, no A5 clipping
- [ ] R05 Role matrix, brace geometry, x=25 barline and gap connectors unchanged
- [ ] R06 Source-binding, Preview/PDF, playback, tabs, repeats and lyrics regressions pass
- [ ] R07 Reference SVGs match code; runtime screenshots independently inspected
- [ ] R08 Docs/Help/AI, updated fixture hashes and full verify pass on exact HEAD
- [ ] R09 Contract revision approval/binding is refreshed, not faked
- [ ] R10 Commit, push, same PR #161 with Closes #160, review phase and final URL

## 9. Completion Report
Report changed paths, R01–R10, command results, exact HEAD/CI, screenshots, unverified OS/E2E, contract deltas/conflicts and **https://github.com/puchinya/vscode-guitar-dsl/pull/161**. If required binding, checks or evidence cannot be completed, report **BLOCKED**, not completed.

> This document is an Implementation Contract. Do not redesign the architecture during implementation. If a requirement conflicts with repository reality or requires a material design change, do not silently choose an alternative. Report the exact conflict and continue only with independent valid work.
