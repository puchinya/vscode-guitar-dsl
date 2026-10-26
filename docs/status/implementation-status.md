# 実装進捗ステータス (Implementation Status)

本書は、Visual Studio Code 拡張機能 **GuitarDSL Previewer** (`vscode-guitar-dsl`) の現在の機能実装状況、検証状態、および今後の拡張予定を管理するドキュメントである。

- **現在のバージョン**: `0.1.0`
- **最終更新日**: 2026-10-26
- **全体ステータス**: Issue #129（PR #131）、#132（PR #157）、#133（PR #138）、#134（PR #139）、#135（PR #140）、#136（PR #141）、#137（PR #152）、#144（PR #146）、#145（PR #149）、#153（PR #154）、#155（PR #156）は `main` へマージ済みで、各Issueはclosed。PR #143 と Issue #142 もマージ済み。Issue #158 / PR #159 はレビュー待ち。

---

## Issue #158: Preview 双方向楽譜編集と変数 Inspector

- **状態**: PR #159の最新UX追補（コメント `6398576705`）に沿って、Previewを通常/編集/練習の排他3モードへ統合し、既存コマンド互換、Inspector変数タブ初期表示、ドラフト破棄確認を実装。最新レビュー `6404783623` の変数コンテキスト更新、全幅アイコン再生操作、Inspector実画面証拠と音声/lease受入れ指摘を反映し、最終ゲートを実行中。基準は main@ed2c037559cc8bbc1e4835ef2f9a61ba060a7ac4、ブランチは feature/158-preview-bidirectional-editing。PR #159 はレビュー待ちで、未マージ。
- **契約**: Issue本文の最新 approved contract comment `6398128339` を正本とし、ローカルコピーは **38,687 bytes / SHA-256 `f0396b27751bd79f8dfff646c415fe23846ee635f7fba55d4b77785f6579abcf`** と完全一致することを確認。PR追補 `6398576705` は独立Edit/Practice切替を排他3モードへ置き換える決定で、契約本文/SHAは変更せず、旧追補との優先関係を記録する。
- **Milestone**: profile version 0.1.0 を割当済み。
- **設計**: 承認済みの2枚の提案SVGを追加。Previewの通常/編集/練習モード、600px未満のネイティブselect、モード別の編集ドック/Practice Guide排他を反映した実画面 capture は `docs/status/evidence/issue-158/` に保存し、提案図とは区別する。
- **検証**: 最新コードで `npm run compile:all` PASS、`npm run test:unit` **1,219件 PASS**。音声/lease opt-in E2EのED-08、S135-11の3ケース、ED-09、ED-10は**6件 PASS**。実Inspector証拠E2Eは日本語Language Packを読み込んだjaとenで各**1件 PASS**し、設定サブタブへのキーボード操作、狭幅タブstripのARIA/overflow/focus、実localeラベルを検査した。`validate-docs --issue 158` と `verify-implementation-contract 158` もPASS（approved contract SHA-256は上記のとおり）。最終コミット上の `npm test`、prepublish/package listing、self-review、Required Check、delivery-checkはPR #159の最新Completion Reportに記録する。VoiceOver/NVDAとWindows/Linuxの手動確認は未実施。
- **受入状態**: BV-04、BV-09、BV-10 PASS。音声/leaseのopt-in 6ケースはPASS。VoiceOver/NVDAとWindows/LinuxはNOT RUN。C010/C012/C018/C019/C020のexact-HEAD判定は最終Completion Reportを正本とする。
- **実画面差分**: [提案SVGとの差分理由](https://github.com/puchinya/vscode-guitar-dsl/issues/158#issuecomment-6393926098)、[最新三モードUIの実画面証拠](https://github.com/puchinya/vscode-guitar-dsl/issues/158#issuecomment-6399665786)。Preview編集状態は英語/日本語 × light/dark × 421/600/840/1100px の16状態。InspectorはExtension Development Hostから英語/日本語 × light/dark × 狭幅で撮影し、`docs/status/evidence/issue-158/inspector-settings-*-narrow.png` に設定サブタブ、`inspector-variables-*-narrow.png` に変数欄を保存する。日本語はLanguage Packを有効にした実Workbenchで確認。
- **PR / Completion Report**: [PR #159](https://github.com/puchinya/vscode-guitar-dsl/pull/159) は open / non-draft。現HEADの自己レビュー、検証ゲート、未実施の手動/OS範囲は最新Completion ReportとRequired Checkを正本として追跡する。

## Issue #132: GUI再設計の統合受入れ

- **状態**: [PR #157](https://github.com/puchinya/vscode-guitar-dsl/pull/157) を作成済み。親Issueは下位Issueの実装を再開せず、統合受入れと文書整合を確認してレビュー待ち。[統合受入れ・未検証範囲](evidence/issue-132/acceptance.md)に既存のPR・E2E・画面証拠と今回の結果を集約する。
- **方針の優先順位**: #134の承認済み試聴lease設計が原案の「PreviewのみがWeb Audioを所有」を上書きし、#145がPreviewの一時楽譜設定を復元している。現在の責務は各下位Issueの節と受入れ記録に従う。

---

## Issue #133: Common GuitarDSL Inspector

- **状態**: Issue #133 と PR #138 はマージ済み。
- **実装**: Secondary Sidebar に単一の Webview View を登録。Extension Host がアクティブな GuitarDSL 文書の URI / version を所有し、空状態と文書状態を表示する。編集、再生、進行提案は既存の所有者に残す。
- **検証**: `npm run compile`、単体テスト **1122 / 1122**、VS Code 1.141.0 の E2E **79 / 79**、`check:help`、`check:ai`、`npm run vscode:prepublish`、`npx @vscode/vsce ls`（1,597 項目）が PASS。実 WebviewView E2E では非表示中に plaintext へ切替、GuitarDSL 文書Bの編集後に再表示し、各回の最初の DOM が最新状態を持つことと、イベント追加なしの再 hide/reveal、可視中の編集更新を確認した。Workbench UI E2E ではCDPマウスイベントでInspectorをSecondary SidebarからPrimary Sidebarへドラッグし、Primary Sidebarを隠してから `guitardsl.openInspector` で再表示後もInspectorがPrimary Sidebarに残り、Secondary Sidebarへ戻らないことを確認した。VS Code E2Eは `docs/agents/testing.md` に従いサンドボックス外で実行した。
- **画面証拠**: [狭幅・暗色](evidence/issue-133/inspector-dark-narrow.png)、[広幅・暗色](evidence/issue-133/inspector-dark-wide.png)、[狭幅・明色](evidence/issue-133/inspector-light-narrow.png)、[広幅・明色](evidence/issue-133/inspector-light-wide.png)。

## Issue #134: Progression Assistant in the Common Inspector

- **状態**: Issue #134 と PR #139 はマージ済み。PROG-INS-07 の VoiceOver はユーザーが動作を確認したと報告し、環境版情報を記録した。
- **実装**: コード進行の CodeLens から共通 Inspector を開き、4/8/16 小節・置換/末尾追加・最大5候補を表示する。Inspector の操作はホスト所有セッションで対象 URI/version と候補 ID を再検証し、選択は Decoration と既存 Preview の A/B 表示を更新するだけでソース編集・自動再生をしない。Play の直接クリック内で Inspector が AudioContext を同期的に再開してから Host に要求し、Host は Preview をロックして停止確認を受け取った後に限り正規 timeline payload と排他 lease を渡す。Inspector は chord / bars / melody / song の選択範囲をローカル Web Audio で再生し、Stop・自然終了・文書切替・Preview dispose 時に lease を解放する。Preview は lease 中の再生と Practice 操作を拒否する。A/B切替前は Inspector の再生を止める。部分範囲が演奏順で非連続なら既存再生を停止してローカライズ済み案内を表示し、明示的にsongを選ぶまで全曲再生しない。8/16小節では4小節パターンの反復を表示する。Apply は確認後もセッション・候補 revision・対象文書を再検証して単一 WorkspaceEdit を適用し、1回の Undo で戻せる。
- **検証**: `npm run compile`、`check:help`、`check:ai`、`npm test`（単体 **1,126 件 PASS** / 通常 VS Code E2E **80 件 PASS・3 件 pending**）、`npm run vscode:prepublish`、`npx @vscode/vsce ls`（**1,598 項目**）、`verify-implementation-contract`、`validate-docs`、`verify_final`、`git diff --check` が PASS。CDP 有効 E2E は **83 件 PASS**。ED-09 は信頼されたキーボードで Play → lease grant → 遅延中の Stop を行い、停止 ACK、Preview lease 解除、resume 解決後も Audio node が作られないことを確認する。続けて新しい lease の再生中に旧leaseの遅延startを注入し、現leaseとStop操作が維持されることも確認する。ED-10 は別 GuitarDSL 文書へ切り替え、Inspector が新文書状態に更新された後に旧セッションが無効化されても Stop ACK と Preview の解除が完了することを確認する。ProgressionAudioLeaseCoordinator の単体テストは、旧セッションの停止要求と旧leaseの失敗ACKが新leaseの停止・unlockを起こさないことを確認する。画面証拠は Extension Development Host のタイトルで window target を選び CDP で取得する。ED-03 は Inspector と legacy A/B 切替の両方で Preview render を保留し、render 完了前に stop が呼ばれることも確認する。Inspector のコード候補画面で再生できたことはユーザー報告で確認済み。
- **画面証拠**: E2EがタイトルでExtension Development Hostのwindow targetを選び、CDPで撮影した。英語・暗色：[候補一覧](evidence/issue-134/inspector-en-dark-narrow.png)、[キーボード操作後](evidence/issue-134/inspector-en-dark-narrow-kbd.png)、[再生操作部](evidence/issue-134/inspector-en-dark-narrow-kbd-controls.png)、[Inspector再生中](evidence/issue-134/inspector-en-dark-audio-playing.png)。英語・明色：[候補一覧](evidence/issue-134/inspector-en-light-narrow-focusfix5.png)、[キーボード操作後](evidence/issue-134/inspector-en-light-narrow-focusfix5-kbd.png)、[再生操作部](evidence/issue-134/inspector-en-light-narrow-focusfix5-kbd-controls.png)。日本語・暗色：[候補一覧](evidence/issue-134/inspector-ja-dark-narrow-ja-registered.png)、[キーボード操作後](evidence/issue-134/inspector-ja-dark-narrow-ja-registered-kbd.png)、[再生操作部](evidence/issue-134/inspector-ja-dark-narrow-ja-registered-kbd-controls.png)。日本語・明色：[候補一覧](evidence/issue-134/inspector-ja-light-narrow-ja-registered-light.png)、[キーボード操作後](evidence/issue-134/inspector-ja-light-narrow-ja-registered-light-kbd.png)、[再生操作部](evidence/issue-134/inspector-ja-light-narrow-ja-registered-light-kbd-controls.png)。画像はVS Code rendererで、macOSのネイティブ枠は含まない。
- **VoiceOver確認 (ユーザー報告)**: Inspector の VoiceOver 操作は動作したとの報告を受領。2026-10-14に取得した環境情報は macOS 26.6.2 (25G83)、VS Code 1.141.0 (`2a59476c9bfcb90b3ddc372c36762471b7dfad1c`, arm64)、VoiceOver.app 10 (bundle build 993)、GuitarDSL Previewer 0.1.0、locale `ja_JP` / Apple language `ja-JP`。E2E Extension Development Host は VS Code 1.141.1 で、ユーザーの通常 VS Code とは別の検証プロセス。
- **音声再生確認 (ユーザー報告)**: Inspector のコード候補画面で再生できることをユーザーが確認したと報告。出力機器、音量、OS 情報は取得していない。Chromium の AX tree 確認も、ユーザーによる VoiceOver 報告とは別の証拠として扱う。

## Issue #135: Score Settings in the Common Inspector

- **状態**: PR #140 は 2026-10-16 (JST) に `main` へマージ済み、Issue #135 は closed。承認済み契約 comment 6168286692 に沿う実装は feature/135-settings-inspector にあり、基準は main@428c30f。
- **実装**: Capo / Beginner / Transpose の3節を既存 Inspector View に統合。設定セッションと候補モデル、文書識別、確認後のApplyを Extension Host が所有する。候補比較はDSLを編集せず、既存 Preview override を一時利用する。Applyは対象文書を再検証し、一つの WorkspaceEdit にまとめる。進行音声leaseの停止確認後に設定を開く。旧Score Settings Panelと専用HTML/JSを廃止。#145 / PR #149 によりPreviewの直接操作は一時楽譜設定として復元されたが、詳細比較と永続Apply/CancelはInspectorが所有する。
- **検証**: 今回の `npm test` PASS（Help/AI同期、単体 **1,132件 PASS**、VS Code 1.142.0 E2E **89件 PASS・6件 pending**）。S135-01 非同期解決順、S135-06 Preview 1回描画、S135-07 Apply確認中の再オープン/有効・無効候補/有効・無効な節の検証、S135-12 `openInspector` 後の Preview/PDF 復元に加え、S135-13 は新しい進行コンテキストが設定要求の文書解決を無効化すること、S135-14 はStop ACK待ちに開始した新セッションを古い設定要求が維持することを確認。S135-15 は同じ Document context への明示的 `openInspector` が保留中の Settings 要求を失効させること、S135-16 はホスト検証済み Settings Close 後に先行要求が Settings を再表示しないこと、S135-17 は未知の進行コマンドと範囲外の小節数が保留中 Settings を失効させないことをE2Eで確認。S135-11もVS Code 1.141.2で実Inspector音声を再生中にSettingsを開き、Stop ACK成功・配送失敗・ACK timeoutの3ケースを個別E2EでPASS。配送失敗とACK timeoutではSettingsを閉じたままleaseとPreviewロックを保持し、後続の実Stop ACKで解除することを確認。通常フルスイートの6件pendingは画面/音声E2Eの実行条件に依存する。設定UIのCDP有効E2EはEN/JA × dark/light の4組で各1件PASSし、幅800pxのExtension Development Hostから3節画像を取得。`npm run vscode:prepublish` PASS。`npx @vscode/vsce ls` は **1,598項目**で、新しいInspector rendererを含み旧Panel資産を含まない。`verify-implementation-contract` と `validate-docs --issue 135` PASS。VoiceOver、Windows/Linux、最小VS Code版は未実施。音声停止ACK/古いセッション解放自体は `progressionAudioLease` unit test と ED-09/ED-10 でも確認。
- **画面証拠（Extension Development Host、幅800px）**: EN/dark [Capo](evidence/issue-135/settings-en-dark-narrow-capo.png) · [Beginner](evidence/issue-135/settings-en-dark-narrow-beginner.png) · [Transpose](evidence/issue-135/settings-en-dark-narrow-transpose.png)。EN/light [Capo](evidence/issue-135/settings-en-light-narrow-capo.png) · [Beginner](evidence/issue-135/settings-en-light-narrow-beginner.png) · [Transpose](evidence/issue-135/settings-en-light-narrow-transpose.png)。JA/dark [Capo](evidence/issue-135/settings-ja-dark-narrow-capo.png) · [Beginner](evidence/issue-135/settings-ja-dark-narrow-beginner.png) · [Transpose](evidence/issue-135/settings-ja-dark-narrow-transpose.png)。JA/light [Capo](evidence/issue-135/settings-ja-light-narrow-capo.png) · [Beginner](evidence/issue-135/settings-ja-light-narrow-beginner.png) · [Transpose](evidence/issue-135/settings-ja-light-narrow-transpose.png)。
- **文書オーナー**: docs/specs/extension.md、docs/design/score-editing.md、docs/design/vscode-editor-experience.md、docs/design/architecture.md、docs/design/preview-rendering-and-export.md、本書、EN/JA Help とその digest。

## Issue #136: Simplify the Preview Toolbar

- **状態**: Issue #136 と [PR #141](https://github.com/puchinya/vscode-guitar-dsl/pull/141) は 2026-10-17 に `main` へマージ済み。Issue #136 は closed。
- **実装**: 通常再生 transport を 48 px の1行に集約し、Playback settings と View & Export を非モーダル disclosure にまとめる。Practice ON 時だけ 42 px 行を表示。進行編集UIはInspectorへ移行した。Capo / Beginner のPreview一時楽譜設定は後続の #145 / PR #149 で44 px行として復元され、詳細比較と永続Apply/Cancelは引き続きInspectorが所有する。PreviewとPDFは同じHost解決済みDSLを共有する。紙面・向き変更は既存の `layoutChanged` を保ち、URI・文書 version・Preview generation に結び付いた一度限りのフォーカス復帰を追加。
- **検証**: macOS arm64 / VS Code 1.142.0。`npm test`（Help/AI同期、unit 1,136 passing、VS Code E2E 90 passing / 6 pending）、`npm run vscode:prepublish`、`npx @vscode/vsce ls`（1,599項目）、`validate-docs --issue 136`、`verify-implementation-contract 136`、`git diff --check` は PASS。P136 の実Webview E2Eは通常の `npm test` でも実行し、Preview 幅を実測 600 CSS px に調整した。Practice speed / loop / A / B にフォーカスした状態からコマンドでOFFにし、非表示前に `practice-toggle` へフォーカスが移ること、用紙選択と縦横変更後に各コントロールへ復帰すること、連続する向き変更および文書切替後に古いフォーカス先が復活しないことを検証。600pxと421pxの両方でtransport全件とtoolbarのはみ出しなしを確認し、View & ExportでTab到達、`:focus-visible` outline、Escape後のトリガーへのフォーカス復帰を実Webviewで確認した。JA/EN × Dark/Light の4ケースの実画面 capture も各1 passing。Extension Host 互換メッセージ5種のルーティング回帰テストを追加。VoiceOver / NVDA、Windows / Linux は未実施。
- **画面証拠**: 実Extension Development Host の 600 CSS px Previewを目視確認し、JA/EN × Dark/LightそれぞれPractice OFF/ONの計8枚を保存した：`preview-en-dark-600-practice-{off,on}-view-open-pr141.png`、`preview-en-light-600-practice-{off,on}-view-open-pr141.png`、`preview-ja-dark-600-practice-{off,on}-view-open-pr141.png`、`preview-ja-light-600-practice-{off,on}-view-open-pr141.png`。旧421px captureは履歴証拠として保持。
- **文書オーナー**: docs/specs/extension.md、docs/design/preview-rendering-and-export.md、docs/design/vscode-editor-experience.md、本書、EN/JA Help とその digest、生成済み media/help。

## Issue #137: GuitarDSL Sidebar navigation

- **状態**: [PR #152](https://github.com/puchinya/vscode-guitar-dsl/pull/152) は 2026-10-18 に `main` へマージ済み、Issue #137 はclosed。A-9〜A-13の指摘対応は、承認済みImplementation Contract comment 6251494436（SHA-256 `353e3d5ec70cb8ca5a049476fed51605b24c63625cab7e3a4c23ebcea32063e6`、25,314 bytes）の範囲内で実装・検証した。結果プレビューの画面証拠をIssue #137へ添付済み。
- **実装**: Sidebar を target 行＋5分類にし、Current File はアクティブな GuitarDSL 文書だけを表示する。Preview/PDF/GP は実行時に捕捉したアクティブ文書 URI に固定し、URI の解決失敗時に他文書へ fallback しない。ファイル選択と採譜 source Quick Pick は内部 command で追加し、公開 command contribution は変更しない。YouTube 採譜は SecretStorage 保存成功後に Webview のキー状態を同期し、失敗は成功扱いせず再試行可能にする。処理中の所有権と二重Start防止はパネル破棄後も Host に残る。成功結果はパネル内の読み取り専用プレビューとCopy操作で渡し、文書を自動生成しない。パネルを閉じると結果を破棄する。Webview準備後にHostの最新ジョブ状態を取得し、job IDと単調増加revisionで古い通知を無視する。Import/Export Guitar Pro は VS Code 標準 `music` Codicon を使う。
- **検証**: macOS arm64 / VS Code 1.142.0。`npm test`（Help/AI同期、unit **1,167件 PASS**、VS Code E2E **104件 PASS / 6件 pending**）、`npm run compile:all`、`npm run check:help`、`npm run check:ai`、`npm run vscode:prepublish`、`npx @vscode/vsce ls`（1,600項目）、`verify-implementation-contract 137`、`validate-docs --issue 137`、`git diff --check` は PASS。E2EのGemini経路は全てfixtureで置き換え、実Gemini APIを呼び出さない規則を `docs/agents/testing.md` に記録している。A-10は成功したDSLのPanel内プレビュー、コピー、文書未生成を、A-11はready後の状態再取得、古いreleaseの無視、Start復旧をUnit/E2Eで確認した。A-12は成功通知を落とした場合のHost result snapshot再取得、単調revisionによる結果表示と所有job一致をUnit/E2Eで確認した。A-13は実WebviewのCopyクリックからHost clipboard adapterまでの成功、localized失敗、結果保持、古いjob ID拒否を確認した。A-9のSecretStorage読み取り失敗はlocalized unknown/error表示、Start復旧、Gemini実行なし、キー・例外本文・stack非露出をUnit/E2Eで確認した。SidebarのURI固定、Guitar Proアイコン、キー保存、進捗、再試行等の既存G137確認も維持する。VS Code/Electron E2Eは `docs/agents/testing.md` に従いサンドボックス外で実行。
- **A-9追加検証（A-9時点）**: `npm run compile:all` と `npm run test:unit`（1,165 PASS）、サンドボックス外の `npm run test:e2e`（103 PASS / 6 pending）、`npm run check:help`、`npm run check:ai`、`npm run vscode:prepublish` は PASS。初期 `SecretStorage.get` reject は localized unknown 状態とキー再入力導線を、Start reject は localized error、Start復旧、Gemini呼び出しなし、生成文書なし、APIキー・例外本文・stack非露出を unit / 実Webview E2E で確認。
- **画面証拠**: Extension Development Host で取得。Sidebar は 300 CSS px、YouTube Panel は 548 CSS px。
  - [Issue #137 の証拠コメント](https://github.com/puchinya/vscode-guitar-dsl/issues/137#issuecomment-6244861539) に4条件×2画面のキャプチャを掲載。
  - EN・dark: [Sidebar](evidence/issue-137/sidebar-en-dark-300px.png) / [YouTube Panel](evidence/issue-137/youtube-transcription-en-dark-collapsed.png)
  - [Import/Export Guitar Pro の `music` Codicon を表示した Workbench capture](evidence/issue-137/sidebar-guitarpro-icons-en-dark-300px.png)（EN・dark、300 CSS px）。
  - [YouTube採譜結果のPanel内プレビュー（fixture使用）](evidence/issue-137/youtube-transcription-result.png)（EN・dark、548 CSS px、実Gemini API呼出しなし）。[Issue #137 の証拠コメント](https://github.com/puchinya/vscode-guitar-dsl/issues/137#issuecomment-6251833476)。
  - EN・light: [Sidebar](evidence/issue-137/sidebar-en-light-300px.png) / [YouTube Panel](evidence/issue-137/youtube-transcription-en-light-collapsed.png)
  - JA・dark: [Sidebar](evidence/issue-137/sidebar-ja-dark-300px.png) / [YouTube Panel](evidence/issue-137/youtube-transcription-ja-dark-collapsed.png)
  - JA・light: [Sidebar](evidence/issue-137/sidebar-ja-light-300px.png) / [YouTube Panel](evidence/issue-137/youtube-transcription-ja-light-collapsed.png)
- **未実施**: VoiceOver / NVDA の実操作、Windows / Linux。

## Issue #142: ギター・リズム符のタイによるシンコペーション

- **状態**: [PR #143](https://github.com/puchinya/vscode-guitar-dsl/pull/143) は2026-10-17に `main` へマージ済み。Issue #142 はclosed。
- **実装**: `.t` / `.tie` による直後のリズム符へのタイをコンパイラで検証し、隣接小節、連結音価、`let` 境界、`%` 境界、コード押さえ方の一致を扱う。未使用 `let` 定義でもタイの構造と定義境界を検証する。Preview / PDF は段・ページ端でタイ弧を分割し、演奏順に隣接しない再生区間では通常の攻撃音に戻す。Inspector の単一コード試聴は最初の有効アタックを選び、小節・メロディ試聴は開始位置が継続符なら冒頭に一度だけ再アタックを含める。
- **検証**: `npm run check:help`、`npm run check:ai`、sandbox外の `npm test`（1151 unit passing、90 E2E passing、6件 pending）、`npm run compile`、`npm run vscode:prepublish`、`npx @vscode/vsce ls`（1599項目）、`git diff --check` がPASS。workflowの承認済み契約照合もPASS。
- **表示証拠**: [Issue #142のコメント](https://github.com/puchinya/vscode-guitar-dsl/issues/142#issuecomment-6228612671) に、共通 `renderScoreSheets()` SVGから作成したライト/ダーク画像を添付し、タイ弧と連桁を目視確認した：[ライト](evidence/issue-142/preview-light.png)、[ダーク](evidence/issue-142/preview-dark.png)。実Extension Development Hostの画面キャプチャではなく、Preview/PDF共有SVGのラスタライズ結果。
- **サンプル**: [`sample_rhythm_tie_syncopation.guitardsl`](../../samples/sample_rhythm_tie_syncopation.guitardsl)。
- **文書オーナー**: docs/specs/guitardsl-syntax.md、docs/design/language-and-score-processing.md、docs/design/preview-rendering-and-export.md、本書、EN/JA Help とその digest、生成済み media/help、AI syntax reference。

## Issue #144: VS Code E2E active-editor の競合と初回実行の不安定さ

- **状態**: [PR #146](https://github.com/puchinya/vscode-guitar-dsl/pull/146) は 2026-10-17 に `main` へマージ済み、Issue #144 はclosed。
- **実装**: `showAndFocus` は対象URI・列・安定したactive tabをイベントと現在状態で確認し、上限内で一度だけ対象groupを再フォーカスする。失敗時のみ、URIをラベル化した最大128件のfocus traceを出す。Undo直前に対象文書/列とVS Codeウィンドウのfocusを検証する。P136はsidebar/auxiliary bar、theme、tabs、Preview、editor group/widthをsnapshotし、`finally`で復元する。macOSのE2E root hookは必要時に隔離Extension Development Hostを前面化する。安定性runnerは各回を別プロセス/プロファイルで実行し、retryしない。
- **検証**: 修正後の `npm test` はHelp/AI同期、単体テストPASS、VS Code E2E **95件 PASS・6件 pending**。`npm run verify:e2e-stability -- --runs 5` はコミット `0bbc9fbd7ec12a9e9a2d00ce24a592344b6663eb` で **5/5 PASS**（各回95件PASS・6件pending、macOS 25.6 arm64 / VS Code 1.142.0 / Node 26.7.0、新規プロセス・プロファイル、retryなし）。`validate-docs --issue 144`、`verify-implementation-contract 144`、`git diff --check` もPASS。6件はcapture/audio条件が必要な既存pendingで、成功件数に含めていない。現行の `agent-required-check` はE2Eを実行しない。
- **文書オーナー**: [`docs/agents/testing.md`](../agents/testing.md) と本書。

## Issue #145: Previewの一時楽譜設定（カポ・難易度・初心者モード）を復元

- **状態**: [PR #149](https://github.com/puchinya/vscode-guitar-dsl/pull/149) は 2026-10-17 に `main` へマージ済み、Issue #145 はclosed。最新仕様追補とレビューコメント `5557502582` を反映し、ネイティブCapo一覧のOSキーボード選択も追加検証済み。
- **実装**: 48px再生行の直下に44pxの楽譜設定行を常時表示し、「一時楽譜設定」の見出しは表示しない。カポ・弾きやすさ・初心者モードを直接操作できる。カポの選択欄を閉じた時は数字だけを表示し、選択中のドロップダウン項目だけ数字・スコア・難易度・おすすめを表示する。選択欄にも一覧にも「Capo／カポ」を重ねて表示しない。弾きやすさはデザイン案に合わせ、ラベルの右に白字の緑 `#2e7d32`・黄土 `#8d6e00`・赤 `#b71c1c` の丸いスコアバッジを表示し、600 CSS px以下では点区切りを省略しつつスコアと難易度の間隔を保つ。評価不能は中立色で表示する。840 CSS px以上では補助設定とInspectorリンクを同じ行に表示し、置き換え結果またはカポ警告がある場合だけ小さな詳細ボタンを表示する。ボタンは既存パネルを情報専用の非モーダル領域として開き、置き換え・警告を表示する。それ未満では **More** から同じ情報を確認できる。どちらもキーボードで開閉でき、44px行を維持する。情報がないときは詳細ボタンの場所を空けない。練習モードON時だけtop=92px・高さ42pxの行を追加し、本文paddingをOFF=110px / ON=152pxとする。Preview intentはURI/version/generationと候補の対応を確認してから処理し、無効・stale messageはfocus復元hintを破棄しない。Preview設定は既存controllerを使い、DSL編集やUndoを行わず、Inspectorが詳細編集とApply/Cancelを所有する。
- **検証**: macOS arm64 / VS Code 1.142.0。`.agent/project.json` の `npm test` はHelp/AI同期PASS、単体 **1,155件PASS**、VS Code E2E **98件PASS・6件pending**。`npm run vscode:prepublish`、`npx @vscode/vsce ls`（**1,599項目**）、`npm run compile`、`git diff --check` もPASS。実WorkbenchのExtension Development Hostで421/600/840/1100 CSS px × JA/EN × Dark/Lightの16条件を個別に実行してPASSし、行の幾何、直接操作、色、練習行、詳細経路、キーボード/ARIA、旧見出しの非表示、カポ一覧を開いた時だけ詳細表示し閉じると数字表示に戻ることを検査。Preview rerender後はURI/version/generationが一致する画面を待ってから次の操作へ進む。ネイティブCapo受入れE2EもEN/JA × Dark/Lightの4条件で各1回実施してPASS。各回で実測421/600/840/1100 CSS pxのネイティブ一覧を開いて撮影し、Escapeによるキャンセルとフォーカス復元を検査。421pxと1100pxではOSキーボードのArrowDown + Returnで有効候補を選び、Previewが1回更新されること、DSLが変わらないことを確認。無効候補のみの文書では選択とPreview更新が起きないこと、Returnで閉じると選択表示が数字だけに戻ることも確認。合計40枚のスクリーンショットはCoreGraphicsで取得したExtension Development Hostのwindow IDを`screencapture -l`へ渡して撮り、ウィンドウ単位の画像で候補一覧と選択後表示を確認した。[Issue #145のコメント](https://github.com/puchinya/vscode-guitar-dsl/issues/145#issuecomment-6234734413) に、全幅の一覧16枚・ArrowDown状態8枚・選択後8枚の計32枚を添付（撮影40枚のうち重複する一覧8枚は省略）。unsupported候補の拒否・Inspector draft保持とaccepted intentのstale duplicate拒否・focus復元は対象E2E **2件PASS**。6件のpendingとVoiceOver/NVDA、Windows/Linuxは未実施。
- **画面証拠**: 実Preview Webviewから撮影。各セルにEN・暗色 / EN・明色 / JA・暗色 / JA・明色の証拠を記録する。

設計参照: [600px表示](evidence/issue-145/design/vscode-guitardsl-score-settings-600px.svg) / [2行設定表示](evidence/issue-145/design/vscode-guitardsl-score-settings-second-row.svg)。

| Preview幅 | EN・暗色 | EN・明色 | JA・暗色 | JA・明色 |
|---|---|---|---|---|
| 421px | [画像](evidence/issue-145/preview-en-dark-421-score-settings.png) | [画像](evidence/issue-145/preview-en-light-421-score-settings.png) | [画像](evidence/issue-145/preview-ja-dark-421-score-settings.png) | [画像](evidence/issue-145/preview-ja-light-421-score-settings.png) |
| 600px | [画像](evidence/issue-145/preview-en-dark-600-score-settings.png) | [画像](evidence/issue-145/preview-en-light-600-score-settings.png) | [画像](evidence/issue-145/preview-ja-dark-600-score-settings.png) | [画像](evidence/issue-145/preview-ja-light-600-score-settings.png) |
| 840px | [画像](evidence/issue-145/preview-en-dark-840-score-settings.png) | [画像](evidence/issue-145/preview-en-light-840-score-settings.png) | [画像](evidence/issue-145/preview-ja-dark-840-score-settings.png) | [画像](evidence/issue-145/preview-ja-light-840-score-settings.png) |
| 1100px | [画像](evidence/issue-145/preview-en-dark-1100-score-settings.png) | [画像](evidence/issue-145/preview-en-light-1100-score-settings.png) | [画像](evidence/issue-145/preview-ja-dark-1100-score-settings.png) | [画像](evidence/issue-145/preview-ja-light-1100-score-settings.png) |

置き換え `F → Fmaj7` とカポ警告を開いた詳細経路。421/600px は既存の **More**、840/1100px は行内ボタンから開く。

| Preview幅 | EN・暗色 | EN・明色 | JA・暗色 | JA・明色 |
|---|---|---|---|---|
| 421px | [画像](evidence/issue-145/preview-en-dark-421-score-settings-details.png) | [画像](evidence/issue-145/preview-en-light-421-score-settings-details.png) | [画像](evidence/issue-145/preview-ja-dark-421-score-settings-details.png) | [画像](evidence/issue-145/preview-ja-light-421-score-settings-details.png) |
| 600px | [画像](evidence/issue-145/preview-en-dark-600-score-settings-details.png) | [画像](evidence/issue-145/preview-en-light-600-score-settings-details.png) | [画像](evidence/issue-145/preview-ja-dark-600-score-settings-details.png) | [画像](evidence/issue-145/preview-ja-light-600-score-settings-details.png) |
| 840px | [画像](evidence/issue-145/preview-en-dark-840-score-settings-details.png) | [画像](evidence/issue-145/preview-en-light-840-score-settings-details.png) | [画像](evidence/issue-145/preview-ja-dark-840-score-settings-details.png) | [画像](evidence/issue-145/preview-ja-light-840-score-settings-details.png) |
| 1100px | [画像](evidence/issue-145/preview-en-dark-1100-score-settings-details.png) | [画像](evidence/issue-145/preview-en-light-1100-score-settings-details.png) | [画像](evidence/issue-145/preview-ja-dark-1100-score-settings-details.png) | [画像](evidence/issue-145/preview-ja-light-1100-score-settings-details.png) |

- **文書オーナー**: `docs/specs/extension.md` §§4.2, 4.4–4.5, 4B, 4D、`docs/design/preview-rendering-and-export.md`、`score-editing.md`、`vscode-editor-experience.md`、EN/JA Helpとmanifest、生成済み `media/help/`、本書。

## Issue #153: 弾き語り練習ガイドとギター伴奏リズム

- **状態**: [PR #154](https://github.com/puchinya/vscode-guitar-dsl/pull/154) は2026-10-23に `main` へマージ済み。現行表示の変更は Issue #155 を参照。
- **実装**: Issue #153でPractice ON時の詳細タイムライン、コード図、奏法・歌詞・メロディ表示と再生連動を実装した。画面レイアウトとコンパクト表示の契約は後続のIssue #155で更新する。
- **コンパクト奏法記号**: 持続イベントの `〜` は小節内でリズムイベントごとに最大1つだけ表示し、選択グリッドのセル数を反映した詳細表示と区別する。コードチェンジをまたぐイベントも小節内で重複しない。
- **再レビュー修正**: リズム書き戻しは `.m` と `.s1`〜`.s6` の意味を保持し、`%` の継承比較にも含める。詳細・コンパクト表示とも全コード時刻イベントを残す。コンパクト `〜` はリズムイベントごとに1つで、選択グリッドに左右されない。`.m` / `.b` / `.sN` を含む譜面では伴奏有音攻撃に80 msのrelease tailを用意し、`.m` が先行する伴奏声だけを最大8 ms fadeで止め、休符は尾を止めない。これら新技法がない既存譜面のgain envelopeは維持する。Practice LoopではBをexclusive境界とし、gainの無音終端と`source.stop`をB以内にそろえてrelease tailを次周回へ持ち越さない。
- **検証**: macOS arm64 / VS Code 1.143.0。2026-10-23 の `npm test` はHelp/AI同期PASS、単体 **1,184件PASS**、VS Code E2E **106件PASS・6件pending**。`npm run compile`、`npm run compile:all`（画面証拠E2E実行前）、`npm run vscode:prepublish`、`npx @vscode/vsce ls`（**1,601項目**、Audio MIR worker/WASMとNOTICEを含む）、`verify-implementation-contract 153`、`validate-docs --issue 153`、`git diff --check` もPASS。Practice Guide の実Workbench E2EはEN/JA × Dark/Lightの4条件で実行し、詳細表示の421/600/840/1100/1400 CSS px × メロディON/OFF **40ケース**と、コンパクト表示の421/840/1100/1400 CSS px **16ケース**をDOM検査・撮影した。同じ長い歌詞・16分リズム・F/G/Em7/Am/Dm7のfixtureを使い、ガイド色・白背景・細分グリッド非表示・小節境界・再生ヘッド・図の寸法とコード名の中心、レーン順と共通x座標、音高バー、奏法強調、固定列、シーク・速度・再生・一時停止・A/Bループの同期、ソース不変、継続記号の重複なしを確認した。今回のレビュー修正後は同Webviewテストを再実行してEN暗色の詳細／コンパクト **14枚**を撮影し、追加でrelease tail・コード再出現・グリッド切替を含む単体回帰テストを確認した。1400 CSS pxはホストのWorkbench幅上限1382 pxのためPreview iframe幅を1400 pxに設定し、Webview内幅1400 pxを確認して撮影した。既存pending 6件、VoiceOver/NVDA、Windows/Linuxは未実施。
- **Loop境界再検証**: 2026-10-23、`npm test` は単体 **1,185件PASS**、VS Code E2E **106件PASS・6件pending**。T13回帰テストは`.m`のループ内／外、Measure／A-B、Bで音価が終わる境界、50/100/200%速度を組み合わせ、旧周回のgain終端・`source.stop`がB以内であることと、次周回の攻撃が予約されることを確認した。`npm run compile`、`npm run vscode:prepublish`、`vsce ls`（1,601項目）、`validate-docs --issue 153`、`git diff --check`もPASS。
- **画面証拠**: 詳細表示40枚（`-pr154-r4`）とコンパクト表示16枚（`-pr154-r5`）を実Preview Webviewから保存した。コンパクト参照SVGは [practice-guide-compact.svg](../specs/gui_design/practice-guide-compact.svg)。
- **再レビュー画面証拠**: EN暗色の追加14枚（ファイル名 `-review-2`）。代表画像: [詳細840px](evidence/issue-153/practice-guide-en-dark-840-melody-on-pr154-r4-review-2.png) / [コンパクト840px](evidence/issue-153/practice-guide-compact-en-dark-840-pr154-r5-review-2.png)。

| Preview幅 | EN・暗色 | EN・明色 | JA・暗色 | JA・明色 |
|---|---|---|---|---|
| 421px | [ON](evidence/issue-153/practice-guide-en-dark-421-melody-on-pr154-r4.png) / [OFF](evidence/issue-153/practice-guide-en-dark-421-melody-off-pr154-r4.png) | [ON](evidence/issue-153/practice-guide-en-light-421-melody-on-pr154-r4.png) / [OFF](evidence/issue-153/practice-guide-en-light-421-melody-off-pr154-r4.png) | [ON](evidence/issue-153/practice-guide-ja-dark-421-melody-on-pr154-r4.png) / [OFF](evidence/issue-153/practice-guide-ja-dark-421-melody-off-pr154-r4.png) | [ON](evidence/issue-153/practice-guide-ja-light-421-melody-on-pr154-r4.png) / [OFF](evidence/issue-153/practice-guide-ja-light-421-melody-off-pr154-r4.png) |
| 600px | [ON](evidence/issue-153/practice-guide-en-dark-600-melody-on-pr154-r4.png) / [OFF](evidence/issue-153/practice-guide-en-dark-600-melody-off-pr154-r4.png) | [ON](evidence/issue-153/practice-guide-en-light-600-melody-on-pr154-r4.png) / [OFF](evidence/issue-153/practice-guide-en-light-600-melody-off-pr154-r4.png) | [ON](evidence/issue-153/practice-guide-ja-dark-600-melody-on-pr154-r4.png) / [OFF](evidence/issue-153/practice-guide-ja-dark-600-melody-off-pr154-r4.png) | [ON](evidence/issue-153/practice-guide-ja-light-600-melody-on-pr154-r4.png) / [OFF](evidence/issue-153/practice-guide-ja-light-600-melody-off-pr154-r4.png) |
| 840px | [ON](evidence/issue-153/practice-guide-en-dark-840-melody-on-pr154-r4.png) / [OFF](evidence/issue-153/practice-guide-en-dark-840-melody-off-pr154-r4.png) | [ON](evidence/issue-153/practice-guide-en-light-840-melody-on-pr154-r4.png) / [OFF](evidence/issue-153/practice-guide-en-light-840-melody-off-pr154-r4.png) | [ON](evidence/issue-153/practice-guide-ja-dark-840-melody-on-pr154-r4.png) / [OFF](evidence/issue-153/practice-guide-ja-dark-840-melody-off-pr154-r4.png) | [ON](evidence/issue-153/practice-guide-ja-light-840-melody-on-pr154-r4.png) / [OFF](evidence/issue-153/practice-guide-ja-light-840-melody-off-pr154-r4.png) |
| 1100px | [ON](evidence/issue-153/practice-guide-en-dark-1100-melody-on-pr154-r4.png) / [OFF](evidence/issue-153/practice-guide-en-dark-1100-melody-off-pr154-r4.png) | [ON](evidence/issue-153/practice-guide-en-light-1100-melody-on-pr154-r4.png) / [OFF](evidence/issue-153/practice-guide-en-light-1100-melody-off-pr154-r4.png) | [ON](evidence/issue-153/practice-guide-ja-dark-1100-melody-on-pr154-r4.png) / [OFF](evidence/issue-153/practice-guide-ja-dark-1100-melody-off-pr154-r4.png) | [ON](evidence/issue-153/practice-guide-ja-light-1100-melody-on-pr154-r4.png) / [OFF](evidence/issue-153/practice-guide-ja-light-1100-melody-off-pr154-r4.png) |
| 1400px | [ON](evidence/issue-153/practice-guide-en-dark-1400-melody-on-pr154-r4.png) / [OFF](evidence/issue-153/practice-guide-en-dark-1400-melody-off-pr154-r4.png) | [ON](evidence/issue-153/practice-guide-en-light-1400-melody-on-pr154-r4.png) / [OFF](evidence/issue-153/practice-guide-en-light-1400-melody-off-pr154-r4.png) | [ON](evidence/issue-153/practice-guide-ja-dark-1400-melody-on-pr154-r4.png) / [OFF](evidence/issue-153/practice-guide-ja-dark-1400-melody-off-pr154-r4.png) | [ON](evidence/issue-153/practice-guide-ja-light-1400-melody-on-pr154-r4.png) / [OFF](evidence/issue-153/practice-guide-ja-light-1400-melody-off-pr154-r4.png) |

コンパクト表示の実Preview証拠（各画像に4小節を表示）。

| Preview幅 | EN・暗色 | EN・明色 | JA・暗色 | JA・明色 |
|---|---|---|---|---|
| 421px | [画像](evidence/issue-153/practice-guide-compact-en-dark-421-pr154-r5.png) | [画像](evidence/issue-153/practice-guide-compact-en-light-421-pr154-r5.png) | [画像](evidence/issue-153/practice-guide-compact-ja-dark-421-pr154-r5.png) | [画像](evidence/issue-153/practice-guide-compact-ja-light-421-pr154-r5.png) |
| 840px | [画像](evidence/issue-153/practice-guide-compact-en-dark-840-pr154-r5.png) | [画像](evidence/issue-153/practice-guide-compact-en-light-840-pr154-r5.png) | [画像](evidence/issue-153/practice-guide-compact-ja-dark-840-pr154-r5.png) | [画像](evidence/issue-153/practice-guide-compact-ja-light-840-pr154-r5.png) |
| 1100px | [画像](evidence/issue-153/practice-guide-compact-en-dark-1100-pr154-r5.png) | [画像](evidence/issue-153/practice-guide-compact-en-light-1100-pr154-r5.png) | [画像](evidence/issue-153/practice-guide-compact-ja-dark-1100-pr154-r5.png) | [画像](evidence/issue-153/practice-guide-compact-ja-light-1100-pr154-r5.png) |
| 1400px | [画像](evidence/issue-153/practice-guide-compact-en-dark-1400-pr154-r5.png) | [画像](evidence/issue-153/practice-guide-compact-en-light-1400-pr154-r5.png) | [画像](evidence/issue-153/practice-guide-compact-ja-dark-1400-pr154-r5.png) | [画像](evidence/issue-153/practice-guide-compact-ja-light-1400-pr154-r5.png) |

- **文書オーナー**: `docs/specs/guitardsl-syntax.md`、`extension.md`、`gui_design.md`、`docs/design/language-and-score-processing.md`、`preview-rendering-and-export.md`、`score-editing.md`、EN/JA Helpとmanifest、生成済み `media/help/`、AI syntax reference、本書。

## Issue #155: 弾き語り練習ガイドのSVGストローク・正方形コード図・2小節クロスフェード

- **状態**: [Issue #155](https://github.com/puchinya/vscode-guitar-dsl/issues/155) の更新済みImplementation Contract（SHA-256 `81b60f006aa6f1350884bb522d3e7c7b84a94f5d0868662688cf624c2767e0c1`）を承認済み。[PR #156](https://github.com/puchinya/vscode-guitar-dsl/pull/156) は 2026-10-24 に `main` へマージ済み、Issue #155 はclosed。handoff時のself-reviewとdelivery-checkは常にPRの現HEADに対して実行する。
- **表示仕様**: コンパクト表示は常に4小節を投影し、適応的に2/1小節へ減らさない。小節幅や譜面密度で収まらない時は横スクロールで4小節へ到達できる。通常幅では4小節を横一列に並べる。前後ボタンで停止中にページを手動で閲覧できる。コード名と144×144 pxの図は小節境界から離し、各コード区間の中央へ配置する。ストローク記号はベクターSVG、二組のバンクを交互に220 msでクロスフェードし、演奏中バンクと次コード欄の位置を維持する。
- **検証**: 最新修正後の `npm test` はHelp/AI同期PASS、単体 **1,192件PASS**、VS Code E2E **112件PASS・6件pending**。コンパクト奏法の高さ共有E2Eは幅280/320/360/400/420/421/600/1400/1600px × Melody ON/OFF × 4/8/16分グリッドの54状態で4小節、レーンと固定ラベルの境界差1px以内、奏法SVGの同一小節内非衝突・レーン内包含を確認した。別のレンダラー単体テストは内部同時イベントから2行割当と67px共通高さを算出し、4小節出力を検証する。公開DSLのTAB声部制約は維持する。メロディバーE2Eは承認幅280/320/360/420/421/600/840/1100/1400pxと1600pxで各小節4音の実DOMRect、Fraction拍位置、音高Y座標、寸法、レーン内包含、Melody ON/OFFを検査する。Help/AI同期、`verify-implementation-contract 155`、`validate-docs --issue 155`、`vscode:prepublish`、VSIX収録1,602項目、`git diff --check`もPASS。pending 6件、VoiceOver/NVDA、Windows/Linuxは未実施。
- **画面証拠**: メロディバーCSS修正後の現行Previewを、幅280/320/360/420/421/600/840/1100/1400px × JA/EN × Light/Dark × Melody ON/OFFの72状態で撮影し、全画像を目視確認した。72枚すべてPNG実幅が指定CSS幅と一致し、音程バー、5レーン、歌詞・奏法・コード図、固定次コード、Melody OFF時の高さ、横スクロール可能な小節内容を確認した。画像は `docs/status/evidence/issue-155/` に `-melody-matrix.png` 付きで保存。代表画像: [JA Light・421px](evidence/issue-155/practice-guide-compact-issue155-ja-light-421-melody-on-melody-matrix.png)、[EN Dark・1400px](evidence/issue-155/practice-guide-compact-issue155-en-dark-1400-melody-on-melody-matrix.png)、[EN Dark・1600pxの4小節参照](evidence/issue-155/practice-guide-reference-4-measures-issue155-en-dark-melody-bars.png)、[110msクロスフェード](evidence/issue-155/practice-guide-crossfade-issue155-en-dark-110ms-melody-bars.png)。従来の72枚は旧HEADの履歴として保持する。
- **文書オーナー**: `docs/specs/gui_design.md` §2.4、`docs/specs/extension.md` §4.6、`docs/design/preview-rendering-and-export.md`、EN/JA Helpとmanifest、生成済み `media/help/`、本書。

## 1. 機能実装状況マトリクス (Feature Implementation Matrix)

### 1.1 言語構文・コンパイラ / 描画機能 (`src/compiler.ts`, `src/render/`)

| 機能区分 | 機能名 / 構文 | ステータス | 備考 |
|---|---|:---:|---|
| **メタデータ** | `title`, `artist`, `capo`, `tuning`, `key`, `bpm` 等のパース | ✅ 完了 | `src/headerValue.ts::splitHeaderValue` が区切り規則に一致する行末コメントをメタデータ値から除外。`tuning:` は5つの標準プリセットまたは明示6音を受け付け、省略・不正値は Standard に回復 |
| | スタイルカスタマイズ（`style_chord_size` 等） | ✅ 完了 | フォントサイズ等のスタイル上書きに対応 |
| | 表示設定（`show_rhythm`, `measures_per_row`） | ✅ 完了 | リードシートモード、1段あたり小節数 1〜8。TAB を含む段では暗黙のリズム譜表を抑制し、明示リズムのみ併記 |
| | 冒頭の拍子・フィール・弱起（`time` / `feel` / `pickup`） | ✅ 完了 | 任意の拍子（1〜32 / 1・2・4・8・16、拍のグループ）、弱起と最終小節の補完 |
| **スコアイベント** | `@key` `@tempo` `@bpm` `@time` `@meter` `@feel` `@dynamic` `@mark` `@text` `@ottava` | ✅ 完了 | `src/scoreEvents.ts`。小節ごとの解決済みコンテキスト。調・拍子の変更は新しい段、打ち消しを含む調号、拍子記号、注記欄（リハーサルマーク・テンポ・フィール・テキスト・オッターヴァ・奏法範囲）と強弱欄。テンポの補間・再生はなし |
| **セクション** | `[Intro]`, `[Aメロ]` 等のセクション見出し | ✅ 完了 | 日本語・英数字・記号をフルサポート |
| **編曲** | `arrangement { ... }` によるセクション演奏順 | ✅ 完了 | `src/arrangement.ts` が既存セクションを演奏順へ lowering。繰り返しごとの歌詞番 metadata、位置付き診断、ナビゲーション記号との排他。書面小節と全番歌詞は不変 |
| **小節線・反復** | 標準小節線 `\|`、複縦線 `\|\|` | ✅ 完了 | |
| | 反復開始 `\|:`、反復終了 `:\属于\|` | ✅ 完了 | 太線・点描画の楽譜標準記号を描画 |
| | 小節反復記号 `%` (1-measure repeat) | ✅ 完了 | 前小節のリズム・小節反復シンボルを描画 |
| **演奏順** | 反復・volta・D.C./D.S. とセクション編曲の決定論的 resolver | ✅ 完了 | `src/playOrder.ts`。`ParsedScore.playOrder` は書かれた小節への出現順と任意の出現別歌詞番を返す。楽譜の表示順は不変で、Preview の Web Audio 再生は出現順を使う |
| **コード** | 基本コードネーム（メジャー、マイナー、7th等） | ✅ 完了 | 標準コードネームのパース・描画 |
| | 分数コード（オンコード: `G/B`, `D/F#` 等） | ✅ 完了 | |
| | 小節内複数コード分割（均等割り・拍数 `C:3 G:1`・音価 `C/2. G/4`） | ✅ 完了 | 拍位置に応じた自動配置。`G/B/2` のような分数コード＋音価も可 |
| | コードダイアグラム自動生成 | ✅ 完了 | スコアの調弦・カポを共有指板モデルに渡して描画。開始フレット、セーハ、指番号、ラベル表示。分数コードの専用形がなければ同じ調弦の上部コード形を使い、未解決なら描画専用 fallback を使う（弾きやすさ・初心者モードの評価から除外） |
| | コード定義 `chord C@label = ...` と `@ラベル` 参照 | ✅ 完了 | 同じコードの押さえ方を複数定義。最終の調弦・カポで物理24フレット内か検証し、無効な行はキーを占有しない。有効定義は先勝ち、後続の有効な重複は警告。五線譜上はラベルを上付きで表示。診断 3 種 |
| | プリセットライブラリ（12 ルート × 15 タイプ） | ✅ 完了 | 手書きの基本形 + CAGED 系の平行移動。Standard の候補・順序はカポ非依存、変則調弦ではカポ0の実音名が一致する形だけを候補にする |
| **リズム記号** | 音価指定（全音符、2分、4分、8分、16分） | ✅ 完了 | スラッシュノートヘッド・符尾・符桁（ビーム）を描画 |
| | ストローク方向（ダウン `v`、アップ `^`） | ✅ 完了 | 門型・V字記号をスラッシュ上部に配置 |
| | アーティキュレーション（アクセント `>`, ゴースト `()`） | ✅ 完了 | |
| | タイ記号 `_` | ✅ 完了 | 音符間を弧線で連結 |
| | 休符指定 `r4`, `r8` 等 | ✅ 完了 | 音楽フォント準拠の休符記号を描画 |
| | 3連符 `8t`、一般の連符 `8{5:4}`、加算 `4+8` | ✅ 完了 | 連符の数字（actual）、完結しない連符は警告、加算はタイで結んだスラッシュ |
| | リズム符タイ `.t` / `.tie` | ✅ 完了 | 隣接小節までの連結を検証し、Preview / PDF で分割描画。再生は1回の攻撃音と小節ごとの BPM を使う |
| | 奏法修飾子 `.pm` `.lr` `.stacc` `.ten` `.fermata` `.vib` `.breath` `.arp` | ✅ 完了 | `P.M.` / `let ring` は範囲にまとめ、段をまたぐと分割 |
| **メロディ** | `mel:` 行（音高・音価・休符・タイ・`%`） | ✅ 完了 | メロディ譜表、加線、付点、連桁、3連、段をまたぐタイ |
| | 調号・臨時記号 | ✅ 完了 | `key:` から調号を算出。臨時記号は小節内で持続し必要時のみ表示 |
| | 音符単位の歌詞 `lyr:` | ✅ 完了 | 日本語は空白の有無によらず1文字1音節、小書きかなのみ直前へ結合（促音・長音・ヵ・ヶは独立）。複数番、`()` `_` `*`、英語ハイフン。編曲時は `lyricVerse` metadata で出現別選択（表示は書面どおり） |
| | 奏法ブロック `{hammer,bend:2,...}`・装飾音符・スラー | ✅ 完了 | ハンマリング・プリング・スライド・グリッサンド・チョーキング・ビブラート・スタッカート・テヌート・フェルマータ・ブレス・パームミュート・レットリング。段をまたぐ接続は分割して描画 |
| | 実音移調 | ✅ 完了 | `src/transpose.ts`。キー・`@key`・コード・メロディ・小節内の音符をソースを保ったまま移調し、カポ（そのまま・推奨・指定）と組み合わせる |
| | 同時複数音 `[c4,e4,g4]/4` | ✅ 完了 | `mel:` と小節内の音符の位置で使える。共有の符幹・連桁、2度のずらし、臨時記号の列、全構成音のタイ。小節内の下向きの同時複数音は連桁に加えず旗で描画 |
| **ギター TAB (#89)** | `tab:` / `tab[1]:` の独立した6弦TAB | ✅ 完了 | 声部1のみ。弦・カポ相対フレット・デッドノート・コード・休符・共有音価継承・小節反復・TAB let 断片・音符/拍効果・ノート単位タイ・同弦接続・TAB 歌詞。通常音の実音は `InstrumentModel.pitchAt()` 由来 |
| | TAB レイアウト・Preview・PDF | ✅ 完了 | 6線、弦ごとのフレット、リズム/基本効果、歌詞。`SystemGeometry` が配置を所有し、PDF は Preview と同じページ SVG を使用 |
| | TAB 対応前のソース変換ガード | ✅ 完了 | カポ変更・移調・初心者モード変換は、TAB を含むソースに対して `tabTransformUnsupported` を返す。声部2〜4は予約済みで未対応 |
| | Guitar Pro 8 高度TAB意味論 | ⏳ 将来 | 32/64分・二重付点・入れ子連符・部分カポ・高度なベンド/スライド/ハーモニクス/装飾・複数声部・表示メタデータ等は未対応。共通TAB階層と音価/調弦権威を拡張して追加する |
| **再利用フラグメント** | `let 名前 = …` と `$名前` 参照 | ✅ 完了 | 前方参照・入れ子、使える位置（小節行 / `mel:`）の推論、継承の独立、定義の音高は移調で1回だけ書き換え。Outline には表示しない |
| **歌詞** | `l:"歌詞テキスト"` による歌詞配置 | ✅ 完了 | 五線譜の下部に等間隔・小節同期で描画 |
| **改ページ** | `pagebreak` 指示子による複数ページ分割 | ✅ 完了 | 指定位置で新ページを開始 |
| | 自動改ページ | ✅ 完了 | ページ高さを超える段を次ページへ送る |
| **ページ描画** | シート単位の単一 SVG（ヘッダー・ダイアグラム・楽譜・フッター） | ✅ 完了 | プレビューと PDF で共通。同梱 Noto Sans JP で描画 |

### 1.2 エディタ統合・拡張機能コア (`src/extension.ts`, `src/symbols.ts`)

| 機能区分 | 機能名 | ステータス | 備考 |
|---|---|:---:|---|
| **Code Actions (Issue #87)** | 音楽構造を理解する抽出・インライン化・移調・異名同音・音価変更・表記正規化・未使用コード削除 | ✅ 完了 | `src/codeActions.ts` / `src/codeActionProvider.ts`。パーサー由来の範囲を使い、Hints を診断として更新。検証後に単一 `WorkspaceEdit` で適用 |
| **コマンド** | `guitardsl.showPreview` (プレビュー表示) | ✅ 完了 | エディタタイトルバー・コンテキストメニュー対応 |
| | `guitardsl.exportPdf` (PDF保存 / 印刷) | ✅ 完了 | コマンドパレットおよびプレビュー内から起動可能 |
| | Issue #93 再生 / Practice Mode コマンド | ✅ 完了 | `guitardsl.playback.togglePlayPause` / `guitardsl.playback.stop`、`guitardsl.practice.toggle` / `setLoopStart` / `setLoopEnd` / `clearLoop` / `slower` / `faster` |
| | `guitardsl.editChordDiagram` (コードダイアグラム編集) | ✅ 完了 | コマンドパレット（クイックピック）、`chord` 行の CodeLens、プレビューのダイアグラムクリック |
| | `guitardsl.editScoreSettings` / `guitardsl.editCapo` (楽譜設定 / カポ・弾きやすさ) | ✅ 完了 | コマンドパレットから共通 Inspector の Capo / Playability を開く。Capo / Beginner / Transpose の設定 UI は Inspector に集約 |
| | `guitardsl.transcribeYouTube` (YouTube自動採譜・実験的) | 🧪 実験的 | 4/4 の Music IR を構造検証し、DSL のパース検証に成功した場合だけ採譜パネル内に読み取り専用プレビューを表示し、Copy からエディタへ貼り付ける。文書は自動作成しない。#45（PR #46）はハーモニー／グルーヴ／カポ処理を精緻化する。実音の精度は未検証で、生成結果は下書きとして要確認 |
| | `guitardsl.setGeminiApiKey` (APIキー設定) | ✅ 完了 | コマンドパレットのみ。SecretStorageに安全保存 |
| | `guitardsl.clearGeminiApiKey` (APIキー削除) | ✅ 完了 | コマンドパレットのみ。SecretStorageから削除 |
| | `guitardsl.transcribeAudio` (ローカル音源採譜・実験的) | 🧪 実験的 | コマンドパレットのみ。デスクトップ版のみ。PCM WAV を Worker 上の Rust/WASM で解析し、既存の検証・シリアライザで DSL 化 |
| | `guitardsl.applyStrummingPattern` (伴奏パターン変更) | ✅ 完了 | コマンドパレット（範囲 → 拍子に合うカテゴリ → 用途グループ区切りのパターン）、セクション見出し行の CodeLens（セクション番号）。正規カタログ 58 件を伴奏エンジンで適用。リズムの範囲だけを 1 回の元に戻せる編集で書き換え |
| | `guitardsl.suggestChordProgression` (コード進行候補) | ✅ 完了 | chord cell の補完と CodeLens から決定論的な候補を提示。単一コード補完は prefix のみを置換し、多小節の置換・末尾追加は共通 Inspector で選択・確認後に適用 |
| | `guitardsl.openHelp` (ヘルプを開く) | ✅ 完了 | コマンドパレット、プレビューツールバーのヘルプボタン、サイドバー。同梱の `media/help/guitardsl-help.{ja,en}.md` を組み込み Markdown プレビューで表示。GuitarDSL ドキュメント不要 |
| | `guitardsl.openInspector` (共通 Inspector を開く, Issue #133) | ✅ 実装済み・PR #138 マージ済み | Secondary Sidebar の単一 Webview View。アクティブな GuitarDSL 文書の URI / version のみを表示し、対象がなければローカライズした空状態。進行の一時試聴はInspector内AudioContext、Extension Hostの排他leaseはPreview停止ACK後に付与する。候補選択はソースを編集せず、確認済みApplyだけが1回のUndo可能な編集になる |
| | `guitardsl.newDocumentFromTemplate` / `guitardsl.openSample` (テンプレートから新規作成 / サンプルを開く) | ✅ 完了 | コマンドパレット、サイドバー。3 つのテンプレート・5 つの同梱サンプルから無題の編集可能なドキュメントを作成 |
| **サイドバー** | アクティビティバーの `guitardslSidebar` / Tree View `guitardsl.sidebar` | ✅ 完了 | アクティブなGuitarDSL文書のTarget行と5分類（Create、Open / Import、Edit Assist、Export、Help）。Current Fileの対象はアクティブ文書のみ。`onView:guitardsl.sidebar` で起動 |
| **設定** | `guitardsl.gemini.model`, `guitardsl.transcription.compressRepeats`, `guitardsl.expandPageBreakRepeats` | ✅ 完了 | 仕様 §3.7 と `package.json` の一致を `check:help` で検査 |
| **ヘルプ同期** | `docs/help/` → `media/help/`（`generate:help` / `check:help`） | ✅ 完了 | 仕様セクションの割り当てとダイジェスト、見出しごとの `help-sources` による本文の所有、コマンド・設定の仕様との一致、NLS、生成物の最新性を `npm test` で検査。コマンド・設定一覧は `package.json` から生成 |
| **ローカル音源採譜 (Audio MIR, 実験的)** | `wasm/crates/audio-mir/`, `src/audioMir/` | 🧪 実験的 | 4/4 のみ。テンプレート分類器によるコード推定（学習モデルは未導入。倍音の差し引き {3,5,6} と 7th ゲートで maj7/7 への偏りを抑制）、拍は学習済みモデル Beat This! small（ONNX を tract で推論、最大 2 Worker で並列。拍が得られなければ従来方式に切り替え）、ダウンビート、8/12/16 グリッドのストローク位置。既知の限界: 約 100 Hz 未満のベースは 8192 点 FFT の分解能を超える／ギター以外のドラム無し音源（ピアノ・ストリングス・パッド）では倍・半分テンポの選択を誤りやすい（#59）／5 分の曲の解析に約 45 秒・ピーク約 1.5 GB（M1）／ファンク・ジャズ等のテンションの多い和音のルート精度が低い／近接音程のうなりやキックの残響が偽アタックになりうる／ダウン・アップは位置からの推定／小節をまたぐサステイン・ゴースト・アルペジオは未対応 |
| **YouTube自動採譜** | `src/transcription/` (Music IR, Gemini, Serializer, URL) | 🧪 実験的 | 4/4 限定、構造検証・決定論的シリアライズ・DSL パース検証は実装済み。#45（PR #46）はハーモニー／グルーヴ／カポ処理を精緻化するが、実音の精度は未検証で非実験的な分類を支える根拠がない。生成結果は下書きとして要確認 |
| **コードダイアグラムエディタ** | Webview（プリセット、指板グリッド、指番号、セーハ、自動判定、保存） | ✅ 完了 | スコアの調弦・カポでプリセット照合と自動判定。Webview 内のクリック操作は自動テストの対象外（パネルが開くことと保存処理を E2E で確認） |
| **カポ推論・弾きやすさ** | `src/capo.ts`（汎用推論 API、弾きやすさ、ソースを保つカポ変換、有効 DSL） | ✅ 完了 | 純粋モジュール（VS Code・採譜に非依存）。候補 0〜12、スコアの調弦で各カポの形を解決。推奨は最高スコア・同点は小さいカポ。ラベル付きコード・定義との衝突は変換不可。採譜への組み込みは未実施 |
| **初心者モード** | `src/beginnerMode.ts`（カポ + 簡単なコードへの置き換え）、`src/previewBeginner.ts`、楽譜設定の `beginner` セクション | ✅ 完了 | スコアの調弦を原曲と変換後の評価に保持。バレーコード許可／使用しない（絶対条件）、置き換えは固定の規則のみ。評価する押さえ方は描画されるもの（`chord` 定義または既定の押さえ方）だけ。既定の押さえ方がセーハの長三和音／短三和音は `forbid` で `maj7` / `m7` へ置き換え、両方セーハ（例 `Bm`）はそのカポで不可 |
| **楽譜設定 (共通 Inspector)** | 共通 Inspector の Webview（カポ / 弾きやすさ・初心者モード・移調） | ✅ 完了 | 旧独立 Settings Panel はなく、設定セッションと候補モデルはホストが所有。候補比較・Cancel はソース不変。確認済み Apply は最新文書を再検証して 1 回の元に戻せる編集。主要な Inspector 操作は Webview E2E で検証 |
| **プレビュー画面** | Preview のカポ / 弾きやすさ一時設定 | ✅ 完了 | 48 px 再生行の直下に 44 px 楽譜設定行を常時表示し、カポを直接選択。ホスト解決済み有効 DSL を Preview と PDF で共有し、ソースは編集しない。詳細候補比較と Apply は共通 Inspector が担当 |
| | Beginner Mode の一時設定 | ✅ 完了 | Preview の 44 px 楽譜設定行から一時切替でき、ソースは編集しない。Preview と PDF は同じホスト解決済み有効 DSL を使い、詳細比較と DSL への Apply は共通 Inspector が担当 |
| | リアルタイム同期（テキスト編集追従） | ✅ 完了 | キーストロークによる変更を即座に再コンパイル |
| | アクティブエディタ追従 | ✅ 完了 | エディタタブ切り替え時にプレビュー対象を自動更新 |
| | 表示モード（1ページ / 見開き / Web） | ✅ 完了 | シート SVG の縦並び・横並び、連続 SVG |
| | 用紙設定（A4/A3/A5/B4/B5/Letter、縦 / 横見開き） | ✅ 完了 | 変更時に拡張機能ホスト側で再レイアウト |
| | Web Audio 再生（Play/Resume・Pause・Stop・シーク） | ✅ 完了 | `ParsedScore.playOrder` の順で再生。再生・一時停止・再開・停止・シークと Preview の再構築で音源を管理 |
| | カウントイン / メトロノーム | ✅ 完了 | 既定 OFF。カウントインは弱起でも最初の拍子を 1 小節再生し、メトロノームは拍子のビームグループに合わせる |
| | Practice Mode（速度・小節 / セクション / A-B ループ・追従） | ✅ 完了 | 速度 25〜200% を 5% 刻みで変更し、演奏順に沿ったループと音符・リズム符の位置に合う再生ヘッドを表示。Section は再生タイムラインで書かれた小節ごとの所属を解決し、複数小節と連続した反復を含める。DSL は変更しない |
| | コード進行アシスタント (共通 Inspector, Issue #134) | ✅ 完了 | 固定カタログと調・前後コード・メロディから最大5候補を順位付けし、CodeLens から共通 Inspector に4/8/16小節の操作と候補一覧を表示。候補 / A-B 選択は Decoration と既に開いている Preview の表示だけを更新し、ソース編集も自動再生もしない。試聴は Inspector 内の一時 AudioContext / scheduler で行い、Extension Host が Preview 停止 ACK 後に排他 lease を付与して同時再生を防ぐ。確認後の Apply は対象文書・候補を再検証して単一 WorkspaceEdit に適用し、1回の Undo で戻せる。Stop、Close、自然終了、文書切替時に試聴と lease を解放する |
| **PDFエクスポート** | ブラウザ不要の PDF 生成（`src/pdf.ts`） | ✅ 完了 | pdfkit + svg-to-pdfkit、同梱フォントのサブセット埋め込み。プレビューのカポ一時変更中は同じ有効 DSL を出力。macOS で確認済み、Windows / Linux は未検証 |
| **診断** | `DiagnosticCollection('guitardsl')` | ✅ 完了 | 調弦の弦数・音名・未知プリセット・重複・本文配置を含む問題を日英メッセージと位置付き診断で表示。メロディ・歌詞・長さ・拍数・表示設定、小節内の解釈できないトークン・`mel:` / `lyr:` の続きの行（エラー）、`\|:` のない `:\|`（警告）も検出 |
| **アウトライン** | `GuitarDslDocumentSymbolProvider` | ✅ 完了 | メタデータ詳細は `splitHeaderValue` で行末コメントを除去。セクション、小節コード要約と階層化 |
| **文法定義** | TextMate Grammar (`guitardsl.tmLanguage.json`) | ✅ 完了 | シンタックスハイライト |
| | Language Configuration | ✅ 完了 | コメント記号、括弧自動閉じ |
| **多言語対応 (i18n)** | ロケール解決・メッセージ辞書 (`src/i18n.ts`) | ✅ 完了 | `vscode.env.language` に基づく日本語/英語切り替え |
| | Webview ツールバー多言語化 (`src/render/previewHtml.ts`) | ✅ 完了 | transport と disclosure のラベル・アクセシブル名・ツールチップをローカライズ。幅 600 px では主要操作を表示し、さらに狭い幅では補助操作をスクロール |
| | コマンド・ダイアログ多言語化 (`package.nls*.json`) | ✅ 完了 | コマンドパレット・保存ダイアログ等の多言語化 |
| **AI 連携** | Skill `guitardsl-language` / 指示 `guitardsl.instructions.md`（`ai/`） | ✅ 完了 | 最小 VS Code 1.109.0。参照資料は `generate:ai` で構文仕様から生成し、`check:ai` で同期を検査。指示は `applyTo` とタスク関連性の `description` の 2 経路で選ばれ、Skill の `description` も新曲作成を含む。新曲作成の手順（構造の下書き → validate → analyze → 1 回の apply → validate、失敗時に手書きへ代用しない）と、対象の同一性（最初に別の新しい文書を作り、開いている既存スコアを出力先に再利用せず、すべての手順をその文書に固定する）を指示・Skill・伴奏ガイド・ツール説明に記載し、`check:ai` が順序と対象の固定を検査。Skill は補助資料（構文仕様・伴奏ガイド）を Markdown の相対リンクで参照し、新曲作成では既存スコアやサンプルを仕様の代わりに使わない（読み込めない場合は報告する）ことを Skill と指示に記載し、`check:ai` がリンクと代替禁止を検査。一般的な新曲作成の伴奏計画は最小限の意図（`subdivision: auto`、ユーザーが求めない任意制約を付けない、スコア全体の分析から 1 回の適用、エンジンが選ぶ、`finale` の余地、切替は例外・エンディング候補は 1＋代替 1 まで、失敗後の 1 回だけの緩和）とし、ガイド・指示・ツール説明に記載して `check:ai` が検査（エンジンは不変）。ユーザー実施の実モデル smoke で R051/R052 PASS。exact apply payload、既存ファイル hash、file-read log、resource-failure path は未検証 |
| | 伴奏エンジンと正規プリセットカタログ（`src/accompaniment.ts`、`src/strummingPatterns.ts`） | ✅ 完了 | 58 件のカタログ（メタデータの機械検査）、intent / preset / grid / dsl、物理的なダウン / アップ、シンコペーション判定、コード区間の提示（D3）、フレーズ末の変化・`arrangementGroup`・`adapt`、弱起の保持、`%`・インライン音高の安全性、セクション切替とエンディング（歌唱タイミング）。小節のリズム範囲（`rhythmSource`）だけを編集。実モデル smoke で候補数による阻害なし・ラスサビの強さを確認（R051/R052、詳細はテスト欄） |
| | 言語モデルツール 7 件（`src/ai/tools.ts`） | ✅ 完了 | validate / playability / カポ / 初心者モード / 移調 / 伴奏の分析 / 伴奏の適用。既存 API のアダプタのみ。変更系は対象を入力の `uri` / `path` で固定（確認メッセージの文書だけを編集。副作用のない `prepareInvocation`）・`documentBusy`・キャンセル。モデルは呼ばない |

---

### 1.3 Canonical Score Interchange IR (Issue #96)

| 機能 | ステータス | 備考 |
|---|:---:|---|
| GuitarDSL と `InterchangeScore` schema v1 の純粋な双方向変換 | ✅ 実装済み | `src/interchange/` は書かれた小節・イベント・正確な拍位置・メロディ・歌詞・独立したTAB・編曲指定を保持し、IR→DSL は再解析後の意味と演奏順を照合する。 |
| 構造化 loss report と IR 検証 | ✅ 実装済み | 4カテゴリの決定的な loss 集約とブロッキング規則、schema/range/reference/technique の検証を提供。具体的なGP/XML/MIDIアダプター、UI、損失を許可するポリシーは含まない。 |
| Guitar Pro 7/8 import/export (Issue #97) | ✅ 実装済み | `src/gp78/` はGPIF版検査、ZIP/XML上限、ID参照、6弦ギターの対応意味論、明示的な選択トラック、型付きloss policyを処理し、GP7互換出力を意味比較する。F01–F10の表現可能fixtureとC-01のSection＋DoubleBar出力はGP8.1.5で表示・再保存・再取込後も意味一致。MasterBarの未知要素は精密なpathでブロックし、既知XPropertiesは明示policyで報告する。F08 advanced-techniqueは契約どおりブロッキング`unsupported`。GP7 native app verificationは `NOT RUN / EXCLUDED`。PR #123指摘A-05/A-06/B-01/C-01を反映し、既存XMLノード上限、TABリンク解決O(P)時間・O(P)補助メモリ、20,000位置回帰を含む契約が承認済み（comment 6095998009）。A-07のビルド変更はIssue #125/PR #126へ分離し、#97から除外。ローカル最終ゲート（compile、npm test 1,058 unit＋57 E2E、Homebrew不使用prepublish、VSIX一覧、docs/help/AI同期）はPASS。current-HEAD self-reviewとPR delivery checkを進行中。 |
| Guitar Pro 7/8 chord-strum optimization (Issue #124) | 🟡 レビュー指摘対応・PR delivery中 | `src/gp78/chordStrum.ts` は全曲適格性、正確な拍長、単一候補コード照合、歌詞制限と決定的上限を検証し、全曲を一括変換する。TAB拍のない空小節・コードのみの小節は元IRを保ち、生成コード名は和声が変わる箇所だけに置く。ソース明示コードの反復は保持する。最適化出力のシリアライズ/再検証失敗では Faithful/Cancel を提示し、Faithful は読み込み済みIR/lossを再利用する。`npm test`（1,070 unit＋58 E2E）、Help/AI同期はPASS。F11の自己作成GP8.1.5最適化previewを再生成・目視確認済み、Issue #124 comment 6099402141へ添付済み。GP7 native app verificationは `NOT RUN / EXCLUDED`。 |

## 2. 検証・テスト状況 (Verification & Testing)

- **追加確認 (2026-10-12, HEAD `4861a4c`)**: GitHub の必須 `agent-required-check` は PASS。ローカルでは `npm run test:unit -- --timeout 10000` が 1,110 件 PASS、Help/AI同期・`npm run vscode:prepublish`・`npx @vscode/vsce ls` (1,594件)・Issue文書/契約検証も PASS。一方、標準 `npm test` は1回目がExtension Hostの `SIGABRT`、2回目は2秒上限のユニットテスト1件がtimeout。単独E2Eは74件PASS/1件FAILで、既存の「optimized serialization and postparse failures offer explicit faithful fallback or cancel」GPインポート検証が失敗した。別の過去実行では75件PASSしているが、今回のローカル再実行は成功扱いにしない。

### 2.1 単体テスト (Unit Tests)
- **フレームワーク**: Mocha + `tsx` (TypeScript直接実行)
- **テストファイル**:
  - `tests/unit/codeActions.test.ts`: CRLF と未変更箇所の保持、範囲検証、抽出・インライン化、移調・異名同音・表記正規化、音価変更、Hints と安全な未使用定義削除
  - `tests/unit/interchange.test.ts`, `tests/unit/interchangeLoss.test.ts`, `tests/unit/interchangeProvenance.test.ts`: 全サンプルの往復、Standard / Drop D・capo・TABとメロディの独立性、編曲・pickup・複合拍子・tuplets、パーサー由来の正確なコード拍位置、4種のloss、無効IRと意味比較の拒否
  - `tests/unit/gp78Archive.test.ts`, `tests/unit/gp78Import.test.ts`, `tests/unit/gp78Export.test.ts`, `tests/unit/gp78Loss.test.ts`: ZIP/XML安全制限、GP8 source fixture、参照ID、調弦/カポ、コードのみ、反復、writer自己往復/決定性、排他的保存、loss policy
  - `tests/unit/instrumentModel.test.ts`: 5 プリセット・明示6音・異名同音、入力と結果の不変性、弦と配列の順序、capo 相対/物理 fret 境界、正引き・逆引きの決定性と不正値
  - `tests/unit/compiler.test.ts`: メタデータパース（調弦の既定・各プリセット・明示値・コメント・重複・本文内・不正値と回復、診断 code/span）、小節・コード・リズム解析、改ページ、モジュール境界（描画 API を公開しないこと）、AI が生成しがちな誤り（続きの行・解釈できないトークン・`|:` のない `:|`）の診断
  - `tests/unit/duration.test.ts`: 共通音価表記・拍数・有理数計算
  - `tests/unit/melody.test.ts`: `mel:` / `lyr:` の解析と割り当て、コードの長さ指定、調号、表示設定、診断
  - `tests/unit/render-melody.test.ts`: メロディ段の高さ、符頭、調号・臨時記号、3連、リードシート、`measures_per_row` と改ページ
  - `tests/unit/tab.test.ts`, `tests/unit/render-tab.test.ts`: TAB ドメイン/Compiler、弦・フレット、効果、タイ、TAB 歌詞、TAB 段レイアウトとSVG描画
  - `tests/unit/tabTransform.test.ts`: TAB を含む文書でのカポ・移調・初心者モード変換ガード
  - `tests/unit/render.test.ts`: シート SVG / 連続 SVG / Webview HTML 生成、用紙設定反映、XML エスケープ、自動改ページ、横向き 2 ページ配置、ツールバー多言語レンダリング、再生データの安全な埋め込み、nonce CSP、再生 UI が SVG / PDF に含まれないこと
  - `tests/unit/playbackTimeline.test.ts`: Fraction 拍タイムライン、BPM / tempo primo / feel、pickup / 連符、repeat / volta / navigation、`%` 小節と `mel:` 行の反復、音符・休符・コード攻撃、境界切り詰め、拍子クリック、位置変換、入力エラー
  - `tests/unit/playbackSynth.test.ts`: C4 = MIDI 60、コード + capo の実音不変、メロディの capo 非適用、非対応コードの無音
  - `tests/unit/pdf.test.ts`: PDF 生成（ページ数、フォント埋め込み、書き出し、フォント欠落時の失敗）
  - `tests/unit/i18n.test.ts`: ロケール解決関数（`resolveLocale`）、メッセージ辞書整合性、新しい調弦診断を含む診断メッセージ（日英）
  - `tests/unit/symbols.test.ts`: 小節要約フォーマッタ（`formatMeasureSummary`）の各種パターン
  - `tests/unit/chordVoicingResolver.test.ts`: 共有リゾルバの優先順位（ラベル付き定義・ラベルなし定義・専用分数コード形・同じ調弦の上部コード fallback・不明）と変則調弦の厳密なコード名照合
  - `tests/unit/chord.test.ts`: `chord` 定義の解析・整形、最終カポでの妥当性と first-valid duplicate 解決、`@ラベル` 参照と診断、ダイアグラムの解決と描画、コード名の自動判定、Standard プリセットのカポ非依存性、Drop D/Open G の音高照合と標準形排除、明示定義/描画専用 fallback、調弦・カポ対応エディタ
  - `tests/unit/capo.test.ts`: 汎用推論（0〜12 の候補、出現回数の重み、同点時の小さいカポ、不正カポの拒否）、調弦を保つ候補評価、移調と `NOTE_NAMES` の綴り、弾きやすさの計算式と段階の境界、ソース変換（カポ差分、ヘッダー挿入、カポ 0、既存 `tuning:` と `capo:` の行末コメント保持、CRLF・調弦・コメント・メロディ・歌詞・繰り返しのバイト保持、長さ指定の保持、ラベル付きコード・定義衝突の拒否、再解析）、有効 DSL のドリフトなし、DSL 上の候補（適用できないカポを変更不可にし推奨しない）、カポバーの描画、コードトークンとヘッダーのソース位置（歌詞が前にある同名コード）
  - `tests/unit/audioMirEvaluator.test.ts`: 評価スクリプトの Harte 表記の語彙縮約、時間加重の各一致率、GuitarSet JAMS（演奏側コード・テンポ）の読み取り、テンポ Acc1/Acc2
  - `tests/unit/audioMir.test.ts`: `AudioMirResultV1` の実行時検証（版・tick・スロット重複・非有限値・コード名/キー名）、アダプタ（1 セクション、コード/リズム 8・12・16 グリッドの各小節ちょうど 4 拍、先頭休符・`r1`・3 連、方向の決定的割り当て、strict 検証をそのまま通過、再パースでエラー 0）、Worker プロトコル（1 回だけ確定・遅延メッセージ無視）、推論プール（並列数の上限、完了順に依存しない集約、キャンセルで全 Worker 終了、推論 Worker の失敗・不正メッセージ）、`tempo.tracker` の検証、コントローラ（多重起動防止、キャンセル、失敗後の再実行、非 file URI、失敗時にドキュメントを作らない、dispose）
  - `tests/unit/beginnerMode.test.ts`: バレーコードの絶対条件（`F → Fmaj7`、全カポでセーハなし）、Standard と Open G での調弦を保つ評価・解なし、カポ 0〜12 の決定的な推奨、通常のカポ推論が変わらないこと、置き換え規則の範囲（ルート・長短の性質を変えない、sus/dim/aug を変えない）、分数コードのベース省略とペナルティ、定義との衝突・保持・未使用警告、ラベル付きコード、ソースのバイト保持（CRLF・調弦・コメント・長さ・メロディ・歌詞）、再解析、積み重ならないこと、カポバーの描画と JA/EN 文言
  - `tests/unit/transcription.test.ts`: Music IR v1 バリデーション（4/4拍子、BPM、キー、カポ、コード・リズム・メロディ各小節4拍検証、歌詞・音節）、決定論的シリアライザ（DSL構文適合、ゼロエラー診断、カポ出力、`%` 小節リピート活用、`mel:` / `lyr:` 音節歌詞出力、伴奏プリセットの未知 ID・拍子不一致の拒否）、採譜パネルが 4/4 のプリセットだけをファミリー別に出すこと、YouTube URL形式検証、モック化されたGeminiアダプタ（認証エラー秘匿、非JSON防御）
  - `tests/unit/scoreEvents.test.ts`: 拍子の解析・既定のグループ・小節の長さ・連桁のまとまり（`3/8` と `3/8(1+1+1)` も拍のグループどおり）、イベント値の正規化、コンテキストの持続と `tempo primo`、イベントの順序・孤立イベント・不正イベントからの回復、拍子ごとの長さ検証、弱起と補完、`%` の拍子境界、フィールで拍数が変わらないこと
  - `tests/unit/transpose.test.ts`: 実音移調（固定カポ・指定カポ・推奨カポ・コードなし）、転調を含む楽譜、オクターブ境界と範囲外、ソースのバイト保持（CRLF・コメント・空白・歌詞・奏法）、ラベル付きコード・定義衝突、オッターヴァとの関係
  - `tests/unit/render-advanced.test.ts`: 構造的な段区切り、全段で揃う第1小節線、転調（打ち消し・臨時記号のリセット・リズムのみの段の `Key:`）、拍子記号、注記欄と改ページ、注記欄を五線に近づける配置（コード名の上の空きへの重ね、強弱記号を一番下の五線・歌詞・低い音のすぐ下に置く）、メロディのある段の見出し（コード名・セクション名等）を五線へ下げる量と、描画された SVG で測ったメロディ譜表のインクとの間隔（記号の種類ごと、複合音価、段をまたぐ H/P・スラー、各サンプル）、同じ小節前の複数強弱記号が重ならないこと、XML エスケープ、オッターヴァ、奏法記号（高音でもベンドの矢印が上向き、装飾音は休符を飛ばして次の音符の左）、連符、従来の楽譜の描画が変わらないこと（リズムのみのサンプルは `origin/main@62fec74`、メロディのあるサンプルは Issue #70 で目視確認した描画とのハッシュ一致）
  - `tests/unit/grammar.test.ts`: `tuning:` を含むヘッダー・スコアイベント・連符・奏法の TextMate 規則、`let` 宣言・`$name` 参照・同時複数音（`[Intro]` はセクションのまま）
  - `tests/unit/letFragments.test.ts`: `let` の前方参照・入れ子・複製・使える位置の推論・重複・未定義・循環・`%` の禁止・継承の独立・行末コメント・コードセルとのまとめ・定義の境界、同時複数音の解析・検証・奏法・連符と複合音価・歌詞・装飾音・接続とタイの拒否、定義の音高のソース位置、サンプル
  - `tests/unit/render-noteGroups.test.ts`: 同時複数音の符頭・共有の符幹・2度のずらし・臨時記号の列・加線・タイ・奏法の位置、レイアウトのインク（見出しの持ち上げ・歌詞・強弱・注記欄）、`let` を使った楽譜と展開済みの楽譜の描画の一致、小節内の下向きの同時複数音（連桁に加えない）と臨時記号の規則
  - `tests/unit/helpSync.test.ts`: ヘルプ同期（仕様セクションの抽出・割り当て・ダイジェスト、追加・削除・英字付き番号、見出しの `help-sources` による本文の所有（削除された機能の孤児の本文の検出）、壊れた manifest の診断、コマンド・設定と仕様の一致、NLS、決定論的な生成と生成物の最新性、`let`・同時複数音の網羅、再生・Web プレーヤーの見出しがないこと）
  - `tests/unit/help.test.ts`: ヘルプの例の構文検証、ツールバーのヘルプボタン（ローカライズ・`openHelp` の送信・楽譜 SVG に含まれない）、ロケール別のファイル選択、ヘルプを開けないときのエラー表示
  - `tests/unit/sidebar.test.ts`: サイドバーのセクション順・展開状態・項目とコマンド、Current File（案内のみ／アクティブな URI を渡す 6 項目）、`refresh()`、`package.json` の貢献とアイコン
  - `tests/unit/aiAssets.test.ts`: AI 連携の manifest（最小 VS Code、7 ツール・参照名・起動イベント・入力スキーマ・スクリプト）、`check:ai`（参照資料の 1 バイト変更・Skill 名・貢献パス・ツールのずれ・除外識別子・伴奏ツールの参照・伴奏コードの除外 import）、Skill・伴奏ガイド・指示の内容、新曲作成の発見用メタデータと validate → analyze → apply → validate の順序（説明の削除・意味の除去・節の削除・順序の入れ替え・手順の欠落・ツール説明からの削除で失敗すること）、新曲の対象の同一性（別の新しい文書・既存文書を再利用しない・同じ対象への固定・Skill の現在のファイル向けの解決の限定・3 ツールの説明のいずれを消しても失敗すること）、Skill の補助資料リンク（コードスパンへの戻し・`./` なし・誤ったリンク先で失敗）と代替禁止の文言、最小限の意図の方針（ガイド・指示・分析 / 適用ツールの説明の各文言）、`.vscodeignore` が `ai/**` を同梱すること
  - `tests/unit/strummingPatterns.test.ts`: 正規カタログ 58 件（ID・宣言順・契約の表とメタデータの一致・重複なし・分類例）、全パターンの構文と拍数、自己検査（誤ったメタデータの検出を含む）、8 分 / 16 分 / 3 連 / 複合拍子の往復、オールダウンは `authored` だけ、シンコペーションの判定、アルペジオ記法の解析と描画
  - `tests/unit/accompaniment.test.ts`: セクション番号、入力検証、`intent` の必須条件・重み・同点・`preferredPresetId`・難易度・選択理由、コード区間の提示（D3。ゴースト・レゲエ）、`grid`（最も粗い往復・加算音価・拍子ごとのスロット）、`dsl`（`physical` / `literal`・拍数・小節線をまたぐタイ）、ソースを保つ編集（1 行複数小節・リズム省略・CRLF・`%`・インライン音高・拍子とフィールの混在・弱起）、フレーズ末の変化・`arrangementGroup`・`adapt`、分析の結果
  - `tests/unit/accompanimentArrangement.test.ts`: セクション切替の文脈（`exact` / `measureOnly` / `none`、複数番の歌詞、タイ）、候補の順序と不採用理由、歌唱中・コード区間・タイミング不明での拒否、エンディング（`hold` / `finalHit` / `fillToHold` / `breakThenHit` / `rolledFinal`・フェルマータ）、優先順位、`@tempo` を挿入しないこと
  - `tests/unit/aiTools.test.ts`: ツール入力の実行時検証（範囲・`explicit` の `capo`・絶対パス）、変更ガード、変更系の対象指定（`uri` / 絶対 `path` のちょうど 1 つ）、日英の確認文言、モデル呼び出し・変換処理を持たないこと
  - `tests/unit/documentResolver.test.ts`: 移動したドキュメント解決の順序（明示 URI、アクティブ、表示中、最後のドキュメント、開いているドキュメント、なし）
  - `tests/unit/onboarding.test.ts`: テンプレート・サンプルのクイックピックと無題ドキュメントの作成、キャンセル、失敗時のエラー、テンプレートの構文検証とサンプルからの抜粋、`.vscodeignore` による 5 サンプルの同梱
  - `tests/unit/progressionSuggestions.test.ts`, `tests/unit/progressionSourceEdits.test.ts`, `tests/unit/progressionAudition.test.ts`: 固定メジャー / マイナーカタログ、調・メロディ・カポを使った順位付け、同値 `@key` 境界と曖昧な和声の拒否、ソース範囲保持、A/B の譜面表示と音声切替、明示操作までの無再生、反復時の全曲試聴制限
  - `tests/unit/inspectorController.test.ts`, `tests/unit/inspectorHtml.test.ts`, `tests/unit/inspectorManifest.test.ts`: アクティブ文書の URI / version、空状態、明示表示、冪等性、generation による古い更新の拒否、CSP・ローカライズ・読み取り専用コンテキスト、manifest の単一 Secondary Sidebar View
  - `tests/e2e/extension.test.ts`: 遅延したS1のPreview初期化完了後も、同じURI/versionの新しいS2の候補表示・セッションを保持し、古い要求の再描画・自動再生を抑止
- **テスト実行結果**: **1122 / 1122 件 PASS** (0 failures、2026-10-12)

### 2.2 E2Eテスト (Integration / E2E Tests)
- **フレームワーク**: `@vscode/test-electron`
- **テストファイル**: `tests/e2e/extension.test.ts`
- **検証項目**:
  - 拡張機能のアクティベーション確認
  - `guitardsl.showPreview`, `guitardsl.exportPdf`, `guitardsl.importGuitarPro`, `guitardsl.exportGuitarPro`, `guitardsl.editChordDiagram`, `guitardsl.editScoreSettings`, `guitardsl.editCapo`, `guitardsl.transcribeYouTube`, `guitardsl.transcribeAudio`, `guitardsl.setGeminiApiKey`, `guitardsl.clearGeminiApiKey`, `guitardsl.applyStrummingPattern`, `guitardsl.suggestChordProgression`, `guitardsl.openHelp`, `guitardsl.openInspector`, `guitardsl.newDocumentFromTemplate`, `guitardsl.openSample` コマンドの登録確認
  - サイドバー: ビュー `guitardsl.sidebar` にフォーカスできること
  - Issue #133 Inspector: 単一の Secondary Sidebar Webview View、コマンドによる明示表示、再実行の冪等性、GuitarDSL 以外がアクティブな場合の空状態、編集も他の開いているファイルへのフォールバックも起きないこと
  - Issue #134 progression Inspector: CodeLens 起点の既定4小節・末尾追加、4/8/16小節と置換/追加の再計算、候補選択と Preview A/B、未確認候補/連続適用/`applyEdit=false` のソース不変、Apply 後の1回 Undo、古い Inspector message の拒否、選択時に再生しないこと
  - ヘルプ: GuitarDSL ドキュメントなしで `guitardsl.openHelp` が完了し、テキストドキュメントを変更しないこと
  - ドキュメントシンボル
  - 音楽対応 Code Actions (Issue #87): 無題 URI の選択から抽出し、定義挿入と参照置換を 1 回の元に戻すで復元
  - メロディ行の診断の発行と修正時のクリア
  - 調弦 (Issue #84): 不正 pitch の診断範囲が入力 token と一致し、修正時に消えること。Drop D + capo の Preview/PDF が同じ有効 DSL で描画され、調弦・key・melody を保持すること
  - `chord` 行の CodeLens、コマンドでエディタパネルが開くこと、エディタの保存（挿入・置換・重複・不正）
  - Issue #129: chord cell の補完が最大5件かつコード prefix だけを置換し、`F#` / `C#` と `F#` 後の空白位置を有効セルとして扱い、実コメントでは候補を出さないこと。候補プレビューでは元文書が不変で、A/B切替時は選択側の DSL から譜面と音声を再描画し、同じ文書へ戻ったとき assistant Preview を保つ。対象調変更直後の空セルでは対象調を使う。未変更同一文書のS1→S2で遅延したS1のdismiss/A-B/速度メッセージはS2の候補・側・速度・active stateを変えず、遅延したS1のPreview初期化完了後もS2のHTMLを上書きせず自動再生しない。確認キャンセル・古い候補・連続適用・`applyEdit=false` は原文を書き換えず、有効候補は一括適用後 Undo 1 回で原文に戻ること
  - カポ: `guitardsl.editCapo` / `guitardsl.editScoreSettings` の登録、エディタを開いても文書が変わらないこと、適用が最新テキストから再計算されること、1 回の元に戻すで戻ること、プレビューの一時変更（文書不変・ドリフトなし・編集への追従・変換不可での解除）、プレビュー入力と PDF 入力の完全一致、`guitardsl.exportPdf` が一時変更を反映すること、一時変更なしでは `doc.getText()` そのもの、切り替え・プレビューを閉じたときの解除
  - 移調（Issue #68）: 最新テキストからの再計算、移調 + カポ指定の 1 回の編集と 1 回の元に戻す、失敗時は不変、楽譜設定のカポ・初心者モード・移調の 3 セクション、適用後のプレビュー・PDF の再解決（初心者モード有効時を含む）、スコアイベントのアウトライン、高度な記譜のサンプルの PDF 出力
  - 初心者モード: ON で `forbid`・自動・カポ一時変更の解除、プレビュー入力と PDF 入力の一致、OFF でソース表示（カポ一時変更は戻さない）、ON/OFF の繰り返しでドリフトなし、固定カポ・バレーコード変更で自動へ、編集への追従と解なしでの解除（古い PDF なし）、切り替え・ドキュメントを閉じる・プレビューを閉じるでの解除、適用（最新テキスト・1 回の編集・1 回の元に戻す・失敗時は不変）、楽譜設定 `beginner` セクションのモデルと適用
  - 伴奏（Issue #101）: `vscode.lm.invokeTool` による伴奏の分析（構造・ファミリー別）、複数セクションの適用が 1 回の編集と 1 回の元に戻す・事後検証、失敗時は不変（1 計画の失敗で全体を拒否）、入力が示す文書だけを編集、`documentBusy`・キャンセル、手動クイックピック（拍子のカテゴリ・用途グループの区切り・58 件の一覧を出さない）、同名セクションの CodeLens が自分のセクションだけを対象にし、古い識別情報では何も変更しないこと
  - 新曲作成（Issue #104）: 伴奏のリズムを書かない構造の下書き（2 セクション、コード・メロディ・歌詞）が検証を通り、分析がセクションを返し、複数セクションの適用が 1 回の編集で伴奏を生成し、最後の検証がエラー 0 件で、1 回の元に戻すで下書きに戻ること（対象が確立済みの状態から始めるツールの動作確認で、Agent の対象選択は検証しない）。既存スコアをアクティブに開いたまま、別の新しい文書を `path` で検証・分析・適用・検証すると、新しい文書だけが編集され、既存スコアはバイト単位で変わらないこと
  - 実モデル smoke（ユーザー実施、2026-09-27）: PR #105 head `362cda23c27d66dbd26a09ae5f67ee5c6965f67a` の build で Skill resources が解決され、別の新規文書で伴奏適用まで完了。候補数で停止せず、サビ1/2に変化がありラスサビが最も強かったため R051/R052 PASS（[Issue evidence](https://github.com/puchinya/vscode-guitar-dsl/issues/104#issuecomment-5856512394)）。VS Code version/model は未記録。apply 入力 JSON は未記録で R041/R042/R046/R047 は未検証、R043 の引数も未記録、R048 は strict PASS としない。R030 は既存ファイルの hash 未取得、R039 はファイル読取ログなし、R040 は failure path 未実行。
  - AI 連携（Issue #80）: モデルなしでの起動と 7 ツールの登録、`vscode.lm.invokeTool` による検証（1 始まりの位置）と弾きやすさ（`inferCapoForDsl` と一致）、読み取り専用ツールと確認作成で文書が変わらないこと、カポ・初心者モード・移調のアダプタ（既存の適用結果と一致・1 回の編集・事後検証・失敗時は不変）、`documentBusy` とガードの解放（成功・失敗・例外）、キャンセル、最新ソースからの再計算、入力が示す文書だけを編集すること（確認後にアクティブなエディタが変わっても対象は変わらない。対象なし・両方指定は `invalidInput`。未知の無題 URI で文書を作らない）、確認メッセージが入力だけから作られること、読み取り専用ツールの `document.uri` を `vscode.lm.invokeTool` 経由で変更系ツールに渡して無題ドキュメントを編集できること
- **テスト実行結果**: **77 / 77 件 PASS**（2026-10-12、VS Code 1.141.0 darwin-arm64 のテストビルド。最小バージョン 1.109.0 と Windows/Linux では未実行）

### 2.2A Audio MIR (Rust/WASM)
- **Issue #54 v2 検証 (2026-10-11, macOS arm64)**:
  - T01–T07 focused tests: **12 / 12 PASS**。T06 の合成クリックは BPM 120.318563、score 0.992497784、最強の独立候補は 137.8125 BPM / score 0.6045682128、confidence 0.390861902。近接候補 119.655285 BPM は near-1× 等価として除外され、BPM 許容差と ±50 ms のクリック整列も PASS。
  - `cargo test --manifest-path wasm/Cargo.toml classic_tracker`: **1 / 1 PASS**。#52 の履歴 JSON は現在値から `tempo.tracker`、現在値と期待値から `tempo.confidence` のみを除外して厳密比較した。履歴 fixture は変更していない。
  - Rust/WASM gates: `cargo fmt --check`、全 Rust tests **78 / 78 PASS**、`cargo clippy --all-targets -- -D warnings`、`cd wasm && cargo check --target wasm32-unknown-unknown`（SIMD 設定適用）が PASS。
  - Audio MIR build と smoke: `npm run build:audio-mir` PASS、`npm run test:audio-mir-wasm` **7 / 7 PASS**。
  - Extension gates: `npm run compile`、Help / AI sync、`npm test` が PASS。Unit **1083 件**、E2E **65 件**。PATH に rustup を指定した `npm run vscode:prepublish` も PASS。
  - `npx @vscode/vsce ls`: **1590 項目**。生成 NodeJS WASM core と両 worker を含み、Rust source と Audio MIR fixture は含まない。
  - 合成 pulse set（seed 2、60 曲）評価: Classic Acc1 **66.7%**、Acc2 **93.3%**、median absolute error **0.11 BPM**、beat F **0.706**。同じ 60 曲を baseline `7069acccc212d61ce3e6a344ecfc21c2413a44a0` でも評価し、曲別 Classic / Neural BPM **60 / 60 一致**、aggregate metrics も同一で tempo selection regression なし。
  - `validate-docs --issue 54` と configured `verify_final` hook（4 command groups）、`git diff --check` が PASS。
  - GuitarSet は一般的なローカル保管先に見つからず **NOT RUN / unavailable**。Issue #54 の契約ポインターは 2026-10-12 に正規形へ修正し、`verify-implementation-contract` でコメント ID `6108533964` と SHA-256 を照合済み。self-review と delivery gate を継続。
- **Issue #54 基準コミット `7069acccc212d61ce3e6a344ecfc21c2413a44a0` の Rust 単体テスト (`cargo test --manifest-path wasm/Cargo.toml`)**: **72 / 72 件 PASS**。次を含む:
  - Beat This!（#56）: log-mel が torchaudio と一致（22,050 Hz。44.1/48 kHz は soxr 基準で通過帯域 ≤ 0.02）、ロジットが PyTorch と一致（≤ 1e-3、リサンプル経路 ≤ 0.02 で拍は同一）、upstream と同じチャンク化・集約・ピーク検出、段階的 API と `analyze_wav` の JSON 一致（複数チャンク含む）、ドラム無しストローク 90/150 BPM、`Classic` が #52 の出力と一致、拍が得られない場合の `Classic` への切り替え
  - 倍音の多い明るい音色で、D/Dmaj7・F#/F#maj7・A/Amaj7 について「#50 は誤認し、新設定は正しい」ことと、本物の 7th（A7 含む）を保持することをペアごとに確認
  - `BASELINE` が #50 のクロマ計算と厳密に一致すること。生成した合成音のみを使用し、次の項目を確認している。
  - WAV 形式の受理と拒否
  - STFT、HPSS、クロマ
  - 全コード品質の判別（D/Dmaj7、F#/F#sus4、C#m/C#7、C/Cm、Am/Am7）
  - 1 スロットのフリッカー抑制と、2 スロット以上の変化の保持
  - テンポ 120 / 186（半分テンポに落ちない）/ 72（倍テンポに上がらない）
  - ダウンビートと 8/12/16 グリッド
  - エンドツーエンド（`| Dmaj7 | C#m7 | F#sus4 F#m |`）と決定性
- **`cargo fmt --check` / `cargo clippy -D warnings` / `cargo check --target wasm32-unknown-unknown`**: いずれもエラー 0 件
- **WASM スモークテスト (`npm run test:audio-mir-wasm`)**: **7 / 7 件 PASS**。Node ターゲットの WASM を実際に読み込み、TypeScript 側の検証とアダプタでエラーが 0 件になること、段階的 API が `analyze_wav` と同じ JSON を返すこと、および各エラーコードを確認している。14.7 秒の音源の単一インスタンス解析は約 5〜8 秒（モデルの読み込み約 2.5 秒を含む、macOS arm64）。
- **5 分の音源の所要時間（`scripts/benchmark-audio-mir-job.mjs`、推論 2 Worker、Apple M1）**: 約 45 秒、ピーク RSS 約 1.5 GB（計測時は他の負荷あり）。
- **検証済みの環境**: macOS (arm64) のみ。Windows / Linux / リモート / Web は未検証。
- **コード精度の評価（#52）**: データはローカル専用でコミットしない。手順は testing.md §5。報告用データでの #50 ベースライン比は次のとおり。
  - GuitarSet 伴奏（演奏者 03〜05、90 曲）: ルート 48.2% → 51.0%、完全一致 30.4% → 41.3%
  - GM 合成マルチ楽器セット（36 曲、半数はベース・ドラム無し）: ルート 85.0% → 86.6%、完全一致 74.2% → 83.9%。楽器別ではルートの低下が最大 0.4 ポイント（エレピ）、完全一致は全楽器で改善
- **テンポ・拍の評価（#56、`examples/eval_beats`、#52 比）**:
  - pulse セット（学習外・ドラム無し・毎拍発音、60 曲）のギター: Acc1 90%、Acc2 100%、誤差中央値 0.18 BPM、ビート F 0.971。全 6 楽器: Acc1 66.7%（#52 と同じ）、Acc2 93.3 → 96.7%、ビート F 0.706 → 0.730
  - 既存の合成セット: バンドあり Acc1 97.2 → 100%。バンド無し Acc2 86.1 → 97.2%、ビート F 0.44 → 0.58
  - GuitarSet 伴奏（演奏者 03〜05、Beat This! の学習データに含まれるため参考値）: Acc1 23.3 → 85.6%、ビート F 0.46 → 0.92
  - コードの一致率（#52 比）: 合成セットのルート 85.2 → 88.1%、完全一致 82.6 → 85.2%。GuitarSet のルート 51.0 → 51.6%、完全一致 41.3 → 41.7%。バンド無しのコード変化 F1 は 79.8 → 71.4% に低下（#61）

### 2.2B Web Audio 再生 (Issue #90)
- **手動 GUI smoke**: macOS arm64 / VS Code 1.139.1 Extension Development Host で Play・Pause・Resume・Stop・シーク、Count-in 後の進行、Resume で Count-in が再実行されないこと、再生中の Metronome 切替、ソース編集後に停止して再構築後は先頭になることを確認。Windows / Linux は未検証。

### 2.2C Practice Mode (Issue #93)
- **自動検証**: `npm test` で unit 981 件、E2E 56 件 PASS。Help 同期、AI 資産同期を含む。`npm run compile` と `npm run vscode:prepublish` も PASS。
- **手動 GUI smoke**: macOS arm64 / VS Code 1.141.0 の日本語 Extension Development Host で、Practice OFF/ON、再生中の 75% 速度、小節ループ、譜面ハイライトと再生位置追従を確認。Pause後にSingle PageからWebへ切り替え、再生位置と停止状態を保ったままハイライトと再生位置表示が即時に移動することも確認。Preview 幅約 365 CSS px で操作列を横スクロールした画面証拠は Issue #93 時点の UI であり、Issue #136 の disclosure 配置を検証するものではない。Windows / Linux は未検証。
- **画面証拠**: [Practice OFF の再生](evidence/issue-93/practice-off-playing.png)、[速度 75% と小節ループ](evidence/issue-93/practice-loop-playing.png)、[狭幅でスクロールした操作列](evidence/issue-93/narrow-scroll.png)、[Pause後のSingle→Web切替](evidence/issue-93/pause-single-web.png)。

### 2.3 静的解析・型チェック
- **TypeScriptコンパイル (`npm run compile`)**: エラー 0 件 (strict mode 準拠)
- **Issue #87 最終検証 (2026-10-11, macOS arm64)**: `verify_final` PASS。`npm run compile`、`npm test`（unit 1080 件 + E2E 60 件、Help/AI 同期を含む）、`npm run vscode:prepublish`、`npx @vscode/vsce ls` はすべて終了コード 0。E2E は VS Code 1.141.0。Windows / Linux は未検証。
- **Issue #96 検証 (2026-10-08, macOS arm64)**: `npm ci`、`npm run compile`、`npm run test:unit` (999 件)、`env -u ELECTRON_RUN_AS_NODE -u NODE_OPTIONS npm test` (999 unit + 56 E2E)、`npm run check:help`、`npm run check:ai`、`PATH="$HOME/.cargo/bin:$PATH" npm run vscode:prepublish`、`npx @vscode/vsce ls`、`git diff --check` は PASS。通常権限での Electron 起動は `SIGABRT` で Mocha 前に終了し、sandbox 外の再実行で E2E は PASS。Windows / Linux は未検証。

---

## 3. サンプルスコア整備状況 (Samples)

`samples/` ディレクトリ配下に動作確認用・デモ用の各種スコアを完備:
- `sample.guitardsl`: 1小節2コード、小節反復、拍数指定のコードチェンジ、改ページ
- `sample_8beat.guitardsl`: 8ビートストロークと小節反復
- `sample_16beat.guitardsl`: 16ビートストロークとアクセント・シンコペーション
- `sample_melody.guitardsl`: メロディ行・音符単位の歌詞（2番まで）・従来の小節歌詞との混在・3連・音価指定
- `sample_leadsheet.guitardsl`: 調号（D メジャー）・メロディの3連・リードシートモード・1段2小節
- `sample_notes.guitardsl`: 音符・リズム記号の一覧（全音符〜16分音符、付点、加算、3連、全種類の休符、タイ、臨時記号、加線、アクセント・ゴースト、`%`、コードの長さ `:` / `/`）
- `sample_voicings.guitardsl`: コード定義と `@ラベル` 参照（開始フレット、セーハ、指番号、2 桁フレット、プリセットからの既定の押さえ方）
- `sample_voicing_song.guitardsl`: 押さえ方を使い分けるサンプル曲（Aメロはローポジション、サビはハイポジション。メロディ・歌詞付き）
- `sample_variables.guitardsl`: `let` フラグメント（リズムの再利用、`mel:` での音符のみのフラグメント、リズムと音符の混在、入れ子の参照）と同時複数音
- `sample_advanced_notation.guitardsl`: スコアイベントと高度な記譜（弱起、テンポ変更・rit./accel./a tempo/tempo primo、転調、拍子の変更 6/8・7/8、swing/shuffle、リハーサルマーク、テキスト、強弱、8va、5連符、装飾音符、ハンマリング・プリング・スライド・チョーキング・ビブラート、スタッカート・テヌート・フェルマータ・ブレス、パームミュート・レットリング、アルペジアート、スラー）
- `sample_rhythm_tie_syncopation.guitardsl`: 4/4・120 BPM の小節またぎシンコペーション、ストローク方向、1回の攻撃音と2小節目の再アタック位置
- `sample_akaneiro_platform.guitardsl`: オリジナルJ-POP曲。分数コードのカスタムフォーム、再利用リズム、16分音符とシンコペーション、メロディ・歌詞を収録
- `sample_gozen0jino_page.guitardsl`: 128小節のオリジナル曲。F・Fm・Bm7のバレーコード、タイ付きストローク、シンコペーションを収録

---

## 4. 今後の拡張ロードマップ (Roadmap / Future Work)

- [ ] **プレビューからエディタへの逆引きジャンプ (Source Mapping)**: プレビュー上の小節をクリックした際に、エディタ側の該当行へカーソルを同期移動する機能。
- [ ] **変則チューニング・7 弦のコードダイアグラム**: `chord` 定義と自動判定は 6 弦の標準チューニングのみ対応。
- [ ] **採譜での高度な記譜の推定**: YouTube 採譜・Audio MIR は転調・テンポ変化・拍子・奏法・強弱を推定しない（従来の範囲の DSL を出力する）。
- [ ] **Guitar Pro 8 TAB 意味論の拡張**: 声部2〜4、長い音価、複雑な連符、部分カポ、追加奏法を既存の共有モデル階層へ追加する。
