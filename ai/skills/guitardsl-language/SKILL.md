---
name: guitardsl-language
description: GuitarDSL (.guitardsl / .gdsl) guitar score language syntax and semantics. Use when reading, writing, explaining or editing GuitarDSL scores (chords, rhythm and strum tokens, lyrics, melody lines, score events, let fragments, note groups, capo, key and display headers).
---

# GuitarDSL language

The only authority for GuitarDSL syntax and semantics is `references/guitardsl-syntax.md`, a generated, unmodified copy of the extension's language specification. This file only tells you how to use it and does not repeat the specification.

## How to look things up

Read only the headings you need. Do not load the whole reference at once. The reference's top-level sections are:

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

1. Use only syntax that the reference defines. If the reference does not support something, say so. Do not invent a notation.
2. Check the relevant section before writing a construct that you have not already confirmed in this conversation.
3. After you create or materially edit GuitarDSL, run the `guitardsl_validate_dsl` tool (`#guitardslValidate`) on the document. Fix every reported error and validate again. Diagnostics are the parser's verdict. Do not argue with them.
4. Do not calculate capo changes, playability, Beginner Mode chord substitutions or sounding transposition yourself. Use these tools instead:
   - `guitardsl_analyze_playability` (`#guitardslPlayability`)
   - `guitardsl_apply_capo` (`#guitardslApplyCapo`)
   - `guitardsl_apply_beginner_mode` (`#guitardslApplyBeginner`)
   - `guitardsl_apply_transpose` (`#guitardslTranspose`)

   They apply the extension's own deterministic algorithms as one undoable edit.

   These tools edit only the document you name with `uri` or an absolute `path`. To target the file the user is working on, call `guitardsl_validate_dsl` without arguments first and pass its `document.uri`.
