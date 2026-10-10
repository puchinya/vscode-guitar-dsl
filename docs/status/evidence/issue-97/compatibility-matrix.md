# Issue #97 Guitar Pro compatibility matrix

## Environment

| Item | Result |
|---|---|
| Host | Local macOS desktop; macOS 26.6.2 |
| Official app | Guitar Pro 8.1.5 build 31, `/Applications/Guitar Pro 8.app`, bundle `com.arobas-music.guitarpro8` |
| Guitar Pro 7 | Not installed; the user excluded native GP7-app checks from the contract. Status: `NOT RUN / EXCLUDED`. GP7 file-format handling remains under automated import/export and writer self-roundtrip coverage. |
| GUI access | Native Guitar Pro 8 UI; open/display/save actions were observed through CUA accessibility state and screenshots. |
| Fixture rights | Checked-in scores are self-authored for Issue #97. The user-supplied score was verified locally and is not stored in the repository. |

## Source fixture matrix

SHA-256 values identify the exact checked-in input files.

| Fixture | SHA-256 | Contract coverage / import result |
|---|---|---|
| F01 `F01-standard-4-4.gp` | `e90eb4813ba135f67b3d0d4c449b7ad6e70ac88addc7f24ef31ea1e4674ce607` | Standard 4/4 guitar TAB baseline; import/export PASS. |
| F02 `F02-drop-d-capo2.gp` | `829cd52eafcff3cf1bd78453a34a3f947e27c2b4d7a1711cadfc95afee0f4e24` | Drop D, capo 2, fret-0 note; import/export PASS. |
| F03 `F03-time-meter-key-pickup.gp` | `503b0b49e77baa53b3236de94c99e9cc020bfe469c764af44af7c735d477ebf3` | Pickup, 7/8, key change, tempo automation; import/export PASS. |
| F04 `F04-chord-onsets.gp` | `b3d65635ace7ad8bfbcd87591fa965a0a909d6594cb1d0b5fa7ece7338c0ef9b` | C and G/B chord diagrams at distinct onsets; import/export PASS. |
| F05 `F05-techniques.gp` | `6a1d1bb2cff19c55907b7d45260496e1d97b5616a25ca2b954583bb57f55c9b1` | Tie, hammer/pull, slide, bend, palm mute, let-ring, tuplet; import/export PASS. |
| F06a `F06-repeat.gp` | `81de57341c7abbceb809b640bc0e7fde36b205c162999e01209f35e000e87094` | Start/end repeat count 2; import/export PASS. |
| F06b `F06-navigation.gp` | `336d1032c9bcd09c57a0d5963f8e1e7a596bf466aad047c0de5b240c5f49953d` | Alternate endings, Segno, D.S., Coda, and Da Coda; import/export PASS. |
| F07 `F07-multitrack-voice2.gp` | `ef4738dc7b91471865e219582b0ca671581dbf7fb0ee970fc07ba773ff4e9ef0` | Explicitly selects one eligible guitar; voice-2 track is ineligible and unselected tracks follow the named drop policy. Export writes one selected track. |
| F08a `F08-audio-syncpoint.gp` | `42306a421b92fd32fb6b6dbe1f99531fcbc8ad4b207a717077ce855b68cbd586` | Selected guitar imports/exports; audio track/asset and SyncPoints are reported as dropped under the named user-selected-track policy. |
| F08b `F08-advanced-technique.gp` | `c4c44a8b5c42c63b6a8db4cb92a2f294b16185b282e0fdbf34d46a38640717c5` | Selected-track Trill/XProperties are rejected as blocking `unsupportedSemantics`; no export is produced. |
| F09 `F09-chord-only.gp` | `d259c74a33a62f666d64cf1f47364bf2bc881370a9f9c5da7245d08526a0a117` | Chord-bearing beat has no notes and the GPIF has zero `Note` elements; import/export PASS. |
| F10 `F10-melody-only.gp` | `efde8b16738fd34f27215206714f589c83aa52cf4b22b7604d6d5fe09253d41b` | Standard-notation melody has no TAB positions; import/export PASS without inventing string/fret values. |

## User-supplied file verification

Run locally on 2026-10-10. The source filename, title, lyrics, and file bytes are intentionally omitted; the original file was not modified or copied into the repository.

