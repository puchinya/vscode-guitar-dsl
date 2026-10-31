# Issue #162 Practice Guide evidence

These PNGs show the compact four-measure Practice Guide and tempo-linked bank fade captured in the VS Code 1.144.0 Extension Development Host on macOS arm64. The Japanese runs used the installed Japanese language pack; English runs used the default locale. The layout/grid set was captured after the canonical continuation-wave path fix; the four portrait-geometry/rest images were captured at the current review-remediation HEAD.

## Capture matrix

| Evidence | Cases | Files |
|---|---|---:|
| Compact layout (review-v4) | 400 / 421 / 600 / 1100 CSS px × JA / EN × Light / Dark × Melody on / off | 32 |
| Continuation marks (review-v4) | 400 CSS px × grid 4 / 8 / 16 × JA / EN × Light / Dark | 12 |
| Short chord spans and sample (review-v4) | 400 CSS px × JA / EN × Light / Dark | 8 |
| Portrait attack geometry and blank compact melody rests (current review remediation) | 400 CSS px × JA / EN × Light / Dark | 4 |
| Four-measure fade reference (prior capture) | 1600 CSS px × JA / EN × Light / Dark | 4 |
| Crossfade phases (prior capture) | 1600 CSS px × 0 / 250 / 500 ms × JA / EN × Light / Dark | 12 |
| **Selected evidence files** |  | **72** |

The 44 review-v4 compact/grid PNGs and eight short-chord/sample PNGs were captured in four separate JA/EN × Light/Dark E2E runs. All 52 files have valid PNG headers, the expected CSS-pixel width, nonzero height, and at least 20 KB. The E2E also checked computed lyric contrast, technique-anchor geometry, canonical wave `d` and stroke width, per-grid wave counts and Fractions, and equal X/Y SVG scale. At 400 px and grid 16, the original 12 px wave SVG is retained and its parent symbol is uniformly scaled; recognition below the 12 px reference interval is not required. Representative compact layouts and the 16th-note grid were visually inspected in both locales and themes. The earlier review-v3 compact/grid images remain in the directory as historical evidence and are superseded by review-v4. The 16 fade reference/phase images retain the earlier visual capture at source commit `c7d1f9d2f992041ceffc9f77e99ea5b21f6e5ddd`; the fade lifecycle is covered by current-HEAD tests below.

The four portrait-geometry/rest PNGs are each exactly 400 × 699 pixels and approximately 52 KB. Their E2E checked the 10 × 36 compact attack viewBox, 5 × 5 arrowhead, shaft height of at least 27 local units, uniform X/Y scaling, all four fixed technique colors, opacity 1, and 1.7–2.0 local stroke widths. It also verified zero compact melody-rest nodes, the unchanged following pitch-bar beat/duration, and retained rests in the detailed grid. I visually inspected all four images for the requested tall, narrow attack proportions, horizontal ordering, dense continuation marks, and Japanese/English Light/Dark rendering; recognition below the 12 px reference interval is not required.

## Representative images

- [EN Dark, 400 px, melody on (review-v4)](practice-guide-compact-issue162-en-dark-400-melody-on-review-v4.png)
- [JA Light, 400 px, melody on (review-v4)](practice-guide-compact-issue162-ja-light-400-melody-on-review-v4.png)
- [JA Light, 400 px, 16th-note grid (review-v4)](practice-guide-grid-issue162-ja-light-400-grid-16-review-v4.png)
- [EN Dark, 400 px, portrait attacks and blank melody rests](practice-guide-v4-compact-400-en-dark.png)
- [EN Light, 400 px, portrait attacks and blank melody rests](practice-guide-v4-compact-400-en-light.png)
- [JA Dark, 400 px, portrait attacks and blank melody rests](practice-guide-v4-compact-400-ja-dark.png)
- [JA Light, 400 px, portrait attacks and blank melody rests](practice-guide-v4-compact-400-ja-light.png)
- [EN Dark, 250 ms fade](practice-guide-crossfade-issue162-en-dark-250ms-current-head.png)
- [JA Dark, 500 ms fade](practice-guide-crossfade-issue162-ja-dark-500ms-current-head.png)

The review-v4 images are the current compact-layout evidence. The earlier fade images are retained as references for transition phases; their source commit is shown above. E2E reruns and the implementation source commit are recorded in [`implementation-status.md`](../../implementation-status.md).

## PR #163 review evidence

The compact chord edge regression uses 2, 3, and 4 chord intervals in one four-measure page at an exact 400 CSS px Preview width. Chord diagrams stay in one horizontal row in playback order; each pair scales to its available interval spacing. The E2E checks the name/diagram pair and center, reads both DOM bounds against the card, confirms finger dots, and verifies that neighboring diagrams do not overlap.

- [EN Dark, 400 px, short chord spans and compact diagrams (review-v4)](practice-guide-compact-chord-bounds-issue162-en-dark-400-review-v4.png)
- [EN Dark, 400 px, `sample_gozen0jino_page` with horizontal chord diagrams (review-v4)](practice-guide-horizontal-sample-issue162-en-dark-400-review-v4.png)
- The compact width/melody matrix, grid4/8/16, short-chord, and sample images were refreshed for all four locale/theme combinations in the review-v4 E2E runs.

The refreshed `sample_gozen0jino_page` capture also verifies that dense stroke symbols remain in one horizontal row in the compact guide. A focused E2E checks exact beat anchors, visual offsets for simultaneous marks, canonical continuation-wave paths and stroke width through grid4/8/16 transitions, exact wave counts/Fractions, equal X/Y scaling, accessible names, non-overlap, and card containment at 320–1600 CSS px and melody on/off.
