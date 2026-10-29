# Issue #160 — Implementation Contract v2: 弾き語り譜のブラケットとギター譜表ブレース

> **2026-10-29 ユーザー決定による差し替え契約。** 旧Issue本文・旧承認コメント・PR #161の「複数譜表なら必ず1ブレース」はこの文書と矛盾する範囲で無効。PR #161は未マージであり、実装・仕様・テスト・Self-Reviewをこの契約に再同期させる。旧契約に基づいて実装した作業そのものは失敗と扱わない。

## 1. Repository Baseline
- 対象: Issue #160 / PR #161（現行確認HEAD `a72d7ab5fe69296abac31691dae7ce949afef70d`）。PRはopen/non-draft、Issueは `phase:review`。変更は新規Issueに分割せず現PRで修正する。旧PRのCI/自己レビューは新契約の適合証明として流用しない。
- 既存仕様: `docs/specs/guitardsl-syntax.md` §11・§12・§13・§14・§19、`docs/specs/extension.md` §4.3・§4.7。`mel:` は§12で歌のメロディ、`tab:` はギターの独立したTABソース、リズム譜表はギター伴奏として解釈される。`lyr:` がTABに付いてもTABが歌唱パートへ変わるわけではない。既存ヘッダーに独立した歌声/ギタートラック種別指定はない。
- 既存設計: `docs/design/preview-rendering-and-export.md`「Architecture」「レイアウトと出力の同一性」「Staff-group brace and inter-staff barlines」。ページ/連続プレビューは `src/render/svg.ts::renderSystem()` を共有し、PDFはそのページSVGを使う。
- 既存実装: `src/render/layout.ts::SystemGeometry/getSystemGeometry()` は実表示譜表と垂直オフセットを決定。`src/render/svg.ts::renderStaffGroupConnector()` は表示譜表を収集し、一律のブレースとx=25の左端線・譜表間小節線を描画。`src/render/notation.ts::measureBounds()` が共通x座標の唯一のauthority。描画済み五線譜最上/最下線は `MELODY_STAVE_TOP/BOTTOM`、TABは `geometry.tabOffset / tabStaffHeight`。描画bodyの移動は `geometry.annotationTop - geometry.lift`。
- テスト・状態: `tests/unit/render-melody.test.ts`, `tests/unit/render-tab.test.ts`, `tests/unit/render-advanced.test.ts`, `tests/unit/fixtures/legacy-render-hashes.json`, `docs/status/implementation-status.md`。作業規則: `AGENTS.md`, `.agent/project.json`, `docs/agents/testing.md`。

## 2. Architecture Decisions（今回の新決定）
### 2.1 パートの分類：新DSLを導入しない
- 各 `SystemRow` に **実際に描画される**譜表だけを列挙する。`mel:` が当該段に存在すれば `vocal`（歌唱）譜表を1つ、`geometry.containsTab` なら `guitar-tab` を1つ、`geometry.rhythmRendered` なら `guitar-rhythm` を1つとする。TABなしの既存リズム段は描画対象の `guitar-rhythm` とする。`show_rhythm: false` の単一リードシートで未描画のリズムは数えない。TAB時に非表示の暗黙リズムは数えない。
- `mel:` がギター演奏のメロディだと推測して種類を変えること、歌詞の有無・奏法・音高帯域・セクション名を使って分類することは禁止。既存仕様§12どおり `mel:` は歌唱メロディとみなす。歌唱以外への明示的なロール指定は別Issueの対象。

### 2.2 記号とネスト（決定表）
| 表示される譜表 | 外側ブラケット | 内側ギターブレース | 左端接続線 |
|---|---:|---:|---:|
| 歌唱メロディ＋リズム | 1（両段） | 0 | 1 |
| 歌唱メロディ＋TAB | 1（両段） | 0 | 1 |
| TAB＋明示リズム（歌唱なし） | 0 | 1（ギター2段） | 1 |
| 歌唱メロディ＋TAB＋明示リズム | 1（全3段） | 1（TAB＋リズムのみ） | 1 |
| メロディだけ／リズムだけ／TABだけ／単一リードシート | 0 | 0 | 0（既存譜表内線は維持） |
- ブラケットは別パートである歌唱とギターのまとまりを示し、ブレースは同じギターのTAB/ストローク譜表間だけを結ぶ。各記号はそれぞれsystem当たり最大1個。段の途中で歌詞や音符の有無が変わっても同段内でグループを分割しない。
- 全段でブレース一個、声を含むギター全体をブレースで結ぶ、2段・3段とも必ずブラケットのみ、歌詞がないときだけブレースへ変更する方式を**禁止**。

