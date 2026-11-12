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
- Related Issue: [Issue #158](https://github.com/puchinya/vscode-guitar-dsl/issues/158)
- Related Issue: [Issue #160](https://github.com/puchinya/vscode-guitar-dsl/issues/160)
- Related Issue: [Issue #164](https://github.com/puchinya/vscode-guitar-dsl/issues/164)
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
| 複数譜表のブレースと譜表間小節線 | Issue #160、言語構文仕様 §11、拡張機能仕様 §4.3、§4.7 |

## Architecture

- `src/render/layout.ts` の `layoutScore()` はスコアをページ・シートの配置データへまとめる。改ページとレイアウト設定は表示上の境界として扱う。
- `src/render/svg.ts` はページ SVG (`renderScoreSheets()`) と連続表示 SVG (`renderContinuousSvg()`) を生成する。`src/render/previewHtml.ts` の `compileGuitarDslToHtml()` はプレビュー用 HTML と必要な UI モデルを組み立てる。
- Extension Core は文書変更・プレビュー操作を処理し、Webview に HTML/SVG を渡す。Webview の操作メッセージは拡張機能ホストに戻り、ホスト側の制御器が文書・有効 DSL とプレビュー状態を管理する。
- `src/pdf.ts` はページ SVG を `pdfkit` / `svg-to-pdfkit` でベクター PDF にする。Noto Sans JP の同梱フォントを登録し、書き出し時は一時ファイルを経て確定する設計が記録されている。
- `src/playOrder.ts::resolvePlayOrder()` は唯一の演奏順 authority、`src/playbackTimeline.ts::buildPlaybackTimeline()` は唯一の score-time authority とする。再生タイムラインは元スコアを書き換えず、別の repeat resolver や timing engine を追加しない。
- リズム符タイ（Issue #142）の接続関係は Compiler が検証する。`src/render/svg.ts` はその関係を既存の `rhythmHeads()` / `renderTieArc()` で描き、小節間の連桁は作らない。段・ページをまたぐ弧は各 system の端で分割し、Preview と PDF が同じ SVG を使う境界を保つ。
- 複数譜表グループ（Issue #160）は `renderSystem()` の既存描画分岐と `SystemGeometry` から、実際に描かれる五線・TAB 譜表の役割と縦区間を求める純粋な SVG 装飾である。melody は vocal、TAB と明示 rhythm は guitar の譜表として扱う。小節 x 座標は既存の `measureBounds()` を使う。新しいスコアイベント、別座標系、レイアウト寸法の変更を導入しない。
- Extension Host はシングルトン Preview panel とコマンド転送だけを所有する。Playback / Practice の状態は Webview に置き、ホストは再生・seek・loop 状態を保持しない。

### レイアウトと出力の同一性

`layout.ts` は用紙座標を pt（1/72 inch）で扱い、シート SVG の `viewBox` と PDF ページを一致させる。現行レイアウトでは上下 10 mm・左右 12 mm の余白、横向きの2カラムと12 mmガターを持つ。段は既定4小節を基準幅780で組み、用紙カラムへ scale する。段ごとの高さはメロディ譜表や歌詞段数を含めて見積もる。手動 pagebreak と段高からの自動改ページを併用し、空ページでも最低1段を受け入れて無限ループを避ける。縦向きは1シートに1ページ、横向きは2ページを配置する。

ページプレビューとPDFは `renderScoreSheets()` の同一ページ SVG を共有する。Web 用 continuous モードはページを分割せず縦長 SVG を生成する。メロディ付き段では、リズムとメロディの発音位置の union を共通 x 座標列にし、両段を整列する。

#### Staff-group brackets, braces, and inter-staff barlines (Issue #160)

The renderer assigns a role to each rendered interval: melody is vocal, TAB is guitar-TAB, and a visible rhythm staff is guitar-rhythm. Lyrics, chord names, diagrams, and annotation lanes do not create staves; lyrics attached to TAB remain part of that guitar staff. A hidden rhythm staff under TAB does not count.

The symbol matrix is:

| Rendered staves | Outer bracket | Inner guitar brace |
|---|---:|---:|
| Vocal + rhythm | Both staves | None |
| Vocal + TAB | Both staves | None |
| TAB + explicit rhythm, without vocal | None | Both guitar staves |
| Vocal + TAB + rhythm | All three staves | TAB and rhythm only |
| One staff | None | None |

The score bracket is an **independently authored, font-free SVG silhouette**, not a copied music-font glyph. It has two small, smooth cubic-Bézier flared caps drawn in system units and a separate slim filled rectangular stem. The top cap has an upper/upward taper from x=0..16.7 and y=-10.7..3.7, the lower cap is an exact vertical mirror; neither cap is stretched when staff spacing changes. The stem is 3.5 system units wide, runs exactly between the top and bottom outer staff lines, and is placed at x=6 standalone or x=-23 for the outer bracket of a three-staff nested group. This leaves at least 2.3 system units to the staff at x=25 (standalone) and 6.3 units to the inner guitar brace x=0 (nested). [`staff-bracket-reference.svg`](../specs/gui_design/proposals/issue-160/staff-bracket-reference.svg) and [`nested-staff-group-reference.svg`](../specs/gui_design/proposals/issue-160/nested-staff-group-reference.svg) show the authoritative standalone and nested SVG geometry. Do not import, embed or derive geometry from music font glyphs, runtime fonts, SVG `<text>`, SVG `<use>`, or external resources. The separately authored guitar brace in [`standard-brace-reference.svg`](../specs/gui_design/proposals/issue-160/standard-brace-reference.svg) remains x=0..22 and scales vertically to its two-staff interval. `measureBounds()`, rendered staves, page margins, left connector and existing staff x=25 remain unchanged.

When two or more staves are rendered, one x=25 left connector spans the outer staff lines. For each measure boundary, the renderer uses `measureBounds()` and draws a thin segment only through the gaps between adjacent staves. Existing barlines inside each staff keep their original type and width, including repeat, double, final, volta, tie, and TAB technique marks. Single-staff systems receive no group symbol or added connector.

The ornament group is inside the existing system transform and uses the same local coordinates as the notation body after `annotationTop - lift`. It has no pointer events, does not alter measure or anchor geometry, and is generated once per system by the shared SVG renderer used by continuous Preview, page Preview, and PDF.

### Preview 更新と PDF 出力

文書変更時に Extension Core は対象文書を確認し、`resolvePreviewEffectiveDsl()` で有効 DSL と表示用モデルを解決する。これを `compileGuitarDslToHtml()` に渡し、Compiler → layout / SVG → Preview HTML の順で生成して Panel の HTML を置き換える。Webview の用紙サイズ・向き変更は `layoutChanged` メッセージでホストへ戻し、同じ pipeline を新しい設定で再実行する。

### Preview toolbar composition (Issue #136)

`previewHtml.ts` keeps a fixed 48 px playback row followed immediately by a fixed 44 px score-settings row. Play, Pause, and Stop remain icon-only at every width; their localized `title` and `aria-label` stay available and the Play name changes to Resume while paused. Seek and elapsed/total time also stay in the playback row even when playback is unavailable; localized status text is in normal document flow before the score and has no reserved height while empty. Practice is a separate fixed 42 px row at `top: 92px`, rendered only while enabled. Keeping the existing 18 px content gap yields body top padding of 110 px with Practice off and 152 px with it on.

Count-in and Metronome live in the nonmodal Playback settings disclosure. Display mode, paper size, orientation, and PDF save live in View & Export. The score-settings row keeps Capo, colored Playability, and Beginner controls directly operable at every supported width. At 840 CSS px and above it also exposes barre policy, automatic/fixed capo selection, and Inspector detail links. Below 840 px these supplemental actions live in an accessible overflow group. The row never displays the text “Temporary Score Settings.” Playability uses the host's authoritative score and level plus text and color: veryEasy/easy are green `#2e7d32`, moderate is ochre `#8d6e00`, hard/veryHard are red `#b71c1c`, and unavailable is neutral. Color never carries meaning by itself. Playback and View & Export disclosures each use `button[aria-expanded][aria-controls]` controlling a hidden labelled group, never a menu. Only one disclosure can be open; Escape closes and returns focus to its active trigger, while outside pointer/focus closes without moving focus. Closed controls are excluded from tab order and the accessibility tree. Disclosure state does not trigger an HTML rebuild or alter the playback timeline. PDF uses the existing exporter and effective DSL.

Paper and orientation keep the existing `layoutChanged` host route and rebuild the HTML/SVG. Score-setting controls use typed host messages and rebuild the same Preview only after the host validates action, supported candidate, document URI, version, and Preview generation. Unsupported or malformed messages return before controller, Inspector session, or pending focus-restoration state changes. A one-shot restore hint carries an allowlisted control ID plus the current document URI, version, and Preview generation. The host accepts it only from the current rendered document and consumes it only when a valid action is accepted and rendered; an invalid message does not discard it. Source update, document switch, panel disposal, or a newer explicit user action makes the hint stale. The rebuilt page focuses the requested control, falling back to its visible control if the target is unavailable. This does not persist another Webview state value or change audio ownership.

The 48 px playback row retains transport, playback settings, View & Export, and Help. The 44 px score-settings row always contains the direct Capo, Playability, and Beginner controls, including at the 421 px verification width; supplemental controls may scroll or move to accessible overflow. The 42 px Practice row appears only while Practice is enabled. Inspector owns detailed Capo and Beginner comparison and the only DSL Apply surface. Preview score settings expose transient selections and summary state while effective DSL resolution remains shared with Preview and PDF.

### Practice guide timeline (Issues #153, #162, #164)

Issue #153 introduced a detailed scrollable timeline alongside the Compact overview. The Compact renderer was refined by Issues #155 and #162. Issue #164 removes the detailed view and fixes the practice guide to Compact; old saved detailed-mode values are ignored and no mode value is written back. The current geometry and playback behavior are defined in the Compact projection section below. Earlier acceptance history remains in the status record.

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

### Practice guide projection, compact SVG, and timed bank transition (Issues #162, #164)

src/practiceGuide.ts projects written score data into the fixed Compact guide. Compiler Fraction onset, source spans, chord context, and lyric verse remain the input authority; the guide follows PlaybackTimeline.occurrences and does not create play order or timing. The per-document guideGrid setting selects auto / 4 / 8 / 16 continuation display and changes no DSL, score SVG / PDF, or playback data.

The Preview retains HTML/CSS for operation controls, settings, page navigation, and the next-chord aside. Compact music is one SVG root per written measure, held in the existing two-bank HTML containers. Each SVG has lane groups for ruler, melody, lyrics, technique, chord names, and diagrams; data attributes preserve measure, event, beat/Fraction, verse, and chord identity for the existing UI update lifecycle. One shared transform maps score beat to slot x: `inset + beat / measureBeats * (slotWidth - 2 * inset)`, with `inset=5 CSS px`. The root viewBox width and rendered CSS width use the same measured slot width, preserving one SVG unit per CSS pixel. `PlaybackTimeline` remains the sole score clock and occurrence authority.

The measured compact page width `W` is divided into four slots `[W/4, W/4, W/4, W-3*(W/4)]`, assigning any fractional remainder to the final slot so the total equals `W`. All within-bank and between-bank CSS gaps are 0 px; adjacent measure cards touch. Only measure boundary strokes move to `x=0` and `x=slotWidth`; the 2 px beat inset stays unchanged. Compact layout row/column gaps are 0 px. The next-chord boundary touches the last measure at widths above 480 px or the first measure below, within 0.5 CSS px, with the existing 1 px divider retained. The compact scale-layer top inset is 0 px, while the 12 px bottom reserve and next-chord internal padding remain. Chord text, symbol count, lyric length, and diagram size do not widen a slot. The page has no compact horizontal scrolling or active-occurrence auto-follow. At 480 px or narrower, compact mode uses one grid column: the next-chord name and square diagram occupy the upper band, with the four slots below and no label rail. Compact widths 481–600 px use a 96 px next-chord column; widths above 600 px use 112 px. The Compact guide has no left label rail. The chord diagram is a nested SVG retaining the full shared 144×144 voicing viewBox. At each measured slot width, every measure diagram across all playback occurrences uses the same square size: the narrowest final chord interval after packing, capped at 144 px and the 5 px slot insets. Each diagram is centered in its interval, with at least 4 px reserved above and below inside its diagrams lane; diagrams are never cropped or omitted. The next-chord diagram remains independently sized at 44–52 px square.

Compact lane height is stable across bank changes. Compact lyrics render only the occurrence-selected verse on one 28 px lane at baseline y=19 with data-guide-row=0. The visible melody lane is fixed at 64 px immediately after the 24 px ruler. Its top, height, pitch mapping, and pitch-bar y coordinates do not depend on lyric presence, verse, or current lyric text. For each measured slot width, one songwide font size is derived from the shortest pitch-bar across all playback occurrences: min(13, max(4, floor(max(0, shortestBarWidth - 0.25) * 100) / 100)) CSS px. If no pitch bar exists, use the shortest effective lyric-duration width; if neither exists, use 13 px. Apply the same size to all lyrics and both banks. Use no textLength, lengthAdjust=spacingAndGlyphs, or non-uniform transforms. When a lyric does not fit, only visible cell text is shortened or replaced by a non-text marker; source text, title, ARIA name, and event metadata remain intact. The header has no duplicate current-lyric field; hidden verses stay in the DOM without affecting lane height. Event order, beat and Fraction metadata remain unchanged. Technique marks always use one horizontal row in onset order. Each mark retains an exact Fraction-derived x anchor separately from its visual x; same-onset marks may receive deterministic visual offsets without changing their beat, Fraction, or playback time. Historical v5 used 4×30 attack paths and 5.6×30 / three-variant grid16 waves; Contract v24 supersedes those compact shapes with one 15×47 traced master. Down and up use the exact shaft/head paths defined by the compact Practice Guide contract, with solid heads; the shared S wave is 15 units wide, shifted to y=21, and has a 2.35px round stroke. Contract v26 uniformly scales the complete traced SVG, including its stroke, while preserving Fraction, event order, and accessible names. Grid8/grid16 derive scale from the full reference-measure width and map each event through its inset reference track; grid4 retains interval fitting. Painted wave/arrow clearance is at least 1 CSS px and adjacent waves are at least 0.25 CSS px apart. Dense cells may render marks below recognition size; no minimum mark height or stroke width is imposed. V26 checks reference-scale identity, `scaleX=scaleY`, path identity, cell/lane containment, and event/accessibility preservation. Every emitted mark retains its accessible name and `<title>`. Chord names and diagrams stay paired in one horizontal row, centered in their chord intervals. Compact chord labels are repacked from immutable natural-width metadata on each resize, so a narrow layout does not constrain a later wide layout. When the panel height is limited, the compact measure area scrolls vertically on its own, leaving the next-chord aside visible and allowing each whole chord diagram to be viewed. Labels may be ellipsized when needed, with the full value on the node's `title` and accessible name. Compact lyrics use one browser-measured font size for the whole song and measured slot width, as specified by the current contract below. SVG text compression (`textLength`, `spacingAndGlyphs`, `scaleX`, and non-uniform transforms) is forbidden. When a lyric does not fit its single-line cell, only visible cell text is ellipsized; if even the ellipsis does not fit, a non-text marker indicates the event. The original lyric remains in the DOM data, title, and accessible name. The current Practice Guide header contains no separate current-lyric label or live text field. Compact lyric normal/current/past fills each meet 4.5:1 contrast on the white card, and current/past use different hues as well as current's bold weight. Compact technique normal/past/next/current colors are `#1f2937` / `#475569` / `#37465e` / `#005f85`, each meeting 4.5:1 against white; past/next do not use opacity reduction, and current is distinguished by hue and/or weight. Pitch events, technique marks, continuation waves, and chord diagrams remain present. Compact melody-rest events preserve their Fraction span but emit no DOM/SVG node, leaving a blank span without moving or resizing following pitch bars. All compact melody pitch bars are square-corner rectangles (`rx=0`, `ry=0`) with existing pitch, duration, height, and state colors. Width/grid/visibility/document changes remeasure and reposition SVG content through the existing `syncPracticeGuidePanelGeometry()` RAF; no separate resize scheduler is introduced.

`buildPracticeGuideData()` already projects Fraction continuation offsets. Compact rendering draws one independent vector wave path for every continuation event matching the selected grid, located at its continuation beat rather than its attack onset. A stable identity is `(measure, eventIndex, grid, Fraction)`; duplicates at that identity are removed, while simultaneous events from separate source events remain independent. Rests, mute, ghost/brush/percussive events, and staccato do not continue. A tied event has no extra attack and has one wave at the tie start plus waves at subsequent valid grid positions. Contract v24 uses the same traced 15×47 S-wave path for compact grid8, grid16, and ties. Each continuation remains an independent event at its original Fraction. Grid8/grid16 use `referenceScale=min(1,slotWidth/referenceMeasureWidth)` with measure widths 366/400 and event-track insets 34/32, trackWidth 324. Map each source Fraction to `(trackInset + beat/measureBeats*trackWidth)*referenceScale`. Place waves `5*referenceScale` before their anchor, reducing that visual offset only as needed to retain at least 1px painted wave/arrow clearance; adjacent painted waves remain at least 0.25px apart. Uniform SVG fitting preserves the traced proportions and card containment. The complete mark may be too small to recognize; there is no minimum rendered height or stroke width. The v22 5.6×30 variants and their non-scaling stroke are historical.

At normal playback bank boundaries, only the previously played bank is replaced and faded; the other bank's DOM, geometry, playhead, and highlights remain stable. At transition start, the receiving `PlaybackHtmlOccurrence.tempoBpm` and current `effectiveSpeed()` are snapshotted to derive `effectiveBpm`; `fadeMs` is `clamp(round(60000 / effectiveBpm), 450, 900)`, or 600 ms for invalid BPM. Both opacity layers receive the same per-transition duration, and fallback cleanup runs at `fadeMs + 80 ms`. A speed/tempo change during a fade affects only the next transition. Initial projection, manual page navigation, seek, loop recovery, resize, document/mode rebuild, reduced motion, and disposal use immediate projection. Existing generation and cancellation ownership rejects stale rAF, timer, and transition callbacks. Pause/resume does not start a second fade. Transition state is visual only and does not affect audio or score time.

The verification contract covers 320 / 360 / 400 / 421 / 480 / 481 / 600 / 601 / 840 / 1100 / 1600 CSS px, zero measured gaps between the four adjacent cards and next-chord region, exact four-slot containment, 400 px DOM measurements, grid4/8/16 continuation identity, one-row dense technique layout with no overlaps, exact anchors and visual offsets for simultaneous marks, uniform SVG scaling, the fixed 15×47 compact attack and wave masters from Contract v24, with fitting rules from Contract v26, all four compact technique colors/contrast/opacity behavior, computed lyric contrast, collision-packed lyric rows, zero compact melody-rest nodes with unchanged subsequent pitch timing, voicing, JA/EN and light/dark presentation, melody/diagram toggles, BPM/speed snapshots, reduced motion, and non-regression of normal score SVG, PDF, DSL, and playback. Final-HEAD evidence includes the existing 32-image and 12-image matrices plus current-HEAD v8 400 px / grid16 JA/EN × Light/Dark captures plus lyric/header captures at 400 and 600 px containing the exact attack paths, continuation waves, PM, and melody rests. Compare the rendered path silhouettes with the checked-in user reference crop and exact SVG shape target; Workbench screenshots and geometry measurements remain separate evidence from unit assertions.

#### Contract v10: compact PM annotations and melody-width lyrics

Compact attack symbols used the 4×30 paths in the historical v5 implementation; Contract v24 supersedes that shape with shared 15×47 screenshot-traced SVG masters. PM runs remain separate SVG text annotations in the technique lane: same-measure PM attacks join only when exact Fraction end/start values meet, while a non-PM event or rest splits the run. Annotation text is centered over the run's screen interval and clamped inside the slot. A stable interval-packing pass measures the rendered 9 px text and adds rows only to PM annotations when labels would be less than 2 px apart; arrows and waves keep their single horizontal row. The maximum row count is calculated across all playback occurrences before cards are laid out, so lane height remains constant through page changes and bank fades. Annotation nodes retain run event IDs, Fractions, accessible labels, and playback state.
For Contract v28, same-onset technique layout items are those whose beats differ from the first item by less than 0.000001. Sort them by beat, event index, then stable source/DOM order. Divide the shared interval from the common Fraction anchor to the next distinct onset (or inset-track end) into equal steps; rank `r` receives base visual center `startX + r * stepWidth`. Fit each mark uniformly within its step, apply the existing wave offset and card-edge clamp, and keep all marks on one horizontal row. Visual movement never changes the source Fraction, event identity, or semantic anchor. After offsets, any adjacent painted-bound overlap scales both complete SVGs uniformly until the overlap is gone; this may scale the boundary mark next to a same-onset group. The saved user crop and v24 SVGs are separate evidence artifacts; exact source-to-trace correspondence is unverified and is excluded from current acceptance claims. See the Issue #162 v27 provenance note.

Compact lyric cells remain one row. Their available width is limited by the next distinct lyric onset, the measure edge, and the lyric's effective duration; the matching melody event's shortest visible pitch-bar width also constrains the cell, while melisma extension can lengthen it. Same-onset lyrics divide their interval evenly. Each event independently chooses the largest SVG-measured font size from 13 px down to 4 px without glyph scaling. A leading grapheme remains visible whenever it fits; only a grapheme that cannot fit at 4 px may use a time marker. Full text stays in data, title, ARIA, and the current-lyric header. Resize recalculates from the original text and Fraction values.

#### Contract v11: song-wide uniform compact lyric size

The v11 contract supersedes v10's per-event font-size choice. For each song and measured compact slot width, scan every playback occurrence's melody pitch bars and derive one size from the shortest bar: `min(13, max(4, floor(max(0, shortestBarWidth - 0.25) * 100) / 100))` CSS px. If the song has no melody pitch bars, use the shortest effective lyric-duration width; if it has neither, use the 13 px cap. Apply this same numeric size to all compact lyric events and both banks. The size is independent of lyric text, verse, playback position, and page; a viewport-width change recalculates it for the whole song. At that shared size, each event renders the longest grapheme prefix that fits its existing cell, or the existing time marker if no grapheme fits. Source text, accessibility metadata, lyric ordering, and the single-line lane remain unchanged.

#### Contract v12: fixed compact geometry and lyric-header removal

For each measured compact slot width, every measure-diagram SVG in every playback occurrence uses one common square size: the smallest final chord interval available after chord-event packing, capped at 144 px and the slot insets. Keep the complete `0 0 144 144` viewBox, center each diagram in its chord interval, and reserve at least 4 px above and below the square inside the allocated lane. Do not hide or crop measure diagrams to fit.

When Melody is visible, its compact lane starts at SVG y=24 and is 64 px high. Lyric presence, selected verse, and current lyric text do not change the lane's top, height, pitch mapping, or pitch-bar y coordinates. Keep the 28 px lyric lane below melody. Remove the separate current-lyric label and live text from the header in the Compact guide; each lower lyric event keeps its full source text in accessible metadata. The left label rail remains hidden.

The v12 E2E checks cover one- and two-chord measures at 400 / 600 px, full diagram bounds, late-occurrence shortest notes across page changes, resize, melody visibility, repeat/volta seek, verse routes, both live banks during a 400 px fade, the no-pitch lyric-duration fallback, header stability with and without lyrics, and an unobscured 600 px screenshot with DOM rectangles for the viewport, four cards, and next-chord aside.

### Contract v14 compact Practice Guide rendering (Issue #162)

The canonical v14 delta supersedes v13 only for compact chord-name sizing, the common time inset, songwide empty-lane allocation, and grid8/grid16 wave presentation. Compact score time maps through a shared 2 px inset. Chord names use 24 px bold for a single chord per measure and the largest measured fitting size from 24/22/20/18/16/14 px for multi-chord intervals; at 14 px only the visible label may use grapheme ellipsis, while its full accessible name and title remain. Resize always measures from the immutable full label.

Before rendering banks, scan every Playback occurrence. Collapse the compact melody lane only when no pitch event exists anywhere; collapse the lyric lane only when no lyric event exists anywhere. Otherwise their heights stay 64 px and 28 px across pages, lyric verses, and fades. Grid8/grid16 keep one semantic path for every continuation Fraction and stretch the common wide master on X only: `cell=(slotWidth-4)/(measureBeats*(grid/4))`, displayed SVG width `max(2.8,cell-0.9)`, visual left `fractionAnchorX-0.72*cell`, clamped to the card. Painter groups are waves, attacks, then PM; wave/attack bounds may overlap, adjacent wave bounds retain at least 0.25 CSS px, and attack geometry remains in front. Grid4/tie wave geometry, music data, and playback timing remain unchanged.

### Contract v15 wave/attack overlap update (Issue #162)

Contract v15 supersedes only the v14 wave-origin coefficient. Keep the common path, display width, scale, stroke, semantic anchor, and card clamp; set the painted wave's left edge to `anchorX-0.90*cell`. This makes grid8 wave and natural 4px attack bounds overlap at both 400px and 600px while retaining the common painter order. The coefficient translates all selected-grid waves consistently, so adjacent wave gaps remain determined by the unchanged cell and display width. Verify with real path `getBBox()` / screen transforms and attack `getBoundingClientRect()`; do not infer acceptance from SVG viewport rectangles alone.

### Contract v16 wave/attack clearance update (Issue #162)

Contract v16 supersedes only the v15 wave-origin coefficient and overlap acceptance. Keep the common path, display width, scale, stroke, semantic anchor, and card clamp; set the painted wave's left edge to `anchorX-0.10*cell`. At 400px and 600px, both grid8 and grid16 must have at least 1 CSS px between every stroke-inclusive painted wave bound and every visible attack bound. Waves remain in the background painter layer, but their horizontal bounds must not touch or cross attack bounds. Adjacent wave gaps remain determined by the unchanged cell and display width. Verify with real path `getBBox()` / screen transforms and attack `getBoundingClientRect()`; do not infer acceptance from SVG viewport rectangles alone.

### Contract v17 width-series verification (Issue #162)

Contract v17 keeps the v16 `anchorX-0.10*cell` origin and requires grid8/grid16 wave and attack bounds to remain separate at every measured width. The 400px and 600px reference captures require at least 1 CSS px of clearance; the other width-series checks require positive clearance and no contact. The geometry test's synthetic simultaneous attack remains covered for packing and accessibility but is excluded from the real-event wave/attack clearance oracle. Screenshot fixtures measure every real attack.

### Contract v18 technique-to-chord gutter (Issue #162)

Compact layout reserves a stable 6 CSS px vertical gutter after the technique lane and before chord-name text whenever both lanes contain visible events. The layout shifts the chord-name lane, diagram lane, and card bottom down by 6 px without changing technique-lane height, chord-name fitting, diagram size, or diagram bounds within their lane. Template and live banks share the same gap across page, grid, melody, and lyric changes. Score rendering is unchanged.

### Contract v19 wave/arrow visual separation (Issue #162)

Contract v19 keeps the wave's musical Fraction and semantic anchor while centering a narrower display rectangle in its grid cell. For grid8/grid16, use `displayWidth=min(cell,max(2.4,cell-3.8))` and `visualLeft=anchorX+0.325*cell-displayWidth/2`, clamped to the card. Measure painted SVG bounds including stroke: require at least 3 CSS px from real attack bounds at 400/600px and no contact across the required width sweep. Keep the common path, vertical shape/stroke, natural-size arrows, painter order, and v18's 6px technique-to-chord gutter.

### Contract v20 wave/arrow clearance formula correction (Issue #162)

Contract v20 replaces v19's provisional wave geometry with `displayWidth=min(cell,max(2.2,cell-3.8))` and `visualLeft=anchorX+cell/3-displayWidth/2`, clamped to the card. This leaves a visible gap from real attack bounds while keeping the semantic Fraction fixed. Verify stroke-inclusive bounds at 400/600px (at least 3px) and across the full width sweep (positive clearance). All v18 lane spacing and other rendering behavior remain unchanged.

### Contract v21 technique-mark / chord-name clearance (Issue #162)

Compact cards reserve a 12 CSS px lane gutter after visible technique marks and before chord-name text. Measure the rendered bounds, including mark stroke, and keep at least 10 CSS px of visible whitespace. Shift the chord-name and diagram lanes and card bottom together; retain technique height, chord-name fitting, diagram size and visibility, four-card capacity, musical anchors, and playback. Verify across widths 320/400/421/480/600/1100/1600px, grids 4/8/16, melody and lyric states, and page/bank transitions. Normal score output is unchanged.

### Contract v22 technique-mark / chord-name clearance (Issue #162)

The v21 12px lane gutter measured only 3.65 CSS px between rendered marks and chord text in the live screenshot, so v22 reserves 20 CSS px. The acceptance measure is the rendered vertical distance after layout and transforms, including technique stroke; it must remain at least 10 CSS px. Shift the chord-name and diagram lanes and card bottom together. Preserve four-card capacity, timing, complete diagrams, and playback; verify all contracted widths, grids, melody/lyric states, and page/bank transitions. Normal score output is unchanged.

### Contract v24 traced compact stroke masters (Issue #162; responsive fit superseded by v26)

The compact renderer uses the exact 15×47 reference masters: down shaft `M0 0 V31` and filled head `M-7.5 30 L7.5 30 L0 47 Z`; up shaft `M0 47 V17` and filled head `M-7.5 17 L0 0 L7.5 17 Z`; both shafts use a 2.65px butt stroke and heads use solid `currentColor`. The shared wave path is `M0 0 C3.2 -3.35 5.2 -3.35 7.5 0 S12.4 3.35 15 0`, shifted down 21 units and stroked 2.35px with round ends. Contract v24 defined x-only fitting; that responsive rule is superseded by the following Contract v25 section. Grid8/16 keep the cell-based placement and width policy with a 0.3 CSS px visual offset to account for the wider traced endpoints and retain 3px painted clearance. PM annotations are placed below that master, and the technique lane includes sufficient space for the arrow and all PM rows on every card/bank. Keep the v22 20px lane gutter and ≥10px painted technique/chord gap. Fraction and event identities, painter order, colors, four-card capacity, diagrams, fades, and non-compact rendering are unchanged.


### Historical Contract v25 proportional compact SVG fit (Issue #162; superseded by v26)

Keep each approved 15×47 traced master and its source path unchanged. For every compact technique symbol, compute `s=min(1,max(0,usableWidth)/naturalWidth)` and apply `translate(x,y) scale(s,s)` to the complete SVG, including its stroke. Center the transformed bounds within the shared 47px band. Do not set a minimum visible width, height, or stroke; very dense cells may produce marks too small to recognize while preserving the reference image proportions and semantic event metadata. Keep cell containment, 3px painted wave/arrow clearance at 400/600px, adjacent-wave separation, the 20px technique gutter, 10px painted technique/chord clearance, four cards, and complete chord diagrams.

### Contract v26 reference-proportional compact SVG sizing (Issue #162; canonical)

Contract v25's per-cell caps were too small for grid16 and too large for grid8 at narrow widths. Contract v26 uses one reference scale for ordinary single-master arrows and waves in each compact card: `referenceScale=min(1,slotWidth/referenceMeasureWidth)`, where the traced measure width is 366 SVG units for grid8 and 400 for grid16. It also preserves the trace's inset event track: grid8 uses inset 34, grid16 inset 32, and both use track width 324. Map a source event with `anchorX=(trackInset+beat/measureBeats*trackWidth)*referenceScale`; do not stretch the track to fill the card. The arrow and wave masters stay 15 units wide, so their display width is `15*referenceScale`; same-onset groups and intrinsically wider brush/both marks may additionally fit their shared interval. Center a grid8/grid16 wave `5*referenceScale` before its Fraction anchor, reducing only that visual offset when needed to keep 1px between painted wave and attack bounds. Compute the wave cell from `trackWidth*referenceScale/(measureBeats*(grid/4))`; use `max(0,cell-1-17.4*referenceScale)` as the stroke-inclusive offset bound. Keep all paths, stroke proportions, playback identities, and semantic Fraction data unchanged; only the trace-mapped visual position and uniform scale affect the drawing. Require at least 0.25px between adjacent waves, and retain the v22 20px technique gutter and at least 10px from painted technique marks to chord text. No minimum mark size is required. Existing four-card, diagram, next-chord, resize-recovery, and non-compact behavior remains unchanged.

### Practice Guide panel geometry synchronization (Issue #158 review)

`syncPracticeGuidePanelGeometry` は既存の `requestAnimationFrame` を1つだけ保留し、同じframe内のResizeObserver、resize、UI変更をまとめる。最新DOMをframe内で測定し、collapsed時は42px、表示時は内容に必要な高さを決めてから、`syncPreviewBottomPanelsGeometry` が表示中のbottom panel合計とbodyの `padding-bottom` を同期する。Normalでbottom panelがないときのbody下余白は0px。CSSの `height`、`max-height`、`--practice-guide-panel-height`、`--preview-edit-dock-height` は値が変わる場合だけ書き込む。新しいschedulerやgeometry ownerを追加しない。

E2Eは固定sleepを使わず、2秒以内に連続する2 animation frameでpanel高さの変化が各0.5 CSS px以下、かつcomputed `body.padding-bottom` とpanel border-box高さの差が各0.5 CSS px以下であることを確認する。mode、viewport幅、guide visibilityも同じ測定に含める。timeout診断は直前操作、mode、幅/高さ、collapsed、panel rect/scrollHeight、CSS変数、computed paddingと直近frameを示す。縦スクロール末尾到達は別assertとする。

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

## Issue #158 implementation design

The score renderer keeps a single notation source for Preview and PDF. Parser-owned bindings are added as non-visible identity metadata or a Preview-only adapter projection; selection borders, handles, and interaction targets are composed only into Preview HTML. PDF generation receives the same existing score SVG without edit metadata rendered as visible content or controls.

Preview rebuilds retain the 48 px playback row and 44 px score-settings row, with an exclusive Normal / Edit / Practice selector in `.toolbar-actions`. Below 600 px the selector is a labeled native select; at and above 600 px it is a segmented control. Normal shows only the two existing rows, Edit adds the fixed bottom edit dock, and Practice shows the 42 px Practice row and fixed guide. The edit dock and Practice row/guide are mutually exclusive, and bottom padding accounts only for the active mode's dock or guide. The Preview renderer uses captured source bindings to associate hit areas with visual elements and emits only escaped stable IDs, not source ranges or replacement text.

Selection and draft state are disposable UI state. Rebuilds preserve score scroll position and rebind a selected stable key only when URI, version, render generation, and parser source binding match; otherwise they clear it. Restoration metadata is consumed once and removed on stale document, selection removal, or disposal. Temporary Capo or Beginner output that differs from source suspends visual editing until the user explicitly restores the original DSL. Rendering and PDF export never serialize edited objects; the Host applies source splices and then the ordinary parse/render cycle projects the document again.

The playback-row toggle and `guitardsl.togglePreviewEditMode` share one Host transition. The Host validates the panel-held URI/version/generation, refuses non-identity temporary transforms before touching settings or Inspector drafts, and commits the mode only after any draft decision and existing progression Stop/lease handshake succeeds. On a successful OFF→ON it explicitly reveals the existing Inspector for the panel-held document with variables context selected; later Preview renders only update the Preview and do not reset the Inspector tab. Manual hiding does not trigger a reveal loop.

### Verification strategy

Render tests compare the existing display-mode and PDF SVG output with the Preview interaction-enabled output while ignoring only non-visible Preview metadata. Tests also verify that edit controls and overlays are absent from PDF, disabled-mode row heights remain stable, Practice and dock height variables combine without overlap, source bindings are escaped, and SVG contains no script, event handler, or external URL. Webview E2E covers width 421 / 600 / 840 / 1100 CSS px, short heights, scroll restoration, selection rebinding, the shared toggle command/message transition, and Inspector reveal. Real Extension Development Host screenshots are compared with the approved vector proposals and remain separate evidence.

## Alternatives considered

Practice guide の可視奏法をフォント文字や CSS `content` で描く案は、フォント差・アクセシビリティ・縮小時の形状変化を避けるため不採用とする。Contract v4で採用した10×36 masterとX/Y同率縮小は、参照画像の寸法・形状に合わせるContract v5で supersede する。v5ではDOWN/UPの4×30固定pathを使い、interval widthが不足したときは `scale(sx,1)` でX方向だけを圧縮する。grid4/8/tie waveには5.6×30の固定pathを使い、Contract v8ではgrid16専用の2.4×30 pathを追加する。再生ページをスライド/スクロールさせる案や現在/次を示す A/B 見出しも、演奏中の位置と視線を動かし、承認済み画面にない状態文言を追加するため不採用とする。交差切替は更新対象の bank だけに行い、音声 timing の fade と混同しない。既存資料にはその他の描画経路に関する比較検討記録がない。

## Verification strategy

ページ配置、SVG、Preview HTML、PDF、playback timeline / Web Audio runtime のユニット検証に加え、Practice speed、occurrence loop、half-open scheduler wrap、Count-in、Follow、rebuild cleanup、commands / accessibility の契約テストを実行する。Issue #155 は T01–T12 に沿って vector glyph semantics、Fraction placement、固定4小節と横スクロール到達性、コード区間中央配置、repeat/volta/loop projection、bank stability、220 ms/reduced-motion、cleanup を検証する。実 Preview では421 / 600 / 840 / 1100 / 1400 CSS px、JA / EN、Dark / Light、melody ON / OFF の可能な組合せを撮影し、通常表示および切替の0 ms / 約110 ms / 完了後を承認済み SVG と照合する。DOM状態、端切れ、レーン重なり、現在バンク不変を確認した画像を Issue #155 に添付する。Help / AI 同期は関連資産のゲートで確認する。
