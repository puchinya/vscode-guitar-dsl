<!-- agent-doc-type: implementation-contract -->
<!-- GitHub Issue #172 is the authoritative contract; keep this archived copy aligned with it. -->

# Implementation Contract — Web Compact IDE UI + CodeMirror + context menus

> This document is an Implementation Contract. Do not redesign the architecture during implementation. If a requirement conflicts with repository reality or requires a material design change, do not silently choose an alternative. Report the exact conflict and continue only with independent valid work.

## Visual Assets — SVG UI Contract (required)

**These four self-contained SVG files are part of this contract.** Review them before coding. They are stored in the design-assets branch `feature/172-compact-ui-svg`; the implementing PR **must include all four source SVGs** under `docs/specs/gui_design/proposals/issue-172/` so their canonical paths exist in `main` after merge. Do not make production UI depend on URLs from this temporary branch. These are vector diagrams and icon path references, not a raster screenshot or a new icon library.

1. **[Desktop 1600×900 complete screen](https://github.com/puchinya/vscode-guitar-dsl/blob/feature/172-compact-ui-svg/docs/specs/gui_design/proposals/issue-172/web-compact-workspace.svg)** — JetBrains-like compact header, top-right **Account / Help / Settings**, Local + Drive Project tree, CodeMirror gutter, three icon-only Source / Split / Score modes, Score Preview, Inspector, bottom Problems. All four splitter boundaries are marked.
2. **[Grid geometry & keyboard resizing](https://github.com/puchinya/vscode-guitar-dsl/blob/feature/172-compact-ui-svg/docs/specs/gui_design/proposals/issue-172/web-compact-layout-geometry.svg)** — exact default widths/heights, splitter positions, source/score ratio, min/max and input behavior. Numeric values in §3 take precedence over illustrative text.
3. **[Toolbar & tool-window icon sheet](https://github.com/puchinya/vscode-guitar-dsl/blob/feature/172-compact-ui-svg/docs/specs/gui_design/proposals/issue-172/web-compact-icons.svg)** — 30 named icons with 24×24 vector geometry and selected/hover colors. Use inline SVGs with these shapes or the same existing-licensed vector paths; no emoji, font-dependent icons or raster fallback. Icon-only actions require Japanese/English `aria-label` and `title`.
4. **[Context menus & header controls](https://github.com/puchinya/vscode-guitar-dsl/blob/feature/172-compact-ui-svg/docs/specs/gui_design/proposals/issue-172/web-compact-context-menus.svg)** — Explorer, tabs, Problems, Preview menus; native CodeMirror editing menu boundary; right-top Account, Help, Settings.

**Inline previews:**

![Desktop Compact IDE layout](https://raw.githubusercontent.com/puchinya/vscode-guitar-dsl/feature/172-compact-ui-svg/docs/specs/gui_design/proposals/issue-172/web-compact-workspace.svg)

<details><summary>Splitter geometry SVG</summary>

![GridSplitter geometry](https://raw.githubusercontent.com/puchinya/vscode-guitar-dsl/feature/172-compact-ui-svg/docs/specs/gui_design/proposals/issue-172/web-compact-layout-geometry.svg)

</details>

<details><summary>Icons SVG</summary>

![Compact toolbar icons](https://raw.githubusercontent.com/puchinya/vscode-guitar-dsl/feature/172-compact-ui-svg/docs/specs/gui_design/proposals/issue-172/web-compact-icons.svg)

</details>

<details><summary>Context menus SVG</summary>

![Context menus](https://raw.githubusercontent.com/puchinya/vscode-guitar-dsl/feature/172-compact-ui-svg/docs/specs/gui_design/proposals/issue-172/web-compact-context-menus.svg)

</details>

**Visual acceptance:** Render the SVGs in a browser; compare the implemented 1600×900 Japanese Dark workspace and 1280×800 variant for panel geometry, icons, controls, padding and hierarchy. Use actual rendered screenshots for acceptance. The music and diagnostic data inside the concept SVG are sample content, not compiler/parser outputs. Where a figure and explicit numeric requirement conflict, use the numeric requirement and report material contradictions instead of silently changing them.

## 1. Repository Baseline
- Repository: puchinya/vscode-guitar-dsl; 基準 main HEAD fb8c4bdc4981d26e7612b0d66fe70c865d13c15e（2026-11-14）。開始時に最新 main を再取得。Web SPA は #166 / PR #167・#171 で導入済み。#168（Drive session concurrency）は独立Issueであり認証処理は再設計しない。
- 仕様: docs/specs/web-app.md §§2–5,7–9; docs/specs/gui_design.md。設計: docs/design/web-app.md の Web composition / document ownership。進捗: docs/status/implementation-status.md。工程: AGENTS.md、.agent/project.json、docs/agents/testing.md。
- 現在: web/src/main.ts がトップバー、ファイル一覧、中央タブ、ソース/Preview、Inspector、診断、Drive操作を一体構成。web/src/style.css は左右228/270pxの固定3列、ソース/譜面の1 splitterのみ。web/src/editor/sourceEditor.ts は textarea+HTMLハイライトで行番号・本格編集機能なし。renderDiagnostics はソース下の一覧。web/src/tabs/documentTabs.ts と web/src/explorer/explorerController.ts がタブ・Explorerを所有。
- web/src/adapters/previewBridge.ts は sandbox iframeメッセージを sourceWindow/channel で検証。packages/{core,ui,document,pdf} がコンパイラ・Preview・編集planner・文書・PDFを共有。web/src/storage/indexedDb.ts は設定・復旧ドラフトを保存。既存E2E: web/test/e2e/workspace.spec.ts、unit: web/test/unit/。
- **仕様更新を要する既存設計との衝突**: docs/design/web-app.md の「CodeMirror不採用」「textareaを編集基盤」と、docs/specs/web-app.md §2 の native textarea 編集前提は本Issueに限り変更する。規範spec→design更新を先に行い、Codemirror 6をWeb専用に認める。VS Code側のTextEditorは変更しない。

## 2. Architecture Decisions（固定）
- **JetBrains New UI / Compact風のWebデスクトップワークスペース**。React/Vue等への移行なし。CSS Gridの入れ子とWeb専用 splitter/controller を使用。視覚密度を高め、無用な見出し行を廃止。Preview内部の再生48px行・設定行・通常/編集/練習の既存動作は保持。
- メイン表示モード（ソース / 分割 / 譜面）は**ワークスペース全体で1つ**。既存Previewの通常/編集/練習モードと直交。モード切替は編集中ソース、Undo、Previewのスクロール/演奏を初期化しない。
- **CodeMirror 6（MIT）** をWeb専用エディタに採用。使用する拡張は @codemirror/{state,view,commands,language,search,autocomplete,lint}。Monaco、独自contenteditableエディタ、第二のGuitarDSL parserは不採用。コード編集の唯一の保存正本は既存 OpenTab.source + revision；EditorStateはタブ別のUI/Undo状態。表示用テキストをLFに正規化しても元のraw sourceのCRLF/CRを保持し、既存 preserveLineEndings の規則を利用。IME確定前に保存/補完/置換を強制しない。
- CodeMirrorへの人手入力・検索置換・補完・外部Preview/Inspector planner反映は1操作1トランザクション/Undo単位。入力時だけ現行 onEditorInput 相当のrevision増加/IndexedDB draft/派生再計算を行う。レイアウト再描画でEditorStateを作り直さない。タブ切替はタブ別EditorState（選択、Undo/Redo）とscrollを保持して入替え。リロード後のUndo履歴永続化は対象外。
- 共有 compiler diagnostics だけがProblemsとCodeMirror lintの正本。独自文法判定を追加しない。表示用ハイライトは既存 tokenizer を位置範囲を返す純粋関数へ転用しCM Decoration/Highlightへ接続する（HTML挿入禁止）。補完は現行DSLの構文定義/変数・文脈からの決定的候補のみ、外部AI/ネットワークなし。
- 右クリックメニューはWebホストが所有する。**CodeMirror本文の右クリックはブラウザのネイティブ編集メニューを保持**（Cut/Copy/Paste/IME/選択を壊さない）。Explorer、タブ、Problems、譜面には専用メニュー。メニューのアクションはその時点のdocument identity/revision/Drive accountを再検証し、既存hostコマンドを呼ぶ。Preview iframeからのリクエストは既存message boundaryで検証。互換性に関係する構造的変更は #168 と競合させない。

## 3. Exact Change Set / Pixel layout
- 1600×900 CSS pxの主画面、初期Light/Dark両対応。横方向は **左Activity Bar 40px | Explorer 220px | splitter 6px | 中央minmax(0,1fr) | splitter 6px | Inspector 300px | 右Tool Window Bar 36px**。デフォルトでExplorer/Inspectorとも表示。Explorer可変180–420px、Inspector可変260–480px。中央分割は**ソース40% / 譜面60%**、各下限ソース240px・譜面320px。ウィンドウ縮小時はoverflowさせず、足りないときInspector→Explorerの順に自動折りたたみ。手動開閉状態は上書きしない。
- 縦方向: **ヘッダー40px | 主領域（上側コンテンツ、下側Problems）| ステータス24px**。ヘッダー右の順序は「保存」「PDF出力」「Googleアカウント」「ヘルプ(?)」「設定(歯車)」。Google接続操作はExplorerのDrive節とアカウントメニュー両方から実施、未接続・接続中・期限切れを区別。UTF-8は固定のためエンコード表示/選択UIを置かない。
- Explorer見出し32px、Local / Google Driveの折りたたみツリー、ファイル名の選択・開く・新規作成・Import・Picker/Folder操作。アカウント/接続解除で開いたタブ・ドラフトを消さず、drive.fileとGoogle APIの既存制約を厳守。右側Tool Window BarからInspectorを開閉できる（アイコンとラベル/tooltip）。
- 中央のファイルタブ行36px、右端の**コード（code-2）/分割（columns-2）/譜面（eye）**の3アイコン。排他的、分割がデフォルト、aria-pressed/title付き、アクティブ表示。ソース専用/譜面専用では相手ペインと内部splitterを隠す。ソース・Previewの冗長なペイン見出しは削除。モード切替とsplitterドラッグ中はPreview iframeを不必要に作り直さず、ResizeObserver等で再レイアウト。
- Problemsは独立した**下部ツールウィンドウ**。左右Activity/Tool Window Barを除くExplorer+中央+Inspectorの下に横断配置し、上側との水平splitter6pxで高さ変更。初期高さ200px、可変140px–viewportの45%、折りたたみ可能。Problemsヘッダー32px、severity count（error/warning）、閉じる、内容は種類/ファイル/行:列/メッセージ。初期表示は開、編集で問題が増減しても勝手に開閉しない。問題クリックでソースを表示し該当範囲へフォーカス。0件なら「問題はありません」。旧ソース直下の診断欄は削除。下端Statusは問題件数、現在行:列、保存状態だけ（UTF-8表示なし）。架空のOutput/Logタブは作らない。
- splitterはExplorer境界、ソース/譜面、Inspector境界、Problems上辺の**全4本**。pointer capture、drag、pointercancel、ダブルクリックで該当幅のみ初期値へ、Tab+矢印で10px移動、Shift+矢印で50px移動、Home/Endで限界値。role=separator、aria-orientation、aria-valuemin/max/now、可視focus ring。6pxのヒット領域、1pxの境界線。各min/max clamp、負寸法/横スクロール禁止。
- 設定歯車は右上に**必須**。メニュー項目: テーマ（system/light/dark）、言語（ja/en）、レイアウトを初期化（確認付き）。ヘルプ(?)は右上に**必須**、日英対応のWeb用Helpダイアログを開く（目次: 基本操作/編集/Preview/Drive/ショートカット）。Escape/閉じるで元ボタンへfocus復帰。ブラウザ外部サイトへ依存しない。ヘッダーのGoogleアイコンは接続/切断/再接続・アカウント表示のみで、設定と分離。
- layout state: indexedDb settings の新規 key「web-layout-v1」に表示モード、Explorer/Inspector/Problems開閉、幅/高さ、中央split比率をdebounce250msで保存。既存「web-preferences」のsplitRatioは初回のみ移行。破損値は各デフォルトへ安全にfallback。サイズ不足による一時自動折りたたみは保存しない。

## 4. Code Editor + Context Menus
- web/src/editor/sourceEditor.ts をCodeMirrorホストラッパーへ置換し、web/src/main.tsの直接textarea参照（selectionStart/setSelectionRange/value/execCommand）を**getSource, setDocument, applyTransaction, selection, focus, revealRange**等の明示APIへ置換。内部にtab別EditorState/scrollを保持する。エディタは行番号、現在行ハイライト、matching brackets、インデント/Tab、行折返し、検索（Ctrl/Cmd+F）、置換（Ctrl/Cmd+H）、Go to line（Ctrl/Cmd+G）、Undo/Redo、IME、範囲選択、GuitarDSLハイライトを備える。
- 補完: 少なくとも既存のtitle/artist/tempo/keyフィールド、mel:/lyr:/tab:行接頭辞、source内の変数参照、構文上安全なコード候補を文脈別に提供。挿入時は1 undo step。LintはParsedScore.diagnosticsのline/startCol/endCol/severityを正確にCM座標へ変換し、下部Problemsと同じ件数・順序とする。
- **Context menu**: Explorerファイル右クリックは「開く」「名前をコピー」「ソースを書き出す（ローカルのみ）」「削除（ローカルのみ、確認）」、Drive節は「接続/再接続」「フォルダー選択/作成」「Driveから開く」（可能な項目だけ）。タブ右クリックは「このタブを開く」「閉じる」「ほかを閉じる」「ソースを書き出す」。Problems項目右クリックは「ソース位置へ移動」「メッセージをコピー」。Preview上の譜面右クリックは「ソース位置へ移動」（有効なvisualSourceBindingのみ）と「PDF出力」、編集モードの操作意味は既存クリック/編集を維持。Editor本文はnative context menu、行番号gutter上だけWebメニュー「この行に移動」を表示。
- 専用メニューはクリック位置に開きviewport内に収める。右クリック/Shift+F10/ContextMenuキーで表示、↑↓/Home/Endで移動、Enter/Spaceで実行、Esc/外クリックで閉じ元要素へfocus復帰。role=menu/menuitemとdisabled状態、日英ラベル。メニュー表示後にタブ/アカウント/revisionが変われば破棄か無操作にする。Drive削除/名称変更など既存仕様外の破壊操作を追加しない。メッセージコピーはclipboard API失敗時に失敗を通知（成功を偽装しない）。

## 5. Implementation Sequence
1. specs→designでCodeMirror採用とレイアウト/メニュー/Help/Problemsを規範化し、事前Reviewer checklistを公開。
2. CodeMirror adapter/タブごとのUndo・CRLF保持・既存Preview/Inspector source editの単一transaction化を先に実装、unit/E2E。
3. CSS Grid shell、4 splitter、表示モード、保存/復元、Compact topbar、Explorer/Inspectorツールウィンドウ。
4. Problems↔lint共有診断、移動処理、Help/Settings/Googleメニュー、専用context menusを導入。
5. 日英Light/Dark、1600×900/1280×800、Keyboard、Drive mock、Web/VS Code regression、実画像証拠を確認して文書/Help/status更新。
6. commit、push、PR作成（Closes #本Issue番号）、レビュー状態に遷移しCompletion Reportを提出。

## 6. Runtime / Non-goals
- 無ファイル・Drive未接続・読み込み失敗・保存失敗・token期限切れでも適切な空状態。レイアウト操作はsource revision、draft、保存状態、Drive fileId、audio leaseを変更しない。
- Preview/Inspectorからの遅延編集は従来どおりdocumentId/revision/generationを再検証。tab close時にCM view/observer/menu/listenerを破棄、非アクティブtabのUndo stateは維持。切替中のdrag/context menuは必ず解放・閉鎖。
- UI再設計はWebだけ。VS Code拡張、共有compiler、DSL構文、PDF/Preview譜面描画、Google認証/保存競合契約（#168含む）、モバイルの新規設計、AI/WebMCP追加は**対象外**。React、Monaco、新しいDSL parser、Drive scope拡大は禁止。
- 関連コード: web/src/{main.ts,style.css,editor/,explorer/,tabs/,adapters/,storage/indexedDb.ts} と web/test/{unit,e2e}/。必要な新モジュール例: web/src/layout/{layoutState,splitters}.ts、web/src/menus/contextMenu.ts、web/src/help/helpView.ts。仕様/設計/Help/Status同期必須。CodeMirror MIT通知は THIRD_PARTY_NOTICES.md に反映。

## 7. Concrete Tests
- 1600×900、1280×800で4splitterをドラッグ→各paneのDOMRectが変化しmin/maxを守る。キーボード/取消/ダブルクリック/非表示時/ウィンドウ縮小でNaN・負幅・横overflowなし。refresh後に比率/開閉が復元、手動設定は一時的auto-collapseで上書きされない。
- 3表示モードで正しい1/2ペインとaria-pressed。ソース入力→譜面のみ→分割に戻ってテキスト/選択/Undo/scrollが維持。Previewの通常/編集/練習は別状態、再生位置を破壊しない。
- CodeMirrorの複数タブ独立Undo/Redo、IME日本語確定、CRLF混在テキスト、検索/置換/補完各1 Undo、Inspector/Preview plannerの1 Undo、stale編集ゼロ、draft保存/refresh復元。診断を1件発生→lintとProblems一致→クリックで正しい行列へ移動、0件も確認。
- 各context menuをマウスとShift+F10で開き全項目/disabled/キーボード/escape/viewport clamp確認。CodeMirror本文の標準Cut/Copy/Paste右クリックを妨害しない。メニュー中のtab切替・Drive切断で旧対象操作不能。Previewの無効/古いbindingからソース編集が発生しない。
- 設定/ヘルプ/Googleの各右上アイコンを日英/Light/Darkで確認。Helpはローカル表示、Escでfocus復帰、UTF-8 UI無し。Drive mockの接続、再接続、Picker、フォルダー、draft保持、既存 #168 と保存失敗の回帰。
- 実描画証拠: 1600×900で日本語/英語×Light/Darkの4枚、1280×800の1枚、メニュー展開・Problems・ソース/譜面単独の状態を撮影し、owning Issueに添付。スクリーンショットと実DOMRect/ARIAを突き合わせる（参考ワイヤーフレームだけでPASS不可）。

## 8. Verification
- npm run compile
- npm run build:web
- npm run test:unit --workspace web
- npm run test:e2e --workspace web -- --project=chromium
- npm run test:e2e --workspace web -- --project=webkit
- npm run test:safari --workspace web（macOSのみ）
- npm run test:unit
- npm test（VS Code/Electron含むためsandbox外）
- npm run vscode:prepublish
- npx @vscode/vsce ls
- npm run check:help
- npm run check:ai
- python -m agent_workflow validate-docs --issue 本Issue番号
- git diff --check
未実施環境はNOT RUNと書く。docs/agents/testing.mdと.agent/project.jsonのrequired checksを厳守。

## 9. Reviewer Checklist（実装前に公開）
- [ ] 採用ライブラリ衝突をspec/designに反映し、WebだけのCodeMirror導入。
- [ ] 行番号・検索/置換・補完・lint・IME・CRLF・tab別Undoを検証。
- [ ] 編集正本、revision、stale guard、1編集1Undo、ドラフト/Drive保存の不変条件を維持。
- [ ] Compact寸法、4splitter、表示3モード、レイアウト復元、狭幅fallbackが実測一致。
- [ ] Problemsとlintは同一診断、クリック移動、error/warning件数一致。
- [ ] 各context menuの対象保護・操作・keyboard/ARIAとnative編集メニューを検証。
- [ ] 右上Google/Help/Settings、日英/テーマ、UTF-8非表示が正しい。
- [ ] Preview3モード/共有UI/音声排他、Google Drive/#168、VS Code/VSIXに回帰なし。
- [ ] docs/specs→design→code→status、Help/第三者通知、実画像、全CI required checkが整合。
- [ ] commit/push/Closes Issue付きPRを作り、review遷移を確認。

## 10. Completion Report（必須）
変更ファイル、上記チェックリスト結果、テストコマンドごとのPASS/FAIL/NOT RUN、スクリーンショット、未検証OS/browser、契約逸脱/競合、残作業、commit SHA、branch、**PR URL**、Closes #Issue番号、review状態を記載。commit/pushだけでは完了ではない。PRが作れなければ正確なエラーを記録して**BLOCKED**とする。

### Visual layout（1600×900の情報配置）
~~~
HEADER(40): [GuitarDSL]                 [Save][PDF][Google Account][Help][Settings]
MAIN: [Activity40][Explorer220]|6|[Tabs36: source / split / score] |6|[Inspector300][Tools36]
                            [CodeMirror 40% |6| Score Preview 60%]
BOTTOM:   [Problems 200px: Severity | File | Line:Col | Message]  (top splitter 6px)
STATUS(24): [Problem counts] [Ln:Col] [Save state]             (no UTF-8)
~~~

CodeMirror公式: https://codemirror.net/docs/ref/ ; https://codemirror.net/docs/extensions/ ; https://codemirror.net/ 。