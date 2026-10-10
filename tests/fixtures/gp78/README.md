# Guitar Pro 7/8 self-authored fixtures

These `.gp` files were created from scratch in Guitar Pro 8.1.5-31 for Issue #97. They contain no third-party songs, recordings, or commercial score content. The GP application generated the container metadata and default track/style data when the files were saved. SHA-256 values and native writer results are recorded in [`compatibility-matrix.md`](../../../docs/status/evidence/issue-97/compatibility-matrix.md).

Guitar Pro 7 is not installed in the verification environment. Per the approved contract, native GP7-app checks are excluded; GP7 format import/export remains covered by automated fixture tests and GP7-compatible writer self-roundtrips.

| Fixture | Content and contract coverage |
|---|---|
| `F01-standard-4-4.gp` | One six-string guitar, one staff/voice, standard tuning, 4/4, and a TAB note. Baseline archive, GPIF IDs, note/string/fret/MIDI, and tempo. |
| `F02-drop-d-capo2.gp` | Drop D tuning and capo fret 2 with a fret-0 note. |
| `F03-time-meter-key-pickup.gp` | Pickup measure, 7/8 change, key change, and tempo automation. |
| `F04-chord-onsets.gp` | C and G/B chord names/diagrams at distinct beat onsets, including a later onset. |
| `F05-techniques.gp` | Ties, hammer-on/pull-off, slide, bend, palm mute, let-ring, and tuplet. |
| `F06-repeat.gp` | Start/end repeat with count 2. |
| `F06-navigation.gp` | Alternate endings and Segno, D.S., Coda, and Da Coda navigation. |
| `F07-multitrack-voice2.gp` | Multiple tracks, including a guitar track with voice 2; exercises explicit eligible-track selection and single-track output policy. |
| `F08-audio-syncpoint.gp` | A selectable guitar plus audio asset/track and SyncPoints; audio is reported as dropped by the user-selected-track policy. |
| `F08-advanced-technique.gp` | A selected guitar containing unsupported Trill/XProperties semantics; import must stop with `unsupportedSemantics`. |
| `F09-chord-only.gp` | Chord-bearing beat with no `Notes` elements and zero sounding `Note` elements. |
| `F10-melody-only.gp` | Standard-notation melody without TAB positions; import must not invent string/fret data. |

All representable fixtures are exercised through import, export, and writer self-reimport. F08 advanced-technique is the intentional blocking case. All exported fixtures were also opened, displayed, saved by Guitar Pro 8, and re-imported with semantic equality; see the compatibility matrix.
