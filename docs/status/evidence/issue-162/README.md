# Issue #162 Practice Guide evidence

These PNGs show the compact four-measure Practice Guide and tempo-linked bank fade captured in the VS Code 1.144.0 Extension Development Host on macOS arm64. The Japanese runs used the installed Japanese language pack; English runs used the default locale. The `contract-v7-final` images show the current single-row lyric behavior and both guide modes' hidden left rail. The `review-v4` and `contract-v4` images are historical captures; the `v5-a8af442` matrix and `practice-guide-v5` images show the exact-path geometry at the source HEAD `a8af44221e095132ab07cc542e044650d1f07349`.

## Capture matrix

| Evidence | Cases | Files |
|---|---|---:|
| Compact layout (prior review-v4) | 400 / 421 / 600 / 1100 CSS px × JA / EN × Light / Dark × Melody on / off | 32 |
| Continuation marks (prior review-v4) | 400 CSS px × grid 4 / 8 / 16 × JA / EN × Light / Dark | 12 |
| Short chord spans and sample (prior review-v4) | 400 CSS px × JA / EN × Light / Dark | 8 |
| Contract v4 compact layout | 400 / 421 / 600 / 1100 CSS px × JA / EN × Light / Dark × Melody on / off | 32 |
| Contract v4 continuation marks | 400 CSS px × grid 4 / 8 / 16 × JA / EN × Light / Dark | 12 |
| Contract v4 short chord spans and sample | 400 CSS px × JA / EN × Light / Dark | 8 |
| Contract v4 portrait attack geometry and blank compact melody rests | 400 CSS px × JA / EN × Light / Dark | 4 |
| Contract v5 exact-path strokes, 400px / 16th-note grid | JA / EN × Light / Dark | 4 |
| Contract v5 historical compact layout | 400 / 421 / 600 / 1100 CSS px × JA / EN × Light / Dark × Melody on / off | 32 |
| Contract v5 historical continuation marks | 400 CSS px × grid 4 / 8 / 16 × JA / EN × Light / Dark | 12 |
| Contract v5 historical short chord spans and sample | 400 CSS px × JA / EN × Light / Dark | 8 |
| Contract v7 compact layout matrix | 400 / 421 / 600 / 1100 CSS px × JA / EN × Light / Dark × Melody on / off | 32 |
| Contract v7 continuation marks | 400 CSS px × grid 4 / 8 / 16 × JA / EN × Light / Dark | 12 |
| Contract v7 compact lyrics | 400 CSS px × selected JA / EN verse; 600 CSS px × selected EN verse; JA / EN locale × Light / Dark | 12 |
| Four-measure fade reference (prior capture) | 1600 CSS px × JA / EN × Light / Dark | 4 |
| Crossfade phases (prior capture) | 1600 CSS px × 0 / 250 / 500 ms × JA / EN × Light / Dark | 12 |
| **Selected evidence files** |  | **236** |

The 52 `review-v4` and 52 `contract-v4` compact/grid/chord/sample PNGs are historical captures. The complete v4 matrix has 32 compact-layout PNGs, 12 grid PNGs, four short-chord PNGs, and four `sample_gozen0jino_page` PNGs. They have valid PNG headers, the expected CSS-pixel width, nonzero height, and at least 20 KB. Their E2E checked computed lyric contrast, technique-anchor geometry, canonical wave `d` and stroke width, per-grid wave counts and Fractions, and the v4 equal X/Y SVG scale. At 400 px and grid 16, the original 12px wave SVG was retained and uniformly scaled; recognition below the 12px reference interval was not required. Representative v4 compact layouts and the 16th-note grid were visually inspected in both locales and themes. The earlier review-v3 compact/grid images remain historical evidence. The 16 fade reference/phase images retain the earlier visual capture at source commit `c7d1f9d2f992041ceffc9f77e99ea5b21f6e5ddd`; the fade lifecycle is covered by current-HEAD tests below.

