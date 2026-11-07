# Issue #162 Practice Guide evidence

These PNGs show the compact four-measure Practice Guide and tempo-linked bank fade captured in the VS Code Extension Development Host on macOS arm64. The Japanese runs used the installed Japanese language pack; English runs used the default locale. Contract v13 is the current visual evidence: in addition to v12's shared lyric size, fixed melody geometry, hidden left rail, removed current-lyric header, and complete common-size diagrams, it verifies visible grid16 waves at 400/600 px and code-name width recovery after resize. Contract v12 and earlier screenshots remain historical evidence; v11 retained the then-current lyric header, v10 used per-event lyric sizing, and v8 used the shallow dedicated grid16 wave. The 32-image v8 compact matrix was captured from implementation source HEAD `2ff95de7c456754a58b4bc784dfbd66654cd4afd`. The `contract-v7-final` files and earlier matrices remain historical; the `v5-a8af442` matrix and `practice-guide-v5` images show the exact-path geometry at source HEAD `a8af44221e095132ab07cc542e044650d1f07349`.

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
| Contract v11 uniform-size lyric matrix | 400 / 600 CSS px × selected JA / EN verse × JA / EN locale × Light / Dark | 16 |
| Contract v11 uniform lyrics | 600 CSS px × mixed 16th / quarter / half-note fixture × EN locale / Dark | 1 |
| Contract v12 complete mixed-duration lyric screenshot | 600 × 740 CSS px × EN locale / Dark, with DOM bounds | 1 |
| Contract v12 common chord-diagram screenshot | 600 CSS px × `sample_gozen0jino_page` × EN locale / Dark | 1 |
| Contract v13 grid16 wave screenshots | 400 CSS px × JA locale × Light / Dark; 600 CSS px × EN locale × Light / Dark | 4 |
| Contract v13 painted-wave DOM measurement sidecars | Same four locale/theme/width combinations, with path bounds, stroke color, height, width, gap, and variant | 4 |
| Four-measure fade reference (prior capture) | 1600 CSS px × JA / EN × Light / Dark | 4 |
| Crossfade phases (prior capture) | 1600 CSS px × 0 / 250 / 500 ms × JA / EN × Light / Dark | 12 |
| **Selected evidence files** |  | **407** |

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

The v5 exact-path images and 52-image v5 matrix are historical evidence from source HEAD `a8af44221e095132ab07cc542e044650d1f07349`. The v7 matrix and lyric images are retained as prior-contract captures. Contract v8 remains historical visual evidence for compact lyric overflow and grid16 path shape; v9 is historical for gapless compact geometry. The v4 matrix and portrait/rest images remain earlier contract evidence, and the earlier fade images remain references for transition phases; their source commits are shown above. E2E reruns and the implementation source commit are recorded in [`implementation-status.md`](../../implementation-status.md).


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

### Contract v13 grid16 wave and resize evidence

Contract v13 is canonical at Issue comment `6704603787` (13,172 bytes; SHA-256 `ac580d004632e22c58d11bff38b2774b1109322fbdeb8a1ffb2c58559be9fc36`). Four current-source screenshots include the real 16th-grid continuation fixture: JA Light/Dark at 400 px select the 4.2-wide medium path; EN Light/Dark at 600 px use the 504 px four-card stage beside the 96 px next-chord column, so each 126 px slot selects the 5.6-wide wide path. Every capture retains four measure cards and 48 independent grid16 continuation marks. The DOM sidecars record painted height ≥7 px, painted width within the cell, at least 1 px between neighboring marks, `stroke=currentColor`, the selected variant, and each path's event/Fraction. The same E2E matrix checks 320/360/400/421/480/600/1100/1600 px, exact wave counts/Fractions, selected and hidden grids, template/live-bank synchronization, and variant changes across resize and grid switches. A separate E2E checks long chord labels through 400→1100→400→1100 against a fresh 1100 px layout.

