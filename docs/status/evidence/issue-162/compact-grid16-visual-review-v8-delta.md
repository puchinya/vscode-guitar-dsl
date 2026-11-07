# Implementation Contract v8 Delta — PR #163 / Issue #162

**対象**: `puchinya/vscode-guitar-dsl` · PR #163 · 2026-11-02  
**レビュー対象**: `c920acc3767bf1fd4cf1cdae827e25fa86f9d65f`  
**判定**: **CHANGES REQUIRED**。既存の機能テスト合格は、添付16分グリッド画面の視覚受入を意味しない。  
**参照画面**: `docs/status/evidence/issue-162/practice-guide-grid-issue162-ja-light-400-grid-16-contract-v7-matrix.png`, `practice-guide-grid-issue162-en-dark-400-grid-16-contract-v7-matrix.png`, `practice-guide-compact-lyrics-issue162-en-en-dark-600-contract-v7-final.png`, `practice-guide-compact-lyrics-issue162-ja-ja-light-400-contract-v7-final.png`。

> This document is an Implementation Contract. Do not redesign the architecture during implementation. If a requirement conflicts with repository reality or requires a material design change, do not silently choose an alternative. Report the exact conflict and continue only with independent valid work.

## 1. Repository Baseline

- Issue #162 canonical Contract v7: [comment #6554947800](https://github.com/puchinya/vscode-guitar-dsl/issues/162#issuecomment-6554947800)。要求: 400pxで4小節、左ラベル非表示、歌詞一段、固定SVG奏法、テンポ連動2-bank fade。既存契約は履歴として保存する。
- `src/render/previewHtml.ts::layoutPracticeGuideCompactSvg` (対象HEADの2420–2454行) は歌詞を7–13pxにしても幅が足りないと `textLength=availableWidth` / `lengthAdjust="spacingAndGlyphs"` を設定する。文字そのものを横方向に潰すので、実画面では判読不能となる。`tests/e2e/extension.test.ts` 2746行はこれを許容し、表示幅のみでPASSにしている。
- `src/render/previewHtml.ts` 4643行（最新HEADでは前後数十行ずれる可能性あり）の `practice-guide-compact-pitch-bar` は高さ6に対して `rx="3"`。最終SVGは両端が半円のカプセルになる。
- `src/render/practiceGuideStrokeSvg.ts::PRACTICE_GUIDE_COMPACT_PATHS.wave` は幅5.6の短い個別波形。16分位置の間隔に対して表示上の幅が長いため、連続波線の列が繋がって見える。**音楽上のイベント数・発音時刻が誤っているかは、この静止画だけでは断定できない**。`tests/e2e/extension.test.ts` 1550–1556行の検証素材は、1小節目`4.d 4.u 4.d 4.u`、2小節目`8.d 16.d 4 4 4 16`、3小節目`4.u.t 4 2`、4小節目16分奏法連続のケースである。
- 正確な音価、Fractionアンカー、既存奏法rendererの意味、`renderPracticeGuideCompactWavePathSvg`、`:computePracticeGuideCompactLayout`、`:updatePracticeGuideUi`、4小節固定と一段配置、曲の再生順による歌詞verse選択、コンパクトメロディ休符なしの不変条件を維持する。

## 2. Architecture Decisions

**B/P1 — 歌詞の横潰れ（旧契約の密度・全文・可読性の衝突を解消）**

- 歌詞の**字形のX/Y非等方変形を全面禁止**する。特に `lengthAdjust="spacingAndGlyphs"`、`scaleX`、`transform: scaleX` を歌詞へ使わない。`textLength` もcompact歌詞から削除。レンダリングフォントは日本語・英語とも上下比を保持する。
- 1段・横並び・正しいevent/Fractionは維持。通常の歌詞表示は**13pxから10pxまで**のフォントサイズだけで幅へ適合させる。選択中verseだけ見せる。幅見積もりを文字種の固定係数だけに頼らず、ブラウザSVG `getComputedTextLength()` / `getBBox()` により実測する。計測後のレイアウトは決定論的に行う。
- **両立不能の条件を明示**: 400pxで4小節を表示し、1小節あたり16個の長い文字列を全部実寸10px以上で同時可視にするのは物理的に不可能。従って密度超過時には、歌詞イベントのmetadata/全文/ARIA/titleを保持した上で、**各スロットの表示文字だけをその境界内で省略**する。省略記号すら収まらない4px等のスロットは可視文字を空にし、境界位置の細い非文字マーカーで時刻を示す。各歌詞全文はガイドの上段の**現在歌詞表示**で10–13px・一行・可読状態として表示する。上段の現在歌詞表示が画面幅に収まらない場合、本文全体に改行/字形圧縮をせず、その表示領域だけ横方向スクロール/フェードで閲覧可能にする。4小節ページ本体には横スクロールを導入しない。
- 上段現在歌詞表示はPractice Guideのheader内に1個だけ設け、`updatePracticeGuideUi`の現在lyrics選択に追従する。pause/seek/stop/repeat/volta/page/fadeで当該verse/eventを使い、DOMを複製しない。明示的に歌詞ゼロなら内容は空。ガイドcollapse時は非表示。新状態を音楽モデルへ追加しない。
- このフォールバックは旧v7の「全文を各tiny SVGセルに表示し、字形を圧縮する」方針をこの部分だけ上書きする。省略を認めずに同一画面で全文・無変形を要求する代替案は実現不能として却下。フォントを7px未満へ落とす案も却下。

