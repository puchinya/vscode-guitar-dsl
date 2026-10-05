<!-- agent-doc-type: design -->
<!-- agent-doc-schema: 2 -->

# VS Code エディター体験設計 (VS Code Editor Experience)

- Status: Draft
- Owning Issue: [Issue #118](https://github.com/puchinya/vscode-guitar-dsl/issues/118)
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
