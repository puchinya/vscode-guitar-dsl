# GuitarDSL Help
<!-- help-sources: extension:1 -->

## About GuitarDSL
<!-- help-sources: syntax:1 extension:1 -->

**GuitarDSL** is a plain-text language for guitar scores such as strumming charts and lead sheets. You write chords, strum patterns (down/up strokes), melody and lyrics as text. The **GuitarDSL Previewer** extension then renders them as a score with a staff, rhythm slashes, pick-direction marks, chord names and chord diagrams.

- File extensions: `.guitardsl` and `.gdsl` (UTF-8 text)
- One line = one element: a header, a section heading, a measure line, a melody line, and so on
- `#` starts a comment

## Getting Started
<!-- help-sources: syntax:3 syntax:15 extension:3 extension:4 -->

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
<!-- help-sources: extension:5A -->

Errors and warnings in your score appear as squiggles in the editor and in the **Problems** panel. An error means a line is ignored. A warning means the score still renders but may not match what you meant, such as a measure with the wrong number of beats. See **Troubleshooting** below.

## Opening This Help Again
<!-- help-sources: extension:3 extension:6 -->

- Command Palette: **GuitarDSL: Open Help**
- The **?** Help button in the score preview toolbar

Help opens next to your editor and never changes your score. It is bundled with the extension and works offline. Help, commands and messages appear in Japanese when VS Code's display language is Japanese, and in English otherwise.
