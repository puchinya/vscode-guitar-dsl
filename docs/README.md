# vscode-guitar-dsl documentation router

vscode-guitar-dsl の永続ドキュメントは、答える質問ごとに責務を分ける。

| Need | Start here |
|---|---|
| 言語構文（GuitarDSL）、コマンド仕様、拡張機能の外部振る舞い | [`specs/README.md`](specs/README.md) |
| 内部アーキテクチャ（コンパイラ、Webview、TextMate文法定義） | [`design/README.md`](design/README.md) |
| 現在の実装状況、機能対応状況、検証状態 | [`status/README.md`](status/README.md) |
| 拡張機能実装時の技術ルール・検証コマンド | [`agents/`](agents/) |
| Issue phase workflow | [`agent-workflow/`](agent-workflow/) |

通常はこのREADMEからcategory READMEを選び、そこから対象文書を1～少数だけ読む。
全spec/design/statusを最初から横断してはならない。

文書の依存方向とコード変更時の同期規則はルートの [`AGENTS.md`](../AGENTS.md) を正本とする。
人間向けのworkflow overviewは [`docs_only_human/issue-driven-development-workflow.md`](../docs_only_human/issue-driven-development-workflow.md) にある。
