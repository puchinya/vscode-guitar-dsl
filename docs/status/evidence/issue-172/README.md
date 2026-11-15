# Issue #172 Web Compact Workspace evidence

Captured on 2026-11-15 on macOS arm64 with the Playwright Chromium project. Chromium captured the screenshots and DOMRect measurements. At current revision `40689f0`, Playwright Chromium and Safari CI passed, local Playwright WebKit passed 59/59, and Web unit tests passed 43/43. The first WebKit CI attempt had one computed-style assertion failure; the same focused test and local full WebKit suite passed, and the failed CI job was rerun.

Capture command:

```bash
GUITARDSL_CAPTURE_ISSUE172=1 npm run test:e2e --workspace web -- --project=chromium --grep='opens a local-first GuitarDSL workspace|resolves system theme and keeps Problems and document tabs readable'
```

## Main theme and locale matrix

Each image is 1600 × 900 CSS pixels.

| Locale | Light | Dark |
|---|---|---|
| English | [desktop-1600x900-en-light.png](desktop-1600x900-en-light.png) | [desktop-1600x900-en-dark.png](desktop-1600x900-en-dark.png) |
| Japanese | [desktop-1600x900-ja-light.png](desktop-1600x900-ja-light.png) | [desktop-1600x900-ja-dark.png](desktop-1600x900-ja-dark.png) |

## Layout and interaction states

- [1280 × 800 Japanese, dark theme](desktop-1280x800-ja-dark.png)
- [Reference-equivalent populated state: two local scores, connected Drive folder and file, selected local document, live diagnostic, Variables tab, 1600 × 900 Japanese dark](reference-state-1600x900-ja-dark.png)
- [First Google Drive connection with folder setup choices](drive-first-connect-ja.png)
- [File menu](menu-file-ja.png), [Edit menu](menu-edit-ja.png), [View menu](menu-view-ja.png)
- Explorer roots: [On this device](menu-local-root-ja.png), [Google Drive](menu-drive-root-ja.png), [file actions](menu-explorer-ja.png)
- Panel options: [Explorer](menu-explorer-options-ja.png), [Inspector](menu-inspector-options-ja.png)
- [Tab context menu](menu-tab-ja.png)
- [Problems panel and context menu](problems-ja.png), [context menu](menu-problems-ja.png)
- Preview: [without a source binding](menu-preview-ja.png), [with a valid source binding](menu-preview-binding-ja.png)
- [Settings menu](menu-settings-ja.png)
- [Source-only view](source-only-ja-dark.png)
- [Score-only view](score-only-ja-dark.png)
- [Measured DOM rectangles, entries, controls, columns, and view modes](layout-domrect.json)

## System theme regression

- [1600 × 900 Japanese system theme with the browser set to dark](system-theme-dark-1600x900-ja.png)
- Chromium and WebKit E2E verify that System follows browser color-scheme changes, explicit Light stays light under a dark preference, explicit Dark stays dark under a light preference, and the Problems panel and active document tab remain readable. The first-Drive setup dialog also tracks System changes while it is open and styles its controls for the resolved theme.
- Explorer keyboard coverage opens both option menus with Shift+F10 and the Context Menu key, then checks item navigation, activation, Escape focus return, close/reopen actions, and width reset. English and Japanese Drive states check that the root row stays 32px while disconnected, connecting, connected, and expired; the inline action is text-only and single-line.

## Geometry measurements

The measurements below are CSS pixels from the 1600 × 900 Japanese dark capture; exact values for all captures and interactive states are in `layout-domrect.json`.

