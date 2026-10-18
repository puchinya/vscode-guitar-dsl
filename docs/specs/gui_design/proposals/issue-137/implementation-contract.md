# Implementation Contract — Issue #137: Sidebar・採譜・入出力導線の整理

Parent: #132 / Source of current screen specification: docs/specs/gui_design.md (Issue #150, PR #151).

**契約状態:** 本Issueの実装指示。元のrequirements-stage要約を置き換える。コード実装、現行仕様書の差替え、動作検証は本Issue更新時点では未実施。実装は最新mainから開始し、設計SVGは実装PRの差分に取り込む。

> This document is an Implementation Contract. Do not redesign the architecture during implementation. If a requirement conflicts with repository reality or requires a material design change, do not silently choose an alternative. Report the exact conflict and continue only with independent valid work.

## Design SVG attachments (proposal, not current main)

| 画面 | SVG | 正式反映時の寸法 |
|---|---|---|
| サイドバー開始時 | [sidebar-start-here.svg](https://github.com/puchinya/vscode-guitar-dsl/blob/feature/issue-137-gui-design-assets/docs/specs/gui_design/proposals/issue-137/sidebar-start-here.svg) | 300×390 |
| サイドバーGuitarDSL選択時 | [sidebar-current-file.svg](https://github.com/puchinya/vscode-guitar-dsl/blob/feature/issue-137-gui-design-assets/docs/specs/gui_design/proposals/issue-137/sidebar-current-file.svg) | 300×382 |
| YouTube採譜・初期閉状態 | [youtube-transcription.svg](https://github.com/puchinya/vscode-guitar-dsl/blob/feature/issue-137-gui-design-assets/docs/specs/gui_design/proposals/issue-137/youtube-transcription.svg) | 548×528 |
| YouTube採譜・詳細全展開 | [youtube-transcription-advanced.svg](https://github.com/puchinya/vscode-guitar-dsl/blob/feature/issue-137-gui-design-assets/docs/specs/gui_design/proposals/issue-137/youtube-transcription-advanced.svg) | 548×1000 |

![開始時のサイドバー](https://raw.githubusercontent.com/puchinya/vscode-guitar-dsl/feature/issue-137-gui-design-assets/docs/specs/gui_design/proposals/issue-137/sidebar-start-here.svg)
![編集中のサイドバー](https://raw.githubusercontent.com/puchinya/vscode-guitar-dsl/feature/issue-137-gui-design-assets/docs/specs/gui_design/proposals/issue-137/sidebar-current-file.svg)

![採譜初期状態](https://raw.githubusercontent.com/puchinya/vscode-guitar-dsl/feature/issue-137-gui-design-assets/docs/specs/gui_design/proposals/issue-137/youtube-transcription.svg)
![採譜詳細展開](https://raw.githubusercontent.com/puchinya/vscode-guitar-dsl/feature/issue-137-gui-design-assets/docs/specs/gui_design/proposals/issue-137/youtube-transcription-advanced.svg)

以上はIssue専用ブランチのSVG原案。**現行の docs/specs/gui_design.md と既存SVGはimplementation PRまで変更しない。** 原案のSVGは構造・表示順を固定する参照であり、VS Code標準部品の実描画との差は受け入れE2Eで検査する。

## 1. Repository Baseline

- docs/specs/gui_design.md §画面一覧・§1・§5: 現行の12図を所有する規範的GUI画面仕様。旧SidebarはGet Started/Current File/Toolsの3区分。YouTubeの設定は常時表示。docs/specs/README.mdから参照される。
- docs/specs/extension.md §4C: 旧Sidebarのコマンド導線、§4D: 単一Inspectorの所有権、§3.4: YouTube/WAV採譜。ユーザー向け処理意味論の正本。
- src/sidebar.ts::GuitarDslSidebarProvider: 既存guitardsl.sidebarはActivity Bar配下の単一TreeDataProvider。Treeは編集しない。tests/unit/sidebar.test.tsが旧3区分を検査。
- src/onboarding.ts::newDocumentFromTemplate/openSample: テンプレート3種・同梱サンプル5種から編集可能な新しいuntitled GuitarDSLを作る。取消は無変更。
- src/extension.ts::activate: singleton Preview、Inspector起動、各既存コマンド、sidebar refresh。src/inspector/・src/render/previewHtml.tsが既存Inspector/再生/Practiceと一時設定の所有権を保持する。
- src/gp78Commands.ts::registerGp78Commands: Guitar Pro 7/8の取り込みとGP7エクスポート。既存トラック選択、faithful/optimize、loss gate、非上書き、source version検証を変更しない。
- src/transcription/transcribePanel.ts::TranscribePanel: 単一のYouTube WebviewPanel。SecretStorageとsaveApiKey/clearApiKey/startTranscription、既存段階進捗。YouTubeの実行中cancel APIは現状ない。
- src/audioMir/controller.ts::createAudioMirController: デスクトップのローカル非圧縮PCM WAV、Worker/WASM、キャンセル可能なVS Code通知。YouTubeとは別系統。
- 現行GUIは#133/PR #138、#134/PR #139、#135/PR #140、#136/PR #141、#145/PR #149、#150/PR #151が基盤。docs/status/implementation-status.mdの古い記録は最新実装と照合して修正する。
- テスト/ゲート: tests/e2e/extension.test.ts、docs/agents/testing.md、.agent/project.json、AGENTS.md。

## 2. Architecture Decisions

**既存の固定要件:** TextEditorがDSL入力・Undo、Previewが通常再生/Practiceと一時カポ/初心者設定、共通Inspectorが候補比較/詳細設定/明示Applyの所有者。追加のActivity Barアイコン、Inspector View、Preview Webview、AudioContext、別のDSL編集権限は作らない。従来公開コマンドID、コマンドパレット、Explorer context menu、CodeLens経路を保持する。

**本Issue固有の確定事項:**
1. Native Tree Viewのままルート先頭に非操作の対象行を置き、セクションを「新規作成」「開く・取り込む」「編集支援」「書き出す」「ヘルプ」の順で5件とする。表示対象はアクティブGuitarDSL文書のbasenameのみ、untitledはローカライズされた名称、非GuitarDSLでは「対象なし」。別タブ/過去のlastActiveへはフォールバックしない。
2. 初回展開は最初の2区分のみ。編集支援・書き出す・ヘルプは初期折りたたみ。ユーザーが変更した展開を文書切替で強制復元しない。ファイル選択時SVGの開いた状態は手動展開の代表図である。
3. 「新規作成」は既存のtemplate/sampleを各1操作。「開く・取り込む」はGuitarDSLファイルOpen、既存GP Import、音源から採譜。「編集支援」はPreviewとInspectorだけ。「書き出す」はPDFとGP7。「ヘルプ」はHelpだけ。
4. 旧Sidebarのコード図・楽譜設定・カポ・伴奏のリンクは重複ナビなので撤去。ただし同名コマンドおよびEditor/Preview/CodeLens/Inspectorからの機能は全て維持する。
5. SidebarからPreview/PDF/GP7出力を始める場合、クリック実行時のactive TextEditorがGuitarDSLでなければ停止。従来のdocumentResolverが提供するlastActive fallbackは**新しいSidebar経由の操作には適用しない**。
6. 音源選択は1回のVS CodeネイティブQuick Pickで「YouTube動画」「ローカルWAV」を選び、従来の別々のcommand/engineへ委譲。取消は完全no-op。新たな統合解析処理は作らない。
7. YouTubeパネルはURL・キーの保存状態と管理操作・採譜開始を基本表示、BPM/Capo/beat/伴奏/反復圧縮/AIモデルを初期折りたたみの詳細内に移す。キー管理自身も開閉でき、パスワード欄を無用に常時表示しない。
8. YouTubeにキャンセルボタンを足さない（処理中断実装は別Issue）。WAVのexisting cancel/progressはそのまま。Guitar Proのformat fidelity/loss gateも維持する。

**棄却する代替:** SidebarをWebviewダッシュボードに置換、独自Open/GP/採譜ダイアログ、Inspector/Preview追加、入力元パイプライン統合、コード解析/Undo/再生境界変更、GUI SVGの先行main置換。

## 3. Exact Change Set

### Sidebar / navigation

- src/sidebar.ts: SidebarSectionIdをcreate/openImport/editAssist/export/helpに再定義。GuitarDslSidebarItemに非操作targetを追加。安定したsection/item IDとThemeIconを用いる。targetはTreeItem commandなし・折りたたみなし。ルートtarget＋5区分を固定し、初期展開を上記にする。文字列はsrc/i18n.ts。
- **新規 src/sidebarNavigation.ts**: registerGuitarDslSidebarNavigation(context, msgs): vscode.Disposable が次の内部コマンドを一度だけ登録。package.jsonのcontributes.commandsや既存メニューには登録しない。
  - guitardsl.navigation.openGuitarDslFile: showOpenDialog(.guitardsl/.gdsl)→選択拡張子再検査→openTextDocument(uri)→showTextDocument。取消/不正/失敗時に新規Untitledは作らず、エラーをローカライズ表示。
  - guitardsl.navigation.chooseTranscriptionSource: 2候補のshowQuickPick→選択に応じguitardsl.transcribeYouTubeかguitardsl.transcribeAudioを一度だけexecuteCommand。Escはどちらも呼ばない。
  - guitardsl.navigation.showPreviewActive / exportPdfActive / exportGuitarProActive: 呼出時のwindow.activeTextEditor?.documentをisGuitarDslDocumentで確認し、そのURIを明示して既存のguitardsl.showPreview / guitardsl.exportPdf / guitardsl.exportGuitarProへ転送。対象がなければ警告だけで終了。TreeItemが保持した古いURIを使わない。
- 編集支援のInspectorは既存guitardsl.openInspectorを呼び、対象なし時の既存empty view動作は維持。新規作成/サンプル/GP Import/Helpは既存IDを直接利用。
- src/extension.ts::activate: navigation登録とdispose、sidebar refreshのみ追加。src/i18n.ts (必要な場合はpackage.nls*.json)のJA/EN語句を同期。package.jsonの既存View/Activity Bar/公開command/menu登録は維持する。

### YouTube Panel

- src/transcription/transcribePanel.ts::TranscribePanelのWebview HTML/CSS/イベントを変更する。Panel singleton、SecretStorage、runTranscription、runTranscriptionPipeline、Music IR、DSL serializer、既存メッセージの名前/option shapeを変更しない。
- 表示順はタイトル→実験的警告→URL→キー状態と管理の開閉→詳細設定の開閉→Start→段階進捗/エラー。キー管理を開いた場合のみpassword入力/保存/削除を表示し、保存後は入力を空に戻す。キーをstatus/ログ/表示HTMLに含めない。
- 詳細はBPM(auto/manual 30–300)、capo(auto/manual 0–12)、beat(auto/8/16)、accompaniment family/preset、compressRepeats、modelの順。既存default・選択肢・option値を保持。ネイティブdetails/summary等のアクセシブルな開閉を使用し、閉じた領域はTab不達。
- StartはURL非空かつ保存キーまたは入力キーありの場合だけUI上可能にする。URLの真偽/範囲は既存Host側が最終判定。開始時に二重クリックを抑止し、エラー発生時は再操作可能に戻す。YouTube実行の実キャンセルは追加しない。

### GUI spec / docs

- **docs/specs/gui_design.md**の画面一覧、§1.1/1.2、§5を改訂。Issue #150所有を維持し、#137改訂と明記。現在12図のうち3図を差し替え、展開状態1図を追加して**合計13図**。SVGサイズは上表に固定し、独立のベクター図としてスクロール末尾まで示す。
- docs/specs/gui_design/sidebar-start-here.svg、sidebar-current-file.svg、youtube-transcription.svgを差し替え、youtube-transcription-advanced.svgを追加。上記Issue専用SVGを実装時の原案とする。
- docs/specs/gui_design.mdのScopeに従い、ネイティブQuick Pick・ファイルDialogを独立画面図にしない。代わりに§1に項目→コマンド→対象の対応表を追加する。
- **変更しない9図:** Preview 3、Inspector 5、Chord Editor 1。既存SVGの改変は禁止。
- docs/specs/extension.md §4C・関連採譜記述、docs/design/vscode-editor-experience.md、docs/status/implementation-status.md、docs/help/{ja,en}/features.md、docs/help/help-manifest.json、生成Helpを同一PRで同期。docs/specs/README.mdのGUI仕様参照を維持。

## 4. Implementation Sequence

1. 着手時にlatest main、Issue #137、#132/#145/#150とspec→design→code→statusを再突合。コンフリクトは報告し勝手に再設計しない。
2. GUI spec §1/§5とextension spec §4Cの差分を確定してからコード編集。
3. sidebarNavigation.ts内部5コマンド＋実行時target guardの実装とunit。
4. src/sidebar.tsの5分類、target、ローカライズとunitを実装。1つのnative Treeを維持。
5. YouTube Panelの詳細/キー管理の開閉とStart制御のみ変更。メッセージ互換性のunit。
6. 規範的gui_design.mdとSVG4点を同期、spec/design/help/statusを更新。
7. E2E/キーボード/狭幅/英日・テーマ/スクリーンショット/旧機能回帰を検証し、自己レビュー→commit/push→PR→review遷移。

## 5. Required Runtime Semantics

- SidebarはDSL文書なしでも起動し、新規/サンプル/GP Import/採譜/Helpは有効。対象行は非操作。ユーザーのツリー展開状態を文書切替で強制変更しない。
- Aの古いTreeItemを表示したままactiveをB→plaintextへ切り替えてPreview/Exportをクリックしても、実行時のactiveのみを見る。B時はB、plaintext時は対象なしで**何も出力しない**。対象がないとき他タブを探索しない。
- File Picker cancel、Quick Pick cancel、Unsupported extension、読み込み失敗は新規エディタや解析ジョブなし。既存タブ/ソース/Undo不変。
- GP importではトラック選択/忠実・最適化/loss gate、exportでは版検査/非上書きとsource-version guardを維持。WAV cancelはWorkerを終了してuntitledを生成しない。
- YouTube Panelはsingletonを再利用。詳細/キー欄の展開では新規Panel/Jobを作らない。キー保存/削除後も値を描画・出力しない。エラー/段階進捗は従来のPanelに表示し、キャンセル不能な実処理をキャンセル可能と誤表示しない。
- Inspectorは明示時だけ開き、既存URI/version/session/lease/Apply境界を維持。Preview一時設定とPDF effective DSL、通常再生/Practice、Chord editorやCodeLensのソース編集は不変。
- dispose後にコマンド/リスナー/Workerを残さず、再Activation時に重複登録しない。

## 6. Non-goals / Forbidden Changes

- Audio MIR/WASM/Worker/Gemini/Music IR処理、parser/DSL grammar、Guitar Pro import/export fidelity/loss、Preview transport、Inspector audio lease、Undo/WorkspaceEdit、Chording/Strummingアルゴリズムを変更しない。
- YouTubeの実処理取消・GP形式追加・Audio MIR入力形式追加、Sidebar独自Webview化、Editor/Preview/Inspector新設、コマンドID削除は禁止。
- Preview 3図/Inspector 5図/コード図1図とそのUIは変更しない。

## 7. Concrete Tests

| ID | Setup → Action | Expected result |
|---|---|---|
| G137-01 | 未選択でSidebar起動 | targetなし＋5分類、初期展開順、ファイル不要の項目は有効 |
| G137-02 | A→B→plaintextで古いTreeItemからPreview/PDF/GPを実行 | B時はB URI、plaintext時はno-op＋警告。A/Bへfallback、誤出力、Undo変更なし |
| G137-03 | template3種/sample5種の選択/Esc | untitled新規作成。Escは無変更、元ファイル不変 |
| G137-04 | .guitardsl/.gdsl Open、cancel、不正拡張子 | 正しい標準TextEditor、cancel/拒否時の副作用なし |
| G137-05 | GP7/8 Import→GP7 Export、loss拒否/同名ファイル/stale version | 既存track/mode、loss warning、非上書き・stale拒否を確認 |
| G137-06 | 採譜source Quick PickでEsc、YouTube二度、WAV | Escで起動ゼロ、YouTube singleton、WAV既存dialog |
| G137-07 | WAV実行中Cancel、不正PCM、成功 | Worker terminate・無題文書なし、失敗理由不変、成功のみ新規untitled |
| G137-08 | YouTubeキー未設定→保存/削除→再表示、detail開閉 | Start資格、SecretStorage・非露出、閉じた項目Tab不可、focus保持 |
| G137-09 | 各採譜Optionを選択し開始、連打、エラー | 既存option payloadと同値、ジョブ1件、段階進捗/エラー再試行可能 |
| G137-10 | Preview/Inspector/Chord Editor/CodeLens/Practice/PDF経路 | singleton、明示表示、試聴排他、source/Undo/実効DSLの既存回帰なし |
| G137-11 | JA/EN×dark/light、300px Tree/548px Panelと狭幅、Tab/Shift+Tab/Enter/Space/Escape | 最下部まで読める・フォーカス可視・ARIA/キーボード到達・画面証拠 |
| G137-12 | SVG4件とgui_design.md・manifest/Help/VSIX | valid XML、外部画像埋込なし、寸法/リンク、計13図、公開ID維持 |

tests/unit/sidebar.test.ts更新、tests/unit/sidebarNavigation.test.ts新規、YouTube Panel HTML/操作のunitを追加。tests/e2e/extension.test.tsは既存showAndFocusとwithWorkbenchSnapshotRestoredを使用して実Workbench状態をfinallyで戻す。AX-treeと実際のVoiceOver/NVDAは別結果として報告。

## 8. Verification

- npm run compile
- npm run test:unit
- npm run check:help
- npm run check:ai
- （macOS/Linux host、サンドボックス外）env -u ELECTRON_RUN_AS_NODE -u NODE_OPTIONS npm run test:e2e
- （同上）env -u ELECTRON_RUN_AS_NODE -u NODE_OPTIONS npm test
- npm run vscode:prepublish
- npx @vscode/vsce ls
- python3 -m agent_workflow validate-docs --issue 137
- python3 -m agent_workflow verify-implementation-contract 137
- git diff --check
- .agent/project.jsonのverify_final相当とagent-required-checkがPASS
- SVG全4件のXML parse/リンク/表示/ベクターレンダリング、実VS Code UIキャプチャをIssueに掲載。未実行Windows/Linux/VoiceOver/NVDA/VS Code最小1.109はPASSと表記しない。

## 9. Reviewer Checklist — 公開基準

- [ ] R01: Treeは単一・target＋5区分・安定ID/展開/ロケールが一致。
- [ ] R02: Preview/PDF/GPはactive-only、古いTreeItem/非DSLで別文書fallbackなし。
- [ ] R03: template/sample/Open/Quick Pickの取消・失敗が副作用なし。
- [ ] R04: GP78 track/loss/export non-overwrite/staleを変更していない。
- [ ] R05: YouTube/WAV別処理、YouTube singleton、WAV cancelが維持。
- [ ] R06: 詳細設定/キー管理/Option/start二重実行/秘密保持、キーボードが仕様通り。
- [ ] R07: Preview/Inspector/CodeLens/Chord Editor/Practice/audio lease/Undoに退行なし、旧command IDは維持。
- [ ] R08: docs/specs/gui_design.md の3置換＋1追加＝13図、対象外9図変更なし。spec/design/help/status同期。
- [ ] R09: JA/EN×dark/light×狭幅とARIA/Keyboardの実画面証拠を添付。
- [ ] R10: 全gateの実結果・未実施プラットフォームを報告し、実装者自身がR01–R11を根拠付きレビュー。
- [ ] R11: commit/push/Closes #137付きPR作成、workflowのreview状態へ遷移、PR URL報告。

## 10. Completion Report / Delivery gate

実装者は変更ファイル、R01–R11の各結果、実行コマンド/テスト数/CI、SVGと実UI比較証拠、未検証環境、逸脱や新規要求、残課題と**Pull Request URL**を記載する。**コミット・pushだけでは未完了。** PR作成/レビュー遷移が権限等で失敗したら該当コマンド/エラーを示してBLOCKEDとする。

## Handoff quality check

既存アーキテクチャと本Issue固有の決定を分離し、View/Host/Editor/Parser/Audio/SecretStorageの所有権、内部API、対象解決・取消/失敗、ドキュメント差替え位置、回帰/納品を固定した。ソース全文/旧仕様全文/画像を契約本文へ複製せず具体的なパス・型・関数へ参照した。