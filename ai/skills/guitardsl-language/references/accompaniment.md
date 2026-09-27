# Accompaniment (strumming / arpeggio) arrangement

You decide the music; the extension guarantees the notation. Never write down/up strokes, durations or ties yourself when a tool can generate them.

## New score from scratch

When you create a complete new GuitarDSL song or score with accompaniment, use this order even if you already know a valid rhythm pattern. Every step works on the same exact document:

1. Create a distinct new GuitarDSL document. Do not search for an existing GuitarDSL document as the destination of a new-song request. Do not reuse the active/visible/last-active/open GuitarDSL document as the new song unless the user explicitly asked to edit it. Pin that new target: its `path` once saved, or the `document.uri` that the first validation returns while the new untitled document is active. If another GuitarDSL document is open and the untitled target could be ambiguous, save the new document and use its `path`.
2. Write the structural draft into that exact document: metadata, section labels, chords, optional `mel:` / `lyr:`, barlines and any notation the user asked for. Do not write explicit generated accompaniment rhythm: no `.d` / `.u` D/U strokes, accents, ghosts, ties or arpeggio rhythm. A measure without rhythm tokens gets the parser's temporary default rhythm.
3. Validate that exact document. Run `guitardsl_validate_dsl`, and fix structural errors and unintended warnings before planning the accompaniment.
4. Analyze that exact document. Run `guitardsl_analyze_accompaniment` without `sectionIndex` for the whole score. Then decide a broad intent for every section (see "Keep intent plans minimal"). Give repeated roles an `arrangementGroup`. Mark a final repeated chorus `arrangementRole: finale` when the form has one. Add a transition only where it is really needed, and a small ending.
5. Apply accompaniment to that exact document. Make one multi-section `guitardsl_apply_accompaniment` request for the complete arrangement whenever possible.
6. Validate that exact document again. Run `guitardsl_validate_dsl` and resolve unintended diagnostics.

If you cannot establish a distinct new target, do not substitute an existing score. Change no file and report it.

If the user specifies the rhythm, still use the tool (see "Choosing the plan mode"): `grid`, `dsl` or `preset`.

If a tool is unavailable, denied, cancelled or returns an error, there is no manual fallback. Do not hand-write the rhythm. Keep the draft unchanged, report that the accompaniment is not realized, and do not claim the arrangement is finished.

A raw DSL snippet that only explains notation in chat, with no GuitarDSL document created or edited, is outside this workflow.

## Workflow

1. Call `guitardsl_analyze_accompaniment` (`#guitardslAccompaniment`) first. Without `sectionIndex` it lists the sections (0-based `sectionIndex` in source order; measures before the first label are section 0; a repeated label such as a second `[Chorus]` is a separate section), their meters, feels, current rhythm families, canonical preset matches, `availableFamilies`, the section transition contexts and the ending context. Call it again with `sectionIndex` + `family` only when a specific family is needed (the user asked for one, or you are diagnosing a failed apply); it lists that family's compatible presets.
2. Note the `document.uri`, each target `sectionIndex`, its meter and feel, and the compatible presets.
3. Apply with `guitardsl_apply_accompaniment` (`#guitardslApplyAccompaniment`), passing `uri`. One call can plan several sections; it edits everything or nothing, as one undoable edit.
4. Afterwards run `guitardsl_validate_dsl`.

## Keep intent plans minimal

For a general request (a new song, or "arrange this" without a named pattern), plan broadly and let the engine pick the pattern:

- Use `mode: intent` with `subdivision: auto` (the default). Set only the required fields: `style`, `energy`, `density`, `syncopation`, `emphasis`, `operation: replace`. Add `arrangementGroup` / `arrangementRole` for repeated sections. Usually omit `phraseLength`; the engine derives it.
- Optional constraints / preferences are not defaults. `family`, a fixed `subdivision`, `syncopationKinds` and `difficulty` are hard constraints (they filter the candidates). `preferredPresetId` is only a soft preference (it favors one preset). Add any of them only when the user asked for it (for example "16-beat" → `family`, "食い" → `syncopationKinds: ["anticipation"]`, "for beginners" → `difficulty`), or when you diagnose a failed apply. A genre name alone does not fix a family: J-POP does not mean `family: eighth`. A named canonical preset uses `mode: preset`.
- Go from the whole-score analysis straight to one multi-section apply. Do not browse presets family by family (`sectionIndex` + `family` per section) to choose a pattern yourself.
- Many compatible candidates is normal, not a problem. Let the deterministic engine choose. Never stop or hand the choice to the user because there are many candidates.
- Keep dynamic headroom for the finale. When a final chorus follows earlier choruses, do not make every chorus maximal. Typical plan: first chorus `arrangementGroup: "chorus"`, `arrangementRole: base`, energy medium, density medium. A later chorus: `variation`, medium (raise one of them a step only if the song needs it). Final chorus: `finale`, energy high, density dense. Similarly verse 1 `base` → verse 2 `variation`, pre-chorus 1 `base` → pre-chorus 2 `variation`. Group sections only when they really share a role. If the user asks for full power from the start, follow the user.
- Transitions are the exception. The engine's phrase-end variations already lift or break at section ends. Do not add `transitions` at every boundary; add one only when the user asks for a fill, break, hold or cadence, or when the vocal timing and form clearly need a special one.
- Endings: use one primary candidate and at most one fallback (for example J-POP `fillToHold` → `finalHit`, ballad `hold` → `rolledFinal`). Do not fill all three slots by habit.
- If an apply fails because of optional constraints you added yourself, you may retry once with minimal intent. Drop, in order: `preferredPresetId`, `syncopationKinds`, your own `family`, a fixed `subdivision` (back to `auto`), your own `difficulty`. Never relax a constraint the user asked for. Keep `arrangementGroup`; if the group itself is the cause, report it. If the retry also fails, report the failure; never hand-write the rhythm.

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

- Only when a special transition is needed (see "Keep intent plans minimal"), you may pass up to 3 ordered `transitions` candidates for a non-final section boundary (`space`, `hold`, `lift`, `fill`, `cadence`) for the section's last (`-1`) or second-to-last (`-2`) measure. Express them as structured patterns (`preset`, `grid` or `hold`), never raw down/up tokens. Consider the style, where the vocal phrase ends and the next section's energy. If every candidate is illegal, the base pattern stays.
- Treat the end of the song as an ending, not a transition. Pass ordered `ending` candidates (`hold`, `finalHit`, `fillToHold`, `breakThenHit`, `rolledFinal`) for the final 1–2 measures: normally one primary and at most one fallback (the tool accepts up to 3). Typical pairs: ballad hold → rolledFinal; rock / J-POP fillToHold → finalHit; funk breakThenHit → finalHit; acoustic rolledFinal → hold.
- With exact `mel:` + `lyr:` timing, never put a fill or lift where the vocal is still singing; with several verses the most conservative timing applies. When timing is unknown, choose conservative endings (hold, finalHit, rolledFinal).
- Never invent chord onsets or new measures for an ending, and never insert `@tempo: rit.` for it.