### 2.3 配置と形状（追加レイアウト再設計なし）
- 既存の譜表線左端 `STAFF_LEFT_EDGE=25`、譜表内の音部記号・調号・小節x・左端位置・段幅を変更しない。全てを `renderSystem()` と同じsystem local座標に描く。印刷用は黒、SVGベクターパス/ラインのみ、`pointer-events="none"`。
- **単独ブラケット**（歌＋ギター2段）: 垂直幹の基準x=11、横幅1.6、上下の終端装飾は右向き6単位以内、最上段の最上線から最下段の最下線まで。終端は単なるテキスト `[` ではなく、音楽用の輪郭（SMuFLの `bracketTop`/`bracketBottom` の考え方に沿った細い終端）をpathで描画。終端もx=25に達さない。
- **ブレース単独**（ギター2段）: 既存の基準x=0..22、右端と譜表左端x=25の3単位の間隔を維持。旧 `STAFF_BRACE_PATH` の中央の過太なV字形状を修正（前回PRレビューP1を引継ぐ）。上/下の尖端と中央の細いくびれを持つ滑らかな単一の閉じたcubic Bézier filled path。旧ポリゴン/不自然な中央の厚みを復活させない。
- **ブラケット＋ブレースの3段ネスト**: 内側ギターブレースは **TAB最上線からリズム最下線まで**を上記と同じx=0..22に置き、X方向圧縮はしない。外側ブラケットは全3段の最上線〜最下線を囲み、幹x=-12、横幅1.6、上下終端はx=-12..-6に収める（内側ブレースx>=0と最短6単位の隙間）。これらの装飾だけがsystemローカルの負のxまで延びる。外側ブラケットはページの既存12mm側余白内に収め、物理用紙/viewBoxのx<0や画面の切れは発生させない。カラム・紙幅・段倍率を変更して余白を稼がない。
- ブラケットの上下終端は小さく滑らかなフック状（SVG filled path）、垂直幹は直線とする。文字の `[` / `⎡` / CSS疑似要素で代用しない。新たなSMuFLフォントを依存に加えない。設計のSVG証拠はブラケット単独とネストの両方を新規作成する。
- 2段/3段の記号座標はsystem localの浮動小数で計算し、`fmt()` で最終出力を丸める。各譜表上下端への合わせ込みは `geometry.annotationTop - geometry.lift` を一度だけ加味する。縦スケール時にXのサイズや内部ギャップは変えない。

### 2.4 小節線・描画順・所有権
- `measureBounds()` が返す各小節境界xだけを使い、**隣接する描画済み譜表間の空隙**を細線で結ぶ。歌唱〜ギター間も同様に接続する。各譜表の内部の小節線は再描画しない。repeat/double/final/volta、タイ、奏法線、TAB運指への変更を禁止。
- x=25の既存グループ左端連結線は最上表示譜表から最下表示譜表まで **1本だけ**描く。3段の内側ブレース用の重複左端線を描かない。外側ブラケット・内側ブレース・ギャップ線は同じ `staff-group-connector` グループ内で背面に配置し、既存の再生anchor、編集hit-area、インタラクションを奪わない。
- 描画だけの純粋なprojectionで、`ParsedScore`、Compiler、Playback、Practice、状態owner、イベントlistener、タイマー、dispose/cleanupの追加はない。連続Preview、ページPreview、PDFは同一system SVGを使用する。

