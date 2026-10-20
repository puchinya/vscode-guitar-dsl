## Features
<!-- help-sources: extension:3 -->

### GuitarDSL Sidebar
<!-- help-sources: extension:3 extension:4C -->

Click the **GuitarDSL** icon in the Activity Bar to open the **Start Here** view. It works before you open any GuitarDSL file. The top target row follows only the active GuitarDSL editor; it does not switch to another open file.

- **Create**: **New from Template** (Basic Chord Song, Melody Example or Lead Sheet Example) and **Open Sample** (five bundled samples). Templates and samples open as editable untitled documents, so no original file changes.
- **Open / Import**: open a `.guitardsl` or `.gdsl` file, import a Guitar Pro 7/8 file, or choose YouTube or local WAV for experimental transcription.
- **Edit Assist**: open the active score in Preview or open the shared Inspector. The Inspector can also show its empty state when no GuitarDSL file is active.
- **Export**: export the active score as PDF or Guitar Pro 7.
- **Help**: open this bundled GuitarDSL Help.

Preview and export actions use the active editor when you click them. If the active editor is not a GuitarDSL file, the extension shows a warning and does not switch to another open file. The Command Palette commands **GuitarDSL: New from Template** and **GuitarDSL: Open Sample** do the same as the Create actions.

The Command Palette commands **GuitarDSL: New from Template** and **GuitarDSL: Open Sample** do the same.

### GuitarDSL Inspector
<!-- help-sources: extension:4D -->

The Inspector is a shared place for document-aware assistance as features move into it. Use **GuitarDSL: Open Inspector** from the Command Palette. It follows only the active GuitarDSL document and shows an empty state when none is active. Typing, cursor movement, and ordinary document switches do not reveal it. Document information is read-only. Progression auditions play from the Inspector; regular playback and Practice stay in Preview. If you move the view, VS Code keeps it in that location.

### Editor Support
<!-- help-sources: extension:2 extension:5 extension:5A extension:5B -->

- Syntax highlighting for headers, sections, chords, rhythm tokens, lyrics, melody (`mel:` / `lyr:`), chord definitions, score events and `let` fragments.
- Comment toggling with `#`, and bracket and quote pairing.
- **Outline**: metadata, sections, a chord summary for each measure line, and score events appear in the Outline view and **Go to Symbol in File**.
- **Diagnostics**: errors and warnings appear as you type (see **Troubleshooting**).
- **Code Actions**: transpose selected chord names or notes by sounding pitch, toggle enharmonic spelling, double or halve durations, normalize pitch names, and extract or inline rhythm `let` fragments. An unused chord definition offers a Quick Fix, and a repeated-pattern Hint can extract one occurrence. Select complete editable tokens; comments and formatting outside the selection are preserved.

### Score Preview
<!-- help-sources: extension:4 syntax:11 -->

**GuitarDSL: Open Preview to the Side** shows the rendered score next to the editor. The preview follows your edits and the active GuitarDSL editor. Its 48 px playback row keeps Play, Pause, Stop, seek, and elapsed/total time visible. A dedicated 44 px Score settings row sits directly below it at every width, with directly operable Capo, colored Playability, and Beginner controls. At 840 CSS px and wider it also shows barre policy, capo selection mode, and Inspector links; below that width, use **More** for those supplemental controls. When playback is unavailable, the controls remain visible with a reason.

- **Practice** shows its 42 px row below Score settings only while enabled; it starts at 92 px from the top. Practice OFF leaves no extra row. The score begins at 110 px when Practice is OFF and 152 px when ON.
- The fixed bottom guide follows score time and shows every measure, melody, lyrics, techniques, chord names/diagrams, and the next chord. During playback it highlights the current lyric syllable and written rhythm slot, including each continuation slot in sequence. The automatic 4/8/16 grid is songwide; a manual grid changes guide marks only. `〜` marks a sustained value or valid tie continuation, `.m` uses `・`, and rests keep their own value-specific mark. Brushes and staccato do not imply sustain.
- **Playback settings** opens a disclosure for **Count-in** and **Metronome**, both off by default.
- **View & Export** opens a disclosure for *Single Page*, *Spread*, *Web*, paper size (A4, A3, A5, B4, B5, Letter), orientation (*Portrait* or *Landscape*), and **📄 Save PDF**. Web mode is one continuous page with manual page breaks shown as a dotted line.
- **? Help** opens this guide. Disclosure panels can be opened by click or keyboard; press Escape to close and return to the trigger.
- Playback uses a simple synthesized sound preview. Count-in plays one full measure before playback, including when the score starts with a pickup.

