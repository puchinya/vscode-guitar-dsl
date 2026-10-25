# Implementation Contract — GuitarDSL Preview 双方向楽譜編集と Inspector `let` 変数管理

- **対象 Issue:** `#158`（作成時に確定）
- **基準:** `puchinya/vscode-guitar-dsl` `main@ed2c037559cc8bbc1e4835ef2f9a61ba060a7ac4`（2026-10-25 JST 時点。着手直前に `main` を再照合）
- **区分:** 実装用・決定済み契約。本文中の図は承認対象となる *新規 GUI 案* であり、現行画面の実行時キャプチャではない。
- **参照 SVG:** `docs/specs/gui_design/proposals/issue-158/bidirectional-editor-overview.svg`（3領域の全体像）、`.../variable-inspector-states.svg`（変数操作と確認状態）。両方とも純粋な SVG ベクター要素。既存画面の参照正本は `docs/specs/gui_design.md` と同階層の既存 `preview-*.svg`、`inspector-*.svg`、`practice-guide-compact.svg`。

> This document is an Implementation Contract. Do not redesign the architecture during implementation. If a requirement conflicts with repository reality or requires a material design change, do not silently choose an alternative. Report the exact conflict and continue only with independent valid work.

## 1. Repository Baseline

| 根拠 | 確認した事実／保持すべき不変条件 |
|---|---|
| `docs/specs/guitardsl-syntax.md` §7、§8、§12–13、§17–19 | `let` は全域定義、参照 `$name`、入れ子／前方参照と文脈推論を持つ。定義内の音価・音域継承は独立。音符・リズム・TAB と歌詞、コード図定義は別の構文。 |
| `docs/specs/extension.md` §4、§4B、§4D、`docs/specs/gui_design.md` §2–3 | 単一 Preview WebviewPanel の48px再生行、44px一時楽譜設定行、Practice ON のときだけ42px Practice行、共通 Inspector WebviewView と既存の設定／進行コンテキスト。 |
| `docs/specs/gui_design/preview-{paged,continuous,practice}.svg`、`practice-guide-compact.svg`、`inspector-{progression,capo-playability}.svg` | 既存 GUI の参照画面。新機能はこれらの既存画面を置換・削除しない。 |
| `src/extension.ts::activate()` / `updateWebview()` / 文書変更購読 | Extension Host が Preview 所有、文書変更でレンダリング更新。Preview 独自の source writer は現在ない。 |
| `src/compiler.ts::parseGuitarDsl()`、`ParsedScore::{measureSourceSpans,codeActionTokens,pitchTokens,chordTokens,sourceDefinitions}` | コンパイラー由来のソース位置は存在するが、全ての表示ノード・歌詞・TAB音に安定した逆対応があるわけではない。必要な範囲をコンパイラー側で拡充する。 |
| `src/render/svg.ts::{renderScoreSheets,renderContinuousSvg,renderSystem}` / `src/render/previewHtml.ts::compileGuitarDslToHtml()` | SVG を Preview と PDF が共有。Preview の Webview にオーバーレイを置けるが、PDF への編集 UI 混入は禁止。 |
| `src/sourceEdits.ts::spliceSourceOffsets()`、`src/codeActions/{planners,sourceIndex,semantics,provider}.ts` | ソースを保つ offset-splice、再パース／意味検証、WorkspaceEdit/Undo のパターン。既存の `extractLet` / `inlineLet` の規則を再利用。 |
| `src/inspector/{inspectorController,inspectorView}.ts`、`src/render/inspectorHtml.ts` | 単一 Inspector。`InspectorContext` は `empty` / `document` / `settings` / `progression` の判別共用体。Webview メッセージは generation、URI、version、sessionGeneration、必要なら revision に結びつく。 |
| Issues #132/#133/#134/#135/#136/#145/#150/#153/#155、merged PRs #138/#139/#140/#141/#149/#151/#154/#156/#157 | Inspector中心の責務、一時Preview設定、4小節Practiceガイド、GUI統合受入れを変更せず拡張。#132/#157 は2026-10-25にクローズ／マージ済み。 |
| `.agent/project.json`、`docs/agents/testing.md` | `verify_quick` = `npm run compile`, `npm run test:unit`、`verify_final` = `npm run compile`, `npm test`, `npm run vscode:prepublish`, `npx @vscode/vsce ls`。VS Code E2Eの外部環境／スクリーンショット検証条件を遵守。 |

