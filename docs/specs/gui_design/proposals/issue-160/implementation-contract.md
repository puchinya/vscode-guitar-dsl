# Implementation Contract — 複数譜表の標準ブレースと小節線接続

## 1. Repository Baseline
- 対象: `puchinya/vscode-guitar-dsl`。新規の単一Issue。関連: #35（メロディ）、#70（譜表配置）、#89（TAB）、#158（Preview編集）。既存Issue検索でブレース専用Issueは未検出。
- 仕様: `docs/specs/guitardsl-syntax.md` §11（楽譜レイアウト）、`docs/specs/extension.md` §4（Preview / PDF）。
- 設計: `docs/design/preview-rendering-and-export.md`「Architecture」「レイアウトと出力の同一性」。`renderScoreSheets()` と `renderContinuousSvg()` は `src/render/svg.ts::renderSystem()` を用い、PDFはページSVGを再利用する。
- 実装: `src/render/layout.ts::getSystemGeometry()` は `kind`, `containsTab`, `rhythmRendered`, `rhythmOffset`, `tabOffset`, `tabStaffHeight`, `finalRhythmOffset`, `annotationTop`, `lift` を持つ。上段メロディの五線は y=70..102、通常リズム五線もローカル y=70..102、TABは `tabOffset..tabOffset+tabStaffHeight`（通常50）。`src/render/notation.ts::measureBounds()` は各譜表の共通小節 x 位置を返す。`src/render/melodyStaff.ts`、`src/render/svg.ts::renderSystemSvgContent()`、`src/render/tabStaff.ts` は既存の譜表線・小節線を描く。
- テスト: `tests/unit/render-melody.test.ts`, `render-tab.test.ts`, `render.test.ts`, `render-advanced.test.ts`。状態: `docs/status/implementation-status.md`。作業手順: `AGENTS.md`, `.agent/project.json`, `docs/agents/testing.md`。

## 2. Architecture Decisions（今回の追加決定）
**目的**: 一つの段（system）に並ぶメロディ五線・コード／ストローク五線・TABを、一般的な楽譜の記法で一つの譜表グループと認識できるようにする。特にユーザー提示画像の**音楽用ブレース（brace、波形の大括弧）**を採用する。

1. **ブレースは「段全体の譜表グループ」記号**であり、各小節に繰り返さない。各systemの左端に最大1個。小節の同時性は共通 x 座標の小節線で示す。
2. **譜表カウント**: 実際に描かれる五線／六線のみ数える。メロディ、表示対象のリズム五線、TABを各1譜表とする。コード名、歌詞、コード図、注釈レーンは数えない。2譜表以上ならブレースと左端接続線を表示、1譜表のみなら両方を追加しない。例: メロディ＋リズム=表示、メロディ＋TAB=表示、TAB＋明示リズム=表示、メロディ＋TAB＋リズム=表示、メロディだけ/リズムだけ/TABだけ/リードシートの単一譜表=非表示。TABありでも非表示の暗黙リズムを架空の譜表として数えない。
3. **外形**: 一般的なピアノ大譜表のengraved braceに合わせ、上端・下端の細い尖端、中央の絞り、上下の曲線と太細を持つ**閉じたfilled SVG path**とする。通常の文字 `{`、CSS border、一定太さのstrokeによる近似、角括弧（bracket）は禁止。黒の印刷用記号とし、描画結果を提示された参考画像の輪郭と目視比較する。高さだけを対象譜表の最上線〜最下線に合わせ、横幅を不自然に拡大しない。
4. **接続**: 左の譜表端 x=25 を最上線〜最下線まで細い直線で結び、その左側にブレースを配置する。ブレースは x=25 の既存五線・音部記号・調号と重ならないよう x<25 の既存余白内に収める。内部の各小節境界は `measureBounds()` が返す同じ x を用い、隣接する譜表の最下線と次の譜表の最上線の**隙間だけ**を細線でつなぐ。既存譜表内の小節線を重ね描きしない。反復・複縦線・終止線・volta・タイ・TAB運指を上書きせず、譜表間の接続は共通境界の単一細線とする。既存の特殊小節線の種類／線幅と記号は各譜表内で保持する。
5. **描画authority**: 譜表の実在と上下端は `SystemGeometry` と `renderSystem()` の分岐から導出する。小節 x は `measureBounds()` だけを使用。新たな譜表イベントモデル、別座標系、別PDF描画器を作らない。追加するグループ装飾は同じ `<g class="system">` 内、既存 `annotationTop - lift` のbodyと同じローカル座標に置き、`scale` / 改段 / 改ページに追従させる。
6. **互換性**: DSL構文、パーサー、再生／Practice、クリック編集バインディング、譜表の段数、`measureBounds()`、`startX`、`systemScale`、用紙レイアウトは変更しない。装飾は `pointer-events="none"` とし、既存アンカーや編集対象のクリックを奪わない。Previewのライト／ダーク、連続／ページ、PDFは同一ベクター形状を使う。背景の交互着色・小節ハイライト・表示設定の追加は**本Issueに含めない**。
7. **禁止代替案**: 各小節ごとの波括弧、`{` テキスト描画、譜表を画像化した埋め込み、音符やリズムの再配置、Preview限定のDOM後付け線、PDFだけ別実装。

