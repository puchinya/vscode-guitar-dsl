# Implementation Contract v6 Delta — PR #163 / Issue #162

**対象リポジトリ**: `puchinya/vscode-guitar-dsl`  
**レビュー対象HEAD**: `c98cd6f04efe6cefda05b63d69ebdaad7ff0fba7`（2026-11-01確認）  
**位置付け**: ユーザー追加要求「左端のラベルヘッダーを削除して表示幅を拡大」「歌詞は必ず横一段に配置し、文字サイズを調整」。既存のcanonical Implementation Contract v5（Issue #162、comment `6553934815`）の**compact layout／compact lyric配置に限る追補**。他の条件は維持する。実装前に本決定をcanonical v6へ昇格し、リポジトリの契約検証を通すこと。

> This document is an Implementation Contract. Do not redesign the architecture during implementation. If a requirement conflicts with repository reality or requires a material design change, do not silently choose an alternative. Report the exact conflict and continue only with independent valid work.

## 1. Repository Baseline

| 参照 | 確認した実装事実・不変条件 |
|---|---|
| `src/render/previewHtml.ts:4363-4370`, `:4691` | 左端のラベル列 `.practice-guide-label-rail-shell` は詳細表示・コンパクト表示の共用HTMLである。DOMそのものを消すと詳細表示を破壊する。 |
| `src/render/previewHtml.ts:761-765`, `:828-836`, `:2458-2489` | compactでは幅480px以下で44px、481–600pxで68px、それ以上で76pxを左ラベル列に割り当てる。現行400pxではラベル列44pxを除いた領域を4小節で分ける。 |
| `src/render/previewHtml.ts:2141-2215`, `:2251-2259` | lyricsにも汎用`pack`が適用され、重なる歌詞を`guideRow`別に縦配置し、`maxRows.lyrics * 24 + 4`で高さが増える。 |
| `src/render/previewHtml.ts:2279-2292`, `:2338-2361` | `fitCompactSvgText()`は縮小ではなく省略記号化し、lyricsは24px単位の複数行を使う。 |
| `src/render/previewHtml.ts:2413-2420`, `:4571-4578` | 1小節内に複数の`data-guide-verse`があり、compact表示時は演奏occurrenceの選択verseのみ表示される。元テキスト・発音時刻・ARIA・titleを保持する。 |
| `docs/specs/gui_design.md` §2.4、`docs/specs/extension.md` §4.6、`docs/design/preview-rendering-and-export.md` Issue #162節 | compact四小節、各小節1SVG、同一拍座標、1行奏法、コード図、next-chord位置、テンポ依存fadeを維持する。詳細gridは既存仕様のまま。 |
| `tests/e2e/extension.test.ts` Issue #162 compactテスト群 | 四小節・歌詞タイミング・グリッド位置・bank/fadeを検査するが、**左列非表示／歌詞単一baseline／省略禁止**を検証していない。 |

## 2. Architecture Decisions

### A. 左端ラベル列の削除はcompactモードの表示だけ

- **削除対象**は小節／メロディバー／歌詞／奏法／コード／コード図の**左側縦ラベル列**である。上端の練習パネルの操作ヘッダー、次コード帯、各小節番号を削除しない。
- `.practice-guide-label-rail-shell`のDOMと詳細gridの列配置は温存。`body.guide-compact-mode`の時のみ`display:none`とし、compactの列割当は**0px**。compact→detailed切替では従来のラベル列・スクロール・高さ同期が完全に復元する。
- **compact W≤480**: `grid-template-columns:minmax(0,1fr)`、`grid-template-rows:auto auto`。次コード帯は`grid-column:1;grid-row:1`、4小節pageは`grid-column:1;grid-row:2`。
- **compact W>480**: `grid-template-columns:minmax(0,1fr) 96px`（481–600）／`minmax(0,1fr) 112px`（601以上）。4小節pageは1列目、次コードは2列目。ラベル列を残すための44/68/76px余白は一切確保しない。
- `placePracticeGuideBanks()`は**最終的に確保したpageの実clientWidth**から`(viewportWidth-16)/4`でslotを計算し、再配置・2bank共通高さ・page/fadeライフサイクルを更新。400pxでviewportが実400pxならslotは96px程度になる（現行は約85px）。横スクロール禁止、4小節同時表示。

