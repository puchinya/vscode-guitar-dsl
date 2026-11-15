# Implementation Contract — Issue #172 / PR #173: Web Compact IDE 完全統合版（2026-11-15）

**適用順位:** この単一契約はIssue #172本文の従来契約・個別追補と、PR #173でこれまで決めたUI案を整理・統合して上書きする。旧SVGで共有Preview内部を描き直した図、古いPROJECT表記、ウィンドウメニュー、旧Driveスコープ禁止などは新しい明示決定に従う。以前のcontract approval comment `6876057443` は旧版の証拠であり、最新契約の検収印として扱わない。リポジトリのbinding/approval手順で新契約へ更新する。

> This document is an Implementation Contract. Do not redesign the architecture during implementation. If a requirement conflicts with repository reality or requires a material design change, do not silently choose an alternative. Report the exact conflict and continue only with independent valid work.

## 1. Repository Baseline
- Repo `puchinya/vscode-guitar-dsl`、対象は既存PR **#173**（`Closes #172`）。確認時HEAD `624c2766d29e595a8c0e248a4cd591c54d79faec`。開始時mainとPR HEADを再取得。別Issue **#168** のGoogle認証セッション競合修正は独立しており、今回の新処理は同じ不変条件に従う。
- 規範資料: `docs/specs/web-app.md` §2/§5/§7–9、`docs/specs/gui_design.md`、`docs/design/web-app.md`（Web composition / document ownership / Drive transfer/session）、`docs/status/implementation-status.md`、`AGENTS.md`、`docs/agents/testing.md`、`.agent/project.json`。
- 既存Web実装: `web/src/main.ts`（3列/底部Problems、タブ、メニュー、Drive、Inspector）、`web/src/style.css`、`web/src/icons.ts`、`web/src/editor/sourceEditor.ts`（CodeMirror 6、行番号、検索、置換、補完、lint、タブ別Undo）、`web/src/explorer/explorerController.ts`、`web/src/tabs/documentTabs.ts`、`web/src/auth/googleOAuth.ts`、`web/src/storage/{googleDrive,indexedDb}.ts`。
- 既存機能を維持: 4 splitter、Source/Split/Score表示、Problemsを下部に置くこと、Local/Driveルート併存、共有compiler診断、IndexedDBドラフト、既存 fileIdへのDrive通常保存 `files.update` (media PATCH) とreadback、`files.list` の `trashed=false`。通常保存を `files.create` に変更しない。

