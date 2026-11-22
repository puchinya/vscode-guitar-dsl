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

### Welcome layout after PR review — 2026-11-23

The one-column Welcome was recaptured from the local app based on PR #190 HEAD `a3ab2e1e35a82fb23f983c7fa894ab66e1a237bb`, with the current uncommitted review fixes. The English desktop capture uses Chromium at 1600×950 CSS pixels; the Japanese mobile capture uses WebKit at 390×844 CSS pixels (780×1688 device pixels). Both were visually inspected. The mobile document width is 390px for a 390px viewport. These captures show the flat layout, three unboxed icon-and-text actions, storage note, and suppression checkbox; the marketing score image and TAB renderer were not changed.

- [Updated Welcome, English desktop / Chromium](welcome-en-chromium.png)
- [Updated Welcome, Japanese mobile / WebKit](welcome-ja-mobile.png)

## Product introduction score captures

The four original PNG captures below were taken from the real GuitarDSL Web app served by local Vite at `127.0.0.1:4179`, using Playwright 1.65.0 Chromium at 1600×900 CSS pixels, device scale factor 1, English UI, and the light color scheme. Each clean browser context loaded its named fixture into the editor; the compiler reported zero errors and warnings, and the capture run made no external requests. The rendering source revision was `25cd861264888582d1fc575118e413b004dede71`; the worktree changes used for this capture only affect the Help link and product-introduction pages, not the score compiler or renderer.

| Marketing asset | Fixture | App view | Original PNG |
|---|---|---|---|
| `editor-split.webp` | `A_chord_lyrics.guitardsl` | Source and rendered score | [PNG](marketing-editor-split-1600x900.png) |
| `melody-free.webp` | `A_chord_lyrics.guitardsl` | Rendered score | [PNG](marketing-melody-free-1600x900.png) |
| `melody-lyrics.webp` | `B_melody_lyrics.guitardsl` | Source and rendered score | [PNG](marketing-melody-lyrics-1600x900.png) |
| `solo-guitar-tab.webp` | `C_guitar_tab.guitardsl` | Source and rendered score | [PNG](marketing-solo-guitar-tab-1600x900.png) |

The WebP assets in `marketing/public/images/` were encoded from these PNGs with `cwebp 1.6.0 -q 82 -m 6`. A visual review found a rhythm-mark/fret-number alignment discrepancy in the TAB rendering. Per the user's direction, the renderer and these genuine captures were not altered in this issue; treat that visual alignment as separate follow-up work, not as verified acceptance.

## Product introduction page screenshots

`npm run check:marketing -- --target development|production` captures the generated Japanese and English pages in Chromium and WebKit with JavaScript disabled, a dark OS preference, and both required viewports. The committed snapshots are in [marketing-site/](marketing-site/): 1600×900 and 390×844 CSS pixels for each browser and locale. The screenshots are evidence of layout only; the automated checks separately assert links, image loading and dimensions, no horizontal page overflow, and HTTP 404 for an unknown route.

### Japanese copy and section-label review — 2026-11-23

The development build completed with `npm run build:marketing -- --target development` (exit 0) and served locally at `http://127.0.0.1:5173/` (HTTP 200). Playwright 1.65.0 Chromium on macOS captured the 1600×900 CSS-pixel views below at device scale factor 1. The hero description, example heading, and caption use the general term “TAB譜”; browser computed style reports `.section-label` at 13px. The page was visually inspected in the browser. The automated `check:marketing` suite was not run for this copy review.

- [Usage introduction and hero copy](marketing-site/marketing-site-review-ja-usage-1600x900-2026-11-23.png)
- [TAB example heading and caption](marketing-site/marketing-site-review-ja-tab-1600x900-2026-11-23.png)

### Release readback gate — 2026-11-23

Both `npm run build:marketing -- --target development|production` and the corresponding `npm run check:marketing` passed with Chromium and WebKit. Release-readback unit tests cover zone settings, each environment's redirect/link targets, TLS failure handling, marketing 404, and app/site HTTP 200 expectations. No live release readback was run: this work did not deploy any of the four hosts.