## 2. Architecture Decisions

### 2.1 正本・画面所有（既存仕様を維持）

1. **編集の唯一の正本は VS Code `TextDocument` の GuitarDSL テキスト。** GUI 表示／ドラフト／`ParsedScore` は派生データであり、別の保存済み音楽モデルを持たない。編集の確定には Host 側のドキュメント編集が必須。
2. 標準 TextEditor はソース、診断、Code Actions、Undo の所有者。Preview は同じ単一 WebviewPanel 内で「表示モード（従来）」と「編集モード（追加）」を切替。既存 Preview toolbar と score SVG の上に編集 hit-area／overlay を重ねる。Preview 全体を CustomEditor に置換せず、新規 Editor Tab/WebviewPanel を作らない。
3. 共通 Inspector は**既存の単一 WebviewView** に `variables` コンテキストを追加する（`settings` 三節や `progression` へ variables を強引に追加しない）。変数一覧・参照・定義の編集ドラフトと確認 UI は Inspector に置く。表示する変数一覧は現在アクティブな GuitarDSL 文書に限定する。Preview のクリックは明示した document URI/version を固定し、別のアクティブ文書へ黙って切り替えない。
4. 通常 Playback／Practice は Preview Webview に、コード進行提案の一時試聴は Inspector AudioContext に、排他調停は `ProgressionAudioLeaseCoordinator` に残す。**編集機能用に AudioContext、scheduler、playOrder、tempo authority を増やさない**。編集開始・採択前、音楽内容が変わる Apply は既存 playback/lease の停止と ACK 規則に従う。Stop の失敗を無視して編集適用しない。
5. `chord ...` 定義（コードダイアグラム）と `let ...` フラグメントは異なる種類。変数一覧には `let` のみを列挙し、コード図は既存 `ChordEditorPanel` を使用する。

### 2.2 双方向同期と編集モデル（本 Issue の確定決定）

1. GUI編集は Preview の要素をクリックして選択→専用Inspector編集（必要時）または直接ドラッグ／キーで変更→**操作完了時に1トランザクションで TextDocument へコミット**。ドラッグ中の影表示は非永続。1ドラッグ=1 `WorkspaceEdit`=1 Undo。エディタからの変更は既存 document change → parse → Preview/Inspector 再投影で即時反映する。既存 document event で同一変更を再適用しない。
2. 変数 `let` の変更（新規・定義変更・名前変更・複製・削除）は Inspector で検証済みドラフトを持ち、明示的な「変更を適用」で1回の Undo として反映。ドラフト表示中、参照を含む譜面は必要なら一時的に差分 highlight するが原文／PDF／音声を変えない。
3. 表示側イベントは `{uri,documentVersion,previewGeneration,visualElementId,operation,payload}`、Inspectorイベントは `{generation,sessionUri,sessionVersion,sessionGeneration,revision,variableId,operation,payload}` の形式とし、Host が厳密に型・列挙値・整数範囲・文字長・権限・表示対象との一致を検証する。Webview は source offset、置換テキスト、WorkspaceEdit を決めない。
4. 見かけの SVG x/y や DOMテキストを再パースして編集元を推測してはならない。コンパイラーが出す**authored origin と各イベントの source token 範囲**を render adapter が VisualSourceBinding へ結び付ける。識別子は document URI/version と Preview render generation ごとに発行し、データ属性は安全にエスケープする。共有 SVG は音楽描画を変更せず、Preview のみに操作 hit-area を重ねる。印刷された PDF に overlay や編集ハンドルを出さない。
5. 同じソース要素が反復・編曲・変数参照を通じて複数箇所に表示された場合は、元定義の編集を行うか、下記の「この箇所だけ展開」で安全に独立できる場合に限り編集する。曖昧な元位置や不安定な source span を持つ表示物は **read-only + 「コードで開く」** と理由を提示し、他の箇所を推測編集しない。これを完全双方向同期の例外として文書化する。
6. 編集適用時は URI 単位の reentrancy guard、予期する document version と原文 bytes、source span boundary、token type を再確認する。pure planner は最新テキストから決定論的な差分を計画し、`spliceSourceOffsets` で元の行末・コメント・インデント・非対象領域を保つ。適用前に再パースし、原文と編集予定箇所の音楽的意味変化だけを許可。適用するなら `WorkspaceEdit` と `workspace.applyEdit` を各1回、成功時のみ履歴を持つ。stale、無効な対象、キャンセル、重複要求、診断悪化、確認なしの破壊的変更、applyEdit拒否は0編集。
7. Webview 再構築後の選択／フォーカスは `{uri,version,generation,stableElementKey}` で再解決できる場合だけ復元する。キー消滅時は選択解除。編集モードの ON/OFF と選択状態は Preview 固有の一時 UI であり DSL に書かず、`vscode.getState` に未検証の保存編集・URI を保存しない。文書・Preview・Inspector破棄、編集モードOFFでドラフト／タイマー／アクセシビリティ注記／ハンドルを後始末する。

