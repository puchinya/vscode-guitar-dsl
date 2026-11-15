<!-- agent-doc-type: design -->
<!-- agent-doc-schema: 2 -->

# GuitarDSL Web application design

- Status: Draft
- Owning Issue: [Issue #166](https://github.com/puchinya/vscode-guitar-dsl/issues/166)
- Related Issues: [Issue #172](https://github.com/puchinya/vscode-guitar-dsl/issues/172), [Issue #174](https://github.com/puchinya/vscode-guitar-dsl/issues/174)
- Related specification: [Web application specification](../specs/web-app.md)
- Related designs: [System architecture](architecture.md), [Language and score processing](language-and-score-processing.md), [Preview, rendering, and export](preview-rendering-and-export.md), [Score editing](score-editing.md), [VS Code editor experience](vscode-editor-experience.md)

## Context and goals

Issue #166 adds a static Web SPA alongside the existing VS Code extension. The Web app shares GuitarDSL processing, score UI, document contracts, and PDF rendering where their behavior is host-independent. Each application remains independently buildable and releasable. The extension keeps its existing VS Code `TextEditor`, commands, activation, Webviews, and VSIX boundary.

The design follows the approved Issue #172 and #174 contracts. It does not add a backend, authentication server, SSR, separate score model, new syntax, or full-Drive scope. The public behavior is owned by the [Web application specification](../specs/web-app.md).

## Requirements traceability

| Requirement | Design owner |
|---|---|
| Static browser SPA and independent extension release | `web/`, root and workspace package manifests, build configuration |
| Vue-only Web UI with one state-transition owner | `web/src/App.vue`, `web/src/controllers/workspaceController.ts`, `web/src/composables/useWorkspace.ts` |
| PWA install, static-asset precache, offline Local use, and explicit safe update | `web/vite.config.ts`, `web/public/`, `web/src/pwa/`, `web/src/components/PwaUpdatePrompt.vue` |
| Shared compiler, score, playback, SVG, and edit planners | `packages/core/` |
| Shared Preview and Inspector UI | `packages/ui/`, with VS Code and Web host adapters |
| Stable document identity, revision checks, and source-preserving changes | `packages/document/` and host-specific document adapters |
| Same SVG page source for Node and browser PDF bytes | `packages/pdf/` and the host-specific PDF export adapters |
| Local documents and recoverable drafts | `web/src/storage/indexedDb.ts` |
| Google token acquisition and Drive file access | `web/src/auth/googleOAuth.ts`, `web/src/storage/googleDrive.ts` |
| Explicit local-to-Drive transfer and recovery | `web/src/storage/fileTransfer.ts` |
| CodeMirror state, source projection, syntax decoration, and deterministic completion | `web/src/editor/sourceEditor.ts`, `web/src/tabs/`, shared compiler/tokenizer APIs |
| Compact workspace grid, display modes, and splitter state | `web/src/layout/`, `web/src/adapters/`, IndexedDB layout preferences |
| Shared compiler diagnostics for editor lint and Problems | `web/src/editor/`, `web/src/layout/`, `packages/core/` |
| Browser layout, tabs, file list, Help, Settings, and context menus | `web/src/tabs/`, `web/src/explorer/`, `web/src/help/`, `web/src/menus/`, `web/src/adapters/` |
| Public interaction and security requirements | [Web application specification](../specs/web-app.md) |

## Architecture

### Product and workspace boundaries

- The repository contains the existing VS Code extension at the root, the browser application in `web/`, and shared workspaces in `packages/{core,ui,document,pdf}/`.
- The root package continues to expose `main: ./out/extension.js`. The extension and Web app have separate build configurations and release artifacts. The Web app is built as static assets with Vite 8, Vue 3, TypeScript, `@vitejs/plugin-vue`, and `vue-tsc`; it uses Single File Components and the Composition API. Vue is confined to `web/`: no Vue code enters shared packages or the VS Code extension. CodeMirror 6 remains a Web-only editing component and does not replace the VS Code TextEditor. Router, Pinia, and SSR are not introduced.
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

- `web/src/main.ts` imports the shared styles, creates the single `WebWorkspaceController`, mounts `App.vue`, and starts the controller after Vue has mounted its hosts. The runtime registers production PWA support. `main.ts` contains no application state, DOM renderer, event router, or storage logic.
- `web/src/controllers/workspaceController.ts` exposes the only Vue-facing `WebWorkspaceController` service and owns its startup/disposal lifecycle. It lazily loads `web/src/workspaceRuntime.ts` after Vue has mounted the leaf hosts; that private implementation is the sole owner of `AppState`, `OpenTab`, editable source/revision, document identity, tab selection, draft and Drive save queues, Drive account/generation, appData sync, and exclusive Inspector/Preview audio lease transitions. The service exposes the fixed `snapshot()`, `subscribe()`, `dispatch()`, `prepareForReload()`, and `dispose()` API. Commands are discriminated unions; async work captures full document identity, expected revision, and session generation and revalidates them before applying a result.
- `web/src/composables/useWorkspace.ts` subscribes to the controller and exposes only `shallowRef<Readonly<WorkspaceViewSnapshot>>` to Vue. It unsubscribes during unmount. `EditorView`, `AudioContext`, `GoogleDriveApi`, and `OpenTab` are never made reactive. State transitions follow controller mutation → snapshot emission → Vue render; Vue watchers and effects do not initiate source edits, saves, or Drive synchronization.
- `web/src/App.vue` and the workspace SFCs own the shell, Explorer, tabs, menus, Problems, and panels. They render read-only snapshots and dispatch typed commands; Vue and legacy imperative renderers never own the same DOM subtree.
- `web/src/editor/sourceEditor.ts` owns the CodeMirror 6 surface hosted once by `SourceEditorHost.vue`. The controller remains the sole source/revision authority; each open tab retains its CodeMirror `EditorState` (including selection and history) and scroll position. Tab changes call `setDocument(key, source)` on the existing `SourceEditorSurface`; Vue `v-model` never duplicates the source. View and splitter changes do not recreate the `EditorView` or tab state.
- CodeMirror's rendered document uses LF line breaks for editing. The adapter maps transactions back through the existing `preserveLineEndings` rules so untouched CRLF and CR spans remain unchanged. IME composition is not flushed, completed, or replaced before the browser commits it.
- Human input, search/replace, deterministic completion, and a planner-produced Preview or Inspector change set each apply as one CodeMirror transaction and one undo step. Only committed human edits advance the source revision, write an IndexedDB draft, and trigger derived-state recomputation. View-mode changes do not create source transactions.
- Syntax highlighting is built from source ranges produced by the existing tokenizer and attached as CodeMirror decorations. It does not generate HTML and does not add another GuitarDSL parser. Completion uses local metadata fields, line prefixes, variable references, and syntactically safe constructs; it makes no model or network call.
- CodeMirror lint maps only the shared `ParsedScore.diagnostics` values to editor ranges. The Problems tool window presents that same ordered diagnostic collection. It does not parse or validate DSL independently.
- `web/src/explorer/explorerController.ts` is a headless data/action controller. Vue `ExplorerPane.vue` renders independently collapsible Local and Drive roots; `DocumentTabs.vue` renders tab identity and active selection from the controller snapshot. Complete `{storage,fileId}` identity and Drive account ID, never filename alone, select a tab. `WorkspaceShell.vue` preserves the left Activity Bar, Explorer, 36 px tab row, source/Preview split, right Inspector, Problems pane, and four contracted splitters. Narrow layouts collapse side regions without overwriting manual saved state.
- `MenuLayer.vue`, `ProblemsPane.vue`, and the workspace components render File/Edit/View and context menus, diagnostics, and panel controls. Explorer retains New Score, Drive file/folder Picker, and explicitly confirmed folder creation. The Inspector leaf host retains shared imperative markup for variables, settings, and progression; Vue does not redraw inside that host. Zero diagnostic counts produce no badge. `web-layout-v1` remains separate from Drive appData preferences. Approved icon paths stay in `web/src/icons.ts`, and shell colors never style the score iframe.
- `WorkspaceShell.vue` owns CSS Grid presentation for Source/Split/Score and the four splitter affordances; the controller persists the existing `web-layout-v1` record with panel state, dimensions, center ratio, and view mode. Width-driven collapse stays transient. Pointer capture, double-click reset, keyboard movement, and pointer cancellation remain scoped to one separator.
- An effective viewport fallback collapses Inspector before Explorer and keeps the main grid overflow-free. User-controlled open/close state remains separate from this computed collapse. Four separators own Explorer width, center split, Inspector width, and Problems height; pointer capture, double-click reset, keyboard moves, and pointer cancellation are scoped to one separator.
- The workspace host owns menus for Explorer roots/files, tabs, Problems, Preview, and the line-number gutter. Local file deletion confirms before removing a document; Drive root actions stay scoped to the active account/folder. The source text surface keeps the browser's native editing context menu. Preview includes parser-owned source bindings only while Edit mode is active; the source-position context action is disabled in Normal and Practice modes. A menu captures document identity/revision and Drive account; Preview messages also carry the clicked binding ID and render identity, all of which the host revalidates when an action runs. An invalidated target is discarded without applying an action.
- Edit-menu Cut and Paste retain a snapshot of the active tab, full identity, revision, selection, source, and composition status while awaiting Clipboard API promises. The editor checks that snapshot and its own CodeMirror state before dispatching a transaction. A changed target or active composition produces no edit; successful Cut/Paste uses one undo transaction.
- Tab close handlers operate on the tab object and re-read its index immediately before removal after asynchronous draft writes. Repeated close requests for the same tab are coalesced. Document opening rechecks identity after IndexedDB work and before insertion so concurrent opens resolve to one tab.
- `HeaderBar.vue` and `MenuLayer.vue` provide local bilingual Help, theme/language Settings, layout reset, Save/PDF, Google account controls, and File/Edit/View menus. Help/Settings remain independent of Preview's normal/edit/practice state. Escape and close restore focus to the invoking header button.
- `web/src/adapters/` translates browser events and host capabilities into the shared UI and document contracts. Shared UI does not import storage adapters. Leaf hosts mount and dispose the shared imperative Inspector renderer exactly once.
- `web/src/storage/` contains the IndexedDB adapter, Drive API adapter, appData state adapter, and transfer coordinator. `web/src/auth/` wraps user-initiated Google Identity Services token requests. Drive app state is owned by appData; local documents, drafts, and per-device layout remain in IndexedDB.
- `web/src/pdfExporter.ts` selects browser font bytes, calls the shared PDF byte API, then starts a Blob download. It does not call Node APIs.

### PWA assets and safe update lifecycle

- Vite uses `base: '/'` and `vite-plugin-pwa` 2.x with Workbox `generateSW` and `registerType: 'prompt'`. The manifest uses root `id`, `start_url`, and `scope`, `display: 'standalone'`, GuitarDSL names/colors, and generated 192 px, 512 px, maskable 512 px, and Apple touch icons derived from the existing sidebar SVG. Development-server runs do not register a service worker.
- The generated service worker precaches only same-origin production build output, including HTML, eager and lazy JavaScript/CSS, SVG assets, PWA icons, and the PDF font files. `navigateFallback` targets `/index.html`, `maximumFileSizeToCacheInBytes` is 8 MiB, `runtimeCaching` is empty, and `skipWaiting` / `clientsClaim` are false. Precache size and included assets are recorded during release verification.
- The service worker never intercepts Google Identity Services, Google Picker, OAuth, Drive/API, or other external requests. It does not cache authorization data, GuitarDSL source, IndexedDB content, PDF Blobs, or API responses. Local document durability stays exclusively in IndexedDB; an offline Drive draft remains local and visibly unsynchronized.
- A waiting worker is exposed through `PwaUpdatePrompt.vue` as explicit **Update** and **Later** choices. No automatic activation or forced reload occurs. On **Update**, the controller synchronously acquires an exclusive preparation gate before its first `await`, makes the application inert, and rejects new commands. It captures each open document's identity/source/revision, flushes completed editor transactions and pending local drafts, then drains pending appData work. After each await and again immediately before `SKIP_WAITING`, it verifies the captured document state, no active IME/editor publication, completed IndexedDB draft writes, and idle Drive/appData operations and queues. A failed check leaves the worker waiting, releases the gate, and restores interaction. The gate remains held through activation/reload; activation failure also releases it. Preview and Inspector audio stop before activation. The prompt explains that CodeMirror undo history may not survive reload.
- `App.vue` distinguishes a BFCache transition from page exit. For `pagehide.persisted === true`, a typed lifecycle command keeps the controller, EditorView, DOM ownership, and listeners alive, marks the workspace temporarily inert, and stops both Preview playback (through its existing audio lease protocol) and Inspector audition. `pageshow.persisted === true` reuses the same runtime, revalidates the active document/revision, refreshes workspace layout/snapshot, and restores interaction without replaying audio. A non-persisted `pagehide` or component unmount disposes once. `pagehide` starts no local persistence or network write.
- Reload, pagehide, and worker cache cleanup never delete IndexedDB. The service worker is origin-scoped, so development and production hostnames maintain separate registrations and caches. A macOS Dock installation and Safari tab may have separate site data; the app does not promise automatic migration or synchronization between them.

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
- CodeMirror stores tab-local undo history and view state, while `OpenTab.source` and the host's source-preserving transaction remain the authoritative document. Before a synchronous redraw or document switch, the host flushes any completed pending CodeMirror transaction using the editor's captured document key. A stale external change set is rejected by the same identity/revision check before it reaches CodeMirror or the document buffer.
- Before a save or PDF snapshot, the host synchronously flushes the active editor into its owning `OpenTab`; if IME composition is active, the action stops and asks the user to finish composing. The `beforeunload` guard reads pending editor publication/composition state synchronously alongside per-tab persistence state, without starting asynchronous writes.
- The browser session stores open-tab identity and recoverable drafts in IndexedDB. Draft persistence and user-visible saved state are updated only after IndexedDB confirms the write.
- Layout preferences use a separate IndexedDB key so resizing or changing display mode cannot advance a source revision, alter Drive metadata, or mark a document saved. Preference writes are debounced; invalid fields fall back to the corresponding default.
- Local documents and Drive documents remain separate identities even when names match. Explorer renders both independently collapsible storage roots and their own lists at the same time; selecting a root does not hide the other tree or change open-tab identity.
- The Drive adapter keeps account-scoped metadata and open-tab sessions separate and uses only explicitly authorized files. Switching or disconnecting accounts retains each account's open tabs and drafts; Drive writes are enabled only when the connected account owns the active Drive tab. OAuth access tokens remain in memory. The selected folder ID is configuration, not a credential.
- Opening a restored document compares its current source and revision with the last committed record. A recovered draft is shown as a local draft until a successful local or Drive commit advances that saved baseline.
- A normal Drive save updates the existing `fileId` with media PATCH. Before the PATCH, the adapter compares `version`, `modifiedTime`, and `headRevisionId` with the last-read values; a mismatch returns without writing. Saves are serialized by `{accountId, fileId}` in this app instance. After PATCH, the host reads the source back before committing the remote baseline. A network-unknown PATCH is reconciled with one readback; an unresolved result or HTTP 401/403/429/5xx keeps the draft and is never automatically resent.
- A live Google OAuth/Drive test on 2026-11-14 could not read ETag from metadata or `alt=media`, so the probe did not send `If-Match`. This does not block normal saves: the app does not treat ETag as the concurrency guarantee. GET→PATCH remains non-atomic, and another device's write in that interval may be overwritten. This residual race is accepted by the Issue #166 Architecture Decision Addendum (`6860479905`) and is disclosed in the Drive UI and Help.

### Drive appData state protocol

The `drive.file` scope continues to cover score files opened through Picker or created by GuitarDSL. The additional `drive.appdata` scope is isolated to one hidden `guitardsl-state-v1.json` per account. `DriveAppDataStore` owns discovery, validation, and updates; it never stores source text or credentials. Its exact schema is `{schemaVersion:1, selectedFolderId:string|null, folderPrompt:'unasked'|'deferred'|'completed', openDriveFileIds:string[], activeDriveFileId:string|null, recentDriveFileIds:string[]}`. Open and recent arrays are deduplicated and capped at 30 and 50.

Discovery paginates `files.list` with `spaces=appDataFolder`, `trashed=false`, an exact state-file name query, and a MIME check. Existing candidates are sorted by oldest `createdTime`, then lexical ID; duplicates cause a warning and are retained. A missing file is created once under appDataFolder. An uncertain create result gets one re-list/read; the client never blindly repeats POST. Subsequent updates target that same file ID through media PATCH and are accepted only after readback matches the submitted JSON.

Before PATCH, the adapter re-reads metadata and compares `version` and `modifiedTime` to the loaded baseline. A mismatch yields a conflict without writing. The UI offers remote reload or explicit local preference; choosing local preference reloads a fresh baseline before one best-effort PATCH. GET→PATCH is non-atomic, so the UI discloses the remaining cross-device race. An uncertain PATCH gets one readback only and is never automatically resent. Malformed JSON, unknown versions, permission failures, offline state, and unknown outcomes never trigger replacement-file creation.

The sync controller captures account ID, Drive instance, and generation at every operation boundary. It loads remote state before one-time migration of `drive-folder:<accountId>` and `workspace-drive:<accountId>` settings or Drive-tab restoration. Before applying a metadata change to local UI, it stores a schema-validated pending record in IndexedDB under the owning account key. The record contains only appData references and sync metadata, never source, drafts, local document IDs, credentials, or email. On reconnect, pending metadata is compared with remote state and a user choice is required when they differ. Remote choice validates the folder, restores matching Explorer and Drive tab state, preserves local drafts, and clears pending only after the selected state is applied. Local choice updates from the loaded remote baseline; a pending record clears only after matching readback. Errors and offline state retain the record, `beforeunload` warns, and `pagehide` starts no network write. Folder, open-tab, active-tab, and recent-list changes debounce for roughly one second and serialize per account.

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
| Drive settings and open/recent references | One account-scoped appData JSON file | Explorer folder selection, restored Drive tabs |
| OAuth access token | In-memory auth adapter | Authorized Drive requests only |
| PDF bytes | `packages/pdf` | VS Code save adapter or browser Blob download |
| Vue view state | `WorkspaceViewSnapshot` emitted by `WebWorkspaceController` | SFC rendering through `useWorkspace()` |
| Production static-asset cache | Same-origin service-worker precache | Offline app shell and bundled PDF resources; never user or remote data |

The local source buffer is the only editable source. A Drive-backed tab also keeps a recoverable local draft, while remote version metadata remains separate from that draft. A verified save advances the remote version only after readback matches the submitted source. A failed or unresolved write leaves the local draft available; an unresolved result does not silently advance the known remote baseline.

## Failure handling

- `closeTab` coalesces same-tab requests in an in-flight `WeakMap<OpenTab, Promise<void>>`. Each caller awaits the same operation through draft persistence, tab removal, and session persistence, so a remote restore cannot mistake an unfinished user close for a completed one.
- Google OAuth accepts a token only when both requested scopes are present in the GIS `TokenResponse.scope` and `hasGrantedAllScopes` accepts them when that helper is available. Partial consent clears auth state and presents an explicit reapproval error before `/about` or appData requests.
- When appData sync is pending or failed, disconnect waits for the account-keyed pending write to settle and asks for confirmation. Confirmed disconnect clears the in-memory auth/session binding while retaining the IndexedDB pending record and local drafts for account-specific reconciliation on reconnect.
- Compiler, renderer, planner, and PDF failures stay typed at their owning package boundary; they are not converted into successful empty output.
- IndexedDB errors do not clear the in-memory source. The UI reports unsaved state and enables file download.
- Each Drive open captures its account ID and `GoogleDriveApi` instance. A multi-request `getFile` read also pins its access token across metadata and media requests, so an account reconnect cannot switch credentials halfway through that read. Picker, Drive-read, conflict-dialog, and IndexedDB continuations recheck the captured session before starting writes and before changing tabs or Explorer state; a result from an ended session is discarded. Account-scoped keys always use the captured account ID.
- The editor compares each tab's current revision/source with its last successfully persisted draft and tracks queued writes. `beforeunload` requests the browser's native confirmation while a revision is pending or failed; it starts no asynchronous IndexedDB work. A persisted BFCache `pagehide` stops playback without destroying the editor/controller, and the matching `pageshow` restores interaction against the same in-memory source identity/revision. A non-persisted page exit disposes playback/runtime resources once; neither path starts asynchronous writes.
- A stale change set or mismatched document ID is rejected before applying any source edit. One rejected operation cannot partially modify the document.
- Drive authentication, permission, rate-limit, network, and server failures retain local source and drafts. A PATCH 401 marks authorization expired and changes the Connect action to explicit Reconnect; after reauthentication the user checks Drive before retrying. A PATCH 403 remains a permission error and does not start an authentication loop. Neither status triggers an automatic PATCH resend.
- AppData discovery and parsing failures retain the pending state and do not create a replacement file. Unknown schema versions, malformed JSON, duplicates, version conflicts, and uncertain writes are surfaced independently. One uncertain create/update is followed by at most one list/read reconciliation; no automatic POST/PATCH retry occurs.
- An observed Drive version conflict offers reload, save as a separate file, or cancel and sends no PATCH. A concurrent update after preflight is an accepted residual race; the UI and Help disclose that another device's nearly simultaneous write may be overwritten.
- A network failure or malformed PATCH response is followed by one Drive readback. If that readback matches the submitted source, the write is verified; otherwise the app keeps the draft, reports an unconfirmed outcome, and does not retry automatically. HTTP 401/403/429/5xx also keep the draft and never trigger an automatic write retry.
- Conflict reload and save-as capture the tab identity, source, and revision before their asynchronous Drive requests. Before applying a response, the host checks that the same tab still has that snapshot. A newer edit remains a local draft; reload asks the user to choose again, while a save-as upload opens the submitted snapshot separately and leaves the newer edit in its original tab.
- Transfer recovery is keyed by account and returned Drive file ID. Upload success is not enough to delete the local original; remote readback and validation are required.
- Preview and Inspector audio share an exclusive lease. The Inspector's fallback completion timer uses playback duration in seconds and playback speed, then stops the audio and releases the Preview lock at natural completion. On view disposal, document switch, or host shutdown, listeners and audio resources are released and outstanding operations cannot mutate a newer document revision.
- Untrusted DSL and metadata are rendered through escaped text and constructed SVG attributes. CSP and host-specific Webview security continue to be enforced by the respective adapters.
- Workspace mode changes and resize events update CSS grid tracks and the existing Preview viewport. They do not recreate the Preview iframe or reset its scroll, playback state, editor history, source revision, draft, audio lease, Drive identity, or audio resources.
- A Problems row opens its source document and reveals the exact compiler range from the shared diagnostic. Reopening or switching documents resolves the current tab identity before focus; a diagnostic cannot target a previous document merely because the file name matches.

## Alternatives considered

- **Separate repository or new backend:** rejected by the contract; the SPA and extension share core behavior in one repository and the Web product is static.
- **Vue 3 in the Web app:** accepted by Issue #174 to give the Web shell and panels explicit SFC ownership while retaining one imperative state-transition owner. Vue stays out of shared packages and the VS Code extension; Router, Pinia, and SSR remain unnecessary.
- **CodeMirror 6:** accepted for the Web editor in Issue #172. Its transaction/history model supplies tab-local undo, editing commands, search, completion, lint and keyboard behavior while the existing document buffer and revision checks remain authoritative. It is not introduced into the VS Code TextEditor.
- **Custom `contenteditable` or a second textarea/highlight overlay:** rejected because it would duplicate native editing, selection, IME, history, and accessibility behavior that the established editor extension already provides.
- **A second compiler, score model, play-order engine, or renderer:** rejected because it would allow the VS Code and Web products to interpret the same source differently.
- **OAuth refresh-token persistence or full Drive scope:** rejected. The browser token model keeps tokens short-lived; `drive.file` covers user-authorized score files and `drive.appdata` covers only GuitarDSL application state.
- **Automatic bidirectional sync or implicit move:** rejected. Local and Drive identities are distinct; Drive writes and local-to-Drive moves are explicit. Drive preflight detects known version changes, while the accepted GET→PATCH race remains possible across devices.
- **A Node-only shared PDF implementation in browser code:** rejected. The common API exchanges byte arrays and SVG page inputs, while host bundling is verified independently.

## Verification strategy

- Build and unit-test the shared packages independently. Compare representative SVG pages and PDFs from VS Code and Web using the same Japanese, TAB, chord-diagram, and multi-page fixtures.
- Browser tests use mocked IndexedDB and Drive APIs for persistence failures, pagination, scope-limited listing, version conflicts, edits during delayed conflict reload/save-as requests, restored-draft status, account separation and reconnect, interrupted moves, and duplicate retry.
- Unit tests cover line-ending preservation, one-edit/one-undo transactions, tab-local EditorState, deterministic completions, tokenizer range mapping, diagnostic range conversion, layout validation/migration, splitter clamping and cancellation, and stale context-menu identities.
- Browser E2E tests cover Source/Split/Score modes, four splitter geometries and keyboard operations, temporary narrow-width collapse, preferences after reload, Problems/lint parity and source navigation, Help/Settings focus return, and mouse/keyboard context-menu paths. Visual acceptance records screenshots and DOM rectangles at both contracted viewport sizes.
- Required browser gates are independent checks named `web-spa-chromium`, `web-spa-webkit`, and `safari-smoke`. Chromium runs on Linux; Playwright WebKit runs on a macOS runner; `safari-smoke` uses `/usr/bin/safaridriver` and Selenium WebDriver against the installed Apple Safari. All three run for each pull request and are branch-protected. Firefox remains an optional regression project with a separate config and is not required.
- Playwright WebKit and real Safari are separate targets. The WebKit project runs the browser E2E suite on macOS and exercises native editor Undo/Redo on every pull request. The serialized SafariDriver smoke runner serves the SPA from a local Vite server and records OS/Safari versions and machine-readable results. It checks local IndexedDB create/edit/draft/refresh/restore, trusted native text input, Preview SVG, Inspector variables/settings, PDF Blob signature/page count and download-anchor invocation, Preview/Inspector audio exclusion, narrow layout and keyboard focus, export after injected storage failure, and mocked Google OAuth/Picker/Drive requests. The SafariDriver smoke excludes native Undo/Redo and OS file persistence, and never changes the ordinary Downloads directory; its report records those checks as NOT RUN. WebKit's native Undo/Redo E2E and SafariDriver's PDF Blob checks are the acceptance gates; separate normal-window Safari evidence is not required. The SafariDriver suite uses no live Google credentials or Drive data and runs sequentially because the driver supports one session at a time. The parent supervisor applies an absolute runner deadline independently of a rolling per-WebDriver-command deadline and records `SAFARI_RUNNER_TIMEOUT` or `WEBDRIVER_HANG` with OS/Safari versions.
- Safari smoke evidence is uploaded as a CI artifact even on failure, including the machine-readable report and failure screenshot when available. An unavailable or disabled SafariDriver fails the required `safari-smoke` job; WebKit and Firefox cannot substitute for it.
- Browser E2E runs in Chromium and WebKit cover local-first startup, editor IME/undo, source and Preview edits, tabs, refresh recovery and restored-draft status, account switching, edits during delayed Drive requests, responsive layout, localization, light/dark theme, accessibility attributes, audio exclusivity and natural lease release, and PDF download.
- Production-build PWA E2E first fetches the deployed asset manifest online, then starts a fresh context offline and verifies Local create/edit/restore, Preview, PDF `%PDF-` signature and page count, Japanese font precache, and lazy PDF chunk availability. It asserts that external APIs, authorization, document source, IndexedDB, and PDF Blob data never enter Cache Storage, and that Drive actions report offline availability.
- Update E2E installs a waiting worker while edits, IME composition, draft writes, Drive saves, or appData work are pending. It verifies an exclusive gate blocks new source edits and Drive commands from the first await through activation, rechecks source identity/revision and all persistence/Drive/appData conditions immediately before activation, keeps the worker waiting when unsafe, releases the gate after a failed check, and restores IndexedDB drafts after a successful reload.
- BFCache E2E dispatches persisted `pagehide`/`pageshow`, verifies Preview and Inspector audio stop without disposing the EditorView/controller/DOM owners, then edits and opens menus after resume without autoplay. Chromium also attempts a real back/forward BFCache traversal; if the browser does not restore from BFCache, that case is reported as skipped and is not counted as a pass.
- Existing extension compile, unit, E2E, VSIX prepublish, package-content, Help, and AI checks protect the current product boundary.
- `python -m agent_workflow validate-docs --issue 166`, `npm run check:help`, `npm run check:ai`, and `git diff --check` validate documentation and derived assets. Browser/OS combinations not actually run remain unverified.

## Cloudflare Workers Static Assets release and environment isolation

The Web SPA remains a browser-only static Vite artifact (`web/dist/`), without a Worker request handler, application backend, SSR, or Cloudflare Pages. The VS Code extension packaging/release, host adapter, shared core/score/PDF packages, IndexedDB, and Google Drive browser access are unchanged.

**Single Worker ownership:** the preexisting Cloudflare Worker `guitardsl` owns the production deployment and custom domain `guitardsl.app`. `wrangler.jsonc` keeps that name and domain, enables custom-domain Previews (`previews_enabled: true`, with production remaining enabled), configures static assets and SPA fallback, and declares an empty `previews` block. GitHub Actions publishes the named Preview `dev` on every `main` push; its stable URL is `dev.guitardsl.app`. The Preview uses a separate version and never replaces production. A second `guitardsl-dev` Worker is deliberately not created.

**Release gate:** `.github/workflows/cloudflare-workers.yml` is the sole automated deploy owner. The development job runs `wrangler preview --name dev` on `main`; the production job runs `wrangler deploy` only for tags whose checked-out commit is reachable from freshly fetched `origin/main`. Full history and ancestry validation include annotated/lightweight tags, fail before upload for off-main tags, and allow intentional releases of older ancestor commits. PRs do not deploy; obsolete development jobs may cancel; production releases may not.

**Build and security:** both jobs use Node 22, root lockfile `npm ci`, `npm run build:web` and `web/dist/index.html` validation. Wrangler 4.160.0 or newer supports Workers Previews. GitHub `development` and `production` environments isolate the optional public Vite build inputs (`VITE_GOOGLE_CLIENT_ID`, `VITE_GOOGLE_API_KEY`, `VITE_GOOGLE_APP_ID`); no client secrets or access tokens are compiled or uploaded. Cloudflare deployment token requires account Workers Edit and zone Workers Routes Write when domain configuration is managed.

**Operational invariants:** existing production Worker version is not overwritten while configuring Preview. The custom domain `guitardsl.app` stays routable for production. The `dev.guitardsl.app` hostname must not have conflicting Pages DNS or an older explicitly bound Worker domain; Cloudflare Preview routing handles its alias using the apex domain configuration and wildcard DNS/certificate. Experimental Pages projects may be removed only after confirming no deployments/data. Unrelated email MX/TXT records are preserved. Actual Preview deployment and browser OAuth/domain smoke tests are required before declaring success. Workers Builds/Git-connected auto deploy is not used.