| Width / locale / theme | Screenshot | DOM sidecar | Measured wave result / PNG SHA-256 |
|---|---|---|---|
| 400 px / JA / Light | [PNG](practice-guide-compact-wave-issue162-ja-light-400-wave-v13.png) | [JSON](practice-guide-compact-wave-issue162-ja-light-400-wave-v13.json) | medium; 8.05 px high; max 4.45 px wide; min gap 1.30 px; `3e00a84b42a71783030f212f5bf6590cd024aaf89dca3512ec58a98ad21e6b63` |
| 400 px / JA / Dark | [PNG](practice-guide-compact-wave-issue162-ja-dark-400-wave-v13.png) | [JSON](practice-guide-compact-wave-issue162-ja-dark-400-wave-v13.json) | medium; 8.05 px high; max 4.45 px wide; min gap 1.30 px; `27576008e0fc59435d8280ec223a7dba2c3b51ae98c794c572afb8311d4780d8` |
| 600 px / EN / Light | [PNG](practice-guide-compact-wave-issue162-en-light-600-wave-v13.png) | [JSON](practice-guide-compact-wave-issue162-en-light-600-wave-v13.json) | wide; 7.45 px high; max 5.95 px wide; min gap 1.43 px; `d8ff23bac711626140a75caa9162c6457e6b7b6147a59c983c4167678d2b8751` |
| 600 px / EN / Dark | [PNG](practice-guide-compact-wave-issue162-en-dark-600-wave-v13.png) | [JSON](practice-guide-compact-wave-issue162-en-dark-600-wave-v13.json) | wide; 7.45 px high; max 5.95 px wide; min gap 1.43 px; `85ba552b7d72eb4b7ec5c70b5b74d42070b661329cb20add6e5466f28a175b78` |

- [User-supplied stroke-pattern reference crop](user-reference-stroke-pattern-crop.png)
- [Contract v13 fixed wave-path target](stroke-wave-v13-shape-target.svg)

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

## Contract v12 evidence

Contract v12 is canonical at Issue comment `6688929860` (8,202 bytes; SHA-256 `12e48408413d09b044a632e46c186e8a7a883180c3fbcc8def33c4c81b77a543`). It preserves the v11 song-wide lyric size while removing the duplicate current-lyric header, fixing melody-lane geometry, and requiring every chord diagram to use the same complete square size. The left label rail remains hidden.

The mixed-duration capture was made in the macOS arm64 VS Code 1.145.2 Extension Development Host at 600 × 740 CSS px with the Workbench sidebars and status bar hidden. It shows all four cards, the lower lyric lane, the full chord diagrams, and the next-chord aside. The E2E records and asserts the viewport, stage, every card, and next-chord rectangles; the stage spans `(0, 429)` to `(504, 739)`, and the next-chord aside spans `(504, 429)` to `(600, 739)`. The PNG is 600 × 740, 59 KB, SHA-256 `709557ac3ad8a00cfbd794b9a49414d208fac575e98a6e24158c3312e65a9178`; the bounds sidecar is SHA-256 `40a62eacad4ca93eba6e23978f199cec52add99d63c0f0ff127548eff076b77e`.

The `sample_gozen0jino_page` image is 600 × 710, 65 KB, SHA-256 `2c47b359549639f9c91060ef443fe502bde9ac846f29dba5962b95a463852d15`. Its E2E checks the same song-wide square size in one- and two-chord measures and verifies the full `0 0 144 144` diagrams remain inside their lanes. Both images were visually inspected.

- [Mixed lyric durations with all four measures, 600 × 740, EN Dark](practice-guide-compact-uniform-lyrics-issue162-en-dark-600-contract-v12.png)
- [Mixed one- and two-chord measures, 600px, EN Dark](practice-guide-horizontal-sample-issue162-en-dark-600-contract-v12.png)
- [Mixed lyric screenshot DOM bounds](practice-guide-compact-uniform-lyrics-issue162-en-dark-600-contract-v12.bounds.json)

An earlier 600 × 710 lyric capture and its bounds are retained under the `incomplete-v12` filename for diagnostic history; that candidate placed card bottoms below the captured viewport and is excluded from the selected evidence count. The final capture and DOM bounds above pass the full-viewport assertion.

### Verification at the v12 implementation

