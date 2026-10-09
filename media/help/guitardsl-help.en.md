<!-- GENERATED FILE. DO NOT EDIT. Source: docs/help/help-manifest.json + docs/help/{locale} + package metadata. Regenerate with: npm run generate:help -->

# GuitarDSL Help

## About GuitarDSL

**GuitarDSL** is a plain-text language for guitar scores such as strumming charts, lead sheets and guitar tablature. You write chords, strum patterns (down/up strokes), melody, lyrics and explicit string/fret positions as text. The **GuitarDSL Previewer** extension then renders them as a score with standard notation, a TAB staff, rhythm, pick-direction marks, chord names and chord diagrams.

- File extensions: `.guitardsl` and `.gdsl` (UTF-8 text)
- Requirements: VS Code 1.109 or later
- One line = one element: a header, a section heading, a measure line, a melody line, and so on
- `#` starts a comment

## Getting Started

The easiest way to start is the **GuitarDSL** icon in the Activity Bar, which opens the GuitarDSL sidebar. Under **Get Started**, choose **New from Template** or **Open Sample** to open an editable untitled score, then continue with step 3 below.

To create a file yourself:

1. Create a file named, for example, `song.guitardsl`.
2. Type a small score:

   ```guitardsl
   title: My First Song
   key: G
   bpm: 96

   [Verse]
   | G | 4.d 4.d 8.d 8.u 4.d |
   | C D | 8.d 8.u 4.d 8.d 8.u 4.d l:"hello world" |
   ```

3. Open the preview. Click the **Open Preview to the Side** icon in the editor title bar, or run **GuitarDSL: Open Preview to the Side** from the Command Palette. The preview updates as you type.
4. Save a PDF. Click **📄 Save PDF** in the preview toolbar, or run **GuitarDSL: Export PDF / Print**.

## Where Problems Are Shown

Errors and warnings in your score appear as squiggles in the editor and in the **Problems** panel. An error means a line is ignored. A warning means the score still renders but may not match what you meant, such as a measure with the wrong number of beats. See **Troubleshooting** below.

## Opening This Help Again

- Command Palette: **GuitarDSL: Open Help**
- The GuitarDSL sidebar: **Get Started** → **Open Help**
- The **?** Help button in the score preview toolbar

Help opens next to your editor and never changes your score. It is bundled with the extension and works offline. Help, commands and messages appear in Japanese when VS Code's display language is Japanese, and in English otherwise.

## Features

### GuitarDSL Sidebar

Click the **GuitarDSL** icon in the Activity Bar to open the **Start Here** view. It works before you open any GuitarDSL file. It is a starting point, not a score editor.

- **Get Started**: **New from Template** (Basic Chord Song, Melody Example or Lead Sheet Example), **Open Sample** (five bundled samples), **Open Preview to the Side** and **Open Help**. Templates and samples open as editable untitled documents, so no original file changes. Save them under any name.
- **Current File**: when the active editor holds a GuitarDSL file, the actions for that file: preview, chord diagram editing, score settings, capo / playability, accompaniment pattern and PDF export. When no GuitarDSL file is active, it shows a hint only.
- **Tools**: YouTube transcription and local audio transcription (both experimental).

The Command Palette commands **GuitarDSL: New from Template** and **GuitarDSL: Open Sample** do the same.

### Editor Support

- Syntax highlighting for headers, sections, chords, rhythm tokens, lyrics, melody (`mel:` / `lyr:`), chord definitions, score events and `let` fragments.
- Comment toggling with `#`, and bracket and quote pairing.
- **Outline**: metadata, sections, a chord summary for each measure line, and score events appear in the Outline view and **Go to Symbol in File**.
- **Diagnostics**: errors and warnings appear as you type (see **Troubleshooting**).

### Score Preview

**GuitarDSL: Open Preview to the Side** shows the rendered score next to the editor. The preview follows your edits and the active GuitarDSL editor. The toolbar offers:

- **View**: *Single Page*, *Spread* (two pages side by side) or *Web* (one continuous page, with manual page breaks shown as a dotted line).
- **Paper** (A4, A3, A5, B4, B5, Letter) and **Orientation** (*Portrait*, or *Landscape*, which puts two pages on one sheet).
- **📄 Save PDF** and the **?** Help button.
- **Playback**: play or resume, pause, stop, seek, and see the current and total time. It uses a simple synthesized sound preview. **Count-in** and **Metronome** are optional and off by default; count-in plays one full measure before playback, including when the score starts with a pickup.

