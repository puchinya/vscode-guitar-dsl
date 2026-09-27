---
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
