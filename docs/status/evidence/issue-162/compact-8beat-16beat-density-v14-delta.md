# Implementation Contract v14 Delta — 8/16ビートの参照画像に合わせたコンパクト奏法表示

- Repository: `puchinya/vscode-guitar-dsl`
- Issue: [#162](https://github.com/puchinya/vscode-guitar-dsl/issues/162)
- PR: [#163](https://github.com/puchinya/vscode-guitar-dsl/pull/163)
- Read-only baseline: `78e5c80f100bda1d30763c2a6b4fc979744af2b0` (2026-11-07)
- Canonical v13: Issue #162 comment [`6704603787`](https://github.com/puchinya/vscode-guitar-dsl/issues/162#issuecomment-6704603787). This delta **supersedes only** the compact chord-name font policy, compact whitespace policy, and continuation-wave presentation geometry / no-overlap rule. All other v13 and earlier contracts remain authoritative.
- Visual references: user's **first** recent image is the **8-beat** pattern, user's **second / corrected** recent image is the **16-beat** pattern. The original [strumming reference crop](https://github.com/puchinya/vscode-guitar-dsl/blob/78e5c80f100bda1d30763c2a6b4fc979744af2b0/docs/status/evidence/issue-162/user-reference-stroke-pattern-crop.png) remains available. **The two new chat images are not yet physically attached to GitHub**: do not pretend they are. This contract supplies measurable styling and overlap rules independent of those attachments.

> This document is an Implementation Contract. Do not redesign the architecture during implementation. If a requirement conflicts with repository reality or requires a material design change, do not silently choose an alternative. Report the exact conflict and continue only with independent valid work.

## 1. Repository Baseline

- `src/render/previewHtml.ts::renderPracticeGuidePanel` near line 4968: the compact chord name is a `<text font-size="13" font-weight="700">`, with immutable `data-guide-natural-width` measured at 13px, then `::fitCompactSvgText` at the assigned width. The font is notably smaller than the chord name in the user's reference.
- `::compactGuideX` uses **5px each-side inset**; `::pack(..., 'chord')` uses another **2px safety subtraction** and `::computePracticeGuideCompactLayout` reserves ruler=24, melody=64 whenever switched on, and lyrics=28 even for a wholly lyricless song. Bank/card CSS gaps are already **0**; do not rediscover the old gap issue or add negative margins.
- `src/render/practiceGuideStrokeSvg.ts::renderPracticeGuideCompactWavePathSvg` uses fixed narrow/medium/wide independent SVG wave marks; v13 grid16 widths are 2.4/4.2/5.6. `src/render/previewHtml.ts::computePracticeGuideCompactLayout` packs waves with painted gap and `::layoutPracticeGuideCompactSvg` applies **X-only scaling**. This deliberately avoids an arrow/wave overlap, whereas the latest user request **explicitly allows and wants** a wave to extend behind an arrow.
- `tests/e2e/extension.test.ts` verifies exact Fraction positions, wave counts, and pixel gaps. Its old **"wave and attack never overlap"** visual oracle must be replaced narrowly, not deleted wholesale. `docs/specs/gui_design.md` §2.4 and `docs/design/preview-rendering-and-export.md` describe the existing shared SVG geometry.
- Current v13 CI `agent-required-check` is green but the PR's latest **full** `npm test` is FAIL (Inspector Issue #158, `expected chooseReference, got add`, 132 E2E PASS, 1 FAIL). The v13 600px screenshot is obstructed by another VS Code panel. These are **pre-existing open review blockers** and remain part of the completion gate.

## 2. Architecture Decisions

### 2.1 Two reference styles, one rendering model

Treat **8-beat** as `grid=8` (eighth-note subdivisions) and **16-beat** as `grid=16` (sixteenth-note subdivisions). **Both** use the same tall, narrow 4×30 attack SVG paths and one stroke-technique lane. The diagram and chord-name lanes remain aligned to their chord intervals. Do not create a second ad-hoc renderer or a font-based arrow/tilde implementation.

The goal is **denser ink and less wasted whitespace**, not stretching the beat lattice or reducing the mandated four measures. Time x, chord centers, playhead and melody still use a shared Fraction-based map. Preserve four equal compact slots, the 0px bank/card/next-chord gaps, PM-under-arrow, a single lyric font size per song, full chord diagrams, and tempo-dependent bank fade.

### 2.2 Exact compact spacing

- Set compact **horizontal music inset to 2 CSS px** on both edges, replacing 5: `x(beat) = 2 + (beat/measureBeats) * max(0,slotWidth-4)`. Use it consistently for ruler-aligned music (melody onset/duration, lyrics, strokes, chord centers, playhead). Separate 1px barlines stay on exact card edges 0/slotWidth. Restore all dependent width calculations from `(slotWidth-10)` to `(slotWidth-4)` **only where they represent the compact time field**, not for unrelated next-chord/detailed components. No hidden +4/+8 CSS gap.
- For chord **names**, the interval available width is bounded by adjacent chord-center midpoints/card edges, with **1px inset per side** (replace only the chord-label packer's old `-2` with the explicit 1px each side; keep center anchor). Chord labels cannot consume neighbouring chord intervals.
- Song-wide empty-lane collapse: if there are **no melody pitch events anywhere** in any playback occurrence, compact melody lane height becomes 0 (even if Melody ON). If there are **no lyric events anywhere in any verse** of the song, compact lyrics lane becomes 0. If a lane contains any event anywhere, its fixed existing height remains the same across **both** banks, verses, and page changes. Never condition lane height on *only* the currently visible page or currently selected lyric verse. Do not hide normal melody events/lyrics. The ruler stays 24px; this change addresses truly unused vertical whitespace without violating v12's melody geometry stability.
- Avoid CSS `letter-spacing` hacks, negative margins, unanchored per-event packing, or shrinking other diagrams as a substitute for reclaimed padding.

### 2.3 Larger compact chord names

- `font-weight=700`, dark existing theme/current colors; target **24 CSS px** for every compact chord label, both 400px and larger. This is a **maximum**, not a forced size that would overlap an adjacent chord. For each individual chord span choose the **largest integer size** in `24, 22, 20, 18, 16, 14` whose **actual measured SVG text width** (`measureCompactSvgText(fullLabel, size, text)`) fits the final chord-name assigned width. If no candidate fits, render at **14px** with a grapheme-aware ellipsis, preserving the complete label in `aria-label`, `<title>`, `data-guide-full-text`.
- Apply the **same chosen font size** to the measurement, immutable natural-width metadata, subsequent fit/ellipsis, and final SVG `<text>`. Do not use the old hard-coded `practiceGuideTextWidth(label,13)` to assign natural width for a 24px target. Store unmodified source string separately from view-dependent computed size and assigned width. Every `400→600→400→1100` resize must recalculate from the original label; no progressively truncated cache.
- One chord per 4/4 measure at 400px should render short labels (e.g., `C`, `FM7`, `Am7`) at **24px**. Two/three/four chord intervals may use smaller sizes to fit, but do not uniformly reduce *all* labels to 13px because of a separate dense measure. Multiple chords remain in one chord-name row, each centered on its own diagram, without X-overlap.
- Chord lane height is fixed for the chosen **largest allowed 24px glyph**: reserve **32px** (`baseline` measured by font actual ascent/descent, with >=2px clearance above and below). Hold this lane height fixed across pages/resize/fades to avoid shifts. Full chord diagrams are untouched. The next-chord aside name follows its existing 24px/16px rules, not this change.

### 2.4 Continuation 「〜」 must share horizontal space with attacks

- **Keep an individual semantic SVG wave node at every required grid continuation Fraction**, its event key, `data-guide-at-fraction`, `aria-label`, accessibility and state. However **its painted stroke may extend behind the neighbouring down/up arrows**. This explicitly **supersedes** v13's attack-vs-wave visual non-overlap assumption. Do *not* extend beyond the measure card, and do not omit/move a Fraction or merge semantic nodes.
- Render SVG groups in fixed painter order: **(1) continuation/tie wave layer, (2) attack/brush/mute/string layer, (3) PM annotation layer**. Arrows are painted **on top** of the wave. Preserve the event-to-playback highlighting after this DOM grouping; wave and attack may have different current/past colors, but arrows must stay discernible.
- Compact grid8 and grid16 only: `cell = max(0,slotWidth-4) / (measureBeats*(grid/4))` (grid8: 2 subdivisions per beat; grid16: 4). For each continuation anchored at time `t`, calculate `anchorX` with the common Fraction map. Set **visual left = anchorX - 0.72*cell**, and **wave display width = max(2.8, cell-0.9)**; clamp visual extent to card [0,slotWidth] while keeping the **semantic anchor** unchanged. A left/right edge case may clip only the painted wave at its card boundary; it must not change the event's beat or other nodes' positions.
- Use the v13 **wide** 5.6×30 wave master path `M0.40 15 C1.15 10.8 2.00 10.8 2.80 15 S4.45 19.2 5.20 15` as the fixed original geometry for **both 8- and 16-beat**. Render that SVG in a display rectangle of calculated width ×30px using X-only stretching (`preserveAspectRatio="none"` or explicit `scaleX`) and `vector-effect="non-scaling-stroke"` at actual **1.15 CSS px**; **Y scale=1**. Do not alter the source `d` on resize. This makes the 8-beat wave visibly wider than the 16-beat wave, while the two use an identical silhouette and legible vertical curvature.
- **Allowed contact:** painted wave may pass behind an attack shaft/head. **Not allowed:** fully obscure the attack, overlap a chord label, cross a barline, or obscure a PM run. Waves at adjacent continuation Fractions should remain individually addressable and have >=0.25px painted gap (unless visually occluded by the foreground arrow); the legacy 1px gap between *wave and arrow* is **no longer an acceptance criterion**. If the exact 0.25px wave-wave clearance cannot hold at 320px, report the physical conflict rather than silently deleting marks.
- 4-grid and isolated tie path remain at existing fixed rendering unless necessary to preserve existing semantics. The 8/16 wave geometry is view-only; duration-grid selection and wave counts are unchanged. Distinct `data-guide-layout-anchor-x` and `data-guide-layout-x` must expose the semantic and painted positions for testing.

### 2.5 Rejected designs

Reject (a) larger 24px text without interval measurement, (b) global SVG X-scale of all lanes, (c) rendering `〜` from Unicode/music font, (d) deleting grid wave nodes/merging them to fake readability, (e) varying Y size or stroke width with beat density, (f) increasing the four-measure strip's horizontal width or adding scrolling, (g) shifting musical time anchors to make overlap work, (h) enlarging the next-chord aside to free space, (i) collapsing melody/lyrics **page-by-page** and causing crossfade jumps.

## 3. Exact Change Set

1. `src/render/previewHtml.ts::renderPracticeGuidePanel`: compact chord name template text uses 24px target plus unmodified `data-guide-full-text`; initial natural width measured consistently at target size. Split wave/attack/PM painter groups for compact technique lane. Do not modify `practiceGuideStrokeSvg.ts` non-compact path geometry.
2. `src/render/previewHtml.ts::computePracticeGuideCompactLayout`: choose the chord-name size per *final* assigned interval and store `data-guide-chord-font-size` per item; derive precise final glyph width and ellipsis from chosen font; reserve fixed chord lane 32px. Compute song-wide `hasMelodyEvents` / `hasAnyLyricEvents` from **all** templates before lane-height decision. Wave's semantic and visual bounds are independently laid out using the formula above.
3. `src/render/previewHtml.ts::layoutPracticeGuideCompactSvg`: use rendered font-size for text measurement/ellipsis; restore full text first on each layout; place wave by `visualX` without changing `data-guide-at-fraction` or highlighting identity. Set width/viewBox/aspect ratio and wave X scale for both template and live banks; restore on resize and grid8↔16 toggles.
4. `src/render/previewHtml.ts::compactGuideX`, chord/diagram packing, melody/lyric positions and playhead calculations: move shared compact inset 5→2 and update derived duration width. Audit all expressions using `(slotWidth-10)` and change **only those with compact time-field semantics**. Preserve the next-chord aside's placement and 0px gap.
5. `tests/unit/practiceGuidePanel.test.ts`, `tests/unit/practiceGuideStrokeSvg.test.ts`, `tests/e2e/extension.test.ts`: update layout snapshots/geometry and add acceptance tests below. Update v13 path assumptions that contradict newly approved visual layering; do not remove unrelated meaning checks.
6. `docs/specs/gui_design.md` §2.4, `docs/specs/extension.md` §4.6, `docs/design/preview-rendering-and-export.md`, JA/EN Help, `docs/status/implementation-status.md`, evidence README and v14 screenshots/DOM sidecars; canonicalize this delta on Issue #162 before claiming acceptance.

## 4. Implementation Sequence

Canonical v14 decision → common inset/time map and vertical empty-lane evaluation → chord-name font+measurement and one-row packing → separate wave/attack/PM painter groups → wave visual overlap layout and template/live synchronization → unit → E2E → visual comparison at 8/16 grids → full tests and existing failure remediation → status/self-review/PR review.

## 5. Required Runtime Semantics

- Grid8 and grid16 use the same chord-name policy and common Fraction-based horizontal geometry. `grid8→grid16→grid8` changes the wave width/offset only; never the count expected at each grid, event IDs or scores.
- Wave fills its own visual region behind arrows, but semantic time remains on the true Fraction. Highlight/seek/repeat/volta tie selection stays event-exact.
- `400→600→400→1100→400` returns to identical width, font size, labels, and visual wave positions regardless of resizing order. Both banks, during and after BPM-linked crossfade, have consistent layout; fade cleanup and Reduced Motion are unchanged.
- An empty melody/lyric lane may collapse only if there are no corresponding source events in **all** song playback occurrences; page changes and verse toggles never alter that decision. Chord lane baseline and diagram lane bounds remain stable.
- User-facing chord display is text, not a glyph image. Its complete source value remains accessible even if a dense chord interval requires visible ellipsis.

## 6. Non-goals / Forbidden Changes

No DSL, compiler, PlaybackTimeline, VST/audio, score SVG/PDF, detailed-grid, song lyric sizing policy, next-chord aside size, PM run semantics, diagram voicing geometry, four-slot page capacity, 0px bank/aside gaps, or fade duration/lifecycle changes. Do not hide source events, disable existing tests, or treat a failure outside Issue #162 as automatically fixed.

## 7. Concrete Tests

1. **400px / 4×4/4 / one chord per measure:** `C`, `FM7`, `G`, `Am7` each renders at 24px bold; full visible labels with measured bounding boxes inside card, centered above its diagram. No element overlap with a neighbour or next-chord aside. Compare to reference's high-contrast visual hierarchy.
2. **400px multi-chord measures:** two, three and four chords, including `F#maj7`, `Bbadd9`, `C7sus4` and same-beat ordering. Per-interval largest fitting font from the fixed candidate set, min14+ellipsis, source full label in title/ARIA; no overlap and no extra chord row. Chord diagrams have v12 common square sizing and complete bounds.
3. **8-beat (grid8), 400/600px:** quarter-note attacks + eighth continuations. The expected grid8 number/Fractions of waves is unchanged; `waveDisplayWidth=cell-0.9`, wave overlaps at least one adjacent arrow's *horizontal bounds* but is behind it in SVG painter order. Actual painted height≥7px and stroke ≥1px; each arrow shaft and arrowhead fully remains visible.
4. **16-beat (grid16), 320/400/421/600px:** quarter and half-note attack continuations. Exact wave counts and Fractions, no missing nodes. The wave painted width is greater than the old v13 medium 4.2 at 400px; painted Y height≥7px, X-only expansion, shared silhouette with 8-beat. Adjacent wave-wave painted gap≥0.25px (or explicit recorded unsatisfiable sub-320 case). Wave/attack overlap allowed and asserted; wave/PM/chord collision disallowed.
5. **Music-time and layout:** 4 slots at 320/400/421/480/481/600/1100; gap=0px between cards and next-chord aside, boundary lines at 0/slotW; `data-guide-at-fraction` and actual beat coordinate fit common `inset=2`; melody, lyrics, code/diagram, and playhead share x transform and do not drift after resize/seek/fade.
6. **Empty lanes:** whole song without melody and lyrics collapses corresponding vertical lanes; song containing melody or lyrics only in page 2 retains stable lane heights in page 1, fade and manual navigation. Melody ON/OFF and lyric-verse selection preserve relevant v12 invariants.
7. **Lifecycle:** `grid8→grid16→grid8`, `400→600→400→1100`, manual next/previous, repeat/volta, seek, autoplay crossfade and Reduced Motion. Both banks render the same chord font policy and wave painter ordering, with no stale `d`/width/transform or duplicate wave events.
8. **Visual evidence:** current-HEAD JA Light/Dark and EN Light/Dark at 400px and 600px for both grid8 and grid16; chord name and wave close-ups next to the two user references (obtain references first if available in implementer's environment); no VS Code auxiliary panel covering the 4th card/next-chord; include real DOMRect, font-size, text widths, wave painted bounds and pixel gaps, plus reviewable screenshots.
9. **Full suite gate:** compile, unit, all E2E including Issue #158 Inspector, fade tests, Help/AI, docs/contract and required CI. `npm test` must exit 0; focused `Inspector` PASS alone does not close a full-suite failure. If still blocked, report exact failure and keep the PR blocked.

## 8. Verification

`npm run compile:all` (or documented `npm run compile && npm run compile:tests` if `compile:all` unavailable); `npm run test:unit`; `npm test`; `npm run check:help`; `npm run check:ai`; `npm run vscode:prepublish`; `verify-implementation-contract 162`; `validate-docs --issue 162`; `git diff --check`; required PR CI; repository-defined delivery-check 162 163. Log exact failures and NOT RUN platforms (Windows/Linux, VoiceOver/NVDA, optional E2E) without claiming validation.

## 9. Reviewer Checklist

- [ ] Both 8-beat and 16-beat screenshot reference roles are preserved and clearly differentiated
- [ ] 400px one-chord names actually render at 24px and are visually larger than v13
- [ ] Two/three/four chord names remain legible where physically possible and have complete ARIA/title
- [ ] Only truly empty song-wide lanes collapse; fade never changes height across banks
- [ ] Compact time inset is consistently 2px without changing Fraction identity or card gaps
- [ ] One wave **semantic node per Fraction** and no music-data losses
- [ ] Wave has increased display width and overlays attacks **behind** them (not over their heads)
- [ ] Wave and attack stay visibly distinguishable on both 8- and 16-beat patterns
- [ ] X-only stretching preserves wave Y and actual stroke width, no font-based symbols
- [ ] PM-under-arrow, square chord diagrams, melody rectangular bars and lyrics are preserved
- [ ] Resize, grid toggle, seek, fade, repeats, verse switch and Reduced Motion are covered
- [ ] Current-HEAD 400/600px screenshots are unoccluded and DOM measurements support claims
- [ ] Full `npm test` exit 0, required CI success and contract/docs/self-review validated
- [ ] PR completion includes commit/push, `Closes #162`, review transition and PR URL

## 10. Completion Report

Report exact changed files, which v14 items passed, font sizes and pixel widths from real 400/600px DOM, wave count/Fraction/overlap bounds, screenshots and reference comparison, all commands and test results, untested OS/features, blockers/deviations, self-review checklist, final commit SHA and **PR URL**. Do not mark implementation complete merely after commit/push. If full-suite or review transition is blocked, report **BLOCKED** with the exact error and remaining work.