### Practice Mode

Turn on **Practice** in the Playback row to show the Practice controls. Practice changes playback only; it does not edit the GuitarDSL source or its written tempo.

- **Speed** ranges from 25% to 200% in 5% steps. The selected speed is remembered by the Preview.
- During playback, the playhead aligns with the score's note and rhythm positions and moves with score time between them.
- **Loop** can repeat the current measure, the contiguous performed measures belonging to the current section, or an A/B range. A section label applies to its written measure and following written measures up to the next section label. Choose **Section** on any measure in a named section. Repetitions that are contiguous in playback order share one range; a same-name section after another section remains separate. **A** records the current playback position and clears B; **B** must be later than A. **Clear** removes the loop and both points. Loop ranges include A and stop before B.
- With **Count-in** enabled, starting Practice playback from a non-zero position plays one measure of count-in using that performed measure's meter and tempo. Count-in follows Practice speed and does not repeat on each loop.
- **Follow** keeps the active measure in view by scrolling the Preview. Scrolling or navigating manually in the Preview turns Follow off. It does not move the source editor's selection or cursor.
- The Command Palette also offers **GuitarDSL: Play / Pause Preview Playback**, **Stop Preview Playback**, **Toggle Practice Mode**, **Set Practice Loop Start (A)**, **Set Practice Loop End (B)**, **Clear Practice Loop**, **Practice Slower** and **Practice Faster**. You can assign your own keybindings to these commands.

At narrow widths, the View, Paper and Orientation settings can scroll horizontally while Help and Save PDF remain visible and available.

Measures wrap onto rows automatically (4 per row by default, set with `measures_per_row`). Pages break automatically when a row does not fit, and at every manual `pagebreak` / `---` line. Page 1 shows the full header with chord diagrams. Later pages show a compact running header.

Rows with `tab:` or `tab[1]:` show a conventional six-string TAB staff below any melody and melody lyrics, with a stacked `T` / `A` / `B` clef, broken string lines behind centered fret numbers, and rhythm marks above the staff. TAB carries its own rhythm, so an implicit slash-rhythm staff is omitted; explicitly authored rhythm is shown when `show_rhythm: true`. TAB and PDF use the same page SVG rendering path.

### PDF Export

**📄 Save PDF**, or **GuitarDSL: Export PDF / Print**, writes a vector PDF of exactly what the preview shows, using the selected paper size and orientation. No browser is needed, and fonts are bundled, so output does not depend on your installed fonts. Printing is done from the saved PDF.

### Importing and Exporting Guitar Pro Files

Use **GuitarDSL: Import Guitar Pro 7/8** in the Command Palette to open a supported `.gp` file as a new untitled GuitarDSL document. If more than one guitar track is supported, choose the track to import. The source file is not changed.

Import supports GP7/GP8 `.gp` files with one selected six-string guitar track, one staff, and the supported voice. Unsupported musical meaning in the selected track stops the import. Other tracks, audio, sound settings, and display layout can be omitted only under the command's reported loss policy.

**GuitarDSL: Export Guitar Pro 7** saves the current GuitarDSL document as a GP7 `.gp` file. Before saving, the extension checks the supported scope and reports information that would be lost. It does not overwrite an existing file. GP8 8.1.5 native checks opened, displayed, re-saved, and re-imported the self-authored contract fixtures with matching score meaning. Native GP7-app compatibility has not been tested; automated GP7-format import/export checks are included.

### Chord Diagrams and the Chord Diagram Editor

Every chord used in the score is drawn as a fretboard diagram in the header. The shape comes from a `chord` definition in the file if one exists, otherwise from the built-in library. A slash chord without its own library shape, such as `F/A`, is drawn with the shape of its upper chord (`F`); `G/B` and `D/F#` have their own shapes. With a non-Standard tuning, only preset shapes that sound as the requested chord are shown. Frets are relative to the capo, and capo playability and Beginner Mode use the same tuning and shape. Chord-name suggestions in the diagram editor also use the score's tuning. You can keep several voicings of the same chord with labels, such as `C@barre`.

**GuitarDSL: Edit Chord Diagram** opens a visual editor. Start it from:

- the **Edit Diagram** CodeLens above a `chord` line,
- a click on a diagram in the preview, or
- the Command Palette.

