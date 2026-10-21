# Implementation Contract — SVGストロークと2小節交互クロスフェード（Issue #155）

**状態:** ユーザー承認済み設計・実装未着手。これは既存Issue #155の契約を**全面置換**する確定版。以前の「音符・連桁」「A/B演奏中・次・更新済みの見出し」「アニメーション禁止」は撤回する。

**設計原案（編集可能SVG・正本）:** [通常の4小節表示](https://github.com/puchinya/vscode-guitar-dsl/blob/docs/issue-155-vector-crossfade-reference/docs/specs/gui_design/proposals/issue-155/practice-guide-svg-strokes.svg) / [03小節開始直後・左ブロックだけクロスフェード中](https://github.com/puchinya/vscode-guitar-dsl/blob/docs/issue-155-vector-crossfade-reference/docs/specs/gui_design/proposals/issue-155/practice-guide-crossfade-midpoint.svg)。画像内の例示音符・歌詞はダミー。弦方向・グリフ種別・固定領域・ブロック更新の条件が実装の正本。ユーザーが提示した画像の `A・演奏中（05–06）` の見出し行は**表示禁止**。

![通常4小節のSVG奏法ガイド](https://raw.githubusercontent.com/puchinya/vscode-guitar-dsl/docs/issue-155-vector-crossfade-reference/docs/specs/gui_design/proposals/issue-155/practice-guide-svg-strokes.svg)

![左ブロックのクロスフェード中間フレーム](https://raw.githubusercontent.com/puchinya/vscode-guitar-dsl/docs/issue-155-vector-crossfade-reference/docs/specs/gui_design/proposals/issue-155/practice-guide-crossfade-midpoint.svg)

> This document is an Implementation Contract. Do not redesign the architecture during implementation. If a requirement conflicts with repository reality or requires a material design change, do not silently choose an alternative. Report the exact conflict and continue only with independent valid work.

## 1. Repository Baseline

| 参照 | 守る事実 |
|---|---|
| `docs/specs/gui_design.md` §2.4、`docs/specs/extension.md` §4.6 | 下端Practiceパネル、行順「メロディ→歌詞→奏法→コード名→コード図」、右固定次コード、上部48/44/42px行 |
| `docs/design/preview-rendering-and-export.md` “Practice guide and accompaniment voice events” | コンパイラはFraction音価、`PlaybackTimeline`は唯一のscore clock、Preview Webviewは再生/表示/cleanup所有。PDFと通常譜面を変えない |
| `src/practiceGuide.ts::practiceGuideRhythmLabel`、`automaticPracticeGuideGrid`、`practiceGuideContinuationOffsets` | `〜`は**記譜音価の継続**であって空振りではない。表示用4/8/16分割は全小節で判定 |
| `src/render/previewHtml.ts::buildPracticeGuideData`、`renderPracticeGuidePanel`、`updatePracticeGuideUi` | PR #154 HEAD `bf686c4` では文字グリフと全曲横スクロール。表示投影だけ置換する |
| `src/render/previewHtml.ts::renderPracticeStringDiagram` | Practice図は現在160×90。ユーザー指定により**Practiceだけ正方形**へ置換 |
| `src/playbackTimeline.ts::PlaybackOccurrence` / `src/playOrder.ts::PlayOrderOccurrence` | 演奏出現 `occurrenceIndex` と書面 `measureIndex` は異なる。repeat/volta/arrangement対応を維持 |
| `tests/unit/practiceGuide.test.ts`、`tests/e2e/extension.test.ts`、`docs/agents/testing.md`、`docs/status/implementation-status.md` | source→design→code→status、unit/E2E、実画面受入、検証報告 |

**依存関係:** #153/PR #154が基盤。調査時点で #154 未マージのため、着手は**#154マージ済みmain**を基本とする。未マージのまま統合実装・検収できない場合はBLOCKEDを明示し、#153を再実装しない。

## 2. Architecture Decisions

### 2.1 文字を使わずSVGで奏法記号を描画

- **奏法は従来の矢印・波線方式**に戻す。音符の符頭/符尾/連桁/リズム数字は練習パネルに**描かない**。先行Issue #155の新しい音価SVGレンダラ設計は棄却。
- 可視の `↓` `↑` `〜` は**SVGの `path` / `line` / `polygon`**から生成。Unicode `<text>↓</text>`、`<text>〜</text>`、CSS `content`、フォントグリフによる描画は禁止。グリフの説明用文字列は `title` / `aria-label` / tooltipで使用可。
- 実装形状（デザインSVGを参照）：Arrow viewBox `0 0 20 34`、線幅約2.5、縦方向の矢柄と幅約12の矢じり。Wave viewBox `0 0 20 16`、Bezier `M2 9 Q6 3 10 9 T18 9`。dense表示幅12～14 CSS px、SVG高さ26～30 CSS px。SVGのサイズを縮めすぎて判読不能にしない。
- `8.d`を16分グリッドで示す場合は**SVG downとSVG wave各1個**（`↓〜`相当）。`4.d` も**attack + 1個のwave**で長い継続幅を表現。16分音価だけならattack1個。全小節が8分グリッドの `8.d` はattackのみ。**一音価の伸長にwaveを何度も連打しない。** 既存詳細表示は従来のスロット毎 `〜` を維持してよい。
- `.m`＝SVGの消音ドット `・`、`.b/.g`＝SVGの `×`＋矢印、`.pm`＝文字PM＋ベクトル矢印、`.sN`＝弦番号、休符＝音価別休符。タイ継続は攻撃なしのwave、消音/休符/打音/スタッカートに音価の継続を勝手に描かない。
- グリッドを変更しても DSL音価/既存音源/リピート/再生時刻を変更しない。**全小節**を使った4/8/16分の密度判定は保持。

### 2.2 固定4小節、2小節ペアだけ更新

4小節容量ではA/Bという**内部bank ID**のみ使う（画面にA/Bラベルを描かない）。0-based `p=floor(occurrenceIndex/2)` に対し偶数pなら左=現在ペア、右=次ペア、奇数pなら右=現在ペア、左=次ペア。

| 現在小節（1-based演奏順） | 左の表示内容 | 右の表示内容 | 交替 |
|---|---|---|---|
| 01–02 | 01・02 | 03・04 | 初期表示、フェードなし |
| 03–04 | 05・06 | 03・04 | **03開始で左の旧01・02だけ更新** |
| 05–06 | 05・06 | 07・08 | **05開始で右の旧03・04だけ更新** |
| 07–08 | 09・10 | 07・08 | 07開始で左だけ更新 |

- 現在演奏中の2小節の**座標、DOM、playhead、音節ハイライトは維持**する。再生中に水平スクロールさせない。
- 画面にあるのは**小節番号だけ**。ユーザーに見える `A演奏中`、`B次`、`更新済み`、`2小節ごとに変わる` といった**見出し・専用行・バッジ・更新矢印は一切追加しない**。再生ヘッド・現在色・背景の薄い強調で演奏中を示す。
- リピート/volta/arrangement/loopでは**書面小節番号でなくPlaybackOccurrence**の連続ペアから内容を解決し、lyricVerseを保持。最後にない小節を捏造しない。

### 2.3 クロスフェード: 左右のうち「再生済み」bankだけ

- 通常順再生の03、05、07…小節に**入った瞬間**、旧bank表示opacity `1→0` と新bank表示 `0→1`を**同時に220ms ease-in-out**で実施。スクロール、スライド、拡大、点滅、余分な説明演出は禁止。
- 交換するbankの**メロディ、歌詞、奏法SVG、コード名、正方形コード図、小節番号を一体**で重ねてフェード。演奏中のbankと右固定次コードは交換アニメーションに巻き込まない。新bankを同位置に先に構築し、次のanimation frameからopacityを変更。
- 旧bankのDOMは `aria-hidden=true` + `pointer-events:none`/ `inert`。表示完了後は旧bank DOMを必ず削除。アニメーションの世代tokenで再入コールバックを無効化し、dispose/unloadでrAF・transitionend・fallback timer/旧nodeを全解除。
- 初期表示、Seek、Loop折返し、Stop→Play、ソース・文書変更、表示容量の変更は**両bankを即時再投影（フェードなし）**。Pause/Resumeや速度変更だけで新たなフェードを起こさない。`prefers-reduced-motion: reduce` は遷移を0msにして即時交換。背景タブ等のtransitionend欠落時もcleanup。
- クロスフェードは**表示専用**。音のfade/音源/タイムライン/音符の時間には触れない。

### 2.4 表示密度と正方形コードダイアグラム

- 左固定レーン名は通常 **76px**（狭幅68pxまで）、右の次コード欄は **112px**（狭幅96pxまで）、bank間8～12px、小節内部padding 6～8pxを設計目安にする。横スクロールをなくすため**コンパクト表示では旧20px/16分の最小幅を強制しない**。
- 1小節の最小必要幅は **SVG記号の可視矩形と2px以上の非重複間隔、歌詞音節の幅、コード図の幅＋余白**の最大値。時間順はFraction開始位置から維持し、音節/奏法の時刻を見た目に合わせて改変しない。
- Practiceコード図は **144×144 CSS px・`viewBox="0 0 144 144"`**。内部の指板線は約108×108pxの**正方形**。6本の弦は横線、フレット境界は縦線、1弦上・6弦下、開放/ミュート記号は左、押弦/セーハ位置は元のvoicingに一致。コード名と図の中心差≤2px。通常譜面/PDFの描画は変更しない。
- **原則4小節表示**。実幅に入らないときは2小節、さらに1小節表示に下げる。判定は全曲の最も密なペアを基準にviewport/設定変更時に決め、再生位置で4↔2が揺れない。2/1小節モードは一ページの現在小節群のみ保持し、境界で同220msのクロスフェード。狭幅で文字や図を読めない大きさに縮小する案は不採用。
- `表示: コンパクト(既定) / 詳細グリッド` と `表示方式: ペア更新(既定) / 連続スクロール` は既存Practice設定UI内の補助選択肢とする。**余分な見出し行は設けない**。詳細グリッドは #153の表示互換を保持。

### 2.5 Ownership, source of truth, rejected alternatives

- `PracticeGuidePageProjection`を `src/practiceGuide.ts`の純粋関数で構築、`PlaybackTimeline.occurrences`は唯一の順序権威。Webviewの `updatePracticeGuideUi()`がcurrent occurrenceに基づくbank描画とfadeのみを所有。新AudioContext、setInterval、playOrder resolverを追加しない。
- 明示的に不採用：従来Issue #155の**連桁記譜SVG**、テキスト文字の矢印/波線、見出し `A・演奏中(05–06)`、フェード禁止、横スライド、4小節を無理に詰める縮小、通常Preview/PDF改修。

## 3. Exact Change Set

| 対象ファイル/シンボル | 変更義務 |
|---|---|
| `src/practiceGuide.ts` | `PracticeGuidePageProjection`, `projectPracticeGuidePage(occurrences, occurrenceIndex, capacity)`, `selectPracticeGuideCapacity(...)`。occurrence・verse・repeat/loop対応とbank IDを返す純粋関数 |
| `src/render/practiceGuideStrokeSvg.ts`（新規） | `down/up/wave`をSVG path等で生成。ブラシ・消音・方向・タイ・弦指定を扱う。表示文字フォールバック禁止、ARIAラベルあり |
| `src/render/previewHtml.ts::renderPracticeStringDiagram` | **Practiceのみ**144×144正方形へ変更。コード図を横弦/縦フレットのまま描画 |
| `src/render/previewHtml.ts::renderPracticeGuidePanel` / CSS | 5レーン共通アンカー、コンパクトA/B、狭い左右レール、4/2/1容量、正方形図、余分なbankヘッダーなし。旧詳細グリッドは残す |
| `src/render/previewHtml.ts::updatePracticeGuideUi` / lifecycle | 220ms二層fade、runningFade世代、既存時計に追従、reduced-motion、Seek/Loop/Resize/Dispose cleanup、View stateの一時保存 |
| `tests/unit/practiceGuide.test.ts`, 新規 `tests/unit/practiceGuideStrokeSvg.test.ts`、`tests/e2e/extension.test.ts` | 下記T01–T12、瞬間/110ms/完了後の画像証拠、DOM衝突・可視領域・アクセシビリティ |
| `docs/specs/gui_design.md` §2.4、`docs/specs/extension.md` §4.6 → `docs/design/preview-rendering-and-export.md` → `docs/status/implementation-status.md` | 新しい決定と旧スクロール既定との矛盾を更新。必要な日英Help/manifest/digestを同期 |

## 4. Implementation Sequence

1. #154マージ済みmainを確認し、`specs`へSVG記号/見出し禁止/交互更新/正方形図/220ms/reduced motionを明記。
2. `design`でProjection・bank DOM二層・generation cleanup・Fraction配置を固定。
3. pure page projection、SVG stroke renderer、正方形diagramとユニットテストを実装。
4. Webviewで4/2/1容量、bank更新、CSS opacityとcleanupを実装。再生時刻・音源は変更しない。
5. E2E/実Webview画像と本Issueの2つのSVGを照合し、未一致は修正または分類付き報告。
6. Help/status/verification → チェックリスト自己レビュー → **commit/push/ `Closes #155`付きPR** → workflow reviewへ遷移。

## 5. Required Runtime Semantics

- 01開始時 A=[01,02], B=[03,04]。02→03でAだけ05/06へfade、04→05でBだけ07/08へfade。演奏中bankを動かさない。固定の小節番号以外に状態文言なし。
- 220ms中、old/newは同じジオメトリに重ね、oldは非対話/ARIA-hidden。終了後oldはDOMから消える。イベント処理の順序は現在occurrence解決→新bank生成→表示の二層切替→old cleanup→通常playhead更新。
- 連続境界、seek、loop wrap、Stop/Restart、文書再構築、連打、スクリーン変更ではrunningFadeをcancelして最新状態へ即時再投影。重複timer/listener/古いactive labelを残さない。
- 短い曲は存在するoccurrenceだけ表示。拍子変更/連符/tieは記譜Fractionの順序をそのまま使う。display mode切替で楽曲の音数・BPM・Undoを変えない。

## 6. Non-goals / Forbidden Changes

空振り表示・音符連桁・新DSL・奏法文字グリフ・A/Bステータス行・切替説明テキスト・更新矢印・別時刻resolver・新音声owner・通常譜面/PDF/Inspector/GPの変更・既存タイ仕様の再設計は禁止。

## 7. Concrete Tests

| ID | 入力 / 操作 | 合格条件 |
|---|---|---|
| T01 | `8.d`, `4.d`, `16.d` を16分グリッドで | attack SVG + 伸長wave SVG1個、attack+wave1個、attackのみ。Unicode glyph要素なし |
| T02 | `.u/.m/.b/.g/.pm/.s5/r8/.t` | ベクトルの矢印/ドット/ブラシ、弦番号、休符を区別。wave=伸長のみ、空振り発音なし |
| T03 | 4小節容量、開始01–02 | 左01/02、右03/04、余計なA/B/更新行なし、スクロールなし |
| T04 | 02→03 | 左旧→05/06のみ、220msで両層opacity変化。演奏中の右03/04はDOM/座標/ハイライト不変 |
| T05 | 04→05 | 右旧→07/08のみ、左05/06は不変 |
| T06 | fade中にSeek/Loop/Stop/Resize/Disposeを連続実行 | stale DOM無し、旧callback無効、正しいcurrent occurrence、他トラック無影響 |
| T07 | `prefers-reduced-motion:reduce` | 0ms置換、余分な演出なし |
| T08 | F/C/Dm7/E7/Am7 | 正方形144×144、横弦/縦フレット、開放/ミュート左、コード名中心差≤2px |
| T09 | 421/600/840/1100/1400px、JA/EN、dark/light、melody ON/OFF | 実幅で4/2/1に適応、SVG奏法/歌詞/図の重なりと左右端切れゼロ、次コード名可視 |
| T10 | 連符/6/8/タイ/repeat/volta/lyricVerse | Fraction位置とoccurrence順を保持、必要箇所だけbank更新 |
| T11 | 詳細グリッド/コンパクト/連続スクロール切替 | ソース/音声/通常Preview/PDF不変、既存機能回帰なし |
| T12 | 同条件で参照SVGと実Webviewを比較 | SVGグリフ、見出し無し、4小節、正方形図、クロスフェード旧/新中間・完了画像で検収 |

**実画面証拠:** 日英×dark/light×421/600/840/1100/1400 CSS pxの可能な全ケースを実Previewで収集。03小節切替の0ms・約110ms・220ms以降を撮影し、旧DOM除去と演奏中bank不変を検査。未達幅・OSはNOT RUN。

## 8. Verification

`docs/agents/testing.md` を唯一の検証手順正本とし、少なくとも `npm run compile`、`npm run test:unit`、`npm run check:help`、`npm run check:ai`、`npm run test:e2e`、`npm test`、`npm run vscode:prepublish`、`npx @vscode/vsce ls`、`git diff --check`、`python -m agent_workflow validate-docs --issue 155`、Issue/PR workflowのIC/self-review validator、CIを実行。Electron E2Eと`npm test`はsandbox外。1400幅・Windows/Linux・VoiceOver/NVDAなど未実行はPASSと報告しない。

## 9. Reviewer Checklist（事前公開）

- [ ] R01: SVG `path`の `↓↑〜`、waveは音価継続のみ、可視テキストglyph/音符連桁なし
- [ ] R02: 全小節グリッド、Fraction開始・音価・タイ、occurrence順を維持
- [ ] R03: 左76/右112pxを基準とする省スペース、正方形144×144の指板
- [ ] R04: メロディ→歌詞→奏法→コード名→コード図と次コード
- [ ] R05: A/B演奏中/次/更新済み/2小節説明の**見出し・行・バッジ0**
- [ ] R06: 02→03は左だけ、04→05は右だけ220ms crossfade、演奏中bank不変
- [ ] R07: reduced-motion、Seek/Loop/Resize/Dispose、reentrancy/cleanup PASS
- [ ] R08: 4/2/1適応・日英×テーマ×メロディ×実画像比較と非重複
- [ ] R09: 旧詳細モード、DSL/Playback/PDF/通常Preview、Help/AI/status互換
- [ ] R10: 自己レビュー、全検証、commit/push、`Closes #155`付きPR URL、review遷移

## 10. Completion Report

必須: 変更ファイル、R01–R10の自己レビュー結果、テスト別PASS/FAIL/NOT RUN、SVGベクトル表示とフェード各フレームの実画面証拠、未検証OS、契約逸脱/ブロッカー、残作業、SHA/branch、**PR URLと `Closes #155`**、Issue/PR review phase。commit/pushだけで完了とせずPRとreview遷移まで実施。認証・権限等で阻止された場合はコマンドとエラーを示し**BLOCKED**。

**分類:** A=Contract violation、B=Contract ambiguity、C=Newly discovered requirement（実装者の失敗としない）、D=Optional improvement。重大なCは別Issue/設計へ戻す。
