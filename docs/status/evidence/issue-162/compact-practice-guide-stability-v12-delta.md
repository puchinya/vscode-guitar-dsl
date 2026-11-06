# Implementation Contract v12 Delta — Stable compact Practice Guide geometry

- Repository: `puchinya/vscode-guitar-dsl`
- Issue: [#162](https://github.com/puchinya/vscode-guitar-dsl/issues/162)
- PR: [#163](https://github.com/puchinya/vscode-guitar-dsl/pull/163)
- Baseline: PR HEAD `fc223e0801882b5e0504ea7964bbcad88ebe3cae`; canonical v11 is Issue comment `6581189304` (7,994 bytes; SHA-256 `26b92f44855d02d40e31de21e6fdea1a93dd832e3cc1bc017b9981e5143ba597`).
- Status: User-requested compact Practice Guide amendments on 2026-11-07. This delta keeps v11's song-wide lyric font size and other approved behavior. It supersedes only the current-lyric header, compact melody vertical geometry, compact chord-diagram sizing/bounds, and the v11 verification cases listed below.

> This document is an Implementation Contract. Do not redesign the architecture during implementation. If a requirement conflicts with repository reality or requires a material design change, do not silently choose an alternative. Report the exact conflict and continue only with independent valid work.

## 1. Runtime requirements

### CG01 — One compact chord-diagram size for the song

At a given measured compact slot width, compute one square CSS-pixel size for every chord diagram in every playback occurrence, page, and bank. Derive it from the narrowest final chord interval available to any diagram after chord-event packing, capped at the existing 144 px viewBox and the slot's horizontal insets. Apply that same width and height to all measure-lane diagram SVGs, centered in their own chord intervals. The result must not vary between one-chord and two-chord measures, page changes, bank fades, lyric verses, or Melody ON/OFF. A viewport-width change may recalculate one new common size for the whole song. The next-chord aside retains its existing independent 44–52 px square.

### CG02 — Show every diagram completely

When diagrams are enabled, every chord diagram retains its complete `0 0 144 144` viewBox and is fully inside its allocated diagrams lane. Reserve at least 4 CSS px above and below the square diagram; do not place a diagram below its lane or clip its bottom strings, fret labels, or other SVG content. Do not hide, omit, or crop any measure-lane diagram to satisfy the common size. The user-facing diagram toggle remains the only intentional way to hide diagrams.

### MG01 — Keep melody geometry fixed when lyrics change

For the same score, slot width, grid, and Melody visibility, adding or removing lyric events must not change the compact melody lane's top, height, pitch mapping, or any pitch bar's vertical coordinate relative to its measure SVG. Keep melody geometry derived from score melody data and fixed lane geometry, not lyric count, selected verse, or current lyric text. The melody lane is 64 CSS px high and starts immediately after the 24 CSS px ruler when visible.

### LY09 — Remove the redundant current-lyric header

Remove the header's separate current-lyric label and live text field in compact and detailed Practice Guide modes. Keep the lyric lane under the melody lane, its current-verse selection, event order and timing, song-wide v11 font size, and full source text in the lyric event's accessible metadata. Do not replace the header field with another duplicate current-lyric display. Keep header height and melody position unchanged when the song has lyrics or has none.

The left label rail remains hidden in both modes. DSL, `PlaybackTimeline`, playback audio, ordinary score SVG/PDF, and the next-chord aside remain unchanged.

## 2. Required verification

| ID | Setup / action | Expected result |
|---|---|---|
| CG-E2E | A song with one- and two-chord measures, including a later occurrence with the narrowest chord interval; inspect all occurrences in both banks at 400 and 600 px, then navigate and crossfade | Every measure-lane diagram has one identical square rendered size per viewport width, equal to the song-wide minimum available interval. The size remains stable across pages and banks. |
| CG-BOUNDS | Inspect each diagram SVG and its diagrams-lane DOMRect in the same fixture | Full 144×144 viewBox is present; top and bottom stay within the lane with at least 4 px reserve; no SVG content or diagram is clipped or omitted. |
| MG-E2E | Use a mixed song with melody in measures both with and without lyrics; compare same-pitch bars and melody lane geometry at equal viewport settings | Melody lane top/height and pitch-bar y coordinates are identical across lyric-present and lyric-absent measures and after lyric source removal. |
| LY-HEADER | Inspect compact and detailed Practice Guide headers while playing a song with lyrics and a song without lyrics | `#practice-guide-current-lyric-wrap` and its duplicate live text are absent. The lower lyric lane remains and retains per-event accessible full text. Header height is stable. |
| LY07 | Put the shortest melody bar only in a playback occurrence after the first four measures; resize 400→600→400, toggle melody, navigate pages, inspect both banks during a fade, seek across repeat/volta, and change lyric verses | Across all playback occurrences and both banks, every lyric uses the size derived from the song-wide shortest melody bar at that width. It stays identical across page, fade, seek, and verse changes and returns to its original value at 400 px. |
| LY08 | Include lyrics without a mapped melody, long English words, simultaneous lyrics, and melisma | The deterministic effective-lyric-duration fallback is used only when no melody pitch bar exists. Event order, full source/ARIA/title text, and per-cell fit behavior remain correct without duplicate or missing lyric events. |
| SHOT | Capture the compact mixed-duration lyric case at 600 px with the entire Practice Guide viewport available | The image shows all four measures and the next-chord aside without a Workbench side panel covering them. Record and assert the stage, card, and viewport rectangles together with the PNG. |

Retain the existing 320–1600 px matrix, JA/EN, Light/Dark, grid variants, melody on/off, PM, tempo fade, fixed four-measure view, and hidden-label-rail checks.

## 3. Reviewer checklist

- [ ] Every compact measure-lane chord diagram has a song-wide common size at each viewport width.
- [ ] Every chord diagram is fully visible inside its reserved lane, including the bottom edge and all fret labels.
- [ ] Melody geometry is independent of lyric presence and current lyric text.
- [ ] The header's current-lyric field is removed while the lower lyric lane and accessible event text remain.
- [ ] v11 LY07/LY08 are exercised across all playback occurrences, both banks, resize, melody toggle, navigation, fade, repeat/volta seek, verse selection, and no-melody fallback.
- [ ] A fresh 600 px screenshot and DOM bounds show all four measures and the next chord without occlusion.
- [ ] The left label rail remains hidden in compact and detailed modes.
- [ ] The canonical contract includes the exact mandatory implementation-contract statement above and v11 remains immutable history.
- [ ] `npm run compile`, focused tests, final configured gates, current-HEAD self-review, and required PR check are recorded without calling unrun checks PASS.

## Document impact

- Specification: [docs/specs/gui_design.md §2.4](https://github.com/puchinya/vscode-guitar-dsl/blob/main/docs/specs/gui_design.md) and [docs/specs/extension.md §4.6](https://github.com/puchinya/vscode-guitar-dsl/blob/main/docs/specs/extension.md)
- Design: [docs/design/preview-rendering-and-export.md](https://github.com/puchinya/vscode-guitar-dsl/blob/main/docs/design/preview-rendering-and-export.md)
- Status: [docs/status/implementation-status.md](https://github.com/puchinya/vscode-guitar-dsl/blob/main/docs/status/implementation-status.md) and [docs/status/evidence/issue-162/README.md](https://github.com/puchinya/vscode-guitar-dsl/blob/main/docs/status/evidence/issue-162/README.md)

The canonical v11 comment remains immutable history. This delta changes compact diagram sizing/bounds, compact melody geometry, and current-lyric header visibility while preserving the remaining v11 behavior.
