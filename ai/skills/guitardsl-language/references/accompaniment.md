# Accompaniment (strumming / arpeggio) arrangement

You decide the music; the extension guarantees the notation. Never write down/up strokes, durations or ties yourself when a tool can generate them.

## Workflow

1. Call `guitardsl_analyze_accompaniment` (`#guitardslAccompaniment`) first. Without `sectionIndex` it lists the sections (0-based `sectionIndex` in source order; measures before the first label are section 0; a repeated label such as a second `[Chorus]` is a separate section), their meters, feels, current rhythm families, canonical preset matches, `availableFamilies`, the section transition contexts and the ending context. Call it again with `sectionIndex` + `family` to see that family's compatible presets.
2. Note the `document.uri`, each target `sectionIndex`, its meter and feel, and the compatible presets.
3. Apply with `guitardsl_apply_accompaniment` (`#guitardslApplyAccompaniment`), passing `uri`. One call can plan several sections; it edits everything or nothing, as one undoable edit.
4. Afterwards run `guitardsl_validate_dsl`.

## Choosing the plan mode

- General requests ("calm verse, strong chorus", "make it funkier") → `mode: intent` with style, subdivision, energy, density, syncopation, emphasis. The extension picks a canonical preset deterministically.
- A specific catalog pattern is clearly wanted → `mode: preset` with its `presetId`.
- The user names exact strum positions ("hit only the & of 2 and 4") → `mode: grid` with `attacks` (0-based slots); the extension decides down/up and durations.
- Only when the user gives a GuitarDSL rhythm pattern themselves → `mode: dsl`. Keep `directionPolicy` at its default `physical`. Never choose `literal` on your own; use it only when the user explicitly asks for special stroke directions. Prefer the catalog's all-down presets (`mode: preset`) over a literal pattern.
- Relative changes ("a bit stronger", "softer", "slightly syncopated", "for beginners") → `operation: adapt`, which keeps the current family, style and subdivision. If it fails with `noCompatibleAdaptation`, tell the user; do not silently switch to `replace`.
- Family changes ("make it 8-beat", "switch to 16-beat", "arpeggio instead") → `operation: replace`.
- "For beginners" → `difficulty: beginner`.

## Musical rules

- Think of syncopation as `offbeat`, `anticipation` or `beatCrossing`. "食い" (pushing a beat) means anticipation inside the measure.
- This tool never moves a chord change before the barline (cross-bar harmonic anticipation). If the user asks for it, explain that it is not supported.
- Every chord must get at least one harmonic attack (a non-ghost stroke) before the next chord. Prefer patterns that strike the chord onset; offbeat styles such as reggae may strike just after it.
- Do not invent string numbers or right-hand fingering for arpeggios.
- Sections may use different patterns. Give repeated sections the same `arrangementGroup` (e.g. every chorus `"chorus"`) so their family stays consistent. Mark the last chorus `arrangementRole: finale` to allow a lift within the same family.
- Phrase ends (2, 4 or 8 measures, `phraseLength`) may take the catalog's fill / cadence / lift / breakdown variations; the extension chooses them deterministically.
- Section guidance (suggestions, never overriding the user): Intro sparse, sustain or arpeggio. Verse below the chorus in energy and density. Pre-chorus building density, syncopation or emphasis. Chorus medium/high energy, backbeat, anticipation. Bridge in contrast (arpeggio, sustain, other subdivision). Final chorus at least as strong as earlier choruses. Outro sparse, sustain or rolled.
- Genre is a hint, not a fixed mapping; also weigh the BPM, the section and the user's words. Typical families: pop / acoustic pop → 8-beat basic or backbeat; rock → 8-beat full, palm mute, backbeat; punk → eighth all-downs; funk / R&B / city pop → 16-beat syncopated or ghosted; reggae / ska → eighth offbeat; blues → shuffle; swing → swing comping; ballad → sustain or arpeggio; 3/4 → waltz; 6/8 and 12/8 → compound.

## Transitions and the ending

- For a non-final section boundary you may pass up to 3 ordered `transitions` candidates (`space`, `hold`, `lift`, `fill`, `cadence`) for the section's last (`-1`) or second-to-last (`-2`) measure. Express them as structured patterns (`preset`, `grid` or `hold`), never raw down/up tokens. Consider the style, where the vocal phrase ends and the next section's energy. If every candidate is illegal, the base pattern stays.
- Treat the end of the song as an ending, not a transition. Pass up to 3 ordered `ending` candidates (`hold`, `finalHit`, `fillToHold`, `breakThenHit`, `rolledFinal`) for the final 1–2 measures. Typical orders: ballad hold → rolledFinal → finalHit; rock / J-POP fillToHold → finalHit → hold; funk breakThenHit → finalHit → hold; acoustic rolledFinal → hold → fillToHold.
- With exact `mel:` + `lyr:` timing, never put a fill or lift where the vocal is still singing; with several verses the most conservative timing applies. When timing is unknown, choose conservative endings (hold, finalHit, rolledFinal).
- Never invent chord onsets or new measures for an ending, and never insert `@tempo: rit.` for it.
