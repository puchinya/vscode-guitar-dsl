# Implementation Contract v11 Delta — Song-wide uniform compact lyric size

- Repository: `puchinya/vscode-guitar-dsl`
- Issue: [#162](https://github.com/puchinya/vscode-guitar-dsl/issues/162)
- PR: [#163](https://github.com/puchinya/vscode-guitar-dsl/pull/163)
- Baseline: PR HEAD `8d4eec00f5dfe645baa9b6ee13a704ba6c73b67f`; canonical v10 is Issue comment `6574706499` (18,451 bytes; SHA-256 `2dbf43f9328bb0d745660081cea43812df1053c33ccc41a2edd9384de6f42e90`).
- Status: The user clarified on 2026-11-03 that compact lyric font size must follow the song's shortest note value and therefore must not vary between lyric events in the same song. This delta supersedes only v10's per-event font-size rule; all other v10 and v9 decisions remain in force.

> This delta is an Implementation Contract. Preserve the approved behavior outside its explicit scope. If repository facts contradict a decision, record the conflict before changing implementation.

## 1. Repository baseline

- `computePracticeGuideCompactLayout(slotWidth)` evaluates `playbackOccurrences`; `packSingleRowLyrics` currently calls `compactLyricFontSize` independently for every lyric event.
- Each compact SVG has a fixed 28 px lyric lane and carries the matching melody duration and original lyric text. Cell placement already preserves event order, Fractions, grapheme boundaries, and the current full-lyric header.
- The current implementation and GUI/design documents explicitly allow event-specific sizes from 4–13 px. This is the behavior being replaced.

## 2. Architecture decisions

1. For one song and one measured compact slot width, compute the shortest rendered melody pitch-bar width over the song's playback occurrences:

   `barWidth = durationBeats / measureBeats * max(0, slotWidth - 10)`

   Use the minimum valid width across all melody note bars, including notes without lyrics. Repeated/volta occurrences do not change the minimum. When there is no melody note bar, use the minimum valid effective lyric-duration width; if neither exists, use the 13 px cap.

2. Compute one common lyric size as `min(13, max(4, floor(max(0, shortestWidth - 0.25) * 100) / 100))` CSS px. The 0.25 px inset matches the existing lyric-cell safety inset. The calculation depends on score duration and measured slot width, not lyric text, verse, or event. Every compact lyric `<text>` node for the song, in both playback banks and across all playback occurrences, uses exactly this value. Melody ON/OFF, seek, page navigation, playback, repeat/volta, and verse changes do not create per-event size differences. A viewport-width change may recalculate one new common value for the whole song.

3. Keep the existing one-row cell widths and grapheme-safe display fitting. At the common size, show the longest leading grapheme prefix that fits each event's available cell; never shrink individual strings to make them fit. If no grapheme fits a particularly narrow cell at the common size, use the existing time-position marker for that cell. Preserve original full text in event data, `title`, ARIA, and the current-lyric header. Do not use `textLength`, `lengthAdjust="spacingAndGlyphs"`, `scaleX`, or a non-uniform transform.

4. Keep all lyric event nodes, beats, Fractions, order, and fixed lane geometry. Recalculate from original event text and durations after resize or source change; do not accumulate truncation or stale font sizes. Detailed-grid, ordinary score SVG/PDF, DSL, PlaybackTimeline, and audio are unchanged. PM placement, strokes, waves, chord diagrams, four-measure capacity, and tempo fade retain v10 behavior.

## 3. Runtime semantics

- All lyric events in one song at a given compact width have the same numeric SVG `font-size`, derived from the shortest melody note bar in that song.
- Different songs may use different common sizes. Resizing may change the common size for the entire song, never one lyric event independently.
- Short lyric cells may show fewer graphemes at the common size. The full selected lyric remains available through the current-lyric header and accessibility metadata.

## 4. Concrete tests

| ID | Setup / action | Expected result |
|---|---|---|
| LY05 | One song with mixed melody durations and deliberately varied Japanese/English lyric lengths across several measures; render at 400 and 600 px | Exactly one unique computed/data font size across every lyric event in all playback occurrences and both banks. It equals the clamped minimum melody-bar width; text content may be grapheme-truncated per cell without per-event font changes. |
| LY06 | 4/4, sixteen 16th-note Japanese syllables per measure at 400 px | All 16 graphemes remain visible per measure, share the same size (approximately 5.37 px after the 0.25 px safety inset), retain event/Fraction order and baseline, and have no overlap or overflow. |
| LY07 | Resize 400→600→400; toggle melody, navigate pages, play through a bank fade, seek across repeat/volta and switch selected lyric verses | At each width every lyric node still has one common size. Playback/page/verse changes do not change that size. Returning to 400 px restores the original value from source data. |
| LY08 | English long words, simultaneous lyrics, melisma and lyrics without a melody mapping | Common font size remains song-wide; each cell shows its longest fitting grapheme prefix, full source/ARIA/title/header remain exact, and fallback duration is deterministic. |
| REG | Existing 320–1600 px compact matrix, JA/EN × Light/Dark, grid16, melody on/off, PM, and tempo fade | Existing v10 layout, PM, stroke/wave geometry, melody bars, diagrams, fade, and detailed-grid behavior remain unchanged. Capture fresh 400 px and 600 px lyric screenshots. |

## 5. Reviewer checklist

- [ ] Every lyric event for one song and measured compact width uses the same font size, based on the shortest melody bar across the song's playback occurrences.
- [ ] Mixed note durations and lyric lengths cannot produce per-event font-size differences; only visible grapheme count may vary by cell width.
- [ ] The 400 px Japanese 16th-note case keeps all 16 graphemes at one approximately 5.6 px size, with exact order/Fractions and no overlap.
- [ ] Resize, playback, bank/page navigation, repeat/volta, verse selection, and Melody ON/OFF recalculate or preserve the common value as specified, without stale sizing.
- [ ] Full source lyrics, title, ARIA, and current-lyric header remain intact; text-length scaling and X compression remain absent.
- [ ] V10 PM annotations and all v9/v10 compact layout, stroke, wave, tempo-fade, and detailed-grid guarantees remain unchanged.
- [ ] Current-HEAD tests, fresh 400/600 px screenshots, specs/design/Help/status, self-review, and PR evidence agree.

## 6. Verification and document impact

Run `npm run compile:all`, `npm test`, `npm run vscode:prepublish`, `npm run check:help`, `npm run check:ai`, `validate-docs --issue 162`, `verify-implementation-contract 162`, `git diff --check`, Required CI, and the current-HEAD delivery/self-review gates. Capture and inspect 400 px and 600 px Japanese/English light/dark evidence.

- Specification: [docs/specs/gui_design.md §2.4](https://github.com/puchinya/vscode-guitar-dsl/blob/main/docs/specs/gui_design.md), [docs/specs/extension.md §4.6](https://github.com/puchinya/vscode-guitar-dsl/blob/main/docs/specs/extension.md)
- Design: [docs/design/preview-rendering-and-export.md](https://github.com/puchinya/vscode-guitar-dsl/blob/main/docs/design/preview-rendering-and-export.md)
- Status/evidence: [docs/status/implementation-status.md](https://github.com/puchinya/vscode-guitar-dsl/blob/main/docs/status/implementation-status.md), [Issue #162 evidence README](https://github.com/puchinya/vscode-guitar-dsl/blob/main/docs/status/evidence/issue-162/README.md)

The canonical v10 and v9 Issue comments remain immutable history. This delta changes only compact lyric font-size selection and the visible text prefix derived from that common size.
