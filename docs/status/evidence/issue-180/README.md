# Issue #180 — Google Drive library evidence

Captured on 2026-11-21. The original design preview is retained alongside rendered runtime screenshots from the Chromium E2E flow. Runtime screenshots use mocked Google OAuth and Drive APIs; they do not show a live account or production Drive session. Runtime screenshots now show the shortened Explorer root labels `Library` / `ライブラリ`, while the physical folder in Drive remains named `GuitarDSL`. The local and Drive root labels share aligned folder icons and title insets at the standard Explorer width.

- [Rendered aligned roots and connection status in English at 236 px Explorer width](library-connection-row-runtime.png)
- [Rendered aligned roots with connected Japanese dark status at 220 px Explorer width](library-connection-row-connected-ja-dark-220-runtime.png)
- [Design preview — library setup and Drive root menu](library-setup.png)
- [Rendered setup dialog — mocked Drive](library-setup-runtime.png)
- [Rendered library root menu — mocked Drive](library-root-menu-runtime.png)
- Design source: [`docs/specs/gui_design/proposals/issue-180/`](../../../specs/gui_design/proposals/issue-180/)

![This device and Library roots aligned with the Google Drive Reconnect row at the verified compact Explorer width](library-connection-row-runtime.png)

![このデバイス and ライブラリ roots aligned with the connected Google Drive status in Japanese dark theme at 220 px](library-connection-row-connected-ja-dark-220-runtime.png)

Automated Chromium, WebKit, PWA, and Safari checks use mocked Google OAuth and Drive APIs. Live Google OAuth/Drive behavior was not exercised.