### B. コンパクト歌詞は**選択中verseごとに各小節1行固定**

- `data-guide-lane="lyrics"`の**表示中の全歌詞を、ひとつのbaseline（`y=19`）**へ描く。`guideRow`は常に0、レーン高は**28px固定**。重なり回避に2段目を追加しない。異なるverseを同時表示せず、非選択verseはレイアウト計算から除外。
- 歌詞の文字列・語順・ハイフン・各`data-guide-*`、ARIA/titleを維持。**`…`への省略、歌詞の欠落、他小節への移動、改行、DOMの削除をしない**。拍時刻のFraction/xアンカーは変更せず、表示用xだけ調整可。
- 文字サイズは**各小節・選択verse単位で統一**し、標準13px、下限7px。アクティブ/再生済み/次状態でサイズを変えない。銀行切替で高さが跳ねないよう常に28pxの1行レーンとする。
- 描画可能幅の決定は以下の**決定済みアルゴリズム**を採用する。
  1. 選択verseの歌詞イベントを `(atの正確なFraction, eventIndex, 入力順)` で安定ソート。`startX=compactGuideX(at,beats,slotWidth)`、`lastRight=slotWidth-5`。
  2. 同時刻グループの利用可能区間を、次の**異なる時刻**のstartXまたはlastRightまでとする。イベント数`n`で区間を等分。`itemX = startX + indexWithinGroup * groupWidth/n`、`itemAvailable = max(0.1, groupWidth/n - 0.5)`。各イベントの`data-guide-at-beat`と`data-guide-at-fraction`（既存ならその値）は元の時刻のまま。
  3. 各イベントの必要幅は現在の`compactGuideTextWidth(text,13)`を使い、`sizeCandidate = 13 * itemAvailable / max(0.001, measureWidth13)`。当該小節の表示歌詞全体で `fontSize = clamp(min(sizeCandidate),7,13)`。歌詞がない小節は13px扱い。
  4. そのフォントサイズで対象文字列を**全文**描画。実際の`SVGTextContentElement.getComputedTextLength()`が`itemAvailable`を超える場合は、その歌詞の**み**`textLength=itemAvailable`、`lengthAdjust="spacingAndGlyphs"`で横幅を収める（サイズ7px未満にはしない）。`textLength`は毎回初期化し、表示文字列は常に全文。
  5. 描画時は全イベントに`data-guide-row="0"`、算定した`data-guide-layout-x`、`data-guide-lyric-available-width`、`data-guide-lyric-font-size`を与える。選択verseが変わっても幾何を再計算可能にする。描画のたびにfontSizeとtextLengthを原形からリセットし、リサイズ縮小→拡大で復元する。
- 厳密な同時刻・極端な文字列長では文字が強く横圧縮され、認識性は保証できないが、**全文のDOMと歌詞の一行配置・4小節可視・時刻アンカーは守る**。2行化/省略/横スクロールへの自動フォールバックは禁止。対象幅が0に近い物理的限界は明示的なテストを設け、要件衝突は報告する。
- 表示位置の安定性のため、選択verseの決定には既存の`playbackOccurrences`の`occurrenceIndex → lyricVerse`を使う。隠れている他のverseで小節の歌詞行高や文字サイズを変えない。

### C. Rejected alternatives