In the editor, pick a preset, click frets, open and mute strings, and set finger numbers, barres and the start fret. It suggests chord names from the sounding notes. Saving inserts or replaces the `chord` line as an undoable edit.

### Capo and Playability

The preview's second toolbar row (the capo bar) lets you try another capo position without changing your file. Using the current tuning, the chords are rewritten so they sound the same. `tuning`, `key` and melody remain unchanged. Each position shows a playability score (0–100, *Very easy* to *Very hard*), and the easiest one is marked *★ Recommended*. **Apply to DSL** writes the change to the file in one undoable edit. **Edit…** opens the Score Settings editor. For a score with TAB, capo changes that would rewrite the source are reported as unsupported until a TAB-aware transform is available.

### Beginner Mode

Turn on **Beginner mode** in the capo bar to rate shapes in the score's tuning and see the song with an easy capo position and simpler chords, for example `F → Fmaj7` or `G7 → G`. The key and melody's sounding pitches do not change. **Barre chords** can be *Allow* or *Do not use*. With *Do not use*, no shape that needs a barre is used. Beginner mode is a preview-only view until you choose **Apply to DSL**, and the PDF uses the same result as the preview. Beginner transforms are unsupported for scores with TAB until they can preserve explicit string/fret positions.

### Score Settings

**GuitarDSL: Edit Score Settings** opens a settings panel for the whole song with three sections:

- **Capo / Playability**: every capo position with its score, the recommendation, and the chord mapping.
- **Beginner Mode**: the settings and chord substitutions described above.
- **Transpose**: transposes the whole song by −11 to +11 semitones or to a target key. This changes the sounding key, melody and chords. The capo can stay the same, follow the recommendation, or be set to a value you choose.

Each section applies its result as one undoable edit. **GuitarDSL: Edit Capo / Playability** opens the same panel at the capo section. For a score with TAB, source-changing capo and transpose operations are reported as unsupported; the transform does not partially rewrite the document.

### Change Accompaniment Pattern

**GuitarDSL: Change Accompaniment Pattern (Strumming / Arpeggio)** replaces the rhythm of the measures with one of 58 strumming and arpeggio patterns. Start it from:

- the **Change Pattern [section]** CodeLens above a section heading, or
- the Command Palette, where you first choose the whole score or one section.

You choose in two steps. First pick a category that fits the meter: 8-beat, 16-beat, Shuffle, Arpeggio and so on for 4/4, or 3/4 Waltz, 6/8, 12/8 and so on for other meters. Then pick a pattern. Patterns are grouped by style: Pop / J-POP, Rock / Punk / Metal, Funk and others. When the current rhythm is already a catalog pattern, **Close to the current pattern** appears first.

- Only the rhythm changes. Chords, lyrics, melody, comments and `%` stay as they are, and so do pickup measures.
- A score with mixed meters cannot take one pattern for the whole score. Choose a section instead.
- Measures are left alone when a change would alter the meaning of a `%`, or when they contain inline notes.
- The change is a single undoable edit.

### YouTube Transcription (Gemini, Experimental)

**GuitarDSL: Transcribe from YouTube (Experimental)** sends a public YouTube URL to Google Gemini and opens a new, unsaved GuitarDSL document with chords, rhythm and melody. It supports 4/4 songs only. Besides **Auto**, you can pick an accompaniment pattern: first a category, then one of its 4/4 patterns (patterns that need a swing or shuffle feel are not offered). It needs a Gemini API key, which is stored in VS Code's secret storage. Manage the key with **GuitarDSL: Set Gemini API Key** and **GuitarDSL: Clear Gemini API Key**. The model is chosen by the `guitardsl.gemini.model` setting. This feature uses the network, and existing files are never overwritten.

The generated score must pass structural validation before it opens, but that does not establish musical correctness. Chords, rhythm, melody, lyrics, BPM, section boundaries and other inferred details may be wrong. Treat the result as a draft and review and correct it before use.

### Local Audio Transcription (Experimental)

**GuitarDSL: Transcribe Local Audio (Experimental)** analyzes a WAV file on your computer, with no network and no API key. It estimates key, BPM, chords and strum positions, then opens the result as a new unsaved document. Down and up strokes are guessed from their position in the beat, and the output is 4/4 only. Treat the result as a rough draft. Details of the analysis are written to the **GuitarDSL Audio MIR** output channel. This feature is **experimental** and works only in desktop VS Code on local files.

### AI Integration (VS Code Agent / Chat)

