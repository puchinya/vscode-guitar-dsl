# Implementation Contract v23 Delta — 8ビート／16ビートのストローク図形を固定SVGで指定

- Repository: `puchinya/vscode-guitar-dsl`
- Issue: [#162](https://github.com/puchinya/vscode-guitar-dsl/issues/162)
- Existing PR: [#163](https://github.com/puchinya/vscode-guitar-dsl/pull/163)
- Inspected baseline HEAD: `4db34769faca193ed792bd7e68fd64352b5ad63a` (Contract v22)
- Canonical baseline: [Issue #162 Contract v22, comment 6714560967](https://github.com/puchinya/vscode-guitar-dsl/issues/162#issuecomment-6714560967)
- User visual references: first screenshot = **8ビート**, corrected second screenshot = **16ビート**. The screenshots are user-supplied in this conversation; the linked authored SVG artifacts below are the implementation's independent, original geometric redrawing. They are **not** a transcription or reproduction of copyrighted source artwork.
- Normative SVG assets (attach to the PR):
  - `docs/status/evidence/issue-162/practice-stroke-8beat-16beat-svg-spec-v23.svg` — both visual patterns and actual master paths.
  - `docs/status/evidence/issue-162/practice-stroke-compact-400-svg-spec-v23.svg` — native 400 CSS-pixel / four-measure preview.

> This document is an Implementation Contract. Do not redesign the architecture during implementation. If a requirement conflicts with repository reality or requires a material design change, do not silently choose an alternative. Report the exact conflict and continue only with independent valid work.

## 1. Repository Baseline

- `src/render/practiceGuideStrokeSvg.ts::PRACTICE_GUIDE_COMPACT_PATHS`: compact downward/upward strokes are **4×30** path shapes. Current arrowheads are **thin, open V paths**, `downHead = M0.55 24 L2 28.5 L3.45 24` and `upHead = M0.55 6 L2 1.5 L3.45 6`. Their visual silhouette differs from the user reference, which has **solid triangular heads**.
- `src/render/practiceGuideStrokeSvg.ts::compactAttackPath`: currently renders the shaft and head with the same no-fill stroke attributes. The head must be rendered as a filled path independently from the shaft.
- `::renderPracticeGuideCompactWavePathSvg`: compact 8/16 wave uses the wide master `M0.40 15 C1.15 10.8 2.00 10.8 2.80 15 S4.45 19.2 5.20 15`, 5.6×30 viewBox, non-scaling stroke. This master **already has the reference-like short S shape**, and is retained; do not redesign it by eyeballing a different font.
- `src/render/previewHtml.ts::applyCompactGrid16WaveVariant` and `::pack('technique')`: Contract v20/v22 computes `cell = max(0, slotWidth - 4) / (measureBeats * (grid / 4))`, `displayWidth = min(cell, max(2.2, cell - 3.8))`, `visualLeft = clamp(anchorX + cell / 3 - displayWidth / 2, 0, slotWidth - displayWidth)`. Preserve this for grid 8/16.
- `::groupCompactTechniquePainters` already guarantees layer order `waves → attacks → pm`. Existing tests require **>=3 CSS px between the painted wave and attack** for the relevant grid8/16 widths. Retain this current canonical v22 rule.
- `src/render/previewHtml.ts::fitCompactSvgText`: compact chord-name size already selects 24/22/20/18/16/14 px based on measured available width. Keep it. Contract v22 reserves 20 CSS px technique-to-chord lane gutter and requires >=10px of painted clearance.
- PR #163 currently reports 1,235 unit and 135 E2E PASS (6 optional pending); required CI SUCCESS at `4db3476`. These are **baseline results** and do not verify future v23 changes.

## 2. Architecture Decisions

**Adopted:** a *shape-only* visual refinement to align the outline with the attached 8/16-beat screenshots: **solid arrowheads and the existing short S-shaped wave**. Keep semantics, music timing, layout engine and bank ownership unmodified.

### 2.1 Exact arrow master paths — mandatory

Use a **4×30 local coordinate system**. Draw arrows with a straight shaft and filled triangular tip; do not use Unicode arrow characters or SVG stroke-only V-shaped arrowheads.

| Symbol | Shaft path `d` | Shaft attributes | Filled head path `d` | Filled head attributes |
|---|---|---|---|---|
| Down | `M2 1 V24` | `fill="none" stroke="currentColor" stroke-width="1.15" stroke-linecap="square" vector-effect="non-scaling-stroke"` | `M0 23.5 L4 23.5 L2 29 Z` | `fill="currentColor" stroke="none"` |
| Up | `M2 29 V6` | same | `M0 6.5 L2 1 L4 6.5 Z` | same |

The down triangle extends from `y=23.5` to `y=29`; the up triangle extends from `y=1` to `y=6.5`. Both fit inside `x=[0,4], y=[0,30]`. The shaft enters the solid triangle and remains continuous. Preserve the existing 4×30 attack width so dense grid16 packing retains its known space budget.

### 2.2 Exact wave master — mandatory

```svg
<svg viewBox="0 0 5.6 30" width="5.6" height="30" xmlns="http://www.w3.org/2000/svg">
  <path d="M0.40 15 C1.15 10.8 2.00 10.8 2.80 15 S4.45 19.2 5.20 15"
        fill="none" stroke="currentColor" stroke-width="1.15"
        stroke-linecap="round" vector-effect="non-scaling-stroke"/>
</svg>
```

- This **exact** `d`, including case/precision, is the master for compact grid8/grid16; there is no Unicode `〜`, font dependence, glyph stretching in Y, or custom ad-hoc wave of a different shape.
- The visual wave width is from the existing v20/v22 cell formula; the master SVG's 5.6 units are horizontally resampled (`preserveAspectRatio="none"`); height stays **30 CSS px**. The master's actual painted vertical height must remain >=7 CSS px after CSS layout, and stroke should remain ~1.15 CSS px.
- An individual `wave` event remains an independent element with its original `Fraction`/event/key/ARIA. Do not merge successive waves into one continuous spline.

### 2.3 Reference use and display-density boundary

- **8-beat** reference: reference the first supplied screenshot and the **top** example row in the SVG. Musical density is grid8; do not implement as grid16 to make it appear busier.
- **16-beat** reference: reference the second corrected screenshot and **bottom** example row. Musical density is grid16.
- The example sequences in the SVG are **illustrative** to show geometry, not authoritative GuitarDSL rhythm data. Production symbol occurrence counts, kind, Fraction and order always derive from parsed GuitarDSL.
- The `1200px` SVG is a **large-format reference composition** (four measures across its width); the `400px` SVG is the **native compact viewport**. With 4 measures in 400px, each slot is ~100px, so the source screenshot's 400px-per-measure apparent character size cannot be reproduced exactly. Do not solve this by changing the fixed four-measure rule or inventing a zoom.
- The earlier v14 proposed physical wave/arrow overlap, but later canonical v19–v22 explicitly superseded that with a painted-gap requirement. **Retain >=3px painted gap between a wave and an arrow.** The wave painter layer may be *behind* the arrow layer structurally without actual ink overlap. Only revise this rule if a later user-approved contract explicitly overturns v22.

### 2.4 Ownership / failure / compatibility

Keep current card/pair/bank ownership and Fraction/event metadata. Geometry is static SVG; reflow remains idempotent. No new component state, font asset or JS animation. If an SVG is clipped by measured bounds, fix its local path/source geometry instead of inflating card width or moving musical anchors. No change to detailed grid, playback timing, PDF, audio, DSL, PM annotation, melody, lyric or chord diagram semantics.

## 3. Exact Change Set

1. **`src/render/practiceGuideStrokeSvg.ts`**
   - Replace the two compact head `d` strings and the shaft endpoints with the fixed values above.
   - Modify `compactAttackPath(direction, x)` to render the **shaft** with the existing stroke-only attributes and the **head** with `fill="currentColor" stroke="none"`.
   - Keep `.practice-guide-compact-attack-head` / `.practice-guide-compact-attack-shaft` selectors and `data-guide-compact-part` to preserve existing tests and CSS expectations.
   - Keep `COMPACT_ATTACK_WIDTH=4`, `COMPACT_ATTACK_HEIGHT=30`, brush/both composition and 5.6×30 wave master identical.
2. **`src/render/previewHtml.ts`**
   - **Do not** rewrite `applyCompactGrid16WaveVariant`, `computePracticeGuideCompactLayout`, `groupCompactTechniquePainters` or music anchors unless a concrete test reveals a regression. Preserve `waves → attacks → pm`, and the existing width/left formula.
   - No layout shift: compact chord names retain measured 24px upper bound and v22's 20px technique/chord gutter.
3. **`tests/unit/practiceGuideStrokeSvg.test.ts`**
   - Update fixed shape expectations for down/up path strings and assert `fill="currentColor" stroke="none"` on the arrowhead, stroke-only shaft and native 4×30 bounds. Verify brush/both use the same master.
4. **`tests/e2e/extension.test.ts`**
   - Replace the old V-head assumption with the filled-triangle checks. Verify painted head tip and shaft continuity at 320/400/600/1100 widths, both grid8/16, and both banks.
   - Keep v22 painted wave-to-arrow clearance >=3px, wave height >=7px, arrow >=1px painted shaft width, event counts and Fraction ordering, and technique/chord painted gap >=10px.
5. **Docs and evidence**: add both SVGs to the Issue #162 evidence folder, link them from `docs/status/evidence/issue-162/README.md`, update relevant `docs/specs/gui_design.md`/`docs/design/preview-rendering-and-export.md` shape requirement and user Help if the described icons change. Do not attach a font asset.

### Mandatory inline before/after example

Before:

```ts
'<path data-guide-compact-part="head" d="M0.55 24 L2 28.5 L3.45 24" fill="none" stroke="currentColor" .../>'
```

After:

```ts
'<path data-guide-compact-part="head" d="M0 23.5 L4 23.5 L2 29 Z" fill="currentColor" stroke="none"/>'
```

Mirror for Up; keep the shaft a separate stroked path. This is an API/geometry contract, not a request to copy the demo `<use>` markup verbatim into production.

## 4. Implementation Sequence

1. Record acceptance of this v23 Delta on Issue #162 without rewriting v22 history; reference its GitHub file commit SHA.
2. Commit the SVG master examples and the contract (do not use the screenshots' pixels as runtime assets).
3. Apply new `PRACTICE_GUIDE_COMPACT_PATHS`/`compactAttackPath` path and fill rules.
4. Update unit tests, then E2E SVG geometry assertions.
5. Regenerate current-HEAD screenshots and painted-bounds sidecars for JA/EN × Light/Dark × 400/600 × grid8/grid16; compare with the new two SVG examples and supplied reference images.
6. Run full verification, self-review checklist, update PR summary and review state.

## 5. Required Runtime Semantics

- Down/up arrows have **solid filled triangular heads**, unchanged original attack direction/beat/Fraction and unchanged line height.
- At 400px/grid16, arrows stay distinct and do not overlap waves. Wave path retains two visually discernible sweeps rather than dots.
- Wave/attack marks remain independently highlightable by current/past/next. Marker colors follow `currentColor`; no hardcoded black in production. SVG demonstration uses dark ink solely for legibility.
- Grid4, grid8, grid16 selection, page changes, score seek, repeated/volta occurrence, resize 400→600→400, reduced motion, fade in/out and teardown do not duplicate, reorder or leak SVG nodes.
- Long labels and PM annotations retain full accessible names and stable layout; both live banks use the same geometric master.

## 6. Non-goals / Forbidden Changes

Do not replace with text glyphs or fonts, enlarge the source attack from 4×30, move musical anchors, delete continuation marks, change snap/grid rules, enlarge the measure/card width, add horizontal scrolling, reduce four measures, reintroduce measure gaps, change PDF or detailed grid, alter fixed 20px technique/chord gutter, or suppress the v22 wave/arrow clearance tests. Do not mark a visual match PASS solely because the `d` string matches a unit test.

## 7. Concrete Tests

| Setup | Action | Required assertion |
|---|---|---|
| Unit / Down + Up | Render attack SVG elements | `d` exact for four paths; head uses solid fill; native 4×30 viewBox; SVG parse valid |
| Unit / brush + both | Render combinations | Both use same filled arrow masters without widened attack location |
| Grid8 / 400px / 4 bars | Render normal/past/current | 8 subdivisions per 4/4 measure where defined; exact Fraction positions; painted wave/arrow gap >=3px; solid heads visible |
| Grid16 / 400px / 4 bars | Render dense pattern | 16 subdivisions per 4/4 measure where defined; distinct waves; >=7px wave painted height; no stroke collision |
| 600px / 8 and 16 | Resize and capture | Four measures + next chord visible, no outside panel obstruction; correct reference assignment |
| 400→600→400 / page bank | Resize, navigate, fade | Identical arrow paths and positions for the same Fraction; no duplicate, stale or clipped glyphs |
| Chord-name and diagram | Toggle chord diagrams | Names fit 24/22/20/18/16/14 rule; full viewBox and diagram visible; technique-to-name painted gap >=10px |
| Light/Dark + JA/EN | Compare saved evidence | No clipped filled heads or unreadable waves, with measurement JSON and PNG checked together |

Tests must inspect **rendered filled geometry**, not only path literals, and distinguish failure from simple “no panic”. Screenshots must be from current code HEAD, not these illustrative SVG files.

## 8. Verification

Run in the repository at the final implementation HEAD:

```bash
npm run compile:all
npm test
npm run vscode:prepublish
npm run check:help
npm run check:ai
# Use the exact repo-defined forms of these workflow scripts:
# verify-implementation-contract 162
# validate-docs --issue 162
# delivery-check 162 163
git diff --check
```

Verify `agent-required-check` on current HEAD and the packaging file listing as required by repo workflow. Do not claim Windows/Linux, VoiceOver/NVDA or optional pending E2E cases were tested. Do not accept an isolated test PASS over a failing full `npm test`.

## 9. Reviewer Checklist

The implementer must publish these acceptance criteria before editing and self-review each item:

- [ ] Both supplied visual references correctly mapped: first grid8, second grid16.
- [ ] Fixed Down/Up shafts and **filled triangular arrowheads** match exact paths/attributes.
- [ ] Wave master path, 5.6×30 viewBox, non-scaling stroke and density width formula unchanged.
- [ ] Waves layered before arrows; PM last; >=3px painted arrow-to-wave separation.
- [ ] Native 400px four-measure example is dense but recognizable; no claim of pixel-exact reference matching at incompatible scale.
- [ ] Chord names up to 24px and diagrams remain aligned, no overlap or cropping.
- [ ] No beat/Fraction/event/ARIA changes, no duplicated paths during fade or resize.
- [ ] Captures for grid8/grid16 at 400/600 with no VS Code overlays, bounds + screenshot reviewed.
- [ ] Unit/E2E/full `npm test`, current-HEAD CI, docs/contract/Help/prepublish, self-review all checked accurately.
- [ ] All changed files, test evidence and PR #163 link are in the completion report.

## 10. Completion Report

Report exactly: commit SHA, changed paths, screenshot links and shape/path comparison result, checklist item outcomes, commands/exit codes and test totals, unverified platforms, contract deviations/new conflicts, whether the working branch is pushed, **PR URL** (`https://github.com/puchinya/vscode-guitar-dsl/pull/163`), and whether review workflow state has advanced. Do not report complete merely because local implementation/commit/push succeeds. If tests or PR review transition are blocked, report **BLOCKED** with the actual reason and remaining work.