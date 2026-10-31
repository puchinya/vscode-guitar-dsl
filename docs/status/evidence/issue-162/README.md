# Issue #162 Practice Guide evidence

These PNGs show the compact four-measure Practice Guide and tempo-linked bank fade captured in the VS Code 1.144.0 Extension Development Host on macOS arm64. The Japanese runs used the installed Japanese language pack; English runs used the default locale. The review-v3 layout and grid images were captured after the contrast, exact-anchor, and proportional-SVG-scaling changes.

## Capture matrix

| Evidence | Cases | Files |
|---|---|---:|
| Compact layout (review-v3) | 400 / 421 / 600 / 1100 CSS px × JA / EN × Light / Dark × Melody on / off | 32 |
| Continuation marks (review-v3) | 400 CSS px × grid 4 / 8 / 16 × JA / EN × Light / Dark | 12 |
| Four-measure fade reference (prior capture) | 1600 CSS px × JA / EN × Light / Dark | 4 |
| Crossfade phases (prior capture) | 1600 CSS px × 0 / 250 / 500 ms × JA / EN × Light / Dark | 12 |
| **Total** |  | **60** |

The 44 review-v3 compact/grid PNGs were captured in four separate JA/EN × Light/Dark E2E runs. Every PNG was checked for a valid header, nonzero dimensions, minimum image size, and the requested CSS-pixel width. The E2E also checked computed lyric contrast, technique-anchor geometry, and equal X/Y SVG scale. Technique SVGs use 12 CSS px as the reference target interval; narrower intervals uniformly scale the original SVG in both dimensions, with no symbol-recognition requirement below that size. Representative 400 px layouts and the 16th-note grid were visually inspected in both locales and themes. The 16 fade reference/phase images retain the earlier visual capture at source commit `c7d1f9d2f992041ceffc9f77e99ea5b21f6e5ddd`; the fade lifecycle is covered by current-HEAD tests below.

## Representative images

- [EN Dark, 400 px, melody on (review-v3)](practice-guide-compact-issue162-en-dark-400-melody-on-review-v3.png)
- [JA Light, 400 px, melody on (review-v3)](practice-guide-compact-issue162-ja-light-400-melody-on-review-v3.png)
- [JA Light, 400 px, 16th-note grid (review-v3)](practice-guide-grid-issue162-ja-light-400-grid-16.png)
- [EN Dark, 250 ms fade](practice-guide-crossfade-issue162-en-dark-250ms-current-head.png)
- [JA Dark, 500 ms fade](practice-guide-crossfade-issue162-ja-dark-500ms-current-head.png)

The review-v3 images are the current compact-layout evidence. The earlier fade images are retained as references for transition phases; their source commit is shown above. E2E reruns and the implementation source commit are recorded in [`implementation-status.md`](../../implementation-status.md).

## PR #163 review evidence

The compact chord edge regression uses 2, 3, and 4 chord intervals in one four-measure page at an exact 400 CSS px Preview width. Chord diagrams stay in one horizontal row in playback order; each pair scales to its available interval spacing. The E2E checks the name/diagram pair and center, reads both DOM bounds against the card, confirms finger dots, and verifies that neighboring diagrams do not overlap.

- [EN Dark, 400 px, short chord spans and compact diagrams](practice-guide-compact-chord-bounds-issue162-en-dark-400.png)
- [EN Dark, 400 px, `sample_gozen0jino_page` with horizontal chord diagrams](practice-guide-horizontal-sample-issue162-en-dark-400.png)
- The compact width/melody matrix and grid4/8/16 images were refreshed for all four locale/theme combinations in the review-v3 E2E runs.

The refreshed `sample_gozen0jino_page` capture also verifies that dense stroke symbols remain in one horizontal row in the compact guide. A focused E2E checks exact beat anchors, visual offsets for simultaneous tie marks, equal X/Y scaling, accessible names, non-overlap, and card containment at 320–1600 CSS px, grids 4 / 8 / 16, and melody on/off.