The v4 portrait-geometry/rest PNGs are each exactly 400 × 699 pixels and approximately 52 KB. Their E2E checked the 10 × 36 compact attack viewBox, 5 × 5 arrowhead, shaft height of at least 27 local units, uniform X/Y scaling, all four fixed technique colors, opacity 1, and 1.7–2.0 local stroke widths. The computed colors are normal `#1f2937`, past `#475569`, next `#37465e`, and current `#005f85`; their sRGB contrast ratios against white are 14.68:1, 7.58:1, 9.54:1, and 7.06:1. The E2E also verified zero compact melody-rest nodes, the unchanged following pitch-bar beat/duration, and retained rests in the detailed grid. These are retained as historical v4 images.

The 52-image v5 matrix was captured from source HEAD `a8af44221e095132ab07cc542e044650d1f07349` in four locale/theme combinations: 32 compact-layout, 12 grid 4/8/16, four short-chord, and four `sample_gozen0jino_page` images. Every image has a valid PNG header, its expected width, nonzero height, and is larger than 20 KB. The dedicated four v5 exact-path images are each exactly 400 × 699 pixels. Each capture was made from the Extension Development Host with the compact guide visible, four measure cards, melody lane, and sixteen horizontal attacks per measure. The v5 E2E checked the 4 × 30 attack viewBox, exact shaft and arrowhead path bounds, at least 26 CSS px of visible shaft, a 1.0–1.2 CSS px non-scaling stroke, X-only compression, zero overlap, continuation waves, PM marks, fixed state colors/opacity, and blank compact melody rests while preserving the detailed-grid rests. A 48px abnormal-width case also confirms that sub-2px marks remain in the DOM with their event/Fraction/ARIA identity and fixed Y scale. I visually inspected all four dedicated images for the JA/EN and Light/Dark rendering and the four-measure horizontal layout.

Contract v7 adds 56 current-source images in four locale/theme combinations. The 32-image compact matrix and 12-image grid matrix were captured at source HEAD `f112864e4c9a8336123e889173de0cefe4dc040c`; each of their four locale/theme capture E2E runs passed (1/1). The compact matrix covers 400/421/600/1100 CSS px with melody on/off, while grid evidence covers 4/8/16 at 400 CSS px. Every matrix image has a valid PNG header, its expected width, nonzero height, and is larger than 20 KB. A separate 12-image lyric matrix was captured from renderer commit `94e49f69726c1e63204ba6cb91eb91d0a7f3b8e9` (the same renderer source as `f112864`); its four locale/theme E2E runs passed (1/1). It contains 400 CSS px selected Japanese and English verses and 600 CSS px selected English verses, all 799px high and larger than 20 KB. The focused lyric E2E verifies the hidden rail has zero width in both compact and detailed modes; four measures remain visible; the routed verse is selected per playback occurrence; all 16 lyric events retain complete source text, accessible name, title, beat, Fraction, and event order on one baseline; resizing clears stale `textLength`; and no lyric overlaps or escapes a card. I visually inspected the 600px English dark image, the 1100px English dark melody-on image, the Japanese light 400px grid-16 image, and representative Japanese/English lyric images.

## Representative images