### 2.3 編集操作と制限（本 Issue の確定 UI/API スコープ）

| 対象 | GUI確定操作 | 固定の意味／失敗規則 |
|---|---|---|
| コード名（小節の authored source token） | クリック→コード名選択→変更、挿入／削除 | parser の chord source span の名前部だけ更新し `@label`、指定拍位置、音価、コメントを保持。結果のコード名／コード定義を検証。追加・削除は authored 小節 span と小節解釈が確定できる場合のみ。 |
| `mel:` 音符／休符／同時複数音 | 上下ドラッグで半音単位に音高変更、音価ドロップダウン、追加・削除 | 単位は音高、duration、完全な authored token。暗黙オクターブ／長さの後続継承が変わる場合は明示表記にするか拒否。小節拍数・tie/slur/grace境界と歌詞対応は再検証。横ドラッグによる拍位置移動や複数音の音高一括変更は **対象外**。 |
| リズム | ダウン／アップ、休符、アクセント・ゴースト・タイ／ミュートの対応済み modifier、音価変更、トークン追加・削除 | 既存 rhythm parser を使用。`.t/.tie`、`.m/.b/.g/.pm/.sN` と休符の既存 DSL ルールを再利用。小節拍数、タイ接続、譜表に与える効果を再検証。 |
| `tab:` / `tab[1]:` | 選択拍の弦／フレット、長さ、休符、和音内のノート追加・削除 | 既存 TAB 1声部/6弦/capo-relative フレット、タイ・奏法制約を厳守。音高は `InstrumentModel` 解決に依存。複数声部・範囲外フレット・新しい音価文法は対象外。 |
| 歌詞 `lyr:` | 音節をクリックしてインライン入力、追加・削除 | 言語仕様 §13 の音節トークン化に従い 1つの authored 音節に対応づける。多番歌詞・繰り返しの参照位置が曖昧な場合は対象の `lyr:` 行を Inspector で選択する。元のUnicode、他番、末尾コメントを保持。 |
| `let` 変数一覧 | 一覧、使用文脈、直接参照数、参照位置、未使用／診断状態 | `ParsedScore.sourceDefinitions` と parserが所有する `$name` 参照 source spans から導出。間接参照は別欄でカウントし二重加算しない。無効／重複定義は read-only で diagnostics とソースジャンプ。 |
| `let` 変数編集 | 新規、名前変更、定義内容編集、複製、未使用削除、参照箇所ジャンプ | 定義／参照の全ソース境界を検証。名前変更は衝突、循環、大小区別、入れ子参照を検証し全参照を同一 edit に含める。`let` への変更は参照全部に効くことを確認 UI に表示。使用中の削除は禁止（参照を壊さない）。 |
| `$name` を使う譜面上の直接編集 | 「定義を編集（全参照）／この箇所だけ展開して編集／キャンセル」 | 選択必須。後者は唯一の authored `$name` 呼出 span を値に展開して音楽的意味が**全スコアで同じ**ことを確認してから要求変更を同一1編集に合成。入れ子・文脈制約などで安全に展開できなければ選択肢を disabled にして理由表示。繰り返し `%`、arrangement の複製 occurrence は勝手に個別展開しない。 |
| セクション・メタ情報等 | 編集対象へ「ソースで開く」 | この Issue の実装対象外。既存 score settings Inspector の `capo` / beginner / transpose、Chord Diagram Editor を継続利用する。 |

