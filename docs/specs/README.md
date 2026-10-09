<!-- agent-doc-type: specification -->
<!-- agent-doc-schema: 2 -->

# 仕様書 (Specifications)

- Status: Current
- Owning Issue: [Issue #118](https://github.com/puchinya/vscode-guitar-dsl/issues/118)
- Related design: [Design document index](../design/README.md)

## Purpose

このディレクトリは、**GuitarDSL** 言語構文および拡張機能の外部仕様に関する規範的ドキュメント（Normative Public Contract）を管理します。

## Scope

この索引は仕様の所有者を案内します。製品要件の正本は [拡張機能仕様](extension.md)、[言語構文仕様](guitardsl-syntax.md)、および [Guitar Pro GPIF ファイル形式仕様](guitar-pro-file-format.md) です。

## Normative requirements

実装変更と機能追加は、次の仕様に準拠します。この索引自体は独立した言語規則や拡張機能動作を定義しません。

| ドキュメント | 概要 |
|---|---|
| [拡張機能仕様](extension.md) | コマンド、エディタ連携、プレビュー、PDFエクスポート、アウトライン、採譜、AI 連携 |
| [GuitarDSL 言語構文仕様](guitardsl-syntax.md) | メタデータ、セクション、小節線、コード、リズム、歌詞、スコアイベント、描画規則 |
| [Guitar Pro GPIF ファイル形式仕様](guitar-pro-file-format.md) | Guitar Pro 7/8 の `.gp` コンテナ、GPIF 参照構造、GP8.1.5 歌詞配置と import 対応 |

## Observable behavior

拡張機能のユーザー向け動作は [拡張機能仕様](extension.md) が所有し、テキスト形式と描画規則は [言語構文仕様](guitardsl-syntax.md) が所有します。Guitar Pro ファイルの読み取り構造と GuitarDSL への対応は [GPIF ファイル形式仕様](guitar-pro-file-format.md) が所有します。

## Error and boundary behavior

エラー、診断、入力境界の規範は各仕様の対応節にあります。GPIF の参照・構造エラーは [GPIF ファイル形式仕様](guitar-pro-file-format.md) が所有します。この索引では新しいエラー動作を定義しません。

## Security and privacy

拡張機能のキー管理、外部サービス、ローカル処理の境界は [拡張機能仕様](extension.md) に記載します。言語構文の規則は [言語構文仕様](guitardsl-syntax.md) に記載します。

## Verification strategy

Schema 2 の所有者とリンクは `python -m agent_workflow validate-docs` で検証します。Help と AI 参照の同期は `npm run check:help` と `npm run check:ai` で確認します。