On VS Code 1.109 or later, you can work with GuitarDSL from VS Code's built-in Agent / Chat. This is optional. Everything else works the same without AI. The extension itself never calls an AI model. The model and chat you use come from your VS Code setup.

- **Language knowledge:** the `guitardsl-language` Skill lets the Agent read only the parts of the GuitarDSL language specification it needs. When you edit `.guitardsl` / `.gdsl` files, instructions apply automatically: do not invent syntax, and validate after editing. They also apply when you ask for a new song before any GuitarDSL file exists.
- **Creating a new song:** when you ask for a new song, the Agent does not reuse an existing GuitarDSL file as the output. It creates a new GuitarDSL document and validates, analyzes and adds accompaniment to that document only. For GuitarDSL notation it uses the language specification and accompaniment guide bundled with the extension. It does not infer notation from existing scores or samples; it reads a specific existing GuitarDSL file or sample only if you explicitly name it as a reference or template. When you ask the Agent for a complete new song, it first writes the musical structure (sections, chords, melody, lyrics) without strumming. It validates that draft, analyzes it with `#guitardslAccompaniment`, and adds the accompaniment for all sections at once with `#guitardslApplyAccompaniment`. Then it validates the result. In ordinary new-song creation the Agent decides only the rough strength and playing style of each section; the extension chooses the actual accompaniment patterns. The Agent does not write the down / up strokes itself. If the accompaniment tools cannot run, the draft stays as it is and the Agent tells you the accompaniment is not done. You can still write rhythm notation by hand as usual.
- **Tools:** reference them in a prompt with `#`.
  - `#guitardslValidate` checks the score for errors and does not change the file.
  - `#guitardslPlayability` analyzes playability at each capo position and does not change the file.
  - `#guitardslApplyCapo` changes the capo.
  - `#guitardslApplyBeginner` applies Beginner Mode.
  - `#guitardslTranspose` transposes the sounding music.
  - `#guitardslAccompaniment` analyzes the sections, meters, current accompaniment and available patterns. It does not change the file.
  - `#guitardslApplyAccompaniment` adds accompaniment section by section. Use it for requests like "keep the verse quiet and give the chorus a strong 8-beat" or "push the chorus a little". The model decides the style. The extension gets the down / up strokes, beat counts and chord changes right. It can also shape section transitions and the ending of the song around where the vocal ends.
- **Tools that change the file** ask you to confirm the file and the operation first. They use the same calculation as **Apply to DSL** in the preview and write one undoable edit. If a change cannot be applied, the file is left unchanged. Changes to the same file run one at a time.
- Tools that change the file edit only the file the Agent names (by path or URI). Nothing other than the file shown in the confirmation is changed, and switching to another file after confirming does not change the target. Unsaved untitled files can be targeted too.
- Without a file, the validation and analysis tools choose the target the same way as commands: the active editor, then visible editors, then the last used or any open GuitarDSL file.

### Score Events and Advanced Notation

You can change key, tempo, time signature, feel and ottava in the middle of a song, and add dynamics, rehearsal marks and text. Techniques such as hammer-ons, slides, bends, grace notes, slurs, palm mutes and let ring are also drawn. These are **notation only**: the extension draws them on the score. It does not play audio.

## GuitarDSL Language

GuitarDSL is line-based. Blank lines are ignored. Comment text from `#` to the end of the line is ignored where the current syntax recognizes a comment marker, either on a whole line or at the end of a line. A document usually has a **header** (song information) followed by the **score** (section headings and measure lines).

### Headers

Headers are written as `key: value`. Header names are case-insensitive.

In metadata values, the first `#` starts a comment when it is the first character of the value or follows a space or tab. The separator whitespace is excluded from the value, while a `#` attached directly to text remains part of it (`key: F# # note` has value `F#`; `title: Song#1` stays `Song#1`; `title: Song #1` has value `Song`).

```guitardsl
title: Wind Compass
artist: GuitarDSL Original
tuning: DADGAD
capo: 2
key: D
bpm: 104
time: 4/4
```

