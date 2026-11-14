# Issue #172 Web Compact Workspace evidence

Captured on 2026-11-15 on macOS arm64 with the Playwright Chromium project. Chromium captured the screenshots and DOMRect measurements; Chromium and WebKit each passed 48/48.

Capture command:

```bash
GUITARDSL_CAPTURE_ISSUE172=1 npm run test:e2e --workspace web -- --project=chromium
```

## Main theme and locale matrix

Each image is 1600 × 900 CSS pixels.

| Locale | Light | Dark |
|---|---|---|
| English | [desktop-1600x900-en-light.png](desktop-1600x900-en-light.png) | [desktop-1600x900-en-dark.png](desktop-1600x900-en-dark.png) |
| Japanese | [desktop-1600x900-ja-light.png](desktop-1600x900-ja-light.png) | [desktop-1600x900-ja-dark.png](desktop-1600x900-ja-dark.png) |

## Layout and interaction states

- [1280 × 800 Japanese, dark theme](desktop-1280x800-ja-dark.png)
- Explorer roots: [On this device](menu-local-root-ja.png), [Google Drive](menu-drive-root-ja.png), [file actions](menu-explorer-ja.png)
- [Tab context menu](menu-tab-ja.png)
- [Problems panel and context menu](problems-ja.png), [context menu](menu-problems-ja.png)
- Preview: [without a source binding](menu-preview-ja.png), [with a valid source binding](menu-preview-binding-ja.png)
- [Settings menu](menu-settings-ja.png)
- [Source-only view](source-only-ja-dark.png)
- [Score-only view](score-only-ja-dark.png)
- [Measured DOM rectangles, entries, controls, columns, and view modes](layout-domrect.json)

## Geometry measurements

The measurements below are CSS pixels from the 1600 × 900 Japanese dark capture; exact values for all captures and interactive states are in `layout-domrect.json`.

- Header: 40 px high. Explorer starts at x=40, is 220 px wide, and contains both visible root rows: local at y=76 (220 × 32 px), Drive at y=215 (220 × 32 px). The local score entry is x=50, y=148, 200 × 32 px.
- The tab strip is y=40 and exactly 36 px high. Source/Split/Score controls stay at its right edge (x=1155, 1188, 1221; each 30 × 28 px). There is no additional Source/Score row.
- Source and Score begin at y=76. Their split widths are 394.41 px and 591.59 px; Inspector is 300 px wide. Problems is 200 px high, beginning at y=676. The status bar is 24 px high.
- Header actions are five 32 × 30 px buttons spaced 4 px apart at x=1414, 1450, 1486, 1522, and 1558. At 1280 × 800, the right-aligned actions end at x=1270.
- In the 1280 × 800 populated Problems capture, columns measure Severity x=60 / 74 px, File x=142 / 251.5 px, Location x=401.5 / 60 px, and Message x=469.5 / 754.5 px.

The layout and menus were visually compared with the four proposal drawings: [workspace](../../../specs/gui_design/proposals/issue-172/web-compact-workspace.svg), [layout geometry](../../../specs/gui_design/proposals/issue-172/web-compact-layout-geometry.svg), [context menus](../../../specs/gui_design/proposals/issue-172/web-compact-context-menus.svg), and [icons](../../../specs/gui_design/proposals/issue-172/web-compact-icons.svg). Numeric geometry in the approved spec remains the acceptance reference.

Browser automation verifies initial geometry, the four keyboard- and pointer-resizable splitters, saved layout restoration, narrow viewport collapse, CodeMirror editing, CRLF preservation, IME composition, tab-local Undo history, right-click and Shift+F10 menus, disabled/stale Preview bindings, and rejection when the current source target changes.

## Browser checks

- Playwright Chromium: 48/48 PASS on macOS arm64.
- Playwright WebKit: 48/48 PASS on macOS arm64, including native editor Undo/Redo and IME composition.
- Apple Safari/SafariDriver: 7/7 checks PASS on macOS 26.6.2 / Safari 26.6.2. The checks cover local draft restore, Preview/Inspector, PDF Blob and download invocation, audio exclusion, narrow layout and focus, source export after a storage failure, and mocked OAuth/Picker/Drive.
- Safari UI Undo/Redo, actual OS PDF saving, iOS/iPadOS Safari, production Google OAuth/Drive, and physical audio output are NOT RUN per the Safari acceptance contract.