### 2.4 禁止する設計

- AST／InterchangeScore の全体シリアライズ、独立した Visual-DSL 文法解析器、`$name` を表示側で逐次文字列置換する擬似パーサー。
- `let` の新しい型付き構文、パラメーター、スコープ、複数行定義、DSL 言語仕様の拡張。
- Inspector をもう1個作る、Editorを独自Webviewに置換する、既存 Preview/Practice PDF を書き直す。
- GUIの表示上選択でオートプレイ／自動Applyする、複数 Undo を1ユーザー操作として報告する。
- 変数の断片「和音」を `chord` 図定義と同一扱いにする。

## 3. Exact Change Set

**確定する変更境界（必要な helper の同一ディレクトリ分割は可、責務の移設は不可）:**

1. `src/compiler.ts` および既存 `src/{melody,tab}.ts` の解析経路：`ParsedScore` に、GUI 要素→authored token/fragment-reference への `VisualSourceBinding[]` と `LetDefinitionSummary[]`（name、validity、usage locations、definition spans、allowed contexts）を**parser-owned**で追加。増分情報はソースの既存 semantics を変えない。後方互換の optional export にし、全既存 parse 呼出元が破損しないようにする。`CodeActionDefinitionSpan` ほか既存 span は保持。
2. 新規 `src/visualEditing/{model,planners,validation}.ts`：VS Code 非依存の `VisualEditTarget`、`VisualEditOperation`、`VisualEditPlan`、`LetOperation` を discriminated union とし、上記操作の pure plan / 構文・音楽的意味 postvalidation を実装。返り値は `{ok:true,edits,postcondition}` または `{ok:false,code}` で文字列理由は I18n 層が所有。`sourceEdits.ts::spliceSourceOffsets` と `codeActions` の安定ルールを再利用。
3. 新規 `src/visualEditing/hostController.ts`：対象 URI/version/render generation を持つ Preview 編集セッションと Inspector 変数編集セッション、draft revision、Apply reentrancy、キャンセル/Dispose を Host で管理。**選択と変数編集はドキュメントに対して適用する瞬間まで別。** `src/extension.ts` は controller の登録/イベント接続、`onDidChangeTextDocument` による invalidation、singleton panel の lifecycle 経路を接続。
4. `src/render/svg.ts`（必要なら `src/render/{melodyStaff,tabStaff,notation}.ts`）：Preview向け source binding を描画ターゲットと一致させるための**非可視 id/data 属性のみ**を付与。`renderScoreSheets` と PDF の SVG 出力の可視ピクセル、レイアウト、譜割り、Playback anchorを保持。SVGに script/event handler/外部URLを埋めない。
5. `src/render/previewHtml.ts`：既存ツールバーを温存し、追加の**編集切替 row（編集モード時のみ表示）**、選択枠とドラッグ handle、歌詞入力 overlay、TAB / リズム操作 popupを追加。既存 Play/Stop/Practice の DOM ID/CSS、48+44+42px 行高とガイド下端を変更しない。編集モード OFF は既存画面と同寸法。入力は Webview の `postMessage(intent)` のみ。
6. `src/inspector/inspectorController.ts` と `src/inspector/inspectorView.ts`：`InspectorContext` へ `variables` 分岐、セッション世代・revision を固定で追加。既存 `settings`・`progression` の dispatcher を壊さず、変数向け message validation と cancel/dispose を接続。`src/render/inspectorHtml.ts` へ「変数」タブ、一覧・使用箇所・詳細・定義ドラフト・二択編集・破壊的操作確認を追加。既存セクションの UI 順序と文言は変更しない。
7. `src/i18n.ts`、`package.nls*.json`、`package.json`：追加 UI で必要な日英文言（非対応・失敗理由を含む）と**最小限の公開コマンド** `guitardsl.togglePreviewEditMode`, `guitardsl.showVariables`（既存 `openInspector` を再利用）を追加。既存の command ID と View ID は変更しない。
8. `docs/specs/{extension,gui_design}.md`、`docs/design/{score-editing,vscode-editor-experience,preview-rendering-and-export}.md`、`docs/help/{ja,en}/`、`docs/status/implementation-status.md` を `specs→design→code→status` の順に更新し Help 生成物と digest、`check:ai` 必要部分を同期。承認 SVG 2 枚は `docs/specs/gui_design/proposals/issue-158/` に配置して GUI 仕様からリンク。**提案図と実画面 evidence を混同しない**。
9. `tests/unit/{compiler,letFragments,codeActions,render,render-melody,render-tab,inspectorController,inspectorHtml}.test.ts` と `tests/e2e/extension.test.ts` の既存観点を拡張。適宜新規 `visualEditing*.test.ts` を追加。

