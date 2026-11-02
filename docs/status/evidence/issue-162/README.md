# Issue #162 Practice Guide evidence

These PNGs show the compact four-measure Practice Guide and tempo-linked bank fade captured in the VS Code 1.144.0 Extension Development Host on macOS arm64. The Japanese runs used the installed Japanese language pack; English runs used the default locale. Contract v10 is the current visual evidence for PM annotations below arrows and duration-aware lyric sizing; v9 remains historical evidence for gapless measure boundaries and the adjacent next-chord area. Contract v8 screenshots remain historical evidence for the dedicated 16th-grid wave, non-compressed lyrics, full current lyric in the header, and hidden left rail. The 32-image v8 compact matrix was captured from implementation source HEAD `2ff95de7c456754a58b4bc784dfbd66654cd4afd`. The `contract-v7-final` files and earlier matrices remain historical; the `v5-a8af442` matrix and `practice-guide-v5` images show the exact-path geometry at source HEAD `a8af44221e095132ab07cc542e044650d1f07349`.

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
| Contract v8 compact layout matrix | 400 / 421 / 600 / 1100 CSS px × JA / EN × Light / Dark × Melody on / off | 32 |
| Contract v8 continuation marks | 400 CSS px × grid 4 / 8 / 16 × JA / EN × Light / Dark | 12 |
| Contract v8 current lyric and compact cells | 400 / 600 CSS px × selected JA / EN verse × JA / EN locale × Light / Dark | 16 |
| Contract v9 gapless compact layout matrix | 400 / 421 / 600 / 1100 CSS px × JA / EN × Light / Dark × Melody on / off | 32 |
| Contract v9 gapless continuation marks | 400 CSS px × grid 4 / 8 / 16 × JA / EN × Light / Dark | 12 |
| Contract v9 current lyric and compact cells | 400 / 600 CSS px × selected JA / EN verse × JA / EN locale × Light / Dark | 16 |
| Contract v9 gapless grid16 fade | 400 CSS px × JA / EN × Light / Dark | 4 |
| Contract v10 PM annotations | 400 CSS px × JA / EN × Light / Dark | 4 |
| Contract v10 duration-aware lyrics | 400 / 600 CSS px × selected JA / EN verse × JA / EN locale × Light / Dark | 16 |
| Four-measure fade reference (prior capture) | 1600 CSS px × JA / EN × Light / Dark | 4 |
| Crossfade phases (prior capture) | 1600 CSS px × 0 / 250 / 500 ms × JA / EN × Light / Dark | 12 |
| **Selected evidence files** |  | **380** |

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
- [JA Light, 400 px, grid 16 (Contract v8)](practice-guide-grid-issue162-ja-light-400-grid-16-contract-v8.png)
- [EN Dark, 400 px, compact layout, melody on (Contract v8)](practice-guide-compact-issue162-en-dark-400-melody-on-contract-v8.png)
- [JA Light, 421 px, compact layout, melody off (Contract v8)](practice-guide-compact-issue162-ja-light-421-melody-off-contract-v8.png)
- [EN Dark, 400 px, grid 16 (Contract v8)](practice-guide-grid-issue162-en-dark-400-grid-16-contract-v8.png)
- [JA Light, 400 px, selected Japanese lyrics and current-lyric header (Contract v8)](practice-guide-compact-lyrics-issue162-ja-ja-light-400-contract-v8.png)
- [EN Dark, 400 px, dense English lyric cells and full current-lyric header (Contract v8)](practice-guide-compact-lyrics-issue162-en-en-dark-400-contract-v8.png)
- [EN Dark, 600 px, Japanese verse (Contract v8)](practice-guide-compact-lyrics-issue162-ja-en-dark-600-contract-v8.png)
- [JA Light, 600 px, English verse (Contract v8)](practice-guide-compact-lyrics-issue162-en-ja-light-600-contract-v8.png)

The v5 exact-path images and 52-image v5 matrix are historical evidence from source HEAD `a8af44221e095132ab07cc542e044650d1f07349`. The v7 matrix and lyric images are retained as prior-contract captures. Contract v8 remains historical visual evidence for compact lyric overflow and grid16 path shape; v9 is historical for gapless compact geometry. Contract v10 is current for PM placement and duration-aware lyrics. The v4 matrix and portrait/rest images remain earlier contract evidence, and the earlier fade images remain references for transition phases; their source commits are shown above. E2E reruns and the implementation source commit are recorded in [`implementation-status.md`](../../implementation-status.md).


