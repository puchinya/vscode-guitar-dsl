<!-- agent-doc-type: design -->
<!-- agent-doc-schema: 2 -->

# ギター TAB 設計 (Guitar TAB Design)

- Status: Current
- Owning Issue: [Issue #89](https://github.com/puchinya/vscode-guitar-dsl/issues/89)
- Related specification: [GuitarDSL syntax §19](../specs/guitardsl-syntax.md#19-ギター-tab-guitar-tablature), [Extension specification §4.7](../specs/extension.md#47-tab-プレビューレイアウトpdf)
- System context: [Architecture](architecture.md)

## Context and goals

This design establishes first-class, position-first six-string guitar TAB as an independent score source. `tab:` describes explicit string/fret positions; it is neither an annotation of `mel:` nor dependent on a paired melody event. The compiled score retains the authored positions and derives sounding pitch once through the shared instrument model. Preview, future playback, and future interchange consume the compiled model.

The model is intended to extend to six-string Guitar Pro 8 TAB semantic round-trip without replacing its core hierarchy. This is an extension constraint, not a commitment to implement the full GP8 feature set in Issue #89.

## Requirements traceability

| Requirement | Owner |
|---|---|
| Position-first syntax, effects, ties, lyrics, let, repeats, and current/future scope | [Syntax specification §19](../specs/guitardsl-syntax.md#19-ギター-tab-guitar-tablature) |
| Compiled hierarchy, parsing, validation, and transforms | This document and [Language and score processing](language-and-score-processing.md) |
| TAB geometry, SVG rendering, Preview and PDF parity | This document and [Preview, rendering, and export](preview-rendering-and-export.md) |
| Visible Preview behavior and transform failure | [Extension specification §4.7 and §4B.6](../specs/extension.md#47-tab-プレビューレイアウトpdf) |

## Architecture

### Stable compiled hierarchy

Add pure `src/tab.ts`. `MeasureData` owns optional assigned voice measures:

```text
MeasureData
└── tabVoices?: readonly TabVoiceMeasure[]
    └── TabVoiceMeasure { voice: TabVoiceNumber, beats: readonly TabBeat[] }
        └── TabBeat { isRest, notes, duration: NoteValue, effects, syllables }
            └── TabNote { string, fret?, dead, soundingPitch?, tieToNext, effects }
```

`TabVoiceNumber` is the durable union `1 | 2 | 3 | 4`, even though only voice 1 is accepted and rendered in #89. `TabEffectCall` stores a validated effect name and typed argument record; `TabEffectValue` is string, number, `Fraction`, or a recursively readonly value array. `fret` and `soundingPitch` are absent only for a dead note. TAB semantic objects do not retain source text or tuning/capo tables.

The exported model shape is:

```ts
export type TabVoiceNumber = 1 | 2 | 3 | 4;
export interface TabEffectCall {
  readonly name: string;
  readonly args: Readonly<Record<string, TabEffectValue>>;
}
export type TabEffectValue = string | number | Fraction | readonly TabEffectValue[];
export interface TabNote {
  readonly string: GuitarString;
  readonly fret?: number;
  readonly dead: boolean;
  readonly soundingPitch?: number;
  readonly tieToNext: boolean;
  readonly effects: readonly TabEffectCall[];
}
export interface TabBeat {
  readonly isRest: boolean;
  readonly notes: readonly TabNote[];
  readonly duration: NoteValue;
  readonly effects: readonly TabEffectCall[];
  readonly syllables: readonly (Syllable | null)[]; // Syllable is reused from src/melody.ts
}
export interface TabVoiceMeasure {
  readonly voice: TabVoiceNumber;
  readonly beats: readonly TabBeat[];
}
```

`fret` and `soundingPitch` are omitted only for a dead note. `MeasureData.tabVoices?: readonly TabVoiceMeasure[]` stores the assigned TAB voices per score measure.

TAB source items and generic effect-call structure are parsed by pure helpers in `src/tab.ts`; semantic helpers validate string/fret positions, effect name/scope/schema, connections, and ties. These helpers do not depend on VS Code or rendering. The compiler supplies final score instrument context and source positions.

### Pitch and duration authorities

The compiler builds the score `InstrumentModel` once using final `tuning:` and `capo:` headers. Every normal note's `soundingPitch` is the result of `InstrumentModel.pitchAt(string, relativeFret)`. Dead notes have no pitch. String 1 remains highest and string 6 lowest; the visible fret remains relative to the capo. `positionsForPitch()` remains the shared reverse-mapping authority for other consumers. Neither layout nor renderer owns a tuning/string/fret table.

Every `TabBeat.duration` is the existing shared `NoteValue` from `src/duration.ts`. TAB consumes its exact `Fraction` beat value and tuplet semantics. There is no `TabDuration` or TAB-local rhythmic parser. Later 32nd/64th values, double dots, and nested tuplets must evolve the shared duration model.

### Compiler flow and assignment

`src/compiler.ts::parseGuitarDsl()` remains the only text-to-`ParsedScore` authority and does not depend on renderer modules. It classifies `tab:` / `tab[1]:` as TAB input and reserved voices 2–4 as `unsupportedTabVoice`. Each TAB line has its own assignment cursor: every bar cell goes to the earliest score measure still lacking that voice. Melody and TAB may independently target the same measure and neither consumes the other's cursor. Cells beyond score measures diagnose `tooManyTabMeasures`.

The parse pipeline structurally tokenizes brackets and effect-call parentheses, expands `let` fragments, constructs beats and shared durations, resolves normal pitches through the instrument model, validates note and beat scopes, and attaches voice measures to `MeasureData`. It then validates ties, connections, measure totals and lyric slots against compiled semantics. Diagnostics retain source locations. Repeated parsing is deterministic and does not use global parser state.

### Effect scope and semantic links

Generic effect-call grammar is separated from the typed #89 vocabulary. `{...}` directly attached to `TabNote` is always note scope; `!{...}` following a beat duration or an inheriting beat is always beat scope. No rule infers scope from effect name or whether the duration is present. Unknown effect names and unsupported scope/schema combinations are diagnosed rather than preserved opaquely.

Note effects for #89 are hammer, pull, slide, gliss, bend with numeric `amount`, vibrato, PM, and let-ring. Beat effects are PM and let-ring. `resolveTabLinkTarget()` in `src/tab.ts` is the shared pure target resolver used by normal Compiler validation, fragment-boundary validation, and rendering. Connections skip rests, empty beats, and sounding beats without the source string; the first later sounding beat containing that string is the candidate and must not be dead. Ties skip rests and empty beats but inspect only the immediately following sounding beat; it must contain the same non-dead string and fret. Invalid or dangling links are diagnosed and never drawn. No tie/connection crosses a let-definition boundary.

### Repeats, fragments, and lyrics

Existing `let` resolution owns nesting, cycle/error reporting, and deep expansion per use. Context inference gives TAB-only fragments the TAB context and reports existing context mismatch behavior when elements have no common context. Each fragment has independent beat-duration inheritance; it neither reads the caller's duration state nor leaks its final state back. `%` remains invalid in a fragment. Open connections and ties started inside a fragment must terminate within that fragment.

In TAB source, `%` is a complete prior-measure repeat for the same voice and must be the only musical item in its cell. It clones compiled TAB semantics deeply and never means a repeated beat. `lyr:` attaches to the immediately preceding melody or TAB source group. A chord consumes one lyric slot, a rest and a tie-only continuation beat consume none, and any beat with a new attack consumes one slot. TAB stores the existing `Syllable | null` model: text and hyphenation are preserved, `_` is an extending syllable, and `*` is a skipped slot. Optional lyric bar markers are checked per assigned TAB measure cell with the existing `lyricBarMismatch` diagnostic.

### Layout and renderer

`src/render/layout.ts::layoutScore()` owns system layout and extends `SystemGeometry` with: TAB presence; TAB block vertical offset and staff height; TAB lyric baseline, line height, and verse count; whether rhythm is actually rendered; final rhythm offset; and total unit height. The TAB-containing block order is header/section/chord labels, optional melody plus its lyrics, TAB plus TAB lyrics, optional explicit rhythm, dynamics/lower lanes. A default or implicit rhythm must not create a redundant slash staff under TAB. No-TAB `SystemKind` behavior and geometry stay valid.

Pure `src/render/tabStaff.ts` consumes compiled `TabVoiceMeasure`, `SystemGeometry`, and existing render primitives. It draws six evenly spaced lines, a prominent clef-like `TAB` label, readable numeric frets and dead `x`, rests and common rhythm marks, simultaneous notes at the same x, and compiled effects/ties. Layout owns staff height so fret digits on adjacent strings remain legible and lyrics clear the staff. Horizontal placement comes from exact accumulated beat fractions. It does not re-parse source, derive pitch, resolve duplicates, repair data, infer effects, or choose a string/fret.

`src/render/svg.ts::renderScoreSheets()` and `renderContinuousSvg()` integrate the TAB helper using layout-owned geometry. Preview and PDF share page SVGs. `src/pdf.ts` stays a consumer of `renderScoreSheets()` and has no TAB-specific renderer or layout constants.

### Transform compatibility

Export a semantic `scoreHasTab(score: ParsedScore)` predicate from the domain layer and use it in capo, transpose, beginner-mode, and Preview transform flows. Do not scan source text separately. Add the shared exact failure code `tabTransformUnsupported` to applicable result unions. Same-state identities can succeed; non-identity capo, pitch transpose, or beginner chord substitution on TAB fails before any edits. Temporary Preview transforms show the existing warning/reset behavior and never produce partially transformed TAB. Read-only chord playability analysis may remain, but candidates requiring a non-identity source transform are unsupported.

## Data flow and ownership

| Data | Created by | Consumed by |
|---|---|---|
| Authored `tab:` source positions/effects | User document | Compiler tokenizer and TAB semantic helpers |
| `InstrumentModel` | Compiler from final tuning/capo headers | TAB pitch resolution and other shared fretboard consumers |
| `TabVoiceMeasure -> TabBeat -> TabNote` | Compiler | Layout, TAB SVG helper, safe transform predicate, future consumers |
| TAB geometry | `layoutScore()` | Page/continuous SVG renderers |
| Page SVG containing TAB | `renderScoreSheets()` | Preview and existing PDF writer |

Source remains canonical; TAB values are derived. The renderer uses compiled semantics only. Export retains the existing atomic PDF write behavior.

## Failure handling

Dedicated diagnostic codes are `invalidTabToken`, `unsupportedTabVoice`, `invalidTabString`, `invalidTabFret`, `duplicateTabString`, `tabRepeatWithoutPrevious`, `invalidTabEffect`, `invalidTabEffectScope`, `invalidTabConnection`, `danglingTabConnection`, `invalidTabTie`, and `tooManyTabMeasures`. Existing duration, measure-length, lyric-count, lyric-boundary and variable diagnostics are reused when their meanings match.

Invalid positions are reported at the source token; invalid notes are omitted from the playable note set while parsing continues. User input does not throw from `InstrumentModel.pitchAt()`. Duplicate strings are diagnosed without a winner. Invalid ties are errors; invalid/dangling connections are warnings and rendering continues. Transform incompatibility returns `tabTransformUnsupported` before mutation.

## Alternatives considered

- TAB as `mel:` annotation, including `e4@s2f5`: rejected because it duplicates pitch and position, introduces mismatch rules, and makes melody depend on guitar-specific fingering.
- `show_tab`: rejected because assigned first-class TAB itself determines visibility and a second flag creates conflicting states.
- ASCII source, renderer-owned tuning, TAB-local duration, effect scope inferred from names, opaque GP8 payloads, automatic lowest-fret fingering, voice 2–4 partial rendering, or PDF-only rendering: rejected by Issue #89 contract.

## Verification strategy

Pure model tests cover structural token/effect parsing, typed schemas, positions, duplicates, ties, connections, and immutable deep copies. Compiler tests cover pitch authority, relative frets, separate cursors, fragments, repeats, lyrics, diagnostics and deterministic recovery. Renderer/layout tests cover geometry, staff/rhythm/effect marks, Preview/PDF parity, and unchanged no-TAB goldens. Transform suites assert structured failures and unchanged source bytes. Grammar and generated Help/AI checks follow their canonical gates. Required rendered Preview fixtures are inspected and attached to Issue #89 before delivery.