- [EN Dark, 400 px, compact layout (Contract v5 historical)](practice-guide-compact-issue162-en-dark-400-melody-on-v5-a8af442.png)
- [EN Light, 421 px, compact layout with melody off (Contract v4)](practice-guide-compact-issue162-en-light-421-melody-off-contract-v4.png)
- [JA Light, 1100 px, compact layout (Contract v4)](practice-guide-compact-issue162-ja-light-1100-melody-on-contract-v4.png)
- [EN Light, 400 px, 16th-note grid (Contract v5 historical)](practice-guide-grid-issue162-en-light-400-grid-16-v5-a8af442.png)
- [EN Dark, 400 px, short chord spans (Contract v5 historical)](practice-guide-compact-chord-bounds-issue162-en-dark-400-v5-a8af442.png)
- [JA Dark, 400 px, `sample_gozen0jino_page` (Contract v5 historical)](practice-guide-horizontal-sample-issue162-ja-dark-400-v5-a8af442.png)
- [EN Dark, 400 px, portrait attacks and blank melody rests](practice-guide-v4-compact-400-en-dark.png)
- [EN Light, 400 px, portrait attacks and blank melody rests](practice-guide-v4-compact-400-en-light.png)
- [JA Dark, 400 px, portrait attacks and blank melody rests](practice-guide-v4-compact-400-ja-dark.png)
- [JA Light, 400 px, portrait attacks and blank melody rests](practice-guide-v4-compact-400-ja-light.png)
- [EN Dark, 400 px, v5 exact-path strokes](practice-guide-v5-compact-400-en-dark.png)
- [EN Light, 400 px, v5 exact-path strokes](practice-guide-v5-compact-400-en-light.png)
- [JA Dark, 400 px, v5 exact-path strokes](practice-guide-v5-compact-400-ja-dark.png)
- [JA Light, 400 px, v5 exact-path strokes](practice-guide-v5-compact-400-ja-light.png)
- [EN Dark, 250 ms fade](practice-guide-crossfade-issue162-en-dark-250ms-current-head.png)
- [JA Dark, 500 ms fade](practice-guide-crossfade-issue162-ja-dark-500ms-current-head.png)
- [EN Dark, 600 px, compact selected lyrics (Contract v7)](practice-guide-compact-lyrics-issue162-en-en-dark-600-contract-v7-final.png)
- [EN Dark, 1100 px, compact melody on (Contract v7)](practice-guide-compact-issue162-en-dark-1100-melody-on-contract-v7-matrix.png)
- [JA Light, 400 px, grid 16 (Contract v7)](practice-guide-grid-issue162-ja-light-400-grid-16-contract-v7-matrix.png)
- [JA Light, 400 px, Japanese selected lyrics (Contract v7)](practice-guide-compact-lyrics-issue162-ja-ja-light-400-contract-v7-final.png)
- [EN Dark, 400 px, English selected lyrics (Contract v7)](practice-guide-compact-lyrics-issue162-en-en-dark-400-contract-v7-final.png)

The v5 exact-path images and 52-image v5 matrix are historical evidence from source HEAD `a8af44221e095132ab07cc542e044650d1f07349`. The v7 matrix and lyric images show the updated label-rail and one-line lyric behavior. The v4 matrix and portrait/rest images are retained as earlier contract evidence, and the earlier fade images are retained as references for transition phases; their source commits are shown above. E2E reruns and the implementation source commit are recorded in [`implementation-status.md`](../../implementation-status.md).

## PR #163 review evidence

The compact chord edge regression uses 2, 3, and 4 chord intervals in one four-measure page at an exact 400 CSS px Preview width. Chord diagrams stay in one horizontal row in playback order; each pair scales to its available interval spacing. The E2E checks the name/diagram pair and center, reads both DOM bounds against the card, confirms finger dots, and verifies that neighboring diagrams do not overlap.

Contract v5 adds the exact attack/wave paths from the supplied reference pattern. The crop and its exact SVG target are kept beside the rendered captures for direct visual review.

- [Supplied stroke-pattern reference crop](user-reference-stroke-pattern-crop.png)
- [Exact SVG path target](stroke-svg-shape-target.svg)
- [JA Light, 400 px, short chord spans and compact diagrams (Contract v4)](practice-guide-compact-chord-bounds-issue162-ja-light-400-contract-v4.png)
- [JA Dark, 400 px, `sample_gozen0jino_page` with horizontal chord diagrams (Contract v5 historical)](practice-guide-horizontal-sample-issue162-ja-dark-400-v5-a8af442.png)
- The compact width/melody matrix, grid 4/8/16, short-chord, and sample images were refreshed for all four locale/theme combinations at the historical v5 source HEAD `a8af44221e095132ab07cc542e044650d1f07349`. The v7 width/melody and grid matrices are recorded above.

The refreshed `sample_gozen0jino_page` capture verifies that dense stroke symbols remain in one horizontal row in the compact guide. Contract v5 adds the exact 4 × 30 attack paths and short 5.6 × 30 continuation paths; only the X dimension compresses, while vertical geometry and the non-scaling stroke are preserved. A focused E2E checks exact beat anchors, visual offsets for simultaneous marks, canonical continuation-wave paths and stroke width through grid4/8/16 transitions, exact wave counts/Fractions, X-only scaling, accessible names, non-overlap, and card containment at 320–1600 CSS px and melody on/off.
