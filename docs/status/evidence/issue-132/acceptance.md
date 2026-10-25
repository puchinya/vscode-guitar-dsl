# Issue #132 統合受入れ記録

Related PR: [#157](https://github.com/puchinya/vscode-guitar-dsl/pull/157) (open for review)

## Scope and decision precedence

This record verifies the completed GUI work owned by Issues #133–#137 and #145. The change set does not restart those implementations or change their approved UI/audio design.

- The #134 contract supersedes the original Preview-only audio ownership statement: progression audition uses the Inspector's local audio runtime, and the Extension Host grants the exclusive lease after Preview stop acknowledgement.
- PR #149 restored Preview's 48 px transport row, 44 px temporary score-settings row, and 42 px Practice row when Practice is on. Preview settings remain temporary and source-safe; detailed comparison and persistent Apply/Cancel remain in Inspector.
- Standard text editor and Extension Host own source edits. Inspector contexts are document/version-bound and a confirmed Apply is one undoable edit.

## Verification environment

- Full `npm test` run finished: 2026-10-25 00:04:52 UTC (2026-10-25 09:04:52 JST).
- Repository `HEAD` at run start: `78f97ee8f2a820dec10e8c6d51ee7ff659540e05` (`main` base); the run used this PR's working-tree changes in `tests/e2e/extension.test.ts` and `docs/status/implementation-status.md`.
- Host: macOS 26.6.2, arm64; Node.js v26.7.0; npm 11.19.0; VS Code 1.143.1.
- `GUITARDSL_E2E_CAPTURE_SCREENSHOTS` was unset for the normal E2E run.

## Related Issue and PR acceptance matrix

All listed Issues and PRs were re-read from GitHub on 2026-10-25. Each PR is merged and closed, and its owning Issue is closed.

| Issue / PR | Specification and design | Existing regression coverage | Representative screen evidence |
|---|---|---|---|
| [#133](https://github.com/puchinya/vscode-guitar-dsl/issues/133) / [PR #138](https://github.com/puchinya/vscode-guitar-dsl/pull/138) | [Extension §4D](../../../specs/extension.md), [Inspector design](../../../design/vscode-editor-experience.md), [empty-state SVG](../../../specs/gui_design/inspector-empty.svg) | Production Inspector hide/reveal, explicit view reuse, no automatic reveal on typing | [dark narrow](../issue-133/inspector-dark-narrow.png), [light wide](../issue-133/inspector-light-wide.png) |
| [#134](https://github.com/puchinya/vscode-guitar-dsl/issues/134) / [PR #139](https://github.com/puchinya/vscode-guitar-dsl/pull/139) | [Extension §§3.17–3.25, 4.8, 4D](../../../specs/extension.md), [progression SVG](../../../specs/gui_design/inspector-progression.svg), [editor experience](../../../design/vscode-editor-experience.md) | ED-01/02 candidate and host-session behavior PASS; ED-08/09/10 audio cases are separately listed under pending conditions below | [EN dark](../issue-134/inspector-en-dark-narrow.png), [EN light](../issue-134/inspector-en-light-narrow.png), [JA dark](../issue-134/inspector-ja-dark-narrow-ja-registered.png), [JA light](../issue-134/inspector-ja-light-narrow-ja-registered-light.png), [EN keyboard](../issue-134/inspector-en-dark-narrow-kbd.png), [JA keyboard](../issue-134/inspector-ja-light-narrow-ja-registered-light-kbd.png) |
| [#135](https://github.com/puchinya/vscode-guitar-dsl/issues/135) / [PR #140](https://github.com/puchinya/vscode-guitar-dsl/pull/140) | [Extension §4B and §4D](../../../specs/extension.md), [score editing design](../../../design/score-editing.md), [capo/playability SVG](../../../specs/gui_design/inspector-capo-playability.svg) | S135-01/06/07/12–17 Settings, stale-context, and Apply regressions PASS; S135-11 audio acknowledgement cases are separately listed below | [EN dark Capo](../issue-135/settings-en-dark-narrow-capo.png), [JA light Beginner](../issue-135/settings-ja-light-narrow-beginner.png) |
| [#136](https://github.com/puchinya/vscode-guitar-dsl/issues/136) / [PR #141](https://github.com/puchinya/vscode-guitar-dsl/pull/141) | [Preview rendering and export design](../../../design/preview-rendering-and-export.md), [Practice SVG](../../../specs/gui_design/preview-practice.svg) | P136 toolbar/focus/transport and Preview/Practice regressions PASS | [EN dark, Practice off](../issue-136/preview-en-dark-600-practice-off-view-open-pr141.png), [JA light, Practice on](../issue-136/preview-ja-light-600-practice-on-view-open-pr141.png) |
| [#137](https://github.com/puchinya/vscode-guitar-dsl/issues/137) / [PR #152](https://github.com/puchinya/vscode-guitar-dsl/pull/152) | [Extension §4C](../../../specs/extension.md), [sidebar SVG](../../../specs/gui_design/sidebar-current-file.svg), [YouTube result SVG](../../../specs/gui_design/youtube-transcription-result.svg) | G137 and active-document-only Sidebar Preview/PDF/GP fallback regressions PASS | [EN dark sidebar, 300 px](../issue-137/sidebar-en-dark-300px.png), [JA light sidebar, 300 px](../issue-137/sidebar-ja-light-300px.png), [fixture result panel](../issue-137/youtube-transcription-result.png) |
| [#145](https://github.com/puchinya/vscode-guitar-dsl/issues/145) / [PR #149](https://github.com/puchinya/vscode-guitar-dsl/pull/149) | [Extension §§4 and 4B–4D](../../../specs/extension.md), [Preview design](../../../design/preview-rendering-and-export.md), [GUI screen specification](../../../specs/gui_design.md) | P145 Preview settings, detail links, stale intent and effective Preview/PDF DSL regressions PASS | [EN dark, 421 px](../issue-145/preview-en-dark-421-score-settings.png), [JA light, temporary settings](../issue-145/preview-ja-light-600-temporary-score-settings-issue145-ja-light.png) |

These images are historical captures from the owning Issues/PRs, not new screenshots of this PR's HEAD. Their dates and original test results remain in the linked status sections. The current approved layouts are represented by the linked `docs/specs/gui_design/` SVGs. The existing set covers narrow and wide layouts, Japanese and English, light and dark themes, and keyboard interaction evidence; no required capture state was missing.

## GUI132-01 integrated E2E

**PASS** — [`GUI132-01`](../../../../tests/e2e/extension.test.ts) ran in the real VS Code Extension Development Host as part of `npm run test:e2e`.

The test opens valid document A, invokes the production CodeLens, selects a candidate and compares A/B without changing document text, version or the pre-existing Undo step, then opens Capo Settings in the same production WebviewView. It sends a saved message from the old progression generation after the Settings context is active, verifies the context, effective Preview DSL, Preview generation and document remain unchanged, cancels Settings, verifies the temporary Preview comparison is restored, confirms no audio lease remains, and verifies Undo still removes only the edit created before the flow. `withWorkbenchSnapshotRestored` and `finally` cleanup restore tabs, editor focus, sidebar visibility, Preview, Practice and temporary document state after success or failure.

## GUI132-02 existing regression run

**PASS with six conditional PENDING cases.** `env -u ELECTRON_RUN_AS_NODE -u NODE_OPTIONS npm run test:e2e` completed with **113 passing, 6 pending**. `test:e2e` also completed `npm run compile:all` successfully. The six pending tests are gated behind `GUITARDSL_E2E_CAPTURE_SCREENSHOTS=1`, so they were not executed or counted as PASS:

- ED-08 Inspector audition and lease release.
- S135-11 opening Settings after the real Inspector Stop acknowledgement.
- S135-11 failed Stop delivery and lease retention.
- S135-11 Stop acknowledgement timeout and lease retention.
- ED-09 Stop while AudioContext resume is pending.
- ED-10 document switch and audio lease release.

The other #133–#137/#145 regressions listed in the matrix completed in the same run. The #134 VoiceOver and Inspector audition reports are user reports recorded by that Issue, not tests newly performed here.

## GUI132-03 screen-evidence audit

**PASS** — representative files exist under `docs/status/evidence/issue-{133,134,135,136,137,145}/`; the matrix links the representative files and the canonical GUI SVGs. The evidence covers the requested locale, theme, narrow-width and keyboard paths through the linked suites and issue captures. Existing images are preserved in place; no screenshot was copied into this record.

## Additional verification

| Check | Result |
|---|---|
| `npm run compile` | PASS |
| `npm run test:unit` | PASS — 1,192 passing |
| `npm run check:help` | PASS |
| `npm run check:ai` | PASS |
| `npm test` | PASS — unit tests and E2E; 113 passing, 6 conditional pending |
| `npm run vscode:prepublish` | PASS |
| `npx @vscode/vsce ls` | PASS — 1,602 package entries; extension output, Help assets and syntaxes included |
| `python3 -m agent_workflow validate-docs --issue 132` | PASS — valid |
| `python3 -m agent_workflow verify-implementation-contract 132` | PASS — comment `6390955390`, SHA-256 `4157657fa0a1b5faa8f34c4a32694ebbf098e51c55e8d9bd315b69f1aa16a0fd`, 14,485 bytes |
| `git diff --check` | PASS |

## Untested and remaining delivery checks

- Windows, Linux, VS Code 1.109.0, VoiceOver, NVDA and physical-speaker playback were **NOT RUN** in this environment.
- Six screenshot/audio E2E cases above remain **PENDING**, not PASS. The test command did not set the documented capture/audio gate.
- The configured Required Check `agent-required-check` and current-HEAD self-review are tracked on [PR #157](https://github.com/puchinya/vscode-guitar-dsl/pull/157). Issue #132 remains open until the PR is reviewed and merged.
