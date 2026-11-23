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

### Welcome link list restored after PR review — 2026-11-23

The English desktop and Japanese mobile Welcome captures were refreshed from the local app after restoring the five-item right-side Links list required by Issue #188 §2.1.1.2. The English capture uses Chromium at 1600×950 CSS pixels. The two Japanese mobile captures use WebKit at 390×844 CSS pixels (780×1688 device pixels): the first shows the page top, and the scrolled view shows the Links list and suppression checkbox. The desktop view shows both unboxed columns; mobile stacks Links after Start and Storage. Both layouts stay within the viewport. The TAB renderer and score image were refreshed separately below after the review follow-up.

- [Updated Welcome, English desktop / Chromium](welcome-en-chromium.png)
- [Updated Welcome, Japanese mobile / WebKit](welcome-ja-mobile.png)
- [Updated Welcome, Japanese mobile Links / WebKit](welcome-ja-mobile-links.png)

## Product introduction score captures

The four PNG captures below are from the real GuitarDSL Web app served by local Vite at `127.0.0.1:4179`, using Playwright 1.65.0 Chromium at 1600×900 CSS pixels, device scale factor 1, English UI, and the light color scheme. Each clean browser context loaded its named fixture into the editor; the compiler reported zero errors and warnings, and the capture run made no external requests. The A/B captures retain their original renderer provenance (`25cd861264888582d1fc575118e413b004dede71`). The C capture was regenerated on 2026-11-23 from the working tree after correcting beat-anchor placement in `packages/core/src/render/tabStaff.ts`.

| Marketing asset | Fixture | App view | Original PNG |
|---|---|---|---|
| `editor-split.webp` | `A_chord_lyrics.guitardsl` | Source and rendered score | [PNG](marketing-editor-split-1600x900.png) |
| `melody-free.webp` | `A_chord_lyrics.guitardsl` | Rendered score | [PNG](marketing-melody-free-1600x900.png) |
| `melody-lyrics.webp` | `B_melody_lyrics.guitardsl` | Source and rendered score | [PNG](marketing-melody-lyrics-1600x900.png) |
| `solo-guitar-tab.webp` | `C_guitar_tab.guitardsl` | Source and rendered score | [PNG](marketing-solo-guitar-tab-1600x900.png) |

The WebP assets in `marketing/public/images/` were encoded from these PNGs with `cwebp 1.6.0 -q 82 -m 6`.

### TAB visual acceptance gate — 2026-11-23

The rhythm stem, flag, and beam anchors now share each beat's fret-number center. Collision spreading moves the fret marks and all rhythm anchors together; wider fret numbers affect beat spacing without shifting their own anchors. Unit coverage includes simultaneous and multi-digit frets, flags, and beams.

The new real-app capture and published WebP are bound to the exact C fixture revision in [`tab-visual-acceptance.json`](tab-visual-acceptance.json). `npm run check:marketing -- --target development|production` verifies all three SHA-256 values, verifies the copied WebP bytes in `marketing/dist`, and renders fixture C to assert stem, flag, and beam coordinates against the fret centers. A stale fixture or image fails the same check used before both deployments. The manifest records Codex's visual review and capture provenance; it does not claim a separate product-owner approval.

Capture recipe: start `npm run dev --workspace web -- --port 4179 --strictPort`, then run `node --import tsx scripts/capture-issue-188-tab.mjs`. The script loads the fixture in a clean Chromium context, selects Source + Score split, hides Explorer/Inspector/Problems, and captures the actual app. WebP command: `cwebp -q 82 -m 6 docs/status/evidence/issue-188/marketing-solo-guitar-tab-1600x900.png -o marketing/public/images/solo-guitar-tab.webp`.

- [Corrected TAB: real app capture, 1600×900](marketing-solo-guitar-tab-1600x900.png)
- [Revision-bound visual acceptance manifest](tab-visual-acceptance.json)

## Product introduction page screenshots

`npm run check:marketing -- --target development|production` captures the generated Japanese and English pages in Chromium and WebKit with JavaScript disabled, a dark OS preference, and both required viewports. The committed snapshots are in [the marketing-site screenshots](marketing-site/marketing-site-chromium-ja-1600x900.png): 1600×900 and 390×844 CSS pixels for each browser and locale. The screenshots are evidence of layout only; the automated checks separately assert links, image loading and dimensions, no horizontal page overflow, and HTTP 404 for an unknown route.

### Japanese copy and section-label review — 2026-11-23

The development build completed with `npm run build:marketing -- --target development` (exit 0) and served locally at `http://127.0.0.1:5173/` (HTTP 200). Playwright 1.65.0 Chromium on macOS captured the 1600×900 CSS-pixel views below at device scale factor 1. The hero description, example heading, and caption use the general term “TAB譜”; browser computed style reports `.section-label` at 13px. The page was visually inspected in the browser. The automated `check:marketing` suite was not run for this copy review.

- [Usage introduction and hero copy](marketing-site/marketing-site-review-ja-usage-1600x900-2026-11-23.png)
- [TAB example heading and caption](marketing-site/marketing-site-review-ja-tab-1600x900-2026-11-23.png)

### Release readback gate — 2026-11-23

Both `npm run build:marketing -- --target development|production` and the corresponding `npm run check:marketing` passed with Chromium and WebKit. Release-readback unit tests cover zone settings, each environment's redirect/link targets, TLS failure handling, marketing 404, and app/site HTTP 200 expectations. No live release readback was run: this work did not deploy any of the four hosts.