**B/P1 — 16分ストロークの波線の連結と意味検証不足**

- 各継続waveは独立 `<path>` のまま、**各グリッドFractionに1本だけ**配置する。音価/タイ/休符による生成数を勝手に変えない。各attackの方向・種別・PM/brush/string/muteを維持する。音楽データとSVGの意味をテストで別々に検査する。
- 16分グリッド専用wave形状は30高・**2.4幅**とし、次の固定パスに変更する（フォント文字は禁止）。`
  d="M0.15 15 C0.45 13.8 0.9 13.8 1.2 15 S1.95 16.2 2.25 15"`
  パスは `fill="none"`, `stroke="currentColor"`, `stroke-width="1.15"`, `stroke-linecap="butt"`, `vector-effect="non-scaling-stroke"`。16分wave自体をX方向だけ破壊的に変形しない。wave SVG viewBox `0 0 2.4 30`。波形の存在を確認し、隣と**最終描画の線幅込みで1px以上の空白**ができるよう、time anchorは維持しつつ既存視覚オフセット領域で配置する。グリッド4/8の波線は既存の5.6幅固定パスを維持する。
- 実装は描画時に選択gridが16の場合のみcompact16-wave rendererへ切替。前後のグリッド切替・template/bank/再レイアウト時は選択gridに合うpathを必ず再生成または正しいSVG variantを選択する。hidden variantのDOMが再生ハイライトの現在判定を汚染してはならない。
- 最低間隔が確保できない極端な幅/複数同拍のケースは、位置・本数を消さず再現条件をCompletion Reportへ報告。4小節を伸ばさない。
- **図形と意味の別々の受入:** 上記fixtureの1小節目は四分4イベントの順に`down/up/down/up`であることと、grid16で各四分の内部3継続波線（合計12）が正しいevent ID・Fractionに結びつくことを比較。2小節目・3小節目は予想値を実DSLパーサーが与える音価から**独立のテスト期待値として定義**し、現renderer出力から期待数を自動生成しない。4小節目の16分奏法には余分な継続waveがないことを検証する。

**C/P2 — メロディバーの丸み（ユーザー新規要望）**

- Compact melody `rect`は **`rx="0" ry="0"`** とし、4隅が直角の矩形にする。CSS `border-radius` による丸みを付与しない。高さ6px、拍に基づく横幅、MIDIによるY、配色のcurrent/past/next、休符を出さない既存仕様は維持する。詳細gridのバー形状は本タスクで変更しない。

## 3. Exact Change Set

1. `src/render/previewHtml.ts::layoutPracticeGuideCompactSvg` lyric分岐（2420–2454行）: `textLength`/`lengthAdjust`を廃止し、13–10pxで実測に基づく縮小、イベント範囲で表示文字省略/時刻マーカーのルールへ置換。templateコピーと幅/verse/resize/page切替でフルテキスト属性・表示文字を復元する。
2. `src/render/previewHtml.ts::computePracticeGuideCompactLayout` lyric測定: 選択verseの1行高さ（現28px）を維持し、maxRowsを増やさない。`compactGuideTextWidth`概算は初期値に限り使用し、最終値は実SVG計測で確定。
3. `src/render/previewHtml.ts::renderPracticeGuidePanel` / `::updatePracticeGuideUi`: headerに唯一の現在歌詞表示を追加し、playback eventと同じ選択時刻・verseで同期。ARIA / title / 英日Help対応。
4. `src/render/practiceGuideStrokeSvg.ts`: `renderPracticeGuideCompactWavePathSvg`に16分専用の2.4幅版を追加。4/8版・攻撃down/upの4×30パス・詳細gridは変更しない。
5. `src/render/previewHtml.ts` technique event renderer (`isGridContinuation`) と `computePracticeGuideCompactLayout`: grid16 variantを正しいFractionへ対応付け、隣のwaveとscreen stroke boundsが接触しない視覚オフセット/pack幅にする。
6. `src/render/previewHtml.ts` compact `pitch-bar` emitter（4643行前後）: `rx="0" ry="0"`、角丸なし。
7. `docs/specs/gui_design.md` §2.4、`docs/specs/extension.md` §4.6、`docs/design/preview-rendering-and-export.md`、英日Help、`docs/status/implementation-status.md`、`docs/status/evidence/issue-162/README.md`を更新。Issue #162にcanonical Contract v8として登録してからコード変更を行う。

## 4. Implementation Sequence

canonical v8登録/照合 → compact pitchバーの角修正 → grid16専用waveと分離テスト → lyricの字形圧縮廃止・密度fallback → current lyric表示と同期 → unit/E2E → 幅・テーマ・言語別の再撮影 → docs/help/Contract検証 →全体テスト → self-review → PRレビュー。

