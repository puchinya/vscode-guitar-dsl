## GuitarDSL Language
<!-- help-sources: syntax:2 syntax:3 -->

GuitarDSL is line-based. Blank lines are ignored, and `#` starts a comment, either on a whole line or at the end of a line. A document usually has a **header** (song information) followed by the **score** (section headings and measure lines).

### Headers
<!-- help-sources: syntax:4 -->

Headers are written as `key: value`. Header names are case-insensitive.

```guitardsl
title: Wind Compass
artist: GuitarDSL Original
capo: 2
key: D
bpm: 104
time: 4/4
```

| Header | Meaning |
|---|---|
| `title`, `artist` | Shown at the top of page 1 |
| `capo` | Capo fret (0–12 for capo tools). Chord names are the **shapes you play**. |
| `key` (`original_key`) | The **sounding** key. It sets the melody key signature. |
| `bpm` (`tempo`) | Tempo shown in the header |
| `time`, `feel`, `pickup` | Starting time signature, feel (`straight` / `swing` / `shuffle`) and pickup length |
| `measures_per_row` | Measures per row, 1–8 (default 4) |
| `show_rhythm` | `false` hides the rhythm staff where there is a melody (lead-sheet mode) |
| `chord_size`, `lyric_size`, `title_size`, `section_size`, `font_size` | Text sizes |

### Sections, Measures and Barlines
<!-- help-sources: syntax:5 syntax:6 -->

A line like `[Intro]` or `[Chorus]` labels the next measure. A line containing `|` is a measure line. You can put the chord and rhythm in one cell, or in a chord cell followed by a rhythm cell. A line never continues on the next line:

```guitardsl
[Intro]
| C 4.d 4.d 4.d 4.d | G 4.d 4.d 4.d 4.d |
| Am | 4.d 4.d 4.d 4.d |
```

Barlines and navigation marks:

- `|` normal barline, `|:` and `:|` repeats (every `:|` needs a matching `|:`), `||` double barline, `|]` final barline
- `[1.]` and `[2.]` for first and second endings
- `Segno`, `Coda`, `to Coda`, `D.S.`, `D.C.` and `Fine`
- `%` repeats the previous measure. If you leave out the chord, the previous chord is kept.

### Chords
<!-- help-sources: syntax:7 -->

Chord names follow the pattern root + quality + optional bass, for example `C`, `Am7`, `Fmaj7`, `Gsus4`, `Cadd9`, `D/F#`.

- Several chords in one chord cell share the measure evenly: `| C G | ... |`.
- Give a length in beats with `:`, or as a note value with `/`: `C:3 G:1`, `C/2+8 G/4.`, `G/B/2`.
- Inline chords change at their position in the rhythm: `| C 4.d 4.d G 4.d 4.d |`.

#### Chord Definitions
<!-- help-sources: syntax:7 -->

Use `chord` lines to define diagram shapes. Frets are listed from the 6th string to the 1st: `x` = muted, `0` = open, a number = fret. Add `@label` to keep several voicings:

```guitardsl
chord C       = x32010
chord C@barre = x35553 fingers:-13331 barre:3
chord C@high  = x,x,10,9,8,8 fingers:--4312

[Intro]
| C@barre:2 C@high:2 | 4.d 4.d 4.d 4.d |
```

Options: `base:<fret>`, `fingers:<6 characters>` (`-`, `1`–`4`, `T`), `barre:<fret>` or `barre:<fret>:<string>-<string>`.

### Rhythm and Strokes
<!-- help-sources: syntax:8 -->

A rhythm token is a note value plus optional `.`-separated modifiers:

| Token | Meaning |
|---|---|
| `1` `2` `4` `8` `16` (also `w` `h` `q`) | Whole, half, quarter, eighth, sixteenth |
| `8t` `4t` `16t` | Triplets |
| `8{5:4}` | General tuplet (5 in the time of 4) |
| `4+8` | Added lengths, drawn tied (use this for dotted values) |
| `r4`, `r8`, … | Rests |

Modifiers: `d` down stroke, `u` up stroke, `a` accent, `g` ghost, `t` tie, `arp` arpeggio, `pm` palm mute, `lr` let ring, `stacc`, `ten`, `fermata`, `vib`, `breath`. For example, `16.d.a` is an accented sixteenth down stroke.

```guitardsl
| C | 8.d 16.d 16.u 8.d 8.u 4.d.a r4 |
| G | 8t.d 8t.u 8t.d 4.d 4+8.d 8.u |
```

