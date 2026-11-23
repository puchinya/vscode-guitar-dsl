# Implementation Contract — GuitarDSL Product Introduction & CI/CD

- Repository: https://github.com/puchinya/vscode-guitar-dsl
- Issue: https://github.com/puchinya/vscode-guitar-dsl/issues/188
- Existing PR: https://github.com/puchinya/vscode-guitar-dsl/pull/190
- Contract revision: 2026-11-22
- Scope: Publish the approved product introduction as a separate static website at production/development hostnames, extend the **existing** Cloudflare CI/CD, capture real in-app score screenshots, and connect Help links.
- Editorial source of truth: `docs/design/prototypes/product-introduction.html` on PR #190 (introduced at commit `4eaf0376290e75b8a0f09e0c0f6cb5e8594ab0c1`). User has now approved v5 wording/design. **The committed file is a reference, not a deployed implementation.**

> This document is an Implementation Contract. Do not redesign the architecture during implementation. If a requirement conflicts with repository reality or requires a material design change, do not silently choose an alternative. Report the exact conflict and continue only with independent valid work.

## 1. Repository Baseline

- `wrangler.jsonc`: existing production Worker `guitardsl`, custom domain `guitardsl.app`, assets `./web/dist`, `not_found_handling=single-page-application`, custom-domain previews enabled. **Do not change its ownership or replace its Preview model.**
- `.github/workflows/cloudflare-workers.yml`: **sole deployment workflow**. `main` push runs `development` job (`wrangler preview --config wrangler.jsonc --name dev`, stable alias `dev.guitardsl.app`). A tag pointing to any commit reachable from `main` runs `production` (`wrangler deploy --config wrangler.jsonc`). Production performs ancestry validation before upload. PRs do not deploy. Development cancels superseded runs, production does not. Node 22, npm ci, `npm run build:web` and GitHub `development`/`production` environments are already configured.
- `docs/design/web-app.md`, “Cloudflare Workers Static Assets release and environment isolation”: app Worker ownership and release gates. `docs/specs/web-app.md`: static SPA, PWA, OAuth, offline and storage constraints. `docs/specs/guitardsl-syntax.md` §§6–9,12–13,19: real DSL grammar and music notation.
- `web/src/components/HeaderBar.vue`: canonical left brand icon is `/icons/guitardsl-sidebar.svg` sourced from `web/public/icons/guitardsl-sidebar.svg`, equal to `media/icons/guitardsl-sidebar.svg`. `web/src/components/WelcomePage.vue`, `web/src/components/WorkspaceShell.vue`: editor-embedded quick-action Welcome is separate from this marketing site.
- Issue #188 §2.1.0: final origin mapping and marketing-specific UX. User approved v5's neutral/light visual styling, `テキストから、ギターの楽譜を作成。`, and its three use cases. The known original music title is `空色の合図`. v5 design reference still includes temporary evidence/placeholder images, a non-operational CTA and draft notices: **do not ship those unchanged**.
- Cloudflare zone `guitardsl.app`: `Always Use HTTPS=on` set and re-read successfully on 2026-11-22; zone SSL encryption mode is `Full`. This is already an applied zone-wide setting, not a requested future toggle. Do not set it to off.

## 2. Architecture Decisions

**Origins (exact):**

| Environment | App SPA | Product introduction |
| --- | --- | --- |
| Production | `https://guitardsl.app/` | `https://www.guitardsl.app/` |
| Development | `https://dev.guitardsl.app/` | `https://wwwdev.guitardsl.app/` |

- The introductory site is a **standalone static HTML marketing site**, not App.vue overlay, popup, embedded Welcome tab, runtime state, or first-run redirect. Direct navigation to either app hostname opens the editor on first visit and later visits. **Do not implement `settings:web-intro-v1`**.
- Marketing production owns Worker **`guitardsl-marketing`** with custom domain `www.guitardsl.app`. Marketing development owns a **second independent Worker `guitardsl-marketing-dev`** with custom domain `wwwdev.guitardsl.app`. This avoids accidentally using the generated preview hostname `dev.www.guitardsl.app` and allows releases to differ. These are **marketing-only** Workers: retain the existing single app Worker and `dev` Preview.
- Serve static assets from `marketing/dist`. Marketing Workers must **not** use SPA fallback. Unknown paths yield real 404. Do not share app service worker, PWA caching, Google OAuth, IndexedDB or user session data. Site pages are readable without JS.
- Source is `marketing/src/index.html` (Japanese) and `marketing/src/en/index.html` (English copy based on approved Japanese). Each is a standalone responsive static document; no Vue router, external CDN, analytics, fonts, copied Azure content, or new backend. The **same** source is built twice with fixed environment-specific navigation constants. JS is not needed for Start links.
- Both hero and footer CTA are normal `a href` anchors: production target `https://guitardsl.app/`, development target `https://dev.guitardsl.app/`. Do not build URL from arbitrary `Host` or browser storage. Canonical and OG links use exact marketing host for that build. App Help → `GuitarDSLの紹介` opens the matching marketing URL in a separate tab with `noopener,noreferrer` without mutating editor state. Version/About remains separate. All other Help/Welcome/Tutorial behavior unaffected.
- Preserve existing legal canonical paths on app domain (`/privacy/`, `/terms/`, `/licenses/` and localized variants). Marketing footer links should use the working app routes until another approved migration. Do not assume www domain receives legal routing.
- User explicitly rejected the deep hostname `www.dev.guitardsl.app`, dark/black site palette, Tutorial marketing section, commercial promises and the word `個人開発` in public-facing copy.