## 3. Exact Change Set
1. `src/render/svg.ts` — `renderSystem()` から呼ぶ純粋な譜表グループ装飾生成関数を追加する。譜表区間（`{top,bottom}`）を実際の描画分岐から求め、ソートして隣接区間を接続する。入力は当該 `SystemRow` と既存 `RenderContext`。`<g class="staff-group-connector" pointer-events="none">` に左の連結線・`<path class="staff-brace">`・各小節境界のギャップ連結線をまとめ、譜表コンテンツの下に重ねる。
2. 位置定義は `src/render/layout.ts` の既存定数を参照する。2/3譜表ごとの専用定数の複製は禁止。必要なら既存座標の可視性のためだけに共有定数をexportする。譜表・ページサイズそのものは変えない。
3. `docs/specs/guitardsl-syntax.md` §11、`docs/specs/extension.md` §4、`docs/design/preview-rendering-and-export.md`、`docs/status/implementation-status.md` に本挙動と表示条件を反映。ユーザー向けヘルプ変更の要否と`docs/help/help-manifest.json`のdigestを確認。生成AI参照は規定のコマンドで検証する。
4. `tests/unit/render-melody.test.ts` と `tests/unit/render-tab.test.ts` を中心に、表示条件と線の幾何を機械検証する。差分で変わるレガシーSVG fixture/hashがある場合、差分の視覚検収を経て必要最小限更新。

## 4. Implementation Sequence
1. 関連spec/designと対象rendererの分岐を再照合 → 仕様の表示条件を明記。
2. 現行systemの描画済み譜表区間を導出する関数を実装。
3. 印刷品質のブレースfilled pathと x=25 の左端接続、各小節の譜表間ギャップ接続を `renderSystem()` に組み込む。
4. 単一・二重・三重の譜表構成、段／ページ改行、特殊小節線のテストを追加。
5. specs → design → code/tests → status/help → 実画像検収 → ゲート実行 → commit/push/PR。

## 5. Required Runtime Semantics
- 同じ入力と設定から決定的に同じSVGを生成し、1回の `renderSystem()` につき装飾グループは0または1個。再描画時の重複蓄積なし。
- 2段/3段、歌詞増減、音符の上下への突出、注釈レーン追加、`lift`、TAB位置変化、改段/改ページ時にも上段**最上線**から最下段**最下線**まで正しく接続し、歌詞・音符・コード名は囲わない。
- 小節境界は上下の全表示譜表で x 一致。特殊小節線の既存表示、プレイバックアンカー、source-preserving編集の操作領域を阻害しない。データなし／単一譜表は従来表示のまま。
- 描画は純関数。追加の状態、イベントlistener、タイマー、非同期処理、リソース所有、cleanup経路は発生させない。

## 6. Non-goals
- 小節カード化、背景の交互色、選択・再生ハイライト、モード切替の改造。
- コード図を独立した譜表として扱うこと、歌詞の譜表化、音部記号の変更。
- 新規フォント依存、DSL syntax・Compiler・Playback変更、既存イベント／小節配置のリファクタリング。