## 4. Implementation Sequence

1. 事前に現行 `main`、#132/PR #157、`docs/specs/gui_design.md` と実 UI を照合し、契約のズレがあれば**先に衝突報告**（仕様再設計は実装者判断で行わない）。契約の Reviewer Checklist を実装開始前に確認する。
2. parser source binding と変数参照 summary の純粋ユニットテストを先に実装。direct/indirect/repeat由来の provenance を確定。
3. pure edit planner + postvalidation（各操作・失敗・clone/local detach）を実装。まず `let` の名前変更／変更／参照展開から検証。
4. Extension Host transaction / version guard / audio stop / state invalidation を実装。
5. 既存 Preview を壊さず edit overlay と `showVariables` 動線を追加。表示モードの出力が変化しないことを先に比較。
6. Inspector に変数表示・編集 draft・参照位置・確認と Apply を実装。既存 settings / progression との明示切替、キャンセル・フォーカス移動を検証。
7. メロディ／コード／リズム／TAB／歌詞の表示上編集を接続。可否・read-only fallback は DOM に理由を出す。
8. 日英 Help・仕様・デザイン・status・SVG・画面 evidence、E2E／アクセシビリティ／narrow viewport、lint/testsを完了。
9. 全 Reviewer Checklist セルフレビュー、コミット・push・`Closes #158` の PR を作成して review 状態へ移す。PR URLを Completion Report に必ず記録。

## 5. Required Runtime Semantics

- **通常系:** Editor→既存 change event→source parse→Preview/Inspector; GUI→visual intent→Hostで捕捉した `uri/version/generation` 検証→pure planner→`spliceSourceOffsets`→再パース/音楽的整合性→Stop/ACK 必要時→再確認→単一 `WorkspaceEdit`→Preview再表示/selection再束縛。
- **1ジェスチャー・1Undo:** ドラッグ中の `pointermove` はソース無変更、`pointerup` またはキーボード確定で1コミット。`Escape`／ pointercancel で0編集。単一音符を2回独立して変更する操作はUndo2回。
- **編集衝突:** TextEditor edit、他の GUI apply、progression/settings apply 等で同 URI の version が変わった場合、新しい source への無条件リベース禁止。ドラフト無効化＋ユーザー再選択。二重押下は1適用のみ。途中の非同期 `Stop` と confirmation 後にも version/context/target/id/expected bytes を必ず再検証。
- **失敗:** 音楽的な妥当性、context、参照、範囲、タイ/スラー、歌詞と音符の対応、重複名、循環参照が破れれば0編集。警告しかない既存ファイルでは元の無関係診断を増やさず、編集領域の新しいエラーを作らない。invalid source の未回復箇所は編集不可、既存ソース編集は妨げない。
- **変数参照:** 定義変更は **定義が有効に使われる全箇所** に反映。構文上すべての direct `$name` を rename（一致する全定義と、前方/後方/入れ子参照を含む）。local edit は選択した *authored reference token* 1個だけを展開し、参照先・他出現を変えない。展開だけで音楽的意味が変わる場合や `%` / arrangement occurrence が対象なら reject。
- **Preview-only設定:** Capo/Beginnerの一時 effective DSL 上に表示されている擬似音を直接編集しない。編集モード開始時、一時変換が非identityなら overlay 編集を無効にし、状態を解除して原文に戻す明示操作を提示。暗黙に一時設定を破棄しない。TABの既存変換制限も維持する。
- **音声:** Previewの一般 playback/Practice の Stop と Inspector progression lease は既存 owners に委譲。Stop ACK不着は0編集＋理由を表示。ソース変更・文書切替・モードOFF・panel disposal では予約済音源を停止／解放し、二重 cleanup は安全。
- **フォーカス:** VS Code text editorを別ファイルへ切替時は既存 Inspector 文脈に従い選択/ドラフト破棄。意図しない Preview/Inspector reveal や active editor の変更は禁止。Webview 再描画で選択中の同一要素だけ位置を保持し、存在しない要素は解除。read-only fallback は `コードで開く` を利用可能。
- **アクセシビリティ:** すべての操作にキーボード代替・ローカライズ名・`aria` 選択/無効理由・visible focus。ポインタのみでしか編集できないノート操作は禁止。音符の左右/上下／音価は keyboard で明示的に変更できる。

