<!-- agent-doc-type: design -->
<!-- agent-doc-schema: 2 -->

# GuitarDSL Web application design

- Status: Draft
- Owning Issue: [Issue #166](https://github.com/puchinya/vscode-guitar-dsl/issues/166)
- Related specification: [Web application specification](../specs/web-app.md)
- Related designs: [System architecture](architecture.md), [Language and score processing](language-and-score-processing.md), [Preview, rendering, and export](preview-rendering-and-export.md), [Score editing](score-editing.md), [VS Code editor experience](vscode-editor-experience.md)

## Context and goals

Issue #166 adds a static Web SPA alongside the existing VS Code extension. The Web app shares GuitarDSL processing, score UI, document contracts, and PDF rendering where their behavior is host-independent. Each application remains independently buildable and releasable. The extension keeps its existing VS Code `TextEditor`, commands, activation, Webviews, and VSIX boundary.

The design follows the approved Issue contract. It does not add a backend, authentication server, SSR, separate score model, new syntax, or broader Drive scope. The public behavior is owned by the [Web application specification](../specs/web-app.md).

## Requirements traceability

| Requirement | Design owner |
|---|---|
| Static browser SPA and independent extension release | `web/`, root and workspace package manifests, build configuration |
| Shared compiler, score, playback, SVG, and edit planners | `packages/core/` |
| Shared Preview and Inspector UI | `packages/ui/`, with VS Code and Web host adapters |
| Stable document identity, revision checks, and source-preserving changes | `packages/document/` and host-specific document adapters |
| Same SVG page source for Node and browser PDF bytes | `packages/pdf/` and the host-specific PDF export adapters |
| Local documents and recoverable drafts | `web/src/storage/indexedDb.ts` |
| Google token acquisition and Drive file access | `web/src/auth/googleOAuth.ts`, `web/src/storage/googleDrive.ts` |
| Explicit local-to-Drive transfer and recovery | `web/src/storage/fileTransfer.ts` |
| Browser layout, editor, tabs, and file list | `web/src/editor/`, `web/src/tabs/`, `web/src/explorer/`, `web/src/adapters/` |
| Public interaction and security requirements | [Web application specification](../specs/web-app.md) |

## Architecture

### Product and workspace boundaries

- The repository contains the existing VS Code extension at the root, the browser application in `web/`, and shared workspaces in `packages/{core,ui,document,pdf}/`.
- The root package continues to expose `main: ./out/extension.js`. The extension and Web app have separate build configurations and release artifacts. The Web app is built as static assets with Vite and Vanilla TypeScript; it does not introduce React, Vue, Monaco, or CodeMirror.
- Workspace packages expose explicit build outputs and package exports. VS Code packaging bundles the shared runtime into the extension; a VSIX MUST NOT rely on workspace symlinks being available at runtime. `.vscodeignore` excludes Web source, built SPA distribution, and shared package source/tests from the VSIX.
- Existing host-independent logic moves to `packages/core/` instead of being copied. Temporary root `src/` re-export shims are allowed for compatibility during migration, but logic has one owner.

### Shared package responsibilities

| Package | Owns | Must not own |
|---|---|---|
| `packages/core` | Compiler, parsed score, score transforms, SVG/layout, play order, timeline, shared progression source planner, host-independent Capo/Beginner/Transpose section models and validation | VS Code APIs, browser DOM, storage, OAuth, filesystem APIs, a second AST or timing model |
| `packages/ui` | Host-independent Preview, Inspector, chord and variable editors, shared settings renderer and progression markup, styles, playback and practice controls | File persistence, application storage, `acquireVsCodeApi`, OAuth, direct host file I/O |
| `packages/document` | Document identity, revision, session identity, source-preserving change sets, save requests and change event contracts | Host-specific `TextDocument`, IndexedDB or Drive API calls |
| `packages/pdf` | `renderPdfBytes(dsl, options, fontBytes): Promise<Uint8Array>` and shared page selection/render contract | Node `fs`, `path`, or `Buffer` in common code; separate score-page SVG rendering |

Each app supplies adapters for its host boundary. The VS Code extension adapts `TextDocument` and `WorkspaceEdit`, Webview messaging, Node PDF save dialogs, CSP, and theme values. The Web app adapts the mutable browser buffer, DOM events, IndexedDB, Google Drive, browser fonts, Blob downloads, and browser theme/locale preferences.

The shared settings sections consume a plain source snapshot and return display models; host adapters own source identity/revision checks, messages, confirmation, and the single undoable apply. The Web and VS Code Inspector use the same settings renderer from `packages/ui/src/inspectorSettings.js` and the same progression-panel markup from `packages/ui/src/progressionInspectorMarkup.ts`. Progression candidates are applied through the source-preserving planner in `packages/core/src/progressionSourceEdits.ts`. The UI build synchronizes the canonical settings script to `media/inspectorSettings.js` for the VS Code Webview.

### Web application composition

- `web/index.html` and `web/src/main.ts` bootstrap the static SPA.
- `web/src/editor/` owns the native `textarea` input surface and visual highlighting layer. The textarea remains the editable text buffer so browser IME, selection, keyboard input, and undo remain native.
- `web/src/explorer/` owns storage selection and file listing; `web/src/tabs/` owns tab identity and active document selection. The workspace is composed from a left file list, central tabs, adjustable source/Preview split, and right Inspector. Narrow layouts collapse side regions and switch between source and score surfaces.
- `web/src/adapters/` translates browser events and host capabilities into the shared UI and document contracts. Shared UI does not import storage adapters.
- `web/src/storage/` contains the IndexedDB adapter, Drive API adapter, and transfer coordinator. `web/src/auth/` wraps user-initiated Google Identity Services token requests.
- `web/src/pdfExporter.ts` selects browser font bytes, calls the shared PDF byte API, then starts a Blob download. It does not call Node APIs.

### Host-independent data flow

1. A host adapter resolves a stable document identity and its mutable source buffer.
2. An edit changes the buffer once and advances its revision. A derived source snapshot is sent to the shared compiler and render pipeline.
3. The core produces a `ParsedScore`, diagnostics, and SVG pages. The shared UI consumes these derived values; the editor buffer remains authoritative.
4. Preview and Inspector planners create source-preserving change sets against `{documentId, expectedRevision}`. The host validates both values at apply time. A stale or invalid change is rejected with zero source edits, after which derived UI is rebuilt from the current buffer.
5. Playback order and timeline are resolved through the shared core functions. `packages/ui` owns the `ProgressionAudioLeaseCoordinator`; the VS Code and Web host adapters provide Preview locking and Inspector playback ports. Preview/practice and Inspector audition use this exclusive lease, and lifecycle disposal releases playback and listeners.
6. PDF export uses the same page SVG renderer. The host-specific layer only supplies font bytes, chooses page options, and delivers the resulting bytes.

### Document and storage ownership

- `packages/document` defines identities as `{storage, fileId}` and contracts for source revisions, session identity, save requests, and change sets.
- An open document has one mutable source buffer. A compiler or Preview snapshot is derived state and cannot independently become the saved source.
- The browser session stores open-tab identity and recoverable drafts in IndexedDB. Draft persistence and user-visible saved state are updated only after IndexedDB confirms the write.
- Local documents and Drive documents remain separate identities even when names match. Switching the file-list storage source changes only the list, not open tabs.
- The Drive adapter keeps account-scoped metadata and open-tab sessions separate and uses only explicitly authorized files. Switching or disconnecting accounts retains each account's open tabs and drafts; Drive writes are enabled only when the connected account owns the active Drive tab. OAuth access tokens remain in memory. The selected folder ID is configuration, not a credential.
- Opening a restored document compares its current source and revision with the last committed record. A recovered draft is shown as a local draft until a successful local or Drive commit advances that saved baseline.
- A normal Drive save updates the existing `fileId` with media PATCH. Before the PATCH, the adapter compares `version`, `modifiedTime`, and `headRevisionId` with the last-read values; a mismatch returns without writing. Saves are serialized by `{accountId, fileId}` in this app instance. After PATCH, the host reads the source back before committing the remote baseline. A network-unknown PATCH is reconciled with one readback; an unresolved result or HTTP 401/403/429/5xx keeps the draft and is never automatically resent.
- A live Google OAuth/Drive test on 2026-11-14 could not read ETag from metadata or `alt=media`, so the probe did not send `If-Match`. This does not block normal saves: the app does not treat ETag as the concurrency guarantee. GET→PATCH remains non-atomic, and another device's write in that interval may be overwritten. This residual race is accepted by the Issue #166 Architecture Decision Addendum (`6860479905`) and is disclosed in the Drive UI and Help.

### Google Drive transfer protocol

Local-to-Drive move is a recoverable sequence rather than a rename:

1. Persist the active local buffer and retain the local document identity.
2. Upload to the selected folder without silently overwriting a same-name file.
3. Record the returned Drive file ID and read the file back.
4. Verify the remote identity and content against the uploaded source.
5. Delete the local original only after successful verification.
6. Rebind the open tab to the Drive identity and refresh its revision/version metadata.

Failures before step 5 leave the local source intact. If upload succeeded but readback or local deletion failed, the transfer record retains the Drive file ID so retry reconnects to that same file rather than uploading a duplicate. If both copies remain, the UI reports that state. Account changes cannot reuse a transfer record belonging to another account.

### PDF boundary

The PDF package consumes the common score-page SVG output and returns bytes. Browser and Node builds may use host-specific bundling for `pdfkit`/`svg-to-pdfkit`, but they share page selection and SVG generation. Before replacing or forking the renderer, verify that the current PDF dependencies can be bundled in both environments. If that requirement conflicts with the current Node implementation, report the exact incompatibility rather than silently changing the PDF engine. Japanese font bytes cross the API as `Uint8Array`; common code does not depend on `Buffer`, `fs`, or `path`.

## Data flow and ownership

| Data | Authoritative owner | Derived consumers |
|---|---|---|
| Current DSL text | Open document buffer in its host adapter | Compiler, diagnostics, Preview, Inspector, playback, PDF |
| Document identity and revision | `packages/document` contract plus host adapter | Tabs, persistence, edit validation, save requests |
| Parsed score, render layout, playback order and timeline | `packages/core` | Shared Preview, Inspector, playback, PDF |
| Shared markup and UI state | `packages/ui` | VS Code Webviews and Web DOM adapters |
| Local source and draft | IndexedDB adapter | Explorer, tabs, restore flow |
| Drive file content and version | Google Drive API through Drive adapter | Explorer, tabs, explicit save/transfer |
| OAuth access token | In-memory auth adapter | Authorized Drive requests only |
| PDF bytes | `packages/pdf` | VS Code save adapter or browser Blob download |

The local source buffer is the only editable source. A Drive-backed tab also keeps a recoverable local draft, while remote version metadata remains separate from that draft. A verified save advances the remote version only after readback matches the submitted source. A failed or unresolved write leaves the local draft available; an unresolved result does not silently advance the known remote baseline.

## Failure handling

- Compiler, renderer, planner, and PDF failures stay typed at their owning package boundary; they are not converted into successful empty output.
- IndexedDB errors do not clear the in-memory source. The UI reports unsaved state and enables file download.
- Each Drive open captures its account ID and `GoogleDriveApi` instance. A multi-request `getFile` read also pins its access token across metadata and media requests, so an account reconnect cannot switch credentials halfway through that read. Picker, Drive-read, conflict-dialog, and IndexedDB continuations recheck the captured session before starting writes and before changing tabs or Explorer state; a result from an ended session is discarded. Account-scoped keys always use the captured account ID.
- The editor compares each tab's current revision/source with its last successfully persisted draft and tracks queued writes. `beforeunload` requests the browser's native confirmation while a revision is pending or failed; it starts no asynchronous IndexedDB work. An actual page exit disposes playback resources on `pagehide`, so dismissing the confirmation leaves the current page usable.
- A stale change set or mismatched document ID is rejected before applying any source edit. One rejected operation cannot partially modify the document.
- Drive authentication, permission, rate-limit, network, and server failures retain local source and drafts. A PATCH 401 marks authorization expired and changes the Connect action to explicit Reconnect; after reauthentication the user checks Drive before retrying. A PATCH 403 remains a permission error and does not start an authentication loop. Neither status triggers an automatic PATCH resend.
- An observed Drive version conflict offers reload, save as a separate file, or cancel and sends no PATCH. A concurrent update after preflight is an accepted residual race; the UI and Help disclose that another device's nearly simultaneous write may be overwritten.
- A network failure or malformed PATCH response is followed by one Drive readback. If that readback matches the submitted source, the write is verified; otherwise the app keeps the draft, reports an unconfirmed outcome, and does not retry automatically. HTTP 401/403/429/5xx also keep the draft and never trigger an automatic write retry.
- Conflict reload and save-as capture the tab identity, source, and revision before their asynchronous Drive requests. Before applying a response, the host checks that the same tab still has that snapshot. A newer edit remains a local draft; reload asks the user to choose again, while a save-as upload opens the submitted snapshot separately and leaves the newer edit in its original tab.
- Transfer recovery is keyed by account and returned Drive file ID. Upload success is not enough to delete the local original; remote readback and validation are required.
- Preview and Inspector audio share an exclusive lease. The Inspector's fallback completion timer uses playback duration in seconds and playback speed, then stops the audio and releases the Preview lock at natural completion. On view disposal, document switch, or host shutdown, listeners and audio resources are released and outstanding operations cannot mutate a newer document revision.
- Untrusted DSL and metadata are rendered through escaped text and constructed SVG attributes. CSP and host-specific Webview security continue to be enforced by the respective adapters.

## Alternatives considered

- **Separate repository or new backend:** rejected by the contract; the SPA and extension share core behavior in one repository and the Web product is static.
- **React/Vue, Monaco, or CodeMirror:** rejected by the contract. A native `textarea` provides the browser's IME, selection, and undo behavior while a separate layer supplies GuitarDSL highlighting.
- **A second compiler, score model, play-order engine, or renderer:** rejected because it would allow the VS Code and Web products to interpret the same source differently.
- **OAuth refresh-token persistence or full Drive scope:** rejected. The browser token model and `drive.file` keep credentials short-lived and access limited to user-authorized content.
- **Automatic bidirectional sync or implicit move:** rejected. Local and Drive identities are distinct; Drive writes and local-to-Drive moves are explicit. Drive preflight detects known version changes, while the accepted GET→PATCH race remains possible across devices.
- **A Node-only shared PDF implementation in browser code:** rejected. The common API exchanges byte arrays and SVG page inputs, while host bundling is verified independently.

## Verification strategy

- Build and unit-test the shared packages independently. Compare representative SVG pages and PDFs from VS Code and Web using the same Japanese, TAB, chord-diagram, and multi-page fixtures.
- Browser tests use mocked IndexedDB and Drive APIs for persistence failures, pagination, scope-limited listing, version conflicts, edits during delayed conflict reload/save-as requests, restored-draft status, account separation and reconnect, interrupted moves, and duplicate retry.
- Required browser gates are independent checks named `web-spa-chromium`, `web-spa-webkit`, and `safari-smoke`. Chromium runs on Linux; Playwright WebKit runs on a macOS runner; `safari-smoke` uses `/usr/bin/safaridriver` and Selenium WebDriver against the installed Apple Safari. All three run for each pull request and are branch-protected. Firefox remains an optional regression project with a separate config and is not required.
- Playwright WebKit and real Safari are separate targets. The WebKit project runs the existing browser E2E suite on macOS. The serialized SafariDriver smoke runner serves the SPA from a local Vite server, records OS/Safari versions and machine-readable results, then checks local IndexedDB create/edit/restore, trusted native textarea Undo/Redo, Preview SVG, Inspector variables/settings, PDF Blob/download invocation, Preview/Inspector audio exclusion, narrow layout and keyboard focus, export after injected storage failure, and mocked Google OAuth/Picker/Drive requests. It uses no live Google credentials or Drive data. SafariDriver's single-session constraint is respected by running the smoke suite sequentially.
- Safari smoke evidence is uploaded as a CI artifact even on failure, including the machine-readable report and failure screenshot when available. An unavailable or disabled SafariDriver fails the required `safari-smoke` job; WebKit and Firefox cannot substitute for it.
- Browser E2E runs in Chromium and WebKit cover local-first startup, editor IME/undo, source and Preview edits, tabs, refresh recovery and restored-draft status, account switching, edits during delayed Drive requests, responsive layout, localization, light/dark theme, accessibility attributes, audio exclusivity and natural lease release, and PDF download.
- Existing extension compile, unit, E2E, VSIX prepublish, package-content, Help, and AI checks protect the current product boundary.
- `python -m agent_workflow validate-docs --issue 166`, `npm run check:help`, `npm run check:ai`, and `git diff --check` validate documentation and derived assets. Browser/OS combinations not actually run remain unverified.
