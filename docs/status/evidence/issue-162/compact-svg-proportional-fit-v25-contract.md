# Implementation Contract v25 Delta — compact SVGの縦横比を保った縮小

- Repository: `puchinya/vscode-guitar-dsl`
- Issue: [#162](https://github.com/puchinya/vscode-guitar-dsl/issues/162)
- Existing PR: [#163](https://github.com/puchinya/vscode-guitar-dsl/pull/163)
- Superseded canonical contract: v24, Issue comment `6723507878`, SHA-256 `031fc46979dc593fb7db8cf0b6eda6ca704fdc609bcaaf3128b40c8d9de49a1a`.
- Trigger: compact 400px/grid16 screenshots horizontally squash the 15×47 SVG to around one tenth width while leaving its height unchanged. The resulting vertical needles and flat waves do not look like the reference. The user's earlier explicit direction is to shrink the SVG below its minimum fit width, even if the result is too small to recognize.

## Decision

Keep the exact Contract v24 15×47 source paths and event geometry. When a cell cannot fit a mark at its natural width, scale the complete SVG uniformly in X and Y. Preserve the native master and aspect ratio at every size; do not use `scale(sx, 1)` or `preserveAspectRatio="none"` to squeeze the drawing horizontally.

For the existing per-event available width `usableWidth` and 15px master width:

```text
uniformScale = min(1, max(0, usableWidth) / 15)
translateY = rowTop + 1.3 + 47 * (1 - uniformScale) / 2
transform = translate(x, translateY) scale(uniformScale, uniformScale)
```

The 1.3px top inset keeps a full-size mark inside the technique lane's existing bounds; reduced marks stay vertically centered in the same 47px mark band. Keep the 51px minimum technique-lane height and the existing 20px lane gutter. At scale 1, maintain at least 10px painted clearance between technique marks and chord names. The compact lane and its alignment remain stable when pages, banks, lyrics, or grid selections change.

## Preserved requirements

- Use the same 15×47 master paths for 8-beat and 16-beat visuals: down shaft `M0 0 V31`, filled down head `M-7.5 30 L7.5 30 L0 47 Z`, up shaft `M0 47 V17`, filled up head `M-7.5 17 L0 0 L7.5 17 Z`, and wave `M0 0 C3.2 -3.35 5.2 -3.35 7.5 0 S12.4 3.35 15 0` at y=21. Preserve 2.65px shaft and 2.35px wave master strokes before scaling.
- Scale the complete SVG, including stroke width and the wave, by the same factor. Dense marks may become unreadable; no minimum rendered arrow height, wave height, or stroke width is required below natural size.
- Keep each model event, direction, continuation Fraction, x anchor, playback state, PM annotation, title, and accessible name. Never copy the sample screenshot event sequences into runtime data.
- Preserve four compact measures, next-chord placement, whole chord diagrams, no horizontal scrolling, and the 20px technique-lane gutter.
- Preserve at least 3px painted wave-to-arrow clearance at 400px and 600px and at least 10px painted technique-to-chord-name clearance. Keep all marks within their measure card and the technique lane.
- Continue vertically scrolling only the compact measure area when Preview height is short, leaving the next-chord region available. Keep all diagram fingerings visible after scrolling.
- Leave detailed grid, ordinary score SVG/PDF, DSL, playback timing, voicings, melody, lyrics, and audio unchanged.

## Acceptance and evidence

1. Unit tests assert the four reference paths, 15×47 viewBox, and uniform transform behavior.
2. E2E tests cover 320/400/421/480/600/1100/1600px with grids 4/8/16, verify `scaleX === scaleY` for each fitted mark, preserve x anchors and all semantic identities, and keep each cell/card bounds valid. A sub-2px case verifies marks remain in the DOM with their event, Fraction, title, and ARIA identity; it does not require recognizability.
3. Real Preview screenshot captures cover 400/600px × grid8/grid16 × JA/EN × Light/Dark. Record exact PNG dimensions/SHA-256, uniform scale factors, painted gaps, complete diagrams, technique visibility, and the next-chord region in sidecars.
4. Compare the final compact marks to the user-reference crop and native v24 SVG traces. Compact cells are allowed to render very small; do not claim pixel-identical screenshot layout.
5. Run `npm test`, `npm run check:help`, `npm run check:ai`, `npm run vscode:prepublish`, `npx @vscode/vsce ls`, `verify-implementation-contract 162`, `validate-docs --issue 162`, `git diff --check`, current-HEAD Self-Review, Required CI, and delivery check. Windows/Linux and manual VoiceOver/NVDA remain explicitly untested unless actually run.

## Reviewer checklist

- [ ] The compact screenshot scales the entire SVG uniformly; 400px/grid16 no longer has full-height needle arrows or horizontally flattened waves.
- [ ] Master SVG path data remains byte-for-byte identical to the approved v24 reference trace.
- [ ] v22/v24 3px wave-to-arrow and 10px technique-to-chord clearances remain satisfied; the 20px gutter remains.
- [ ] Four cards, all event/Fraction identities, PM, playback states, and complete chord diagrams remain present.
- [ ] JA/EN × Light/Dark × 400/600px × grid8/grid16 screenshots and SHA-bound sidecars are captured from current HEAD.
- [ ] Full tests, docs/help/AI checks, packaging, current-HEAD self-review, and Required CI pass; untested platforms are not claimed as verified.
