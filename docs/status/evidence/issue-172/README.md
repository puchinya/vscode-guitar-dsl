# Issue #172 Web Compact Workspace evidence

Captured on 2026-11-14 on macOS with the Playwright Chromium project. The complete Chromium E2E suite passed (42/42) while these images were captured.

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
- [Settings menu](menu-settings-ja.png)
- [Explorer context menu](menu-explorer-ja.png)
- [Problems panel and context menu](problems-ja.png), [context menu](menu-problems-ja.png)
- [Preview context menu](menu-preview-ja.png)
- [Source-only view](source-only-ja-dark.png)
- [Score-only view](score-only-ja-dark.png)
- [Measured DOM rectangles, splitters and view modes](layout-domrect.json)

The DOM measurements cover the four main locale/theme captures, the 1280 × 800 variant, context-menu states, and both single-pane modes. Browser automation verifies the initial geometry, all four keyboard- and pointer-resizable splitters, saved layout restoration, narrow viewport collapse, CodeMirror editing, CRLF preservation, and IME composition behavior.

## Browser checks

- Playwright Chromium: 42/42 PASS on macOS arm64.
- Playwright WebKit: 42/42 PASS on macOS arm64, including native editor Undo/Redo and IME composition.
- Apple Safari/SafariDriver: 7/7 checks PASS on macOS 26.6.2 / Safari 26.6.2. The checks cover local draft restore, Preview/Inspector, PDF Blob and download invocation, audio exclusion, narrow layout and focus, source export after a storage failure, and mocked OAuth/Picker/Drive.
- Safari UI Undo/Redo, actual OS PDF saving, iOS/iPadOS Safari, production Google OAuth/Drive, and physical audio output are NOT RUN per the Safari acceptance contract.