`npm run compile`, `npm run compile:tests`, `npm run vscode:prepublish`, `npm run check:help`, `npm run check:ai`, `npm run test:unit` (1,235 tests), `verify-implementation-contract 162`, and `validate-docs --issue 162` passed. The full `npm test` run exited 1: 130 E2E passed, 6 remained pending, and 2 timed out while the VS Code Workbench window was unfocused according to the bounded failure traces (the 120-second bank crossfade case and 90-second 400px dual-bank lyric fade case). One combined focused diagnostic also failed during snapshot restoration: the test host could not be foregrounded within two seconds, and the next test's before hook then failed for the same reason. The suite is therefore recorded as failed, despite the focused compact geometry, song-wide lyric, LY07/LY08, and 600px capture checks passing. `vsce ls` was not run because the npm registry hostname could not be resolved (`ENOTFOUND`).

## Contract v11 evidence

Contract v11 is canonical at Issue comment `6581189304` (7,994 bytes; SHA-256 `26b92f44855d02d40e31de21e6fdea1a93dd832e3cc1bc017b9981e5143ba597`). Its fresh 16-image lyric matrix and mixed-duration screenshot below were captured from implementation source HEAD `1a484a5400139e6e37c379a8124c41aa8fd70f84` in the VS Code 1.144.0 Extension Development Host on macOS arm64. The matrix covers 400 and 600 CSS px, selected Japanese and English verses, both JA/EN UI locales, and Light/Dark themes. All 16 captures have the exact requested width, nonzero height, and are larger than 20KB. The focused lyric capture E2E passed in all four locale/theme combinations; it checks the full-text header and one common font size across the song after resize.

The mixed-duration capture shows four compact measure cards with sixteenth-, quarter-, and half-note lyrics at a 600 CSS px Preview width. Its PNG dimensions are 600 × 699 and SHA-256 is `f20a2050cdaa22ebfbb3bdc071f7bd72e183ce974f5f4682c66bfe2fbe02ce29`. The focused v11 lyric E2E passed at this source HEAD and verified every rendered event uses the same computed font size at 400 and 600 px; resize recalculates that common size for the song.

- [Mixed note durations, 600px, EN Dark](practice-guide-compact-uniform-lyrics-issue162-en-dark-600-contract-v11.png)

### Compact lyric capture matrix (16 images)

- [JA verse, JA Light, 400px](practice-guide-compact-lyrics-issue162-ja-ja-light-400-contract-v11.png)
- [JA verse, JA Light, 600px](practice-guide-compact-lyrics-issue162-ja-ja-light-600-contract-v11.png)
- [EN verse, JA Light, 400px](practice-guide-compact-lyrics-issue162-en-ja-light-400-contract-v11.png)
- [EN verse, JA Light, 600px](practice-guide-compact-lyrics-issue162-en-ja-light-600-contract-v11.png)
- [JA verse, JA Dark, 400px](practice-guide-compact-lyrics-issue162-ja-ja-dark-400-contract-v11.png)
- [JA verse, JA Dark, 600px](practice-guide-compact-lyrics-issue162-ja-ja-dark-600-contract-v11.png)
- [EN verse, JA Dark, 400px](practice-guide-compact-lyrics-issue162-en-ja-dark-400-contract-v11.png)
- [EN verse, JA Dark, 600px](practice-guide-compact-lyrics-issue162-en-ja-dark-600-contract-v11.png)
- [JA verse, EN Light, 400px](practice-guide-compact-lyrics-issue162-ja-en-light-400-contract-v11.png)
- [JA verse, EN Light, 600px](practice-guide-compact-lyrics-issue162-ja-en-light-600-contract-v11.png)
- [EN verse, EN Light, 400px](practice-guide-compact-lyrics-issue162-en-en-light-400-contract-v11.png)
- [EN verse, EN Light, 600px](practice-guide-compact-lyrics-issue162-en-en-light-600-contract-v11.png)
- [JA verse, EN Dark, 400px](practice-guide-compact-lyrics-issue162-ja-en-dark-400-contract-v11.png)
- [JA verse, EN Dark, 600px](practice-guide-compact-lyrics-issue162-ja-en-dark-600-contract-v11.png)
- [EN verse, EN Dark, 400px](practice-guide-compact-lyrics-issue162-en-en-dark-400-contract-v11.png)
- [EN verse, EN Dark, 600px](practice-guide-compact-lyrics-issue162-en-en-dark-600-contract-v11.png)

I visually inspected this capture. Short cells show fewer glyphs than long cells, while all use the same font size derived from the shortest melody bar. Full lyric text remains in the current-lyric header and accessible metadata. Contract v10 evidence below is retained as history for its prior per-event sizing behavior.

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
