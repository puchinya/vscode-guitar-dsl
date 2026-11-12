# Implementation Contract v10 Delta — PM下配置と最短メロディバー幅に基づく歌詞の可視性

- Repository: `puchinya/vscode-guitar-dsl`
- Issue: [#162](https://github.com/puchinya/vscode-guitar-dsl/issues/162)
- PR: [#163](https://github.com/puchinya/vscode-guitar-dsl/pull/163)
- Read-only review baseline: `15eec20cd9766fc626e6d808ff0471acee88c16e`（2026-11-02）。作業開始時には実際のPR HEADを確認すること。
- Status: **新規ユーザー要件に対する決定済み実装差分**。canonical v9（Issue comment `6569401245`）の既存要件を維持し、compact PMとcompact lyric visibilityのみ明示的に上書きする。これは既存実装の契約違反ではなく、分類 **C — Newly discovered requirement**。承認済みのIssue v9を黙って書き換えない。

> This document is an Implementation Contract. Do not redesign the architecture during implementation. If a requirement conflicts with repository reality or requires a material design change, do not silently choose an alternative. Report the exact conflict and continue only with independent valid work.

## 1. Repository Baseline

- `src/render/practiceGuideStrokeSvg.ts::renderPracticeGuideCompactStrokeSvgElement` 現行78–82行: `palmMute=true` なら `PM` を左の `x=0,y=21` に置き、矢印を`translate(14,0)`へ動かす。`practiceGuideCompactStrokeVisualWidth`はPM付き単一矢印を4→18幅に拡張する。狭い拍セルでは矢印本体を不要に横圧縮する。
- `src/render/previewHtml.ts::buildPracticeGuideData` の rhythm処理（現行4450–4483行）は `stroke.palmMute` と onset/eventEnd を保持する。継続waveのデータは別途生成され、PMの有無は元のリズムattackにのみ紐づく。
- `src/render/previewHtml.ts::renderPracticeGuidePanel` のcompact SVG（現行4740–4817行）は1小節1SVG。`computePracticeGuideCompactLayout`（2212行付近）は全出現のレイアウトを先に測り、`layoutPracticeGuideCompactSvg`（2429行付近）でwidth/height/座標を再配置する。
- Compact melody bar は高さ**6 CSS px**、音価由来の実幅 `durationBeats / measureBeats * (slotWidth-10)`（同現行2490行付近）。400 CSS pxで4小節なら各slot約100px、4/4・16分音符の幅は約 `(100-10)/16 = 5.625 CSS px`。**バーの「高さ6px」と「最短音価の横幅約5.6px」は異なる概念。**
- `src/render/previewHtml.ts::compactLyricVisibleText` （2179–2197行）は10px以上で収まらない場合、`…` すら入らなければ空文字を返す。`layoutPracticeGuideCompactSvg` （2494–2541行）は空文字の代わりに半径0.8pxの点を描画する。現行v9では「一部の歌詞が文字として見えない」はこの仕様から生じる。
- `tests/e2e/extension.test.ts` のcompact lyric試験（現行2690–2955行）は `text == full || endsWith('…') || markerVisible` をPASSとするため、短い音節がすべて点になる退行を発見できない。既存PM試験（840行、2200行近傍）はラベル存在は検証するが、矢印との上下位置と描画後の可読性を測っていない。
- 基準: `docs/specs/gui_design.md` §2.4、`docs/specs/extension.md` §4.6、`docs/design/preview-rendering-and-export.md` のIssue #162 section、canonical v9の小節間・次コード欄gap=0、4小節・2bank・Fraction・テンポfade。

## 2. Architecture Decisions

### A. PMは矢印の下に表示、矢印の横幅を増やさない

1. **compact専用**: PMは奏法SVGの縦方向に設けたannotation帯に描く。既存の4×30矢印path、横1列・時刻Fractionアンカー、X方向だけの圧縮、1.15px non-scaling-strokeは維持する。詳細gridのPM表示APIは変えない。
2. `renderPracticeGuideCompactStrokeSvgElement({palmMute:true})` は矢印を通常の4px自然幅のまま出し、インライン左寄せPMラベルと14pxの矢印オフセットを**廃止**。PMのフラグ/ARIAとイベントidentityは親に保持する。PMテキストは**別のSVG注記**としてrendererのcompact `technique` lane下側に出す（`<text class="practice-guide-compact-pm-label" ...>PM</text>`）。フォントのPM文字は許可、矢印を文字グリフで描く案は棄却。
3. 隣接するPM攻撃イベントは、`eventEnd == next eventStart`（厳密なFraction）かつ間に非PMイベント/休符がない場合、**1つのPM run**として合成し、下に一回`PM`を描く。単発PMも一run。小節境界を越えてrunを結合しない。矢印・waveの個数や時刻は変更しない。runに `data-guide-pm-run-start-fraction` / `-end-fraction` と参加イベントIDを記録し、単発または連続PMの演奏意味を保持する。
4. 注記テキストは **9px、font-weight=700、text-anchor=middle、fill=currentColor**、中心xはrunが占める実画面上の区間中点（拍→compactGuideX、同小節右端は`slotWidth-5`）。`getComputedTextLength()`による実幅を測り、カード範囲の内側`[2, slotWidth-2]`に収まるようannotationの**表示xだけ**clampする。runの時間アンカーは変えない。元の音楽データ、タイトル/ariaを保持。
5. PMラベルどうしの描画後の水平矩形が2px未満の間隔で衝突する場合、startFraction / eventIndex の安定順で**行を増やす interval packing**を行う。PM帯だけを縦に積み、矢印行は1段を維持する。PMの表示位置は最初の注記段でbaseline `y=44`、次の段で `+12px`、以後同じ。実際のノードを削ったり縮小/省略/隣接する非PMをPM runへ誤併合することは禁止。
6. technique lane はPMを含むページで `max(36, 48+12*(maxPmRows-1))`、PMがなければ従来の36px。**全出現（再生順、選択verse、切替中のbankを含む）に対して最大PM行数を事前計測し、表示中の各小節で高さを共通化**する。page変更/seek/fade中に高さを振動させない。
7. ローカルSVG上、矢印の縦座標は現在の30px masterと同じように配置し、PM annotationが追加されても `item.getBBox()`による**矢印位置の再中心合わせをしない**。`data-guide-layout-x`で横位置を保持し、注記は別の独立`<g>`に置く。すべての矢印（PM有無）が同じ水平帯に並び、PMテキストのbboxは矢印本体のlayout widthへ加算しない。
8. 狭幅でPMラベルの間隔確保と3px以下のビジュアル領域が両立しなくても、PM文字と矢印を隠さずPM専用行を増やす。横スクロールも4小節減少も禁止。

### B. 歌詞は最短メロディバー幅に対応した実文字を優先

1. Compactの歌詞セルは**音楽的な時刻区間**に結びつく。各小節の可視メロディから最短音価の実幅 `min(durationBeats/measureBeats*(slotWidth-10))` を取得する。休符やメロディ未指定は最短幅計算から除外し、該当する歌詞自身の `durationBeats` / 次歌詞開始時刻から利用可能区間を計算する。小節中の無関係な短い音符が、長い音符に紐づく歌詞まで一律で極小化する実装は棄却。
2. 歌詞の時間アンカーは元のFractionのまま。文字セルは `x = compactGuideX(lyric.at,beats,slotWidth)` を開始点とし、`right = min(nextDistinctLyricAtX, x + lyric.durationBeats/measureBeats*(slotWidth-10), slotWidth-5)`（同時刻グループの間では区間を等分）。同じ音節に延長（melisma）があれば、その延長後durationを使う。フォントサイズは**イベント別**で、文字列が収まる最大値（標準13pxから測定して二分探索、非等方変形禁止）を採用し、ただし画面上**最大13px**。1 graphemeのサイズは最短バー幅と対応し、16分16音節/4拍/400pxで概ね5px台まで小さくすることを許可する。通常密度では従来10–13pxを維持。
3. 1-graphemeの日本語音節がその拍セルに収まる限り、**絶対に空文字・点/省略記号へ変換しない**。極小幅のために文字を見せるには 4–6pxになり得る（視認性は限界がある）。2 grapheme以上は、まずセル内に収まるfont-sizeを選び、最小表示4 CSS pxでも入らなければ**少なくとも先頭1 graphemeの文字を描画**し、残りは非表示とする。全文は元`data-guide-full-text`/ARIA/titleと既存の「現在歌詞」ヘッダーへ保持し、可視の短縮文字列から消してはならない。`Intl.Segmenter`によるgrapheme境界を守る。
4. 320px以下・同拍複数歌詞など、先頭1 graphemeが4pxでさえ物理的に入らないセルに限り小さな時間位置マーカーを許可する。マーカーの条件と全件数をdata属性とE2Eで監視。**400px・4/4・16分16個の単独ひらがなfixtureではマーカー数0・16文字の描画が必須。**
5. 1行の歌詞lane（baseline=19、height=28）を維持。全源歌詞・歌詞verse・演奏順・Fraction・空白/休符・拍位置・headerの全文表示・現在色分け・resize/seek/crossfadeを保持する。`textLength` / `lengthAdjust="spacingAndGlyphs"` / scaleXでの字形つぶしは引き続き禁止。
6. **制約を明記**: 400pxで1小節に16個の短い音節を置くと、1セル約5.625pxにすぎない。全16文字を「判読可能な10px以上」で同時表示することは数学的に不可能。v10は「少なくとも各文字が表示される」ことと現在歌詞ヘッダーでの全文可読性を優先する。これをすべての歌詞が大きく読めると報告してはならない。

## 3. Exact Change Set

1. `src/render/practiceGuideStrokeSvg.ts`: compact用のPMインライン左配置（`x=0,y=21` + `translate(14,0)`）を除去し、PMの有無にかかわらず同一attack自然幅を返す。`practiceGuideCompactStrokeVisualWidth`はPM付きでもattack=4px、both/brushはそれぞれの自然幅を返す。既存detailed rendererを変更しない。
2. `src/render/previewHtml.ts::renderPracticeGuidePanel`: rhythm `measure.techniques`のattackからrunを構築、各runに一つPM注記ノードをcompact SVG technique group末尾へ生成。`data-guide-pm-*` とARIA/titleを付与。継続waveのイベント生成はそのまま。
3. `::computePracticeGuideCompactLayout`: PM注記テキストの実寸計測・run区間の視覚座標と安定行割り当て、全出現の最大行数を計算。PM表示のオンオフやgrid切替でも同一page内レーン上端が跳ねないよう共通高さを決める。PM注記は横幅packのattackから切り離す。
4. `::layoutPracticeGuideCompactSvg`: PM注記（表示x clamp、指定baseline、scaleX=1）と矢印本体を別処理。PMのための`getBBox()`再中心化が矢印yを変えないこと。annotationのstate色同期を`::updatePracticeGuideUi`へ追加し、描画済み全時間帯をseek/repeat/voltaから再計算可能にする。
5. `::packSingleRowLyrics`と`::layoutPracticeGuideCompactSvg`: melody/lyricの時刻区間に基づくイベント別文字サイズ選択、`compactLyricVisibleText`の「先頭grapheme保証」規則と例外マーカー条件を実装。font-size測定は同一SVGのfont/weight/styleを用い、実レンダリング後の境界をE2Eでassertする。リサイズ時には元全文から再計測。
6. `docs/specs/gui_design.md` §2.4、`docs/specs/extension.md` §4.6、`docs/design/preview-rendering-and-export.md` Issue #162、Help JA/EN、`docs/status/implementation-status.md`、evidence READMEとcanonical Issue contractへの上書き範囲を更新。移行契約の承認・SHA・過去v9履歴を保持。

## 4. Implementation Sequence

1. Read-onlyの現HEAD確認、v9要件とPM/lyrics fixture確認。v10差分をIssue #162に登録・contract検証。
2. PM rendererから左配置を除去し、自然幅とSVGの単体テスト。
3. PM run投影・2段以上の注記packing・全出現高さ固定を実装。
4. 歌詞のnote-duration同期幅とイベント別font-size/先頭graphemeを実装。
5. DOM検証E2Eと視覚回帰を追加し、既存テストの旧「マーカーならOK」の無条件容認を廃止。
6. Help/spec/design/status、実Preview画像を更新。フルテスト・self-review・PRレビューまで実施。

## 5. Required Runtime Semantics

- **通常**: PM矢印の横幅/拍位置は通常attackと同一。PMは矢印下のlabelとして示す。連続PMは1 run、非PM/休符で必ず分断。歌詞は長い音価では10–13px、短い音価では最短実バー幅に近い実文字サイズ。
- **seek/repeat/volta**: PM runのis-current/past/nextと歌詞versesを再評価。演奏出現IDに属するデータのみ更新し、旧bankのハイライトを残さない。
- **resize/grid toggle**: 元Fraction/文字列から再配置。PM labelの衝突を再packingし、前のtransform/font-sizeとrow数が累積しない。
- **two-bank fade/reduced motion**: 高さはソング/可視条件ごとの最大に固定し、遷移開始/終了、キャンセル、ユーザーによる非表示/再表示でも再現。オフscreenのPM注記のDOMはbank破棄時に解放される。
- **競合時**: 一部の文字を上限なしの縮小・Xだけ押し潰し・越境させない。短いセルでは先頭graphemeを優先し、元データ/ARIA/現在歌詞を失わない。計測失敗時は既存フォールバック計測により決定的に処理する。

## 6. Non-goals / Forbidden Changes

- DSL/Compiler、PlaybackTimeline、再生音声、詳細Practice grid、五線譜/PDFのレイアウト変更は禁止。
- 4小節容量削減、bank間gapの再導入、次コード帯の移動、歌詞レーン2行化、横スクロール追加は禁止。
- PMを矢印の上/左へ戻すこと、PMの意味を非PMへ拡張すること、記号削除、矢印をUnicodeフォントへ置換することは禁止。
- 「メロディバーの高さ6px」を一律の歌詞フォントサイズに用いる案は棄却。**対応させるのは音価を表す横幅**であり、各イベントの実幅に基づく。
- 高密度セルで全英文を10px以上で1行表示することは受入要件に含めない（物理的に不可能）。全文はcurrent lyric header/ARIAで保持。

## 7. Concrete Tests

| ID | Setup / Action | Expected result |
|---|---|---|
| PM01 | 単発 `16.d.pm` と `16.d` を400px・grid16で比較 | 自然幅4px、矢印shaft/head同一path・同じx/y・下にPM1個、注記とshaftの縦非重複。|
| PM02 | 連続する `16.d.pm 16.u.pm 16.d.pm` | 矢印3個、PM run注記1個、start/end Fraction正確、連続帯の下に表示。|
| PM03 | `16.d.pm 16.u 16.d.pm`×複数を320/400px | 2つのrunを非併合、label間の可視gap>=2px。必要ならPM注記段数を増やす。矢印は1段、全記号可視。|
| PM04 | 最終PMでseek、repeat/volta、crossfade、grid4/8/16、resize | 最新再生出現のみ正しいstate、過去/未来更新、上段/右欄の位置、フェードの高さ安定、PM DOMに残骸なし。|
| LY01 | 4/4、16音符×1文字日本語16件/小節、400px・4小節 | 各小節16実文字が見える（点・空文字0）、音節順/拍/Fraction一致、非重複/overflow=0、同じbaseline。文字サイズは最短バー幅から求めた値で概ね5px台。|
| LY02 | 4分、8分、16分音価が混在する小節 | 各歌詞の文字サイズが対応するメロディの実区間に応じて変わり、長いバーの歌詞を無駄に最小化しない。次の歌詞と重ならない。|
| LY03 | `uninterruptedword`×16、英語長文、320/400/600px | 各セルで少なくとも先頭graphemeが表示（物理的に4px未満の例外のみマーカー）、全文はARIA/title/headerで正確。字形scaleX禁止。|
| LY04 | 同時刻の多声、歌詞延長、休符、melody OFF、別verse、resizeとbank切替 | フォールバック幅・分割・元データ・正しい歌詞段、固定1行レーン、表示切替時も前の省略を蓄積せず再計測。|
| REG | 320/400/421/480/481/600/1100px、JA/EN×Light/Dark、fade中 | 4小節gap0、次コード接続gap0、波線の独立・角形メロディ・コード図・テンポフェードの非回帰。最新HEADの実画像比較。|

## 8. Verification

- `npm run compile:all`
- `npm test`（unitとExtension Development Host E2Eを分離して結果・pendingを記録）
- `npm run vscode:prepublish`
- `npm run check:help`、`npm run check:ai`
- Repository docs validator `validate-docs --issue 162` / canonical contract verification（実コマンドは`docs/agents/testing.md`参照）
- `git diff --check`、`npx @vscode/vsce ls`、Required CI。必要なOSの未実行はそのまま記録。

## 9. Reviewer Checklist

- [ ] 新規PMを`SVG <text>`で矢印の真下に描く。attack SVG pathは変更なし。
- [ ] PM付きの自然幅が通常attackと等しく、横圧縮の原因を解消。
- [ ] 連続PM runの正確な意味、非PM境界、複数注記の水平非重複。
- [ ] PM labelは実9pxで表示し、2px以上の間隔を保持（必要なら複数注記行）。
- [ ] 全小節共通の矢印Y・page/fade中の高さ安定。
- [ ] 400pxの16音節日本語の16文字が消えず、拍順・baselineを維持。
- [ ] 音価による最短バー実幅と歌詞セル幅/イベント別font-sizeの対応をE2Eで検証。
- [ ] 英語長文の元テキスト・header・ARIA、grapheme境界とno-clipを維持。
- [ ] 4小節gap0、next chord gap0、wave/Fraction、square bars、tempo fade、詳細gridへ回帰なし。
- [ ] 完全な最終HEADの検証・画像・self-review・契約IDを提出。

## 10. Completion Report

修正ファイル・各チェック判定、PM矢印との実座標/注記行数、LY01の最短メロディバー幅と描画フォントサイズ・隠れた歌詞数、テスト数/コマンド/実行環境、最新画像リンク、契約逸脱/未検証/既知制限、**PR URL**（`Closes #162`）を記す。commit/push/PR提出・レビュー遷移まで完了させる。認証や契約現実との衝突によりできない場合は具体的なエラーを挙げてBLOCKED扱いとする。