**Rejected:** one combined marketing+SPA Worker with host rewriting, marketing in an app Preview, cross-origin first-run tracking, client JS-only CTA, unverified score screenshots, unvalidated demo DSL.

## 3. Exact Change Set

1. `docs/design/prototypes/product-introduction.html`: preserve as **approved historical design reference**, not production output; do not commit another competing source of truth there. Preserve the neutral/light palette, hero, three use-case order, SVG app icon, compact DSL snippets, non-horizontal-overflow CSS; remove the draft/test notices from the actual marketing source only.
2. `marketing/src/index.html`, `marketing/src/en/index.html`: port approved v5 text/layout. Sections: OSS + hero; A chord+strum+lyrics without melody; B melody+lyrics with guitar strumming; C **solo fingerstyle guitar** with alternating bass and upper-register melody in TAB; editing/preview/PDF; local save/optional Drive; GitHub/License/Privacy; two Start CTAs. Do **not** add Tutorial marketing. Add explicit same-page sections only: `楽譜の例`, `編集と保存`, GitHub. Retain light color scheme even when OS is dark; no viewport-wide horizontal scroll (only code panels scroll).
3. `marketing/examples/{A_chord_lyrics,B_melody_lyrics,C_guitar_tab}.guitardsl`: port the original v5 fixture ZIP, **then validate** with the actual repo compiler and fix only invalid/incorrect examples without copying real anime music. Same `空色の合図` original composition and harmonically consistent four bars (C/G, Am/Em, F/C, Dm/G7). TAB uses position-first `tab:` cells, `[5f3,2f1]/8` chord events, 8 total eighth-note beats per bar and duration inheritance; not ASCII TAB. `mel:` may inherit duration/octave after the first note in each row; `lyr:` syllables match attack count.
4. `marketing/public/images/{editor-split,melody-free,melody-lyrics,solo-guitar-tab}.webp`: screenshots captured with the real running GuitarDSL Web app displaying the validated original fixtures. Images must visibly show source and the corresponding rendered score where feasible; accessibility `alt`, fixed dimensions, clear compression, no accounts/tokens. Store unprocessed originals in `docs/status/evidence/issue-188/` with source revision, fixture, browser and viewport. Do not use generic illustration, generated tablature, prior PR's mismatched `My song`, or a placeholder in release output.
5. `scripts/build-marketing.mjs` and root `package.json` `build:marketing` script: deterministic Node-only build. Accept one exact `--target development|production`, reject any other value. Copy static marketing sources/assets to a clean `marketing/dist`, substitute **only** controlled `__APP_URL__` and `__SITE_URL__` placeholders from a 2-entry literal allowlist, output index and `/en/index.html`, canonical links, social metadata and actual screenshots. No runtime hostname detection, alternate relative roots, or post-build fetches.
6. `scripts/verify-marketing.mjs` + root `package.json` `check:marketing` script: fail before deploy if images/fixtures missing; if draft/placeholder notices, TODO, `raw.githubusercontent.com` temporary screenshots, unbound tokens or invalid CTA URLs appear; ensure all screenshot paths/alt and four pages' light responsive layout and localized labels. Execute parser-based fixture checks with zero unexpected errors/warnings and playwright browser assertions. A source path/encoding/fixture mismatch is a hard failure.
7. `wrangler-marketing.jsonc`: Worker name `guitardsl-marketing`; static assets directory `./marketing/dist`, custom domain `www.guitardsl.app`, no SPA fallback, stable compatibility date supported by pinned Wrangler.
8. `wrangler-marketing-dev.jsonc`: Worker name `guitardsl-marketing-dev`; same assets directory, custom domain `wwwdev.guitardsl.app`, no SPA fallback. **Do not** add a second Worker for the *app*.
9. `.github/workflows/cloudflare-workers.yml`: keep existing jobs and triggers. In the `development` job, after `npm ci` build and validate both Web and marketing dev outputs **before either publish**, then existing `wrangler preview --name dev` plus marketing `wrangler deploy --config wrangler-marketing-dev.jsonc`. In `production`, run main-ancestry guard, npm ci, build/verify both production outputs **before either publish**, then existing app deploy and marketing `wrangler deploy --config wrangler-marketing.jsonc`. Use the existing `cloudflare/wrangler-action@v4` and `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `GITHUB_TOKEN`, version `4.160.0` or compatible. Preserve GitHub environments, run cancellation semantics and scoped secrets. When one upload fails after another succeeds, fail workflow and report partial deployment; do not claim atomicity.
10. `web/src` Help menu action/locale mapping, tests and status: map production app Help link to `www`, dev app Help link to `wwwdev`, keep Welcome tab and version dialog. Update `docs/specs/web-app.md`, `docs/design/web-app.md`, `docs/status/implementation-status.md`; cite Issue #188 §2.1.0, approved design reference and exact workflows.

## 4. Implementation Sequence

1. Inspect current PR HEAD, existing help-menu action, deployment workflow and spec/design/status. Do not overwrite concurrent changes.
2. Copy approved v5 content into separate marketing source. Do not use prototype's no-op button/script, mismatched images, or draft markers in production output.
3. Validate the 3 original example fixtures with the repo compiler, correct only observed failures, and commit fixtures with tests.
4. Render actual screenshots from the Web app and save both optimized assets and evidence; verify matching file names, harmonic progression, syllables and TAB fingering. **No publication before this passes.**
5. Implement deterministic marketing build and validation scripts. Verify both development and production variants locally including no-JS behavior.
6. Add two separate marketing Worker config files, leaving `wrangler.jsonc` untouched; extend existing single deployment workflow with the marketing deploy steps and predeploy checks.
7. Connect Help URLs to the correct origin, update i18n and tests without touching document/session ownership.
8. Test responsive, accessibility, DNS/SSL/HTTPS/404, locale and deployment gates. Update docs and reviewer checklist.
9. Commit, push existing PR branch, refresh PR body to state `Closes #188` if workflow permits; bring Issue/PR to review state and provide exact PR URL. Do **not** force merge or deploy preemptively as a substitute for tests.

