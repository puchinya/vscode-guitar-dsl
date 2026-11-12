# Implementation Contract v26 Delta — Reference-proportional compact SVG sizing

- Repository: `puchinya/vscode-guitar-dsl`
- Issue: #162
- PR: #163
- Supersedes: approved Contract v25, Issue comment `6724493836`, SHA-256 `a091164423bf16facf1052e48ba4780b0939fe0cd45dbb4e653db12a591058e9`.
- Reason: the user reports the shrunken compact rendering still does not match the supplied 8-beat and corrected 16-beat reference images. The current per-cell caps produce different mark scales across grids: 400px grid8 uses about 0.50 while grid16 reaches 0.10. Fixed per-cell deductions (`4.5px` for attacks and `4.4px` for waves) make the same traced 15×47 master far too large in grid8 and too small in grid16.

## Decision

Size the reference attack and continuation masters from the width of the complete measure in the corresponding traced image. All ordinary down arrows, up arrows, and waves in the same compact guide share one uniform scale for the selected grid and slot width. Do not derive their base scale from each event's local grid cell.

```text
referenceMeasureWidth = grid8 ? 366 : grid16 ? 400 : 400
referenceScale = min(1, slotWidth / referenceMeasureWidth)
referenceMarkWidth = 15 * referenceScale
```

The 8-beat traced first measure spans 366 source units (`stroke-reference-trace-8beat-v24.svg`, x=18..384); the corrected 16-beat trace spans 400 (`stroke-reference-trace-16beat-v24.svg`, x=23..423). The traced event track is inset from each measure edge: grid8 uses `trackInset=34`, grid16 uses `trackInset=32`, and both use `trackWidth=324`. Map each source event's Fraction across this inset track before applying the reference scale:

```text
referenceAnchorX = (trackInset + beat / measureBeats * trackWidth) * referenceScale
```

This preserves source event Fractions while retaining the reference image's left/right whitespace and relative event spacing. Do not stretch the event track to fill the compact card width. Grid4 keeps its existing interval-fit layout. Fit each unchanged 15-unit SVG with `translate(x,y) scale(s,s)`, where `s=referenceScale`. A genuinely simultaneous group may reduce marks to fit its shared interval; intrinsically wider composite brush or both-direction marks may also be capped to that interval. Preserve the exact reference path geometry, including stroke width.

Center each arrow on its source event's Fraction-derived anchor. Center each grid8/grid16 continuation at its Fraction anchor minus the traced `5 * referenceScale` CSS px, reducing only that visual offset when needed to preserve the 1px painted gap:

```text
cell = trackWidth * referenceScale / (measureBeats * (grid / 4))
waveOffset = min(5 * referenceScale, max(0, cell - 1 - 17.4 * referenceScale))
```

Clamp the resulting drawing bounds to the measure card edges. Preserve each event's source ID, Fraction, accessible name, title, and playback state. The stored semantic anchor remains unchanged when the visible bounds are centered or clamped.

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
2. E2E coverage checks 320/400/421/480/600/1100/1600px and grids4/8/16: same reference scale across ordinary marks at a given width/grid, X/Y scale equality, Fraction anchors, event/accessibility identities, card/lane containment, no mark collisions, and no arrow-wave contact.
3. Capture current-source Preview screenshots at 400/600px × grid8/grid16 × JA/EN × Light/Dark. Sidecars record the reference scale and track coordinates, path and painted bounds, clearance, all four cards, diagrams, and next-chord visibility.
4. Compare the reduced screenshots directly with both v24 trace SVGs and the user-reference crop. Compact marks may be too small to identify; they must retain the supplied image's relative size, aspect ratio, order, and spacing.
5. Run the repository verification gate, current-HEAD self-review, required CI, and delivery check. Keep Windows/Linux and manual assistive-technology coverage explicitly untested unless performed.

## Implementation Contract rule
> This document is an Implementation Contract. Do not redesign the architecture during implementation. If a requirement conflicts with repository reality or requires a material design change, do not silently choose an alternative. Report the exact conflict and continue only with independent valid work.