### Chord Progression Suggestions and Audition
<!-- help-sources: extension:3 extension:4 -->

**GuitarDSL: Suggest Chord Progression** opens the common Inspector from CodeLens in the active GuitarDSL editor. It starts with four bars and prefers safe replacement; if that is unavailable, it starts with safe append at the end of the score. Choose 4, 8, or 16 bars and replacement or append in the Inspector. Unavailable choices are disabled. Up to five deterministic candidates show the chord sequence, score, and tonal rationale and can be selected by click or keyboard. Candidates come from a fixed catalog and the current key, capo, and melody. Scores are heuristics for comparing candidates. Completions in chord cells can still suggest the next chord.

- You can replace only the chord names in the target range or append chord-only measures at the end of the score. Rhythm, melody, lyrics, comments, and whitespace are preserved. An empty chord cell uses the immediately preceding `@key` for its target key. A range can start after a key change, but any `@key` event inside the replacement range is rejected, even when it repeats the same key. Ranges that cross keys or contain ambiguous harmony are also unavailable. Targets that cannot be resolved safely are unavailable, including repeated measures, multiple chords, explicit chord durations, custom voicings, TAB, and source errors.
- Selecting a candidate only adds source-preserving Decorations in the editor and updates Preview B when that Preview is already open. It does not change the source, document version, or undo history and does not start playback. Use the Inspector's **Play**, **Stop**, **A Original**, **B Candidate**, audition mode, speed, **Apply**, and **Close** controls. Choose a single chord, the full progression, the progression with melody, or the full song. Eight- and sixteen-bar proposals repeat a four-bar pattern two and four times. **Play** starts the selected range directly in the Inspector. If Preview is already playing, that playback stops first; Preview regular playback and Practice can be used again when the audition stops or finishes. Speed ranges from 50% to 150% and remains selected across A/B and candidate switches. Switching candidates, sides, or speed stops current audition audio. Preview retains its regular playback, Practice, and PDF controls.
- Choose **Apply candidate** and confirm to write the candidate in one undoable edit. If the document changes before apply, the edit is cancelled.

### Practice Mode
<!-- help-sources: extension:3 extension:4 -->

Turn on **Practice** in the Preview toolbar to show the Practice row below it. Practice changes playback only; it does not edit the GuitarDSL source or its written tempo. Turn it off to remove the row and its keyboard stops.

Practice also opens a fixed guide at the bottom of the Preview for the whole song. Melody, lyrics, techniques, chord names and diagrams share one continuous time axis across measures. The left labels and the next-chord name stay fixed while the timeline scrolls horizontally. Melody notes appear as pitch bars sized by duration; lyric syllables follow their notes. Turning **Melody** off hides only that lane. **Chord diagrams** can be toggled separately. **Auto** scans written note values across the song and uses one quarter-, eighth- or sixteenth-note grid for every measure. A manual grid is a temporary display setting for this Preview and does not change the DSL or playback position.

