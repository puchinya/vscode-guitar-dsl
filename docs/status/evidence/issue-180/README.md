# Issue #180 — Google Drive library evidence

Captured on 2026-11-20. The original design preview is retained alongside rendered runtime screenshots from the Chromium E2E flow. Runtime screenshots use mocked Google OAuth and Drive APIs; they do not show a live account or production Drive session.

- [Design preview — library setup and Drive root menu](library-setup.png)
- [Rendered setup dialog — mocked Drive](library-setup-runtime.png)
- [Rendered library root menu — mocked Drive](library-root-menu-runtime.png)
- Design source: [`docs/specs/gui_design/proposals/issue-180/`](../../../specs/gui_design/proposals/issue-180/)

Automated Chromium, WebKit, PWA, and Safari checks use mocked Google OAuth and Drive APIs. Live Google OAuth/Drive behavior was not exercised.
