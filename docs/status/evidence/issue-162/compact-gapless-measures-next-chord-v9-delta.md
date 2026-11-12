# Implementation Contract v9 Delta — コンパクト練習ガイドの小節間・次コード欄との余白ゼロ

- Repository: `puchinya/vscode-guitar-dsl`
- Issue: #162 — https://github.com/puchinya/vscode-guitar-dsl/issues/162
- PR: #163 — https://github.com/puchinya/vscode-guitar-dsl/pull/163
- Baseline HEAD: `5f6071d8400b2b5f4fd21bbaf1ece1ed8c32cbaf`（2026-11-02確認）
- Scope: **コンパクト4小節表示限定**。ユーザーの追加要求「小節間の隙間をなくす」「次のコードとの間の隙間もなくす」に対するv8への明示的な差分。

> This document is an Implementation Contract. Do not redesign the architecture during implementation. If a requirement conflicts with repository reality or requires a material design change, do not silently choose an alternative. Report the exact conflict and continue only with independent valid work.

## 1. Repository Baseline

- `docs/specs/gui_design.md` §2.4: コンパクトで4小節を常時同時表示、現契約はslot幅 `(pageWidth-16)/4`、bank内4px、bank間8pxを指定。**このv9で当該余白・slot算定のみ上書きする**。
- `docs/design/preview-rendering-and-export.md` のIssue #162設計節にも同一の16px余白仕様がある。最新版に更新する。
- `src/render/previewHtml.ts` CSS `.practice-guide-bank-content`: `gap:4px`。`placePracticeGuideBanks`: `baseSlotWidth=(viewportWidth-16)/4`、`leftWidth/rightWidth=slot0+slot1+4`、右bank `left=leftWidth+8`。合計4+8+4=16pxの空白を作る。
- 同 `layoutPracticeGuideCompactSvg`: 各SVGの境界線を`x=5`と`x=slotWidth-5`に描くため、CSS gapを0にしても小節境界近辺には視覚上の余白が残る。
- 同 CSS `.practice-guide-scale-layer {top:8px}` と `placePracticeGuideBanks` の `top:8px`、`outerHeight=8+layout.totalHeight+12` は、小幅で上段に置く次コード帯と小節先頭の間に8pxの空白を作る。
- 同 `.practice-guide-layout` はCSS Grid、`.practice-guide-next-chord` は481px以上で右欄（区切り用`border-left:1px`）、480px以下で上段（`border-bottom:1px`）。区切り線は空白ではない。
- 現行の `tests/e2e/extension.test.ts` は `stage.clientWidth-16` を期待する検証が存在する。これらの期待式を単に消さず、ゼロ隙間の実矩形検証に置き換える。
- Issue #162 canonical Contract v8、既存のSVG固定パス・Fraction・音価・歌詞・コード図・テンポ連動crossfadeは引き継ぐ。

## 2. Architecture Decisions

1. **コンパクト小節カード間のCSS空白0px**。2小節bank内、左bankと右bankの間のいずれも0px。4小節は横一列、幅分割は実測ページ幅 `W` を4等分。小節ごとの音楽内容に応じてカード幅を拡大しない。
2. **次コード欄との空白0px**。481px以上は最終小節カードの右辺と次コード欄左辺を一致させる（許容誤差0.5 CSS px）、区切りの1px `border-left` は維持。480px以下は次コード帯の下辺と4小節ページの上辺を一致させる（誤差0.5 CSS px）、1px `border-bottom` は維持。
3. **小節線はカード境界に**描く。内部5pxの左右拍描画insetはそのまま維持し、小節線のみ`x=0`/`x=slotWidth`へ移す。隣り合うSVGで境界を二重に太く見せないため、既存1pxストロークを端に合わせ、クリップ/重ね合わせの結果が1px相当の細い区切り線となるようにする。小節番号、拍x、wave、コード図、playheadには影響させない。
4. 上段の次コード帯に続く**コンパクトページ上端8pxの空白を廃止**。`scale-layer`のCSSとinlineの`top`は0px。`outerHeight=layout.totalHeight+12`に揃える。ページ下側の既存12pxは縦スクロール・固定パネルとの呼吸余白として維持し、次コード欄との間隔とは扱わない。
5. `.practice-guide-layout` 自体もコンパクト時に `column-gap:0; row-gap:0` を明示。右欄の内部paddingやコード名とコード図の内部gapは**維持**（情報の視認性・タップ領域保護のため）。
6. 空bankや最終ページに実在小節が4件未満の場合は既存の4スロット容量と実際の発生数を維持。存在しない小節を偽造しない。空き容量を「小節間gap」として埋めるための新規プレースホルダーは作らない。
7. 詳細グリッド、通常譜面、次コードの内容・更新タイミング、再生/seek/fadeの2bankライフサイクルは不変。