## 3. Exact Change Set
1. `src/render/svg.ts::renderStaffGroupConnector()` を改修。現行実表示譜表区間抽出を `role: 'vocal' | 'guitar-tab' | 'guitar-rhythm'` 付きの配列にして、その配列だけから装飾の種類・上下端・ネストを決定。区間をsort後、歌唱を含む場合だけ外側ブラケットを、ギター区間が2つの場合だけ内側ブレースを描く。`renderSystem()` の呼び出し位置、`playback-measure-anchor`、譜表本文のrender順序は維持。
2. `src/render/svg.ts::STAFF_BRACE_PATH` と `docs/specs/gui_design/proposals/issue-160/standard-brace-reference.svg` を一緒に修正し、中央のV字状過太部を解消。参考SVGは**ギター2段ブレースの形状参考**として位置付ける。旧Issue先頭の「歌＋ギターをブレースで結ぶ参考図」は歴史的資料であり新仕様の正本から外す。
3. `docs/specs/gui_design/proposals/issue-160/` に歌＋ギターの `bracket`、歌＋TAB＋リズムの `nested` 参考SVGを置く。元画像のブレース形状との違い、2段/3段100%/200%実レンダ画像も `docs/status/evidence/issue-160/` に保存してIssue本文へリンクする。
4. `docs/specs/guitardsl-syntax.md` §11、`docs/specs/extension.md` §4.3/§4.7、`docs/design/preview-rendering-and-export.md`、`docs/status/implementation-status.md` の旧「一律ブレース」文面を削除して分類表とネストを反映。ユーザーHelp（日/英）と `docs/help/help-manifest.json` を同期、生成AI参照はrepo所定コマンドで再生成・検査。
5. `tests/unit/render-melody.test.ts`, `tests/unit/render-tab.test.ts`, `tests/unit/render-advanced.test.ts` の旧ブレース個数をこの表に更新。SVG基準ハッシュをdiff目視検査後に必要なものだけ更新する。変更を別Issueへ分離しない。

## 4. Implementation Sequence
1. 旧契約と新契約の矛盾をIssue/PRに記録し、新契約を基準にする（古いapproved hash/HEADの自己レビューを再利用しない）。
2. 仕様/設計にパート分類・ネスト・座標の決定を書き、ブラケット単独とネスト参考SVGを作る。
3. `src/render/svg.ts` の装飾projectionをギターbrace／歌唱bracketに変更し、中央ブレース輪郭も修正。
4. ケース別幾何・参照SVG一致・既存動作のunit/E2Eを追加し、2/3譜表の通常倍率/拡大倍率の実レンダ結果を確認。
5. status/help/AI・必要なSVG hash更新、全ゲート、自己レビュー、commit/push、同じPR #161更新、Issueのreview stateに従い再レビュー依頼。

## 5. Required Runtime Semantics
- 1段ごとに装飾を一度だけ生成し、何度のプレビュー更新でも重複しない。単一譜表と空譜表は装飾なし。独立した歌唱譜表はブラケット、ギター二譜表はブレースである。
- メロディ＋TAB＋明示リズムの段では外側ブラケット1個＋内側ギターブレース1個であり、音符・歌詞・コード名はグループの端点ではない。TABのみに付く歌詞はギターのTAB区間として扱う。
- `show_rhythm:false`、TAB暗黙リズム、途中で歌唱がない小節、複数歌詞段、改段/ページ、転調、repeat・voltaでグルーピングが破損しない。
- 音価/再生/ソースと同期する小節x・PDF描画経路・SVG hit-area・レイアウト所有権は変わらない。例外や無効データでは装飾を描かず、パーサー診断の意味を変更しない。

## 6. Non-goals / Forbidden Changes
- `mel:` をギターと解釈する自動判定、`vocal:`/`instrument:`/トラックrole等の新DSL文法、UI設定追加、音源割当や再生構造変更。
- 一律ブレース、歌唱譜表とギター譜表を内側ブレースで連結すること、TABがあるだけで暗黙のリズム譜表を増やすこと。
- 既存の譜表x/小節x/幅/印刷レイアウト変更、全レイアウトリファクタ、新レンダラ、PDF固有描画、font/file依存の追加。
- 小節カード化、背景交互色、再生・編集ハイライト等の別機能。

