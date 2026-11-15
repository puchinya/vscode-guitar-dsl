# Issue #172 Web Compact Workspace evidence

Captured on 2026-11-15 on macOS arm64 with the Playwright Chromium project after addressing PR #173 review findings. Chromium captured the screenshots and DOMRect measurements. The current working tree passed Playwright Chromium 64/64, Playwright WebKit 64/64, Web unit 44/44, and SafariDriver smoke 7/7.

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
- Header interaction matrix: `header-hover-{en,ja}-{light,dark}.png` and `header-focus-{en,ja}-{light,dark}.png`.
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
- Header actions are five 32 × 30 px buttons spaced 4 px apart at x=1414, 1450, 1486, 1522, and 1558. At 1280 × 800, the right-aligned actions end at x=1270 and Settings has 12 px right padding. Computed styles confirm idle controls have transparent backgrounds and no border; hover and keyboard focus show the theme-specific surface. The Web-only dark logo filter is also recorded in `layout-domrect.json`.

The Web shell was visually compared with the approved [final shell](../../../specs/gui_design/proposals/issue-172/web-compact-final-shell-20261115.svg), [final menus](../../../specs/gui_design/proposals/issue-172/web-compact-final-menu-20261115.svg), and [first-connect state](../../../specs/gui_design/proposals/issue-172/web-drive-explorer-first-connect-20261115.svg). Earlier proposal diagrams are retained as history. Numeric geometry in the approved spec remains the acceptance reference. Shared Preview contents and its two-row toolbar are deferred by the latest review scope update; they are not part of this Web shell comparison.

Browser automation verifies initial geometry, the four keyboard- and pointer-resizable splitters, saved layout restoration, narrow viewport collapse, CodeMirror editing, same-task Save/PDF snapshot flush, IME composition and leave protection, tab-local Undo history, right-click and Shift+F10 menus, disabled/stale Preview bindings, rejection when the current source target changes, and retention of account-bound pending metadata when remote Drive tabs fail to restore.

## Browser checks

- Playwright Chromium: 64/64 PASS locally on macOS arm64.
- Playwright WebKit: 64/64 PASS locally on macOS arm64, including native editor Undo/Redo and IME composition.
- Web unit: 44/44 PASS.
- Apple Safari/SafariDriver: 7/7 checks PASS on macOS 26.6.2 / Safari 26.6.2. The checks cover local draft restore, Preview/Inspector, PDF Blob and download invocation, audio exclusion, narrow layout and focus, source export after a storage failure, and mocked OAuth/Picker/Drive using the Drive root keyboard menu.
- Repository `npm test`: Help/AI checks and root unit 1,138/1,138 PASS; VS Code/Electron E2E reported 130 passing, 6 pending, and 1 failure in Issue #158 PB05 while checking restoration of the pre-existing tab order (the same two identities appeared in reversed order). The focused PB05 diagnostic passed 1/1. Issue #162's previously flaky fade test passed in this full run (30.5 s). The Web stage was not reached; Web unit and Chromium/WebKit suites passed separately as listed above.
- `npm run compile`, `npm run build:web`, `npm run vscode:prepublish`, the VSIX inventory (1,256 entries), `check:help`, `check:ai`, `validate-docs --issue 172`, and `git diff --check` PASS. The inventory contains bilingual Help, AI reference, audio WASM, and the Drive logo; it excludes test and evidence paths. The `npx @vscode/vsce ls` wrapper could not resolve the configured npm mirror, so the cached VSCE 4.1.1 CLI was run directly. Vite reports advisory chunks above 500 kB. `vscode:prepublish` used Cargo fallback because no prebuilt wasm-bindgen binary is available for this platform. The focused remote-restore-failure regression passed in Chromium and WebKit; pending metadata remained in IndexedDB and the remote PATCH count did not increase.
- Safari UI Undo/Redo, actual OS PDF saving, iOS/iPadOS Safari, production Google OAuth/Drive and the Google Cloud consent-screen update, and physical audio output are NOT RUN. The live consent-screen change requires explicit user confirmation.
