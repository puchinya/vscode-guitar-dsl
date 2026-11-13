# Issue #166 Web SPA evidence

## English desktop workspace

![GuitarDSL Web SPA desktop workspace](web-spa-en-desktop.png)

Captured from the Chromium production E2E suite at 1600 × 1000 CSS pixels on macOS arm64. The image shows the local-first workspace, source editor, rendered score, playback controls, and all four compact Inspector tabs. The test also verifies the initial local file appears once and all Inspector tabs fit without horizontal scrolling.

Recreate with:

```bash
GUITARDSL_CAPTURE_ISSUE166=1 npm run test:e2e --workspace web
```

The suite runs the workspace E2E cases in Chromium and Firefox. Only Chromium writes this screenshot.
