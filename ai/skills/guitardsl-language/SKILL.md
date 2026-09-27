---
name: guitardsl-language
description: GuitarDSL (.guitardsl / .gdsl) guitar score language syntax and semantics. Use when reading, writing, explaining or editing GuitarDSL scores (chords, rhythm, lyrics, melody, score events, fragments, note groups, headers), when creating or composing a new GuitarDSL song or score from scratch, and when arranging accompaniment.
---

# GuitarDSL language

The only authority for GuitarDSL syntax and semantics is the [language specification](./references/guitardsl-syntax.md).

If either packaged resource cannot be loaded, do not search existing GuitarDSL documents or samples as a substitute specification; report the missing resource instead of guessing. Read an existing score/sample only when the user asked to use it as a reference or template.

## How to look things up

Read only the headings you need, never the whole specification. Its `## N.` sections: 1–3 overview, lexical rules, layout; 4 metadata headers (`title:`, `capo:`, `key:`, `time:` …); 5 section headers `[Name]`; 6 measures, barlines; 7 chords, custom diagrams; 8 rhythm / stroke tokens; 9, 13 lyrics; 10–11 page breaks, layout; 12 melody `mel:`; 14 key signature, display; 15 complete example; 16 score events; 17 fragments `let` / `$name`; 18 note groups `[...]`.

## Rules

1. Use only syntax the reference defines. If it is not supported, say so; never invent notation.
2. Check the relevant section before writing an unconfirmed construct.
   Lines never continue: keep each `mel:` / `lyr:` on one line, or repeat the prefix per line (`## 6.3`). Lyrics go only in `lyr:` or `l:"..."`, one syllable per sung note.
3. After you create or materially edit GuitarDSL, run `guitardsl_validate_dsl` (`#guitardslValidate`). Fix every reported error and validate again. Fix warnings too (syllable counts, measure lengths, `:|` without `|:`) unless the user asked for that notation.
4. Never compute capo changes, playability, Beginner Mode substitutions or sounding transposition yourself; use:
   - `guitardsl_analyze_playability` (`#guitardslPlayability`)
   - `guitardsl_apply_capo` (`#guitardslApplyCapo`)
   - `guitardsl_apply_beginner_mode` (`#guitardslApplyBeginner`)
   - `guitardsl_apply_transpose` (`#guitardslTranspose`)

   Each is one undoable edit. They edit only the document you name with `uri` or an absolute `path`. For the user's current file, call `guitardsl_validate_dsl` without arguments and pass its `document.uri` (existing-score tasks only; never for a new/create request).

5. To arrange or change the accompaniment (strumming / arpeggio patterns), first read the [accompaniment guide](./references/accompaniment.md), then use `guitardsl_analyze_accompaniment` (`#guitardslAccompaniment`) and `guitardsl_apply_accompaniment` (`#guitardslApplyAccompaniment`). You decide the intent.

6. New score from scratch: read the [accompaniment guide](./references/accompaniment.md) first. Create a distinct new GuitarDSL document first; do not reuse an existing score as the target, and pin every step to the new document. Write a structural draft with no D/U rhythm, then `guitardsl_validate_dsl` → `guitardsl_analyze_accompaniment` → one `guitardsl_apply_accompaniment` → `guitardsl_validate_dsl`. If a tool fails, never fall back to hand-written rhythm.
