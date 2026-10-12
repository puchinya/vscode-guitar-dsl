<!-- agent-doc-type: design -->
<!-- agent-doc-schema: 2 -->

# VS Code エディター体験設計 (VS Code Editor Experience)

- Status: Draft
- Owning Issue: [Issue #118](https://github.com/puchinya/vscode-guitar-dsl/issues/118)
- Related Issue: [Issue #87](https://github.com/puchinya/vscode-guitar-dsl/issues/87)
- Related specification: [Extension specification](../specs/extension.md), [GuitarDSL syntax specification](../specs/guitardsl-syntax.md)
- System context: [Architecture](architecture.md)

## Context and goals

VS Code 上で GuitarDSL を識別・編集・診断・プレビューするホスト統合を記録する。言語ルールやユーザー向けのコマンド契約は各仕様が所有し、本書は extension manifest / providers / UI / Help の内部境界を説明する。

## Requirements traceability

| 仕様上の要件 | 対象 |
|---|---|
| 言語ID、拡張子、language configuration、TextMate grammar | 拡張機能仕様 §2 |
| コマンドと設定 | 拡張機能仕様 §3 |
| サイドバー、Outline、診断 | 拡張機能仕様 §4C、§5、§5A |
| ロケール、Help と仕様同期 | 拡張機能仕様 §6–§7 |
| Code Actions、editor Hint、Quick Fix の登録と文書編集境界 | Issue #87、拡張機能仕様 §5A–§5B、§6.3 |
| コード進行補完と assistant コマンド | Issue #129、拡張機能仕様 §3.17、§4.8 |
| public language rules and examples | 言語構文仕様 §1–§18 |

## Architecture

- `package.json` が VS Code の言語・コマンド・設定・表示の貢献を宣言し、`language-configuration.json` と `syntaxes/guitardsl.tmLanguage.json` が編集補助と TextMate grammar を提供する。
- `src/extension.ts` はコマンド登録、文書イベント購読、Document resolver、Preview Panel 等を束ねる。Compiler 診断は `DiagnosticCollection` に反映される。Outline は `src/symbols.ts` の `DocumentSymbolProvider` が提供する。
- サイドバーと初回利用導線は `src/sidebar.ts` / `src/onboarding.ts`、Help のローカル表示は `src/help.ts` と生成済み `media/help/` が担う。Help は仕様・package metadata 由来の生成物であり、仕様の正本ではない。
- ローカライズは `src/i18n.ts` と VS Code の `package.nls*.json` / Webview locale message を通じて拡張機能ホストと UI に提供する。

### Navigation と初回利用

`GuitarDslSidebarProvider` は TreeDataProvider で、項目を section / command / hint として返す。command 項目は既存の command ID と引数に委譲する。Current File はアクティブな GuitarDSL TextEditor だけを指し、他の開いた文書へ暗黙に切り替えない。Editor / document open / close イベントで更新し、polling は行わない。

テンプレートは小さな `STARTER_TEMPLATES` から、新しいサンプルは extension 配下の `samples/` から読み、成功してから無題 GuitarDSL TextDocument を開く。失敗時は文書を作らず、各コマンドが捕捉してローカライズ済みメッセージを一度表示する。VSIX へ同梱するサンプルは curated list と `.vscodeignore` の allowlist が一致する。

### Help とローカライズ

Help の編集元は `docs/help/{ja,en}/`、拡張機能に同梱する生成物は `media/help/` である。`openGuitarDslHelp()` はロケールを解決し、同梱 Markdown を存在確認したうえで VS Code 組み込みの `markdown.showPreviewToSide` を開く。Help 専用 Webview / CSP / script bridge は持たず、ネットワーク URL へ fallback しない。生成 manifest は各 Help page が参照する仕様 section とレビュー済み digest を結び付ける。

ロケールは extension host と Webview の message bundle で共有する。パッケージ contribution、host message、Preview toolbar、Chord editor、Score settings、採譜 UI、Help、Sidebar / onboarding の翻訳面は仕様 §6 が所有する。

## Data flow and ownership

1. VS Code は manifest と grammar / language configuration を読み込み、GuitarDSL 文書の編集体験を提供する。
2. 文書変更は Extension Core に届き、必要な機能が Compiler / symbol provider を呼ぶ。診断と Outline は VS Code の各 provider surface に返る。
3. コマンドは対象 TextDocument を解決し、プレビュー・設定エディター・採譜・Help 等の担当機能へ委譲する。
4. Help ページ本文は `docs/help/` が所有し、`media/help/` は生成する。仕様との対応・レビュー済み digest は `docs/help/help-manifest.json` が記録する。

## Failure handling

無効な入力は Diagnostics の仕様に従う。コマンドに対象文書がない場合や機能固有操作が失敗する場合の通知は、そのコマンド仕様と担当機能に委譲する。Help の生成・同期不整合は製品 UI の代替動作にせず、開発時 gate で検出する。

Help ファイルの欠落・preview 起動例外は `openGuitarDslHelp()` 境界で捕捉し、ローカライズ済みエラーを一度表示する。サンプル読込失敗では新規文書を開かない。sidebar view の読み込みは editor panel の機能 module を eager import しない。

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

`src/progressionAssistant.ts` registers a `CodeLensProvider` for parser-owned chord measures and `guitardsl.suggestChordProgression` against the exact document URI/version and target measure. Four/eight/sixteen-bar candidate rows use the native single-select `createQuickPick()` API. `onDidChangeActive` may show a provisional source-preserving Decoration; Enter commits selection only, while Escape restores the committed Decoration or clears a new provisional session. Quick Pick selection neither opens Preview nor auditions audio. Single-chord IntelliSense remains unchanged.

The controller owns one ephemeral session and exposes separate editor commands for Choose candidate, Play, Stop, A, B, Apply and Close. Session commands act on the bound URI/version instead of resolving a newly active editor. Each accepted session receives a host-issued monotonic generation, and Preview messages must match the generation, URI and document version; delayed messages from a previous session are rejected even when the URI/version are unchanged. `TextEditorDecorationType` annotates parser-owned source spans with proposed chords; append uses an insertion marker. Decorations never edit text. A/B changes only the editor annotation and session side. Preview is rendered or reopened only after explicit Play; if the same document's Preview is already open, it can mirror selection and side changes without taking focus. The Preview remains the sole playback owner. Apply reacquires the document by URI/version and replans; Webview messages carry candidate IDs/actions and cannot submit arbitrary DSL. Source changes and document switches invalidate the session and clear decorations.