## Contract v8 evidence

The 60 current-source images comprise a 32-image compact layout matrix, 12 grid captures, and 16 lyric/current-header captures. The compact matrix covers 400/421/600/1100 CSS px × JA/EN × Light/Dark × melody on/off; its E2E also measures the broader 320/360/400/421/480/600/840/1100/1600px responsive series. The grid captures cover JA/EN × Light/Dark at 400 CSS px for grid4, grid8, and grid16. The lyric captures cover selected Japanese and English verses at 400 and 600 CSS px in both locales and themes. Each lyric capture contains the single current-lyric header; 400 px dense cells visibly truncate text without changing stored event text, while 600 px captures show the wider layout. E2E checks real VS Code locale, output width, card containment, 10–13 px browser-measured text, absence of `textLength`/`spacingAndGlyphs`, and the full current lyric after seek.

### Contract v8 compact layout captures (implementation source HEAD `2ff95de7c456754a58b4bc784dfbd66654cd4afd`)
- [EN Dark, 400 px, melody on](practice-guide-compact-issue162-en-dark-400-melody-on-contract-v8.png)
- [EN Dark, 400 px, melody off](practice-guide-compact-issue162-en-dark-400-melody-off-contract-v8.png)
- [EN Dark, 421 px, melody on](practice-guide-compact-issue162-en-dark-421-melody-on-contract-v8.png)
- [EN Dark, 421 px, melody off](practice-guide-compact-issue162-en-dark-421-melody-off-contract-v8.png)
- [EN Dark, 600 px, melody on](practice-guide-compact-issue162-en-dark-600-melody-on-contract-v8.png)
- [EN Dark, 600 px, melody off](practice-guide-compact-issue162-en-dark-600-melody-off-contract-v8.png)
- [EN Dark, 1100 px, melody on](practice-guide-compact-issue162-en-dark-1100-melody-on-contract-v8.png)
- [EN Dark, 1100 px, melody off](practice-guide-compact-issue162-en-dark-1100-melody-off-contract-v8.png)
- [EN Light, 400 px, melody on](practice-guide-compact-issue162-en-light-400-melody-on-contract-v8.png)
- [EN Light, 400 px, melody off](practice-guide-compact-issue162-en-light-400-melody-off-contract-v8.png)
- [EN Light, 421 px, melody on](practice-guide-compact-issue162-en-light-421-melody-on-contract-v8.png)
- [EN Light, 421 px, melody off](practice-guide-compact-issue162-en-light-421-melody-off-contract-v8.png)
- [EN Light, 600 px, melody on](practice-guide-compact-issue162-en-light-600-melody-on-contract-v8.png)
- [EN Light, 600 px, melody off](practice-guide-compact-issue162-en-light-600-melody-off-contract-v8.png)
- [EN Light, 1100 px, melody on](practice-guide-compact-issue162-en-light-1100-melody-on-contract-v8.png)
- [EN Light, 1100 px, melody off](practice-guide-compact-issue162-en-light-1100-melody-off-contract-v8.png)
- [JA Dark, 400 px, melody on](practice-guide-compact-issue162-ja-dark-400-melody-on-contract-v8.png)
- [JA Dark, 400 px, melody off](practice-guide-compact-issue162-ja-dark-400-melody-off-contract-v8.png)
- [JA Dark, 421 px, melody on](practice-guide-compact-issue162-ja-dark-421-melody-on-contract-v8.png)
- [JA Dark, 421 px, melody off](practice-guide-compact-issue162-ja-dark-421-melody-off-contract-v8.png)
- [JA Dark, 600 px, melody on](practice-guide-compact-issue162-ja-dark-600-melody-on-contract-v8.png)
- [JA Dark, 600 px, melody off](practice-guide-compact-issue162-ja-dark-600-melody-off-contract-v8.png)
- [JA Dark, 1100 px, melody on](practice-guide-compact-issue162-ja-dark-1100-melody-on-contract-v8.png)
- [JA Dark, 1100 px, melody off](practice-guide-compact-issue162-ja-dark-1100-melody-off-contract-v8.png)
- [JA Light, 400 px, melody on](practice-guide-compact-issue162-ja-light-400-melody-on-contract-v8.png)
- [JA Light, 400 px, melody off](practice-guide-compact-issue162-ja-light-400-melody-off-contract-v8.png)
- [JA Light, 421 px, melody on](practice-guide-compact-issue162-ja-light-421-melody-on-contract-v8.png)
- [JA Light, 421 px, melody off](practice-guide-compact-issue162-ja-light-421-melody-off-contract-v8.png)
- [JA Light, 600 px, melody on](practice-guide-compact-issue162-ja-light-600-melody-on-contract-v8.png)
- [JA Light, 600 px, melody off](practice-guide-compact-issue162-ja-light-600-melody-off-contract-v8.png)
- [JA Light, 1100 px, melody on](practice-guide-compact-issue162-ja-light-1100-melody-on-contract-v8.png)
- [JA Light, 1100 px, melody off](practice-guide-compact-issue162-ja-light-1100-melody-off-contract-v8.png)

