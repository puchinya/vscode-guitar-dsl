<!-- agent-doc-type: design -->
<!-- agent-doc-schema: 2 -->

# プレビュー・描画・エクスポート設計 (Preview, Rendering, and Export)

- Status: Draft
- Owning Issue: [Issue #118](https://github.com/puchinya/vscode-guitar-dsl/issues/118)
- Related specification: [Extension specification](../specs/extension.md), [GuitarDSL syntax specification](../specs/guitardsl-syntax.md)
- System context: [Architecture](architecture.md)

## Context and goals

同じ GuitarDSL スコアを Webview のプレビューと PDF で表示し、ページ表示と連続表示のレイアウト、およびプレビュー再生を提供する内部経路を記録する。表示要件の正本は[拡張機能仕様](../specs/extension.md)と[言語構文仕様](../specs/guitardsl-syntax.md)である。

## Requirements traceability

| 仕様上の要件 | 対象 |
|---|---|
| 表示・レイアウト規則、調号・表示設定 | 言語構文仕様 §11、§14 |
| 六線 TAB、TAB 歌詞、明示リズムとの同居 | 言語構文仕様 §19 / [TAB notation](tab-notation.md) |
| プレビュー更新、UI、レンダリング、一時カポ・初心者表示 | 拡張機能仕様 §3.1、§4、§4.4–§4.5 |
| TAB Preview、PDF 同一性、変換制限 | 拡張機能仕様 §4.7、§4B.6 |
| PDF と Preview playback | 拡張機能仕様 §3.2、§4.6 |

## Architecture

- `src/render/layout.ts` の `layoutScore()` はスコアをページ・シートの配置データへまとめる。改ページとレイアウト設定は表示上の境界として扱う。
- `src/render/svg.ts` はページ SVG (`renderScoreSheets()`) と連続表示 SVG (`renderContinuousSvg()`) を生成する。`src/render/previewHtml.ts` の `compileGuitarDslToHtml()` はプレビュー用 HTML と必要な UI モデルを組み立てる。
- Extension Core は文書変更・プレビュー操作を処理し、Webview に HTML/SVG を渡す。Webview の操作メッセージは拡張機能ホストに戻り、ホスト側の制御器が文書・有効 DSL とプレビュー状態を管理する。
- `src/pdf.ts` はページ SVG を `pdfkit` / `svg-to-pdfkit` でベクター PDF にする。Noto Sans JP の同梱フォントを登録し、書き出し時は一時ファイルを経て確定する設計が記録されている。
- Preview playback は `playOrder` と音符・リズム情報を再生タイムラインへ変換し、Webview の Web Audio 経路で音を鳴らす。再生タイムラインは元スコアを書き換えない。

### レイアウトと出力の同一性

`layout.ts` は用紙座標を pt（1/72 inch）で扱い、シート SVG の `viewBox` と PDF ページを一致させる。現行レイアウトでは上下 10 mm・左右 12 mm の余白、横向きの2カラムと12 mmガターを持つ。段は既定4小節を基準幅780で組み、用紙カラムへ scale する。段ごとの高さはメロディ譜表や歌詞段数を含めて見積もる。手動 pagebreak と段高からの自動改ページを併用し、空ページでも最低1段を受け入れて無限ループを避ける。縦向きは1シートに1ページ、横向きは2ページを配置する。

ページプレビューとPDFは `renderScoreSheets()` の同一ページ SVG を共有する。Web 用 continuous モードはページを分割せず縦長 SVG を生成する。メロディ付き段では、リズムとメロディの発音位置の union を共通 x 座標列にし、両段を整列する。

### Preview 更新と PDF 出力

文書変更時に Extension Core は対象文書を確認し、`resolvePreviewEffectiveDsl()` で有効 DSL と表示用モデルを解決する。これを `compileGuitarDslToHtml()` に渡し、Compiler → layout / SVG → Preview HTML の順で生成して Panel の HTML を置き換える。Webview の用紙サイズ・向き変更は `layoutChanged` メッセージでホストへ戻し、同じ pipeline を新しい設定で再実行する。

PDF は Preview で選ばれた有効 DSL を受け取り、ページ SVG をベクターとして PDF に載せる。`writeScorePdf()` は一時ファイルへの書き込み後に rename し、不完全な最終ファイルを残さない。フォントは Noto Sans JP Regular / Bold を登録し、描画前に読み込んで PDF 内へ必要なグリフを埋め込む。

### Preview 再生

再生タイムラインは `ParsedScore.playOrder` の出現順と音価からイベント時刻とソース小節の対応を作る。Preview が新しい HTML に再構築されると再生は停止して先頭に戻る。Play / Pause / Resume / Stop / Seek と有限の先読みを Web Audio の `AudioContext` 時計で扱い、Pause は位置を保持する。Count-in は先頭からの Play の直前だけ鳴り、Resume と先頭以外の Seek では省略する。編集・有効 DSL 変更・レイアウト再構築・文書切替・Panel 破棄時は予約済み音源を停止する。

### TAB geometry and SVG (Issue #89)

`layoutScore()` remains the sole owner of row and vertical placement. `SystemGeometry` explicitly reports TAB presence, block offset and staff height; TAB lyric baseline, line height and verse count; whether an explicit rhythm staff is rendered and its final offset; and total `unitHeight`. A TAB row orders its blocks as header/section/chord labels, optional melody plus melody lyrics, TAB plus TAB lyrics, optional explicit rhythm, then dynamics/lower lanes. The six evenly spaced lines use a prominent clef-like `TAB` label and enough vertical room to keep fret digits on adjacent strings legible. The rhythm staff appears only when `show_rhythm` is true and the row contains explicitly authored rhythm. TAB's own/default duration does not create a redundant slash staff. Systems without TAB retain current geometry and rendering behavior.

`render/tabStaff.ts` consumes compiled TAB semantics and `SystemGeometry`; it does not parse source, re-resolve pitch, or calculate positions from tuning. `render/svg.ts` includes it in the existing page and continuous SVG routes. The page SVG supplied to Preview is the same page SVG supplied to `src/pdf.ts`; PDF has no TAB-specific rendering or layout path.

## Data flow and ownership

| フロー | 変換 | 結果の所有者 |
|---|---|---|
| Preview | TextDocument → Compiler → layout / SVG / HTML → Webview | 文書はテキストを、Extension Core はパネルを、Renderer は描画物を管理 |
| PDF | 有効 DSL → Compiler / `renderScoreSheets()` → PDF exporter → 保存先 | `src/pdf.ts` は VS Code に依存せず PDF bytes / write を担う。保存先選択は Extension Core |
| Playback | `ParsedScore.playOrder` / 音価 → 再生タイムライン → Web Audio | タイムラインは出現時刻、Webview は再生 UI と音声実行を管理 |

プレビューでの一時カポや初心者モードは、対象の有効 DSL / UI モデルをホストが解決して描画へ渡す。正式な保存変換と一時表示変換の契約は拡張機能仕様に従う。

## Failure handling

For TAB source, Preview does not synthesize an effective DSL by applying a non-identity capo, transpose, or beginner chord substitution. Transform services return `tabTransformUnsupported`; Preview follows its existing warning/reset path and renders the original source. No partial rewrite is displayed. Identity requests remain valid when both pitch and capo are unchanged.

Compiler 診断、レイアウト・SVG 生成、フォント初期化、PDF 書き込み、Webview メッセージ、再生状態はそれぞれの担当層で扱う。PDF のフォント読み込み失敗を無視して代替フォントで続行すると文字化けし得るため、現在の設計は描画前にフォントを明示的に読み込む。その他の失敗時に表示する文言や部分描画規則は仕様・実装を参照し、ここでは追加しない。

## Alternatives considered

既存資料にはページ SVG / 連続 SVG と Webview / PDF の分担が記録されているが、Canvas 等の比較検討や全選定根拠は残っていない。

## Verification strategy

ページ配置、SVG、Preview HTML、PDF、playback timeline / Web Audio runtime の既存ユニット検証を機能変更時に参照する。今回の文書検証では Schema 2 validator と `git diff --check` を実行する。Help / AI 同期は関連資産のゲートで確認する。