## 7. Concrete Tests / Acceptance
- **T01** メロディ＋リズムの2段 → 1ブレース、左端線1本、各境界ギャップ線あり。x位置は両譜表既存小節線と一致。
- **T02** メロディ＋TAB・TAB＋明示リズム・メロディ＋TAB＋リズム → 各systemに1ブレース。上下端が表示譜表の最外線と一致。3段では2つの隙間だけを同一境界で接続。
- **T03** メロディのみ（`show_rhythm:false`）、リズムのみ、TABのみ（暗黙リズム非表示）、リードシート単一譜表 → ブレース／新規接続線0。コード名・歌詞の存在は譜表数に無関係。
- **T04** 複数小節・折返し・改ページ・複数歌詞段・調号や拍子変更・TABの有無混在 → systemごとに独立した1個の適切なグループ、譜表外へのはみ出し・クリップ・既存要素との重なりなし。
- **T05** repeatStart/repeatEnd、double/final bar、volta、タイ、TAB技法 → 記号の維持とギャップ線位置一致。特殊記号の複製・消失なし。
- **T06** 同じスコアの連続Preview・ページPreview・PDFで同じ形状。ライト／ダークでも可読、拡縮しても線とブレースの対応が崩れない。
- **T07** 編集モードの小節／音符／コードのクリック操作およびplayback-measure-anchorの位置・数が不変。比較対象の既存SVGを使って、単なる「panicしない」ではなく差分検査。
- **T08** ユーザー提示のピアノ大譜表型ブレースとの目視比較を含む、通常倍率と拡大倍率の実レンダリング画像をIssueに添付。一般的な音楽ブレースに見えることを視覚検収（単なる `{` では不可）。

## 8. Verification
- `npm run compile`
- `npm run test:unit`
- `npm run check:help`
- `npm run check:ai`
- `npm test`（VS Code E2E実行可能環境／`docs/agents/testing.md` の手順）
- `npm run vscode:prepublish`
- `npx @vscode/vsce ls`
- `git diff --check`
- `.agent/project.json` のverify hooks、required CI `agent-required-check`。実行できないOS／E2Eは未検証と明示し、PASSを推定しない。

## 9. Reviewer Checklist（実装前に固定）
- [ ] C01 譜表数の判定・単一譜表抑止が正確
- [ ] C02 ブレースが音楽用のfilled pathで、形状・サイズ・クリアランスが自然
- [ ] C03 左端線と全小節の譜表間連結が既存小節境界に一致
- [ ] C04 2/3譜表・歌詞・TAB・lead sheet・リズム設定・改段・改ページに対応
- [ ] C05 repeat/double/final/volta/タイ/TAB技法を破損しない
- [ ] C06 Preview連続/ページ/PDFで同一のvector描画
- [ ] C07 スケール、注釈、lift、印刷余白、既存レイアウト不変
- [ ] C08 playback/編集hit-area/アンカーと操作が不変
- [ ] C09 spec/design/status/help/AI・単体/E2E・視覚証拠・全ゲートを確認
- [ ] C10 コミット、push、`Closes #<本Issue番号>`を含むPR、review phase遷移とPR URL報告

## Document impact
- Specification: [GuitarDSL syntax](../../../guitardsl-syntax.md), [Extension behavior](../../../extension.md)
- Design: [Preview rendering and export](../../../../design/preview-rendering-and-export.md)
- Status: [Implementation status](../../../../status/implementation-status.md)

## 10. Completion Report
変更ファイル、C01–C10の自己レビュー、テストコマンドと結果、画像証拠、未検証OS、契約逸脱・衝突・残作業、commit SHA、**PR URL**を記録する。PR未作成またはreview移行不可なら**BLOCKED**であり実装完了としない。

> This document is an Implementation Contract. Do not redesign the architecture during implementation. If a requirement conflicts with repository reality or requires a material design change, do not silently choose an alternative. Report the exact conflict and continue only with independent valid work.
