## Troubleshooting
<!-- help-sources: extension:5A -->

### Squiggles and the Problems Panel
<!-- help-sources: extension:5A syntax:6 syntax:7 syntax:8 syntax:12 syntax:13 syntax:17 syntax:18 -->

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
| Note groups | Each note in `[...]` needs an octave, there are no spaces inside the brackets, and a length is required after `]`. Group ties must continue into the same pitch group; mixed single/group ties are invalid. |
| Unrecognized token | A measure can hold only chords, rhythm tokens, notes, `$name`, `%`, volta brackets, navigation marks and `l:"..."`. Lyrics belong in `lyr:` or `l:"..."`. |
| Continuation line | A `mel:` / `lyr:` line cannot continue on an indented `\| ... \|` line (that line is not read as measures). Put it on one line, or start each line with `mel:` / `lyr:`. |
| `:\|` without `\|:` | Write `\|:` at the start of the passage to repeat. |

### The Preview Looks Wrong or Does Not Change
<!-- help-sources: extension:4 -->

- The preview draws what it can. Ignored lines (errors) simply do not appear, so fix the problems listed in the Problems panel first.
- The preview follows the active GuitarDSL editor. If you switched files, the preview switches too.
- If you changed the capo or turned on Beginner Mode in the capo bar, the preview shows a modified version of your file. Your file itself does not change until you choose **Apply to DSL**. When an edit makes the change impossible, the preview goes back to your file and shows a warning.

### PDF Export Fails
<!-- help-sources: extension:3 -->

When the PDF cannot be written, an error message is shown and no partial file is left behind. Check that the target folder is writable and that the file is not open in another program. The PDF always matches the current preview, including a temporary capo or Beginner Mode.

### Capo, Beginner Mode or Transpose Cannot Be Applied
<!-- help-sources: extension:4B syntax:4 -->

These tools show a reason when a change is not possible. Common reasons:

- The DSL has errors.
- `capo:` is not an integer from 0 to 12.
- A labeled chord such as `C@label` is used.
- A transposed chord name would collide with a `chord` definition.
- A melody note would leave octaves 0–9.

Chord definitions that may become unused are reported but never deleted.

### YouTube Transcription
<!-- help-sources: extension:3 -->

- **API key**: you are asked for a Gemini API key on first use. Run **GuitarDSL: Set Gemini API Key** to change it, or **GuitarDSL: Clear Gemini API Key** to remove it.
- Only public `https://` URLs from `youtube.com`, `www.youtube.com` and `youtu.be` are accepted.
- Network, quota or authentication problems, private videos, invalid results and songs not in 4/4 cause an error message. No document is created and existing files are not changed.

### Local Audio Transcription (Experimental)
<!-- help-sources: extension:3 -->

- The input must be an uncompressed integer PCM WAV file: 16 or 24 bit, mono or stereo, 44.1 or 48 kHz, up to 128 MiB and 15 minutes long. MP3, AAC, M4A and FLAC are not supported.
- It runs only in desktop VS Code on local files. It does not work in vscode.dev or remote windows.
- Only one analysis can run at a time. Cancel it from the progress notification.
- If no stable beat or no complete measure is found, no document is created. See the **GuitarDSL Audio MIR** output channel for details.
- Results are an experimental draft. Check chords and strokes by ear.

### About Playback
<!-- help-sources: syntax:16 -->

GuitarDSL draws scores. It does not play them. Tempo, dynamics and other score events are shown as notation only.
