# 仕様書 (Specifications)

このディレクトリは、**GuitarDSL** 言語構文および拡張機能の外部仕様に関する規範的ドキュメント（Normative Public Contract）を管理します。

## 仕様書一覧

| ドキュメント | 概要 |
|---|---|
| [`guitardsl-syntax.md`](guitardsl-syntax.md) | GuitarDSL 言語構文仕様書（メタデータ、セクション、小節線、コード、リズム、歌詞、描画規則） |

## ドキュメントの位置づけ

`AGENTS.md` の規定に従い、`docs/specs/` は言語構文および拡張機能の外部振る舞いにおける最高位の合意仕様です。
実装の変更や機能追加は、この仕様書に準拠して行われます。
内部アーキテクチャ（コンパイラ・Webview・パーサー設計）については [`docs/design/`](../design/)、現在の実装進捗は [`docs/status/`](../status/) を参照してください。