### Contract v8 grid and lyric captures (implementation source HEAD `2ff95de7c456754a58b4bc784dfbd66654cd4afd`)
- [JA Light, 400 px, grid 4](practice-guide-grid-issue162-ja-light-400-grid-4-contract-v8.png)
- [JA Light, 400 px, grid 8](practice-guide-grid-issue162-ja-light-400-grid-8-contract-v8.png)
- [JA Light, 400 px, grid 16](practice-guide-grid-issue162-ja-light-400-grid-16-contract-v8.png)
- [JA Dark, 400 px, grid 4](practice-guide-grid-issue162-ja-dark-400-grid-4-contract-v8.png)
- [JA Dark, 400 px, grid 8](practice-guide-grid-issue162-ja-dark-400-grid-8-contract-v8.png)
- [JA Dark, 400 px, grid 16](practice-guide-grid-issue162-ja-dark-400-grid-16-contract-v8.png)
- [EN Light, 400 px, grid 4](practice-guide-grid-issue162-en-light-400-grid-4-contract-v8.png)
- [EN Light, 400 px, grid 8](practice-guide-grid-issue162-en-light-400-grid-8-contract-v8.png)
- [EN Light, 400 px, grid 16](practice-guide-grid-issue162-en-light-400-grid-16-contract-v8.png)
- [EN Dark, 400 px, grid 4](practice-guide-grid-issue162-en-dark-400-grid-4-contract-v8.png)
- [EN Dark, 400 px, grid 8](practice-guide-grid-issue162-en-dark-400-grid-8-contract-v8.png)
- [EN Dark, 400 px, grid 16](practice-guide-grid-issue162-en-dark-400-grid-16-contract-v8.png)
- [JA verse, JA Light, 400 px](practice-guide-compact-lyrics-issue162-ja-ja-light-400-contract-v8.png)
- [JA verse, JA Light, 600 px](practice-guide-compact-lyrics-issue162-ja-ja-light-600-contract-v8.png)
- [JA verse, JA Dark, 400 px](practice-guide-compact-lyrics-issue162-ja-ja-dark-400-contract-v8.png)
- [JA verse, JA Dark, 600 px](practice-guide-compact-lyrics-issue162-ja-ja-dark-600-contract-v8.png)
- [JA verse, EN Light, 400 px](practice-guide-compact-lyrics-issue162-ja-en-light-400-contract-v8.png)
- [JA verse, EN Light, 600 px](practice-guide-compact-lyrics-issue162-ja-en-light-600-contract-v8.png)
- [JA verse, EN Dark, 400 px](practice-guide-compact-lyrics-issue162-ja-en-dark-400-contract-v8.png)
- [JA verse, EN Dark, 600 px](practice-guide-compact-lyrics-issue162-ja-en-dark-600-contract-v8.png)
- [EN verse, JA Light, 400 px](practice-guide-compact-lyrics-issue162-en-ja-light-400-contract-v8.png)
- [EN verse, JA Light, 600 px](practice-guide-compact-lyrics-issue162-en-ja-light-600-contract-v8.png)
- [EN verse, JA Dark, 400 px](practice-guide-compact-lyrics-issue162-en-ja-dark-400-contract-v8.png)
- [EN verse, JA Dark, 600 px](practice-guide-compact-lyrics-issue162-en-ja-dark-600-contract-v8.png)
- [EN verse, EN Light, 400 px](practice-guide-compact-lyrics-issue162-en-en-light-400-contract-v8.png)
- [EN verse, EN Light, 600 px](practice-guide-compact-lyrics-issue162-en-en-light-600-contract-v8.png)
- [EN verse, EN Dark, 400 px](practice-guide-compact-lyrics-issue162-en-en-dark-400-contract-v8.png)
- [EN verse, EN Dark, 600 px](practice-guide-compact-lyrics-issue162-en-en-dark-600-contract-v8.png)