## 7. Concrete Tests / Acceptance（各セットアップ→操作→結果）
- T01: `mel:`＋リズムの同段スコアを連続SVG/ページSVGで描画 → `staff-bracket=1`, `staff-brace=0`, x=25左端線1、各小節境界のギャップ線あり。
- T02: `mel:`＋TAB＋`show_rhythm:false` を描画 → ブラケット1、ブレース0、暗黙リズム譜表0、ギャップ1。
- T03: TAB＋明示リズム（歌唱なし）を描画 → ブレース1、ブラケット0、ギャップ1。TAB歌詞を付加しても分類不変。
- T04: `mel:`＋TAB＋明示リズムを描画 → ブラケット1（全3段）、ブレース1（下のギター2段だけ）、左端線1、各小節境界ギャップ2。ブラケットx=-12..-6とブレースx=0..22が重ならない。
- T05: melody only / rhythm only / tab only / lead sheet single staff、TABで暗黙リズムのみ → 追加group記号0・新規左端線0。既存の譜表内の縦線は維持。
- T06: 2段/3段で複数小節・構造的改段/手動改ページ/繰り返し・終止・複縦線・TAB技法・歌詞複数番 → 1system当たり正しい記号数、接続xは `measureBounds()` と等しい。構造要素の消失/重複なし。
- T07: 固定したSVG pathと参考形状の一致に加え、ブレース中央の太さ・左右の交差・先端をユーザー提示画像と同倍率で確認。`C`数・`L`不在だけではPASS不可。新ブラケット上下の終端にも角の破綻・重なりがない。
- T08: 2段（ブラケット、ギターだけブレース）、3段（ネスト）のそれぞれ100%/200%、light/dark、連続/ページ/PDFを画像で検収。最も左のブラケットが紙面/viewBoxからクリップされないことを幅の狭い用紙でも確認。
- T09: DOM playback-measure-anchor個数・x・編集hit-area・クリックが変更前と一致。重複再描画やイベントowner追加がないことを確認。
- T10: `npm test`の既存回帰（特にPDF・メロディ・TAB・ループ・編集）と設定help/AI検査を再実行。旧契約の成功結果を新HEADの結果として転載しない。

## 8. Verification
- `npm run compile`
- `npm run test:unit`
- `npm run check:help`
- `npm run check:ai`
- `npm test`（`docs/agents/testing.md` 指示のとおりVS Code/Electronを実行できるsandbox外で実行）
- `npm run vscode:prepublish`
- `npx @vscode/vsce ls`
- `git diff --check`
- `.agent/project.json` のverify hooks、`agent-required-check`、repo workflowの契約検証/ドキュメント検査。Windows/Linux/VoiceOver等を実施していない場合は `NOT RUN` と記録する。

## 9. Reviewer Checklist（実装前に固定）
- [ ] C01 `mel:`=歌唱、TAB・リズム=ギターとして判定し、勝手な推測・新DSLなし
- [ ] C02 ブラケット単独2段、ギターブレース単独2段、3段ネスト、単一譜表非表示を完全網羅
- [ ] C03 ブラケットは標準的な組版形状、ブレース中央の過太なV字は解消、形状の視覚比較あり
- [ ] C04 x=25左端線が重複せず、2/3段の上下端・ネストの余白・ページ内クリップなし
- [ ] C05 小節xと特殊小節線、TAB奏法・タイ・volta・反復を変更しない
- [ ] C06 Preview(連続/ページ)/PDFの同一SVG・100%/200%の画像証拠
- [ ] C07 annotationTop/lift・TAB/歌詞・show_rhythm・転調・改段/改ページの全分岐
- [ ] C08 編集hit-area/再生anchors/renderer ownershipを維持、新規非同期stateなし
- [ ] C09 spec/design/code/tests/status/help/AIの一致・全必須ゲート・旧snapshot差分の検収
- [ ] C10 同一PR #161のcommit/push/`Closes #160`、issue review移行、自己レビューとPR URL報告

## 10. Completion Report
変更ファイルと差分、C01–C10の自己レビュー、100%/200% SVG証拠、各テストコマンドと正確な結果、未確認環境、旧契約からの変更点、残課題、最終commit SHA、PR URL（`https://github.com/puchinya/vscode-guitar-dsl/pull/161`）を記す。PR更新・レビュー遷移不可なら `BLOCKED` として、完了を主張しない。

> This document is an Implementation Contract. Do not redesign the architecture during implementation. If a requirement conflicts with repository reality or requires a material design change, do not silently choose an alternative. Report the exact conflict and continue only with independent valid work.

### Workflow note
旧契約のapproval/comment/shaは履歴として残すが、この改訂を承認済みの契約と誤認させてはならない。repoのphase/approval手順で新しい契約revisionを再登録・検証してから実装/受入を進める。#161のHEAD self-review・CIは新HEADで再発行する。