**Rejected:** `gap:0`だけを変更しslot式に16pxを残す（右端に16pxの空白が残る）。bank間8pxだけ除去する（同bank内4pxが残る）。カード間の空白を `margin` やSVG背景で覆い隠す（座標不変条件が崩れる）。全SVGのinset 5pxを0にする（音価・波線・指板境界の既存配置が変わる）。次コードの内側paddingを0にする（情報が枠に接する）。

## 3. Exact Change Set

**`src/render/previewHtml.ts`**

- CSS: `.practice-guide-bank-content { ... gap: 0; ... }`、`body.guide-compact-mode .practice-guide-layout { column-gap:0; row-gap:0; }`、`.practice-guide-scale-layer { ... top:0; ... }`。
- `placePracticeGuideBanks(capacity)`:
  - `const baseSlotWidth = Math.max(0, viewportWidth / 4);`
  - `const finalSlotWidth = Math.max(0, viewportWidth - baseSlotWidth * 3);`
  - `guideCompactSlotWidths = [baseSlotWidth, baseSlotWidth, baseSlotWidth, finalSlotWidth];`
  - `leftWidth=guideCompactSlotWidths[0]+guideCompactSlotWidths[1]`、`rightWidth=guideCompactSlotWidths[2]+guideCompactSlotWidths[3]`。
  - 右bank `left=leftWidth`、左bank `left=0`。bank幅とカード幅を実数精度で整合させる。
  - `const outerHeight = layout.totalHeight + 12;`、`practiceGuideScaleLayer.style.top = '0px'`。
- `layoutPracticeGuideCompactSvg(card, slotWidth, layout)`: `.practice-guide-measure-boundary`の`start`位置を`x=0`、`end`位置を`x=slotWidth`へ。ストロークは既存1pxのまま。**`compactGuideX()`の`inset=5`は変更しない**。
- 次コードのDOM/CSS: 既存右/上の1px仕切りを保持。必要に応じコンパクト時のGrid gapを0と明示する。aside内部padding/gap/図形寸法は変更しない。

**Tests:** `tests/e2e/extension.test.ts` の `-16` を使うslot期待値、古いgap前提のメッセージ、bank座標期待値・参照画像比較を更新。コードの数式変更に加え**最終DOMで実測する**テストを追加。

**Docs:** `docs/specs/gui_design.md` §2.4、`docs/design/preview-rendering-and-export.md` Issue #162節、`docs/specs/extension.md` §4.6の関連記載、Help（ja/en）への影響確認、`docs/status/implementation-status.md`と`docs/status/evidence/issue-162/README.md` を更新。古い画像は歴史的証拠として区別し、最終HEADの新しいスクリーンショットを追加。

## 4. Implementation Sequence

1. Canonical Contract v9としてIssue #162に採用した変更条件を記録し、v8と旧gap仕様の差分を確定する。
2. コンパクトCSS bank/layout/scale-layerのgapとtop余白を変更する。
3. `placePracticeGuideBanks`のcard/bank幅とleft計算を同時変更し、合計がviewport実幅と一致するようにする。
4. 小節境界線のみカード端へ移す（beat座標insetは変更しない）。
5. 既存幅期待値テストを修正し、境界・次コードとの間隔に関する実DOM E2Eを追加する。
6. 代表幅の最終HEAD画像を撮影・目視比較し、docs/status/helpを同期する。
7. 検証、全Reviewer Checklist、Self-Review、PRコメントを更新する。

## 5. Required Runtime Semantics

- **初回表示/ページ送り**: 4小節は実際のページ幅を4分割し、各隣接カードの`right≈next.left`。左右bankの境界でも同じ。pageやSVGには横スクロールを出さない。
- **再生中/seek/repeat/volta/手動page**: 現在小節・playhead・Chord/wave/Fraction・次コード欄の内容は従来どおり。変えるのは純粋な配置座標と境界線位置のみ。
- **クロスフェード**: outgoing/incomingのカードxと幅は一致。新しいbankが入っても隙間や位置ジャンプがない。中断/重複イベント/Resize中/Reduced Motionで古いfade DOMが残らない。
- **480⇄481px境界**: 次コードが上段/右欄へ変わっても、上・右側のいずれも空白0px。再配置フレームが完了したら実矩形で検査。
- **短い曲**: 実在カードだけ表示し、残り容量は従来どおり。偽の小節・コードは出さない。
- **離脱/Drop/再build**: 新たな購読/タイマー/状態を追加しないので、既存cleanup/generationを変更しない。

