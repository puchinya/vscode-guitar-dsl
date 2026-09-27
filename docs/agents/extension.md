# VS Code Extension Technical Guide

Technical working rules and architectural invariants for `vscode-guitar-dsl`.

## Extension Architecture

The extension provides visualization and language support for GuitarDSL files (`.guitardsl`, `.gdsl`).

### 1. Language Support & Grammar
- Language ID: `guitardsl`
- Syntax Grammar: TextMate JSON grammar defined in `syntaxes/guitardsl.tmLanguage.json`.
- Language Configuration: `language-configuration.json` (comments, brackets, auto-closing pairs).

### 2. Extension Host & Commands
- Entry point: `src/extension.ts` (`activate`, `deactivate`).
- Commands registered in `package.json`:
  - `guitardsl.showPreview`: Opens or reveals a side-by-side WebviewPanel rendering the current GuitarDSL document.
  - `guitardsl.exportPdf`: Exports the score to PDF in-process (pdfkit, no browser).

### 3. Compiler & Rendering Pipeline
- `src/compiler.ts`: parses GuitarDSL text into the score AST (`ParsedScore`) only. It must not depend on rendering modules.
- `src/render/`: layout (`layout.ts`), page SVG rendering (`svg.ts`), chord data (`chordLibrary.ts`) and the webview HTML shell (`previewHtml.ts`).
- `src/pdf.ts`: converts the same sheet SVGs to PDF with the bundled Noto Sans JP (`media/fonts`).

### 4. Webview Invariants & Security
- Webview panel title matches the active document name.
- Use `vscode.workspace.onDidChangeTextDocument` to update preview live on text changes.
- Webview Content Security Policy (CSP) must restrict script and style sources to trusted extension resources (`webview.asWebviewUri`).

### 5. AI Integration (VS Code Agent / Chat)
- `src/ai/tools.ts` contains adapters over existing domain APIs only: `parseGuitarDsl`, `inferCapoForDsl`, `applyCapoTransform` / `applyBeginnerTransform` / `applyTransposeTransform`, and `analyzeAccompaniment` / `applyAccompanimentTransform`. It must not own transformation logic, such as capo, playability, Beginner Mode, transposition or accompaniment rules. It must not build its own `WorkspaceEdit`, and it must not accept replacement DSL from the model. The one exception is the accompaniment `dsl` plan: a one-measure rhythm pattern that the engine validates and writes into rhythm spans only.
- Accompaniment music logic lives only in `src/accompaniment.ts` (pure: no VS Code, Gemini, transcription or Audio MIR import). The preset catalog in `src/strummingPatterns.ts` is the only catalog. Do not add aliases or a second catalog, and do not infer metadata from IDs. Add or change presets only through the spec (`docs/specs/extension.md` §8.7.1) and keep `presetProblems` passing for every preset.
- Accompaniment edits replace only `MeasureData.rhythmSource` spans. Never rewrite whole lines, never expand `%`, and never move chords or lyrics.
- The extension never calls a language model (`vscode.lm.selectChatModels` / `sendRequest`). It adds no chat participant, custom agent, AI webview or MCP server, and no `extensionDependencies` on an AI extension.
- Exactly seven tools are exposed. Their names, reference names and `onLanguageModelTool:` activation events are fixed by `docs/specs/extension.md` §8.3 and enforced by `npm run check:ai`.
- `ai/skills/guitardsl-language/references/guitardsl-syntax.md` is generated from `docs/specs/guitardsl-syntax.md` by `npm run generate:ai`. Never edit it by hand. Transcription and Audio MIR identifiers must not appear in `ai/**` or in tool descriptions. `ai/skills/guitardsl-language/references/accompaniment.md` is an authored guide, not generated; keep `SKILL.md` short and put accompaniment guidance there.
- Document resolution for commands and read-only tools lives in `src/documentResolver.ts` (one implementation). Mutation tools never use it. Their target is fixed by the input (`uri` or an absolute `path`), so the confirmed document is the edited one.
- `prepareInvocation` must be free of side effects: no recorded state, no document or UI change. VS Code shares only the input with `invoke` and does not guarantee that `invoke` follows.