| Header | Meaning |
|---|---|
| `title`, `artist` | Shown at the top of page 1 |
| `capo` | Capo fret (0–12 for capo tools). Chord names are the **shapes you play**. |
| `tuning` | Guitar tuning: `Standard`, `Drop D`, `DADGAD`, `Open G`, `Open D`, or six space-separated pitches from the 6th string to the 1st (for example, `D2 A2 D3 G3 A3 D4`). Defaults to `Standard`. |
| `key` (`original_key`) | The **sounding** key. It sets the melody key signature. |
| `bpm` (`tempo`) | Tempo shown in the header |
| `time`, `feel`, `pickup` | Starting time signature, feel (`straight` / `swing` / `shuffle`) and pickup length |
| `measures_per_row` | Measures per row, 1–8 (default 4) |
| `show_rhythm` | `false` hides the rhythm staff where there is a melody; TAB keeps its own rhythm |
| `chord_size`, `lyric_size`, `title_size`, `section_size`, `font_size` | Text sizes |

### Section Arrangement and Per-Occurrence Lyrics

Put one `arrangement { ... }` block after the headers and before the score body to list existing section headings in performed order. You do not rewrite or copy the measures.

```guitardsl
arrangement {
  Intro
  Verse
  Chorus x2
  Verse(lyr=2)
}

[Intro]
| C |
[Verse]
| Am | F |
mel: | a4/1 | g4/1 |
lyr: dawn light
lyr: rain night
[Chorus]
| G |
```

Names must exactly match their headings, including case and spaces. Reference a heading with spaces as `[Verse A]`. `x2` performs the section twice. When `lyr=` is omitted, each occurrence of the same section selects the next verse. `Verse(lyr=2)` selects verse 2 for that occurrence only; the written `lyr:` lines and score display stay as written. An arrangement cannot be combined with explicit repeats, voltas, or navigation marks such as D.C. and D.S.

### Sections, Measures and Barlines

A line like `[Intro]` or `[Chorus]` labels the next measure. A line containing `|` is a measure line. You can put the chord and rhythm in one cell, or in a chord cell followed by a rhythm cell. A line never continues on the next line:

```guitardsl
[Intro]
| C 4.d 4.d 4.d 4.d | G 4.d 4.d 4.d 4.d |
| Am | 4.d 4.d 4.d 4.d |
```

Barlines and navigation marks:

- `|` normal barline, `|:` and `:|` repeats, `||` double barline, `|]` final barline. A `:|` with no unmatched `|:` uses an implicit repeat starting at the nearest preceding section heading or the start of the score. Its notation warning is checked separately from play-order resolution.
- `[1.]`, `[2.]` and other volta labels select repeat passes. Lists and ranges are supported, for example `[1,3-4.]`. Put the label on the first measure of an ending segment; following unbracketed measures stay in that ending through its `:|` and are skipped on passes that do not match. A next labeled ending directly after the closing repeat end shares the same repeat. An unbracketed measure between closed endings, a new repeat start, or a section heading ends that sharing; a page break does not.
- Page breaks affect display only; they do not change play-order resolution or volta sharing. The `repeatEndWithoutStart` warning is checked separately; whether it is suppressed also depends on page boundaries.
- `Segno`, `Coda`, `to Coda`, `D.S.`, `D.C.` and `Fine` mark play-order jumps or endings. A score may have at most one `D.C.` or `D.S.`, and a used jump must have a unique destination.
- `%` repeats the previous measure. If you leave out the chord, the previous chord is kept.

These marks resolve the order of written measures without changing their display order. GuitarDSL does not play audio.

### Chords

Chord names follow the pattern root + quality + optional bass, for example `C`, `Am7`, `Fmaj7`, `Gsus4`, `Cadd9`, `D/F#`.

- Several chords in one chord cell share the measure evenly: `| C G | ... |`.
- Give a length in beats with `:`, or as a note value with `/`: `C:3 G:1`, `C/2+8 G/4.`, `G/B/2`.
- Inline chords change at their position in the rhythm: `| C 4.d 4.d G 4.d 4.d |`.

#### Chord Definitions

Use `chord` lines to define diagram shapes. Frets are listed from the 6th string to the 1st: `x` = muted, `0` = open at the capo, and a number = frets relative to the capo. For example, with `capo: 2`, `0` means the physical 2nd fret. Fretted notes can reach physical fret 24, including the capo. Add `@label` to keep several voicings. Invalid definition rows are ignored and do not block a later valid row with the same key. If multiple valid definitions use the same key, the first is used.

```guitardsl
chord C       = x32010
chord C@barre = x35553 fingers:-13331 barre:3
chord C@high  = x,x,10,9,8,8 fingers:--4312

[Intro]
| C@barre:2 C@high:2 | 4.d 4.d 4.d 4.d |
```