## 5. Required Runtime Semantics

- Both direct app visits immediately render editor. No first-run page, no persistent introduction flag and no storage migrations.
- Clicking either marketing CTA leaves marketing origin and opens the **matching** app origin; browser Back returns to marketing. No automatic OAuth. The site is readable and navigable with JavaScript disabled.
- Help from the app opens a **separate** marketing tab safely. The original editor stays mounted, with unchanged source, drafts, Undo/Redo, layout, Inspector, Tutorial and playback state; failure to open a new tab must not close or modify the editor.
- Marketing sites must be independent static assets: unknown path 404 and no app shell; app routes keep existing SPA and legal behavior. Browser refresh works on both site roots.
- Local device save and optional Drive statements must match actual app behavior. The marketing site does not request OAuth credentials or access user storage.
- All browsers at all four public hosts must receive valid HTTPS once deployed. For HTTP requests, the Cloudflare zone-wide `Always Use HTTPS` setting should provide a 301/308 HTTPS redirect; verify actual redirect and target on all four hostnames, not just dashboard state. Check for loops/mixed content; do not enable HSTS without user approval.
- Build/publish failure leaves existing marketing deployment intact where possible; do not overwrite production marketing with incomplete artifacts. App and marketing deployment steps are not transactionally atomic; report partial deployments explicitly.
- No background first-run listener or hidden state. Repeated clicks on a CTA have standard browser link semantics. Repeated CI builds must be deterministic for the same source and target.

## 6. Non-goals / Forbidden Changes

- No changes to GuitarDSL parser grammar, note inheritance rules, TAB semantics, editor host ownership or plugin boundary merely to satisfy screenshots.
- No backend, runtime Vue site routing, multi-host single Worker trick, Preview alias mutation, new root app Worker, analytics or user-tracking cookie.
- Do not redesign the existing Welcome/Tutorial/Google Drive workflows, license contents or legal canonical URLs.
- Do not present unrelated PR evidence or prototype CSS notation as a real rendered score.
- No forced dark theme, `個人開発` claim, real anime titles/lyrics/melodies/TAB or copyrighted references.
- No Cloudflare zone DNS record deletion without verified conflict assessment and explicit action scope. Preserve email MX/TXT and wildcards.

## 7. Concrete Tests

