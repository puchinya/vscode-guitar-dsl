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
| Chord definition | Six fret values from the 6th string to the 1st, and all fretted notes within 5 frets of the start fret. |
| Unknown `@label` | `C@x` is used but no `chord C@x = ...` exists. The plain `C` shape is drawn instead. |
| `let` / `$name` | Undefined names, circular references, `%` inside a definition, or a fragment used where it is not allowed (for example, rhythm tokens in `mel:`). |
| Note groups | Each note in `[...]` needs an octave, there are no spaces inside the brackets, and a length is required after `]`. |

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
