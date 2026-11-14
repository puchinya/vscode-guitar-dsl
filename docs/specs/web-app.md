<!-- agent-doc-type: specification -->
<!-- agent-doc-schema: 2 -->

# GuitarDSL Web application specification

- Status: Current
- Owning Issue: [Issue #166](https://github.com/puchinya/vscode-guitar-dsl/issues/166)
- Related Issue: [Issue #172](https://github.com/puchinya/vscode-guitar-dsl/issues/172)
- Related design: [Web application design](../design/web-app.md)
- Related specifications: [GuitarDSL syntax](guitardsl-syntax.md), [VS Code extension](extension.md), [GUI](gui_design.md)

This document defines the public behavior of the browser-based GuitarDSL single-page application (SPA). The VS Code extension remains an independent product with its existing editor, commands, and VSIX package. GuitarDSL syntax and score meaning continue to be owned by the [syntax specification](guitardsl-syntax.md).

## 1. Overview

### Purpose

The Web application provides browser-based GuitarDSL editing, score preview, practice playback, and PDF download. It supports local documents without a Google account and optionally connects to Google Drive after a user-initiated sign-in.

### Scope

This specification covers the Web application's editor, score UI, document identity and persistence, Google Drive connection, local-to-Drive transfer, PDF download, responsive behavior, errors, and privacy boundaries. It does not redefine GuitarDSL syntax or change the behavior of the VS Code extension.

### Normative requirements

The numbered sections below define the Web application's normative behavior. The editor, workspace, storage, Drive, and PDF contracts are separate to keep each user-facing boundary traceable.

## 2. Application and document editing

- The Web application is a static, browser-only SPA. It does not require a dedicated application backend, authentication server, server-side rendering service, or application database.
- The formal browser targets are desktop Chromium and the latest stable Safari on macOS. Support claims are limited to the browser and operating-system versions recorded in implementation status; iOS and iPadOS Safari are outside this target.
- The application MUST open, create, edit, save, list, and delete local GuitarDSL documents in IndexedDB without connecting a Google account. Supported document extensions are `.guitardsl` and `.gdsl`.
- The editable source buffer is the single source of truth for a document. Parsed scores, diagnostics, Preview SVG, Inspector values, playback state, and PDF output are derived from a particular source revision.
- The source editor MUST support line numbers, active-line highlighting, matching brackets, indentation and Tab, line wrapping, search, replace, go-to-line, selection, IME composition, undo, and redo. Syntax highlighting and editing aids MUST preserve the editable source as text and MUST NOT add an independent GuitarDSL parser.
- The editable source buffer is authoritative; editor state is associated with its open tab. The editor MUST retain each tab's selection, scroll position, and undo/redo history when switching tabs or redrawing the workspace. A browser reload MUST restore source and drafts, but is not required to restore undo history.
- A completed CodeMirror transaction MUST be synchronously committed to its owning document key before a workspace redraw, tab switch, or document identity change can replace editor state. A queued edit MUST never be published to whichever tab happens to be active later.
- The editor MAY normalize line separators for display, but edits MUST preserve untouched original CRLF or CR line endings using the document's source-preservation rules. Input MUST NOT be saved, completed, or replaced before an active IME composition is committed.
- Each user input batch, search/replace, completion, and accepted Preview or Inspector change set MUST be one undoable source edit. A workspace view-mode change or layout resize MUST NOT reset the source, selection, undo history, Preview scroll position, or playback position.
- Completion candidates MUST be deterministic and derived locally from document fields, line prefixes, variables, and syntactically safe DSL constructs. Completion MUST NOT call an AI model or network service.
- Inspector and Preview edits MUST be expressed as source-preserving changes and applied only when their document identity and expected revision still match the current buffer.
- The application MUST support Japanese and English UI, light and dark themes, keyboard operation, and accessible names and states for interactive controls.

## 3. Score workspace and preview

- The Web application uses a Compact IDE workspace. Its reference viewports are 1600 × 900 and 1280 × 800 CSS pixels. The normative panel geometry, controls, and hierarchy are owned by the [GUI screen specification §5](gui_design.md#5-web-compact-workspace).
- The workspace has exactly one global display mode: Source, Split, or Score. Split is the default. The three icon-only controls MUST be mutually exclusive, expose `aria-pressed`, and have Japanese and English `aria-label` and `title` text. The global mode is independent of the Preview's existing normal, edit, and practice modes. Source and Score modes hide the opposite pane and the internal splitter.
- The three workspace view controls occupy the right side of the 36 px document tab row. The workspace MUST NOT add a second title or toolbar row between the tabs and the Source/Score panes. Preview playback and settings controls remain in the Preview's existing 48 px row.
- Explorer MUST show the “On this device” and “Google Drive” roots at the same time. Each root expands and collapses independently and owns its own file list and storage actions. Selecting a root MUST NOT hide the other root or change the identity of any open document.
- A narrow viewport MUST avoid horizontal overflow. When the available width is insufficient, the Inspector and then Explorer are temporarily collapsed in that order. Width-driven collapse MUST NOT overwrite a user's saved manual open/closed state. The user can reopen a collapsed region from its adjacent tool-window control.
- Playback and score settings remain available in the Preview's compact 48 px row. The Preview retains the existing normal, edit, and practice modes. The Inspector provides document, variables, score settings, and chord progression tabs.
- Problems is an independent bottom tool window spanning Explorer, center, and Inspector, while excluding the Activity Bar and Tool Window Bar. It is open by default, can be collapsed and resized, and source edits MUST NOT automatically open or close it.
- Problems and editor lint consume the same compiler diagnostics. Each row shows severity, file, line and column, and message; error and warning counts appear in its header. Selecting a diagnostic switches to Source mode and reveals and focuses its compiler-provided source range. An empty list displays “No problems”. The old diagnostic list below the source editor is not shown.
- The header provides Save, PDF, Google Account, Help, and Settings controls. The Google account control distinguishes disconnected, connecting, connected, and expired states; Drive connection and folder operations remain available from the Explorer and account menu.
- All four workspace splitters support pointer dragging and cancellation, resetting only their own size on double-click, and keyboard resizing through a focused `separator`. Each splitter exposes orientation, min/max/current values and a visible focus ring. Clamping MUST prevent negative sizes, non-finite geometry, and horizontal overflow.
- Workspace display mode, panel open state, widths, heights, and center split ratio MUST be persisted and restored. Invalid saved preferences fall back to defaults. Temporary width-driven collapsing MUST NOT replace the user's saved manual open/closed state.
- The application MUST provide Japanese and English UI, light and dark themes, keyboard operation, and accessible names and states for interactive controls.
- Score rendering, playback order, timing, source-preserving edits, and other shared GuitarDSL behavior MUST use the same core implementation as the VS Code extension. The Web application MUST NOT introduce a second parser, score model, play-order resolver, timeline, or rendering interpretation.
- A view-mode change or splitter drag MUST resize the existing Preview without unnecessarily recreating its iframe. The Preview and Inspector audio lease and Preview playback position MUST remain intact.
- Score rendering, playback order, timing, source-preserving edits, and other shared GuitarDSL behavior MUST use the same core implementation as the VS Code extension. The Web application MUST NOT introduce a second parser, score model, play-order resolver, timeline, or rendering interpretation.
- Preview and Inspector audio use one exclusive playback lease. Preview playback or practice and Inspector audition MUST NOT play at the same time.
- Closing a tab, switching storage sources, or refreshing the browser MUST preserve recoverable drafts. A storage switch MUST NOT silently change the identity or contents of documents already open in tabs.

## 4. Document identity and persistence

- A document is identified by `{storage, fileId}`. A local document and a Drive document with the same name are different documents.
- Opening a document more than once MUST focus its existing tab rather than create a duplicate. Different document IDs remain separate even when their names match.
- Local source and recoverable drafts MUST persist in IndexedDB. Tab session state needed to restore open documents after refresh MUST also be recoverable without storing credentials.
- The application MUST track each tab's last successfully persisted draft revision and source. If any current tab has changes that have not completed persistence, including a pending or failed IndexedDB write, navigating away MUST trigger the browser's native leave confirmation. The application MUST NOT rely on asynchronous writes started from `beforeunload` to preserve source. A user who stays on the page can wait for the saved state or export the source if persistence fails.
- A visible saved state may be shown only after the corresponding storage operation succeeds. If IndexedDB is unavailable, the application MUST state that it cannot persist the document and provide a download path; it MUST NOT claim that unsaved text was saved.
- Local import and export MUST remain available when Google authentication, Drive, or network access is unavailable.

## 5. Google Drive

- Drive is optional. Users MUST be able to use local documents without signing in.
- Authentication uses the Google Identity Services browser token model. The access token is held in memory only; the application MUST NOT persist OAuth tokens in IndexedDB, Web Storage, URLs, logs, or source files. The requested Drive scope is `https://www.googleapis.com/auth/drive.file`; the application MUST NOT request a broader Drive scope.
- A deployment supplies a public Web OAuth client ID, a referrer-restricted Google API key, and its Google Cloud project number through Vite `VITE_GOOGLE_CLIENT_ID`, `VITE_GOOGLE_API_KEY`, and `VITE_GOOGLE_APP_ID` settings. No OAuth client secret is used in browser code.
- A user selects a Drive folder through Google Picker or the application creates a `GuitarDSL` folder. The selected folder ID is non-secret local configuration. Changing or disconnecting the account or folder MUST NOT delete open tabs or local drafts.
- A Drive file open MUST capture the current account ID and Drive API instance before starting asynchronous work. After Picker, Drive reads, conflict decisions, and storage writes, the application MUST verify that the same account and Drive instance are still current before saving account-scoped data or reflecting the result in tabs and the file list. A result from an account session that has ended MUST be discarded and MUST NOT be reassigned to the newly connected account.
- Drive listing is limited to application-created files and files the user has explicitly authorized through Picker. The application MUST filter for `.guitardsl` and `.gdsl`, exclude trashed files, and handle pagination. It MUST NOT imply that every existing child of a selected folder is accessible under `drive.file`.
- A user may use Picker to authorize an individual existing file that is not otherwise visible in the application list.
- Drive writes occur only after explicit save or an autosave action the user has configured. A normal save MUST update the same Drive `fileId` and keep the file name by using `files.update` media PATCH. `files.create` is reserved for a new document, explicit Save As, and the first upload during a local-to-Drive move; normal saves MUST NOT create per-save copies.
- Before an update, the app MUST compare the current `version`, `modifiedTime`, and `headRevisionId` with the last-read values. A detected mismatch MUST abort the PATCH, preserve the local draft, and offer reload from Drive, Save As, or cancel. Saves to the same `{accountId, fileId}` MUST be serialized within the app.
- After PATCH, the app MUST read the Drive source back and compare it with the submitted source. The app reports success only after this verification. Edits made while a save is pending MUST remain as a local draft after the submitted version is verified.
- A PATCH 401 leaves the save unconfirmed and the local draft intact, marks Drive authorization expired, and offers an explicit reconnect action. After reconnecting, the user checks the remote file before deciding to retry. A PATCH 403 is shown as an access-permission problem and does not start an authentication prompt or reconnect loop. Neither status automatically resends the PATCH.
- The GET→PATCH sequence is not atomic. A different device can write in that interval and have its changes overwritten. This residual race is explicitly accepted; the app does not claim complete conflict exclusion or zero-loss concurrent editing. Browser ETag visibility is not a save prerequisite, and `If-Match` is not the basis of an atomic guarantee.
- Moving a local document to Drive is an explicit operation. The application first persists the current local buffer, uploads to the selected folder, reads back and verifies the remote document, deletes the local original only after verification, and then updates the open tab identity. Any failure or interruption before successful verification MUST retain the local original. If upload succeeds but local deletion fails, the application reports both copies and retry MUST reconnect to the same Drive file rather than create another.
- A Drive file with an existing name MUST NOT be silently overwritten during a move.

## 6. PDF export

- PDF export downloads a PDF generated from the same score-page SVGs used by the Preview and VS Code extension. Output preserves the common page layout, Japanese text, TAB, chord diagrams, and multiple pages.
- Browser export MUST not require a server. It uses a browser download, and font bytes needed for Japanese output are provided to the PDF renderer without introducing Node-only file APIs into browser code.

## 7. User-visible behavior

### Observable behavior

- After startup without Google authentication, users can create and edit a local document, see diagnostics and score Preview, use the Inspector and playback, retain a draft through refresh, and download a PDF.
- Explorer keeps the local and Drive roots visible together. Local create/import/export/delete actions remain available without Google authentication. Drive connection or reconnection, folder selection or creation, and opening from Drive are available from the Drive root. Open tabs remain attached to their original `{storage, fileId}`.
- Selecting the same file twice selects the existing tab. Closing a tab retains its local draft and any recoverable Drive draft.
- The Preview and Inspector show derived state for the active document revision. An edit from either surface either applies to that same revision as one source edit or makes no source change and reports that the edit is stale.
- A Drive save reports success only after the remote operation succeeds. Authentication cancellation, unavailable files, version conflicts, and network errors leave local source and drafts available for retry or export.
- If another device saves at nearly the same time, its changes may be overwritten during the accepted GET→PATCH race. The Drive file-list UI and Help state this limitation. Detected preflight conflicts still stop without writing.
- The local-to-Drive move UI reports completion only after remote readback verification and local deletion. On partial failure it reports which copy remains and preserves a retryable identity.
- When local persistence is unavailable, the UI clearly communicates that the current text is not saved and offers download.
- Problems and editor lint display the same compiler diagnostics in the same order and with the same source ranges. Selecting a problem switches to Source mode and focuses its source range; zero results show an explicit empty state.
- Help opens a local Japanese/English dialog with a table of contents for basic operation, editing, Preview, Drive, and shortcuts. Closing with Escape or the close button returns focus to the Help control. Settings opens a local menu for system/light/dark theme, Japanese/English language, and confirmed layout reset.
- Right-click, Shift+F10, and the Context Menu key open host-owned menus for Explorer roots and files, document tabs, Problems rows, Preview notation, and the source line-number gutter. Right-click within the source editor text body keeps the browser's native editing menu for cut, copy, paste, IME, and selection.
- The local root menu offers New score and Import file. The Drive root menu offers Connect or Reconnect when needed; when connected it offers folder selection, folder creation, and Open from Drive. A local file menu offers Open, Export, and Delete with confirmation, plus Move to Drive only when the transfer is available. A document tab menu offers Open this tab, Close other tabs, Export source, and Close, with Move to Drive when applicable.
- A Preview notation menu offers Go to source position only when the clicked visual element has a current `visualSourceBinding`; otherwise that item is disabled. It also offers PDF export. The Preview message carries the binding ID and `{documentUri, documentVersion, previewGeneration}`. The host MUST validate all four values again when the action runs and do nothing when the document, revision, render generation, or binding changed.
- Explorer, tab, Problems, and Preview menus expose only applicable actions and close within the viewport. Menu actions revalidate document identity, revision, Drive account, and (for Preview) source binding when run. A changed target invalidates the action. Menus support arrow keys, Home/End, Enter/Space, Escape, outside click, disabled state, and return focus to the invoking element.
- Copy-message actions report Clipboard API failures rather than claiming success. Destructive local deletion asks for confirmation. Existing Google Drive scope and destructive-operation limits remain unchanged.

## 8. Errors

### Error and boundary behavior

- **IndexedDB unavailable or quota/write failure:** retain the in-memory buffer, do not display a saved state, explain the persistence failure, and provide a download route.
- **Invalid GuitarDSL:** retain the source, show the compiler diagnostics, and render only the valid derived state permitted by the shared compiler contract.
- **Stale Preview or Inspector edit:** reject the entire change set without editing the source and refresh derived UI from the current revision.
- **Authentication cancelled, expired, or unavailable:** retain local tabs and drafts, do not report a Drive save, and allow a user-initiated retry.
- **Drive 401/403/429/5xx, offline, or readback mismatch:** retain source and drafts, report that the save was not confirmed, and never automatically resend the PATCH. For an unknown result, read Drive once to determine the observed remote state; a later retry requires an explicit user action. A PATCH 401 also marks the current Drive authorization as expired and offers an explicit reconnect action; after reconnect, the user reviews the remote state before retrying. A PATCH 403 is reported as an access-permission failure and does not trigger an automatic authentication prompt or reconnect loop.
- **Drive version mismatch:** perform no overwrite; offer reload from Drive, save the local draft under another name, or cancel.
- **Different-device write between preflight and PATCH:** the app cannot detect this race atomically; the concurrent write may be overwritten as described in §5. Do not describe this behavior as conflict-free or lossless.
- **Account or folder changes:** keep local identity separate from Drive identity and prevent cached documents from another account being shown as the active account's files.
- **Move interrupted or partially completed:** keep the local original until the remote copy has been read back and verified. Repeated retry MUST be idempotent with respect to the already-uploaded remote file.
- **PDF conversion or download failure:** preserve the source and report that no successful export occurred.
- **Audio or worker failure:** stop or release the affected playback lease and leave document source unchanged.
- **Invalid saved layout value:** fall back to the affected panel's default without negative or non-finite geometry. A width-driven collapse is transient and does not replace the stored manual state.
- **Stale context-menu target or source binding:** perform no action and close or discard the menu. Clipboard denial is reported as a copy failure.
- **Splitter cancellation or hidden pane:** release pointer capture and event listeners; subsequent resizing MUST not change a different pane's stored dimensions.

## 9. Privacy

### Security and privacy

- Google access tokens are short-lived in-memory values and MUST never appear in persistent browser storage, URLs, console output, or document data.
- Normal saves update the existing Drive file and do not create hidden per-save copies. Drive revision history is only an auxiliary recovery option; older revisions are not guaranteed to remain available indefinitely.
- The app uses only the `drive.file` scope. Drive list results are treated as an access-limited view, not proof that a folder has been exhaustively enumerated.
- User-authored DSL, file names, Drive metadata, and rendered score content are untrusted input. HTML and SVG insertion paths MUST escape or safely construct text and attributes; untrusted content MUST NOT become executable markup or script.
- OAuth account identity is kept separate from local document identity. Switching accounts MUST NOT mix one account's cached remote metadata into another account's view.
- The browser app does not send document text to an application server. Drive API requests are made only for user-authorized Drive operations.

## 10. Verification

### Verification strategy

- Unit tests cover local and Drive identity, revision-checked edits, persistence outcomes, file filtering and pagination, Drive version conflicts, transfer recovery, and PDF byte generation.
- Browser E2E tests cover unauthenticated local create/edit/draft/refresh, multiple tabs with independent editor state, IME/Undo/Redo and CRLF preservation, deterministic completion, search/replace, shared lint/Problems diagnostics, three workspace display modes, all four splitters, layout restoration, context menus and keyboard access, narrow layouts, Preview and Inspector edits, PDF download, and storage switching.
- Mocked Drive tests cover cancelled or expired authentication, account changes, Picker cancellation, missing folders, pagination, unsupported or trashed files, access-limited existing files, upload/readback/delete failures, duplicate transfer requests, same-file update identity, preflight conflicts, save serialization, edits during save, unknown outcomes without automatic resend, and readback mismatches.
- Every pull request MUST run three separate protected browser checks: Playwright Chromium, Playwright WebKit on macOS, and a real macOS Safari smoke suite through Apple's SafariDriver. Playwright WebKit is not Apple Safari and MUST NOT count as a Safari result. Firefox may run as an optional regression suite and MUST NOT be a required substitute for Safari.
- The macOS WebKit E2E suite MUST exercise native source-editor Undo and Redo on every pull request.
- The SafariDriver smoke suite MUST record macOS and Safari versions in machine-readable evidence. It covers local IndexedDB create/edit/draft/refresh/restore, trusted source-editor input, Preview SVG, Inspector variables and score settings, PDF Blob validity (`%PDF-` signature and at least one page object) and download-anchor invocation, Web Audio playback exclusion, narrow layout and keyboard focus, source export after storage failure, and mocked Google OAuth/Picker/Drive APIs. It MUST NOT automate or gate on native Undo/Redo or OS-level file persistence, and MUST NOT change the ordinary Downloads directory. Its report records native Safari UI Undo/Redo and actual OS file saving as NOT RUN. Production OAuth and Drive access are reported separately as NOT RUN.
- The SafariDriver report records native Safari UI Undo/Redo and actual OS file saving as NOT RUN. These are outside Issue #166's acceptance gates; no separate normal-window Safari evidence is required. macOS WebKit E2E verifies native editor Undo/Redo on each pull request, and SafariDriver verifies PDF Blob bytes and download-anchor invocation without changing the ordinary Downloads directory.
- Browser verification reports the exact browser, engine, and OS versions. iOS/iPadOS Safari, assistive technologies, and any live Google account scenario not exercised are reported as NOT RUN. If a macOS CI runner cannot enable SafariDriver, the real Safari check is BLOCKED/NOT RUN; WebKit or Firefox success MUST NOT be treated as satisfying it.
- Existing VS Code compile, unit, E2E, packaging, and Help/AI gates remain required for shared implementation changes. Visual UI changes require a rendered preview and image evidence attached to Issue #166; concept diagrams and screenshots are identified separately.
- Issue #172's visual acceptance uses implemented Web screenshots at 1600 × 900 (Japanese Dark) and 1280 × 800 CSS pixels, plus DOM rectangle measurements. It includes Japanese/English in both light and dark themes, a screenshot for each theme/language combination, and focused states for menus, Problems, Source-only, and Score-only views. The four proposal SVGs are concept diagrams, not implementation evidence.