Options: `base:<fret>`, `fingers:<6 characters>` (`-`, `1`–`4`, `T`), `barre:<fret>` or `barre:<fret>:<string>-<string>`.

### Rhythm and Strokes

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

Put `l:"..."` (or `~"..."`) inside a measure to write lyrics under it:

```guitardsl
| C | 8.d 8.u 4.d 8.d 8.u 4.d l:"walking in the morning light" |
```

### Page Breaks

A line with only `---` or `pagebreak` starts a new page.

### Melody and Note-Level Lyrics

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

### Guitar TAB

Use `tab:` (or `tab[1]:`) to write guitar positions directly. TAB is independent of `mel:`; you can use either staff or both. String 1 is the highest string and string 6 is the lowest. Frets are relative to the capo, so `0` is the capo position. Tuning and capo determine sounding pitches through the score's guitar model.

```guitardsl
tuning: Drop D
capo: 2
| D | G | A | D |
tab: | 6f0/4 6f2 5f0 5f2 | [6f3,5f2,4f0]/4 6x/4 r/2 | 3f5{hammer}/8 3f7 2f5{bend(amount=1)}/2 1f0/4 | 6f0~/2 6f0/2 |
lyr: | low down open up | chord hit | rise then bend now | hold |
```

- A note is `<string>f<fret>` (`2f5`); `6x` is a dead note. A chord such as `[6f3,5f2,4f0]` attacks several strings together. A rest is `r`. Each string may appear at most once in a chord.
- The first beat in each `tab:` line needs a duration such as `/4`, `/8`, `/2`, or `/1`. Later beats inherit the previous beat's duration, including chords and rests. TAB uses the same dotted and tuplet duration syntax as the rest of GuitarDSL.
- Put note effects directly after a TAB note: `{hammer}`, `{pull}`, `{slide}`, `{gliss}`, `{bend(amount=1)}`, `{vibrato}`, `{pm}`, `{let-ring}`. Put beat effects after the duration with `!{...}`, for example `[6f3,5f2]/4!{pm}`. Note effects are `hammer`, `pull`, `slide`, `gliss`, `bend(amount=number)`, `vibrato`, `pm`, and `let-ring`; beat effects are `pm` and `let-ring`.
- Put `~` after an individual note to tie that string to the same fret in the next sounding beat, for example `[6f3~,5f2]/2`. Connections such as hammer and pull target the next TAB beat on the same string.
- `let` fragments can hold TAB sequences and `$name` reuses them. Each fragment has its own duration inheritance; ties and connections started inside it must finish there. In a TAB measure cell, `%` repeats the previous TAB measure. Consecutive `lyr:` lines after TAB add verses; one chord or attacked beat takes one lyric slot, while rests and tie-only beats take none.
- `tab[2]:`, `tab[3]:`, and `tab[4]:` are reserved and unsupported in this release. The current subset does not include advanced Guitar Pro 8 effects. Capo, transpose, and beginner-mode source transforms report TAB as unsupported until TAB-aware transforms are defined; editing `capo:` or `tuning:` in the source remains valid.

When a row contains TAB, it uses a modern six-line profile with equal string lines, a stacked `T` / `A` / `B` clef, and a time signature inside the staff prefix. Ten-point semibold fret marks sit centered on their lines, which are masked behind each number. Rhythm stems and beams sit above TAB; whole notes have no stem, half notes have a short stem, quarters have a normal stem, and shorter values use flags or beams. Standard rests, barlines and repeat signs are shown. Adjacent beat-scope P.M. and let-ring effects use a continuous dashed span. TAB is rendered below melody and its lyrics when present. TAB carries its own rhythm. An implicit slash-rhythm staff is suppressed; an explicitly authored rhythm staff can still be shown with `show_rhythm: true`. PDF uses the same page rendering as Preview.

### Key Signature and Display Options

The `key:` header sets the melody key signature, for example `C`, `G`, `Bb`, `F#m`. Melody is always written at the real pitch. With `show_rhythm: false`, measures that have a melody show only the melody staff.

### Score Events

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

Events: `@key:`, `@tempo:` (a number, `rit.`, `accel.`, `a tempo`, `tempo primo`), `@time:`, `@feel:`, `@dynamic:`, `@mark:`, `@text:` and `@ottava:` (`8va`, `8vb`, `off`). Numeric `@tempo:` values change Preview playback from that measure; `tempo primo` restores the header `bpm:`. `rit.`, `accel.`, `a tempo` and `feel` remain display-only and do not change playback timing. Dynamics and ottava affect notation only.