| Check | Result |
|---|---|
| GPIF inspection and eligible-track selection | PASS — exactly one eligible track. |
| GPIF import → GuitarDSL serialization → GuitarDSL parse → InterchangeScore | PASS — 37 written measures; parser had zero error diagnostics. |
| Empty final measure | PASS — measure 37 remained an `N.C.` measure with no chord, melody/TAB attack, or rhythm event. |
| Lyrics | PASS — all 18 lyric slots remained after GuitarDSL and GP7 export/re-import. |
| GP7 export and re-import | PASS — 37 written measures and the empty final measure were preserved. |
| Guitar Pro 8.1.5 app | PASS — the generated GP7 roundtrip opened in the official app with no error dialog. |

## Observed GPIF mappings

| Field | Observation |
|---|---|
| Family/version | GP8 source fixtures use archive `VERSION=7.0` while `Content/score.gpif/GPVersion` is `8.1.5`; embedded `GPVersion` selects the family. The writer emits GPIF 7.0. |
| Archive contents | The reader consumes only `Content/score.gpif`; F08a additionally contains a WAV asset and audio metadata. No archive paths are extracted to disk. |
| Reference chain | `MasterBar/Bars` → `Bar/@id` → `Bar/Voices` → `Voice/@id` → `Voice/Beats` → `Beat/@id`; beat note and rhythm references resolve by ID. |
| Tuning/capo | Standard `Tuning/Pitches=40 45 50 55 59 64`; Drop D `38 45 50 55 59 64`; F02 has `CapoFret/Fret=2`. |
| Meter/key/pickup/tempo | F03 records an anacrusis, a one-quarter-note pickup, a following 7/8 measure, key change, and 90 BPM automation. |
| Chord references | GP8 renders beat chord references in CDATA form, for example `<Chord><![CDATA[0]]></Chord>`. F04 uses the references with chord diagrams at multiple onsets; F09 proves a chord-only beat without notes or rests. |
| Techniques | F05 preserves supported GPIF note/beat effects, ties, and tuplet data through writer self-roundtrip and GP8 re-save. Unsupported selected-track semantics block import. |
| Navigation | F06a stores repeat start/end/count; F06b covers alternate endings and Segno/D.S./Coda/Da Coda targets and jumps. |
| MasterBar metadata | F03 uses reviewed `XProperty/@id` and one `Int` value for each entry. Only the documented ID/value pairs are omitted; unknown IDs, values, duplicate IDs, or shapes block import. |
| Section and double bar | C-01 confirms GP8.1.5 needs `Section/Text` in CDATA with an empty `Letter` for a visible section label; the same output's `DoubleBar` remains visible and both survive native re-save/import. |
| Track policy | F07 confirms the voice-2 guitar is ineligible, and non-selected tracks are reported under `gp78.user-selected-single-track.v1`. F08a confirms its audio track is dropped under the same user-selected-track policy. |
| Melody-only | F10 is emitted with standard notation enabled and TAB disabled; re-import contains no synthesized string/fret position. |

## Native writer-output acceptance in Guitar Pro 8

Run on 2026-10-10 with Guitar Pro 8.1.5 build 31. Each output listed below was generated by the current `exportGp78`, opened and displayed in GP8, saved under a new temporary name by GP8, then re-imported. `PASS` means the contract semantic projection matched the selected source fixture after GP8 re-save. Hashes are SHA-256; F01–F10 temporary files were under `/private/tmp/issue97-e4-writer/`; the C-01 combined-marker files were under `/private/tmp/issue97-c01/`.

