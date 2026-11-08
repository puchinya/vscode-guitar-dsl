# Implementation Contract v24 Delta — 参考画像からのストローク図形トレース

- Repository: `puchinya/vscode-guitar-dsl`
- Issue: [#162](https://github.com/puchinya/vscode-guitar-dsl/issues/162)
- Existing PR: [#163](https://github.com/puchinya/vscode-guitar-dsl/pull/163)
- Inspection basis: renderer HEAD `4db34769faca193ed792bd7e68fd64352b5ad63a` (canonical Contract v22); subsequent documentation-only v23 HEAD `e78c73b372ca96aed4514854ca18141fe9a22994`.
- Current canonical v22: [Issue comment 6714560967](https://github.com/puchinya/vscode-guitar-dsl/issues/162#issuecomment-6714560967).
- Superseded visual specimen: v23 `practice-stroke-8beat-16beat-svg-spec-v23.svg`, which was **not** faithfully aligned with the two user screenshots; do not use it as a visual-acceptance target.
- **Authoritative new visual references** (original SVG source, manually traced from the user-supplied screenshots):
  - `docs/status/evidence/issue-162/stroke-reference-trace-8beat-v24.svg` — original **8-beat** screenshot scale, 1500px, four measure groups.
  - `docs/status/evidence/issue-162/stroke-reference-trace-16beat-v24.svg` — corrected **16-beat** screenshot scale, 1634px, four measure groups.
- Verification image (not a substitute for SVG sources): `issue162-stroke-reference-v24-comparison.png`, comparing the actual reference glyph-row crops and new SVG glyph-row crops.
- This is a **visual shape change**, not a change to the musical event sequence. The SVG sample arrows/waves are manually traced demonstration marks only. Code, chord diagram fingerings and song playback order remain sourced from GuitarDSL.

> This document is an Implementation Contract. Do not redesign the architecture during implementation. If a requirement conflicts with repository reality or requires a material design change, do not silently choose an alternative. Report the exact conflict and continue only with independent valid work.

## 1. Repository Baseline

- `src/render/practiceGuideStrokeSvg.ts::PRACTICE_GUIDE_COMPACT_PATHS` holds `downShaft`, `downHead`, `upShaft`, `upHead` in a **4×30** icon and `grid16Wave*` in a 5.6×30 master. The v23 proposed head is a small filled triangle within that 4×30 region; even after filling it, the rendered arrow was substantially shorter/thinner than the native reference.
- `src/render/practiceGuideStrokeSvg.ts::compactAttackPath`, `::renderPracticeGuideCompactWavePathSvg`, `::renderPracticeGuideCompactStrokeSvgElement` own SVG mark shapes.
- `src/render/previewHtml.ts::computePracticeGuideCompactLayout`, `::layoutPracticeGuideCompactSvg`, `::groupCompactTechniquePainters` own per-slot geometry, wave/attack/PM painter order, both-bank sync, and line heights.
- Contract v22 requires four compact measures, next chord, current color semantics, source Fraction/ARIA identities, **painted wave-to-attack clearance ≥3 CSS px** and **painted technique-to-chord-name clearance ≥10 CSS px** at the tested widths. These remain constraints.
- `tests/e2e/extension.test.ts`, `tests/unit/practiceGuideStrokeSvg.test.ts` cover compact symbol paths and reported bounds. Existing source code and tests were not changed by v23 documentation commits.
- **Visual cause:** older v23 preview used very small 4×30 SVG arrow geometry and invented equally paced patterns; its chord diagram approximation also changed the overall visual impression. The actual references use approximately **47px tall arrows with solid triangular tips about 15px wide**, short centered `~` marks about **15px wide**, and different 8/16-beat mark placement. The trace SVGs explicitly record the placements observed in the screenshots.

## 2. Architecture Decisions

**Decision:** v24's manually screenshot-traced SVG mark silhouettes replace **v23's incorrect visual targets**, without discarding v22's timing/layout/spacing architecture. The **reference-native** SVG and the **responsive compact** presentation must be treated separately; do not pretend that 1634px of screenshot can be reproduced at 400px without horizontal compression.

### 2.1 Exact reference-native master geometry

Coordinate system **15×47**, color `currentColor` (default black), filled heads, no text arrows or font wave. Master paths in both v24 files:

```svg
<!-- DOWN: shaft + filled head -->
<path d="M0 0 V31" fill="none" stroke="currentColor" stroke-width="2.65" stroke-linecap="butt" />
<path d="M-7.5 30 L7.5 30 L0 47 Z" fill="currentColor" stroke="none" />

<!-- UP: shaft + filled head -->
<path d="M0 47 V17" fill="none" stroke="currentColor" stroke-width="2.65" stroke-linecap="butt" />
<path d="M-7.5 17 L0 0 L7.5 17 Z" fill="currentColor" stroke="none" />

<!-- WAVE: draw at y = 21 relative to the arrow's y top -->
<path d="M0 0 C3.2 -3.35 5.2 -3.35 7.5 0 S12.4 3.35 15 0"
      fill="none" stroke="currentColor" stroke-width="2.35" stroke-linecap="round" />
```

- The downward arrow starts y=0 and its tip ends y=47; upward arrow is exactly its directional inverse.
- The short wave is placed at **y=21** relative to the arrow top, i.e. through the middle of the arrow shafts, not floating near the arrow tips or above the stroke row.
- Each filled triangle is **15 units wide** and **17 units high**. Do not approximate it with the previous thin-V head.
- Use one canonical master for 8-beat and 16-beat; density affects horizontal placement, not the **reference-native silhouette**.
- No additional stylization, Gaussian blur, shadow, round cap on shafts or bezier reshaping outside this fixed geometry.

### 2.2 Reference positions and pattern order

The **first** user screenshot is 8-beat; the **corrected second** screenshot is 16-beat. Do not confuse them.

- 8-beat screenshot: first measure has **D, W, D, U, W, U, D, U** at approximate original-image x values **52, 92, 133, 173, 219, 260, 299, 339**. Arrow y=83, wave y=104. The complete four-group positions are in the 8-beat SVG file; do not replace them with an arbitrary `D W D W ...` pattern.
- 16-beat screenshot: first measure has **D, W, D, W, D, W, D, U, D, U, D, W, D, W, D, U** at approximate original-image x values **55, 75, 94, 113, 132, 151, 170, 189, 226, 245, 264, 283, 302, 321, 340, 359**. Arrow y=101, wave y=122. Complete four-group positions are in the 16-beat SVG file.
- The pixels above are **manual visual trace positions**, not DSL beats/fractions. For runtime, derive each displayed mark from the current model's event Fraction, preserving the actual rhythmic content. The v24 example sequences are *visual acceptance fixtures only*.
- The SVGs include illustrative chord names and chord diagrams to make visual comparison easier, but these demonstrations **do not define actual guitar fingerings**. Preserve the application's current chord/voicing data.

### 2.3 Responsive translation to compact 400px

A reference screenshot gives roughly 375–400px for **one measure**, whereas this app shows **four measures in 400px total**, i.e. ≈100px per measure. It is mathematically impossible to retain all reference-native 15px-wide arrowheads/waves and 3px gaps for all 16 positions in each 100px measure.

Therefore:

1. Adopt the exact **silhouettes and their vertical ratios** from §2.1 as new sources of truth. A compact rendering may horizontally compress each glyph to fit; it must **not compress the 47-unit vertical shape into a dot**. Keep painter order `waves → attacks → pm`.
2. Keep the v22 Fraction→x mapping for runtime events, the wave placement/packing policy and the 3px painted clearance test. Do not silently drop the clearance test to achieve reference-native proportions at 400px.
3. Increase or offset the compact technique lane **consistently across both banks/all four cards** to fit the reference-height arrow and the current PM/lane padding; derive `laneHeights`/`laneTops` from its true painted bounds and keep the 20px v22 reserved technique→chord gutter and ≥10px painted clearance. The chord diagrams must remain wholly visible.
4. The **native trace SVGs**, not horizontal squashed 400px examples, are the visual contract for the figure silhouette. The compact runtime is the correct responsive interpretation under v22 constraints. Do **not** claim a pixel-perfect 400px copy of the native screenshot.
5. Do not hard-code the visual example's C/G/B/Am/Em7 or F/C/Dm7/E7/Am7 event sequences into the app. All attack/continuation counts, Fractions, repeat/volta, color and ARIA come from GuitarDSL.

**Rejected alternative:** forcing 15px arrowheads+wave on a 6px-wide 16th cell, making the 400px UI overlap illegibly; changing rhythm timings; reducing four measures to one; using text glyphs/emoji for arrows; preserving the v23 preview as authoritative despite its visible mismatch.

## 3. Exact Change Set

1. `src/render/practiceGuideStrokeSvg.ts`: add one shared set of fixed **reference-native 15×47** down/up/wave paths. Remove the v23 thin 4×30 as the **normative shape**, while keeping compatibility of the existing compact renderer function names and `data-*` attributes. Head and shaft are separate paths with the exact fills/strokes in §2.1.
2. `src/render/previewHtml.ts::renderPracticeGuidePanel`: consume the new master shapes for compact attacks and waves; convert the wave geometry to a 15×47 viewBox aligned at y=21. No font fallback for waves. Preserve `role`, title, event key, Fraction and selection color.
3. `src/render/previewHtml.ts::{computePracticeGuideCompactLayout,layoutPracticeGuideCompactSvg}`: map event Fraction to x as before, perform horizontal responsive fit as described in §2.3, preserve original vertical silhouette, and recompute technique/PM/lane heights from new geometry in both template/live banks. Sync actual path, viewBox, width, painter group and state in an idempotent way.
4. `tests/unit/practiceGuideStrokeSvg.test.ts` and `tests/e2e/extension.test.ts`: replace old 4×30 head assertions with the four exact arrow head/shaft `d` paths and 15×47 master wave. Assert reference-native figure dimensions separately from 400px responsive bounds.
5. `docs/specs/gui_design.md`, `docs/specs/extension.md`, `docs/design/preview-rendering-and-export.md`, English/Japanese Help and status/evidence README: update **only** the affected compact symbol geometry semantics, preserve unrelated v22 rules. Mark v23 preview as superseded, not as approved matching evidence.

## 4. Implementation Sequence

1. Record v24 as canonical Issue #162 adoption, explicitly superseding v23 visual specimen; leave v22 architectural constraints intact.
2. Commit the two v24 **native trace SVG files** and this contract; retain original v23 artifacts as rejected/historical, not active acceptance examples.
3. Implement the 15×47 filled head and wave masters in `practiceGuideStrokeSvg.ts`.
4. Adjust `previewHtml.ts` compact viewBox/height/sync/lane layout (without music timing redesign).
5. Update unit tests, then E2E, then create real Preview screenshots for 8/16 on 400/600px in JA/EN Light/Dark.
6. Compare figure silhouette with the v24 reference trace and the two original screenshots; verify both model semantics and native-vs-compact constraints.
7. Full verification, new current-HEAD Self-Review, PR review, and PR completion gate.

## 5. Required Runtime Semantics

- Existing GuitarDSL event ordering and Fraction-to-screen mapping remain authoritative; sample screenshot positions are not playback data.
- Every continuation event remains an independent DOM entity. No waves are merged or invented. Direction arrows, PM annotations and `current/past/next` styling continue to track playback state.
- When the guide is resized, grid8/16 changes, a song changes, page/verse changes or a bank crossfades, every live/template SVG updates to the **same path master and aligned viewBox**; no stale 4×30 or 5.6×30 mixed geometries.
- With melody absent or lyrics absent, established v22 collapse behavior remains unchanged. A page change must not introduce technique lane height jumps or missing chord diagrams. Both banks share consistent lane heights during fade and cancellation.
- 400px/600px screenshots must show four cards and the next chord without auxiliary panel overlay. Do not treat screenshot width alone as visual evidence.

## 6. Non-goals / Forbidden Changes

- No audio/MIDI/DSL changes; no chord diagram voicing changes; no detailed-grid redesign; no pagination, left rail, lyrics, melody or next-chord redesign.
- Do not introduce font glyph or CSS text arrow/wave in place of SVG.
- Do not paste/copy the screenshots as the product UI and claim this is an implementation. The reference-derived SVG is editable and vector-based.
- Do not weaken v22's 3px wave/arrow clearance or 10px technique/chord text clearance without a **new explicit decision**. If source geometry cannot satisfy all v22 display widths, **report the exact case as blocked** rather than quietly choosing overlap, truncation or a different rhythm.

## 7. Concrete Tests

1. **Golden shapes:** exact four shaft/head `d` strings and wave `d`; head fill solid `currentColor`, no `stroke`; shaft width 2.65 and wave width 2.35 (unscaled master), no arrow text or Unicode wave.
2. **Visual shape at screenshot-native scale:** rendered reference trace vs user image crop. Down/up height 47px ±1, filled head width 15px ±1, wave about 15px wide and centered at offset21px; native 8/16 event sequences as given in §2.2; inspect at 1:1, do not validate only source string.
3. **Compact geometry:** 320/400/421/480/600/1100/1600×grid8/grid16, both banks; after responsive fit, arrowhead triangles nonempty and wave recognizably S-shaped, not a dot. Preserve v22 painted clearance and four-card containment.
4. **Semantic separation:** tests independently check original event Fractions, wave counts, attack direction, `current/past/next` colors, PM labels, repeat/volta and ties. The screenshot demonstration arrays must not appear as default runtime events.
5. **Layout/cancellation:** no chord clipping or gutter regression; crossfade, stop, rapid resize, grid changes and owner refresh leave both banks consistent.
6. **Screenshots:** JA Light/Dark and EN Light/Dark representative full 400px and 600px Preview screenshots for grid8 and grid16, all four measures and next code visible, no overlay from another VS Code pane. Reviewer must compare them directly to the source screenshots and v24 traced SVGs and note unavoidable 400px density limitations.

## 8. Verification

Run and record the current repository's exact commands, where available: `npm run compile:all`, `npm test`, `npm run check:help`, `npm run check:ai`, `npm run vscode:prepublish`, `verify-implementation-contract 162`, `validate-docs --issue 162`, `git diff --check`, Required CI and delivery check. Do not claim unavailable or unexecuted Windows/Linux/VoiceOver/NVDA as verified. Optional six pending E2Es remain pending unless explicitly executed.

## 9. Reviewer Checklist

- [ ] The two user screenshots are labeled 8-beat/16-beat correctly; the older v23 sample is not accepted as a reference.
- [ ] The two attached v24 SVGs are committed unchanged as visual masters.
- [ ] Down/up filled arrow geometry and short wave visually match reference crops at native scale.
- [ ] 400px compromise is explicitly quantified; no false pixel-identical claim.
- [ ] Four bars, Fraction, events, PM and current/past/next semantics are retained.
- [ ] v22 3px wave-arrow and 10px technique-chord minimum painted gaps remain tested.
- [ ] Both banks, fade, resize and grid selection are tested using real runtime paths.
- [ ] Latest actual 400/600px screenshots are complete and unobscured.
- [ ] Full tests, Required CI, contract/docs checks and review/self-review are current-HEAD PASS.
- [ ] Implementer recorded file list, deviations, unverified platforms, blockers, and PR URL.

## 10. Completion Report

Required report: changed files and actual SVG paths, visual comparison outcome, exact test commands/counts, current-HEAD SHA, acceptance checklist results, unverified platforms, conflicts/deviations, and **PR URL** (`https://github.com/puchinya/vscode-guitar-dsl/pull/163`). Completion requires committed changes, pushed branch, PR existing with `Closes #162` and repository workflow transition to review. If rendering cannot satisfy v22 clearances at 400px after shape change, treat implementation as **BLOCKED**, not silently complete.