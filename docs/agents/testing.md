# Testing and Verification Guide

This document is the sole verification command authority for `vscode-guitar-dsl`.

## Test Rules and Directory Structure

All automated tests must be placed in designated directories based on their scope:

| Test Type | Directory | Execution Environment | Target Scope |
|---|---|---|---|
| **Unit Tests** | `tests/unit/**/*.test.ts` | Node.js (Mocha + tsx) | Pure logic independent of VS Code runtime (e.g. `src/compiler.ts` parsing/rendering, `src/symbols.ts` formatters). Fast and standalone. |
| **E2E Tests** | `tests/e2e/**/*.test.ts` | VS Code Extension Host (`@vscode/test-electron`) | Extension activation, registered commands (`guitardsl.showPreview`, `guitardsl.exportPdf`), language contribution, document symbol providers, and webview interactions. |

### Test Conventions
- Test file naming: `*.test.ts`.
- Unit tests must be completely runnable standalone without launching VS Code or requiring external network access.
- E2E tests run inside a headless VS Code instance managed by `@vscode/test-electron`.

---

## Verification Commands

### 1. Unit Tests
Run standalone unit tests:
```bash
npm run test:unit
```
- Fast iteration check for parser, data structures, and HTML/SVG generation.
- Zero VS Code launch overhead.

### 2. E2E Tests
Run integration tests in VS Code runtime:
```bash
npm run test:e2e
```
- Compiles the extension and test files (`npm run compile:all`).
- Launches VS Code and runs the E2E test suite.

### 3. Full Test Suite
Run both unit and E2E tests:
```bash
npm test
```

---

## Mandatory Verification Gate

Every extension-changing task must pass the mandatory verification gate before PR delivery and after stable review remediation:

### 1. Mandatory TypeScript Compilation Gate
Run:
```bash
npm run compile
```
- Must compile cleanly (`tsc -p ./`) with exit code 0.
- Zero TypeScript diagnostics / errors.
- Generates/updates `./out/extension.js`, `./out/compiler.js`, and `./out/symbols.js`.

### 2. Mandatory Automated Test Gate
Run:
```bash
npm test
```
- All unit tests (`npm run test:unit`) must pass.
- All E2E tests (`npm run test:e2e`) must pass.

### 3. Syntax & Grammar Verification
When modifying `syntaxes/guitardsl.tmLanguage.json` or `language-configuration.json`:
- JSON syntax must be valid (`python3 -m json.tool syntaxes/guitardsl.tmLanguage.json > /dev/null`).
- Scopes must match TextMate naming conventions (e.g. `keyword.control`, `string.quoted`, `comment.line`).

### 4. Packaging & Prepublish Sanity Check
Run:
```bash
npm run vscode:prepublish
```
- Verifies compilation completes without errors before packaging.
- Optionally run `npx @vscode/vsce ls` to ensure package files are resolved correctly.
- Packaged contents are controlled by `.vscodeignore`: the VSIX must contain only runtime files (`out/**/*.js` excluding `out/tests/`, `package.json`, `package.nls*.json`, `README.md`, `language-configuration.json`, `syntaxes/`, `media/`, production `node_modules/`). Development/agent paths (`.agent-state/`, `.vscode-test/`, `src/`, `tests/`, `docs/`, `scripts/`, `samples/`, `*.ts`, `*.map`) must not appear in `vsce ls`.

## Iteration vs. Final Gate
- During iteration: use focused checks (`npm run test:unit` for logic changes, `npx tsc --noEmit` or `npm run watch`).
- Final gate: run `npm run compile && npm test` and ensure clean build and passing tests.