### Reusable Fragments (`let`)

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

Write notes that sound together in square brackets with one shared length: `[c4,e4,g4]/4`. Each note needs its own octave. Group-level techniques such as `{staccato}` are allowed, but ties, hammer-ons, slides, bends and slurs are not.

```guitardsl
| C | [c4,e4,g4]/4 [c4,eb4,g4]/8 8.u 4.d [c4,e4,g4]/4{staccato} |
| C | G |
mel: | [c4,e4,g4]/2 [d4,f4,a4]/2 | [c4,e4,g4]/4. [d4,f4]/8 [e4,g4]/2 |
```

### Rendering and Layout

Each row has a treble clef, and the first row shows the time signature. Chord names sit above the staff, stroke marks above the slashes, and lyrics below. A key or time-signature change starts a new row. The complete rules are in the GuitarDSL syntax specification (`docs/specs/guitardsl-syntax.md` in the source repository).

## Troubleshooting

### Squiggles and the Problems Panel

GuitarDSL checks your file as you type.

- **Errors** mean a line or token is ignored, for example an unknown score event or an invalid chord definition.
- **Warnings** mean the score still renders but probably not as intended, for example a measure whose beats do not add up.

Hover over a squiggle or open the **Problems** panel to read the message. Common causes:

| Message is about… | What to check |
|---|---|
| Measure length | The rhythm or notes in the measure must add up to the time signature (4 beats in 4/4). Remember that dotted rhythm tokens are written `4+8`, not `4.`. |
| Uppercase note name | Melody notes are lowercase (`e4/8`). Uppercase letters are chord names. |
| First note of `mel:` | The first note on each `mel:` line, and in each `let` definition, needs both octave and length (`e4/8`). |
| Too many `mel:` cells | There are more melody cells than measures without a melody above them in the same section. |
| Syllable count | The number of `lyr:` syllables does not match the sung notes. Use `_` to extend a syllable and `*` to skip a note. |
| `l:"..."` together with a melody | A measure with a melody uses `lyr:` lyrics, so `l:"..."` is not drawn there. |
| Tuning | Write `tuning:` once in the header. Use a known preset or six octave-qualified pitches, separated by spaces, from the 6th string to the 1st (for example, `D2 A2 D3 G3 A3 D4`). |
| Chord definition | Write six fret values from the 6th string to the 1st. Numbers are relative to the capo; fretted notes must stay within 5 frets of the start fret and at or below physical fret 24, including the capo. Invalid rows are ignored and do not reserve a chord name; among valid duplicates, the first is used. |
| Unknown `@label` | `C@x` is used but no `chord C@x = ...` exists. The plain `C` shape is drawn instead. |
| `let` / `$name` | Undefined names, circular references, `%` inside a definition, or a fragment used where it is not allowed (for example, rhythm tokens in `mel:`). |
| Note groups | Each note in `[...]` needs an octave, there are no spaces inside the brackets, and a length is required after `]`. |
| Unrecognized token | A measure can hold only chords, rhythm tokens, notes, `$name`, `%`, volta brackets, navigation marks and `l:"..."`. Lyrics belong in `lyr:` or `l:"..."`. |
| Continuation line | A `mel:` / `lyr:` line cannot continue on an indented `\| ... \|` line (that line is not read as measures). Put it on one line, or start each line with `mel:` / `lyr:`. |
| `:\|` without `\|:` | Write `\|:` at the start of the passage to repeat. |

### The Preview Looks Wrong or Does Not Change

- The preview draws what it can. Ignored lines (errors) simply do not appear, so fix the problems listed in the Problems panel first.
- The preview follows the active GuitarDSL editor. If you switched files, the preview switches too.
- If you changed the capo or turned on Beginner Mode in the capo bar, the preview shows a modified version of your file. Your file itself does not change until you choose **Apply to DSL**. When an edit makes the change impossible, the preview goes back to your file and shows a warning.

### PDF Export Fails

When the PDF cannot be written, an error message is shown and no partial file is left behind. Check that the target folder is writable and that the file is not open in another program. The PDF always matches the current preview, including a temporary capo or Beginner Mode.

### Capo, Beginner Mode or Transpose Cannot Be Applied

These tools show a reason when a change is not possible. Common reasons:

