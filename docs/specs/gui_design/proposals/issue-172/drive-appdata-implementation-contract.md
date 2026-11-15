# Issue #172 Drive appDataFolder Implementation Contract

## 2026-11-15 Addendum — Drive appDataFolder Implementation Contract

**優先・例外:** 本追補はIssue #172の「Drive scope拡大は禁止」を**drive.appdata の追加に限って上書き**する。通常ファイルの drive.file は維持し、広範囲の drive/drive.metadata 権限は使用しない。Issue #168の非同期セッション分離、Driveファイル保存の既存競合契約を維持する。PR #173に本追補の実装と試験を追加する。新機能未実装のまま Closes #172 を完了扱いしない。

### 1. Repository Baseline
- `docs/specs/web-app.md` §5/§8、`docs/design/web-app.md` Drive session/ownership、`docs/status/implementation-status.md`、`AGENTS.md`、`docs/agents/testing.md` が基準。
- `web/src/auth/googleOAuth.ts` はGIS token clientで drive.file のみを要求し、tokenはメモリ保持。`web/src/main.ts::connectDrive` は IndexedDB の `drive-folder:<accountId>` を復元、`persistSessions/restoreDriveSession` は `workspace-drive:<accountId>` を使用する。`web/src/storage/indexedDb.ts` は未保存ドラフトとソース正本を保持する。
- 既存の楽譜保存: `web/src/storage/googleDrive.ts::updateFile` は既存fileIdへのPATCH、GET検証、変更競合チェック。`listFiles` は `q='<folderId> in parents and trashed=false'`、ページング対応。これらは**実装済みなので維持**。`pickFolder/pickFile` と `chooseDriveFolder/createDriveFolder/openFromDrivePicker` を再利用する。
- #168 は未完了。新たな appData 非同期処理ごとに accountId + Drive instance + connection generation を固定して await 後に照合し、古い認証結果を別アカウントへ適用しない。

### 2. Architecture Decisions
- 2つの保存領域を厳格に区別する: (a) Google管理の非表示 `appDataFolder` には**アプリ状態JSONのみ**を保存。そこにGuitarDSLサブフォルダーを作らない。(b) 通常のMy Drive / `GuitarDSL` フォルダーには楽譜ファイルを保存し、作成前に必ずユーザーへ確認する。
- OAuthスコープは **drive.file + drive.appdata の2つだけ**。Google Cloud同一プロジェクトのOAuth consent設定に追加。アクセストークンはメモリのみ。拒否・期限切れ・取消時に接続成功を偽装せず、ローカル編集とIndexedDBドラフトは継続できる。
- appDataの**アカウント別リモート正本**は単一 `guitardsl-state-v1.json`（MIME: application/json）。スキーマは `schemaVersion:1`、`selectedFolderId:string|null`、`folderPrompt:'unasked'|'deferred'|'completed'`、`openDriveFileIds:string[]`（順序保持・最大30件）、`activeDriveFileId:string|null`、`recentDriveFileIds:string[]`（最近順・最大50件）。未知フィールド・型違いは検査し、不正JSONや未知版を黙って上書きしない。トークン、メール、楽譜ソース、未保存ドラフト、ローカルファイルIDを含めない。
- IndexedDBはローカル文書、下書き、オフライン復旧、ローカル表示設定に残す。Driveフォルダー選択・開いたDriveファイルIDは、移行完了後はappData正本。ID記録は**ファイルへのアクセス許可を付与しない**。復元時は各IDのget可否を再確認し、403/404はPickerで再選択を促す。
- appDataファイルの初回は一覧で不在を確認後に `files.create`（`parents:['appDataFolder']`）、以降は**同じfileIdへのfiles.update（media PATCH）**のみ。同期のたびにcreateしない。`files.list` は `spaces=appDataFolder` と `trashed=false`、ページングと正確なname/MIME照合。appData内では共有・移動・ゴミ箱への移動をしない（Google APIが禁止）。
- 初回同時作成や通信不明時のPOSTを盲目的に再試行しない。一覧再取得で重複を検出したら、最古createdTime→fileId辞書順の安定した正本を選び、警告する。既存ファイルは削除しない。更新前のversion/modifiedTime照合で競合検知、他端末変更を無断で上書きしない。競合時は「Drive設定を読み込む / この端末を優先して更新（確認）」を提示。後者は最新値を再取得してbest-effort PATCH。GET→PATCHの非原子性は明記。更新結果不明はreadbackを一度だけ行い、勝手に再PATCHしない。
- Drive Explorerルートに **「Driveからファイルを開く…」= Picker file** と **「保存先フォルダーを選択…」= Picker folder**、**「GuitarDSLフォルダーを作成…」** を置く。フォルダーの選択だけで未許可の配下ファイルすべてが見えるとは扱わない。
- 初回接続でリモート状態の取得/移行後に有効な選択フォルダーがなく `folderPrompt=unasked` なら1回だけ「Google DriveにGuitarDSLフォルダーを作成しますか？」と尋ねる。ボタン: 「作成」「既存フォルダーを選択」「後で」。作成は許可済みのMy Drive直下に同名・非ゴミ箱フォルダーが1個なら再利用、複数ならPickerで選択、0なら明示承認後に作成。未許可フォルダーの不存在を推定しない。「後で」はdeferredで再ログイン時の自動再表示を抑止し、Explorerから手動変更可能。キャンセルで作成しない。

