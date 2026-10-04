<!-- agent-doc-type: design -->
<!-- agent-doc-schema: 2 -->

# 楽譜編集設計 (Score Editing)

- Status: Draft
- Owning Issue: [Issue #118](https://github.com/puchinya/vscode-guitar-dsl/issues/118)
- Related specification: [Extension specification](../specs/extension.md), [GuitarDSL syntax specification](../specs/guitardsl-syntax.md)
- System context: [Architecture](architecture.md)

## Context and goals

楽譜内容を編集・変換するコードダイアグラムエディター、スコア設定、カポ・弾きやすさ、初心者モード、移調、ストロークパターン適用の内部責務とデータ所有を記録する。外部動作の正本は拡張機能仕様であり、本書は新しい編集動作を定義しない。

## Requirements traceability

| 仕様上の要件 | 対象 |
|---|---|
| コード図の編集・保存、楽譜設定コマンド | 拡張機能仕様 §3.3、§3.9、§4A、§4B |
| プレビュー中のカポと初心者モード | 拡張機能仕様 §4.4–§4.5 |
| 移調、カポ、弾きやすさ、表示・保存境界 | 拡張機能仕様 §4B.2–§4B.5、言語構文仕様 §14 |
| ストロークパターンの適用 | 拡張機能仕様 §3.10、§8.7 |

## Architecture

- **コードダイアグラム**: `src/chordEditorModel.ts` は VS Code 非依存で編集状態、DSL 行生成・再解析検証、保存計画を扱う。`src/chordEditor.ts` はシングルトンの Panel と対象文書・行を管理し、`media/chordEditor.js` は Webview の表示と編集状態操作を担う。検証・描画・自動判定・保存は拡張機能ホスト側にある。
- 保存前には対象 URI の文書を再取得し、編集対象行がまだ `chord` 行であることを確認してから WorkspaceEdit を適用する。Webview からの状態は `sanitizeState` を通し、保存後に再解析する。
- **カポ / 弾きやすさ**: `src/capo.ts` はコード検出・定義・voicing 解決・Compiler を使う VS Code 非依存の変換モジュールである。`src/previewCapo.ts` と `src/scoreSettingsEditor.ts` はプレビュー一時変更と設定 UI を接続する。
- **初心者モード**: `src/beginnerMode.ts` の変換と `src/previewBeginner.ts` の一時プレビュー状態を使う。仕様上 DSL の新しい構文・設定・コマンドは追加しない。
- **実音移調**: `src/transpose.ts` が変換を担い、設定エディターが操作を公開する。
- **伴奏**: プリセットの唯一のカタログは `src/strummingPatterns.ts`、音楽ロジックは `src/accompaniment.ts`、ソース上の適用箇所特定は `src/strummingCodeLens.ts` が所有する。

### エディターとの保存境界

Chord editor は `ChordEditorPanel` を一つ持ち、開いた文書 URI と編集対象行を記録する。`chordEditorModel.ts` の `createEditorSession()`、`buildChordLine()`、`planChordSave()` が VS Code 非依存でモデル・行の検証・保存計画を行う。Webview の `ready` / `change` / `presets` / `save` / `close` メッセージと、ホストからの `load` / `preview` / `status` 応答を使う。Preview SVG、候補判定、保存の権限はホストにあり、Webview は表示と状態操作を行う。

### 変換の不変条件

- `inferCapo()` は tuning、書かれたコード名、出現回数、現行の押さえ方からカポ候補 0–12 を評価する。推奨値を返すだけで適用はしない。同点なら小さいカポを選ぶ。GuitarDSL アダプターの `inferCapoForDsl()` は各候補の実変換まで検証し、変換不能な候補を UI に提示しない。
- `planCapoTransform()` は AST を全体再シリアライズせず、コード token の名前部分を置き換えて再解析する。チューニングとコード配置を保ち、ラベル付きコード、移調不能なコード名、定義衝突、変換後 parse error を失敗にし、未使用となるコード定義は削除せず警告する。
- `planBeginnerTransform()` は現在の原文から決定的に計画を作る。押さえやすさ評価には実際に描画される共有 voicing resolver の形だけを使い、renderer の見た目用 fallback を演奏可能性とみなさない。変換後は再解析し、コード位置と選択したカポ・barre 方針の制約を確認する。
- `resolvePreviewEffectiveDsl()` は初心者モードを有効にした場合その結果を優先し、そうでなければ preview capo の結果を使う。Preview と Preview PDF / PDF export は同じ解決関数を通す。
- `planSoundingTranspose()` は冒頭 `key` / `original_key`、`@key`、コード名 token、音高 token のソース範囲だけを更新し、コメント・空白・改行・歌詞・長さ・奏法を AST から書き戻さない。必要な場合は移調後の capo 方針を適用し、最後に再解析して一貫性を確かめる。
- 伴奏分析・適用は VS Code / Gemini / 採譜に依存しない。プリセット選択は単一カタログと meter / feel 制約で行い、明示パターンまたは検証済みの一小節リズム計画のみをソースの rhythm spans に適用する。

## Data flow and ownership

| 操作 | 主な流れ | 書き込み境界 |
|---|---|---|
| コード図 | Webview state → sanitize / model validation → chord preview → save plan | 対象 `chord` 行の確認後、ホストが文書へ反映 |
| 設定変換 | document text → parse / transform / re-parse → editor result or preview model | 永続変換とプレビュー専用 override の区別は仕様のコマンド・節に従う |
| 伴奏適用 | parse → section / measure analysis → validated pattern → source-span transform | `MeasureData.rhythmSource` の範囲に限定。コード、歌詞、`%` 展開を編集しない |

VS Code 文書が原文を所有し、純粋な変換モジュールは変換結果と診断を返す。UI は状態とユーザー操作を運び、変換ルールを複製しない。

カポ・初心者モード・移調の各 transform は最新の文書テキストを入力に計画し、適用 API も URI から最新文書を開いて計画を再確認する。表示用 preview override は同じ原文から解決し、文書へ書き戻す操作と混同しない。

## Failure handling

コード図の無効状態、重複定義、変更済み対象行は保存拒否または UI エラーとして扱う。カポ変換は入力解析エラー、不正なカポ値、ラベル付きコード、移調不能名、定義衝突、変換後検証エラーを区別し、使われなくなる定義があれば警告する。伴奏は meter / feel / pattern の検証結果を使い、暗黙の別プリセットへ切り替えない。正確なコードと表示文言は規範仕様に従う。

## Alternatives considered

既存設計は純粋な変換モジュールと VS Code / Webview adapter の分離を記録するが、他方式の比較根拠は十分に記録されていない。本書では代替方式を採用・棄却した理由を補わない。

## Verification strategy

既存検証として chord editor model / definitions / resolver、`capo`、beginner mode、transpose、strumming pattern / accompaniment のユニットテストを参照する。今回の文書変更では Schema 2 validator と差分検査を行い、実行時テストは追加しない。