- **Speed** ranges from 25% to 200% in 5% steps. The selected speed is remembered by the Preview.
- During playback, the playhead aligns with the score's note and rhythm positions and moves with score time between them.
- **Loop** can repeat the current measure, the contiguous performed measures belonging to the current section, or an A/B range. A section label applies to its written measure and following written measures up to the next section label. Choose **Section** on any measure in a named section. Repetitions that are contiguous in playback order share one range; a same-name section after another section remains separate. **A** records the current playback position and clears B; **B** must be later than A. **Clear** removes the loop and both points. Loop ranges include A and stop before B.
- With **Count-in** enabled, starting Practice playback from a non-zero position plays one measure of count-in using that performed measure's meter and tempo. Count-in follows Practice speed and does not repeat on each loop.
- **Follow** keeps the active measure in view by scrolling the Preview. Scrolling or navigating manually in the Preview turns Follow off. It does not move the source editor's selection or cursor.
- The Command Palette also offers **GuitarDSL: Play / Pause Preview Playback**, **Stop Preview Playback**, **Toggle Practice Mode**, **Set Practice Loop Start (A)**, **Set Practice Loop End (B)**, **Clear Practice Loop**, **Practice Slower** and **Practice Faster**. You can assign your own keybindings to these commands.

At 600 px wide, the transport, Practice, both disclosure buttons, and Help remain visible. On narrow panels the action labels give way to icons with accessible names. In still narrower panels the supplemental action buttons can scroll horizontally; the transport stays in the toolbar.

Measures wrap onto rows automatically (4 per row by default, set with `measures_per_row`). Pages break automatically when a row does not fit, and at every manual `pagebreak` / `---` line. Page 1 shows the full header with chord diagrams. Later pages show a compact running header.

Rows with `tab:` or `tab[1]:` show a conventional six-string TAB staff below any melody and melody lyrics, with a stacked `T` / `A` / `B` clef, broken string lines behind centered fret numbers, and rhythm marks above the staff. TAB carries its own rhythm, so an implicit slash-rhythm staff is omitted; explicitly authored rhythm is shown when `show_rhythm: true`. TAB and PDF use the same page SVG rendering path.

### PDF Export
<!-- help-sources: extension:3 extension:4 -->

**📄 Save PDF**, or **GuitarDSL: Export PDF / Print**, writes a vector PDF of exactly what the preview shows, using the selected paper size and orientation. No browser is needed, and fonts are bundled, so output does not depend on your installed fonts. Printing is done from the saved PDF.

### Importing and Exporting Guitar Pro Files
<!-- help-sources: extension:3 -->

Use **GuitarDSL: Import Guitar Pro 7/8** in the Command Palette to open a supported `.gp` file as a new untitled GuitarDSL document. If more than one guitar track is supported, choose the track to import. The source file is not changed.

After choosing a track, select **Faithful import** (the default) or **Optimize for chord strumming**. Faithful import keeps the existing conversion and preserves TAB and pitches. Optimization converts a whole eligible score to chord symbols and exact-duration rhythm slashes while keeping rests and measure structure. It omits repeated generated chord names when the harmony stays the same, preserves source-authored chord labels, and leaves empty or chord-only measures without adding rhythm attacks.

Import supports GP7/GP8 `.gp` files with one selected six-string guitar track, one staff, and the supported voice. Unsupported musical meaning in the selected track stops the import. Other tracks, audio, sound settings, and display layout can be omitted only under the command's reported loss policy.

If optimization is unavailable, or its output cannot be serialized or validated after parsing, the command explains why and lets you switch explicitly to faithful import or cancel. The fallback reuses the already imported score. Before creating the document, it shows one summary of omitted TAB pitches, voicings, and fingering, inferred chords, and display or supported lyric changes. A document is created only when the selected GuitarDSL output validates successfully.

Section titles and double barlines are preserved. A separate Section display letter is reported as a loss. Free-time bars, master-bar fermatas, and multiple score views with conflicting notation flags stop the import instead of being guessed.

**GuitarDSL: Export Guitar Pro 7** saves the current GuitarDSL document as a GP7 `.gp` file. An untitled document created by import can be exported before saving it. Run the command from the Command Palette or the Explorer context menu; there is no export button in the editor's top-right toolbar. Before saving, the extension checks the supported scope and reports information that would be lost. It does not overwrite an existing file. GP8 8.1.5 native checks opened, displayed, re-saved, and re-imported the self-authored contract fixtures with matching score meaning. Native GP7-app compatibility has not been tested; automated GP7-format import/export checks are included.

### Chord Diagrams and the Chord Diagram Editor
<!-- help-sources: extension:4A syntax:7 -->