## 6. Non-goals / Forbidden Changes

GuitarDSL構文の変更、音声・MIR・WASM・PDFアルゴリズムの再設計、新しい musical scheduler、4小節Practiceガイドの再配置、Visual IR 独立保存、Multi-TAB voice、未知奏法対応の追加、GUIによる任意の source formatting、全小節・セクションの一括ドラッグ並替、全曲／全ファイルの変数リンクは対象外。ヘッダや arrangement のみを表現した UI オブジェクトは read-only にし、その理由とソース位置ジャンプを表示する。

## 7. Concrete Tests（Setup → Action → Expected）

- **BV-01 Renderer parity:** Preview編集 OFFで既存8モードのPreview/PDF SVG snapshotを比較→可視差分なし、48/44/42pxとPractice4小節、固定次コード図・運指の欠けなし。
- **BV-02 Source→GUI:** `mel:/lyr:/tab:`/chord/rhythm/`let` あり文書をTextEditorで変更→現在文書だけ再描画し、変数内容/参照ハイライト/指定要素が変更を反映、他ファイルはそのまま。
- **BV-03 GUI→Source/Undo:** Previewの明示音符上下ドラッグ、キーボード音価変更、コード名変更、TAB fret変更、リズム奏法、歌詞一音節変更を個別に実行→各成功操作だけ該当 author token に差分、各1 Undo完全復元、LF/CRLF・コメント・非対象空白保持。
- **BV-04 Length/Inheritance:** 音価/音高省略が後続へ伝播する文書→操作後に無関係イベントの音高・音価・歌詞対応変化なし、明示化できなければ0編集。
- **BV-05 Variables list:** `let riff`, `let groove`, `$riff` x2、入れ子 `$groove`、未使用/invalid定義を用意→正確な direct/indirect count、適正な category、参照ジャンプ、未使用区別、duplicate/cycleはdisabled。
- **BV-06 Variable rename:** `let riff` が前方・後方・入れ子に参照される→renameですべて正確に置換、他の似た名前やコメントは不変、衝突・循環・invalid nameは0編集。
- **BV-07 Variable definition/global:** `let riff` をInspectorで変更→Applyするまで原文不変、Apply後すべての `$riff` 表示が同じ意味で更新、1 Undoで全復元。
- **BV-08 Local detach:** authored `$riff` 一箇所を選択→「この箇所だけ」→展開＋一ノート変更が同一Undo、その箇所以外の参照に変更なし。入れ子曖昧さや unsupported context では disabled 理由表示／0編集。
- **BV-09 Repeat/arrangement:** `%`、repeat、volta、arrangement による1書面小節の複数occurrences→勝手なソース複製をしない。元定義編集のみ、single-occurrence edit は disabled。
- **BV-10 Invalid/stale/reentrant:** 変数draft後にTextEditor edit、別文書切替、Panel disposal、二度Apply、old generation再送→全 stale intent は0編集。新セッションの UI に古い応答/選択/音声が乗らない。
- **BV-11 Stop/lease:** Preview一般再生中・Inspector候補試聴lease有りでGUI Apply→Stop ACK 成功なら適用、ACK失敗/timeoutなら0編集。通常再生・Practice・progression A/Bの既存E2E PASS。
- **BV-12 UI/locale:** `ja/en` × `light/dark` × Preview幅 `421/600/840/1100` と Inspector最狭幅→表示切替・操作・可視フォーカス・変数詳細末尾まで到達可能、スクロール/オーバーフローでボタン欠落なし。
- **BV-13 Help/metadata:** 承認 SVGをXML parseし `viewBox` と全表示要素が境界内にあることを確認。新機能追加後の実画面を取得し、提案SVGと**差分理由を Issue に記録**。仕様、日英Help、status、文書Schema2検証 PASS。

