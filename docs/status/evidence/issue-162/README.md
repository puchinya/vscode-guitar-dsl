# Issue #162 Practice Guide evidence

These PNGs show the compact four-measure Practice Guide and tempo-linked bank fade captured in the VS Code 1.144.0 Extension Development Host on macOS arm64. The Japanese runs used the installed Japanese language pack; English runs used the default locale.

## Capture matrix

| Evidence | Cases | Files |
|---|---|---:|
| Compact layout | 400 / 421 / 600 / 1100 CSS px × JA / EN × Light / Dark × Melody on / off | 32 |
| Continuation marks | 400 CSS px × grid 4 / 8 / 16 × JA / EN × Light / Dark | 12 |
| Four-measure fade reference | 1600 CSS px × JA / EN × Light / Dark | 4 |
| Crossfade phases | 1600 CSS px × 0 / 250 / 500 ms × JA / EN × Light / Dark | 12 |
| **Total** |  | **60** |

Every PNG was checked for a valid header, nonzero dimensions, minimum image size, and the requested CSS-pixel width. Representative 400 / 421 px layouts, the 16th-note grid, and the 250 / 500 ms fade phases were visually inspected in both locales and themes.

## Representative images

- [EN Dark, 400 px, melody on](practice-guide-compact-issue162-en-dark-400-melody-on-current-head.png)
- [JA Light, 400 px, melody on](practice-guide-compact-issue162-ja-light-400-melody-on-current-head.png)
- [JA Light, 400 px, 16th-note grid](practice-guide-grid-issue162-ja-light-400-grid-16.png)
- [EN Dark, 250 ms fade](practice-guide-crossfade-issue162-en-dark-250ms-current-head.png)
- [JA Dark, 500 ms fade](practice-guide-crossfade-issue162-ja-dark-500ms-current-head.png)

The screenshots capture the visual implementation at source commit `c7d1f9d2f992041ceffc9f77e99ea5b21f6e5ddd`. The later fade-lifecycle change adds cancellation coverage for resize, view changes, AB loops, and disposal without changing these captured layouts. E2E reruns and the final delivery HEAD are recorded in [`implementation-status.md`](../../implementation-status.md).

## PR #163 review evidence

The compact chord edge regression uses 2, 3, and 4 chord intervals in one four-measure page at an exact 400 CSS px Preview width. Chord diagrams stay in one horizontal row in playback order; each pair scales to its available interval spacing. The E2E checks the name/diagram pair and center, reads both DOM bounds against the card, confirms finger dots, and verifies that neighboring diagrams do not overlap.

- [EN Dark, 400 px, short chord spans and compact diagrams](practice-guide-compact-chord-bounds-issue162-en-dark-400.png)
- [EN Dark, 400 px, `sample_gozen0jino_page` with horizontal chord diagrams](practice-guide-horizontal-sample-issue162-en-dark-400.png)
- The EN Dark 400 px continuation-grid captures for grids 4, 8, and 16 were refreshed while running the same current-HEAD review E2E.