- The DSL has errors.
- `capo:` is not an integer from 0 to 12.
- A labeled chord such as `C@label` is used.
- A transposed chord name would collide with a `chord` definition.
- A melody note would leave octaves 0–9.

Chord definitions that may become unused are reported but never deleted.

### YouTube Transcription

- **API key**: you are asked for a Gemini API key on first use. Run **GuitarDSL: Set Gemini API Key** to change it, or **GuitarDSL: Clear Gemini API Key** to remove it.
- Only public `https://` URLs from `youtube.com`, `www.youtube.com` and `youtu.be` are accepted.
- Network, quota or authentication problems, private videos, invalid results and songs not in 4/4 cause an error message. No document is created and existing files are not changed.

### Local Audio Transcription (Experimental)

- The input must be an uncompressed integer PCM WAV file: 16 or 24 bit, mono or stereo, 44.1 or 48 kHz, up to 128 MiB and 15 minutes long. MP3, AAC, M4A and FLAC are not supported.
- It runs only in desktop VS Code on local files. It does not work in vscode.dev or remote windows.
- Only one analysis can run at a time. Cancel it from the progress notification.
- If no stable beat or no complete measure is found, no document is created. See the **GuitarDSL Audio MIR** output channel for details.
- Results are an experimental draft. Check chords and strokes by ear.

### About Playback

GuitarDSL draws scores. It does not play them. Tempo, dynamics and other score events are shown as notation only.

## Command Reference

Run these from the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`). This list is generated from `package.json`.

| Command | ID |
|---|---|
| GuitarDSL: Open Preview to the Side | `guitardsl.showPreview` |
| GuitarDSL: Export PDF / Print | `guitardsl.exportPdf` |
| GuitarDSL: Import Guitar Pro 7/8 | `guitardsl.importGuitarPro` |
| GuitarDSL: Export Guitar Pro 7 | `guitardsl.exportGuitarPro` |
| GuitarDSL: Edit Chord Diagram | `guitardsl.editChordDiagram` |
| GuitarDSL: Edit Score Settings | `guitardsl.editScoreSettings` |
| GuitarDSL: Edit Capo / Playability | `guitardsl.editCapo` |
| GuitarDSL: Transcribe from YouTube (Experimental) | `guitardsl.transcribeYouTube` |
| GuitarDSL: Transcribe Local Audio (Experimental) | `guitardsl.transcribeAudio` |
| GuitarDSL: Set Gemini API Key | `guitardsl.setGeminiApiKey` |
| GuitarDSL: Clear Gemini API Key | `guitardsl.clearGeminiApiKey` |
| GuitarDSL: Change Accompaniment Pattern (Strumming / Arpeggio) | `guitardsl.applyStrummingPattern` |
| GuitarDSL: Open Help | `guitardsl.openHelp` |
| GuitarDSL: New from Template | `guitardsl.newDocumentFromTemplate` |
| GuitarDSL: Open Sample | `guitardsl.openSample` |
| GuitarDSL: Play / Pause Preview Playback | `guitardsl.playback.togglePlayPause` |
| GuitarDSL: Stop Preview Playback | `guitardsl.playback.stop` |
| GuitarDSL: Toggle Practice Mode | `guitardsl.practice.toggle` |
| GuitarDSL: Set Practice Loop Start (A) | `guitardsl.practice.setLoopStart` |
| GuitarDSL: Set Practice Loop End (B) | `guitardsl.practice.setLoopEnd` |
| GuitarDSL: Clear Practice Loop | `guitardsl.practice.clearLoop` |
| GuitarDSL: Practice Slower | `guitardsl.practice.slower` |
| GuitarDSL: Practice Faster | `guitardsl.practice.faster` |

## Settings Reference

Change these in VS Code Settings (`Ctrl+,` / `Cmd+,`). This list is generated from `package.json`.

| Setting | Type | Default | Description |
|---|---|---|---|
| `guitardsl.gemini.model` | `string` | `"gemini-3.8-flash"` | Gemini model to use for experimental YouTube audio transcription. |
| `guitardsl.transcription.compressRepeats` | `boolean` | `false` | Compress repeated sections with identical chords and melody into repeat barlines (\|: :\|) and multi-line lyrics to shorten the score. |
| `guitardsl.expandPageBreakRepeats` | `boolean` | `true` | Automatically expand measure repeat symbols (%) when they appear at the start of a page. |