## 8. Verification

リポジトリの依存と hooks を維持。実行順：

```bash
npm run compile
npm run test:unit
npm run check:help
npm run check:ai
npm test
npm run vscode:prepublish
npx @vscode/vsce ls
python3 -m agent_workflow validate-docs --issue 158
python3 -m agent_workflow verify-implementation-contract 158
git diff --check
```

- `npm test` は GUI の VS Code Extension Development Host を起動するため **`docs/agents/testing.md` に従い sandbox 外**で実施。バージョン／OS／locale／theme／viewport／GUI capture に必要なフラグを受入れ記録へ記載。
- `verify_final` の4コマンドと、追加BVユニット/E2E、実画面スクリーンショット、Help/AI syncがすべてPASSして初めてレビューへ。CDPなどの条件付き pending は **PASS とみなさない**。Windows / Linux、VoiceOver / NVDAなど未実施は明示。無根拠な「全環境完了」を禁止。
- 契約の図は現行 real screenshot ではない。実装者は同じ代表状態の**実 Extension Development Host** キャプチャと比較し、固定の現行 Preview 調整（48px/44px/42px/Practice）を検証する。

## 9. Reviewer Checklist（**実装前に公開、実装者が全行自己レビュー**）

- [ ] 仕様→設計→実装→status と日英Help/AI生成が同期。既存 `docs/specs/gui_design.md` の現行図を破壊しない。
- [ ] TextDocument だけが永続正本で、GUI側の独自ファイル保存モデルはない。
- [ ] 既存 Preview singleton・Inspector singleton・音声 lease の所有と lifecycle は不変。
- [ ] Parser がVisualSourceBinding、let参照位置、direct/indirectを所有。SVG座標からソースを推定しない。
- [ ] Preview編集OFFの譜面・toolbar・Practice/PDFの可視等価性を証明。
- [ ] コード、melody、rhythm、TAB、lyrics の GUI 編集とキーボード同等操作が動く。
- [ ] `let` 変数一覧、新規/編集/rename/clone/delete(未使用のみ)、参照ジャンプ、診断が動く。
- [ ] global定義編集とlocal detachを明示区別。入れ子、繰返し、ambiguous sourceを勝手に改変しない。
- [ ] 変更対象外 bytes、line endings、Unicode、comments、他参照が保たれ、1コミット=1Undo。
- [ ] URI/version/generation/revision/expected bytes、validation、double-apply、cancel、async Stop failureすべて拒否が正確。
- [ ] 既存 Preview一時カポ/初心者/transpose、Inspector progression、PDFと音声に回帰なし。
- [ ] ja/en、light/dark、狭幅、キーボード、ARIA/スクリーンリーダー、focus維持の証跡。
- [ ] 承認ベクターSVGと実Webview画像の差分・観点・限界が Issue に添付/記録。
- [ ] `verify_final`＋追加検証 PASS、未検証環境列挙、レビュー指摘自己解消済み。
- [ ] commit、push、`Closes #158` の PR を作成し、ラベル/Issue/PR を review stateへ遷移済み。

## 10. Completion Report（実装時に埋める）

- **PR URL:** 必須（なければ `BLOCKED`）
- **コミット / ブランチ / Issue-state / PR review-state:**
- **変更ファイルと UI 差分（提案SVG vs 実画面）:**
- **BV-01〜BV-13結果・reviewer checklist 全項目のセルフレビュー結果:**
- **実行したテストと各実行 HEAD / PASS・FAIL・NOT RUN:**
- **Windows/Linux、VoiceOver/NVDA、その他未実施条件:**
- **契約逸脱・新規発見事項（分類 A:契約違反 / B:曖昧 / C:新規要件 / D:任意改善）:**
- **残存障害、ブロッカー、残作業:**

実装コードだけ、テストだけ、pushだけでは**完了扱いしない**。PR作成・review状態への移行が失敗した場合、正確な手段／エラー／認証・権限上の障害を記して `BLOCKED` と報告する。