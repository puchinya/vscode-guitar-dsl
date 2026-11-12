# Implementation Contract v5 Delta — Issue #162 / PR #163 — コンパクト奏法SVGの参考画像準拠

**対象:** `puchinya/vscode-guitar-dsl` / PR #163 / Issue #162  
**基準HEAD:** `64615d3606886cc5aa7cc595aa11f65d42bd5f4f` （参考PNGとSVG見本を追加した状態）  
**承継:** [Issue #162 canonical Contract v4](https://github.com/puchinya/vscode-guitar-dsl/issues/162#issuecomment-6540557470) の変更しない規定は維持する。この文書は変更対象のみを決定するv5差分指示書。**実装前にIssue #162の正式canonical Contractとしてv5に昇格・検証すること**。勝手にv4のSHAや承認履歴を書き換えない。

> This document is an Implementation Contract. Do not redesign the architecture during implementation. If a requirement conflicts with repository reality or requires a material design change, do not silently choose an alternative. Report the exact conflict and continue only with independent valid work.

## 1. Repository Baseline

- `src/render/practiceGuideStrokeSvg.ts::renderPracticeGuideCompactStrokeSvgElement`: 現compact down/upは10×36、shaft=29、head=5×5、stroke=1.8で**SVG path描画**。詳細grid用の旧 `renderPracticeGuideStrokeSvg` は別実装。
- `src/render/previewHtml.ts::computePracticeGuideCompactLayout`: `stepWidth>=3` でgap=2、`layoutPracticeGuideCompactSvg` は `markWidth=max(12,naturalWidth)` と `scale(s,s)`。400px/4小節/grid16では実表示shaftが数pxに潰れる。
- `tests/e2e/extension.test.ts` Issue #162: 現行テストはmaster座標とcomputed stroke幅を見ているが、**最終画面でのshaftの高さ・線幅**を検証しない。
- **ユーザー添付写真からの実画面参照切出し**: [PNG](user-reference-stroke-pattern-crop.png)（元写真から矢印部分を切出し、白黒化したもの。スクリーンショット全体ではない）。図形による実装ターゲット: [SVG](stroke-svg-shape-target.svg)。上記は同ディレクトリに実ファイルとして登録済み。
- 現HEADの確認済み機能（4小節固定、1段、Fraction位置、wave個数、コード図、テンポ連動fade、コンパクトメロディ休符非表示）を変更しない。

## 2. Architecture Decisions

**変更する決定（v4との相違）:** 「width不足時はmasterをX/Y同倍率縮小」および「狭くなると高さ・線幅も縮小」ルールを**compact奏法SVGのみ**で破棄する。現ユーザーの見た目要求を優先し、**幅は拍間隔内へ収め、高さ・実効線幅は維持**する。通常譜面・詳細grid・音源・DSL・PlaybackTimelineの変更は禁止。

- 幅4・高さ30の **compact専用 path master** を下記で固定する。矢印のパスはフォント・Unicode・text・Bravura由来輪郭を使わず**独自SVG path**とする。全記号の線色は既存v4の濃色状態パレットを継続。
- 音楽上の拍アンカーは既存 `data-guide-at-fraction` と `data-guide-layout-anchor-x` のまま保持する。描画衝突回避位置は既存 `data-guide-layout-x` で保持し、beatを書き換えない。
- 奏法は一段・時間順、4小節同時可視・横スクロール無しの制約を変えない。同拍イベントは入力順に割り振る。
- **水平だけの表示圧縮は許すが、固定のSVG path `d` 自体は変形しない。** 各compact markerの `transform = translate(x,y) scale(sx,1)` とし、子pathに `vector-effect="non-scaling-stroke"` を付けてscreen上の実効線幅を維持する。`sx=min(1,usableWidth/naturalWidth)`。Yは常に1。詳細gridには波及させない。
- 技術的に表示領域が足りない異常密度（`usableWidth<2` CSS px）もDOMから項目を削らず、時刻・ARIAを維持する。ただし「全部を視覚的に分離しつつ一段と4小節を維持する」は幾何的に不可能な場合がある。該当入力・実寸を記録し、実装担当が独断で4小節化解除や記号省略をしない。

### Canonical SVG path data（**完全一致させる**）

**DOWN**: `viewBox="0 0 4 30"`、軸 `d="M2 1 V27.8"`、矢尻 `d="M0.55 24 L2 28.5 L3.45 24"`。  
**UP**: `viewBox="0 0 4 30"`、軸 `d="M2 29 V2.2"`、矢尻 `d="M0.55 6 L2 1.5 L3.45 6"`。  
**CONTINUATION / TIE**: `viewBox="0 0 5.6 30"`、`d="M0.4 15.2 C1.2 13.3 2 13.3 2.8 15.2 S4.4 17.1 5.2 15.2"`。  
共通の描線指定: `fill="none" stroke="currentColor" stroke-width="1.15" stroke-linecap="round" stroke-linejoin="miter" vector-effect="non-scaling-stroke"`。矢印の向き・矢尻が重ならず、縦長シルエットになること。継続波線は1 Fractionにつき1つで、短い独立波線を出す（連結伸長しない）。

これは添付写真から**設計した独自の近似パス**であり、写真のピクセル輪郭を自動トレースしたパスではない。参照画像に近い「細く高い矢印、短いwave、黒い輪郭」を受入軸とする。

**他のcompact記号の固定方針:** `both` は上記 DOWN / UP をX方向に各4単位ずつ並べた自然幅8、`brush` は `M0.5 11 L2.5 13 M2.5 11 L0.5 13` のcrossを含む自然幅8、`mute` は `<circle cx="2" cy="15" r="1.6">`（幅4）、`string` は自然幅4で既存の数字とARIAを維持。PMはラベルを時刻とともに保持し、compactでは必要な横幅と視覚位置を計算する（PM文字はフォント利用可。**矢印やwaveそのもの**はフォント禁止）。PMや複合記号もアイコン全体のYを縮小しない。

## 3. Exact Change Set

1. `src/render/practiceGuideStrokeSvg.ts`: `practiceGuideCompactStrokeVisualWidth`, `renderPracticeGuideCompactStrokeSvgElement` を上記4×30 masterへ変更。compact専用 `renderPracticeGuideCompactWavePathSvg` を**追加**し、既存詳細gridのwave API・SVG pathは変更しない。新矢印・waveの`d`をテストから参照可能な単一の定数で管理。
2. `src/render/previewHtml.ts::renderPracticeGuidePanel` のcompact techniques作成: compact continuation/tieを新compact waveへ切替。`data-guide-layout-width` は自然幅4/5.6/8を使う。タイ・波線数、Fraction属性、role/ARIA、曲名やコードは保持。
3. 同ファイル `computePracticeGuideCompactLayout` のtechniqueレーン: `gap = Math.min(0.5, Math.max(0, stepWidth - 4))` に変更。`packedWidth=Math.max(0.001,stepWidth-gap)`、同時刻配置順・anchor分離・一段維持。
4. 同ファイル `layoutPracticeGuideCompactSvg`: techniqueは `naturalWidth=Math.max(0.001, Number(item.dataset.guideLayoutWidth)||4)`、`usableWidth=min(packedWidth, slotWidth-x-5)`、`sx=min(1,usableWidth/naturalWidth)`、**`scale(sx,1)`** に変更。既存 `getBBox()` で図形中心yを取得し、`translateY=rowY+18-(bbox.y+bbox.height/2)` として高さ中心を維持。
5. `docs/specs/gui_design.md` §2.4、`docs/specs/extension.md` §4.6、`docs/design/preview-rendering-and-export.md`: compactのみ旧X/Y等率縮小からの例外、固定パスと画面実寸の受入条件を明記。日英Help・Help digest・生成物の同期範囲は既存検証フローに従う。
6. `docs/status/implementation-status.md`、`docs/status/evidence/issue-162/README.md`: 最終HEAD、v5差分の根拠、参考画像との差、画面証拠を更新。旧v4画像は歴史として残す。

## 4. Implementation Sequence

v5 canonical登録・検証 → master定数とrenderer → compact wave切替 → gap計算・横方向のみ圧縮 → unit → E2E → 画面撮影 → docs/help/status → 全体検証 → current-HEAD self-review → review。

## 5. Required Runtime Semantics

- 4小節表示、beat→x、Bank/opacityフェード、seek/repeat/volta、grid切替、resize、DOM差替え、reduced motionはv4と同じ。
- グリッド4/8/16切替時に古いwaveを二重描画しない。狭幅から広幅へのresizeで新レイアウトが再計算される。不要な永続listener/cacheを追加しない。
- 不正なfraction/幅は既存防御に従いクラッシュさせない。DOM markerを取り除いて解決しない。
- 原形矢印は30px高。400px・4/4・16独立attack小節ではarrow実描画shaft長**26px以上**、stroke見た目**1.0 CSS px以上**、1つのeventの矢印本数維持を目標受入値とする。CSSピクセル上の実値で検査。小節内の実際のslot幅とイベント密度で成立するかを先に検証する。

## 6. Non-goals / Forbidden Changes

音源、DSL、PDF、詳細grid、コードダイアグラム構造、字幕、歌詞、crossfade時間の変更禁止。外部音楽フォント/描画ライブラリ追加禁止。幅を増やす・水平スクロール・4小節数減少・記号省略・canonical waveの無断伸長/結合は禁止。元v4テストを削除してPASSにしない。

## 7. Concrete Tests

- **SVG unit**: 下・上・waveの自然座標と固定`d`、ベクトルPath、stroke、vector-effect、`<text>`/Unicode矢印非依存、PM/brush/mute/both/stringの構成。
- **400px / 4/4 / 16連続attack**: 4小節可視、各小節16 event、wave数、実SVG screenCTMとbboxからshaft高さ≥26px、実効stroke≥1.0px、0 overlap、0横overflow、拍anchorはFractionと一致。
- **400px / grid16 / quarter・half・tie**: 正しいwave数・1/4拍ごとの位置、各wave canonical`d`、波線は連結/省略されない。
- **320/400/421/600 × grid4/8/16 × melody ON/OFF**: 一行、番号/Fraction、四小節、bank更新・seek・fade、コード図/歌詞整列、japanese/english・light/dark。
- **400pxのPM・brush・both・simultaneous events**: 非重複・表示範囲・role/aria・時刻属性、明示した物理限界時の診断。
- **非回帰**: コンパクトのrest無表示、詳細gridのrest表示、従来のchord inheritance、tempo fade、旧テスト全件。

## 8. Verification

`npm run compile:all`  
`npm test`  
`npm run vscode:prepublish`  
`npm run check:help`  
`npm run check:ai`  
`npm run validate-docs -- --issue 162`（リポジトリでの実際のscript引数を確認してから実行）  
`git diff --check`  
Required GitHub CI; 最終HEADのE2E画像を手動目視（400px密度高サンプル優先）。Windows/Linux、VoiceOver/NVDA、optional E2Eは実施した分だけ記録する。

## 9. Reviewer Checklist (implementation前公開)

- [ ] 記号がパス図形で、文字フォント矢印を使わない
- [ ] PNG参照とSVG見本がPRにリンクされている
- [ ] down/up/waveの`d`と実画面サイズ・色が要件通り
- [ ] Xだけで縮めてもYと実効線幅が維持される
- [ ] 400px高密度でも4小節・1段・正確なFraction・0横overflow
- [ ] wave個数とtie、PM、brush、mute、弦番号・ARIAが保持される
- [ ] melodic rest / 詳細grid、chord、fadeの非回帰
- [ ] e2e screenshotを参照画像と視覚的に比較
- [ ] canonical v5が検証され、古いv4の根拠が無断改変されていない
- [ ] 全テスト・CI・self-review・PR完成ゲートを満たす

## 10. Completion Report

修正ファイル、checklistの逐項PASS/FAIL、各コマンドと実行環境、最終HEAD、画面証拠リンク、未検証platform、実際の幾何的制約と例外、契約逸脱、残作業、**PR URL**を明記。Issue #162の `Closes #162` を維持し、commit/push/PR review状態の進行まで実施。外部阻害は正確なerrorとともにBLOCKED扱いにする。