## PR #163 review evidence

The compact chord edge regression uses 2, 3, and 4 chord intervals in one four-measure page at an exact 400 CSS px Preview width. Chord diagrams stay in one horizontal row in playback order; each pair scales to its available interval spacing. The E2E checks the name/diagram pair and center, reads both DOM bounds against the card, confirms finger dots, and verifies that neighboring diagrams do not overlap.

Contract v8 review remediation removes non-uniform lyric compression, adds one current-lyric header synchronized to the active selected-verse event, uses a dedicated 2.4×30 grid16 continuation path, and squares compact melody bars. The E2E keeps an independent down/up/down/up and Fraction/count oracle for the supplied four-measure fixture, checks painted grid16 wave gaps at 320–1600 CSS px, and verifies the lyric/header behavior across resize and seek. The crop and exact attack/wave targets remain beside the rendered captures for direct visual review.

- [Supplied stroke-pattern reference crop](user-reference-stroke-pattern-crop.png)
- [Exact SVG path target](stroke-svg-shape-target.svg)
- [JA Light, 400 px, short chord spans and compact diagrams (Contract v4)](practice-guide-compact-chord-bounds-issue162-ja-light-400-contract-v4.png)
- [JA Dark, 400 px, `sample_gozen0jino_page` with horizontal chord diagrams (Contract v5 historical)](practice-guide-horizontal-sample-issue162-ja-dark-400-v5-a8af442.png)
- The compact width/melody matrix, grid 4/8/16, short-chord, and sample images were refreshed for all four locale/theme combinations at the historical v5 source HEAD `a8af44221e095132ab07cc542e044650d1f07349`. The v7 width/melody and grid matrices are recorded above.

The refreshed `sample_gozen0jino_page` capture verifies that dense stroke symbols remain in one horizontal row in the compact guide. Contract v5 adds the exact 4 × 30 attack paths and short 5.6 × 30 continuation paths; only the X dimension compresses, while vertical geometry and the non-scaling stroke are preserved. A focused E2E checks exact beat anchors, visual offsets for simultaneous marks, canonical continuation-wave paths and stroke width through grid4/8/16 transitions, exact wave counts/Fractions, X-only scaling, accessible names, non-overlap, and card containment at 320–1600 CSS px and melody on/off.

## Contract v9 evidence

Contract v9 is canonical at Issue comment `6569401245` (14,459 bytes; SHA-256 `d4de9f23fab709df664671ab6375fd76fcf16dea330a03090899e6d2652284a6`). The 64 current evidence images comprise a 32-image gapless compact layout matrix, 12 grid 4/8/16 captures, 16 compact lyric captures, and four 400px grid16 screenshots taken during the fade. All four locale/theme capture runs were executed at implementation HEAD `3788d4bde2fc9ecc5b21bb79b7ab14cb62205cc8`; this HEAD contains the gapless renderer from `fb8d9a94cd39ab802cb42479aba2a39297480c29` plus the test-only viewport and screenshot-handling updates.

Each of the four locale/theme capture runs verified the compact, grid, lyric, and gapless 400px fade cases. The compact matrix E2E also measures all 11 widths 320/360/400/421/480/481/600/601/840/1100/1600px. PNG headers, expected widths, nonzero heights, and the 20KB minimum passed for all 64 selected files. I visually inspected the 400px JA Light top next-chord layout, 600px EN Dark and 1100px JA Light right next-chord layouts, and the 400px grid16 fade images. Measure cards touch at all three boundaries; the next-chord boundary retains its 1px divider; there is no 8px top inset.