Every chord used in the score is drawn as a fretboard diagram in the header. The shape comes from a `chord` definition in the file if one exists, otherwise from the built-in library. A slash chord without its own library shape, such as `F/A`, is drawn with the shape of its upper chord (`F`); `G/B` and `D/F#` have their own shapes. With a non-Standard tuning, only preset shapes that sound as the requested chord are shown. Frets are relative to the capo, and capo playability and Beginner Mode use the same tuning and shape. Chord-name suggestions in the diagram editor also use the score's tuning. You can keep several voicings of the same chord with labels, such as `C@barre`.

**GuitarDSL: Edit Chord Diagram** opens a visual editor. Start it from:

- the **Edit Diagram** CodeLens above a `chord` line,
- a click on a diagram in the preview, or
- the Command Palette.

In the editor, pick a preset, click frets, open and mute strings, and set finger numbers, barres and the start fret. It suggests chord names from the sounding notes. Saving inserts or replaces the `chord` line as an undoable edit.

### Capo and Playability
<!-- help-sources: extension:4 -->

Open the Preview's native Capo list to compare each position's score and localized level; ★ marks the recommended option. Options start with the number only, since the adjacent label already says Capo. While the list is closed, the selected field shows only the number so it does not overlap nearby controls. Unsupported positions stay visible but disabled, and a missing score or level is shown as **Not available** in the open list.

Use the Preview's always-visible **Score settings** row to select a capo, see the current Playability score and level, and toggle Beginner mode directly. The score is shown with text and color: green for Very easy/Easy, ochre for Moderate, and red for Hard/Very hard; unavailable is neutral and is never shown as zero. At 840 CSS px and wider, barre policy, automatic/fixed capo selection, and Inspector links also appear in the row. When Beginner substitutions or a capo warning are present, use the details button in that row to read them; at narrower widths, open **More** for the same information. For a full comparison, open the shared Inspector with **GuitarDSL: Edit Score Settings** or **GuitarDSL: Edit Capo / Playability**. Using the current tuning, the chords are rewritten so they sound the same. `tuning`, `key` and melody remain unchanged. The Inspector shows every capo candidate and marks the easiest position as *★ Recommended*. **Apply to DSL** in the Inspector writes the change to the file in one undoable edit. For a score with TAB, capo changes that would rewrite the source are reported as unsupported until a TAB-aware transform is available.

### Beginner Mode
<!-- help-sources: extension:4 -->

Turn Beginner mode on directly from the Preview's **Score settings** row to start with barre chords forbidden and the recommended capo selected automatically. At 840 CSS px and wider, change the barre policy and choose an automatic or fixed capo in the row; at narrower widths, open **More**. The Capo / Playability detail link opens the Inspector's matching section; the Beginner detail link opens **Beginner Mode**. Use that section for a full comparison of capo positions and simpler chords, for example `F → Fmaj7` or `G7 → G`. The key and melody's sounding pitches do not change. The Preview and PDF use the same temporary effective score; turning Beginner mode off restores the source score. **Apply to DSL** is available in the Inspector and writes the change in one undoable edit. Beginner transforms are unsupported for scores with TAB until they can preserve explicit string/fret positions.

### Score Settings
<!-- help-sources: extension:3 extension:4B -->

**GuitarDSL: Edit Score Settings** opens the shared Inspector for the whole song with three sections:

- **Capo / Playability**: every capo position with its score, the recommendation, and the chord mapping.
- **Beginner Mode**: the settings and chord substitutions described above.
- **Transpose**: transposes the whole song by −11 to +11 semitones or to a target key. This changes the sounding key, melody and chords. The capo can stay the same, follow the recommendation, or be set to a value you choose.

