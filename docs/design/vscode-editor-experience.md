<!-- agent-doc-type: design -->
<!-- agent-doc-schema: 2 -->

# VS Code エディター体験設計 (VS Code Editor Experience)

- Status: Draft
- Owning Issue: [Issue #118](https://github.com/puchinya/vscode-guitar-dsl/issues/118)
- Related Issue: [Issue #133](https://github.com/puchinya/vscode-guitar-dsl/issues/133)
- Related Issue: [Issue #134](https://github.com/puchinya/vscode-guitar-dsl/issues/134)
- Related Issue: [Issue #87](https://github.com/puchinya/vscode-guitar-dsl/issues/87)
- Related Issue: [Issue #135](https://github.com/puchinya/vscode-guitar-dsl/issues/135)
- Related Issue: [Issue #136](https://github.com/puchinya/vscode-guitar-dsl/issues/136)
- Related Issue: [Issue #137](https://github.com/puchinya/vscode-guitar-dsl/issues/137)
- Related Issue: [Issue #145](https://github.com/puchinya/vscode-guitar-dsl/issues/145)
- Related Issue: [Issue #158](https://github.com/puchinya/vscode-guitar-dsl/issues/158)
- Related specification: [Extension specification](../specs/extension.md), [GuitarDSL syntax specification](../specs/guitardsl-syntax.md)
- System context: [Architecture](architecture.md)

## Context and goals

VS Code 上で GuitarDSL を識別・編集・診断・プレビューするホスト統合を記録する。言語ルールやユーザー向けのコマンド契約は各仕様が所有し、本書は extension manifest / providers / UI / Help の内部境界を説明する。

## Requirements traceability

| 仕様上の要件 | 対象 |
|---|---|
| 言語ID、拡張子、language configuration、TextMate grammar | 拡張機能仕様 §2 |
| コマンドと設定 | 拡張機能仕様 §3 |
| Issue #137 のナビゲーション導線、Sidebar、Outline、診断 | Issue #137、拡張機能仕様 §4C、§5、§5A |
| 共通 Inspector の登録、表示、文書・進行・設定コンテキスト | Issue #133–#135、拡張機能仕様 §3.9、§3.25、§4B、§4D |
| Preview の一時楽譜設定と Inspector への導線 | Issue #145、拡張機能仕様 §4.2、§4.4、§4.5、§4D |
| ロケール、Help と仕様同期 | 拡張機能仕様 §6–§7 |
| Code Actions、editor Hint、Quick Fix の登録と文書編集境界 | Issue #87、拡張機能仕様 §5A–§5B、§6.3 |
| コード進行補完と assistant コマンド | Issue #129、拡張機能仕様 §3.17、§4.8 |
| public language rules and examples | 言語構文仕様 §1–§18 |

## Architecture

- `package.json` が VS Code の言語・コマンド・設定・表示の貢献を宣言し、`language-configuration.json` と `syntaxes/guitardsl.tmLanguage.json` が編集補助と TextMate grammar を提供する。
- `src/extension.ts` はコマンド登録、文書イベント購読、Document resolver、Preview Panel 等を束ねる。Compiler 診断は `DiagnosticCollection` に反映される。Outline は `src/symbols.ts` の `DocumentSymbolProvider` が提供する。
- サイドバーと初回利用導線は `src/sidebar.ts` / `src/onboarding.ts`、Help のローカル表示は `src/help.ts` と生成済み `media/help/` が担う。Help は仕様・package metadata 由来の生成物であり、仕様の正本ではない。
- 共通 Inspector は `src/inspector/inspectorController.ts` が URI/version 付きの現在コンテキストと明示表示を管理し、`src/inspector/inspectorView.ts` が単一の `WebviewViewProvider` を登録する。HTML builder は `src/render/inspectorHtml.ts` にあり、空状態・文書・progression・settings を単一 View に描画する。progression / settings の状態と編集権限は各ホスト controller が所有し、Inspector controller は最新 snapshot を投影する。
- ローカライズは `src/i18n.ts` と VS Code の `package.nls*.json` / Webview locale message を通じて拡張機能ホストと UI に提供する。

### Preview score settings (Issue #145)

`src/render/previewHtml.ts` renders a fixed 44 px score-settings row immediately below the 48 px playback row. Capo, colored Playability, and Beginner remain directly operable at 421 / 600 / 840 / 1100 CSS px; from 840 px the row also shows barre policy, automatic/fixed capo, and Inspector detail links. Narrower widths expose those supplemental actions through accessible overflow. Practice contributes a separate 42 px row only while enabled. The visible text “Temporary Score Settings” is never rendered. Host-computed capo and Beginner models remain the sole source of state, and Playability color is paired with the numeric score and localized level. Typed actions include the rendered URI/version/generation. `src/extension.ts` checks identity, value shape, and candidate support before using the existing Preview controllers; an unsupported or malformed action returns before invalidating an Inspector draft, mutating a Preview override, or discarding pending focus restoration. Accepted Preview changes invalidate any competing Inspector settings draft. The Inspector remains the detailed settings and source-Apply surface. JA/EN labels belong to `src/i18n.ts`; user-facing help remains derived from the extension specification and is synchronized through `docs/help/help-manifest.json`.

### Navigation と初回利用

`GuitarDslSidebarProvider` は TreeDataProvider で、項目を section / command / hint として返す。command 項目は既存の command ID と引数に委譲する。Current File はアクティブな GuitarDSL TextEditor だけを指し、他の開いた文書へ暗黙に切り替えない。Editor / document open / close イベントで更新し、polling は行わない。

テンプレートは小さな `STARTER_TEMPLATES` から、新しいサンプルは extension 配下の `samples/` から読み、成功してから無題 GuitarDSL TextDocument を開く。失敗時は文書を作らず、各コマンドが捕捉してローカライズ済みメッセージを一度表示する。VSIX へ同梱するサンプルは curated list と `.vscodeignore` の allowlist が一致する。

### Common Inspector

`guitardslInspector` Secondary Sidebar container は `guitardsl.inspector` Webview View を 1 つだけ持つ。明示的な `guitardsl.openInspector` は現在アクティブな GuitarDSL TextEditor だけを使い、該当文書がなければ空状態を表示する。通常の編集・選択移動・文書切替・extension activation は View を表示しない。ホスト Controller は `{kind:'empty'} | {kind:'document'; uri; version} | {kind:'progression'; uri; version; sessionGeneration; ...} | {kind:'settings'; uri; version; sessionGeneration; revision; activeSection; model}` の現在 snapshot を一つ所有し、切替・close 時に古い URI/version/session を無効化する。進行 CodeLens と楽譜設定コマンドはそれぞれの明示操作で Inspector を表示する。設定コマンドは §3.9 の解決済み URI を View reveal 前に渡す。非表示中は DOM 更新メッセージを送らず、状態変更ごとに generation を進める。View が再表示されたら最新 snapshot で HTML を作り直す。Webview は message listener を登録してから `ready` を送り、ホストは最新 snapshot を新しい generation で再送するため、非表示中または DOM 再生成中に失われたメッセージへ依存しない。古い generation のメッセージは拒否する。ユーザーが移動した View をコードから移動し直さない。

Inspector はソースや Undo を所有しない。進行候補と設定の一時選択および Apply 操作を表示するが、適用時の再検証と単一 WorkspaceEdit は Extension Host が行う。通常再生と Practice は Preview Panel が所有し、コード進行の明示試聴は Inspector 内の一時 AudioContext / scheduler が行う。Extension Host は Preview の停止確認と排他 lease を調停し、同時再生を防ぐ。設定表示は host-owned models と操作 ID を使い、Webview が DSL や変換計画を生成しない。Webview は nonce 付き strict CSP、VS Code theme token、1 列 responsive layout、ARIA 状態表示を使い、外部 resource を読み込まない。

### Help とローカライズ

Help の編集元は `docs/help/{ja,en}/`、拡張機能に同梱する生成物は `media/help/` である。`openGuitarDslHelp()` はロケールを解決し、同梱 Markdown を存在確認したうえで VS Code 組み込みの `markdown.showPreviewToSide` を開く。Help 専用 Webview / CSP / script bridge は持たず、ネットワーク URL へ fallback しない。生成 manifest は各 Help page が参照する仕様 section とレビュー済み digest を結び付ける。

ロケールは extension host と Webview の message bundle で共有する。パッケージ contribution、host message、Preview toolbar、Chord editor、Score settings、採譜 UI、Help、Sidebar / onboarding の翻訳面は仕様 §6 が所有する。

## Data flow and ownership

1. VS Code は manifest と grammar / language configuration を読み込み、GuitarDSL 文書の編集体験を提供する。
2. 文書変更は Extension Core に届き、必要な機能が Compiler / symbol provider を呼ぶ。診断と Outline は VS Code の各 provider surface に返る。
3. コマンドは対象 TextDocument を解決し、プレビュー・設定エディター・採譜・Help 等の担当機能へ委譲する。
4. Help ページ本文は `docs/help/` が所有し、`media/help/` は生成する。仕様との対応・レビュー済み digest は `docs/help/help-manifest.json` が記録する。
5. Inspector の active-document snapshot と表示制御は Inspector Controller が所有し、Webview View はその snapshot を表示するだけである。document switch/close は stale context を消去し、view reveal は明示コマンドだけが行う。

## Failure handling

無効な入力は Diagnostics の仕様に従う。コマンドに対象文書がない場合や機能固有操作が失敗する場合の通知は、そのコマンド仕様と担当機能に委譲する。Help の生成・同期不整合は製品 UI の代替動作にせず、開発時 gate で検出する。

Help ファイルの欠落・preview 起動例外は `openGuitarDslHelp()` 境界で捕捉し、ローカライズ済みエラーを一度表示する。サンプル読込失敗では新規文書を開かない。sidebar view の読み込みは editor panel の機能 module を eager import しない。

Inspector View の再解決・再表示時は controller の現在 snapshot を使い、既に閉じた文書の URI/version を復活させない。非表示中の切替・編集は最新 snapshot と generation に反映し、可視化後に HTML 初期状態と `ready` handshake で同期する。provider disposal で Webview への参照とイベント subscription を解放する。

## Alternatives considered

現行設計は VS Code manifest contribution と provider API を使うが、別エディター統合方式やサイドバー / onboarding の比較記録は見つからない。本書は選定理由を推測しない。Help / localization の成果物を正本にする構成も採用しない。

## Verification strategy

言語 contributions とコマンド宣言は extension manifest 検査、Outline / diagnostics / sidebar / onboarding / Help / localization はそれぞれの既存ユニット検証を参照する。Help は `npm run check:help`、Schema 2 文書は `python -m agent_workflow validate-docs` で検証する。

## Issue #87 implementation design

`src/extension.ts` は Code Action provider を GuitarDSL selector に登録し、内部 apply command と診断 Hint を extension host に接続する。純粋な planner は [score editing design](score-editing.md) に従い、VS Code provider は document、selection、cancellation token、URI/version の境界を所有する。新しい public package command は追加しない。

Code Action provider は `CodeActionContext.only` を尊重し、キャンセル済み要求には結果を返さない。未使用コード定義 Hint の Quick Fix と、反復 fragment 候補 Hint は parser error のある文書では抑止する。診断を既存の `guitardsl` collection に統合し、文書変更時に再計算、close 時に消去する。既存診断の severity や code は変えない。

選択系 action は元の URI、version、range、対象 token 境界を内部 command に渡す。実行時に最新文書を取得して再計画・再検証し、URI 単位で同時実行を抑止する。全編集を一つの `WorkspaceEdit` に集め、一度の `workspace.applyEdit` で適用するため Undo は操作全体を戻す。キャンセル、stale range、re-parse 不一致、衝突、applyEdit rejection の場合に編集を残さない。

新しい Code Action / Quick Pick / Hint 文言は `src/i18n.ts` の英語・日本語辞書で解決する。Quick Fix をユーザーが実行できるよう Code Action title と diagnostic message を両ロケールで用意し、文書変更・close で Hint state を同期する。

E2E は extension host 上で一回の Undo による完全復元、untitled document URI、複数範囲編集と stale document rejection を確認する。VSIX listing は新しいローカライズ資産と既存 manifest allowlist の同梱を確認する。

## Issue #129 implementation design

`src/progressionCompletionProvider.ts` is a thin VS Code `CompletionItemProvider` over the pure suggestion core. It resolves only parser-owned chord-cell prefixes in `.guitardsl` / `.gdsl`, honors cancellation, and returns a replacement range that covers only that prefix. It never edits or auditions a document.

`src/progressionAssistant.ts` registers a `CodeLensProvider` for parser-owned chord measures and `guitardsl.suggestChordProgression` against the exact document URI/version and target measure. Issue #134 moves the 4/8/16-bar operation controls and candidate list into the common Inspector. The first model uses four bars and chooses safe replacement when possible, otherwise safe append. Single-chord IntelliSense remains unchanged.

The controller owns one ephemeral session and exposes commands that open the Inspector, Play, Stop, switch A/B, Apply and Close. Inspector actions carry the host-issued session generation, bound URI/version, and selected candidate ID; stale messages are ignored. Candidate rows are ordinary buttons in a semantic list, so Tab, Enter and Space use native Webview keyboard behavior. The host recomputes candidates after operation changes and accepts no DSL from the Webview. `TextEditorDecorationType` annotates parser-owned source spans with proposed chords; append uses an insertion marker. Decorations never edit text. A/B and candidate changes update only the editor annotation and session side; if the same document's Preview is already showing this session, its displayed side is synchronized without opening Preview or taking focus. Play uses the Inspector's transient AudioContext and scheduler after the Extension Host receives Preview's stop acknowledgement and grants the exclusive lease. The Inspector keeps single-chord, bars, melody and full-song audition mode in the host session; 8/16-bar proposals display the v1 repeat limitation. Preview remains the ordinary playback and Practice owner. Apply reacquires the document by URI/version and replans; source changes and document switches invalidate the session and clear decorations.

## Issue #135 implementation design

The existing Inspector controller remains the single View and ready/replay owner. Its settings context carries the target URI, document version, session generation, revision, active section, and one host-built section model. The settings controller owns the three model instances and validates every message against that current identity. Settings and progression cannot coexist in the same View; switching contexts invalidates the previous session before publishing a new snapshot.

The existing editScoreSettings and editCapo command IDs resolve their target before revealing the Inspector and start at the Capo section. They do not create a WebviewPanel. The chord diagram command remains bound to ChordEditorPanel; any optional detailed-edit action delegates to that existing command with the same target URI.

Settings controls are single-column native buttons and inputs that preserve selection and focus after host refresh. The Webview sends section IDs and bounded values only. Apply requires host confirmation and freshness checks; Cancel, navigation, and candidate comparison never edit source. Settings UI uses the established i18n dictionaries, VS Code theme tokens, ARIA labels/status, and existing relocated View position.

The transition to progression must request lease stop and wait for its acknowledgement while Preview remains locked. The transition back to settings first discards and restores its draft, then closes the progression session and its decorations. Stale messages, text version changes, close, disposal, or a newer explicit command cannot restore a prior session.

## Issue #136 implementation design

The singleton Preview retains a 48 px playback row for ordinary transport, Practice toggle, two settings disclosures, and Help. View, paper, orientation, and PDF are grouped in View & Export; Count-in and Metronome are grouped in Playback settings. These remain native buttons and form controls with localized names and ARIA state. The disclosures are nonmodal hidden groups, permit one open panel at a time, close on Escape/outside pointer/focus, and preserve focus unless Escape returns it to the trigger. Closed controls are absent from the keyboard and accessibility order.

Issue #145 adds a 44 px Score Settings row immediately below playback. Capo, colored Playability, and Beginner remain directly operable at 421 / 600 / 840 / 1100 CSS px; supplemental barre/capo-selection actions and Inspector detail links are visible from 840 px and use accessible overflow below that width. The row has no visible “Temporary Score Settings” text. Practice adds a 42 px row at `top: 92px` only while enabled. Its established speed, loop, A/B, Follow, and status behavior remains Preview-owned. An unavailable transport remains visible and disabled with a localized reason in a wrapping status line before the score. Narrow widths reduce labels and spacing or scroll supplemental actions without moving transport into overflow.

Paper and orientation retain the existing host `layoutChanged` and render path. The Webview includes its current URI, document version, and Preview render generation in layout requests. The host allowlists the target focus ID and binds it to that identity; a pending restore is consumed only by an accepted valid settings update and corresponding HTML render. Invalid or stale messages leave it intact; source updates, document switches, newer user actions, and panel disposal make it stale. The rebuilt page focuses the changed control once. Mode changes, disclosure state, and PDF save do not rebuild HTML or touch the playback source time. Inspector retains detailed Capo/Beginner comparisons and the only source Apply surface; Preview/PDF continue to use the same host-resolved effective DSL.

Issue #136 verification checks rendered DOM/CSS, keyboard and pointer disclosure behavior, 600 px layouts, layout rebuild focus, unchanged playback/Practice behavior, Inspector effective DSL and PDF equivalence, lease ownership, CSP/SVG isolation, and real Extension Development Host screenshots. Screen-reader testing is reported separately from automated accessibility-tree checks.

## Issue #137 implementation design

`src/sidebar.ts` remains the single TreeDataProvider for `guitardsl.sidebar`. Its fixed root contains a commandless active-target row and the five ordered groups Create, Open / Import, Edit Assist, Export, and Help. The target shows only the active document basename, a localized name for an untitled GuitarDSL document, or the localized no-target label. Create and Open / Import start expanded; the other groups start collapsed. The provider owns labels, stable TreeItem IDs, icons, and expansion defaults only. It does not mutate documents and does not retain a URI on Preview or export rows; those internal commands resolve the active editor again when invoked.

`src/sidebarNavigation.ts` owns the small host boundary for opening a GuitarDSL file, selecting an existing transcription source, and routing active-document Preview / PDF / Guitar Pro actions. It validates `.guitardsl` / `.gdsl` after the file picker returns, opens the selected URI through the ordinary TextEditor, and dispatches only the selected existing command from the source Quick Pick. Preview and export wrappers verify `window.activeTextEditor?.document` with the shared document resolver, then pass that URI explicitly to the existing command. With no active GuitarDSL document they report the localized warning and stop. Inspector remains the existing empty-capable `guitardsl.openInspector` command.

`src/extension.ts` registers these internal commands next to the existing command owners and disposes each registration with the extension context. Sidebar refresh remains event-driven from active-editor changes and text-document open / close events. No polling, duplicate command contribution, or eager import of the transcription panel or Audio MIR controller is introduced.

The existing singleton YouTube `WebviewPanel`, SecretStorage, host messages, option object, and `runTranscriptionPipeline` remain the owners of transcription. `getHtmlContent` presents the existing inputs in the specified order and uses native disclosure controls for key management and advanced options. The host passes saved, not-configured, or unknown key state; a rejected initial `SecretStorage.get` renders a localized unknown state without claiming saved or not configured, and key entry/save remain available. A key value is never interpolated into HTML or status. The webview clears the key field after the existing save acknowledgement and enables Start only when the URL and either a saved or entered key are present. A rejected `SecretStorage.get` during Start sends a localized error and stops before the Gemini pipeline or result preview; the host releases the job so Start can be retried. Storage exception text and stack traces are not exposed or logged. The host retains final URL validation, key persistence, job suppression, progress, and error ownership. A single host-owned job lock with a job ID and monotonically increasing state revision survives WebviewPanel disposal; closing the owning panel marks its result for discard but does not cancel the pipeline or release the lock. Successful DSL is retained only by its live owning panel and rendered as read-only text with a copy action. Starting another job clears that panel's previous result before the new job begins. This flow does not call `workspace.openTextDocument` or `showTextDocument`, so it creates no document automatically. Closing the owner discards its result. The Webview registers its message listener before requesting an authoritative job-state snapshot; job-specific messages carry the job ID and revision, and the renderer ignores stale state. A state snapshot includes a successful result only when the same live panel still owns that result and its job ID matches the snapshot job. This lets a missed success notification recover from Host state without exposing an old result to a reopened panel or a newer job. Existing options and defaults keep their current message shape and order.

New visible labels and file-open / no-active-document messages live in both dictionaries in `src/i18n.ts`. The authored Japanese and English feature pages explain the five groups, opening and importing files, the two transcription sources, and the collapsible YouTube settings without duplicating the specification. `help-manifest.json` is refreshed from the reviewed specs and package metadata, and `media/help/` is generated from those authored pages.

### Failure handling and boundaries

Canceling a file picker or source Quick Pick performs no command. A selected unsupported file or open failure reports a localized message and creates no Untitled document. A stale TreeItem cannot redirect Preview or export because internal wrappers resolve the active editor at invocation. With no suitable active document, those wrappers warn and do not reuse a previously active or last-open document; Inspector continues to open its existing empty state. Transcription start remains disabled until the local prerequisites are met, the host still validates the URL, and a processing or SecretStorage read error restores the existing retry path. YouTube work remains non-cancelable; closing its panel discards that panel's result, keeps Start disabled in a reopened panel until work settles, and creates no generated document from the discarded result.

This change does not alter public `package.json` command or menu contributions, parser behavior, import/export semantics, Preview playback, Inspector context ownership, Audio MIR, or the transcription pipeline. The Tree View is retained instead of adding a Webview sidebar, and wrappers are used instead of attaching a document URI to a tree row so action targets cannot become stale.

#### Narrow Inspector tabs (Issue #158 review)

The existing top-level tablist switches to a four-column equal-width grid at 360 CSS px and below. Only the visual labels shorten; button IDs, Host controller, selected state, roving tabindex, and full `aria-label` / `title` remain. Above 360 CSS px, the full labels return. At 293 CSS px, all four buttons and their focus ring fit without horizontal scrolling.

### Verification strategy

Unit coverage exercises the five groups, their localized labels and stable IDs, a commandless target row, active-file identity, empty-state document-independent actions, and wrapper behavior for cancellation, unsupported files, active-document changes, and dispatch. Existing sidebar and command contribution tests protect the public command surface. Transcription coverage checks disclosure visibility and tab order, key field clearing and non-disclosure, unchanged option values/message shape, Start eligibility, duplicate-start suppression, and retry after errors. Fixture-backed Webview E2E also drops the success notification to verify result recovery from a newer state snapshot, then drives the actual Copy button through Host clipboard handling for success and failure. SVG XML validity, rendered dimensions, help synchronization, VSIX contents, and the configured final verification hooks are checked before delivery.

### Verification strategy

Issue #135 E2E coverage verifies both legacy commands, Preview editCapo routing, URI selection before reveal, one View across repeated operations, settings/progression replacement, ready/replay after relocation, keyboard focus retention, and absence of a duplicate settings WebviewPanel. Visual evidence is captured from the actual Extension Development Host; automated accessibility-tree results and manual VoiceOver evidence are reported separately.

## Issue #158 implementation design

Preview editing extends the existing singleton Panel. The extension captures the active panel URI, current TextDocument version, and render generation when it renders; Preview messages carry that identity and an operation intent, never offsets or replacement source. The Host verifies the captured document is still the panel target, retrieves fresh parser bindings, plans a source-preserving edit, checks post-parse semantics, stops existing audio owners when required, and applies one WorkspaceEdit.

The common Inspector gains a variables context alongside empty, document, settings, and progression. The controller owns a URI/version/session-generation/revision snapshot and a draft distinct from source text. Apply validates the current document and candidate again; Cancel and all context changes discard drafts. Existing Settings and Progression dispatch remain isolated and retain their current context ownership and audio lease.

Issue #158 adds one top-level Inspector tablist for document, variables, score settings, and progression. Tabs dispatch an identity-bearing intent into the existing owner; `InspectorContext` remains exclusive. A variables/settings draft prompts before it is discarded, and a progression tab is enabled only for a current session. Leaving active audition first waits for the current Stop acknowledgement and lease release; switching back reuses the same candidates without autoplay. Preview edit-mode entry resolves these same gates before revealing the Inspector for the Preview-held TextDocument. A panel rerender does not reveal the view or reset its chosen tab.

The existing 48 px playback row owns an exclusive Normal / Edit / Practice selector. It uses a native labeled select below 600 px and a segmented control at and above 600 px; legacy Edit and Practice commands route through the same Host transition. Normal shows only the playback and settings rows, Edit adds the fixed bottom editing dock, and Practice shows its existing controls and guide. The dock and Practice row/guide never coexist. Same-URI HTML rebuilds preserve the transient mode, while document changes and Preview disposal reset it to Normal. After a rebuild the score scroll position and selected source binding are restored only for the current URI/version/generation. PDF rendering and Web Audio ownership stay in their existing paths. If temporary Capo or Beginner rendering changes the source projection, the Host rejects entry into Edit before changing Preview, settings, or Inspector state.

### Failure handling and boundaries

No editor switch, Preview reveal, alternate document fallback, or source write is caused by selection alone. Invalid or stale URI/version/generation/revision, missing source bindings, ambiguous occurrences, unsafe local detach, parse/semantic failure, rejected edits, cancellation, and failed audio Stop acknowledgement do not write text. A canceled draft-discard confirmation or failed progression Stop keeps the previous Inspector context and Preview edit mode. A read-only target remains keyboard-navigable to the source editor with a localized reason. Inspector and Preview disposal releases session state without changing existing progression playback ownership.

### Verification strategy

Tests exercise current-document identity, Preview and Inspector context replacement, one-Undo edits, stale and duplicate messages, no-op selection, shared command/Webview toggles, draft discard cancellation, progression Stop/lease behavior, and separation from the existing Settings and Progression flows. Real Extension Development Host captures cover Japanese/English, light/dark, Preview widths 421 / 600 / 840 / 1100 CSS px and short heights, Inspector variable states, visible focus, scroll preservation, and comparison with the approved proposal SVGs. Manual screen-reader and non-macOS results are recorded separately.