- Header: 40 px high. Explorer starts at x=40, is 220 px wide, and its `PROJECT` heading is 36 px high. Both visible roots are 220 × 32 px: local at y=76 and Drive at y=181. Local file rows are x=60, 200 × 32 px with a 16 px `ic-file`; Drive shows its 30 px folder row then 32 px file rows. The active Local document is selected by document identity; the connected Drive file is not.
- The right Tool Window Bar starts at x=1564 and is 36 px wide. Inspector is the upper toggle at x=1568.5, y=48 (28 × 34 px); Problems is below it at x=1568.5, y=82 (28 × 34 px).
- Explorer and Inspector options are ellipsis menus; Problems closes with a far-right ×. Inspector opens on Variables. The Problems header is 32 px high and retains visible error/warning counts at zero.
- Problems headings and rows share the same four grid tracks: Severity x=50 / 74 px, File x=132 / 333.5 px, Line:Col x=473.5 / 72 px, Message x=553.5 / 1000.5 px. The reference state includes one compiler diagnostic with its real severity icon and source position.
- The tab strip is y=40 and exactly 36 px high. Source/Split/Score controls stay at its right edge (x=1155, 1188, 1221; each 30 × 28 px).
- Source and Score begin at y=76. Their split widths are 394.41 px and 591.59 px; Inspector is 300 px wide. Problems is 200 px high, beginning at y=676. The status bar is 24 px high.
- Header actions are five 32 × 30 px buttons spaced 4 px apart at x=1414, 1450, 1486, 1522, and 1558. At 1280 × 800, the right-aligned actions end at x=1270.

The Web shell was visually compared with [workspace](../../../specs/gui_design/proposals/issue-172/web-compact-workspace.svg), [layout geometry](../../../specs/gui_design/proposals/issue-172/web-compact-layout-geometry.svg), [context menus](../../../specs/gui_design/proposals/issue-172/web-compact-context-menus.svg), [icons](../../../specs/gui_design/proposals/issue-172/web-compact-icons.svg), and the [panel-chrome correction](../../../specs/gui_design/proposals/issue-172/web-compact-panel-chrome-correction.svg). Numeric geometry in the approved spec remains the acceptance reference. Shared Preview contents and its two-row toolbar are deferred by the latest review scope update; they are not part of this Web shell comparison.

Browser automation verifies initial geometry, the four keyboard- and pointer-resizable splitters, saved layout restoration, narrow viewport collapse, CodeMirror editing, same-task Save/PDF snapshot flush, IME composition and leave protection, tab-local Undo history, right-click and Shift+F10 menus, disabled/stale Preview bindings, and rejection when the current source target changes.

## Browser checks

- Playwright Chromium: 59/59 PASS on the current PR revision (GitHub Actions).
- Playwright WebKit: 59/59 PASS locally on macOS arm64, including native editor Undo/Redo and IME composition. The focused Problems grid test also passed 1/1 after its first CI attempt failed to read the header's computed grid tracks; the failed CI job was rerun.
- Web unit: 43/43 PASS.
- Apple Safari/SafariDriver: 7/7 checks PASS on macOS 26.6.2 / Safari 26.6.2. The checks cover local draft restore, Preview/Inspector, PDF Blob and download invocation, audio exclusion, narrow layout and focus, source export after a storage failure, and mocked OAuth/Picker/Drive using the Drive root keyboard menu.
- Repository `npm test` at `40689f0`: root unit 1,138 PASS; VS Code/Electron E2E 130 PASS / 6 pending / 1 FAIL. The failure is the timing-sensitive Issue #162 fade cleanup assertion (`layers:1` at 841 ms before its 900 ms fallback); a filtered diagnostic of that test and the unrelated PB05 cleanup case passed 2/2. The command stopped before its Web stage; Web unit 43/43 and browser suites were run separately, and Chromium/WebKit each passed 59/59.
- `npm run compile`, `npm run build:web`, `npm run vscode:prepublish`, `npx @vscode/vsce ls` (1,256 entries), `check:help`, `check:ai`, `validate-docs --issue 172`, implementation-contract verification, and `git diff --check` PASS. The VSIX file list contains bilingual Help, AI reference, and the Drive logo; it excludes test and evidence paths. Vite reports advisory chunks above 500 kB. `vscode:prepublish` used Cargo fallback because no prebuilt wasm-bindgen binary is available for this platform.
- Safari UI Undo/Redo, actual OS PDF saving, iOS/iPadOS Safari, production Google OAuth/Drive and the Google Cloud consent-screen update, and physical audio output are NOT RUN. The live consent-screen change requires explicit user confirmation.
