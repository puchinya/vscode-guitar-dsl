# Implementation Contract v27 Delta — source provenance and simultaneous placement

- Repository: `puchinya/vscode-guitar-dsl`
- Issue: #162
- PR: #163
- Supersedes: canonical Contract v26, Issue comment `6772800154`, 5,621 bytes, SHA-256 `1da32d9f6755bb5a6af064fe873135b009b0237ff1bf4bf01512471bd97b8597`.
- Reason: the user reports the shrunken compact rendering still does not match the supplied 8-beat and corrected 16-beat reference images. The current per-cell caps produce different mark scales across grids: 400px grid8 uses about 0.50 while grid16 reaches 0.10. Fixed per-cell deductions (`4.5px` for attacks and `4.4px` for waves) make the same traced 15×47 master far too large in grid8 and too small in grid16.

This delta responds to PR #163 review findings. It clarifies the existing same-onset layout exception and narrows the evidence claim. It does not change glyph paths, event content, playback timing, or the v26 reference-proportional scale.

## Decision

Size the reference attack and continuation masters from the width of the complete measure in the corresponding traced image. All ordinary down arrows, up arrows, and waves in the same compact guide share one uniform scale for the selected grid and slot width. Do not derive their base scale from each event's local grid cell.

```text
referenceMeasureWidth = grid8 ? 366 : grid16 ? 400 : 400
referenceScale = min(1, slotWidth / referenceMeasureWidth)
referenceMarkWidth = 15 * referenceScale
```

The 8-beat vector specimen spans 366 source units (`stroke-reference-trace-8beat-v24.svg`, x=18..384); the 16-beat vector specimen spans 400 (`stroke-reference-trace-16beat-v24.svg`, x=23..423). These SVGs are reference-derived geometry specimens; their event sequence and spacing have not been verified as an exact segment-by-segment transcription of the saved user crop. The specimen event track is inset from each measure edge: grid8 uses `trackInset=34`, grid16 uses `trackInset=32`, and both use `trackWidth=324`. Map each runtime event's Fraction across this inset track before applying the reference scale:

```text
referenceAnchorX = (trackInset + beat / measureBeats * trackWidth) * referenceScale
```

This preserves source event Fractions while retaining the vector specimen's left/right whitespace and relative event spacing. Do not stretch the event track to fill the compact card width. Grid4 keeps its existing interval-fit layout. Fit each unchanged 15-unit SVG with `translate(x,y) scale(s,s)`, where `s=referenceScale`. A same-onset group or an intrinsically wider composite brush/both-direction mark may receive additional uniform fitting as specified below. Preserve the exact master path geometry, including stroke width.

For a single visible technique layout item, center its arrow on that item's Fraction-derived visual anchor. Center each grid8/grid16 continuation at its Fraction anchor minus `5 * referenceScale` CSS px, reducing only that visual offset when needed to preserve the 1px painted gap:

```text
cell = trackWidth * referenceScale / (measureBeats * (grid / 4))
waveOffset = min(5 * referenceScale, max(0, cell - 1 - 17.4 * referenceScale))
```

Clamp the resulting drawing bounds to the measure card edges. Preserve each event's source ID, Fraction, accessible name, title, and playback state. The stored semantic anchor remains unchanged when the visible bounds are centered or clamped.

### Same-onset visual placement exception

This is the normative exception to single-item Fraction centering. A group consists of two or more visible technique layout items whose beat values differ from the first item's beat by less than `0.000001`. Sort items by `(beat, event index, stable source/DOM order)`. Let `startX` be the first item's reference Fraction anchor. Let `endX` be the next item's anchor at the next distinct beat, or the end of the inset reference track when no later item exists. For `n` grouped items:

```text
stepWidth = max(0.001, (endX - startX) / n)
baseVisualCenterX(rank) = startX + rank * stepWidth  // rank is 0-based
```

Each grouped item keeps its own original Fraction-derived `data-guide-layout-anchor-x`. The base visual centers may move right from that semantic anchor to separate the marks; they remain ordered in the shared interval and on the same horizontal row. Limit the item's painted width by the shared `stepWidth` using uniform SVG scaling, retain the v26 composite-mark cap, apply the existing continuation-wave offset only to waves, and finally clamp painted bounds to the card. These visual adjustments never rewrite the semantic beat, Fraction, event ID, or anchor. Adjacent marks must remain collision-free; wave/arrow and adjacent-wave clearances continue to follow the v26 constraints.

The traced marks remain separate. At 400/600px, require at least 1 CSS px of painted horizontal clearance between waves and attacks; require adjacent waves to remain at least 0.25px apart. Do not reserve a fixed 3–4.5px gap inside every grid cell, because that gap does not scale with the supplied image and creates the reported visual mismatch. Keep the 20px technique lane gutter and at least 10px of painted clearance from technique marks to chord-name text.

## Preserved requirements

- Keep the exact v24 15×47 arrow and wave paths; no X-only transforms, path edits, or symbol substitutions.
- Keep all technique symbols in one horizontal row, with source event order and exact semantic beat/Fraction anchors.
- Keep four measure cards, all source events and waves, complete chord diagrams, and the next-chord region visible without horizontal scrolling.
- Keep technique marks inside their measure card and lane; retain the stable 20px technique-to-chord gutter.
- Do not alter detailed grid rendering, ordinary score SVG/PDF, DSL, audio, playback timing, lyrics, or chord voicings.
- Preserve the existing 400→600→400 resize recovery and recompute from immutable natural SVG geometry.

## Acceptance evidence

1. Unit coverage pins the four arrow paths and shared wave path, natural 15×47 dimensions, and unchanged path data after scaling.
2. E2E coverage checks 320/400/421/480/600/1100/1600px and grids4/8/16: same reference scale across ordinary marks at a given width/grid, X/Y scale equality, Fraction anchors, event/accessibility identities, card/lane containment, no mark collisions, and no arrow-wave contact. For same-onset groups it also asserts stable event/source order, the base center positions above, single-row placement, fit, and unchanged semantic anchors.
3. Capture current-source Preview screenshots at 400/600px × grid8/grid16 × JA/EN × Light/Dark. Sidecars record the reference scale and track coordinates, path and painted bounds, clearance, all four cards, diagrams, and next-chord visibility.
4. The saved crop and v24 SVGs are distinct artifacts. The crop is partial; the SVGs are reference-derived geometry specimens, not verified pixel/event traces. The review identified a first-group sequence mismatch, and the corrected 16-beat source screenshot is unavailable in this checkout/evidence set. Therefore exact source-to-trace sequence, spacing, and pixel comparison is **NOT RUN** and must not be claimed. The existing juxtaposition PNG is illustrative only. Compact screenshots remain valid for runtime layout, scale, and Fraction behavior, not proof of exact source-image reproduction.
5. Run the repository verification gate, current-HEAD self-review, required CI, and delivery check. Keep Windows/Linux and manual assistive-technology coverage explicitly untested unless performed.

## Implementation Contract rule
> This document is an Implementation Contract. Do not redesign the architecture during implementation. If a requirement conflicts with repository reality or requires a material design change, do not silently choose an alternative. Report the exact conflict and continue only with independent valid work.
