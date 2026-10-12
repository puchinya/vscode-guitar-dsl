<!-- agent-doc-type: design -->
<!-- agent-doc-schema: 2 -->

# 楽譜編集設計 (Score Editing)

- Status: Draft
- Owning Issue: [Issue #118](https://github.com/puchinya/vscode-guitar-dsl/issues/118)
- Related Issue: [Issue #87](https://github.com/puchinya/vscode-guitar-dsl/issues/87)
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
| Code Actions によるソース保持編集 | Issue #87、拡張機能仕様 §5B |
| コード進行候補の span 編集と再検証 | Issue #129、拡張機能仕様 §3.17、§4.8 |

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
- コード進行 planner は `ParsedScore` と parser-owned chord/source spans を使い、元 DSL 全体を再シリアライズしない。置換は対象小節の chord-name 部分だけを splice し、候補ソースを通常 parser に通して parse error と対象外 semantics を検査する。append は安全な本文末 insertion span を使う。

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

既存検証として chord editor model / definitions / resolver、`capo`、beginner mode、transpose、strumming pattern / accompaniment のユニットテストを参照する。Issue #87 では下記の純粋な planner / span edit ユニットテストと editor host E2E を追加し、Schema 2 validator と差分検査も行う。

## Issue #87 implementation design

### Ownership and planning

`src/codeActions.ts` は VS Code API に依存せず、`ParsedScore`、パーサーが所有する token / duration source spans、および元テキストから候補と編集計画を返す。音高とコード名は既存の `PitchTokenSpan` / `ChordTokenSpan`、セル・拍・duration は parser-owned spans を使う。duration span が現状の構造に無い場合はコンパイラーの parse 結果へ追加し、Code Action 側で DSL を再走査して境界を推測しない。

各編集は期待する元テキスト、置換文字列、対象範囲を含む plan として表す。transpose と capo の既存右から左への span-splice 検査を共通の source edit helper に移し、行区切り、コメント、空白、Unicode を含む範囲外の文字列を保持する。既存 transform の出力と失敗条件は変えずに helper を共有する。

抽出・inline・移調・異名同音・長さ変更・正規化・未使用コード定義削除は、それぞれ parser の構造とソース範囲から計画する。適用前後で parse し、該当操作の意味保存条件を検査する。反復候補 Hint は同じ authored rhythm の token 情報を使い、Quick Fix は選択された一つの定義行だけを削除する。

### Validation and failure behavior

- 変換は確定後の最新 URI / version の文書を読み直し、選択範囲がまだ対象 token 境界と一致することを確認してから計画を再作成する。
- 変換後に parse error、音楽的意味の不一致、暗黙の octave / beat / rhythm 継承の変更、コード定義衝突、範囲不一致のいずれかがあれば plan 全体を拒否する。
- Apply 時は URI 単位で reentrancy を防ぎ、検証済みの全差分を単一 WorkspaceEdit と単一 `applyEdit` にまとめる。キャンセル・stale plan・適用失敗では部分編集を残さない。
- 抽出名の衝突、重複・曖昧な定義参照、未対応 duration、TAB / implicit / repeat 由来の境界は該当アクションを提示しない。失敗理由は呼び出し元がローカライズできる識別子で返す。

### Alternatives considered

AST 全体の再シリアライズはコメント、改行、ユーザー書式を壊すため採用しない。選択テキストを独立パーサーで解析する方法は既存の compiler span と継承規則から外れるため採用しない。アクションごとに独自の文字列 splice を実装する方法は衝突・部分編集の検査が不統一になるため、既存変換と共有する検証済み helper に集約する。

### Verification strategy

純粋な planner と span splice にユニットテストを追加し、LF / CRLF、コメント、範囲外空白、無効・古い選択、parse / semantic validation failure、コード衝突、最小 / 最大 duration を確認する。E2E では multi-span 変換の単一 Undo、untitled URI、stale document の拒否を確認する。Issue #87 の contract に列挙された project hooks、Help / AI checks、Schema 2 validation を実行し、実行できない GUI / packaging target は NOT RUN と記録する。

## Issue #129 implementation design

`src/progressionSourceEdits.ts` is pure. It accepts source text, its `ParsedScore`, an explicit target, and a generated candidate. Replacement plans are limited to contiguous simple measures and each edit updates only a parser-owned chord-name span. Safe body-end append uses an exact insertion point and creates chord-only measures without rewriting existing text.

`%`, multiple chord changes, explicit chord duration, custom `@voicing`, affected TAB, source diagnostics, key boundaries, ambiguous target harmony, and unresolved spans reject the whole plan. A key-change event strictly inside the replacement range rejects the plan even if it repeats the current key; starting the range at that event is allowed. After splicing, the planner reparses and verifies that melody pitch/duration, rhythm, lyrics, and measure context outside the target remain unchanged. The host repeats this plan against the latest URI/version and applies it in one WorkspaceEdit; stale, canceled, reentrant, failed, or non-equivalent plans produce no writes.

The editor CodeLens and Decoration adapter consumes the same validated plan. Replacement annotations use only the plan's parser-owned source spans; append shows the planned chord sequence after the safe body-end position. A/B and Quick Pick provisional selection clear or update Decorations only. Candidate selection never calls the source-edit apply path, so document text, version and undo history remain unchanged until the separately confirmed Apply command.

For a chord cell, an explicit key change at the target position (including a pending `@key` before an empty cell) takes precedence over previous-measure context. Previous measure context is the fallback only when the target is a true append position with no measure or pending key change at that index. The completion provider and editor command use this same target-first rule after `@key`.
