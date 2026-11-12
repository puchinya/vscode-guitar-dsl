# Implementation Contract v13 Delta — 16分波線の視覚改善と PR #163 再レビュー

- Repository: `puchinya/vscode-guitar-dsl`
- Issue: [#162](https://github.com/puchinya/vscode-guitar-dsl/issues/162)
- PR: [#163](https://github.com/puchinya/vscode-guitar-dsl/pull/163)
- Read-only baseline HEAD: `7636889543d2c43682f850c6ffa9b9d76dcfe9f2` (2026-11-07)
- Previous canonical: [Implementation Contract v12](https://github.com/puchinya/vscode-guitar-dsl/issues/162#issuecomment-6688929860). **本v13は提案された追加差分**であり、v12の既存要求は明示した部分以外すべて維持する。
- Reference: [ユーザー指定ストロークパターンの切出し](https://github.com/puchinya/vscode-guitar-dsl/blob/7636889543d2c43682f850c6ffa9b9d76dcfe9f2/docs/status/evidence/issue-162/user-reference-stroke-pattern-crop.png)
- SVG model: `docs/status/evidence/issue-162/stroke-wave-v13-shape-target.svg`（本差分と同じコミットで添付する視覚レビュー用原形）

> This document is an Implementation Contract. Do not redesign the architecture during implementation. If a requirement conflicts with repository reality or requires a material design change, do not silently choose an alternative. Report the exact conflict and continue only with independent valid work.

## 1. Repository Baseline

- `src/render/practiceGuideStrokeSvg.ts::PRACTICE_GUIDE_COMPACT_PATHS.grid16Wave` は幅 **2.4**、パス `M0.15 15 C0.45 13.8 0.9 13.8 1.2 15 S1.95 16.2 2.25 15`。制御点のY差が **±1.2**しかなく、画面では振幅が約2px以下となり点状。通常の `wave` も5.6幅、Y制御差±1.9で弱い。
- `::renderPracticeGuideCompactWavePathSvg` は固定path・SVG viewBoxを返す。`src/render/previewHtml.ts::renderPracticeGuidePanel` は grid16用定数幅を metadata に固定する。`::computePracticeGuideCompactLayout` はFractionごとに横位置を求め、`::layoutPracticeGuideCompactSvg` はXだけ縮小・Y=1を保持する。**この不変条件は保持する。**
- `tests/e2e/extension.test.ts` 2638–2669付近は旧2.4幅/浅いpathそのものを合格条件にしており、画面上の**波線振幅**を検査しない。`tests/unit/practiceGuideStrokeSvg.test.ts` の固定path期待値も更新対象。
- 今回のv12画像は4小節+次コードが全て可視、コード図共通サイズ・角形メロディ・PM下注記が反映済み。前回v11の「遮蔽画像」「必須Contract文面」はv12で解消。
- v12提出の全体 `npm test`: Unit **1,235 PASS**、E2E **130 PASS / 6 pending / 2 FAIL**（2件ともfade系タイムアウト）。Required CIは成功だが**全体テストはPASSでない**。実装バグとは未断定。

## 2. Architecture Decisions

### C/P1 — 参照画像を優先した、縦振幅のある独立した「〜」SVG

- **実体はフォント/UnicodeでなくSVG `<path>`**。Fractionごとの継続記号を**独立して一つ**描き、連続長波線一本への統合を禁止する。音価・event ID・tie/attack区別・wave本数・ハイライト・アクセシビリティは変更しない。
- 4/8グリッドと非grid tie用は幅5.6の**wide**を用いる。grid16は実際の1/16音価のX間隔 `cell = (slotWidth - 10) / (measureBeats * 4)` に基づき**wide / medium / narrow**のいずれかを選択。`cell >= 7.0`ならwide、`5.5 <= cell < 7.0`ならmedium、それ未満ならnarrow。
- `M`, `C`, `S` を用いた以下の**固定パス**と幅だけを使用。高さは共通30、中心Yは15。元パスをCSSでX方向に引き伸ばして別パスを捏造しない。自然な振幅のため左右2峰が分かることを要求。

| variant | `viewBox` | path `d` |
|---|---|---|
| narrow | `0 0 2.4 30` | `M0.15 15 C0.45 9.8 0.90 9.8 1.20 15 S1.95 20.2 2.25 15` |
| medium | `0 0 4.2 30` | `M0.45 15 C1.00 10.4 1.55 10.4 2.10 15 S3.20 19.6 3.75 15` |
| wide | `0 0 5.6 30` | `M0.40 15 C1.15 10.8 2.00 10.8 2.80 15 S4.45 19.2 5.20 15` |

- 各pathに `fill="none" stroke="currentColor" stroke-width="1.15" stroke-linecap="round" stroke-linejoin="miter" vector-effect="non-scaling-stroke"`。コンパクト奏法の既存濃色/current/past/next状態は維持。文字「〜」をSVG `<text>` に置く代替案は禁止。
- **目標実表示**: 400px・4/4・grid16で `slotWidth≈100`, `cell≈5.625` よりmediumを使用。描画後のstroke込みwave高さ **7px以上**、幅はcellを超えず、隣波線と**1px以上**の空白。320pxではnarrow、600pxでは（通常の右next欄・slot≈126の場合）wide。極小幅・同拍多重で分離不能なら、拍・本数を壊さず受入未達の条件を正確に報告する。
- `getBBox()` だけではストロークを含まないため、実描画判定は `getScreenCTM()` の変換とstroke-width（non-scaling strokeの1.15 CSS px）を含めた**painted bounds**で行う。画面のピクセル上の振幅と実効色を画像目視で比較する。

### A/P2 — リサイズ後のコード名幅は毎回自然幅から再計算

- `src/render/previewHtml.ts::computePracticeGuideCompactLayout` の `pack(...,'chord')` は一度書き換えた `data-guide-layout-width` を次回の入力に再利用する。コード名が狭幅で38px等へ縮んだ後、幅を広げても**元の自然幅へ戻らず**、コード名が不必要に `…` となり得る。`fitCompactSvgText` 自体はfull textを復元するが、許容幅が戻らない。
- コード名だけを対象に、render時の `practiceGuideTextWidth(label,13)` に基づく**不変の自然幅metadata**（例 `data-guide-natural-width`）を追加。幅再計算時はこの不変値を読み、最終割当widthを別 `data-guide-layout-width` に上書きする。コード図の全曲共通幅、Fraction、名前/図同一コード区間、gap=0と4小節固定は維持。
- 400→1100→400→1100と、**初回1100**のコード名実表示を比較し、リサイズ履歴で省略数や幅が変わらないことをassert。多コード小節と長いコード名で再現させる。

### Verification blocker / P1 — full E2E 2件タイムアウト

- クロスフェードE2E（120秒）と400px両bank歌詞fade（90秒）が、Workbenchを前景化できずにタイムアウト。単発のfocused診断も焦点取得に失敗。テスト結果を**flaky=PASSと見なさない**。
- クリーンなExtension Development Hostで**全体 `npm test` を再実行**。再発する場合はfocus target、active tab、Workbench visibility、CDP target、snapshot復元の前後と先行テストを記録して環境干渉とコード回帰を切り分ける。timeout増量、skip、assert削除だけの対応を禁止。未解消ならBLOCKED。

## 3. Exact Change Set

1. `src/render/practiceGuideStrokeSvg.ts`: 3つの固定wave pathsと幅・variantをexport、`renderPracticeGuideCompactWavePathSvg(label, grid?, variant?)` は `grid !== 16` ならwide、grid16なら引数でnarrow/medium/wide。`data-guide-wave-variant`を付与。既存4×30矢印、PM、brush、mute、詳細gridは変更しない。
2. `src/render/previewHtml.ts::renderPracticeGuidePanel`: grid16テンプレートをnarrow原形で生成。`data-guide-layout-width`・path `data-guide-wave-width`・svg `viewBox/width`を、選択variantと一致させる。
3. `src/render/previewHtml.ts::computePracticeGuideCompactLayout(slotWidth)`: 各measureの `measureBeats` とslotWidthで上記cell/variantを**テンプレート内全grid16波線へ**設定してからlayout幅の収集/packを行う。選択gridが4/8でも将来16へ切替可能な状態を更新する。
4. `src/render/previewHtml.ts::layoutPracticeGuideCompactSvg(...)`: フェード中のlive bankにも同じvariant更新を**idempotent**に適用し、template/liveの `path d`、親nestedSVG `width/viewBox`、layout widthを同期。400→600→400、grid16→4→16、Seek、銀行交替で前のvariantが残らない。
5. `src/render/previewHtml.ts` chord-name renderer/packer: 不変自然幅属性を導入し、resizeごとにpacked幅を再計算。現在のコード図の全曲共通幅は維持。
6. `tests/unit/practiceGuideStrokeSvg.test.ts`・`tests/e2e/extension.test.ts`: 既存旧path固定値を上記3pathに更新し、表示後のpainted vertical amplitude/width/gap、正しいvariant遷移、event/Fraction、wave数、current/pastの意味を別々に検査。resizeコード名テストを追加。
7. `docs/specs/gui_design.md` §2.4、`docs/specs/extension.md` §4.6、`docs/design/preview-rendering-and-export.md`、英日Help、`docs/status/implementation-status.md`、`docs/status/evidence/issue-162/README.md`を差分更新。

## 4. Implementation Sequence

canonical v13としてIssue #162へ採用・検証 → 固定SVG variants → renderer/テンプレート幾何の同期 → 歌詞・PM・fade非回帰 → コード名幅復元 → unit → E2E → 400/600px新画像 → 全体検証/原因調査 → self-review → PRレビュー。

## 5. Required Runtime Semantics

- 通常/停止/seek/page/repeat/volta/grid4・8・16切替/320〜1600px resize/銀行fadeで音楽モデル、Fraction、再生強調と全イベント数は不変。
- X方向のみ必要に応じ縮小しY scaleは1、stroke-widthは画面実寸維持。固定パスはどのresizeでも変形しない。
- hidden gridのwaveをvisibleとして数えない。DOM再レイアウト/両bank遷移が続いても重複waveや古いvariantを残さない。
- コード名は狭→広で自然幅へ回復し、コード図はv12の全曲同サイズ・全表示を保持。

## 6. Non-goals / Forbidden Changes

4小節固定、next-chord密着、左ラベル列なし、上部現在歌詞欄削除、曲全体同じ歌詞サイズ、PM下注記、角形メロディ、詳細grid、通常譜面/PDF、DSL、PlaybackTimeline、音声、fade時間式は変えない。波線省略、波線1本への連結、Unicode波線への置換、テンポ変更、複数行奏法レーン化は禁止。

## 7. Concrete Tests

1. **Path unit:** 全variantの`d`・viewBox・stroke幅・ARIA・`data-guide-wave-variant`が完全一致。フォント「〜」不使用。通常4/8とtieはwide、grid16は閾値どおり。
2. **400px/4拍/grid16:** slot100、cell5.625、medium 4.2。4/4四分stroke4本＋continuation12本、Fractions 0.25,0.5,0.75...の独立期待値、painted height≥7px、隣接painted gap≥1px、正しい波形2山、カード内。
3. **320/360/400/421/480/600/1100:** 320/360はnarrow、400/421/480は適切なvariant、600（右next表示）はwide。必要な場合は実測slot幅の閾値で判定。各値でstroke bounds、重なり・はみ出しなし。
4. **Variant lifecycle:** 400→600→400（medium→wide→medium）、grid16→8→16、2bank fade前中後、seekとrepeat/volta。テンプレート・両bankのpath/幅の一致、wave countとFraction維持、hidden waveの非ハイライト。
5. **Chord-name resize:** 長いコード名＋1〜4コード/小節を400→1100→400→1100、初回1100と戻り1100で幅・可視文字が一致、図は全曲共通・非欠落。
6. **Screen evidence:** 400px grid16 JA Light/Dark、600px grid16 EN Light/Dark、参考PNGとの並置、表示後のwave高さ/色/隣接間隔のDOM数値付き。4小節とnextコード可視、外部Workbench panel遮蔽なし。
7. **Full tests:** 2 fade E2Eを含む`npm test` exit 0、焦点喪失時の診断記録。再現する未解決失敗はPASSにしない。

## 8. Verification

`npm run compile:all`, `npm test`, `npm run vscode:prepublish`, `npm run check:help`, `npm run check:ai`, `verify-implementation-contract 162`, `validate-docs --issue 162`, `git diff --check`, Required CI、最新HEAD Self-Review、`delivery-check`。実行不能な検査（例：`vsce ls`のDNS障害、Windows/Linux、VoiceOver/NVDA、optional E2E）はNOT RUNと明記しPASSとしない。

## 9. Reviewer Checklist

- [ ] ユーザー参考画像の「短い二山の波線」に近い、**点ではない**画面上の形状
- [ ] narrow/medium/wide固定SVG、400px painted height≥7px、gap≥1px
- [ ] Wave event数・Fraction・current/past・tie意味とARIA不変
- [ ] 400↔600とgrid切替・両bank fadeでvariantが同期
- [ ] 400→1100→400→1100でコード名幅・表示文字が初回1100と一致
- [ ] 4小節+next、diagram、melody、歌詞、PM、fadeは非回帰
- [ ] 必須実行規則・正式契約、画面証拠、全suite、CI、self-reviewを検証
- [ ] 未検証プラットフォーム・外部障害・未解決timeoutを透明に記録

## 10. Completion Report

変更ファイル、固定パス選択根拠、閾値とpainted bounds実測、wave数/拍位置結果、復元されたコード名画像、全E2Eテスト結果、2件のtimeoutの扱い、スクリーンショットURL、全チェックリスト、残余制約、commit/branch、**PR URL**を報告。commit/push/PR提出・review遷移まで。外部要因で未完了ならBLOCKEDとして正確な理由を示す。