### Compact layout matrix (32 images)
- [EN Dark, 400px, melody on](practice-guide-compact-issue162-en-dark-400-melody-on-current-head-3788.png)
- [EN Dark, 400px, melody off](practice-guide-compact-issue162-en-dark-400-melody-off-current-head-3788.png)
- [EN Dark, 421px, melody on](practice-guide-compact-issue162-en-dark-421-melody-on-current-head-3788.png)
- [EN Dark, 421px, melody off](practice-guide-compact-issue162-en-dark-421-melody-off-current-head-3788.png)
- [EN Dark, 600px, melody on](practice-guide-compact-issue162-en-dark-600-melody-on-current-head-3788.png)
- [EN Dark, 600px, melody off](practice-guide-compact-issue162-en-dark-600-melody-off-current-head-3788.png)
- [EN Dark, 1100px, melody on](practice-guide-compact-issue162-en-dark-1100-melody-on-current-head-3788.png)
- [EN Dark, 1100px, melody off](practice-guide-compact-issue162-en-dark-1100-melody-off-current-head-3788.png)
- [EN Light, 400px, melody on](practice-guide-compact-issue162-en-light-400-melody-on-current-head-3788.png)
- [EN Light, 400px, melody off](practice-guide-compact-issue162-en-light-400-melody-off-current-head-3788.png)
- [EN Light, 421px, melody on](practice-guide-compact-issue162-en-light-421-melody-on-current-head-3788.png)
- [EN Light, 421px, melody off](practice-guide-compact-issue162-en-light-421-melody-off-current-head-3788.png)
- [EN Light, 600px, melody on](practice-guide-compact-issue162-en-light-600-melody-on-current-head-3788.png)
- [EN Light, 600px, melody off](practice-guide-compact-issue162-en-light-600-melody-off-current-head-3788.png)
- [EN Light, 1100px, melody on](practice-guide-compact-issue162-en-light-1100-melody-on-current-head-3788.png)
- [EN Light, 1100px, melody off](practice-guide-compact-issue162-en-light-1100-melody-off-current-head-3788.png)
- [JA Dark, 400px, melody on](practice-guide-compact-issue162-ja-dark-400-melody-on-current-head-3788.png)
- [JA Dark, 400px, melody off](practice-guide-compact-issue162-ja-dark-400-melody-off-current-head-3788.png)
- [JA Dark, 421px, melody on](practice-guide-compact-issue162-ja-dark-421-melody-on-current-head-3788.png)
- [JA Dark, 421px, melody off](practice-guide-compact-issue162-ja-dark-421-melody-off-current-head-3788.png)
- [JA Dark, 600px, melody on](practice-guide-compact-issue162-ja-dark-600-melody-on-current-head-3788.png)
- [JA Dark, 600px, melody off](practice-guide-compact-issue162-ja-dark-600-melody-off-current-head-3788.png)
- [JA Dark, 1100px, melody on](practice-guide-compact-issue162-ja-dark-1100-melody-on-current-head-3788.png)
- [JA Dark, 1100px, melody off](practice-guide-compact-issue162-ja-dark-1100-melody-off-current-head-3788.png)
- [JA Light, 400px, melody on](practice-guide-compact-issue162-ja-light-400-melody-on-current-head-3788.png)
- [JA Light, 400px, melody off](practice-guide-compact-issue162-ja-light-400-melody-off-current-head-3788.png)
- [JA Light, 421px, melody on](practice-guide-compact-issue162-ja-light-421-melody-on-current-head-3788.png)
- [JA Light, 421px, melody off](practice-guide-compact-issue162-ja-light-421-melody-off-current-head-3788.png)
- [JA Light, 600px, melody on](practice-guide-compact-issue162-ja-light-600-melody-on-current-head-3788.png)
- [JA Light, 600px, melody off](practice-guide-compact-issue162-ja-light-600-melody-off-current-head-3788.png)
- [JA Light, 1100px, melody on](practice-guide-compact-issue162-ja-light-1100-melody-on-current-head-3788.png)
- [JA Light, 1100px, melody off](practice-guide-compact-issue162-ja-light-1100-melody-off-current-head-3788.png)