A measure with no rhythm gets a default pattern. The beats in a measure must add up to its time signature, or you get a warning.

### Lyrics
<!-- help-sources: syntax:9 -->

Put `l:"..."` (or `~"..."`) inside a measure to write lyrics under it:

```guitardsl
| C | 8.d 8.u 4.d 8.d 8.u 4.d l:"walking in the morning light" |
```

### Page Breaks
<!-- help-sources: syntax:10 -->

A line with only `---` or `pagebreak` starts a new page.

### Melody and Note-Level Lyrics
<!-- help-sources: syntax:12 syntax:13 -->

A `mel:` line gives the melody for the measures above it, one cell per measure. Notes are lowercase note name + optional `#`/`b` + octave + length, for example `e4/8`, `f#4/4`, `bb3/2`, `a4/4.`, `r/8` (rest), and `g4/2~` (tied). Within a line, octave and length carry over from the previous note.

A `lyr:` line after `mel:` assigns one syllable per sung note. `_` extends the previous syllable, `*` skips a note, and a trailing `-` joins parts of a word. Add another `lyr:` line for each extra verse.

```guitardsl
key: C
| C | 8.d 8.u 4.d 8.d 8.u 4.d |
| G | % |
mel: | r/8 e4/8 e g a g e d | d4/8 d e d c/4 r/4 |
lyr: | the morn- ing light is shin- ing | on the road a- head |
```

Techniques go in braces after the length: `{hammer}`, `{pull}`, `{slide}`, `{gliss}`, `{bend:1}`, `{vibrato}`, `{staccato}`, `{tenuto}`, `{fermata}`, `{breath}`, `{grace}`, `{slur-start}`, `{slur-end}`, `{pm}`, `{let-ring}`.

### Key Signature and Display Options
<!-- help-sources: syntax:14 -->

The `key:` header sets the melody key signature, for example `C`, `G`, `Bb`, `F#m`. Melody is always written at the real pitch. With `show_rhythm: false`, measures that have a melody show only the melody staff.

### Score Events
<!-- help-sources: syntax:16 -->

Lines starting with `@` change something from the **next** measure on, or add a mark to it:

```guitardsl
key: C
bpm: 120
| C | G |
@key: D
@tempo: 132
@dynamic: f
| D | A |
@time: 7/8(2+2+3)
@mark: B
| Em | 8.d 8.u 8.d 8.u 8.d 8.u 8.d |
```

Events: `@key:`, `@tempo:` (a number, `rit.`, `accel.`, `a tempo`, `tempo primo`), `@time:`, `@feel:`, `@dynamic:`, `@mark:`, `@text:` and `@ottava:` (`8va`, `8vb`, `off`). They are notation only. Tempo changes are shown as text, and nothing is played back.

### Reusable Fragments (`let`)
<!-- help-sources: syntax:17 -->

Name a rhythm or note sequence with `let`, then reuse it with `$name` in a measure cell or `mel:` cell. Definitions can appear anywhere in the file.

```guitardsl
let groove = 8.d 8.u 4.d 8.d 8.u 4.d
let riff = e4/8 g a g
[Verse]
| C | $groove |
| G | $groove |
mel: | $riff $riff | c5/2 r/2 |
```

- The first note of a definition must spell out its octave and length (`let riff = e4/8 g`).
- A reference neither takes nor passes on octave or length from the notes around it.
- `%` cannot be used inside a definition, and definitions cannot refer to themselves in a loop.

### Note Groups (Simultaneous Notes)
<!-- help-sources: syntax:18 -->

Write notes that sound together in square brackets with one shared length: `[c4,e4,g4]/4`. Each note needs its own octave. Group-level techniques such as `{staccato}` are allowed, but ties, hammer-ons, slides, bends and slurs are not.

```guitardsl
| C | [c4,e4,g4]/4 [c4,eb4,g4]/8 8.u 4.d [c4,e4,g4]/4{staccato} |
| C | G |
mel: | [c4,e4,g4]/2 [d4,f4,a4]/2 | [c4,e4,g4]/4. [d4,f4]/8 [e4,g4]/2 |
```

### Rendering and Layout
<!-- help-sources: syntax:11 -->

Each row has a treble clef, and the first row shows the time signature. Chord names sit above the staff, stroke marks above the slashes, and lyrics below. A key or time-signature change starts a new row. The complete rules are in the GuitarDSL syntax specification (`docs/specs/guitardsl-syntax.md` in the source repository).
