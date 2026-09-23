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
