## Features
<!-- help-sources: extension:3 -->

### GuitarDSL Sidebar
<!-- help-sources: extension:3 extension:4C -->

Click the **GuitarDSL** icon in the Activity Bar to open the **Start Here** view. It works before you open any GuitarDSL file. It is a starting point, not a score editor.

- **Get Started**: **New from Template** (Basic Chord Song, Melody Example or Lead Sheet Example), **Open Sample** (five bundled samples), **Open Preview to the Side** and **Open Help**. Templates and samples open as editable untitled documents, so no original file changes. Save them under any name.
- **Current File**: when the active editor holds a GuitarDSL file, the actions for that file: preview, chord diagram editing, score settings, capo / playability, accompaniment pattern and PDF export. When no GuitarDSL file is active, it shows a hint only.
- **Tools**: YouTube transcription and local audio transcription (experimental).

The Command Palette commands **GuitarDSL: New from Template** and **GuitarDSL: Open Sample** do the same.

### Editor Support
<!-- help-sources: extension:2 extension:5 extension:5A -->

- Syntax highlighting for headers, sections, chords, rhythm tokens, lyrics, melody (`mel:` / `lyr:`), chord definitions, score events and `let` fragments.
- Comment toggling with `#`, and bracket and quote pairing.
- **Outline**: metadata, sections, a chord summary for each measure line, and score events appear in the Outline view and **Go to Symbol in File**.
- **Diagnostics**: errors and warnings appear as you type (see **Troubleshooting**).

### Score Preview
<!-- help-sources: extension:4 syntax:11 -->

**GuitarDSL: Open Preview to the Side** shows the rendered score next to the editor. The preview follows your edits and the active GuitarDSL editor. The toolbar offers:

- **View**: *Single Page*, *Spread* (two pages side by side) or *Web* (one continuous page, with manual page breaks shown as a dotted line).
- **Paper** (A4, A3, A5, B4, B5, Letter) and **Orientation** (*Portrait*, or *Landscape*, which puts two pages on one sheet).
- **📄 Save PDF** and the **?** Help button.

Measures wrap onto rows automatically (4 per row by default, set with `measures_per_row`). Pages break automatically when a row does not fit, and at every manual `pagebreak` / `---` line. Page 1 shows the full header with chord diagrams. Later pages show a compact running header.

### PDF Export
<!-- help-sources: extension:3 extension:4 -->

**📄 Save PDF**, or **GuitarDSL: Export PDF / Print**, writes a vector PDF of exactly what the preview shows, using the selected paper size and orientation. No browser is needed, and fonts are bundled, so output does not depend on your installed fonts. Printing is done from the saved PDF.

### Chord Diagrams and the Chord Diagram Editor
<!-- help-sources: extension:4A syntax:7 -->

Every chord used in the score is drawn as a fretboard diagram in the header. The shape comes from a `chord` definition in the file if one exists, otherwise from the built-in library. You can keep several voicings of the same chord with labels, such as `C@barre`.

**GuitarDSL: Edit Chord Diagram** opens a visual editor. Start it from:

- the **Edit Diagram** CodeLens above a `chord` line,
- a click on a diagram in the preview, or
- the Command Palette.

In the editor, pick a preset, click frets, open and mute strings, and set finger numbers, barres and the start fret. It suggests chord names from the sounding notes. Saving inserts or replaces the `chord` line as an undoable edit.

### Capo and Playability
<!-- help-sources: extension:4 -->

The preview's second toolbar row (the capo bar) lets you try another capo position without changing your file. The chords are rewritten so the song sounds the same. Each position shows a playability score (0–100, *Very easy* to *Very hard*), and the easiest one is marked *★ Recommended*. **Apply to DSL** writes the change to the file in one undoable edit. **Edit…** opens the Score Settings editor.

### Beginner Mode
<!-- help-sources: extension:4 -->

Turn on **Beginner mode** in the capo bar to see the song with an easy capo position and simpler chords, for example `F → Fmaj7` or `G7 → G`. The sounding key does not change. **Barre chords** can be *Allow* or *Do not use*. With *Do not use*, no shape that needs a barre is used. Beginner mode is a preview-only view until you choose **Apply to DSL**, and the PDF uses the same result as the preview.

### Score Settings
<!-- help-sources: extension:3 extension:4B -->

**GuitarDSL: Edit Score Settings** opens a settings panel for the whole song with three sections:

- **Capo / Playability**: every capo position with its score, the recommendation, and the chord mapping.
- **Beginner Mode**: the settings and chord substitutions described above.
- **Transpose**: transposes the whole song by −11 to +11 semitones or to a target key. This changes the sounding key, melody and chords. The capo can stay the same, follow the recommendation, or be set to a value you choose.

Each section applies its result as one undoable edit. **GuitarDSL: Edit Capo / Playability** opens the same panel at the capo section.

### Change Accompaniment Pattern
<!-- help-sources: extension:3 -->

**GuitarDSL: Change Accompaniment Pattern (Strumming / Arpeggio)** replaces the rhythm of the measures with a preset strumming or arpeggio pattern. Start it from:

- the **Change Pattern [section]** CodeLens above a section heading, or
- the Command Palette, where you first choose the whole score or one section.

The change is a single undoable edit.

### YouTube Transcription (Gemini)
<!-- help-sources: extension:3 -->

**GuitarDSL: Transcribe from YouTube** sends a public YouTube URL to Google Gemini and opens a new, unsaved GuitarDSL document with chords, rhythm and melody. It supports 4/4 songs only. It needs a Gemini API key, which is stored in VS Code's secret storage. Manage the key with **GuitarDSL: Set Gemini API Key** and **GuitarDSL: Clear Gemini API Key**. The model is chosen by the `guitardsl.gemini.model` setting. This feature uses the network, and existing files are never overwritten.

### Local Audio Transcription (Experimental)
<!-- help-sources: extension:3 -->

**GuitarDSL: Transcribe Local Audio (Experimental)** analyzes a WAV file on your computer, with no network and no API key. It estimates key, BPM, chords and strum positions, then opens the result as a new unsaved document. Down and up strokes are guessed from their position in the beat, and the output is 4/4 only. Treat the result as a rough draft. Details of the analysis are written to the **GuitarDSL Audio MIR** output channel. This feature is **experimental** and works only in desktop VS Code on local files.

### Score Events and Advanced Notation
<!-- help-sources: syntax:12 syntax:16 -->

You can change key, tempo, time signature, feel and ottava in the middle of a song, and add dynamics, rehearsal marks and text. Techniques such as hammer-ons, slides, bends, grace notes, slurs, palm mutes and let ring are also drawn. These are **notation only**: the extension draws them on the score. It does not play audio.