## 2. Architecture Decisions — Web Shell & Icon Rules
- JetBrains **New UI Compact風**。デスクトップ1600×900基準。ヘッダー40px、左Activity Bar40px、Explorer初期220px (180–420px)、左右splitter6px、右Inspector初期300px (260–480px)、右Tool Window Bar36px、タブ36px、ソース:譜面=40:60 (min 240/320px)、下部Problems200px (140px–45vh) と上部splitter6px、ステータス24px。4本すべてドラッグ/キーボード操作、各幅高/開閉/表示比をIndexedDBに保存。狭幅自動折畳みは利用者の明示状態を上書きしない。
- Web shellのみ修正。`packages/ui/src/previewHtml.ts` の共有譜面Previewの48px再生バー+44px設定バー、共有Inspector本体、`packages/{core,document,pdf}`、VS Code拡張の表示は**対象外**。承認図の譜面本文は例示でありピクセル一致を要求しない。iframeへCSS注入して共有バーを隠さない。
- 上端左: **`media/icons/guitardsl-sidebar.svg` の実際のギターアイコン**（独自描き直しは禁止） + `GuitarDSL`、その右に通常メニューバー **「ファイル」「編集」「表示」の3つだけ**。メニュー間は文字の詰め込みを避け、gap=24pxを最低とし、各トリガーに横padding=10–12px。タイトル横の「このデバイス」や「ウィンドウ」メニューは置かない。macOSトラフィックライト等ブラウザに存在しないウィンドウ装飾は作らない。
- 上端右: Google Driveの**Google公式2026カラーアイコン**と本当の状態表示 (未接続/接続中/接続済み/再認証)、その右に保存、PDF、アカウント、ヘルプ、**最右端の設定歯車**（右余白12px）。ボタンの常設背景枠/アウトラインは削除し、hover/focusのみに明示状態を表示。Driveロゴは公式提供素材そのまま/色変え・手描き・代替雲アイコン禁止。Googleのブランド規約に従い、Google Driveのアクションを明確に説明するtooltipを付ける。
- ヘッダーと左右サイドレールの境界線は**表示しない**。UIの幅変更に必要な6px splitterのみ保持。Explorer内の装飾的な横区切り線も削除し、32px根行/30–32pxファイル行で密度を高める。Explorerのタイトルは**EXPLORER**（PROJECT禁止）。左レール上端は**フォルダー (ic-folder)**、下端は**Problems (ic-problems)**。ギターアイコンをExplorerボタンに流用しない。右レールは**Inspectorのみ**。存在しないSearch/Terminal/Play等のレールボタンは作らない。
- 折畳みの意味を固定: `ic-down/right` はツリー節開閉**だけ**、`ic-more` はExplorer/Inspectorの実際に機能するオプションメニュー、`ic-close` はProblemsウィンドウを閉じる。左右レールの該当アイコンで再表示、変更前の幅高を復元。`role=separator`、aria-valuenow、Shift+矢印50px/矢印10px、Home/End、ダブルクリック初期化、pointercancel対応を維持。
- Problems: 横断下部パネルで列 `重要度 | ファイル | 行:列 | メッセージ`、実diagnosticsのエラー/警告SVG + 件数、行クリックで該当ソースへ移動。**件数0のバッジは出さない**（ヘッダーも左下の通知バッジも）。0件は空状態文を表示。ダイアログ/メニュー/Helpなどは日英・Light/Dark・キーボード・ARIA対応。UTF-8表示/選択は不要（固定）。
- ヘルプ右上「?」はクリック操作から**同一originのWeb用ヘルプをブラウザ別ウィンドウ** (window.open) で開く。ブラウザのポップアップ制限時は失敗を説明し、ユーザーが直接開けるリンク/新規タブ導線を表示。既存Help本文を流用し、ヘルプウィンドウは元の編集状態を変更しない。設定歯車は最右端、テーマ(system/light/dark)・言語(ja/en)に限定し、レイアウト初期化導線の主配置は「表示」メニューとする。

## 3. Menu Contract — 3 menus only
- メニューは各トリガー直下へドロップダウン。項目高さ32px、幅260–300px、左ラベル/右実際のOS別ショートカット、関係項目ごとのdivider、実際の無効状態と選択チェック。Tab/矢印/Enter/Space/Esc/Alt+アクセスキー（既存との衝突がない場合）・外側クリック・focus復帰。単一メニューだけ展開、他メニューへの横移動で既存メニューを閉じる。ブラウザの予約キーを横取りしない。
- **ファイル:** `新しい楽譜` -> `createNewScore`; `ファイルを読み込む…` -> file input+import; `Google Driveから開く…` -> `openFromDrivePicker`（未接続は無効で接続案内）; divider; `保存` -> `saveActiveDocument` (`Mod+S`); `コピーをダウンロード` -> 現在のsourceから別のローカルファイルを作り、現存fileId/保存先/タブidentityを変更しない (`downloadSource`); `PDFを出力…` -> `downloadPdf`; divider; `タブを閉じる` -> `closeTab`（ブラウザタブは閉じない）。
- **編集:** `元に戻す / やり直す` (CodeMirror history, OS別 Mod+Z / Shift+Mod+Z or Ctrl+Y)、`切り取り/コピー/貼り付け`、`すべて選択`、divider、`検索… / 置換… / 行へ移動…` (`Mod+F/H/G`)。メニュー実行は現在のCodeMirrorを対象にしUndo/selection/IMEを保つ。クリップボードAPI/ブラウザ権限で実行不能な項目は無効/案内、成功を偽装しない。標準keyboard Cut/Copy/Paste と CodeMirror本文のnative context menuは妨害禁止。`Mod+N/O/W` はブラウザと競合するので割り当てない。
- **表示:** 排他的`ソースのみ / 分割表示 / 譜面のみ` -> `setWorkspaceViewMode`、divider、チェック付き`Explorer / Inspector / Problems`（実際の開閉状態へ連動）、divider、**`レイアウトを初期化…`**（確認ダイアログ必須。既存初期化処理を1か所に集約）。**「ウィンドウ」メニューは作らない**。タブの「ほかを閉じる」は既存タブ右クリックメニューを維持。
- 既存Explorerファイル/タブ/Problems/Previewの右クリックメニュー、Shift+F10、target identity/revision validationを維持。追加メニュー表示は新たな文書保存やソースrevision更新を発生させない。