## 5. Required Runtime Semantics

再生・停止・一時停止・Seek・テンポ変更・resize・grid4/8/16切替・compact/detailed・melody ON/OFF・verse/repeat/volta・2-bank crossfade・reduced motionで、歌詞全文は音楽データとARIA内に残り、可視compact textはレイアウトに応じて再計算する。隠れたverseは描画レイアウトへ影響しない。bankの入替中は現行eventの歌詞のみ1つ表示する。waveは開始・終了・現在位置の正確なFractionを守り、past/current/nextの時刻判定を独立に維持。リサイズを往復しても余計なSVGパス・歌詞focus表示・波線が残らない。

## 6. Non-goals / Forbidden Changes

新たなDSL構文、audio/synth、PlaybackTimeline、PDF/通常譜面、詳細grid、コード図/コード名の体系、左レール、既存ガイド4小節、奏法のattack path、テンポfadeの時間関数を変更しない。禁止: 歌詞の `spacingAndGlyphs`・非等方縮小・7px以下の強制縮小・自動改行、奏法の波線を連続長波形1本に統合、音楽イベントの間引き、角丸compactメロディバー。

## 7. Concrete Tests

1. **歌詞の実レンダリング**: 400px×4小節×1小節16日本語/英語音節（長語を含む）。SVG lyricには`textLength`も`lengthAdjust`もX scaleもなし、計測した実フォント10–13px、字形横縦比を維持。全イベントの元テキスト/beat/Fraction/ARIA/titleは完全一致。表示は一段・非重複・card境界内。密度超過時は表示省略/マーカーとなり、選択中の全文をfocus表示へ読み取れる文字サイズで出す。
2. **歌詞の通常密度**: 4小節・1小節4音節、幅400/600/1100では省略なしで横並び。日英/Lt/Dk、verse切替・リサイズ往復・Seek・fadeのfocus表示に重複や残留なし。
3. **奏法の意味**: fixtureの小節1（`4.d 4.u 4.d 4.u`）ではattack方向4件、grid16 wave12件、独立イベント+Fraction対応。小節2/3の独立期待値、小節4の16分attackと余分なwaveゼロ、同拍・タイ・休符・PM/brushの誤描画なし。縮小せず正しい攻撃矢印パスであること。
4. **奏法の見た目**: grid16 waveをSVG固定パスで描き、表示後のpath strokeを含む矩形で隣同士1px以上空ける。4/8に戻したら従来5.6幅パスで正しく描画。400pxおよび320/421/600の実DOM + 画像で連続した水平波線に見えないことを検証。
5. **メロディ**: compactの全pitch-barに`rx=0,ry=0`、角の画素は直角、ピッチ/音価からの矩形サイズは従来どおり。休符ノード0、詳細grid非回帰。グリッド16の16分音価が丸い点に見えない。
6. **スクリーンショット**: `practice-guide-grid-issue162-*-400-grid-16` と `practice-guide-compact-lyrics-*`を最新HEADで撮り直す。JA/EN×Light/Dark×400/600pxを含み、参考パスPNG/SVGと並べて人間が判読性を判定。ファイルの存在やE2E PASSだけを視覚品質の証拠にしない。

## 8. Verification

`npm run compile:all`, `npm test`, `npm run vscode:prepublish`, `npm run check:help`, `npm run check:ai`, repositoryの`validate-docs --issue 162`と`verify-implementation-contract 162`、`git diff --check`、Required CIを現HEADで実行。Windows/Linux/VoiceOver/NVDA、optional E2E等の未実施は必ずNOT RUNとする。PRの既存報告（Unit 1,233 / E2E 128 + pending6）は今回の新規検証を保証しない。

## 9. Reviewer Checklist

- [ ] 16分スクリーンショットの歌詞が横潰れせず、実際に読める
- [ ] SVG lyricの`textLength`・`spacingAndGlyphs`・非等方transformが完全にない
- [ ] 密度超過でも元歌詞/ARIA/拍位置は完全保存・現在全文は別表示で可読
- [ ] 全てのstroke attack方向/タイ/休符/波線生成数が独立オラクルと一致
- [ ] 16分waveは1つ1つ分離し、グリッド4/8版や詳細gridを壊さない
- [ ] compact melody-barは矩形の角（`rx=0`）で、pitch/音価/状態色は正常
- [ ] 4小節・1段・ラベル列なし・コード図・fade・再生への非回帰
- [ ] 現HEADで画面撮影＋比較・全テスト・Contract照合・Self-Review・Required CIがPASS

## 10. Completion Report

変更ファイル、再現条件/解決方法、確定したfont fallback、waveごとの独立期待値と実結果、撮り直した画像URL、全Verification（未検証を含む）、各Reviewer Checklist判定、Issue canonical v8リンク、契約逸脱・残課題、**PR URL**を記載する。commit/push/PRレビューまで実施し、外部要因で阻まれた場合は`BLOCKED`とする。