### 3. Exact Change Set
- `web/src/auth/googleOAuth.ts`: 2つのscopeをGISで要求、OAuth設定・認可失敗・token寿命のテストを修正。Google Cloudのconsent設定は手順を文書化（権限不足ならBLOCKED報告）。
- 新規 `web/src/storage/driveAppData.ts`: スキーマvalidation、`GET /drive/v3/files?spaces=appDataFolder&q=name='guitardsl-state-v1.json' and trashed=false&fields=nextPageToken,files(id,name,mimeType,createdTime,version,modifiedTime)&pageSize=100`、`GET /files/{id}?alt=media`、初回のmultipart POST、同じIDへのmedia PATCH、readback、競合/不明結果の型付きAPIを実装。
- `web/src/main.ts`: accountId + Drive + generation所有のappData同期controller。ログイン→appData取得→必要時のみIndexedDBの既存 `drive-folder:` / `workspace-drive:` からDriveメタデータ移行→復元→Explorer更新の順。リモート既存時は古いIndexedDB値で上書きしない。フォルダー選択・Driveタブ開閉などで約1秒debounce＋アカウント単位直列化。ページ離脱中に無理な非同期保存はしない。失敗時は保留状態を残す。
- `web/src/storage/googleDrive.ts`: 既存 `updateFile` と `listFiles` の `trashed=false` は変更禁止。My Drive直下のアクセス可能な同名フォルダー検索（name + MIME + root parent + trashed=false、ページング）を追加し重複を防ぐ。
- `web/src/explorer/explorerController.ts` + WebホストHTML/CSS: 上記2 Pickerと作成コマンド、初回確認ダイアログ、通信中/失敗状態。既存Explorer全体レイアウトと共有譜面Previewは変更しない。
- `docs/specs/web-app.md`、`docs/design/web-app.md`、Help日英＋manifest、`docs/status/implementation-status.md`、Google OAuth導入文書に新規スコープ・状態同期・制約・実動作を反映する。

### 4. Implementation Sequence
1. specs→designを先に更新し、Reviewer Checklistを公開。appData一覧、初回作成、競合、移行、アカウント切替の失敗テストを追加。
2. OAuth scope更新とappData adapterを実装。共有packages、VS Code拡張には手を入れない。
3. セッション固定・IndexedDB移行・同期controllerを実装し、非同期切替とオフラインに対応。
4. Explorer file/folder Picker、GuitarDSLフォルダー確認、アクセス制限のUIを実装。
5. Web/VS Code回帰試験、必要な文書、PR #173のcommit/pushとreview遷移。

### 5. Required Runtime Semantics
- 未ログイン: ローカル編集/下書き正常。DriveフォルダーもappDataも自動作成しない。
- 初回ログイン: appData一覧→既存stateがなければ移行→1個のみ作成。保存先未設定なら確認。拒否時には可視GuitarDSLフォルダーを作らない。
- 再接続/別端末: remote stateを読み復元。各fileIdの権限は毎回検証し、未許可ファイルはPickerでの再承認が必要。既存ローカル下書きをリモートstateで置換しない。
- A→Bの接続切替、同一Aの再認証、Pickerのキャンセル、期限切れ、通信失敗、繰返し操作、離脱: 古い結果の混入禁止。開いたタブと下書きを破棄しない。曖昧なPOST/PATCHは再試行せず確認。
- 通常の楽譜更新は既存fileIdのPATCH、メタデータ確認、readbackを維持。楽譜一覧はゴミ箱を除外。Save As/コピー/移動初回以外ではcreateしない。

