---
name: guitardsl-language
description: GuitarDSL (.guitardsl / .gdsl) guitar score language syntax and semantics. Use when reading, writing, explaining or editing GuitarDSL scores (chords, rhythm, lyrics, melody, score events, fragments, note groups, headers), when creating or composing a new GuitarDSL song or score from scratch, and when arranging accompaniment.
---

# GuitarDSL language

The only authority for GuitarDSL syntax and semantics is `references/guitardsl-syntax.md`, a generated copy of the language specification. This file only tells you how to use it.

## How to look things up

Read only the headings you need, never the whole reference:

| Topic | Section in `references/guitardsl-syntax.md` |
|---|---|
| Overview, lexical rules, document layout | `## 1.`, `## 2.`, `## 3.` |
| Metadata headers (`title:`, `capo:`, `key:`, `time:` …) | `## 4.` |
| Section headers `[Name]` | `## 5.` |
| Measures and barlines | `## 6.` |
| Chord names and custom chord diagrams | `## 7.` |
| Rhythm / stroke tokens | `## 8.` |
| Lyrics and syllable lyrics | `## 9.`, `## 13.` |
| Page breaks, rendering/layout rules | `## 10.`, `## 11.` |
| Melody lines (`mel:`) | `## 12.` |
| Key signature and display options | `## 14.` |
| Complete example | `## 15.` |
| Score events (mid-score changes) | `## 16.` |
| Reusable fragments (`let` / `$name`) | `## 17.` |
| Note groups `[...]` | `## 18.` |

## Rules

1. Use only syntax that the reference defines. If it is not supported, say so; never invent notation.
2. Check the relevant section before writing a construct not yet confirmed in this conversation.
   Lines never continue: keep each `mel:` / `lyr:` on one line, or repeat the prefix per line (`## 6.3`). Lyrics go only in `lyr:` or `l:"..."`, one syllable per sung note.
3. After you create or materially edit GuitarDSL, run `guitardsl_validate_dsl` (`#guitardslValidate`) on the document. Fix every reported error and validate again. Fix warnings too (syllable counts, measure lengths, `:|` without `|:`) unless the user asked for that notation. Diagnostics are the parser's verdict.
4. Never compute capo changes, playability, Beginner Mode substitutions or sounding transposition yourself; use:
   - `guitardsl_analyze_playability` (`#guitardslPlayability`)
   - `guitardsl_apply_capo` (`#guitardslApplyCapo`)
   - `guitardsl_apply_beginner_mode` (`#guitardslApplyBeginner`)
   - `guitardsl_apply_transpose` (`#guitardslTranspose`)

   Each is one undoable edit. They edit only the document you name with `uri` or an absolute `path`. For the user's current file, call `guitardsl_validate_dsl` without arguments and pass its `document.uri`.

5. To arrange or change the accompaniment (strumming / arpeggio patterns), first read the authored guide `references/accompaniment.md`, then use `guitardsl_analyze_accompaniment` (`#guitardslAccompaniment`) and `guitardsl_apply_accompaniment` (`#guitardslApplyAccompaniment`). You decide the musical intent; the tools generate the strokes and the edit.

6. New score from scratch (a complete new song): read `references/accompaniment.md` first. Write a structural draft with no D/U rhythm, then `guitardsl_validate_dsl` → `guitardsl_analyze_accompaniment` → one `guitardsl_apply_accompaniment` → `guitardsl_validate_dsl`. If a tool fails, never fall back to hand-written rhythm.