## 4. Explorer Google Drive & First Sign-in
- LocalとGoogle Driveの2ルートを同時表示し、どちらも独立展開。ファイル行はアイコン+ファイル名1行、選択はファイル行のみ。Driveルートは公式カラーDriveアイコン + 接続状態で32px固定。ExplorerからGoogle認証可能、未接続でもLocal操作可。
- Driveルートの`…`と右クリックから **`Driveからファイルを開く…` = `pickFile`**、**`保存先フォルダーを選択…` = `pickFolder`**、**`GuitarDSLフォルダーを作成…` = 明示作成**。Picker cancelは変更なし。Google Pickerの `setAppId` は同一Google Cloud project number、`setOAuthToken` は現在のtoken。`drive.file` の個別ファイル認可により、選択フォルダー内の**未許可ファイルを一括列挙できると誤認しない**。
- 初回接続後、appData設定/移行を読み、有効な保存先がなく `folderPrompt=unasked` なら「Google DriveにGuitarDSLフォルダーを作成しますか？」を1回表示。**作成 / 既存フォルダーを選択 / 後で**。許可済みMy Drive直下の`GuitarDSL`フォルダーが1つなら再利用、複数は選択を求める、見つからない場合はユーザーの「作成」選択後にのみ新規作成。`drive.file`では未許可フォルダーが存在しないとは断定できない。後ではdeferredに保存、再ログインで再ダイアログを連発しない。選択取消/ログイン失敗で作成しない。
- リモート結果が返るたびに、開始時の accountId/Driveインスタンス/generation が依然有効か確認。別アカウントのフォルダー、ファイルID、ドラフト、画面選択を混ぜない。

## 5. appDataFolder Ownership & Protocol
- **Google Drive内のアプリ状態だけ**を同期する。Google管理の非表示 `appDataFolder` にサブフォルダーを作成しない。可視My Drive / GuitarDSLフォルダーは楽譜本体用の別領域。OAuthは**drive.file + drive.appdata** の2 scopeだけ（従来のscope拡大禁止からの明示例外）。Google Cloud consent設定を更新。ブラウザのaccess tokenはメモリのみで永続保存しない。
- appDataにはアカウントあたり**単一** `guitardsl-state-v1.json`、`application/json`:
  `{"schemaVersion":1,"selectedFolderId":null,"folderPrompt":"unasked","openDriveFileIds":[],"activeDriveFileId":null,"recentDriveFileIds":[]}`
  `folderPrompt` = `unasked/deferred/completed`。openは順序付き重複なし最大30、recentは最近順重複なし最大50。Drive fileIdはopaque referencesのみ、読み取り権限ではない。ここにソース、ドラフト、OAuth token、メール、Localファイル、Undo、UIの個人端末レイアウトを置かない。
