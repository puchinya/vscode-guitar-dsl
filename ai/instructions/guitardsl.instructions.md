---
name: GuitarDSL editing and creation
description: Use when creating, composing, writing, editing, or arranging GuitarDSL (.guitardsl/.gdsl) scores, including creating a new song before a GuitarDSL file exists.
applyTo: '**/*.{guitardsl,gdsl}'
---

# GuitarDSL editing rules

These files are GuitarDSL guitar scores.

- Never invent unsupported syntax. Use only notation defined by the GuitarDSL language specification.
- For syntax or semantics, use the `guitardsl-language` Skill. It loads the relevant sections of the packaged specification.
- After creating or materially editing a GuitarDSL file, validate it with `guitardsl_validate_dsl` (`#guitardslValidate`). Resolve reported errors, and warnings too unless the user asked for that notation, before finishing.
- There is no line continuation. Write each `mel:` / `lyr:` on a single line (or start every line with `mel:` / `lyr:`); an indented `| ... |` line after them is an error, not a continuation. Every `:|` needs a `|:`.
- Do not work out capo changes, playability, Beginner Mode or sounding transposition by hand. Use the deterministic tools:
  - `guitardsl_analyze_playability`
  - `guitardsl_apply_capo`
  - `guitardsl_apply_beginner_mode`
  - `guitardsl_apply_transpose`
- The `guitardsl_apply_*` tools edit only the document given by `uri` (for example, `document.uri` from `guitardsl_validate_dsl`) or by an absolute `path`.
- To arrange or change the accompaniment (strumming / arpeggio patterns), call `guitardsl_analyze_accompaniment` first, then `guitardsl_apply_accompaniment`. Decide the musical intent yourself. Do not hand-write down/up strokes: use `intent`, `preset` or `grid` plans, and `dsl` only for a pattern the user gave. Never pick `directionPolicy: literal` on your own.

## New GuitarDSL score workflow

When you create a complete new GuitarDSL song or score with accompaniment, follow these steps in order, even if you already know a valid rhythm pattern.

For a new/create request, create a distinct new GuitarDSL document first. Never reuse an active, visible, last-active, or other open GuitarDSL document as the output target unless the user explicitly asked to edit that document; you may only read it for reference. Establish the new target before calling any GuitarDSL tool, and keep every validate/analyze/apply step pinned to that same new target: pass its `path` once saved, or, for an untitled document that is active, keep the `document.uri` from the first validation. During new-song creation, do not use target-less validate/analyze calls if they could resolve to an existing GuitarDSL document; save the new document and pass its `path` instead. If you cannot establish a distinct new target, change no file and report it.

1. Create a structural draft first, in the new document: metadata, section labels, chords, optional `mel:` / `lyr:`, barlines and any notation the user asked for. Do not hand-write generated accompaniment rhythm (no `.d` / `.u` D/U strokes, accents, ghosts, ties or arpeggio rhythm). Leave the rhythm out; the parser fills in a temporary default.
2. Run `guitardsl_validate_dsl`. Fix structural errors and unintended warnings.
3. Run `guitardsl_analyze_accompaniment` for the whole score.
4. Decide the musical intent per section. Use `arrangementGroup` for repeated roles, `arrangementRole: finale` for a final repeated chorus, and transition / ending candidates where they fit the music.
5. Call `guitardsl_apply_accompaniment` once for the complete arrangement whenever possible.
6. Run `guitardsl_validate_dsl` again on the same new target and resolve unintended diagnostics.

If the user gives an exact rhythm, still use the tool: exact attack positions → `grid`, a GuitarDSL rhythm pattern they supplied → `dsl`, a named catalog pattern → `preset`.

If an accompaniment tool is unavailable, denied, cancelled or returns an error, do not fall back to manual rhythm generation. Leave the draft unchanged, tell the user the accompaniment is not realized yet, and do not say the arrangement is finished.
