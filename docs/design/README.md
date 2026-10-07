<!-- agent-doc-type: design -->
<!-- agent-doc-schema: 2 -->

# 内部設計書 (Design Documents)

- Status: Draft
- Owning Issue: [Issue #118](https://github.com/puchinya/vscode-guitar-dsl/issues/118)
- Related specification: [Specifications index](../specs/README.md)

## Context and goals

このディレクトリは、**vscode-guitar-dsl** の内部アーキテクチャ、コンポーネント構造、データフロー、および主要な技術的決定を、機能ごとに追跡できる形で記録します。製品の外部契約は [`docs/specs/`](../specs/) が所有し、設計書はその契約を実現する内部構造を説明します。

## Requirements traceability

次の表は仕様上の主要な能力と、その設計上の所有者を対応づけます。詳細な節単位の対応は各設計書に記載します。

| 仕様 | 主な能力 | 設計書 |
|---|---|---|
| [拡張機能仕様 §1–§2](../specs/extension.md) | 拡張機能の全体、VS Code 言語貢献 | [Architecture](architecture.md), [VS Code editor experience](vscode-editor-experience.md) |
| [拡張機能仕様 §3.1–§3.2、§4、§4.6](../specs/extension.md) | プレビュー、レンダリング、PDF、再生 | [Preview, rendering, and export](preview-rendering-and-export.md) |
| [拡張機能仕様 §3.3、§3.9–§3.10、§4.4–§4B](../specs/extension.md) | コードダイアグラム、楽譜設定、カポ、初心者モード、移調、伴奏 | [Score editing](score-editing.md) |
| [拡張機能仕様 §3.4、§3.8](../specs/extension.md) | YouTube / ローカル音声の採譜 | [Audio transcription](audio-transcription.md) |
| [拡張機能仕様 §3.5–§3.7、§3.11–§3.13、§4C–§7](../specs/extension.md) | キー設定、コマンド、サイドバー、診断、Help、ローカライズ | [VS Code editor experience](vscode-editor-experience.md), [AI integration](ai-integration.md) |
| [拡張機能仕様 §8](../specs/extension.md) | VS Code AI skills、instructions、tools | [AI integration](ai-integration.md) |
| [言語構文仕様 §1–§10、§12–§13、§15–§18](../specs/guitardsl-syntax.md) | 言語構文、スコアイベント、音符と歌詞、再利用フラグメント | [Language and score processing](language-and-score-processing.md) |
| [言語構文仕様 §11、§14](../specs/guitardsl-syntax.md) | レンダリング、レイアウト、表示設定 | [Preview, rendering, and export](preview-rendering-and-export.md), [Language and score processing](language-and-score-processing.md) |
| [言語構文仕様 §19](../specs/guitardsl-syntax.md#19-ギター-tab-guitar-tablature) | 位置優先 TAB、声部、奏法、タイ、TAB 歌詞 | [TAB notation](tab-notation.md), [Language and score processing](language-and-score-processing.md) |
| [拡張機能仕様 §4.7、§4B.6](../specs/extension.md#47-tab-プレビューレイアウトpdf) | TAB Preview / PDF と変換制限 | [TAB notation](tab-notation.md), [Preview, rendering, and export](preview-rendering-and-export.md) |

## Architecture

システム全体の依存境界と横断的な流れは [Architecture](architecture.md) が所有します。機能内部の設計は次の文書が所有します。

| 設計書 | 主な範囲 |
|---|---|
| [Language and score processing](language-and-score-processing.md) | 構文解析、スコアモデル、演奏順、音符・歌詞、ハーモニー分析 |
| [TAB notation](tab-notation.md) | 位置優先 TAB モデル、弦フレット意味論、変換安全性 |
| [Preview, rendering, and export](preview-rendering-and-export.md) | プレビュー、SVG、ページネーション、PDF、プレビュー再生 |
| [Score editing](score-editing.md) | コード編集、設定、カポ、初心者モード、移調、伴奏編集 |
| [Audio transcription](audio-transcription.md) | YouTube / Audio MIR、Music IR、GuitarDSL への直列化 |
| [VS Code editor experience](vscode-editor-experience.md) | 言語貢献、コマンド、Outline、診断、Help、サイドバー、ローカライズ |
| [AI integration](ai-integration.md) | AI tool 境界、文書対象の解決、変換アダプター |

## Data flow and ownership

編集、コンパイル、レンダリング、拡張機能 UI 間の所有権は [Architecture](architecture.md) にあります。各機能設計書は、その機能固有のデータと制御の流れを記録します。

## Failure handling

入力診断、変換失敗、採譜エラーの所有者は上の対応する機能設計書です。システム横断のエラー境界は [Architecture](architecture.md) に記載します。

## Alternatives considered

既存の設計資料に採用しなかった代替案の根拠がない場合、この索引では履歴を推測しません。各設計書で未記録の選択肢を明示します。

## Verification strategy

文書マーカー、必須見出し、Issue の所有者リンクは `python -m agent_workflow validate-docs` で検証します。仕様に連動する Help / AI 資産は `npm run check:help` と `npm run check:ai` で確認します。