### 6. Non-goals / Forbidden Changes
- appDataへ楽譜本文/ドラフトを移さない。appData内にユーザー可視GuitarDSLフォルダーを作らない。Drive全件閲覧権限、サーバー/refresh token、共有譜面/VS Code内部の改修をしない。非原子的なDrive更新を「完全な競合防止」と呼ばない。
- Issue #168全体の認証再設計を無断で取り込まず、当該addendumで追加する処理は#168と同等のsession guardを満たす。

### 7. Concrete Tests
1. appData空→list spaces=appDataFolder & trashed=false→POST1回、readback一致。同一stateを3回同期→PATCH3回・POST追加0回・同じID。
2. ページング、name/MIME違い、重複state、破損JSON、不明schema、POST応答消失: 誤選択/上書き/無限createをしない。
3. リモート既存＋IndexedDBに古いfolderId→remote優先、ドラフト保持。リモート不在＋旧local設定→1回のみ移行。
4. A接続中にBへ切替、Picker/POST/PATCH遅延後にA応答→Bのfolder/tab/metadataを変更しない。
5. 2端末のversion競合→無断PATCHなし。更新結果不明→readbackして保留、再送なし。
6. 保存先未設定→初回確認。「後で」=可視フォルダーPOST0、再ログイン再表示0。「選択」=Picker、キャンセル安全。「作成」=可視同名folder再利用または1回create。
7. ExplorerからFile/Folder Pickerを独立起動。フォルダー許可だけでは未知の子ファイルを表示しない。通常Drive保存は同一fileId PATCH、files.list は trashed=false。
8. GISは正確にdrive.file + drive.appdata、token永続化なし。Chromium/WebKit mockとSafariの対象試験、ローカル編集の回帰。

### 8. Verification
`npm run compile`、`npm run build:web`、`npm run test:unit --workspace web`、`npm run test:e2e --workspace web -- --project=chromium`、`npm run test:e2e --workspace web -- --project=webkit`、`npm run test:unit`、`npm run check:help`、`npm run check:ai`、`git diff --check`。`docs/agents/testing.md` と `.agent/project.json` に従い、必要な `npm test`（sandbox外）、`npm run vscode:prepublish`、required CI4件を実施。実GoogleアカウントとOAuth consentが未検証ならNOT RUNと明記。

### 9. Reviewer Checklist
- [ ] OAuth追加はdrive.appdataのみ、Google Cloud consent、token memory-only。
- [ ] 楽譜の既存files.updateとtrashed=falseを維持。
- [ ] appDataは単一schema正本、ページング、既存ID PATCH、readback、重複・不明応答処理。
- [ ] account/instance/generationで隔離、再認証・切断・失敗経路。
- [ ] IndexedDBドラフト保持、1回限りの移行、権限未付与IDの扱い。
- [ ] ExplorerのPicker2種、確認付き可視フォルダー作成・再利用。
- [ ] 競合発生時の明示選択と非原子性の説明。
- [ ] specs→design→code→status/Help、テスト/CI、同じPR #173にcommit/push、Closes #172確認。

### 10. Completion Report
変更ファイル、チェックリスト各項目、テストPASS/FAIL/NOT RUN、実Google OAuthの検証状況、未検証プラットフォーム、契約逸脱/阻害要因、commit SHA、**PR #173 URL**、review移行状況を提出。PRが作れない/更新できないときは具体的エラー付きでBLOCKED。

> This document is an Implementation Contract. Do not redesign the architecture during implementation. If a requirement conflicts with repository reality or requires a material design change, do not silently choose an alternative. Report the exact conflict and continue only with independent valid work.

References: https://developers.google.com/workspace/drive/api/guides/appdata , https://developers.google.com/workspace/drive/api/guides/api-specific-auth , https://developers.google.com/workspace/drive/api/reference/rest/v3/files/list .