### Grid continuation marks (12 images)
- [EN Dark, 400px, grid 4](practice-guide-grid-issue162-en-dark-400-grid-4-current-head-3788.png)
- [EN Dark, 400px, grid 8](practice-guide-grid-issue162-en-dark-400-grid-8-current-head-3788.png)
- [EN Dark, 400px, grid 16](practice-guide-grid-issue162-en-dark-400-grid-16-current-head-3788.png)
- [EN Light, 400px, grid 4](practice-guide-grid-issue162-en-light-400-grid-4-current-head-3788.png)
- [EN Light, 400px, grid 8](practice-guide-grid-issue162-en-light-400-grid-8-current-head-3788.png)
- [EN Light, 400px, grid 16](practice-guide-grid-issue162-en-light-400-grid-16-current-head-3788.png)
- [JA Dark, 400px, grid 4](practice-guide-grid-issue162-ja-dark-400-grid-4-current-head-3788.png)
- [JA Dark, 400px, grid 8](practice-guide-grid-issue162-ja-dark-400-grid-8-current-head-3788.png)
- [JA Dark, 400px, grid 16](practice-guide-grid-issue162-ja-dark-400-grid-16-current-head-3788.png)
- [JA Light, 400px, grid 4](practice-guide-grid-issue162-ja-light-400-grid-4-current-head-3788.png)
- [JA Light, 400px, grid 8](practice-guide-grid-issue162-ja-light-400-grid-8-current-head-3788.png)
- [JA Light, 400px, grid 16](practice-guide-grid-issue162-ja-light-400-grid-16-current-head-3788.png)

### Compact lyric and current-header captures (16 images)
- [JA verse, EN Dark, 400px](practice-guide-compact-lyrics-issue162-ja-en-dark-400-current-head-3788.png)
- [JA verse, EN Dark, 600px](practice-guide-compact-lyrics-issue162-ja-en-dark-600-current-head-3788.png)
- [EN verse, EN Dark, 400px](practice-guide-compact-lyrics-issue162-en-en-dark-400-current-head-3788.png)
- [EN verse, EN Dark, 600px](practice-guide-compact-lyrics-issue162-en-en-dark-600-current-head-3788.png)
- [JA verse, EN Light, 400px](practice-guide-compact-lyrics-issue162-ja-en-light-400-current-head-3788.png)
- [JA verse, EN Light, 600px](practice-guide-compact-lyrics-issue162-ja-en-light-600-current-head-3788.png)
- [EN verse, EN Light, 400px](practice-guide-compact-lyrics-issue162-en-en-light-400-current-head-3788.png)
- [EN verse, EN Light, 600px](practice-guide-compact-lyrics-issue162-en-en-light-600-current-head-3788.png)
- [JA verse, JA Dark, 400px](practice-guide-compact-lyrics-issue162-ja-ja-dark-400-current-head-3788.png)
- [JA verse, JA Dark, 600px](practice-guide-compact-lyrics-issue162-ja-ja-dark-600-current-head-3788.png)
- [EN verse, JA Dark, 400px](practice-guide-compact-lyrics-issue162-en-ja-dark-400-current-head-3788.png)
- [EN verse, JA Dark, 600px](practice-guide-compact-lyrics-issue162-en-ja-dark-600-current-head-3788.png)
- [JA verse, JA Light, 400px](practice-guide-compact-lyrics-issue162-ja-ja-light-400-current-head-3788.png)
- [JA verse, JA Light, 600px](practice-guide-compact-lyrics-issue162-ja-ja-light-600-current-head-3788.png)
- [EN verse, JA Light, 400px](practice-guide-compact-lyrics-issue162-en-ja-light-400-current-head-3788.png)
- [EN verse, JA Light, 600px](practice-guide-compact-lyrics-issue162-en-ja-light-600-current-head-3788.png)

### Gapless grid16 fade (4 images)
- [EN Dark, 400px, grid16 during fade](practice-guide-crossfade-issue162-en-dark-250ms-contract-v9-grid16-400.png)
- [EN Light, 400px, grid16 during fade](practice-guide-crossfade-issue162-en-light-250ms-contract-v9-grid16-400.png)
- [JA Dark, 400px, grid16 during fade](practice-guide-crossfade-issue162-ja-dark-250ms-contract-v9-grid16-400.png)
- [JA Light, 400px, grid16 during fade](practice-guide-crossfade-issue162-ja-light-250ms-contract-v9-grid16-400.png)

## Contract v10 evidence

