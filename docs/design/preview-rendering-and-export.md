<!-- agent-doc-type: design -->
<!-- agent-doc-schema: 2 -->

# プレビュー・描画・エクスポート設計 (Preview, Rendering, and Export)

- Status: Draft
- Owning Issue: [Issue #118](https://github.com/puchinya/vscode-guitar-dsl/issues/118)
- Related Issue: [Issue #93](https://github.com/puchinya/vscode-guitar-dsl/issues/93)
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
| PDF、Preview playback、Practice Mode | 拡張機能仕様 §3.2、§3.14、§4.6 |

## Architecture

- `src/render/layout.ts` の `layoutScore()` はスコアをページ・シートの配置データへまとめる。改ページとレイアウト設定は表示上の境界として扱う。
- `src/render/svg.ts` はページ SVG (`renderScoreSheets()`) と連続表示 SVG (`renderContinuousSvg()`) を生成する。`src/render/previewHtml.ts` の `compileGuitarDslToHtml()` はプレビュー用 HTML と必要な UI モデルを組み立てる。
- Extension Core は文書変更・プレビュー操作を処理し、Webview に HTML/SVG を渡す。Webview の操作メッセージは拡張機能ホストに戻り、ホスト側の制御器が文書・有効 DSL とプレビュー状態を管理する。
- `src/pdf.ts` はページ SVG を `pdfkit` / `svg-to-pdfkit` でベクター PDF にする。Noto Sans JP の同梱フォントを登録し、書き出し時は一時ファイルを経て確定する設計が記録されている。
- `src/playOrder.ts::resolvePlayOrder()` は唯一の演奏順 authority、`src/playbackTimeline.ts::buildPlaybackTimeline()` は唯一の score-time authority とする。再生タイムラインは元スコアを書き換えず、別の repeat resolver や timing engine を追加しない。
- Extension Host はシングルトン Preview panel とコマンド転送だけを所有する。Playback / Practice の状態は Webview に置き、ホストは再生・seek・loop 状態を保持しない。

### レイアウトと出力の同一性

`layout.ts` は用紙座標を pt（1/72 inch）で扱い、シート SVG の `viewBox` と PDF ページを一致させる。現行レイアウトでは上下 10 mm・左右 12 mm の余白、横向きの2カラムと12 mmガターを持つ。段は既定4小節を基準幅780で組み、用紙カラムへ scale する。段ごとの高さはメロディ譜表や歌詞段数を含めて見積もる。手動 pagebreak と段高からの自動改ページを併用し、空ページでも最低1段を受け入れて無限ループを避ける。縦向きは1シートに1ページ、横向きは2ページを配置する。

ページプレビューとPDFは `renderScoreSheets()` の同一ページ SVG を共有する。Web 用 continuous モードはページを分割せず縦長 SVG を生成する。メロディ付き段では、リズムとメロディの発音位置の union を共通 x 座標列にし、両段を整列する。

### Preview 更新と PDF 出力

文書変更時に Extension Core は対象文書を確認し、`resolvePreviewEffectiveDsl()` で有効 DSL と表示用モデルを解決する。これを `compileGuitarDslToHtml()` に渡し、Compiler → layout / SVG → Preview HTML の順で生成して Panel の HTML を置き換える。Webview の用紙サイズ・向き変更は `layoutChanged` メッセージでホストへ戻し、同じ pipeline を新しい設定で再実行する。

PDF は Preview で選ばれた有効 DSL を受け取り、ページ SVG をベクターとして PDF に載せる。`writeScorePdf()` は一時ファイルへの書き込み後に rename し、不完全な最終ファイルを残さない。フォントは Noto Sans JP Regular / Bold を登録し、描画前に読み込んで PDF 内へ必要なグリフを埋め込む。

### Preview 再生

再生タイムラインは `ParsedScore.playOrder` の出現順と音価からイベント時刻とソース小節の対応を作る。Preview Webview は遅延初期化された `AudioContext` 1 つ、100 ms 先読み、25 ms interval 1 つを使う。Play / Pause / Resume / Stop / Seek は同じ score-time 上で動作し、Pause は位置を保持する。ソース編集、有効 DSL 変更、レイアウト再構築、文書切替、Panel 破棄時は予約済み音源を停止する。

### Practice Mode and runtime overlays (Issue #93)

Practice は既存 Webview transport に追加する。Practice OFF では追加行や余白を作らず、実効速度は 100%。ON では速度・Loop・A/B・Follow と出現状態を示す 42 px の Practice row を `top: 90px` に置く。Playback row は `top: 48px` に高さ 42 px で残す。OFF の本文開始はカポなし `108px` / カポあり `144px`、ON はカポなし `150px` / Practice row `90..132px`、カポあり本文 `186px` / カポ row `132px` とする。狭い幅では Practice row 自身だけを横スクロールさせ、#77 のヘルプ／PDF固定領域と Playback row を維持する。

Practice preference は 25–200% を 5% 刻みで選ぶ。値は Webview state に保存するが、Practice OFF の実効速度は 100% とする。音声時間差 `audioDelta` に対し `scoreDelta = audioDelta * speed` を使い、音源の開始・長さ、Count-in、Metronome の時間を速度で割る。ソース BPM、既存 `PlaybackTimeline`、`mm:ss` は変更しない。再生中に速度を変えるときは score position を取り、予約音源を cancel/fade して同じ score position から新しい速度で同期し直す。Count-in は再生せず、scheduler interval は増やさない。Practice を OFF にした状態で再生中なら、100% に同期し直して保存済み速度は残す。

`PlaybackOccurrence` に `sectionName?: string` を追加して `score.measures[measureIndex].sectionName` をコピーする。`PlayOrderOccurrence` は変更しない。HTML data には各 occurrence の `occurrenceIndex`、`measureIndex`、任意の `sectionName`、`startSeconds`、`durationSeconds`、`countInDurationSeconds`、`countInClicks: { timeSeconds, accent }[]` を含める。#90 との互換用にトップレベルの最初の occurrence の Count-in fields も維持する。

Measure Loop は現在の occurrence 全体、Section Loop は現在 occurrence の前後へ連続し同じ空でない `sectionName` を持つ最大範囲とする。同名で離れた Section は別範囲、連続した `Verse x2` は 1 範囲になる。編曲 call identity は作らない。Loop と A/B は `[start,end)` を使い、`{ occurrenceIndex, scoreSeconds }` を保持する。A は現在位置で B を消し、B は A より後の位置のみ受理し、どちらも小節内に置ける。Measure/Section 選択と Off/Clear/Practice OFF は A/B と loop を消す。無名 Section と無効 B は現在 loop/A を保持し、選択値を戻して状態通知する。範囲外、または新しい排他的終端上に play position がある場合、loop 有効化時に先頭へ移る。

既存 scheduler は half-open 境界でイベントを選び、loop end を越す note duration を切り詰める。Loop/A より前に開始した sustain は合成し直さない。100 ms horizon が end をまたぐ tick では、loop の末尾と折り返した先頭を同じ tick で必要なだけ schedule する。scheduler は常に最大 1 interval。Active Loop 中の seek は範囲内へ clamp し、Stop は loop start に戻す。loop の自然終端で transport は `ended` にならない。

Count-in は Practice OFF では #90 の互換動作（停止中かつ score time 0 からの Play のみ）。Practice ON では停止中の Play を seek/loop start から開始するときも、実際の開始位置を含む occurrence の meter/tempo で 1 小節分を鳴らす。pickup も meter 一小節分を使う。Resume、running Seek、速度変更、Practice toggle に伴う再同期、loop wrap では再カウントしない。Metronome は既存の group/accent semantics を保ち、速度・loop に追従して live toggle できる。

`renderSystem()` は既存 `measureBounds()` と `row.geometry.unitHeight` から、書かれた小節ごとの不可視 `playback-measure-anchor` rect を SVG に出す。各 rect は `data-measure-index` と system-local x/y/width/height を持ち、`fill="none"`、`pointer-events="none"` とする。ページ SVG と連続 SVG に metadata が含まれても PDF の可視差分はない。Webview は表示中の SVG copy の anchor のみを使い、runtime で highlight と playhead を追加・削除する。runtime overlay は SVG / PDF に恒久描画しない。

Playback 中は Practice OFF でも現在の書かれた小節と縦 playhead を表示する。Pause は固定し、Seek は即座に移し、Count-in は開始位置を示し、loop wrap は loop start へ移す。Stop では隠し、自然終了では最終位置を保持する。Single / Spread / Web は可視 anchor のみ選び、非表示 SVG copy には overlay を付けない。

Follow は Practice 専用で既定 ON。playhead / active measure が Preview の縦 20–80% safe band の外に出たときだけ Preview を scroll する。Preview の手動 scroll/navigation は Follow を OFF にする。ソース editor の selection、caret、focus、`TextEditor.revealRange()` は触らない。

`vscode.getState()/setState()` が保持する値は `currentMode`、Count-in、Metronome、`practiceEnabled`、`practiceSpeed`、`followEnabled` のみ。transport、seek、loop/A-B、overlay、nodes、`AudioContext` は保持しない。HTML rebuild（source / effective DSL / capo / beginner / layout / document switch）は transport を 0 に戻し、loop/A-B と overlay を消す一方で preferences を復元する。`pagehide` / `unload` / panel disposal cleanup は idempotent とする。

Extension Host が登録する Preview actions は `guitardsl.playback.togglePlayPause`、`guitardsl.playback.stop`、`guitardsl.practice.toggle`、`guitardsl.practice.setLoopStart`、`guitardsl.practice.setLoopEnd`、`guitardsl.practice.clearLoop`、`guitardsl.practice.slower`、`guitardsl.practice.faster`。Host は `{ command: 'playbackAction', action }` を live singleton panel に forwarding し、Webview UI と同じ handler を呼ぶ。Preview がない場合は localized warning を出し、暗黙に open/reveal しない。新しい default keybinding/settings は作らず、UI は native keyboard-operable controls を使う。

### TAB geometry and SVG (Issue #89)

`layoutScore()` remains the sole owner of row and vertical placement. `SystemGeometry` explicitly reports TAB presence, block offset and staff height; TAB lyric baseline, line height and verse count; whether an explicit rhythm staff is rendered and its final offset; and total `unitHeight`. A TAB row orders its blocks as header/section/chord labels, optional melody plus melody lyrics, TAB plus TAB lyrics, optional explicit rhythm, then dynamics/lower lanes. The six evenly spaced lines use a prominent clef-like `TAB` label and enough vertical room to keep fret digits on adjacent strings legible. The rhythm staff appears only when `show_rhythm` is true and the row contains explicitly authored rhythm. TAB's own/default duration does not create a redundant slash staff. Systems without TAB retain current geometry and rendering behavior.

`render/tabStaff.ts` consumes compiled TAB semantics and `SystemGeometry`; it does not parse source, re-resolve pitch, or calculate positions from tuning. `render/svg.ts` includes it in the existing page and continuous SVG routes. The page SVG supplied to Preview is the same page SVG supplied to `src/pdf.ts`; PDF has no TAB-specific rendering or layout path.

## Data flow and ownership

| フロー | 変換 | 結果の所有者 |
|---|---|---|
| Preview | TextDocument → Compiler → layout / SVG / HTML → Webview | 文書はテキストを、Extension Core はパネルを、Renderer は描画物を管理 |
| PDF | 有効 DSL → Compiler / `renderScoreSheets()` → PDF exporter → 保存先 | `src/pdf.ts` は VS Code に依存せず PDF bytes / write を担う。保存先選択は Extension Core |
| Playback / Practice | `ParsedScore.playOrder` / 音価 / `sectionName` → `PlaybackTimeline` と occurrence payload → Web Audio | `PlaybackTimeline` は score time、Webview は transport・Practice・overlay・音声実行を管理。Host は panel と action forwarding のみ |

プレビューでの一時カポや初心者モードは、対象の有効 DSL / UI モデルをホストが解決して描画へ渡す。正式な保存変換と一時表示変換の契約は拡張機能仕様に従う。

## Failure handling

For TAB source, Preview does not synthesize an effective DSL by applying a non-identity capo, transpose, or beginner chord substitution. Transform services return `tabTransformUnsupported`; Preview follows its existing warning/reset path and renders the original source. No partial rewrite is displayed. Identity requests remain valid when both pitch and capo are unchanged.

Compiler 診断、レイアウト・SVG 生成、フォント初期化、PDF 書き込み、Webview メッセージ、再生状態はそれぞれの担当層で扱う。PDF のフォント読み込み失敗を無視して代替フォントで続行すると文字化けし得るため、現在の設計は描画前にフォントを明示的に読み込む。その他の失敗時に表示する文言や部分描画規則は仕様・実装を参照し、ここでは追加しない。

source/effective DSL 再構築時は occurrence index を古い loop point とともに破棄し、推測で再解決しない。再生不可、無名 Section、`B <= A` は部分状態を適用せず、既存有効状態を保持して localized status を返す。

## Alternatives considered

既存資料にはページ SVG / 連続 SVG と Webview / PDF の分担が記録されているが、Canvas 等の比較検討や全選定根拠は残っていない。

## Verification strategy

ページ配置、SVG、Preview HTML、PDF、playback timeline / Web Audio runtime のユニット検証に加え、Practice speed、occurrence loop、half-open scheduler wrap、Count-in、Follow、rebuild cleanup、commands / accessibility の契約テストを実行する。Visual acceptance は Practice OFF playback、Practice ON loop、約 365 CSS px の narrow row の Issue 添付 preview 画像で確認する。今回の文書検証では Schema 2 validator と `git diff --check` を実行する。Help / AI 同期は関連資産のゲートで確認する。
