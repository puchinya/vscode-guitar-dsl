# Testing and Verification Guide

This document is the sole verification command authority for `vscode-guitar-dsl`.

## Verification Gate

Every extension-changing task must pass the mandatory verification gate before PR delivery and after stable review remediation.

### 1. Mandatory TypeScript Compilation Gate

Run:
```bash
npm run compile
```

- Must compile cleanly (`tsc -p ./`) with exit code 0.
- Zero TypeScript diagnostics / errors.
- Generates/updates `./out/extension.js` and `./out/compiler.js`.

### 2. Syntax & Grammar Verification

When modifying `syntaxes/guitardsl.tmLanguage.json` or `language-configuration.json`:
- JSON syntax must be valid (`python3 -m json.tool syntaxes/guitardsl.tmLanguage.json > /dev/null`).
- Scopes must match TextMate naming conventions (e.g. `keyword.control`, `string.quoted`, `comment.line`).

### 3. Packaging & Prepublish Sanity Check

Run:
```bash
npm run vscode:prepublish
```

- Verifies compilation completes without errors before packaging.
- Optionally run `npx @vscode/vsce ls` to ensure package files are resolved correctly.

## Iteration vs. Final Gate

- During iteration: use focused TypeScript checks (`npx tsc --noEmit` or `npm run watch`).
- Final gate: run `npm run compile` and ensure a clean build.
