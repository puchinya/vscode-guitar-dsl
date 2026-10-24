<!-- agent-doc-type: design -->
<!-- agent-doc-schema: 2 -->

# プレビュー・描画・エクスポート設計 (Preview, Rendering, and Export)

- Status: Draft
- Owning Issue: [Issue #118](https://github.com/puchinya/vscode-guitar-dsl/issues/118)
- Related Issue: [Issue #93](https://github.com/puchinya/vscode-guitar-dsl/issues/93)
- Related Issue: [Issue #134](https://github.com/puchinya/vscode-guitar-dsl/issues/134)
- Related Issue: [Issue #135](https://github.com/puchinya/vscode-guitar-dsl/issues/135)
- Related Issue: [Issue #136](https://github.com/puchinya/vscode-guitar-dsl/issues/136)
- Related Issue: [Issue #145](https://github.com/puchinya/vscode-guitar-dsl/issues/145)
- Related specification: [Extension specification](../specs/extension.md), [GuitarDSL syntax specification](../specs/guitardsl-syntax.md)
- System context: [Architecture](architecture.md)

## Context and goals

同じ GuitarDSL スコアを Webview のプレビューと PDF で表示し、ページ表示と連続表示のレイアウト、およびプレビュー再生を提供する内部経路を記録する。表示要件の正本は[拡張機能仕様](../specs/extension.md)と[言語構文仕様](../specs/guitardsl-syntax.md)である。

## Requirements traceability

| 仕様上の要件 | 対象 |
|---|---|
| 表示・レイアウト規則、調号・表示設定 | 言語構文仕様 §11、§14 |
| 六線 TAB、TAB 歌詞、明示リズムとの同居 | 言語構文仕様 §19 / [TAB notation](tab-notation.md) |
| プレビュー更新、UI、レンダリング、一時カポ・初心者設定 | 拡張機能仕様 §3.1、§4、§4.4–§4.5 |
| TAB Preview、PDF 同一性、変換制限 | 拡張機能仕様 §4.7、§4B.6 |
| PDF、Preview playback、Practice Mode | 拡張機能仕様 §3.2、§3.14、§4.6 |
| コード進行の melody-aware audition と A/B | Issue #129、拡張機能仕様 §3.17、§4.8 |
| Inspector の設定比較、Preview state restore、進行との排他 | Issue #135、拡張機能仕様 §4B、§4D |
| Preview toolbar の transport / disclosure、Practice 行、layout focus restore | Issue #136、拡張機能仕様 §4.2、§4.6 |

## Architecture

- `src/render/layout.ts` の `layoutScore()` はスコアをページ・シートの配置データへまとめる。改ページとレイアウト設定は表示上の境界として扱う。
- `src/render/svg.ts` はページ SVG (`renderScoreSheets()`) と連続表示 SVG (`renderContinuousSvg()`) を生成する。`src/render/previewHtml.ts` の `compileGuitarDslToHtml()` はプレビュー用 HTML と必要な UI モデルを組み立てる。
- Extension Core は文書変更・プレビュー操作を処理し、Webview に HTML/SVG を渡す。Webview の操作メッセージは拡張機能ホストに戻り、ホスト側の制御器が文書・有効 DSL とプレビュー状態を管理する。
- `src/pdf.ts` はページ SVG を `pdfkit` / `svg-to-pdfkit` でベクター PDF にする。Noto Sans JP の同梱フォントを登録し、書き出し時は一時ファイルを経て確定する設計が記録されている。
- `src/playOrder.ts::resolvePlayOrder()` は唯一の演奏順 authority、`src/playbackTimeline.ts::buildPlaybackTimeline()` は唯一の score-time authority とする。再生タイムラインは元スコアを書き換えず、別の repeat resolver や timing engine を追加しない。
- リズム符タイ（Issue #142）の接続関係は Compiler が検証する。`src/render/svg.ts` はその関係を既存の `rhythmHeads()` / `renderTieArc()` で描き、小節間の連桁は作らない。段・ページをまたぐ弧は各 system の端で分割し、Preview と PDF が同じ SVG を使う境界を保つ。
- Extension Host はシングルトン Preview panel とコマンド転送だけを所有する。Playback / Practice の状態は Webview に置き、ホストは再生・seek・loop 状態を保持しない。

### レイアウトと出力の同一性

`layout.ts` は用紙座標を pt（1/72 inch）で扱い、シート SVG の `viewBox` と PDF ページを一致させる。現行レイアウトでは上下 10 mm・左右 12 mm の余白、横向きの2カラムと12 mmガターを持つ。段は既定4小節を基準幅780で組み、用紙カラムへ scale する。段ごとの高さはメロディ譜表や歌詞段数を含めて見積もる。手動 pagebreak と段高からの自動改ページを併用し、空ページでも最低1段を受け入れて無限ループを避ける。縦向きは1シートに1ページ、横向きは2ページを配置する。

ページプレビューとPDFは `renderScoreSheets()` の同一ページ SVG を共有する。Web 用 continuous モードはページを分割せず縦長 SVG を生成する。メロディ付き段では、リズムとメロディの発音位置の union を共通 x 座標列にし、両段を整列する。

### Preview 更新と PDF 出力

文書変更時に Extension Core は対象文書を確認し、`resolvePreviewEffectiveDsl()` で有効 DSL と表示用モデルを解決する。これを `compileGuitarDslToHtml()` に渡し、Compiler → layout / SVG → Preview HTML の順で生成して Panel の HTML を置き換える。Webview の用紙サイズ・向き変更は `layoutChanged` メッセージでホストへ戻し、同じ pipeline を新しい設定で再実行する。

### Preview toolbar composition (Issue #136)

`previewHtml.ts` keeps a fixed 48 px playback row followed immediately by a fixed 44 px score-settings row. Play, Pause, Stop, seek, and elapsed/total time stay in the playback row even when playback is unavailable; localized status text is in normal document flow before the score and has no reserved height while empty. Practice is a separate fixed 42 px row at `top: 92px`, rendered only while enabled. Keeping the existing 18 px content gap yields body top padding of 110 px with Practice off and 152 px with it on.

Count-in and Metronome live in the nonmodal Playback settings disclosure. Display mode, paper size, orientation, and PDF save live in View & Export. The score-settings row keeps Capo, colored Playability, and Beginner controls directly operable at every supported width. At 840 CSS px and above it also exposes barre policy, automatic/fixed capo selection, and Inspector detail links. Below 840 px these supplemental actions live in an accessible overflow group. The row never displays the text “Temporary Score Settings.” Playability uses the host's authoritative score and level plus text and color: veryEasy/easy are green `#2e7d32`, moderate is ochre `#8d6e00`, hard/veryHard are red `#b71c1c`, and unavailable is neutral. Color never carries meaning by itself. Playback and View & Export disclosures each use `button[aria-expanded][aria-controls]` controlling a hidden labelled group, never a menu. Only one disclosure can be open; Escape closes and returns focus to its active trigger, while outside pointer/focus closes without moving focus. Closed controls are excluded from tab order and the accessibility tree. Disclosure state does not trigger an HTML rebuild or alter the playback timeline. PDF uses the existing exporter and effective DSL.

Paper and orientation keep the existing `layoutChanged` host route and rebuild the HTML/SVG. Score-setting controls use typed host messages and rebuild the same Preview only after the host validates action, supported candidate, document URI, version, and Preview generation. Unsupported or malformed messages return before controller, Inspector session, or pending focus-restoration state changes. A one-shot restore hint carries an allowlisted control ID plus the current document URI, version, and Preview generation. The host accepts it only from the current rendered document and consumes it only when a valid action is accepted and rendered; an invalid message does not discard it. Source update, document switch, panel disposal, or a newer explicit user action makes the hint stale. The rebuilt page focuses the requested control, falling back to its visible control if the target is unavailable. This does not persist another Webview state value or change audio ownership.

The 48 px playback row retains transport, playback settings, View & Export, and Help. The 44 px score-settings row always contains the direct Capo, Playability, and Beginner controls, including at the 421 px verification width; supplemental controls may scroll or move to accessible overflow. The 42 px Practice row appears only while Practice is enabled. Inspector owns detailed Capo and Beginner comparison and the only DSL Apply surface. Preview score settings expose transient selections and summary state while effective DSL resolution remains shared with Preview and PDF.

### Practice guide timeline (Issue #153; historical layout)

> Issue #155 supersedes this section's detailed-by-default display choice, continuous-scroll default, compact-window behavior, and diagram size. The current compact page and bank projection are defined in “Practice guide page projection and SVG strokes (Issue #155)” below. Fraction positioning, lane alignment, and `PlaybackTimeline` ownership remain applicable where they do not conflict.

`docs/specs/gui_design.md` §2.4 and `docs/specs/extension.md` §4.6 own the visible lane and score-time contract. `buildPracticeGuideData()` projects the compiler's written measure, melody, lyric, chord, rhythm, and TAB data; it does not become a second event or timing authority. Preserve Fraction starts and ends until the shared coordinate transform maps score beats into CSS pixels. The transform lays all written measures into one horizontal axis and is reused by melody bars, lyric syllables, technique marks, chord labels, chord diagrams, measure boundaries, and the playhead.

The guide DOM keeps one fixed label rail at the left and the next-chord aside at the right, outside the axis scroller. Only the timeline viewport has `overflow-x`; auto-follow changes its `scrollLeft` without scrolling the document. `PlaybackTimeline` remains the score-time and occurrence authority. The existing Preview Webview reads current `PlaybackPosition` / `PlaybackOccurrence` state and projects it through the same score-beat-to-x function; current event classes and the common playhead update with transport state, including pause, seek, speed resynchronization, loop wrap, and stop. No guide interval, Webview, or audio owner is introduced.

The same Preview also exposes a per-document temporary display-mode selector: detailed timeline (default) or compact four-measure overview. Compact mode projects each written measure into one card containing ordered chord-span groups, compact attack/continuation/rest/mute/string symbols, chord names, and the existing generated chord-diagram SVGs. A chord carries into a measure when no new chord starts there. Compact mode renders at most one `〜` per sustained written rhythm event, regardless of the selected grid, so the overview does not repeat every subdivision cell; detailed mode retains every continuation cell from its selected grid. Compact mode does not project melody or lyric lanes, fixed rails, next-chord aside, beat grid, or a horizontal scroller. Cards use a four-column grid from 840 CSS px and a two-by-two grid below it; diagrams shrink within the card without clipping.

The compact window starts at measure 1. Its displayed measures and previous/next controls are state only; playback positions still come from the current occurrence. When playback enters the third measure in a displayed window, the window advances by two measures. A seek aligns the window to the sought measure, and a backward time movement (including a loop wrap) reselects that measure's overlapping two-measure window. At the end, clamp the start to the last complete window and omit nonexistent cards. Event highlighting is projected from the same occurrence and current-beat calculation as the detailed timeline. Neither display mode nor window navigation modifies DSL, `PlaybackTimeline`, score SVG, or PDF.

Melody entries keep note pitch and written duration; each pitch becomes a duration-scaled rectangle on a score-wide pitch scale. Lyric entries keep their syllable-to-note association and duration, including extensions. DOM and rendered-screen verification cover the full viewport, locale, theme, and melody-visibility matrix. The tests check containment, common x positions, text spacing, current-event projection, and the stationary next-chord name; screenshots are compared against the approved GUI specification rather than accepted by existence or byte count.

For the Issue #153 responsive presentation, the shared coordinate map uses a base scale of 80 CSS px per quarter note (20 px per sixteenth). The viewport presents as many complete measures as fit at that scale: at least two 4/4 measures at 1100 CSS px and three at 1400 CSS px. It does not change written grid resolution to meet the viewport. Only a real label or diagram collision may widen the same shared axis; the guide then scrolls horizontally and follows the existing playback position. Timeline chord diagrams use 160 × 90 CSS px and a diagram lane at least 112 px high, with the chord name in the immediately preceding lane. Lyrics retain written note timing and expose played/current/next states at 18/24 px; melody bars are at least 12 px high on a visible pitch scale. Technique highlighting selects one current written subdivision at a time, independently of the sustained audio event, while the existing playback timeline remains the sole clock.

The fixed Practice panel sizes itself to its content: the header plus the maximum measured height of the aligned label rail, timeline lanes, and next-chord aside, with only intentional padding. Its maximum height preserves 160 CSS px for the score below the existing toolbars when the viewport is at least 700 CSS px tall; on shorter viewports it reserves `max(80px, 20% viewport height)` for the score. If content exceeds that cap, the entire panel body scrolls vertically while the header stays visible and only the central timeline scrolls horizontally. A disposable `ResizeObserver` measures the panel border box and synchronizes `body` bottom padding after resize, document rebuild, melody or diagram visibility changes, and collapse. Collapse is exactly 42 CSS px and leaves only the title and expand control visible.

The Practice guide uses the approved fixed palette across light and dark editor themes: white (`#ffffff`) panel, lower lanes, and fixed columns; header `#243953`; melody lane `#173149`; and lyrics lane `#1b344d`. Chord-diagram cards are white with `#d2dde9` borders. Subdivision grid lines are hidden; measure boundaries and the playback head remain. The visible fretboard strings are centered under their chord names.

Each timeline chord name and its 160 × 90 CSS px diagram share one 160 CSS px positioning box at the same score-time x anchor. The label is centered over the diagram, and edge alignment moves the shared box so both remain visible. The center offset is at most 2 CSS px and chord pairs do not overlap. Visual acceptance includes a same-DSL, same-position, same-width, same-theme reference comparison, with every observed difference classified as layout, color, size, alignment, or clipping.

### Preview score-settings row (Issue #145)

The disclosure reuses the host's `CapoPreviewUiModel` and `BeginnerPreviewUiModel`; the renderer does not infer recommendations. It shows all capo values from 0–12 and disables unsupported candidates. The existing native `select#preview-capo-select` keeps its compact closed width and shows only the number while closed, since the adjacent label already says Capo. Expanded option labels also start with the number only, followed by the host score and localized level, plus a recommendation suffix only for the recommended candidate (for example, “2 · 85/100 · Very easy · ★ Recommended”). If either score or level is missing, the expanded option shows the localized unavailable text and does not invent a score. Unsupported candidates remain present and disabled, while the numeric capo remains the option value. The open native list must make the full candidate details readable at each verified CSS viewport. Beginner starts with barre chords forbidden and automatic recommended capo. Switching barre policy returns capo selection to automatic; switching Beginner off restores source DSL. Substitutions and existing warnings are shown when present. At widths of 840 CSS px and above, an info/warning button appears in the existing settings row only when either is present; it opens the existing panel as a nonmodal, information-only region. Below 840 CSS px, **More** opens the same content with the existing supplemental controls. Neither route adds a row or reserves space when no detail content exists. Both routes expose an accessible name and expanded state, support keyboard opening and Escape, and retain the 44 px settings-row geometry.

The Preview Webview sends only typed action values and its rendered URI/version/generation identity. Host validation rejects stale or malformed actions before routing accepted settings through the existing preview controllers and Inspector invalidation path. Preview settings never edit source text or expose DSL Apply/Cancel controls. Keyboard focus is restored once to the corresponding direct control after a valid host update. Rejected messages leave any pending valid focus-restoration hint intact.

PDF は Preview で選ばれた有効 DSL を受け取り、ページ SVG をベクターとして PDF に載せる。`writeScorePdf()` は一時ファイルへの書き込み後に rename し、不完全な最終ファイルを残さない。フォントは Noto Sans JP Regular / Bold を登録し、描画前に読み込んで PDF 内へ必要なグリフを埋め込む。

### Preview 再生

再生タイムラインは `ParsedScore.playOrder` の出現順と音価からイベント時刻とソース小節の対応を作る。Preview Webview は遅延初期化された `AudioContext` 1 つ、100 ms 先読み、25 ms interval 1 つを使う。Play / Pause / Resume / Stop / Seek は同じ score-time 上で動作し、Pause は位置を保持する。ソース編集、有効 DSL 変更、レイアウト再構築、文書切替、Panel 破棄時は予約済み音源を停止する。

有効なリズム符タイは `buildPlaybackTimeline()` の一つの rhythm attack にまとめる。`durationBeats` は連鎖の Fraction 和、`durationSeconds` は連鎖した各小節の有効 BPM で個別に換算した秒数の和とする。演奏順の隣接 occurrence が書面小節でも隣接している場合だけ小節間を接続し、repeat / volta / navigation の飛び先では通常の攻撃音に戻す。Practice loop がタイの継続小節から始まるときは、同じ保持時間データからその小節頭の再アタックを使い、連鎖元を含む loop は既存どおり終端で音を切り詰める。

### Rhythm-tie rendering (Issue #142)

Rhythm ties use the already compiled event relationship and notation heads. A connection within one system joins the final head of the source event to the first head of its target; the existing compound-duration ties remain separate. Connections crossing a system or page edge are rendered as two clipped arcs at the respective row edges. Beam groups remain measure-local, and a valid continuation has no down/up attack marker.

### Practice Mode and runtime overlays (Issue #93)

Practice は既存 Webview transport に追加する。Practice OFF では追加行や余白を作らず、実効速度は 100%。ON では速度・Loop・A/B・Follow と出現状態を示す 42 px の Practice row を、高さ 44 px の Score Settings row の直下 `top: 92px` に置く。高さ 48 px の playback row と Score Settings row は常に残る。既存 18 px の内容余白込みで本文開始は Practice OFF `110px`、ON `152px`。狭い幅では Practice row 自身を横スクロールさせる。

Practice preference は 25–200% を 5% 刻みで選ぶ。値は Webview state に保存するが、Practice OFF の実効速度は 100% とする。音声時間差 `audioDelta` に対し `scoreDelta = audioDelta * speed` を使い、音源の開始・長さ、Count-in、Metronome の時間を速度で割る。ソース BPM、既存 `PlaybackTimeline`、`mm:ss` は変更しない。再生中に速度を変えるときは score position を取り、予約音源を cancel/fade して同じ score position から新しい速度で同期し直す。Count-in は再生せず、scheduler interval は増やさない。Practice を OFF にした状態で再生中なら、100% に同期し直して保存済み速度は残す。

`PlaybackTimeline` は `ParsedScore.measures` を書かれた順に一度走査し、非空の `MeasureData.sectionName` 開始マーカーを次の非空マーカーまで前方伝播して、書かれた小節ごとのセクション所属を正規化する。先頭マーカーより前は無所属とする。各 `PlaybackOccurrence.sectionName` は開始マーカーのコピーではなく、この所属表を `played.measureIndex` で引いて設定する。`PlayOrderOccurrence` と編曲 lower の意味は変更しないため、反復や編曲で生じる各出現は書かれた元小節の所属を引き継ぐ。HTML data には各 occurrence の `occurrenceIndex`、`measureIndex`、任意の解決済み `sectionName`、`startSeconds`、`durationSeconds`、`countInDurationSeconds`、`countInClicks: { timeSeconds, accent }[]` を含める。#90 との互換用にトップレベルの最初の occurrence の Count-in fields も維持する。

Measure Loop は現在の occurrence 全体、Section Loop は現在 occurrence の前後へ連続し同じ空でない `sectionName` を持つ最大範囲とする。同名で離れた Section は別範囲、連続した `Verse x2` は 1 範囲になる。編曲 call identity は作らない。Loop と A/B は `[start,end)` を使い、`{ occurrenceIndex, scoreSeconds }` を保持する。A は現在位置で B を消し、B は A より後の位置のみ受理し、どちらも小節内に置ける。Measure/Section 選択と Off/Clear/Practice OFF は A/B と loop を消す。無名 Section と無効 B は現在 loop/A を保持し、選択値を戻して状態通知する。範囲外、または新しい排他的終端上に play position がある場合、loop 有効化時に先頭へ移る。

既存 scheduler は half-open 境界でイベントを選び、loop end を越す note duration を切り詰める。Loop/A より前に開始した sustain は合成し直さない。100 ms horizon が end をまたぐ tick では、loop の末尾と折り返した先頭を同じ tick で必要なだけ schedule する。scheduler は常に最大 1 interval。Active Loop 中の seek は範囲内へ clamp し、Stop は loop start に戻す。loop の自然終端で transport は `ended` にならない。

Count-in は Practice OFF では #90 の互換動作（停止中かつ score time 0 からの Play のみ）。Practice ON では停止中の Play を seek/loop start から開始するときも、実際の開始位置を含む occurrence の meter/tempo で 1 小節分を鳴らす。pickup も meter 一小節分を使う。Resume、running Seek、速度変更、Practice toggle に伴う再同期、loop wrap では再カウントしない。Metronome は既存の group/accent semantics を保ち、速度・loop に追従して live toggle できる。

`renderSystem()` は既存 `measureBounds()` と `row.geometry.unitHeight` から、書かれた小節ごとの不可視 `playback-measure-anchor` rect を SVG に出す。各 rect は `data-measure-index` と system-local x/y/width/height を持ち、`fill="none"`、`pointer-events="none"` とする。`data-playback-duration-beats` は実際の小節拍数、`data-playback-columns` は描画に使うのと同じ `computeMeasureColumns()` の拍・x 座標を記録する。メロディなしの Lead Sheet の beat slash は描画と同じ列ヘルパーで記録する。Webview はこの列で再生ヘッドを補間し、記譜された開始拍では音符・リズム符の x に一致させる。列の間はスコア時刻に沿って進み、最後の列から小節末までは小節右端へ進む。ページ SVG と連続 SVG に metadata が含まれても PDF の可視差分はない。Webview は表示中の SVG copy の anchor のみを使い、runtime で highlight と playhead を追加・削除する。runtime overlay は SVG / PDF に恒久描画しない。

Playback 中は Practice OFF でも現在の書かれた小節と縦 playhead を表示する。Pause は固定し、Seek は即座に移し、Count-in は開始位置を示し、loop wrap は loop start へ移す。Stop では隠し、自然終了では最終位置を保持する。Single / Spread / Web は可視 anchor のみ選び、非表示 SVG copy には overlay を付けない。

Follow は Practice 専用で既定 ON。playhead / active measure が Preview の縦 20–80% safe band の外に出たときだけ Preview を scroll する。Preview の手動 scroll/navigation は Follow を OFF にする。ソース editor の selection、caret、focus、`TextEditor.revealRange()` は触らない。

`vscode.getState()/setState()` が保持する値は `currentMode`、Count-in、Metronome、`practiceEnabled`、`practiceSpeed`、`followEnabled` のみ。transport、seek、loop/A-B、overlay、nodes、`AudioContext` は保持しない。HTML rebuild（source / effective DSL / capo / beginner / layout / document switch）は transport を 0 に戻し、loop/A-B と overlay を消す一方で preferences を復元する。`pagehide` / `unload` / panel disposal cleanup は idempotent とする。

Extension Host が登録する Preview actions は `guitardsl.playback.togglePlayPause`、`guitardsl.playback.stop`、`guitardsl.practice.toggle`、`guitardsl.practice.setLoopStart`、`guitardsl.practice.setLoopEnd`、`guitardsl.practice.clearLoop`、`guitardsl.practice.slower`、`guitardsl.practice.faster`。Host は `{ command: 'playbackAction', action }` を live singleton panel に forwarding し、Webview UI と同じ handler を呼ぶ。Preview がない場合は localized warning を出し、暗黙に open/reveal しない。新しい default keybinding/settings は作らず、UI は native keyboard-operable controls を使う。

### Practice guide and accompaniment voice events (Issue #153)

`src/practiceGuide.ts` は `ParsedScore` から固定ガイド用データを純粋に作る。Compiler が保持する Fraction onset、元イベント、source span、コードコンテキストを使い、ガイドは playback order の `occurrenceIndex` に同期する。表示密度は全曲で一括決定し、手動分割と自動判定は Preview 文書別 Webview state に保存する。これらの表示設定は DSL、譜面 SVG/PDF、`PlaybackTimeline` を変更しない。

Practice ON では既存の48 px playback row、44 px score-settings row、42 px Practice rowを維持し、歌詞・奏法・コード名・図と次コードを下端固定ガイドに表示する。メロディ表示設定はメロディ行だけを出し入れする。通常の譜面と PDF に追加されるのは既存ページ SVG の通常記譜であり、音価継続の `〜` は固定ガイドだけに描画する。コード図は共有 chord voicing を使い、6弦を水平線、フレット区切りを垂直線で表す。

奏法行の有音イベントはスコア時刻に一度だけ攻撃記号を置き、後続の選択グリッドスロットに音価継続 `〜` を配置する。タイ継続イベントは開始位置も `〜` として再攻撃を表さない。グリッドごとの継続位置は Fraction から計算し、連符の局所比を維持する。消音 `.m` と休符 `rN` は独立した記号で、持続マーカーを作らない。ブラッシングとスタッカートも継続マーカーを作らない。手動グリッド選択は表示する継続スロットだけを変える。

Web Audio は既存 Preview の所有者と generation cleanup を維持する。`.m` は同じギター伴奏バスの active voice と最大120 ms程度の release tail だけを停止し、クリック防止の fade は最大8 msとする。`.b`、`.m`、`.sN` を含む新奏法の譜面だけがこの尾部を使い、既存譜面の音響包絡は変えない。メロディ、メトロノーム、他の Preview/Inspector セッションは対象外である。`.b` は短い非調和の打音、`.sN` はフォーム・調弦・カポに解決した単一弦音を予約する。Seek、Loop、速度変更、停止、再構築、破棄では旧 generation の予約を cancel/fade し、複数 dispose に安全に声部を解放する。

### Practice guide page projection and SVG strokes (Issue #155)

`src/practiceGuide.ts` remains a pure projection layer. `projectPracticeGuidePage(occurrences, occurrenceIndex, capacity)` projects up to four actual occurrences, preserves each occurrence's written `measureIndex` and `lyricVerse`, and assigns internal left/right bank IDs. The compact UI always requests capacity four; a narrow viewport or dense content uses the page's horizontal scroller instead of reducing capacity or diagram size. `selectPracticeGuideCapacity(...)` therefore returns four for every viewport. `PlaybackTimeline.occurrences` remains the sole ordering and score-clock authority; no second resolver, timer, or audio owner is introduced.

At the fixed four-measure page, `floor(occurrenceIndex / 2)` selects the active side: even pairs keep the current pair on the left and odd pairs keep it on the right. The opposite bank contains the next pair. Entering an odd-measure boundary updates only that opposite bank. Current-bank nodes, geometry, playhead, and lyric highlight remain stable. Two layers for the updating bank share one coordinate box; the old layer is `aria-hidden`, inert/non-interactive, and removed after an opacity-only 220 ms `ease-in-out` transition. A generation token rejects stale completion callbacks. Seek, loop wrap, Stop→Play, source/document rebuild, and disposal cancel all frame, transition, and fallback handles and immediately project the latest occurrence. Pause/Resume and speed change do not cause a page transition. Reduced motion changes the duration to zero.

Within each measure, chord names and diagrams share the midpoint of their chord span. A span starts at the chord event and ends at the next chord event or the measure end. The measured card width keeps a 144 px diagram inside its measure; when several spans are too close, the card grows and the four-measure page remains horizontally scrollable.

`src/render/practiceGuideStrokeSvg.ts` draws down/up arrows, hold waves, mute dots, brush marks, and accessible descriptions as SVG geometry. Visible arrows and waves never use Unicode glyph rendering or CSS `content`; `.pm` keeps its visible `PM` text and vector arrow, `.sN` shows its string number, and rests use duration-specific notation. A wave means only written duration or a valid tie continuation. Compact projection emits at most one wave for one sustained event; quarter attacks (`4.d`) get one wave on 4/8/16 grids, eighth attacks (`8.d`) get one on a 16 grid but none on an 8 grid, and sixteenth attacks (`16.d`) get none on a 16 grid. A TAB/rhythm tie emits its single tie SVG without an additional grid wave. It does not infer empty strums or add repeated subdivision markers. `renderPracticeStringDiagram` changes only the Practice diagram to a centered 144×144 square using the shared voicing. The normal score SVG and PDF routes are unchanged.

The compact panel keeps the five shared lanes in specification order and the next-chord aside fixed at the right. It always projects four measures when available, keeps the 144 px diagrams full size, and scrolls horizontally when content does not fit. The detailed-grid mode retains Issue #153's existing grid projection. Display controls remain inside the existing Practice settings UI; page choice is temporary per Preview document.

Compact technique width comes from the same `practiceGuideStrokeVisualWidth()` function used by the SVG renderer. It includes the full brush and tie viewports, the PM label, its gap and arrow, and the widest eligible single duration wave so changing the selected grid does not move later marks. Every compact technique onset uses one left-edge anchor: the SVG attack starts at the Fraction onset and its duration wave extends right. Card sizing and row allocation use that same left-anchored rendered extent, with a 3 px source-space gap so at least 2 px remains at the 80% minimum scale. Distinct onsets in a single voice therefore stay in one row; truly simultaneous events from separate voices may use separate rows. The 28 px symbols use a 31 px row pitch, preserving at least 2 px between rows at the 80% minimum scale; the maximum compact technique height is shared by all measure cards and the fixed technique label rail, while detailed-grid height remains independent. When compact content is scaled down, the label rail uses the same scale and vertical offset so matching lane boundaries stay within 1 CSS px. Quarter attacks get the special one-wave display only when the source event allows duration continuation; brush/percussive, mute, rest, staccato, and tie events do not gain a wave through that exception. E2E checks compare visible same-layer symbol DOMRects, verify one-row quarter patterns and Fraction onset alignment within 2 px, and check lane/card bounds at 4/8/16 grids and 280/320/421/600/1400/1600 CSS px. Rendered screenshots are inspected alongside those geometry checks.

For Preview widths below 421 CSS px, the left label rail and the complete four-slot strip use the same `max(0.8, width / 421)` scale; the next-chord rail and controls retain their size. `#practice-guide-pair-page.clientWidth` is the fit reference. When the scaled stable strip fits, one common inset centers both banks and their gap; when it overflows, inset is zero. Resize and visibility use transformed DOMRects. If the strip overflows, only an occurrence change at a measure start may instantly adjust `scrollLeft` to show the active occurrence; a mid-measure playhead update never scrolls. When all four slots fit, no auto-scroll occurs. English narrow labels use short visual text without splitting words, while full accessible names and lane order remain unchanged. Hiding melody removes its row height from the compact stage and fixed panel.

### TAB geometry and SVG (Issue #89)

`layoutScore()` remains the sole owner of row and vertical placement. `SystemGeometry` explicitly reports TAB presence, block offset and staff height; TAB lyric baseline, line height and verse count; whether an explicit rhythm staff is rendered and its final offset; and total `unitHeight`. A TAB row orders its blocks as header/section/chord labels, optional melody plus melody lyrics, TAB plus TAB lyrics, optional explicit rhythm, then dynamics/lower lanes. The six evenly spaced lines use a prominent clef-like `TAB` label and enough vertical room to keep fret digits on adjacent strings legible. The rhythm staff appears only when `show_rhythm` is true and the row contains explicitly authored rhythm. TAB's own/default duration does not create a redundant slash staff. Systems without TAB retain current geometry and rendering behavior.

`render/tabStaff.ts` consumes compiled TAB semantics and `SystemGeometry`; it does not parse source, re-resolve pitch, or calculate positions from tuning. `render/svg.ts` includes it in the existing page and continuous SVG routes. The page SVG supplied to Preview is the same page SVG supplied to `src/pdf.ts`; PDF has no TAB-specific rendering or layout path.

### Chord progression audition (Issue #129)

`src/progressionAssistant.ts` owns an ephemeral session keyed to the current document URI/version and candidate IDs. The CodeLens opens the common Inspector, whose host-owned candidate list and operation controls send only bounded actions and candidate IDs. `TextEditorDecorationType` shows the selected candidate without editing the source. The Preview has no duplicate progression editing form. The host builds B's temporary DSL in memory from a validated source-edit plan, parses it, and supplies canonical A/B `PlaybackTimeline` event payloads to the Inspector. A is the ordinary source timeline. Selecting A or B or another candidate stops scheduled Inspector sound and synchronizes the same Preview's displayed side only when that Preview already shows this session. These operations do not start playback or open Preview.

Progression audition uses a transient AudioContext and scheduler in the Inspector Webview. Its Play click calls `resume()` on that context synchronously before the asynchronous Host request, preserving the browser activation delivered to that Webview. The Extension Host grants an exclusive playback lease only after it locks Preview start actions, stops current Preview audio, and receives a stop acknowledgement. A missing or stale acknowledgement never starts Inspector audio. Preview remains the owner of ordinary playback and Practice; the Host lease prevents simultaneous execution and is released on natural completion, Stop, context change, cancellation, invalidation, or teardown. Release unlocks Preview without resuming its previous position. A candidate occurrence range is resolved from canonical `PlaybackTimeline.occurrences`; if its performance occurrences are noncontiguous, v1 offers full-song audition only. A single-chord audition selects the chronologically earliest eligible rhythm attack in its occurrence, including a tie-continuation restart. Bars and melody auditions prepend one restart when the selected range begins at a tie continuation, then clip it to the range end. Switching side or candidate stops/fades scheduled Inspector nodes while retaining the session; changing mode or speed stops/fades scheduled nodes. The selected mode and 50/75/100/125/150% audition speed are reported to and retained by the host session; they are not written to `vscode.getState`, BPM or the timeline. Source edits, document switches, Inspector/Preview disposal, or lease revocation stop/fade the relevant audio and clear editor decorations and ephemeral session state. Preview preferences survive. Audio errors are localized while candidate selection and apply remain available.

### Settings comparison (Issue #135)

The host projects Capo and Beginner candidate selections through the existing PreviewCapoController and PreviewBeginnerController only for an already-open Preview that displays the settings session's target URI. Selecting a candidate never opens Preview. If the user explicitly opens that document's Preview during the settings session, the host snapshots its current overrides and projects the current settings draft; Cancel restores the state from immediately before the Preview opened. Preview and PDF continue to resolve the same effective DSL through resolvePreviewEffectiveDsl.

On settings-session entry, the host snapshots the target URI's temporary Preview overrides. Cancel, settings-section navigation, or session invalidation restores that snapshot only if no independent Preview action has superseded it. A direct Preview action invalidates the settings session and remains in effect; stale cleanup must not overwrite it. Transpose shows its mapping and warnings without a temporary Preview transform. After Transpose Apply, existing capo or beginner overrides are recomputed from the new source text.

Settings and progression are mutually exclusive Inspector sessions. Moving from progression to settings keeps the existing Preview lock until the audio stop acknowledgement arrives. The progression session retains its Inspector-local AudioContext and Host lease; this settings transition does not create another audio owner or change ordinary Preview playback and Practice.

## Data flow and ownership

| フロー | 変換 | 結果の所有者 |
|---|---|---|
| Preview | TextDocument → Compiler → layout / SVG / HTML → Webview | 文書はテキストを、Extension Core はパネルを、Renderer は描画物を管理 |
| PDF | 有効 DSL → Compiler / `renderScoreSheets()` → PDF exporter → 保存先 | `src/pdf.ts` は VS Code に依存せず PDF bytes / write を担う。保存先選択は Extension Core |
| Playback / Practice | `ParsedScore.playOrder` / 音価 / `sectionName` → `PlaybackTimeline` と occurrence payload → Preview Web Audio | `PlaybackTimeline` は score time、Preview Webview は通常 transport・Practice・overlay・音声実行を管理。Host は panel と action forwarding を管理 |
| Practice page display | `PlaybackTimeline.occurrences` → pure page projection → Preview bank DOM / SVG geometry | `src/practiceGuide.ts` owns page membership and internal bank IDs; Preview Webview owns DOM layers, transition generation, accessibility state, and cleanup |
| Inspector progression audition | Validated source/candidate → canonical `PlaybackTimeline` event payload → Inspector Web Audio | Inspector Webview は一時 audition のみを管理。Extension Host は Preview 停止確認付き exclusive lease を管理し、最大1つの Webview playback owner を許可 |
| Inspector settings comparison | URI-scoped settings candidate → existing Preview capo/beginner override → shared effective DSL | Settings controller owns snapshot/restore precedence; Preview/PDF rendering remains shared and candidate changes do not edit source |

プレビューでの一時カポや初心者モードは、対象の有効 DSL / UI モデルをホストが解決して描画へ渡す。正式な保存変換と一時表示変換の契約は拡張機能仕様に従う。

## Failure handling

For TAB source, Preview does not synthesize an effective DSL by applying a non-identity capo, transpose, or beginner chord substitution. Transform services return `tabTransformUnsupported`; Preview follows its existing warning/reset path and renders the original source. No partial rewrite is displayed. Identity requests remain valid when both pitch and capo are unchanged.

Compiler 診断、レイアウト・SVG 生成、フォント初期化、PDF 書き込み、Webview メッセージ、再生状態はそれぞれの担当層で扱う。PDF のフォント読み込み失敗を無視して代替フォントで続行すると文字化けし得るため、現在の設計は描画前にフォントを明示的に読み込む。その他の失敗時に表示する文言や部分描画規則は仕様・実装を参照し、ここでは追加しない。

source/effective DSL 再構築時は occurrence index を古い loop point とともに破棄し、推測で再解決しない。再生不可、無名 Section、`B <= A` は部分状態を適用せず、既存有効状態を保持して localized status を返す。

Practice bank transition の Seek、loop wrap、resize、再構築、再入、Dispose は generation を進め、古い transitionend/rAF/fallback callback を無効化して旧 node を確実に除去する。transitionend が background throttle 等で届かない場合も fallback で cleanup し、reduced motion では旧層を残さない。存在しない後続 occurrence は空の小節として捏造せず、現在ページだけを表示する。

## Alternatives considered

Practice guide の可視奏法をフォント文字や CSS `content` で描く案は、フォント差・アクセシビリティ・縮小時の形状変化を避けるため不採用とする。再生ページをスライド/スクロールさせる案や現在/次を示す A/B 見出しも、演奏中の位置と視線を動かし、承認済み画面にない状態文言を追加するため不採用とする。交差切替は更新対象の bank だけに行い、音声 timing の fade と混同しない。既存資料にはその他の描画経路に関する比較検討記録がない。

## Verification strategy

ページ配置、SVG、Preview HTML、PDF、playback timeline / Web Audio runtime のユニット検証に加え、Practice speed、occurrence loop、half-open scheduler wrap、Count-in、Follow、rebuild cleanup、commands / accessibility の契約テストを実行する。Issue #155 は T01–T12 に沿って vector glyph semantics、Fraction placement、固定4小節と横スクロール到達性、コード区間中央配置、repeat/volta/loop projection、bank stability、220 ms/reduced-motion、cleanup を検証する。実 Preview では421 / 600 / 840 / 1100 / 1400 CSS px、JA / EN、Dark / Light、melody ON / OFF の可能な組合せを撮影し、通常表示および切替の0 ms / 約110 ms / 完了後を承認済み SVG と照合する。DOM状態、端切れ、レーン重なり、現在バンク不変を確認した画像を Issue #155 に添付する。Help / AI 同期は関連資産のゲートで確認する。