Contract v10 is canonical at Issue comment `6574706499` (18,451 bytes; SHA-256 `2dbf43f9328bb0d745660081cea43812df1053c33ccc41a2edd9384de6f42e90`). Its 20 new screenshots were captured in the VS Code 1.144.0 Extension Development Host on macOS arm64 from implementation source HEAD `b3c28ee1fa1d2087ee0839c40336578bc0c41cf8`. The four PM images use the 400px dense-stroke fixture; the 16 lyric images cover 400px and 600px selected Japanese/English verses in JA/EN locale and Light/Dark theme combinations.

All 20 PNGs have the expected exact width, nonzero height, and are larger than 20KB. The PM and lyric capture E2Es passed in all four locale/theme combinations. The first EN Dark lyric capture returned an all-black 600px image and failed the size assertion; the focused lyric E2E was rerun once, replaced that file with a rendered 600 × 799 image, and passed. I visually inspected the JA Dark PM image, JA Light 400px Japanese lyric image, EN Dark 400px English lyric image, and EN Dark 600px English lyric image. The PM image keeps arrows in one horizontal row and places the two separated PM runs below them; the lyric images show visible leading characters in the dense 400px cells and the selected full lyric in the header. At 600px, the English text fits more of the available cells. The very small dense-cell text is present but is not claimed to be comfortably readable.

### Full-suite verification refresh

After the earlier full-suite run reported one intermittent Issue #155 Practice-mode convergence failure, `npm test` was rerun from a clean temporary checkout at PR HEAD `caa4b173e853a0f0b5def027e2ccc458787a5022` on macOS arm64 with VS Code 1.144.0. It exited 0: 1,235 unit tests passed and the E2E suite reported 129 passing, 6 pending, and 0 failures. The earlier failure did not recur; its cause remains undetermined, and no implementation change was made for it. The following verification-record commit changes documentation only.

### Compact PM annotations (4 images)
- [JA Light, 400px](practice-guide-compact-pm-issue162-ja-light-400-contract-v10.png)
- [JA Dark, 400px](practice-guide-compact-pm-issue162-ja-dark-400-contract-v10.png)
- [EN Light, 400px](practice-guide-compact-pm-issue162-en-light-400-contract-v10.png)
- [EN Dark, 400px](practice-guide-compact-pm-issue162-en-dark-400-contract-v10.png)

### Duration-aware compact lyrics (16 images)
- [JA verse, JA Light, 400px](practice-guide-compact-lyrics-issue162-ja-ja-light-400-contract-v10.png)
- [JA verse, JA Light, 600px](practice-guide-compact-lyrics-issue162-ja-ja-light-600-contract-v10.png)
- [EN verse, JA Light, 400px](practice-guide-compact-lyrics-issue162-en-ja-light-400-contract-v10.png)
- [EN verse, JA Light, 600px](practice-guide-compact-lyrics-issue162-en-ja-light-600-contract-v10.png)
- [JA verse, JA Dark, 400px](practice-guide-compact-lyrics-issue162-ja-ja-dark-400-contract-v10.png)
- [JA verse, JA Dark, 600px](practice-guide-compact-lyrics-issue162-ja-ja-dark-600-contract-v10.png)
- [EN verse, JA Dark, 400px](practice-guide-compact-lyrics-issue162-en-ja-dark-400-contract-v10.png)
- [EN verse, JA Dark, 600px](practice-guide-compact-lyrics-issue162-en-ja-dark-600-contract-v10.png)
- [JA verse, EN Light, 400px](practice-guide-compact-lyrics-issue162-ja-en-light-400-contract-v10.png)
- [JA verse, EN Light, 600px](practice-guide-compact-lyrics-issue162-ja-en-light-600-contract-v10.png)
- [EN verse, EN Light, 400px](practice-guide-compact-lyrics-issue162-en-en-light-400-contract-v10.png)
- [EN verse, EN Light, 600px](practice-guide-compact-lyrics-issue162-en-en-light-600-contract-v10.png)
- [JA verse, EN Dark, 400px](practice-guide-compact-lyrics-issue162-ja-en-dark-400-contract-v10.png)
- [JA verse, EN Dark, 600px](practice-guide-compact-lyrics-issue162-ja-en-dark-600-contract-v10.png)
- [EN verse, EN Dark, 400px](practice-guide-compact-lyrics-issue162-en-en-dark-400-contract-v10.png)
- [EN verse, EN Dark, 600px](practice-guide-compact-lyrics-issue162-en-en-dark-600-contract-v10.png)
