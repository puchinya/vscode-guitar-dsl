# Issue #174 — Vue 3 + PWA evidence

Captured on 2026-11-15 on macOS arm64 with the local Vite app and Chromium. The screenshots show the implementation after workspace restoration completed.

- [Desktop workspace, 1600×900](workspace-desktop.png)
- [Narrow workspace, 390×844](workspace-narrow.png)
- [Connected Google Drive notices, 1600×900](drive-connection-notices.png)
- [Measured layout geometry](workspace-geometry.json)

The desktop render keeps the existing compact IDE structure: Explorer, source editor, score preview, Inspector, Problems, and status bar. At 390px, the document width remains 390px with both source and score panes present; no document-level horizontal overflow was measured.

Production PWA behavior is verified separately by `npm run test:e2e:pwa --workspace web`: the browser installs the generated service worker, confirms same-origin precached assets including both Japanese PDF fonts and the lazy application chunk, goes offline, edits and previews a local score, and exports a PDF with a `%PDF-` header and a positive page count. The test also makes IndexedDB draft writes fail, holds IME composition, holds a Drive media PATCH, and holds a Drive appData PATCH in turn. The update stays waiting when local draft durability fails or IME composition is active, blocks while a Drive save is in flight, and waits with the Update action in progress during appData synchronization. The final reload occurs only after the user has chosen Update and the persistence and Drive/appData operations are safe; the local draft is restored afterward.

Live Google OAuth/Drive, iOS/iPadOS Safari, Safari Dock-app storage sharing, and physical audio output were not exercised.
