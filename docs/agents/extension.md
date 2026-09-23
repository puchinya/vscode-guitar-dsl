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
  - `guitardsl.exportPdf`: Triggers print / PDF export via the webview preview.

### 3. Compiler & Rendering Pipeline
- Module: `src/compiler.ts`.
- Compiles GuitarDSL text into musical structures (rhythm slash notations, chord charts, tab scores) and renders SVG / HTML output for webview presentation.

### 4. Webview Invariants & Security
- Webview panel title matches the active document name.
- Use `vscode.workspace.onDidChangeTextDocument` to update preview live on text changes.
- Webview Content Security Policy (CSP) must restrict script and style sources to trusted extension resources (`webview.asWebviewUri`).