## 6. Non-goals / Forbidden Changes

- CSS gapだけ変更して16pxの幅予約を残すことは禁止。
- ビート`compactGuideX`の5px内側マージン、奏法・歌詞・メロディのFraction時刻、コード図の正方形を変更しない。
- 次コード欄の内部余白・文字・Diagram、詳細グリッドのサイズ、DSL/Compiler、PDF、音声処理、fade時間の変更を禁止。
- 4小節を2/1へ減らす、横スクロール、カード重ね・負margin、空白マス目の捏造を禁止。

## 7. Concrete Tests

1. **幅テスト**: 320/360/400/421/480/481/600/601/840/1100/1600 CSS pxの各幅で4実在小節。`slot0+slot1+slot2+slot3=stage.clientWidth±0.5`、全slotは原則`W/4±0.5`、`scrollWidth<=clientWidth+1`。
2. **小節間0px**: `DOMRect`を表示順に4カード収集し、すべての`next.left - prev.right`の絶対値 `<=0.5px`。左bank内、左/右bank間、右bank内を個別にassert。bank-contentのcomputed `gap === '0px'`。計算はフルページ幅/4と照合。
3. **小節線**: 各SVGの開始小節線の`x1==x2==0`、終了小節線`x1==x2==slotWidth`。SVGストローク幅1px、隣接境界線が視覚上1pxの連続線であることを画面で確認。拍のx座標と内容の内部5px insetは不変。
4. **次コード・右欄**: 481/600/601/1100/1600で`|nextChord.left-lastCard.right|<=0.5px`、computed grid `column-gap=0`、境界1px。次コード名・図が完全に表示され、図・内部paddingは不変。
5. **次コード・上段**: 320/400/480で`|firstCard.top-nextChord.bottom|<=0.5px`、computed `row-gap=0`、次コード1px下線、scale-layer `top==0`。小節列の先頭に8px余白なし。
6. **操作中**: 400/481/1100で手動ページ送り・再生・seek・bank crossfade中と完了時・Resize・縮小/展開・Reduced Motionでも1〜5の数値不変、スクロール0、重複bank残存なし。
7. **音楽情報非回帰**: grid4/8/16、長音価・タイ・PM・brush、歌詞省略+現在全文、角形メロディ、コード図名の対応、ページ最後の少数小節を確認。
8. **画像証拠**: 400px JA Light/EN Dark（上段次コード）、600px EN Darkと1100px JA Light（右欄次コード）、400px grid16とfade中を最終HEADで撮影し、「カード間の真っ白な帯/次コード前の空白なし」「区切り線あり」を目視確認する。

## 8. Verification

- `npm run compile:all`
- `npm test`（unitとVS Code E2E; 実施件数/pendingも記録）
- `npm run vscode:prepublish`
- `npm run check:help`
- `npm run check:ai`
- Repository正式の`validate-docs --issue 162`、Contract検証とPR workflow check
- `git diff --check`
- Required GitHub CI `agent-required-check`

未実施のWindows/Linux、手動VoiceOver/NVDA、pending E2EはPASSと主張しない。

## 9. Reviewer Checklist

- [ ] 小節内部gap 0、bank間gap 0、slotの総幅はstage全幅
- [ ] 4カードの3つの境界で0.5px以内の隣接が成り立つ
- [ ] SVG境界線はカード端、拍用5px insetは不変
- [ ] 481px以上で次コード右欄との空白0、480px以下で上段との空白0
- [ ] 次コードの境界線・内部padding・名前・図は正常
- [ ] 新旧bank fade中のカード座標/幅が一致、cleanup・Reduced Motion/seek/resizeが回帰しない
- [ ] 4小節/短い曲、歌詞、奏法波線、コード、角形メロディの非回帰
- [ ] E2EはDOM実矩形と計算式を検査し、古い`W-16`期待値を残さない
- [ ] 代表画像は**最終HEAD**から撮影し、見た目の空白を目視で確認
- [ ] Specs/design/help/status、契約・CI・Self-Reviewを更新

## 10. Completion Report

変更ファイル/commit SHA/Issue canonical Contract v9リンク、実装・E2E結果、全チェックリスト判定、修正前後の小節間・次コード境界の実DOM差分（CSS px）、代表画面の画像リンク、未検証環境・契約逸脱/Blockerを記録し、**Pull Request URL**を必ず明示。実装完了はcommit/pushと`Closes #162`を含むPRのレビュー準備まで進めること。PRが作成できない場合は正確なエラーと共にBLOCKEDと報告する。