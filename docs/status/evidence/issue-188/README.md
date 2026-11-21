# Issue #188 visual evidence

Captured from the Web SPA with Playwright Chromium on the local development build. The Help menu matrix was captured at the exact viewport sizes required by the implementation contract. The same matrix test passes in Chromium and WebKit.

| Locale | Theme | 1600×900 | 1280×800 |
|---|---|---|---|
| English | Light | [Screenshot](help-menu-en-light-1600x900.png) | [Screenshot](help-menu-en-light-1280x800.png) |
| English | Dark | [Screenshot](help-menu-en-dark-1600x900.png) | [Screenshot](help-menu-en-dark-1280x800.png) |
| Japanese | Light | [Screenshot](help-menu-ja-light-1600x900.png) | [Screenshot](help-menu-ja-light-1280x800.png) |
| Japanese | Dark | [Screenshot](help-menu-ja-dark-1600x900.png) | [Screenshot](help-menu-ja-dark-1280x800.png) |

The first-run Welcome and the right-dock Tutorial captures are 1600×950 Chromium screenshots. Japanese mobile Welcome and Tutorial captures use a 390×844 CSS-pixel WebKit viewport (780×1688 device pixels); Tutorial is shown in the narrow overlay drawer, which closes on Escape and restores focus to its tool-window button. Safari smoke is recorded separately in the verification status; it does not represent physical audio output or production Google access.

- [Welcome](welcome-en-chromium.png)
- [Tutorial, step 1 of 10](tutorial-en-chromium.png)
- [Welcome, Japanese mobile](welcome-ja-mobile.png)
- [Tutorial, Japanese mobile](tutorial-ja-mobile.png)