1. **Build targets:** build dev then production; assert both output exact same content and assets except the two bound host URLs; assert both CTA anchors lead to expected exact app URL and canonical points to own marketing hostname. Unknown target fails without output.
2. **No-JS and security:** load each marketing page with JS disabled; verify main heading, 3 use-case sections, both Start links, footer legal/GitHub links, alt text and 404 for unknown path; no client OAuth or SW registration.
3. **Fixture A:** parse/display four-bar melody-free score, chords, strum and lyrics; check rhythm sum per bar and zero unexpected compiler diagnostics.
4. **Fixture B:** melody line starts with explicit duration/octave, remaining inherited tokens parse correctly, lyrics counts match non-rest attacks, accompaniment chord rhythm remains correct; screenshot visibly shows staff/lyrics.
5. **Fixture C:** TAB `[bass,treble]` simultaneous beats plus alternating bass and melody within each bar; exactly four-quarter-equivalent duration per bar; string/fret position and TAB rendering match source; zero invalid/string/duration diagnostics.
6. **Responsive:** Chromium/WebKit screenshot at 1440/1600×900 and 390×844; light background even when OS prefers dark; navigation readable; page scrollWidth ≤ viewport clientWidth; only DSL panel may scroll sideways.
7. **App Help:** production and dev app route to matching marketing host in new tab with no state mutation, keyboard and screen-reader accessible. Welcome and Tutorial commands unchanged.
8. **CI:** simulated `main` push chooses only development marketing Worker, tag-on-main chooses only production marketing Worker; off-main tagged commit rejects before any upload; PR only builds/checks without publishing; missing screenshot/placeholder causes failure **before** deploying either app or marketing.
9. **Cloudflare:** verify `Always Use HTTPS` is `on` and SSL `Full` (already observed). Once deployed, test HTTP→HTTPS and valid certificate at each of four hosts, check 200 for legitimate home, 404 for marketing missing routes, and no loops. Record separately if rollout cannot be performed due permissions.

## 8. Verification

Required commands (run from repository root):

```bash
npm ci
npm run build:web
npm run build:marketing -- --target development
npm run check:marketing -- --target development
npm run build:marketing -- --target production
npm run check:marketing -- --target production
npm run check:help
npm run check:legal
npm run test:web
npm test
```

Check GitHub Actions deployment jobs against `.github/workflows/cloudflare-workers.yml` and deployed custom domains. Run Playwright Chromium and WebKit on the actual generated marketing outputs. Do not claim browsers, OAuth accounts, native macOS Safari, live DNS or CDN hosts as verified unless exercised. The contract author has **not run** these commands against the code because the marketing source/build/CI implementation is not yet present.

## 9. Reviewer Checklist (publish before implementation)

- [ ] Existing `guitardsl` Worker and `dev` Preview unchanged, correct original triggers/gates preserved.
- [ ] Dedicated marketing production/dev Workers, no SPA fallback, exact DNS custom domains.
- [ ] `main` updates only development marketing; release tags on main ancestry update production marketing; PRs never deploy.
- [ ] Build/fixture/screenshot validation runs before either publish; production failure surfaces partial deployment.
- [ ] Approved v5 hero and three use cases, bright palette, official app icon, compact DSL and no Tutorial marketing.
- [ ] No `個人開発`, real anime work, fake output, outdated draft notice or mismatched screenshot.
- [ ] Three DSL fixtures compiler-valid with meaningful score rendering and matching source captions.
- [ ] Both CTAs and app Help URL mapping strictly bind same environment, no cross-origin storage.
- [ ] HTML works without JS, is accessible/responsive and cannot overflow viewport horizontally.
- [ ] Cloudflare Always Use HTTPS on, no HTTP redirect loops, valid certificates on all four hostnames.
- [ ] Existing legal/OAuth/PWA paths and version/About behavior unaffected.
- [ ] Specs/design/status/README, test evidence, PR review and GitHub workflow state updated.
- [ ] Codex/Claude Code self-review completed on each item, with failures/blockers reported precisely.

## 10. Completion Report

Include: changed file list; exact CLI commands and outcomes; per-host deployment state and HTTPS verification; real screenshots with browser/resolution/source revision; verified fixture diagnostics; reviewer checklist pass/fail; baseline and newly discovered conflicts classified A/B/C/D; unverified platforms and environment secrets; any deviations; open issues/remaining work; GitHub commit SHA; and **PR URL**.

**Completion gate:** Do not report complete merely for committed HTML or successful builds. A completed implementation requires committed/pushed changes, an open or updated PR with `Closes #188`, review workflow transition, passing tests, and verifiable marketing site deployment at both target hostnames as permitted by the release process. If permission, Cloudflare route ownership, missing screenshots or unpublished original music blocks this, report **BLOCKED**, the exact command/API failure and the existing PR URL. Do not silently relax a mandatory check or claim the site is live.