- 左ラベルDOMの全面削除：詳細gridの既存UIが壊れるため禁止。
- 歌詞を複数行にpackする既存処理：新要求に反するためcompactで不使用。
- 13px固定＋省略記号：新要求に反するため禁止。
- 音声/DSL/通常譜面を変更して歌詞を間引く：禁止。
- 全4小節で1つの最小フォントサイズを共有：1小節の長い単語で残り3小節も過度に縮むため採用しない。**小節単位の統一フォント**とする。

## 3. Exact Change Set

1. `src/render/previewHtml.ts` CSS（`.practice-guide-layout`, `.is-narrow-compact`, `.practice-guide-label-rail-shell`）: `guide-compact-mode`スコープの左ラベル非表示と上記1列/2列のレイアウト。CSS inline overrideとの特異性衝突を避ける。
2. `placePracticeGuideBanks()`: compact幅の算出から`baseLabelWidth=44/68/76`を削除し、`gridTemplateColumns`を上記に変更。label railのcompact時サイズ同期は行わず、detailed時の既存復元を維持。リサイズ/next chord表示によってclientWidthを再計測。
3. `computePracticeGuideCompactLayout()`: `pack(laneItems.lyrics, ..., 'lyrics')`を上記`packSingleRowCompactLyrics`相当へ置換。表示中verseだけを対象とし、`maxRows.lyrics`に依存しない`lyrics:28`を返す。`guideCompactLayoutKey`・template→live属性コピーに必要な新メタデータを追加。
4. `layoutPracticeGuideCompactSvg()`: lyrics branchを常にbaseline `y=19`で配置。`font-size`を計算値に変更、全文を戻し、実測超過時は`textLength`で横圧縮。`fitCompactSvgText()`はコード名の既存用途だけに残す。非選択verseのhidden状態、`.is-current`等の色・太字を保持。
5. `renderPracticeGuidePanel()`: lyric `<text>`に全歌詞、表示verse、拍/Fraction、`title`/ARIAを維持。必要な`data-guide-*`の計算根拠を追加。
6. `docs/specs/gui_design.md` §2.4、`docs/specs/extension.md` §4.6、`docs/design/preview-rendering-and-export.md` Issue #162節、英日Help、`docs/status/implementation-status.md`と画面証拠READMEを同期。**canonical v6を作成しSHAを検証**。

## 4. Implementation Sequence

1. Issue #162のcanonical v6の公開・照合（元v5を改ざんしない）。
2. compact-only gridから左列を除去し、詳細gridへの復元を確認。
3. 選択verse限定の1行レイアウト、文字サイズ計算、表示座標メタデータを追加。
4. SVG文字幅の描画後検証と`textLength`フォールバックを追加。
5. 回帰テスト・画面撮影、Help/spec/design/statusを同期。
6. 最終HEADで全検証→Reviewer Checklistセルフレビュー→PRをレビュー状態へ進める。

## 5. Required Runtime Semantics

- **正常系**: compactは左ラベルなしで4小節を表示し、各小節の選択verse歌詞は時間順・同一baseline、文字は13→7pxへ自動調整。
- **複数verse/repeat/volta**: `PlaybackTimeline.occurrences`による選択verseにのみ適合する。前後bankとも同一slot幅・レーン高さ。選択verseの切替は歌詞を再レイアウトするがseekしない。
- **リサイズ/表示切替**: 400→1100→320→400、compact↔detailedで隠し列・font-size・`textLength`のリセットを保証。古い倍率・省略文字が残らない。
- **fade/再生中**: 対象bankのlyricsは正しいselected verseを保持し、レイアウト差でbankの上下高さを跳ねさせない。`generation`、cleanup、reduced-motion、pause/seek/loopに既存回帰なし。
- **極端に密な歌詞**: 横方向`textLength`圧縮まで実施。全文・ARIA保持。物理的に非重複が不可能な入力は切り捨てず、正確な再現例と制約をCompletion Reportへ記録。

## 6. Non-goals / Forbidden Changes

