# Issue #172 / PR #173 — Web-only Compact Panel Chrome Correction

**Review disposition: CHANGES REQUIRED.** Reviewed PR HEAD `01afa4ee9704878fe90eec9428a27b1bde9d5fd5` (2026-11-15). This is a scope clarification and pixel-level Web shell review, not a redesign of shared score UI.

> This document is an Implementation Contract. Do not redesign the architecture during implementation. If a requirement conflicts with repository reality or requires a material design change, do not silently choose an alternative. Report the exact conflict and continue only with independent valid work.

## 1. Repository Baseline / Scope correction

- Approved visual authority: [full 1600×900 screen](https://github.com/puchinya/vscode-guitar-dsl/blob/feature/172-compact-ui-svg/docs/specs/gui_design/proposals/issue-172/web-compact-workspace.svg), [geometry](https://github.com/puchinya/vscode-guitar-dsl/blob/feature/172-compact-ui-svg/docs/specs/gui_design/proposals/issue-172/web-compact-layout-geometry.svg), [icon paths](https://github.com/puchinya/vscode-guitar-dsl/blob/feature/172-compact-ui-svg/docs/specs/gui_design/proposals/issue-172/web-compact-icons.svg), [context menus](https://github.com/puchinya/vscode-guitar-dsl/blob/feature/172-compact-ui-svg/docs/specs/gui_design/proposals/issue-172/web-compact-context-menus.svg). **[New close-up SVG: Web panel chrome](https://github.com/puchinya/vscode-guitar-dsl/blob/feature/172-compact-ui-svg/docs/specs/gui_design/proposals/issue-172/web-compact-panel-chrome-correction.svg)**. The source SVGs in PR are unchanged except terminal newline; do not redraw them to resemble current screenshots.
- Actual screenshot: `docs/status/evidence/issue-172/desktop-1600x900-ja-dark.png` at HEAD 01afa4e. `layout-domrect.json` confirms top-level dimensions: header 40, Activity 40, Explorer 220, source/score divider 6, Inspector 300, right rail 36, Problems 200, status 24; **keep those**.
- **User-overridden scope**: all changes to score/notation preview rendered by shared VS Code code are **deferred**, not acceptance failures for this PR. Do not change `packages/ui/src/previewHtml.ts` (its 48px transport + 44px settings row), `packages/ui/src/inspectorTabs.ts`, `packages/core/`, `packages/document/`, `packages/pdf/` or VS Code extension rendering. Do not hide the shared toolbar, inject destructive iframe CSS, duplicate Preview controls in the host, or change Preview Normal/Edit/Practice. The schematic score content and its compact one-row toolbar are **illustrative only**; prior complaints that required compressing the shared two-row Preview UI are **withdrawn**.
- Allowed: `web/src/{main.ts,style.css,icons.ts,explorer/explorerController.ts}`, Web-only E2E/unit tests, and issue evidence/status docs. Preserve CodeMirror, four Splitters, WebMCP/Drive boundaries, saved drafts, status, and existing context menus.

## 2. Architecture Decisions — exact Web UI semantics

- Distinguish three icon concepts. **`ic-down`/`ic-right`: expand/collapse TREE NODE only** (Local/Drive). **`ic-more` (ellipsis): open PANEL OPTIONS MENU** (Explorer/Inspector). **`ic-close` (×): close a TOOL WINDOW** (Problems). Do not reuse `ic-down` as a generic "close panel" action.
- Panel close state belongs to the existing `state.explorerOpen`, `state.inspectorOpen`, `state.problemsOpen` and `saveLayoutSoon()`; do not add independent visibility state. Reopen via left Activity Bar (Explorer) or right Tool Window Bar (Inspector/Problems). Closing must restore the central area's width/height, and retained widths/heights must return after reopen.
- **No dead controls**. Ellipsis menus must have real actions. Do not add the schematic terminal/play rail buttons (no separate Web terminal/transport tool window exists); likewise do not modify shared Preview to make them work. The Activity Bar Explorer action and right rail Inspector/Problems actions already work and must be retained. Search icon may be added only when directly invoking existing CodeMirror search; sliders icon only when opening existing Inspector Settings (Web host action).
- `web/src/icons.ts` is currently limited to 17 symbols, omitting `file`, `more`, `error`, `warning`, `right`. Import **exact vector path geometry** for needed icons from `web-compact-icons.svg` into the existing `WEB_ICON_SPRITE`; use SVG `<use href="#ic-*">`, never text glyphs, emoji, icon fonts, or a new runtime icon package. Hit target >=28×28px, icon 16–20px, title + localized aria-label for icon-only buttons.

## 3. Exact Change Set / Visual corrections

### A/P1 — Explorer tree vs screenshot (Web-only)
Reference: integrated SVG left pane / close-up SVG Explorer section.
- `web/src/main.ts`: Explorer header y=40–76, h=36. Display `PROJECT` as compact 12px/650 title; place **`ic-fileplus` New Score** and **`ic-more` options** at its right. The existing `#import-file` action moves into the functional options menu: Import, Close Explorer, Reset Explorer Width (220px). No large "新しい楽譜" button between a root and its children.
- `web/src/explorer/explorerController.ts`: Local and Google Drive remain **simultaneously visible expandable tree roots**, not exclusive storage tabs. A root row is 32px high, shows `ic-down` or `ic-right` at left, then **folder icon for Local / cloud icon for Drive**, then localized label. Expansion is solely controlled by its chevron; switching active storage must not highlight the whole root row like a selected file.
- Document rows: 30–32px high, one line, **`ic-file` 16px** plus filename; actual **active document row** carries the selected-background state `#333F59` in Dark. Extend `ExplorerSnapshot` with active tab's document identity + Drive account context (no duplicate editor state), so rows compare source identity, not storage kind. Retain updatedAt/modifiedTime as title/accessible metadata; remove the always-visible second date line. Drive folder uses `ic-folder`; connected root has a small green status dot.
- Disconnected Drive: small inline "接続" action aligned with the root, not a large multi-line explanation or bulky button/empty area. Authorization errors must remain available as an accessible concise status/tooltip. Keep `drive.file`, Picker and existing account scoping unchanged. Local actions stay usable offline. Mock-connected fixture must show Drive folder+file and account state.
- Match spacing, indentation (root icon→label 8px; nested file indent 20–24px), text density, color and hover/selected states against approved SVG. Do not hardcode per-document y-values: root positions depend on the number of real files.

### A/P1 — Inspector panel header and control symbols
Reference: approved SVG Inspector `INSPECTOR` with right `ic-more`; right rail with `ic-inspector`.
- `web/src/main.ts` `#collapse-inspector` currently renders a **down-chevron**. Replace this with an **ellipsis** button `#inspector-more` using `ic-more`, opening an accessible menu with exactly: "Inspector を閉じる" (sets `inspectorOpen=false`), "幅を初期値へ戻す" (sets `inspectorWidth=300`, reapplies layout and saves). No unused menu entries.
- Keep the already-fixed **right Tool Window Bar**: Inspector button above Problems, x=1564–1600, button centers around y=48 and y=82, with correct active state; no duplicate Inspector action in left Activity Bar. Clicking the right button reopens a closed Inspector.
- Inspector header 36px high; header label, menu icon and tabs use approved SVG sizes/gaps. Initial Web `inspectorTab` should be `variables` to match the reference **without fabricating variable values**; when no variables exist, use shared Inspector empty-state. **Do not edit shared Inspector renderer or schema**. Preserve Document/Variables/Settings/Progression tabs and their existing state/edits.

### A/P1 — Problems chrome, list and close button
Reference: approved SVG lower window; real capture `problems-ja.png` still has text-only rows.
- Existing `#collapse-problems` is a **down-chevron**; replace it with `ic-close` × on the **far right of the 32px Problems header**, localized label "問題パネルを閉じる". Close sets `problemsOpen=false`, right `#toggle-problems` reopens it with retained 200px/default or user-resized height.
- Header left: **`ic-problems` 17–18px, "Problems" label, error icon `ic-error` red #EE6D75 with count, warning icon `ic-warning` yellow #E5B75B with count**. Render 0 counts muted instead of hiding controls. Preserve compiler diagnostics as the only source of counts.
- Immediately below the header provide a proper column-heading row (height 25–30px) aligned with diagnostic rows: **Severity | File | Line:Col | Message** (localized). Rows have **error/warning SVG 16–18px** + label (never text-only severity), actual file, actual 1-based position and formatted message. Use the **same CSS grid columns for headings and rows**, responsive `74px minmax(180px,1fr) 72px minmax(250px,3fr)` at desktop (clamp at narrow widths); no invented diagnostic entries. Clicking actual rows and context-menu actions still navigates correctly.
- All height/layout changes remain inside the existing Problems DOM in `web/src/main.ts` and CSS; no parser/Preview changes.

### A/P2 — SVG detail, color and header state
- Web chrome Dark palette: `#202229` header, `#22252C` tool windows, `#333F59` selected row, `#424652` fine boundaries, `#7692F4` selected accent, `#99A3B5` muted text. Scope CSS to host controls, not iframe Preview/score renderer.
- Top header remains **40px** and its right controls remain Save / PDF / Account / Help / Settings in that order. Connected state shows *actual* Drive connection status near Account; disconnected state is visibly neutral and MUST NOT claim connected. Do not show UTF-8 UI. Help and settings must remain operational.
- The source/split/score mode icons are already in the 36px tab row and should not move. Layout dimensions, 4 Splitters, state persistence and existing 17 SVG icons that match approved shapes should not regress.
- **Status and evidence**: a screenshot with only `Untitled.guitardsl`, disconnected Drive and 0 Problems is NOT a valid identical-state comparison to the SVG showing multiple songs, connected Drive and compiler diagnostics. Build a Web E2E fixture with two+ Local docs, mocked connected Drive folder/file, selected Local document, a *real* diagnostic, dark 1600×900 and Inspector Variables; capture it separately. Keep the empty/offline view too. Do not inject fake labels, mock notation SVG, or sample diagnostics into production.

## 4. Required Runtime Semantics / Rejected Alternatives
- Explorer/Inspector/Problems closing must not touch `tab.source`, revisions, undo, saved drafts, audio lease, iframe document lifecycle, storage identity or Google account.
- On resize or keyboard toggle, restore last user-requested width/height; auto-collapse due to narrow viewport is transient and must not overwrite saved explicit state. Existing 6px splitters remain accessible.
- Panel ellipsis menus: mouse/Shift+F10/arrow/Escape, focus restore and invalid-target guarding consistent with current `showWorkspaceMenu`. No buttons that only look interactive.
- Not in scope: shared Preview toolbar/settings layout, rendering content, musical SVG, shared Inspector content, Drive authentication model, music playback, terminal, new features. **Rejected**: changing `packages/ui/src/previewHtml.ts` to remove the extra row, using CSS to hide it inside the iframe, or comparing real notation pixel-for-pixel against illustrative SVG data.

## 5. Concrete Tests / Reviewer Acceptance
1. Screenshot: 1600×900 Dark, reference-equivalent fixtures. Verify header 40; Explorer heading 36; root/file row 32px; icon IDs and actual icon paths; Inspector header menu; Problems header 32 + × + severity icons + four aligned columns; right rail Inspector/Problems order. Reference close-up SVG and main workspace SVG.
2. Explorer: root expand/collapse with `ic-down/right`; file icons; active file only selected; one-line rows; Local usable offline; connected Drive row/folder/file + account; new score/header menus work and menus keyboard-accessible.
3. Inspector: ellipsis opens exactly the specified menu; Close via menu hides pane without changing document; reopen from right rail restores saved width; width reset=300. Web default Variables tab can render an empty state without inventing metadata as variables.
4. Problems: × closes; right rail reopens preserving height; error/warning SVG and column headings; real compiler diagnostic click + context menu still navigates; zero diagnostic state remains functional.
5. Cross-state: Source/Split/Score, 4 splitters, layout persistence, CodeMirror undo and IME, Help/Settings/Drive actions. No modifications in shared `packages/` / VS Code extension paths (diff check).
6. Re-capture screenshots and DOMRect at **new HEAD**, annotate discrepancies in reviewer checklist; compare **Web shell only**, masking the iframe's internals. Retain 1600×900 ja/en × light/dark and 1280×800. Report incomplete reference-state fixture separately.
7. Run `npm run compile`, `npm run build:web`, `npm run test:unit --workspace web`, `npm run test:e2e --workspace web -- --project=chromium`, `npm run test:e2e --workspace web -- --project=webkit`, `npm run check:help`, `npm run check:ai`, `git diff --check`; run required GH checks. The previous full `npm test` report had an intermittent VS Code E2E #158 failure: do not silently report that run as PASS or change #158 unrelated code.

## 6. Implementation Sequence / Reviewer Checklist / Completion
1. Make approved panel icon paths available in Web-only sprite; **do not edit shared package paths**.
2. Implement Explorer compact tree and real header icon-menu; preserve identity and Drive.
3. Implement Inspector ellipsis options, defaults and rail state; then Problems heading, close and row grid.
4. Retune Web-only chrome tokens and header/account status. Refresh Help text for menu controls if needed.
5. Extend tests; regenerate screenshot evidence and DOMRect against new HEAD; self-review every item below.

Reviewer checklist:
- [ ] Scope respected: no shared notation/Preview/Inspector component edits.
- [ ] SVG icon paths identical; no fake/inert controls; correct chevron vs ellipsis vs × semantics.
- [ ] Explorer rows/selection/density/Drive states match the visual reference.
- [ ] Inspector default/ellipsis menu/rail collapse and width restore work.
- [ ] Problems header and 4 columns/real severity icons/close/reopen work.
- [ ] Header Account/Help/Settings are correct; connected status truthful.
- [ ] Existing editing, layout, Drive, context menu and keyboard behavior remain intact.
- [ ] New screenshot & DOMRect evidence from same HEAD, and all relevant tests reported.

**Completion report:** changed files; checks; PASS/FAIL/NOT RUN per test and platform; screenshot links; deliberate SVG-only/shared-UI exceptions; commit SHA; same PR #173 URL; review readiness. Do not call complete before commit, push and PR update. Incompatible material design must be reported, not silently redesigned.