Selecting a Capo or Beginner candidate temporarily compares it in an already-open Preview for the same document. The Preview's own Temporary Score Settings also change these transient selections; those independent actions take priority over an open Inspector draft. These actions do not open Preview or edit the DSL. If you open Preview yourself while Score Settings is still open, the current draft appears there; closing Score Settings restores the Preview state from just before it opened unless an independent Preview action replaced it. Transpose does not change Preview before Apply. **Apply to DSL** asks for confirmation, then applies the selected result as one undoable edit. **GuitarDSL: Edit Capo / Playability** opens the same Inspector at the capo section. For a score with TAB, source-changing capo and transpose operations are reported as unsupported; the transform does not partially rewrite the document.

### Change Accompaniment Pattern
<!-- help-sources: extension:3 -->

**GuitarDSL: Change Accompaniment Pattern (Strumming / Arpeggio)** replaces the rhythm of the measures with one of 58 strumming and arpeggio patterns. Start it from:

- the **Change Pattern [section]** CodeLens above a section heading, or
- the Command Palette, where you first choose the whole score or one section.

You choose in two steps. First pick a category that fits the meter: 8-beat, 16-beat, Shuffle, Arpeggio and so on for 4/4, or 3/4 Waltz, 6/8, 12/8 and so on for other meters. Then pick a pattern. Patterns are grouped by style: Pop / J-POP, Rock / Punk / Metal, Funk and others. When the current rhythm is already a catalog pattern, **Close to the current pattern** appears first.

- Only the rhythm changes. Chords, lyrics, melody, comments and `%` stay as they are, and so do pickup measures.
- A score with mixed meters cannot take one pattern for the whole score. Choose a section instead.
- Measures are left alone when a change would alter the meaning of a `%`, or when they contain inline notes.
- The change is a single undoable edit.

### YouTube Transcription (Gemini, Experimental)
<!-- help-sources: extension:3 -->

**GuitarDSL: Transcribe from YouTube (Experimental)** sends a public YouTube URL to Google Gemini and shows the generated chords, rhythm and melody in a read-only result preview inside the YouTube panel. Use **Copy** to paste the DSL into a regular GuitarDSL editor and edit it. The extension does not create an unsaved document automatically, and closing the panel discards the preview. It supports 4/4 songs only. The panel keeps key management and detailed transcription options in separate disclosures; the key status normally shows whether a key is saved. If the key status cannot be read from secret storage, the panel says **Key state unavailable** without claiming that a key is saved or missing. In that case, enter and save the key again inside **Set or change key**. The key is stored in VS Code's secret storage and is not displayed in the status. **Transcription Options (Advanced)** contains BPM, capo, beat type, accompaniment family and preset, repeat compression, and model. Start is available when a URL and either a saved or entered key are present. If the saved key cannot be read when Start is pressed, the panel shows an error and does not call Gemini or create a result preview; save the key again and retry. The model is also chosen by the `guitardsl.gemini.model` setting. This feature uses the network, and existing files are never overwritten. Closing the panel during processing does not cancel the work, but its result is discarded. If you reopen the panel before the work finishes, the panel synchronizes the current Host job state and allows Start again after that job settles.

The generated score must pass structural validation before it opens, but that does not establish musical correctness. Chords, rhythm, melody, lyrics, BPM, section boundaries and other inferred details may be wrong. Treat the result as a draft and review and correct it before use.

### Local Audio Transcription (Experimental)
<!-- help-sources: extension:3 -->

**GuitarDSL: Transcribe Local Audio (Experimental)** analyzes a WAV file on your computer, with no network and no API key. It estimates key, BPM, chords and strum positions, then opens the result as a new unsaved document. Down and up strokes are guessed from their position in the beat, and the output is 4/4 only. Treat the result as a rough draft. Details of the analysis are written to the **GuitarDSL Audio MIR** output channel. This feature is **experimental** and works only in desktop VS Code on local files.

### AI Integration (VS Code Agent / Chat)
<!-- help-sources: extension:1 extension:8 -->

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
<!-- help-sources: syntax:12 syntax:16 -->

You can change key, tempo, time signature, feel and ottava in the middle of a song, and add dynamics, rehearsal marks and text. Techniques such as hammer-ons, slides, bends, grace notes, slurs, palm mutes and let ring are also drawn. These are **notation only**: the extension draws them on the score. It does not play audio.