- 新規 `web/src/storage/driveAppData.ts` がファイルを発見: `GET files.list?spaces=appDataFolder&q=name='guitardsl-state-v1.json' and trashed=false`、全ページ取得、MIMEも確認、`fields=nextPageToken,files(id,name,mimeType,createdTime,version,modifiedTime)`。既存IDを保持して `GET files/{id}?alt=media` で読み出す。0件時だけ`files.create`、`parents:['appDataFolder']`でJSONを1回作成。以降の状態保存は**同じIDへfiles.update media PATCH**、readback一致のときだけ成功扱い。Google appDataファイルをtrash/share/moveしない。
- 複数候補が既にある場合はcreatedTime→ID順の決定的正本を使用して警告、勝手に削除しない。初回createの通信不明は再listして再利用/重複検出、盲目的再POST禁止。再送でstateファイルを増殖させない。
- 保存前にversion+modifiedTimeを読み直し、変更があれば **Drive状態を読む / この端末を優先（確認）** を表示して無断PATCHしない。keep-localは再取得後best-effort PATCH。GET→PATCHは原子的でないことを明記。PATCH結果不明はreadback一度のみ、元データ/保留変更を維持して自動再PATCHしない。
- `web/src/main.ts` のappData同期controllerはaccountId/Drive/generation所有、remote読み込み→初回のみ旧IndexedDB `drive-folder:<accountId>` / `workspace-drive:<accountId>` のDrive設定を移行→Driveタブ/Explorer復元の順。既存remoteがある場合はremote優先。編集済みローカルドラフトをremote設定で上書きしない。folder/Drive tab/recentの変更時に約1秒debounceで同期、同一アカウントの更新直列化、offline/切断/ページ離脱はpending保持、送信成功を偽装しない。
- 通常の楽譜更新は従来 `googleDrive.ts::updateFile` のexisting fileId PATCH、version/modifiedTime/headRevisionId、readback必須。通常の `listFiles` は `trashed=false` とページングを維持。Createは新規文書/Save As/ローカル初回移動だけ。どのAPIもtrash済みをExplorerへ紛れ込ませない。Google認可のscope外ファイルはPickerで改めて承認を求める。

## 6. Exact Change Set / Implementation Sequence
1. 先に`docs/specs/web-app.md`と`docs/design/web-app.md`を更新し、この統合契約のReviewer Checklistを新しいapproved bindingへ反映。既存旧契約SHAを最新として偽装しない。
2. Web shell: `web/src/main.ts`、`web/src/style.css`、`web/src/icons.ts`、`web/src/explorer/explorerController.ts`でメニューバー3件、brand guitar、右端設定/Help別ウィンドウ、Drive公式ロゴ+ステータス、Explorer見出し/罫線/レール移動、0バッジ非表示。Web専用UIだけ変更。
3. `web/src/editor/sourceEditor.ts` の既存CodeMirrorを保持し、標準編集メニューコマンド/OS別ショートカットを結線。`web/src/main.ts` から同じ保存・Undo・fileId契約を使用。
4. `web/src/auth/googleOAuth.ts` の追加scope、`web/src/storage/driveAppData.ts` 新設、`web/src/storage/googleDrive.ts` のアクセス可能な可視フォルダー検索、`web/src/main.ts` appData同期/移行/初回確認とExplorer Picker導線を実装。token/identity/event順序はIssue #168と整合。
5. 日英Help/manifest、OAuth deployment、status、ライセンス・公式ブランド資料、SVG画面証拠・DOMRect、Web/unit/E2Eを更新。既存PR #173へcommit/push→required checks→self-review→review遷移。

## 7. Required Runtime Semantics / Forbidden Changes
- Save/Export/Downloadは未publish CodeMirror編集を同一task内でflush。IME composing中は保存/出力成功扱いしない。メニュー開閉・splitter操作・再認証・パネル開閉で元ソース、revision、Undo、音声lease、local draftを変更しない。
- タブ/Drive account/Picker状態が非同期中に変化したら古い結果を放棄。`appDataFolder`が読めないときは未同期を明示し、ドラフト/Local編集は継続。権限エラー、破損JSON、未知schema、version競合は黙って新ファイルで上書きしない。
- 禁止: React/Monaco移行、共有譜面ツールバー改変、VS Code側画面変更、架空のツールウィンドウ、ブラウザ窓の描画、Drive全件scope、AppDataへの楽譜本文保存、認証tokenの永続化、無確認のGuitarDSLフォルダー作成、ファイルの毎回create、Driveフォルダー選択を子全件認可とみなすこと。

