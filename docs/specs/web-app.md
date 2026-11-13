<!-- agent-doc-type: specification -->
<!-- agent-doc-schema: 2 -->

# GuitarDSL Web application specification

- Status: Current
- Owning Issue: [Issue #166](https://github.com/puchinya/vscode-guitar-dsl/issues/166)
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
- The application MUST open, create, edit, save, list, and delete local GuitarDSL documents in IndexedDB without connecting a Google account. Supported document extensions are `.guitardsl` and `.gdsl`.
- The editable source buffer is the single source of truth for a document. Parsed scores, diagnostics, Preview SVG, Inspector values, playback state, and PDF output are derived from a particular source revision.
- The editor MUST preserve source text outside an explicit edit and support browser-native text input, IME composition, selection, and undo. Syntax highlighting and editing aids MUST NOT replace the underlying source buffer.
- A source edit is one undoable operation. Inspector and Preview edits MUST be expressed as source-preserving changes and applied only when their document identity and expected revision still match the current buffer.
- The application MUST support Japanese and English UI, light and dark themes, keyboard operation, and accessible names and states for interactive controls.

## 3. Score workspace and preview

- On wide layouts, the workspace has a left file list, a central row of document tabs, a central adjustable source/score split, and a right Inspector. The Preview retains the existing normal, edit, and practice modes. The Inspector provides document, variables, score settings, and chord progression tabs.
- Playback controls and score settings remain available in a compact 48 px row. Narrow layouts may collapse the file list and Inspector and MUST provide a way to switch between source editing and the score Preview.
- Score rendering, playback order, timing, source-preserving edits, and other shared GuitarDSL behavior MUST use the same core implementation as the VS Code extension. The Web application MUST NOT introduce a second parser, score model, play-order resolver, timeline, or rendering interpretation.
- Preview and Inspector audio use one exclusive playback lease. Preview playback or practice and Inspector audition MUST NOT play at the same time.
- Closing a tab, switching storage sources, or refreshing the browser MUST preserve recoverable drafts. A storage switch MUST NOT silently change the identity or contents of documents already open in tabs.

## 4. Document identity and persistence

- A document is identified by `{storage, fileId}`. A local document and a Drive document with the same name are different documents.
- Opening a document more than once MUST focus its existing tab rather than create a duplicate. Different document IDs remain separate even when their names match.
- Local source and recoverable drafts MUST persist in IndexedDB. Tab session state needed to restore open documents after refresh MUST also be recoverable without storing credentials.
- A visible saved state may be shown only after the corresponding storage operation succeeds. If IndexedDB is unavailable, the application MUST state that it cannot persist the document and provide a download path; it MUST NOT claim that unsaved text was saved.
- Local import and export MUST remain available when Google authentication, Drive, or network access is unavailable.

## 5. Google Drive

- Drive is optional. Users MUST be able to use local documents without signing in.
- Authentication uses the Google Identity Services browser token model. The access token is held in memory only; the application MUST NOT persist OAuth tokens in IndexedDB, Web Storage, URLs, logs, or source files. The requested Drive scope is `https://www.googleapis.com/auth/drive.file`; the application MUST NOT request a broader Drive scope.
- A deployment supplies a public Web OAuth client ID, a referrer-restricted Google API key, and its Google Cloud project number through Vite `VITE_GOOGLE_CLIENT_ID`, `VITE_GOOGLE_API_KEY`, and `VITE_GOOGLE_APP_ID` settings. No OAuth client secret is used in browser code.
- A user selects a Drive folder through Google Picker or the application creates a `GuitarDSL` folder. The selected folder ID is non-secret local configuration. Changing or disconnecting the account or folder MUST NOT delete open tabs or local drafts.
- Drive listing is limited to application-created files and files the user has explicitly authorized through Picker. The application MUST filter for `.guitardsl` and `.gdsl`, exclude trashed files, and handle pagination. It MUST NOT imply that every existing child of a selected folder is accessible under `drive.file`.
- A user may use Picker to authorize an individual existing file that is not otherwise visible in the application list.
- Drive writes occur only after explicit save or an autosave action the user has configured. A normal save MUST update the same Drive `fileId` and keep the file name by using `files.update` media PATCH. `files.create` is reserved for a new document, explicit Save As, and the first upload during a local-to-Drive move; normal saves MUST NOT create per-save copies.
- Before an update, the app MUST compare the current `version`, `modifiedTime`, and `headRevisionId` with the last-read values. A detected mismatch MUST abort the PATCH, preserve the local draft, and offer reload from Drive, Save As, or cancel. Saves to the same `{accountId, fileId}` MUST be serialized within the app.
- After PATCH, the app MUST read the Drive source back and compare it with the submitted source. The app reports success only after this verification. Edits made while a save is pending MUST remain as a local draft after the submitted version is verified.
- The GET→PATCH sequence is not atomic. A different device can write in that interval and have its changes overwritten. This residual race is explicitly accepted; the app does not claim complete conflict exclusion or zero-loss concurrent editing. Browser ETag visibility is not a save prerequisite, and `If-Match` is not the basis of an atomic guarantee.
- Moving a local document to Drive is an explicit operation. The application first persists the current local buffer, uploads to the selected folder, reads back and verifies the remote document, deletes the local original only after verification, and then updates the open tab identity. Any failure or interruption before successful verification MUST retain the local original. If upload succeeds but local deletion fails, the application reports both copies and retry MUST reconnect to the same Drive file rather than create another.
- A Drive file with an existing name MUST NOT be silently overwritten during a move.

## 6. PDF export

- PDF export downloads a PDF generated from the same score-page SVGs used by the Preview and VS Code extension. Output preserves the common page layout, Japanese text, TAB, chord diagrams, and multiple pages.
- Browser export MUST not require a server. It uses a browser download, and font bytes needed for Japanese output are provided to the PDF renderer without introducing Node-only file APIs into browser code.

## 7. User-visible behavior

### Observable behavior

- After startup without Google authentication, users can create and edit a local document, see diagnostics and score Preview, use the Inspector and playback, retain a draft through refresh, and download a PDF.
- The file list shows the current storage source. Open tabs remain attached to their original `{storage, fileId}` when the list source changes.
- Selecting the same file twice selects the existing tab. Closing a tab retains its local draft and any recoverable Drive draft.
- The Preview and Inspector show derived state for the active document revision. An edit from either surface either applies to that same revision as one source edit or makes no source change and reports that the edit is stale.
- A Drive save reports success only after the remote operation succeeds. Authentication cancellation, unavailable files, version conflicts, and network errors leave local source and drafts available for retry or export.
- If another device saves at nearly the same time, its changes may be overwritten during the accepted GET→PATCH race. The Drive file-list UI and Help state this limitation. Detected preflight conflicts still stop without writing.
- The local-to-Drive move UI reports completion only after remote readback verification and local deletion. On partial failure it reports which copy remains and preserves a retryable identity.
- When local persistence is unavailable, the UI clearly communicates that the current text is not saved and offers download.

## 8. Errors

### Error and boundary behavior

- **IndexedDB unavailable or quota/write failure:** retain the in-memory buffer, do not display a saved state, explain the persistence failure, and provide a download route.
- **Invalid GuitarDSL:** retain the source, show the compiler diagnostics, and render only the valid derived state permitted by the shared compiler contract.
- **Stale Preview or Inspector edit:** reject the entire change set without editing the source and refresh derived UI from the current revision.
- **Authentication cancelled, expired, or unavailable:** retain local tabs and drafts, do not report a Drive save, and allow a user-initiated retry.
- **Drive 401/403/429/5xx, offline, or readback mismatch:** retain source and drafts, report that the save was not confirmed, and never automatically resend the PATCH. For an unknown result, read Drive once to determine the observed remote state; a later retry requires an explicit user action.
- **Drive version mismatch:** perform no overwrite; offer reload from Drive, save the local draft under another name, or cancel.
- **Different-device write between preflight and PATCH:** the app cannot detect this race atomically; the concurrent write may be overwritten as described in §5. Do not describe this behavior as conflict-free or lossless.
- **Account or folder changes:** keep local identity separate from Drive identity and prevent cached documents from another account being shown as the active account's files.
- **Move interrupted or partially completed:** keep the local original until the remote copy has been read back and verified. Repeated retry MUST be idempotent with respect to the already-uploaded remote file.
- **PDF conversion or download failure:** preserve the source and report that no successful export occurred.
- **Audio or worker failure:** stop or release the affected playback lease and leave document source unchanged.

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
- Browser E2E tests cover unauthenticated local create/edit/draft/refresh, multiple tabs, narrow layouts, IME/undo behavior, diagnostics, Preview and Inspector edits, PDF download, and storage switching.
- Mocked Drive tests cover cancelled or expired authentication, account changes, Picker cancellation, missing folders, pagination, unsupported or trashed files, access-limited existing files, upload/readback/delete failures, duplicate transfer requests, same-file update identity, preflight conflicts, save serialization, edits during save, unknown outcomes without automatic resend, and readback mismatches.
- Browser verification MUST include Chromium and Firefox. Any operating system, browser, assistive technology, or live Google account scenario that is not run is reported as NOT RUN.
- Existing VS Code compile, unit, E2E, packaging, and Help/AI gates remain required for shared implementation changes. Visual UI changes require a rendered preview and image evidence attached to Issue #166; concept diagrams and screenshots are identified separately.
