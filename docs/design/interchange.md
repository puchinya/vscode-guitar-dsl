<!-- agent-doc-type: design -->
<!-- agent-doc-schema: 2 -->

# Canonical Score Interchange IR

- Status: Approved for implementation by the Issue #96 Implementation Contract
- Owning Issue: [Issue #96](https://github.com/puchinya/vscode-guitar-dsl/issues/96)
- Related specification: [GuitarDSL syntax](../specs/guitardsl-syntax.md), [TAB notation design](tab-notation.md)

## Context and goals

Issues #97, #98, and #99 need a shared semantic boundary for Guitar Pro, MusicXML, and Standard MIDI adapters. Each adapter must not invent its own mapping to compiler internals or its own account of losses.

Issue #96 adds a pure, synchronous, deterministic TypeScript model under `src/interchange/`. Schema version 1 represents one six-string guitar score and its written measures. It is a semantic snapshot: it is not a parser AST, a source-text cache, an external file model, or the transcription-specific `TranscribedSong` Music IR.

The public GuitarDSL grammar remains the authority for source meaning. The interchange layer does not add commands, UI, syntax, format adapters, a second play-order resolver, or another playback clock. A conversion either preserves the represented meaning or returns a typed failure and structured loss report.

The three Issue questions are resolved as follows:

1. Techniques use the typed subset already supported by GuitarDSL. Unsupported foreign effects are reported as losses; no opaque unknown-effect strings are added.
2. Interchange-to-DSL output is canonical and uncompressed. It emits written measures without new `let` or repeat compression while preserving represented written navigation controls.
3. Loss reports are typed conversion results only. Report presentation and user choices belong to the downstream adapter Issues.

## Requirements traceability

| Requirement | Design owner | Verification |
|---|---|---|
| Versioned, immutable consumer API separate from compiler and transcription models | `src/interchange/model.ts`, `index.ts` | API type checks; caller-mutation fixtures |
| Exact written score data, initial and changing context, chord definitions, lyrics, and page/section boundaries | `InterchangeScore`, `InterchangeMeasure`; parser mapping | Every `samples/*.guitardsl`; metadata, context, lyrics, and chord fixtures |
| Parser-owned rhythmic origin and exact chord onsets | `MeasureData` provenance and `Fraction` mapping | Equal-split 3-chord, 7/8, tuplets, explicit-duration, inline, repeat fixtures |
| Written repeats, volta, navigation, and arrangement without a second scheduler | `resolvePlayOrder()`, arrangement scanner, round-trip projection | Arrangement, volta, navigation, invalid-play-order fixtures |
| Independent melody and position-first TAB with shared pitch authority | `InstrumentModel`, typed melody/TAB fields | Standard/Drop D, capo, dead-note, tie, effect, and simultaneous melody/TAB fixtures |
| Stable structured loss categories and blocking rules | `loss.ts`, typed conversion result | One fixture per category; merge/dedupe and blocking assertions |
| Canonical DSL output accepted by the parser and semantically equivalent | `toGuitarDsl.ts`, validation projection | Reparse gate, deliberate single-field mutation, complete sample corpus |

## Architecture

### Stable boundary and ownership

The stable consumer API is exported only from `src/interchange/index.ts`. It exports the readonly schema types, error/result types, validation and conversion functions, and loss-report helpers. Downstream adapters import through this barrel. Compiler parser internals stay private to the conversion implementation.

`InterchangeScore.schemaVersion` is exactly numeric `1`. Public arrays and nested values are readonly. Conversion deep-copies domain objects and fractions into normalized IR values; no result retains a mutable `ParsedScore`, source token, source span, SVG/page object, or caller-owned array. Conversion functions are synchronous and keep all state local to a call.

The public conversion boundary is:

```ts
guitarDslToInterchange(source: string): InterchangeResult<InterchangeScore>
interchangeToGuitarDsl(
  score: InterchangeScore,
  priorLoss?: InterchangeLossReport
): InterchangeResult<string>
validateInterchangeScore(score: InterchangeScore): readonly InterchangeError[]
```

`ScoreDiagnostic` appears only in conversion results. It is not stored in the semantic score. `InterchangeError` uses stable, nonlocalized codes and a JSON Pointer path.

### Written score model

The score contains normalized initial metadata, ordered chord definitions, optional typed arrangement entries, and contiguous zero-based written measures. Metadata retains the initial sounding key from `originalKey`, positive BPM, six open MIDI tuning values in 6-to-1 order, meter and grouping, feel, capo, optional pickup, and representable display/style settings. Later key, tempo, meter, feel, dynamic, mark, text, and ottava changes remain typed, ordered measure events.

Each measure retains exact expected beats; its barline and optional bracket/special mark; ordered pre-measure events; chord names, labels, exact onsets and placement mode; rhythm origin and authored rhythm events; independent melody; independent TAB voices; lyrics; section start; and page-break boundary. A section start belongs to one measure, not every measure in the following section. Page boundaries are semantic booleans between written measures, not renderer page objects.

Named chord definitions are deep copies of the existing voicing, fingering, barre, and label values. They are emitted through `formatChordDefinition`; the interchange layer does not create another chord formatter or silently select a default variant.

### Exact timing and parser provenance

Musical lengths and offsets are normalized rational values copied from `src/duration.ts` `Fraction` semantics. Denominators are positive; durations are positive; numerator and denominator must remain safe integers. Arithmetic uses the existing fraction helpers. An unsafe result is a typed unrepresentable-value failure, never a floating-point approximation.

The compiler adds only parser-owned provenance needed to distinguish authored material:

- `MeasureData.rhythmOrigin`: `explicit`, `implicit`, or `repeat`, assigned from parsed authored rhythm and measure-repeat state.
- `MeasureData.chordPlacementMode`: `equalSplit`, `explicitDuration`, or `inline`.
- `MeasureData.chordBeatOffsets`: one exact quarter-note `Fraction` per chord. Inline and explicit-duration onsets are accumulated while parsing. Equal splits are resolved after meter and pickup resolution as `expectedBeats * index / chordCount`.

The existing numeric `ChordPlacement.beat` and renderer positions do not change. In particular, the interchange layer never reconstructs an exact rational from a rounded beat number. A written `%` measure has its own written index and copies exact onset data only when its chords are inherited; authored overrides use their own parsed data.

### Melody, rhythm, lyrics, and TAB

Explicit rhythm retains chronological attacks, rests, inline notes/groups, durations, flags, ties, and techniques. Implicit rhythm marks parser-synthesized defaults so a writer does not claim they were authored. A repeated measure records `repeat` provenance and remains a written measure.

Melody is a separate ordered stream. Notes retain sounding step, alteration, octave, exact note-value parts, beat fraction, ties, typed techniques, and per-verse `Syllable` semantics. `melodyGroups` copies the parser-owned start measure, exclusive end measure, and final lyric-row count for each authored `mel:` group. The writer uses these boundaries instead of merging adjacent measures from their note contents. A group cannot cross a named section boundary; page breaks do not split it.

Lyric arrays are dense and JSON-safe. An `InterchangeSyllable` is an authored token, `null` is an authored `*` skip, and `{ kind: 'omitted' }` means that the source row had no token in that verse slot. The omitted sentinel is never serialized as a skip. Melody rows retain exactly the parser's group verse count and emit only their contiguous authored prefix; an authored token after an omitted slot is unrepresentable. Measure-level `l:"..."` text is separate from syllable lyrics. Rests, grace notes, and tied continuations do not consume sung slots.

TAB remains position-first and independent of `mel:`. Each voice contains beats with the existing note-value type, rest state, explicit string/fret notes, per-note ties/links, per-note effects, per-beat effects, and its lyric verses. Dead notes have no pitch. `InstrumentModel.pitchAt()` validates/supplies the sounding pitch for a written string/fret and tuning/capo; TAB is never inferred from melody. Current voice and effect-scope validation remains authoritative.

Only typed techniques and effect arguments currently accepted by the GuitarDSL domain model enter schema 1. No arbitrary effect name or opaque payload is accepted. GP7/8-only semantics require a later shared-model decision; a foreign adapter must report an unrepresentable element rather than silently dropping or inventing it.

### Written order and arrangement

The IR preserves written measures and structural controls as authored. It does not store a mutable `playOrder` array or flatten measures into performance order. The existing `parseGuitarDsl()`, arrangement lowering, and `resolvePlayOrder()` remain the only authorities for execution order and occurrence numbering.

When an `arrangement { ... }` block exists, conversion obtains its ordered `{ name, count, lyricVerse? }` entries with `scanArrangementBlockLines()`; it does not add an arrangement parser. Explicit lyric-verse choice stays distinct from resolver-selected verses. Arrangement lyric capacity is the minimum authored verse count among melody groups wholly contained in that named section that have at least one sung note; page breaks do not split a section. Duplicate section names remain valid for scores without an explicit arrangement, and are rejected when an arrangement must resolve section references. Invalid play order yields no partial sequence.

For a round trip, the writer reparses its output and compares each `(occurrenceIndex, measureIndex, lyricVerse?)` with the source projection. Future playback-time consumers continue to call `buildPlaybackTimeline()` on the reparsed score.

### Canonical DSL writer and invariant

The writer emits canonical header fields and chord definitions, then an optional typed arrangement block. It writes one written measure per line, optional page and section boundaries, each measure's ordered context events, and the measure body. Melody, melody lyric verses, TAB voice 1, and TAB lyric verses follow their owning measure as independent groups.

Formatting is normalized: no source comments, whitespace, page SVG layout, macro names, or new `let` definitions are retained. Existing written `%` and structural navigation controls are preserved when represented; the writer never synthesizes compressed repeats. Equally spaced chords retain the same count and order of undurationed chord tokens. Other placements are emitted only when the existing syntax expresses their exact rational boundaries. Melody lyric rows stop at the first omitted slot and never pad a short row with `*`. TAB lyric groups may split only at written-measure boundaries when needed to keep each verse row a contiguous prefix; an underfilled but valid single-measure row remains one group.

Every writer call first validates the complete typed IR and merges `priorLoss`. It then renders, calls `parseGuitarDsl()` on the generated text, rejects errors or invalid play order, and compares the complete normalized semantic projection and occurrence sequence. A mismatch returns `semanticMismatch` with a stable field path and no source string. This check is mandatory, not a debug-only assertion.

### Structured loss policy

An immutable loss entry contains `category`, stable `code`, JSON Pointer or adapter-supplied stable `path`, `detail`, and optional `policyId`. The report has schema version 1 and preserves deterministic traversal order. Deduplication uses only the identical `{ category, code, path, policyId }` tuple and keeps its first occurrence.

| Category | Meaning | Writer behavior |
|---|---|---|
| `unsupported` | No schema field can represent the source/foreign value | Blocking; no successful DSL output |
| `approximated` | An explicit, adapter-approved substitute | Nonblocking only with a documented `policyId`; #96 approves none |
| `droppedByPolicy` | An intentional source-specific omission | Nonblocking only with a documented `policyId`; no general best-effort switch |
| `inferred` | A deterministic fact absent from the source | Nonblocking with basis and `policyId`; never presented as authored |

The helpers `emptyLossReport()`, `appendLoss()`, `mergeLossReports()`, and `hasBlockingLoss()` are pure. The last three categories require the detail and policy metadata specified by the API. Prior losses are always carried forward; a blocking entry cannot be bypassed by serialization.

## Data flow and ownership

1. `guitarDslToInterchange(source)` calls `parseGuitarDsl(source)` exactly once for source validation and score semantics. It rejects parser errors and invalid execution plans before mapping. The arrangement scanner supplies only the typed entries from the source block.
2. A private mapper deep-copies resolved `ParsedScore` domain values into the schema-1 snapshot, using parser-owned exact provenance for chord offsets and authored rhythm origin. Source coordinates, renderer objects, and compiler diagnostics do not enter the IR.
3. A downstream format adapter, when implemented by its own Issue, owns its external format and format-specific policies. It may use only the stable interchange barrel and returns loss entries for unsupported, approximated, dropped, or inferred values.
4. `interchangeToGuitarDsl(score)` validates without mutating its argument, writes from typed fields, reparses with the existing compiler, and compares normalized semantics and existing play-order occurrences before returning text.
5. Playback-time consumers use `buildPlaybackTimeline()` on a parsed score. The interchange model owns no clock, seconds conversion, or event scheduler.

## Failure handling

- Parser errors, unsupported TAB voices, invalid ties, invalid arrangement/volta, and invalid play order return typed failures with diagnostics and no partial IR.
- Invalid schema versions, fractions, ranges, indexes, references, typed effects, lyric slots, or event order return `invalidIr` with stable code and path. User data is validated before rendering; it is not coerced or approximated.
- Values that cannot be expressed by current GuitarDSL, including unsafe exact rationals or unsafe lyric/chord text, return `unrepresentableValue`. No output source is returned.
- The writer returns `semanticMismatch` on any failed reparsing, semantic projection difference, or occurrence difference. It does not return the partially rendered source.
- Parser warnings remain in the separate `warnings` field. They are not converted into losses or used to hide unsupported semantic data.
- Structured losses remain separate from diagnostics. A blocking prior `unsupported` entry prevents successful serialization.
- User-data failure paths are typed and deterministic. Programmer errors are not caught and converted into success.
- Repetition comparisons reuse the existing 100,000-occurrence cap; the interchange layer adds no alternate recursive expansion.

## Alternatives considered

- Reusing `TranscribedSong` was rejected because it is transcription-specific and 4/4-oriented, and omits the required TAB and arrangement semantics.
- Serializing `ParsedScore` directly or retaining the original source was rejected because compiler internals, source spans, renderer state, and editor layout would cross the boundary.
- Storing flattened performance order or timing in seconds was rejected because it loses notation and duplicates `resolvePlayOrder()` and `buildPlaybackTimeline()`.
- Attaching TAB to melody pitches or inferring string/fret positions was rejected because TAB is independent and position-first.
- Unknown effect passthrough, invented chord names, automatic fingering, lossy rational rounding, and silent best-effort conversion were rejected.
- Implementing Guitar Pro, MusicXML, MIDI, a loss UI, commands, or a general multi-part sequencer here was rejected; those belong to separate contracts.

## Verification strategy

- Add focused loss/report, validation, parser-provenance, source-to-IR, writer, comparator, and failure tests under `tests/unit/interchange*.test.ts`.
- Round-trip every `samples/*.guitardsl`, plus authored arrangements, Standard and Drop D TAB, capo, meter/pickup, tuplets, exact chord placements, chord variants, lyrics, repeats/navigation, and unsupported/invalid fixtures.
- Include direct assertions for all four loss categories, deterministic merge/dedupe, caller-object immutability, same-call repeatability, and deliberate TAB-fret/verse mutation that must fail semantic comparison.
- Run existing compiler, TAB, arrangement, play-order, chord, melody, and playback-timeline regression suites. Keep the existing numeric chord-position and source-span behavior unchanged.
- Validate this document with `python -m agent_workflow validate-docs --issue 96` and `--changed origin/main`. Final verification follows `docs/agents/testing.md` and Issue #96's required quick/final gates, Help/AI checks, packaging list, and `git diff --check`.
- This design changes no public syntax, command, setting, or user workflow. The normative spec, Help, and generated AI reference remain unchanged.