## 8. Concrete Tests
- 1600×900日本語Dark/Light・英語Dark/Light、1280×800：CSS Grid4 splitter寸法/リサイズ/保存・復元; ヘッダー40、右端gear余白12、タイトル横デバイス名なし、3メニューgap24+、Explorerタイトル/横線なし、左folder+左下Problems/右Inspector。スクリーンショットを最新SVGとWeb shell範囲で比較（共有iframeは除外）。
- menu File/Edit/View: クリック/keyboard/disabled/OS別shortcut/focus/ARIA、保存/ダウンロードは正しい既存sourceで動作、ブラウザCtrl+N/O/Wは乗っ取らない。Source/Split/Scoreのチェックと3パネル開閉・reset確認。右上Helpは別ウィンドウ、popup blocked fallback。ギターアイコンは`media/icons/guitardsl-sidebar.svg`の形、Explorerはfolder。公式Google Driveロゴは修正色・手描きなし。
- Problems実診断1error/0warningならエラーバッジ1のみ・警告0バッジなし。0/0なら通知バッジなし・「問題なし」。Close/Reopen/ドラッグ後の状態維持とキーボード。
- AppData初回0件→list+POST1回/readback、次の3保存は同IDへのPATCH3回/POST0回。`spaces=appDataFolder`、`trashed=false`、ページング、名前/MIME精査。重複既存、通信不明POST、未知schema、不正JSON、version競合、PATCH不明、offlineを区別。
- 旧IndexedDB→appDataへ一度のみ移行。端末Bでfolder/Driveタブを復元。未許可fileIdはPicker再許可でのみ読取可能。A→B接続切替中の遅いPicker/read/create/PATCHはBへ適用しない。全経路でドラフト保全。
- 初回フォルダー未設定→確認3択、後でPOST0/再表示なし、Picker cancel=変更なし、承認後はアクセス可能な同名フォルダー再利用または1回だけcreate。Driveルートfile Pickerとfolder Pickerの両方実行可能。
- 通常score保存が既存fileIdへPATCH（新createなし）、`files.list`がtrashを除外、Save As/移動のみcreate、readbackと競合判定が従来どおり。

## 9. Verification / Reviewer Checklist
検証: `npm run compile`、`npm run build:web`、`npm run test:unit --workspace web`、`npm run test:e2e --workspace web -- --project=chromium`、`npm run test:e2e --workspace web -- --project=webkit`、`npm run test:unit`、`npm test`（VS Code/Electronはsandbox外）、`npm run vscode:prepublish`、`npx @vscode/vsce ls`、`npm run check:help`、`npm run check:ai`、`python -m agent_workflow validate-docs --issue 172`、`git diff --check`、`.agent/project.json`必須4checks (`agent-required-check / web-spa-chromium / web-spa-webkit / safari-smoke`)。未実施OS/実Google認証/Google Cloud同意設定はNOT RUNまたはBLOCKEDとし、mockを実運用検証と呼ばない。
- [ ] Web-only scopeと4splitter/CodeMirror/共有Preview不変条件を保持。
- [ ] 最新SVGと実キャプチャのWeb shell/アイコン/色/余白・メニュー3件・zero badgeが一致。
- [ ] GuitarDSL公式repoのギターアイコン、Explorer folder、Google公式カラーDrive、右端gear、別窓Helpとfallback。
- [ ] File/Edit/View実操作、clipboard permissions、keyboard、各文書identity/revisionとundoを検証。
- [ ] Drive Explorer file/folder Picker、初回確認、ID権限境界、folder重複防止。
- [ ] drive.file+drive.appdataだけ、token memory-only、appData単一fileId PATCH、list trashed=false、衝突・未知結果の保全。
- [ ] IndexedDBドラフト、account/generation、A/B移行、既存楽譜files.updateの回帰試験。
- [ ] specs→design→code→status/Help/第三者通知/CI、実画像・DOMRect証拠を再検証。
- [ ] 新契約bindingに従いPR #173にcommit/push、review状態へ遷移。