- 詳細gridのラベル列・歌詞フォント・複数verse行表示、DSL/Parser/PlaybackTimeline/音源、通常譜面SVG/PDF、コードダイアグラム、奏法のv5固定パス、クロスフェード仕様には触れない。
- 4小節→2小節への削減、隠し横スクロール、歌詞省略、ラベルのコンパクト画面残留を禁止。

## 7. Concrete Tests

1. **400px/4小節**: `.practice-guide-label-rail-shell`のcomputed `display:none`、矩形幅0、pageの矩形幅がlayout幅（次コード上段）と等しい、4slotと幅 `(viewportWidth-16)/4`、横overflow≤1px。
2. **600/1100px**: 左列0px、次コード右列96/112px、コンパクトpageのslotは左列削除後の実clientWidthから算出。コンパクト↔詳細切替後、詳細列と従来ラベルが表示・機能する。
3. **JA密歌詞**: 400pxで「わ た し は あ な た と」のように短い音価で並ぶ歌詞。各表示 `<text>`が`data-guide-row=0`、同じ画面baseline、文字重複/小節超過なし、全文を保持し`…`なし。
4. **EN単語長/同時刻**: 長い英単語、1拍に2つの歌詞、ハイフンを含むケース。13px→7pxの縮小、必要な場合のtextLengthフォールバック、同時刻グループの順序、歌詞が非重複、元beatが不変。
5. **多verse/repeat/volta**: 非選択verseでfont/高さが変化しない。演奏出現ごとの選択verseが正しく全文表示され、次bankにも飛び移らない。
6. **Resize / page/fade**: 320/360/400/421/480/481/600/1100/1600pxでviewportとbeat anchor、1行歌詞、高さ、四小節固定、fade後cleanup、reduced motion、next-chord表示を検証。
7. **JA/EN×Light/Dark画像**: 400pxの歌詞多密度と600px/1100pxの代表画面を撮影。左ラベル列なし／1行歌詞／全文／可読性を実画像で確認。v5ストローク、compactメロディ休符非表示、コード図を再検証。

## 8. Verification

`npm run compile:all`、`npm test`、`npm run check:help`、`npm run check:ai`、`npm run vscode:prepublish`、`npx @vscode/vsce ls`、リポジトリ指定の`validate-docs --issue 162`と`verify-implementation-contract 162`、`git diff --check`、GitHub Required CI。実行コマンドとHEAD、OSを記録し、Windows/Linux・VoiceOver/NVDAなど未実施環境をPASSと報告しない。

## 9. Reviewer Checklist

- [ ] compactで左列のcomputed幅=0、詳細gridでは元の列が完全復元
- [ ] compact4slotの新幅が実clientWidthから再計算され横スクロールなし
- [ ] 次コード帯の狭幅上段・広幅右端を維持
- [ ] 選択verseだけを1行baselineへ配置、元Fraction/イベント順維持
- [ ] fontsizeを小節ごとに計算、全文表示、ellipsis/複数行なし
- [ ] 同拍・極端な文字列では必要時にtextLengthを適用
- [ ] 画面座標で歌詞の非重複・card内収容を検証
- [ ] 画面リサイズ、verse変更、bank/fadeで stale layout なし
- [ ] 詳細grid、4小節、ストロークv5、メロディ休符、コード図、fadeへの回帰なし
- [ ] 仕様・設計・Help・status・canonical v6・自動テスト・画面証拠同期
- [ ] 最終HEADで全テスト・CIを確認しSelf-Reviewを実施

## 10. Completion Report

変更ファイル・レビューチェック全項目・各テストのコマンド/結果・キャプチャの対象HEAD・未検証プラットフォーム・契約逸脱/物理的制約・残作業・**Pull Request URL**を記載する。コミット/Push/PR・`Closes #162`・リポジトリのレビュー状態遷移が完了条件。外部ブロッカーはエラーと阻害範囲を明示し、completeではなく**BLOCKED**で報告する。