| Fixture | Writer output SHA-256 | GP8 re-save SHA-256 | Visible result and semantic re-import |
|---|---|---|---|
| F01 | `e540a018929cc334ffc8f5998c74ef891e601c96be97004dc623163e219cf5c0` | `116126da367def4c061a4bba9a420341a9f5df1a2eea51c68d07f1ccf3226d36` | PASS — standard notation and fret-0 TAB note visible. |
| F02 | `37438a7bf9eac466164e0d169483241812d1be09da17d747063b61edec7b2741` | `8cd5f26abeabfefd075173750d2cbaa895ea9631e04c8488ca6bd4dd5fc96d82` | PASS — Drop D and capo fret 2 visible with the note. |
| F03 | `b2970c46f1dbb9cd4e5a7c022a708a3c1a349a0d1869721cb31390be32f56afb` | `98e9cffc731908fed5c5314748b0501ae00175a20f03cc5c3779ff2dccc2178b` | PASS — pickup, 7/8, key-signature change, and 90 BPM automation visible. |
| F04 | `338320b82e24b64c839789434b7ea2d1ebbdc662e4ca655ab14fea8c27e87fbc` | `0d0d0b968f8206d6e113521ff5cf976940d775f025cc2e7b52190e00a3bbd2d6` | PASS — C and G/B labels and diagrams displayed; GP8 re-import preserved chord names/onsets and TAB. |
| F05 | `73e17906408b18eae3f57335e5d8741657fb08bcfb2d848fd4551c18855ec528` | `0d37fdba0b14a1d0c6f7ef2486e051469d6000923a1fa33f32c07ac3d73031ba` | PASS — hammer/pull, slide, bend, let-ring, palm mute, and triplet display; semantic equality. |
| F06a | `db52acbb6fb8b2b339f3f39d69c1a81e13a75d516be8c4e8afc0ae4f60e0dac2` | `e8400c2353ceb158d68ddea34c65999b2d8ebd520fa21e336070d94957238be5` | PASS — repeat start/end markers displayed and preserved. |
| F06b | `8e96b50c87aed74417373f1cdb599ec6dd13061481753121bb9d262d7740ad49` | `318cda59cd7bb5dd60da045c48ffa8375f024a49e7f6772dee85b480e0904d94` | PASS — Segno, Dal Segno, Da Coda, and first ending displayed; semantic equality includes both alternate endings and navigation marks. |
| F07 | `5f55ad572d3b1116d1507c5ef3e49dc9c0c3d2a003a6d27634cc00a8585570cc` | `52e555fab87001f1ae04dc77a01a59c17fadff2fea6c685bbe46f4053d11526a` | PASS — only the explicitly selected eligible guitar track is written; GP8 displays its empty bar as a rest, matching the selected source track. |
| F08a | `3964d8871d98e29414dc777bd2c39f478bf0db25a3ee36b305136305aad3e8dd` | `95f05a6be0d4b0a7e688233f6ca43026637c072ab3c3249e474610bee46efede` | PASS — selected guitar displays; audio/SyncPoint loss is explicit and score meaning matches. |
| F09 | `b94763e6e51bf42e90d829323b80b9eaad06e3444bdec367147a3d9dd3795897` | `da54fdf7c7c317f530f6d7597643f710c34e91df43fa354120ed72d1c9a3c250` | PASS — C diagram/name displays above a chord-only bar; GP8 save/re-import retained chord semantics. |
| F10 | `3964d8871d98e29414dc777bd2c39f478bf0db25a3ee36b305136305aad3e8dd` | `95f05a6be0d4b0a7e688233f6ca43026637c072ab3c3249e474610bee46efede` | PASS — standard-notation melody displays without TAB positions; semantic equality. |
| C-01 (F01 + Section/DoubleBar) | `51449463ddfd598e05548104fe5595c4196ad0019da7d6972bb9f53625b5f721` | `28a04d0c947943703cdc7bf5812b3239ca963f711f3aedcbb8328a6b00cb95b8` | PASS — GP8 displays the `Intro` section and double bar; re-import projection is identical (`mismatchPath=null`, one measure, `sectionStart=Intro`, `doubleEnd=true`, one TAB position). |

F08b is a blocking import fixture by contract and therefore has no writer output. GP7 native-app verification remains `NOT RUN / EXCLUDED` and does not block completion.

## Final automated verification

Run locally on 2026-10-10 on macOS 26.6.2 with Node.js v26.7.0 and npm 11.19.0.

| Command | Result |
|---|---|
| `npm run compile` | PASS. |
| `npm test` | PASS — `check:help`, `check:ai`, 1058 unit tests, and 57 E2E tests, including the Issue #97 Untitled import/export command flow. Earlier runs intermittently failed undo-history E2E assertions in Issues #62, #65, #68, and #80 (7 or 15 failures); the final full rerun exited 0. |
| `npm run vscode:prepublish` | PASS — with `~/.cargo/bin` prepended to `PATH`, `wasm-pack`, `rustup`, `rustc`, and `cargo` resolved from that directory; WASM build, Help/AI generation, and TypeScript compilation completed without Homebrew tools. |
| `npx @vscode/vsce ls` | PASS — 1581 package entries; GP78 modules, extension Help, and grammar are included. |
| `python3 -m agent_workflow validate-docs --issue 97` | PASS — 7 changed documentation files, no errors. |
| `git diff --check` | PASS. |