## 10. Completion Report
変更ファイル、全チェック結果、テストPASS/FAIL/NOT RUN、最新HEAD実画像/DOMRect、未検証platform・Google実OAuth/consent、契約逸脱とIssue #168の阻害、commit SHA、**PR URL (https://github.com/puchinya/vscode-guitar-dsl/pull/173)**、`Closes #172`とレビュー状態を報告。commit/pushのみでは完了としない。権限/認証/CI/PR workflowで阻害された場合は正確なエラー付き**BLOCKED**。

### Visual References (current; shared preview itself unchanged)

**Final SVGs for this contract (these three supersede earlier UI drawings where they differ):**
- [Complete Web Compact shell 1600×900](https://github.com/puchinya/vscode-guitar-dsl/blob/feature/172-compact-ui-svg/docs/specs/gui_design/proposals/issue-172/web-compact-final-shell-20261115.svg) — File/Edit/View, far-right Settings, Google Drive status, left Explorer+Problems/right Inspector, CodeMirror, zero-warning badge hidden. Guitar icon is the shape from `media/icons/guitardsl-sidebar.svg`. Shared score content is illustrative only.
- [File / Edit / View menu contents](https://github.com/puchinya/vscode-guitar-dsl/blob/feature/172-compact-ui-svg/docs/specs/gui_design/proposals/issue-172/web-compact-final-menu-20261115.svg) — 3 menus, "コピーをダウンロード", layout reset in View, no Window menu.
- [Explorer Google Drive actions + first-connect confirmation](https://github.com/puchinya/vscode-guitar-dsl/blob/feature/172-compact-ui-svg/docs/specs/gui_design/proposals/issue-172/web-drive-explorer-first-connect-20261115.svg) — File Picker, Folder Picker, confirmed visible GuitarDSL folder creation.

![Consolidated 1600x900 reference](https://raw.githubusercontent.com/puchinya/vscode-guitar-dsl/feature/172-compact-ui-svg/docs/specs/gui_design/proposals/issue-172/web-compact-final-shell-20261115.svg)

**Legacy supplemental SVGs (geometry/icon shape only; old labels/layout superseded):**
- 統合画面: [`web-compact-workspace.svg`](https://github.com/puchinya/vscode-guitar-dsl/blob/feature/172-compact-ui-svg/docs/specs/gui_design/proposals/issue-172/web-compact-workspace.svg); グリッド: [`web-compact-layout-geometry.svg`](https://github.com/puchinya/vscode-guitar-dsl/blob/feature/172-compact-ui-svg/docs/specs/gui_design/proposals/issue-172/web-compact-layout-geometry.svg); SVGアイコン: [`web-compact-icons.svg`](https://github.com/puchinya/vscode-guitar-dsl/blob/feature/172-compact-ui-svg/docs/specs/gui_design/proposals/issue-172/web-compact-icons.svg); パネル補正: [`web-compact-panel-chrome-correction.svg`](https://github.com/puchinya/vscode-guitar-dsl/blob/feature/172-compact-ui-svg/docs/specs/gui_design/proposals/issue-172/web-compact-panel-chrome-correction.svg)。
- **最新画面決定 (2026-11-15):** 画面v4/3メニューバー案（File/Edit/Viewのみ、window廃止、View末尾にreset、Fileのコピーをダウンロード）、Explorer Google Drive Picker/初回確認ダイアログ案。これらは上述の具体的なテキスト契約を優先し、過去のSVGに残る旧表記・旧レール・仮データは適用しない。
- Google一次資料: https://developers.google.com/workspace/drive/api/guides/appdata ; https://developers.google.com/workspace/drive/api/guides/api-specific-auth ; https://developers.google.com/workspace/drive/api/guides/branding ; https://developers.google.com/workspace/drive/picker/reference/picker.pickerbuilder.setappid
