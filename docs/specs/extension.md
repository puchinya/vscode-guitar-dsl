# GuitarDSL 拡張機能仕様書 (GuitarDSL Extension Specification)

本書は、Visual Studio Code 拡張機能 **GuitarDSL Previewer** (`vscode-guitar-dsl`) の機能仕様、コマンド、エディタ統合、プレビュー画面およびPDFエクスポート等の外部振る舞いを定義する規範的仕様書（Normative Public Contract）である。

---

## 1. 概要 (Overview)

`vscode-guitar-dsl` は、ギター弾き語り・アコースティックギターストローク譜向けDSLである **GuitarDSL**（`.guitardsl`, `.gdsl`）の編集を支援し、リアルタイムでの五線・リズムスラッシュ楽譜プレビュー、印刷・PDF保存、およびシンタックスハイライトやアウトライン構造を提供する VS Code 拡張機能である。

- **拡張機能識別子 (Extension ID)**: `vscode-guitar-dsl`
- **表示名 (Display Name)**: `GuitarDSL Previewer`
- **対象プラットフォーム**: VS Code `^1.85.0` 以上（macOS, Windows, Linux）

---

## 2. 言語貢献仕様 (Language Contributions)

拡張機能は VS Code に対して以下の言語定義および文法貢献を行う。

### 2.1 言語識別子とファイル関連付け
- **言語ID (Language ID)**: `guitardsl`
- **エイリアス**: `GuitarDSL`, `guitardsl`
- **対象ファイル拡張子**:
  - `.guitardsl`
  - `.gdsl`

### 2.2 言語設定 (`language-configuration.json`)
- **コメント記号**: 行コメント `#`
- **括弧・ブラケットの自動補完・ペアリング**:
  - `[` と `]`（セクション見出し用）
  - `"` と `"`（歌詞トークン用）
  - `(` と `)`
- **自動インデント・クローズ**:
  - セクションブラケット `[...]` の自動クローズ

### 2.3 シンタックスハイライト (`syntaxes/guitardsl.tmLanguage.json`)
- **スコープ名**: `source.guitardsl`
- **構文要素の分類とハイライト規則**:
  - コメント: `#` から行末まで (`comment.line.number-sign.guitardsl`)
  - メタデータキー: `title:`, `artist:`, `capo:`, `key:`, `bpm:` 等 (`keyword.other.header.guitardsl`)
  - セクション見出し: `[Intro]`, `[Aメロ]` 等 (`entity.name.section.guitardsl`)
  - 小節線・反復記号: `|`, `|:`, `:|`, `|::|`, `||`, `%` (`punctuation.definition.bar.guitardsl`, `keyword.operator.repeat.guitardsl`)
  - コードネーム: `C`, `Am7`, `G/B`, `F#m7-5` 等 (`constant.other.chord.guitardsl`)
  - リズム指定子: `4`, `8`, `16`, `v`, `^`, `(v)`, `>v`, `_` (`keyword.operator.rhythm.guitardsl`)
  - 歌詞トークン: `l:"..."` (`string.quoted.double.lyric.guitardsl`)
  - 特殊記号・カッコ番号: `1.`, `2.`, `segno`, `coda`, `fine` (`keyword.control.navigation.guitardsl`)
  - 改ページ記号: `pagebreak` (`keyword.control.pagebreak.guitardsl`)
  - コード定義行: 行頭 `chord` (`keyword.other.chord-definition.guitardsl`)、コード名 (`entity.name.type.chord.guitardsl`)、`@ラベル` (`entity.other.attribute-name.chord-label.guitardsl`)、`=`、フレット文字列 (`constant.numeric.frets.guitardsl`)、`base:` `fingers:` `barre:` オプション (`variable.parameter.chord-option.guitardsl`)
  - 小節内のコードトークンは `@ラベル` を含めてコードネームとしてハイライトする（`C@barre:2`）
  - メロディ行: 行頭 `mel:` (`keyword.other.melody.guitardsl`)、音符 `e4/8` 等 (`constant.other.note.guitardsl`)、休符 (`constant.other.rest.guitardsl`)、解釈できないトークン (`invalid.illegal.note.guitardsl`)
  - 音節歌詞行: 行頭 `lyr:` (`keyword.other.lyrics.guitardsl`)、歌詞本文 (`string.unquoted.lyric.guitardsl`)、`_` `*` (`keyword.operator.melisma.guitardsl`)

---

## 3. コマンド仕様 (Commands)

拡張機能は以下の6つのコマンドを提供する。

| コマンドID | コマンドタイトル | 実行可能コンテキスト | アイコン |
|---|---|---|---|
| `guitardsl.showPreview` | `GuitarDSL: Open Preview to the Side` | エディタタイトルバー、エクスプローラーコンテキストメニュー、コマンドパレット | `$(open-preview)` |
| `guitardsl.exportPdf` | `GuitarDSL: Export PDF / Print` | コマンドパレット、プレビュー内ツールバー | - |
| `guitardsl.editChordDiagram` | `GuitarDSL: Edit Chord Diagram` | コマンドパレット、`chord` 行の CodeLens、プレビューのダイアグラムクリック | - |
| `guitardsl.transcribeYouTube` | `GuitarDSL: Transcribe from YouTube` | コマンドパレット | - |
| `guitardsl.setGeminiApiKey` | `GuitarDSL: Set Gemini API Key` | コマンドパレット | - |
| `guitardsl.clearGeminiApiKey` | `GuitarDSL: Clear Gemini API Key` | コマンドパレット | - |

### 3.1 `guitardsl.showPreview`
GuitarDSLファイルのスコアプレビューをエディタ横（`ViewColumn.Beside`）の Webview パネルとして開く。

- **対象ドキュメントの解決規則**:
  1. コマンド引数として URI が渡された場合はそのドキュメントを開く。
  2. 現在アクティブなエディタが GuitarDSL ドキュメントであればそのドキュメントを対象とする。
  3. 画面上に表示されているエディタ群の中から GuitarDSL ドキュメントを探索する。
  4. 直近にアクティブであった GuitarDSL ドキュメントが依然開かれていればそれを対象とする。
  5. ワークスペース内で開かれている GuitarDSL ドキュメントを探索する。
  6. いずれにも該当しない場合は警告通知メッセージを表示する。
- **パネルの多重起動防止**: Webview パネルはシングルトン（単一インスタンス）として管理され、既に開かれている場合は新設せず既存パネルを再表示（`reveal`）する。
- **配置メニュー**:
  - エディタ右上タイトルバーナビゲーション (`editor/title`, `group: navigation`)
  - ファイルエクスプローラーの右クリックメニュー (`explorer/context`, `group: navigation`)
  - 表示条件: 対象ファイルの言語IDが `guitardsl`、または拡張子が `.guitardsl`/`.gdsl` の場合。

### 3.2 `guitardsl.exportPdf`
現在対象となっている GuitarDSL ドキュメントのスコアをPDF形式でエクスポートする。外部ブラウザ（ヘッドレスブラウザ）は使用しない。

- **処理フロー**:
  1. 対象 GuitarDSL ドキュメントの解決（`showPreview` と同一規則）。
  2. ユーザーへファイル保存ダイアログを表示（デフォルト拡張子: `.pdf`）。
  3. プレビューと同一のページ SVG（§4.3）を生成し、拡張機能内でベクター PDF に変換して出力する（1 シート = 1 PDF ページ）。
     - 用紙サイズ・向き: プレビューから実行した場合はツールバーの選択値、コマンドパレットから実行した場合はプレビューで最後に選択された値（初期値 `A4` / 縦）。
  4. 出力完了後、完了通知および「ファイルを開く」アクションを表示。
- **フォント**: 拡張機能に同梱した Noto Sans JP（Regular / Bold、SIL Open Font License 1.1）を全テキストに使用し、使用文字のみをサブセット埋め込みする。OS のフォント環境やネットワーク接続に依存しない。
- **エラーハンドリング**:
  - 変換に失敗した場合はエラーメッセージを表示し、保存先に不完全なファイルを残さない。

### 3.3 `guitardsl.editChordDiagram`
コードダイアグラムエディタ（§4A）を開く。

- **引数**: `(uri?: Uri, key?: string)`。`key` は `コード名` または `コード名@ラベル`。
- **対象ドキュメント**: `showPreview` と同一規則（§3.1）。見つからない場合は警告を表示する。
- **`key` がない場合**（コマンドパレットから実行）: クイックピックを表示する。
  - 「ファイル内の定義」: 定義済みのキー（説明にフレット文字列）
  - 「使用中（未定義）」: 小節で使われているが定義のないキー
  - 「新規作成…」: 入力ボックスでキーを入力する（コード名・ラベルとして不正な値は入力時に検証エラー）
- **CodeLens**: 構文が正しい各 `chord` 定義行の上に「ダイアグラムを編集」を表示し、そのキーでこのコマンドを実行する。構文エラーの行には表示しない。
- **プレビュー**: プレビューのダイアグラムをクリックすると、そのダイアグラムのキーでこのコマンドを実行する。

### 3.4 `guitardsl.transcribeYouTube`
Gemini API の動画理解機能を活用し、YouTube の公開動画 URL から GuitarDSL 楽譜（コード、リズム、メロディ）を自動採譜して新しいエディタタブ（未保存ドキュメント）に開く。

- **実行コンテキスト**: コマンドパレットのみ。
- **前提条件・認証**:
  1. `ExtensionContext.secrets`（キー名: `guitardsl.geminiApiKey`）に保存された API キーを読み出す。
  2. 未設定の場合はマスキングされた入力ボックス（`showInputBox({ password: true })`）を表示し、キーの入力を促して保存する。キャンセルされた場合は処理を中止し副作用を生じさせない。
- **URL入力・バリデーション**:
  1. YouTube URL の入力ボックスを表示。
  2. 入力値は HTTPS かつ `youtube.com`、`www.youtube.com`、`youtu.be` のみを受け付ける。不正な URL は API 呼び出し前に拒絶する。
- **実行と進捗表示**:
  1. `window.withProgress` により進捗通知を表示。
  2. Gemini API（`@google/genai` の `interactions.create`）へ固定プロンプト、YouTube URL、および JSON Schema（Music IR）を送信。
  3. 受信したレスポンスの構造バリデーションおよびセマンティックバリデーション（BPM 30..300、4/4 拍子、各小節内合計 4 拍、コード名・音高妥当性）を実施。
  4. バリデーション済み IR を純粋シリアライザにより決定論的 GuitarDSL テキストへ変換。
  5. `parseGuitarDsl` により構文検証を実施し、エラー診断が 0 件であることを確認。
  6. 成功時のみ `workspace.openTextDocument({ language: 'guitardsl', content })` を呼び出し、`showTextDocument` で新規エディタとして開く。
  7. 既存ファイルの上書きや自動保存は行わない。
- **エラー処理**:
  - 不正な URL、認証・クォータ・ネットワーク・API エラー、非公開動画、無効な IR、非対応の拍子（4/4 以外）等の失敗時はドキュメントを作成せず、既存ファイルを一切変更しない。
  - API キー、モデルの生レスポンス、スタックトレースを含まない簡潔に分類されたエラーメッセージを通知する。自動リトライは行わない。

### 3.5 `guitardsl.setGeminiApiKey`
Gemini API キーを設定・更新する。

- **実行コンテキスト**: コマンドパレットのみ。
- **処理フロー**: マスキングされた入力ボックスを表示し、入力された文字列を `ExtensionContext.secrets`（`guitardsl.geminiApiKey`）に保存する。設定値（VS Code settings）には保存しない。キャンセル時は何もしない。

### 3.6 `guitardsl.clearGeminiApiKey`
保存された Gemini API キーを削除する。

- **実行コンテキスト**: コマンドパレットのみ。
- **処理フロー**: `ExtensionContext.secrets` から `guitardsl.geminiApiKey` を削除し、完了メッセージを表示する。次回の採譜実行時には API キーの入力が求められる。

### 3.7 設定仕様 (Configuration)
拡張機能は以下の設定項目を提供する。

| 設定キー | 型 | デフォルト値 | 説明 |
|---|---|---|---|
| `guitardsl.gemini.model` | `string` | `"gemini-3.8-flash"` | YouTube 音源の自動採譜に使用する Gemini モデル名。 |

---

## 4. プレビュー機能仕様 (Webview Preview Specification)

プレビュー画面は VS Code Webview API を使用して提供される。

### 4.1 リアルタイム同期と追従
- **編集追従**: 対象ドキュメントの編集イベント（`onDidChangeTextDocument`）を購読し、キーストロークによる変更をリアルタイムに再コンパイルしてプレビューへ反映する。
- **アクティブエディタ追従**: 別の GuitarDSL ファイルへエディタタブを切り替えた場合（`onDidChangeActiveTextEditor`）、プレビュー表示も自動的に切り替える。
- **表示状態の維持**: タブがバックグラウンドに回っても再描画コストや表示位置がリセットされないよう `retainContextWhenHidden: true` を有効化する。

### 4.2 プレビューUIとツールバー
プレビュー画面上部には以下の操作を提供するツールバー（HTML）が配置される。

1. **表示モードセレクター (View Modes)**:
   - `1ページ (Single Page)`: シートを1枚ずつ縦方向に並べて表示する。
   - `見開き (Spread)`: シートを2枚ずつ横に並べて表示する。
   - `Web`: ページ分割を行わず、楽譜全体を1枚の縦長 SVG で連続表示する。手動改ページ位置には `PAGE BREAK (n)` の区切り線を表示する。
2. **用紙設定**:
   - 用紙サイズ: `A4`, `A3`, `A5`, `B4`, `B5`, `Letter`
   - 用紙の向き: `縦 (Portrait)`, `横（見開き） (Landscape)`
   - 変更すると、選択した用紙サイズ・向きでプレビューを再レイアウトする。
3. **PDF保存ボタン**: 選択中の用紙サイズ・向きで `guitardsl.exportPdf` と同じ処理（§3.2）を実行する。

ヘッダーのコードダイアグラムはクリックでき（ポインタ表示、ホバー時に薄くハイライト）、クリックするとそのダイアグラムをコードダイアグラムエディタで開く（§3.3）。

### 4.3 楽譜レンダリング仕様
- **ページ SVG**: 各シート（物理ページ）を用紙サイズの単一 SVG として描画する。ヘッダー、コードダイアグラム、楽譜本体、ランニングヘッダー、フッターはすべて SVG 内に描画し、プレビューと PDF は同一の SVG から生成される。
  - 縦向き: 1 シートに 1 ページ。
  - 横向き: 1 シートに 2 ページを左右に配置する。
- **フォント**: 全テキストを同梱の Noto Sans JP で描画する。長いタイトルはヘッダー幅に収まるよう縮小し、なお収まらない場合は末尾を `…` で省略する。
- **1ページ目のヘッダー**: タイトル、アーティスト（`Words & Music: ...`）、`Key / BPM`、`Capo` バッジ、および楽曲中で使用されているコードのギター指板ダイアグラムの一覧（描画内容は `docs/specs/guitardsl-syntax.md` §7.3）。
- **2ページ目以降**: ランニングヘッダー（タイトル、`- n -`）。
- **フッター**: `n / 総ページ数`。
- **五線譜と音部記号**: ト音記号（FETA Treble Clef ベクターパス）を描画した五線譜。1 段 4 小節。
- **コード名**: 五線譜の上にコード名を描く。`@ラベル` 付きのコードは、コード名の右上にラベルを小さい灰色の上付き文字で添える（`docs/specs/guitardsl-syntax.md` §7.1）。
- **リズムスラッシュ**: 拍の位置に応じたスラッシュノートヘッド。
- **ストローク記号**: スラッシュ上部にダウンストローク記号（門型記号）、アップストローク記号（V字記号）を描画。アクセント（`>`）およびゴーストノート（`()`）にも対応。
- **タイ・連符**: 符尾間のタイ弧線、および8分・16分音符の符桁（ビーム）または符尾（フラッグ）を正確に描画。
- **改ページ**:
  - 手動: `pagebreak` 指定の位置で必ず新しいページを開始する。
  - 自動: 段がページの残り高さに収まらない場合、次のページへ送る。ページ番号・総ページ数は自動改ページ後のページ数に基づく。

---

## 4A. コードダイアグラムエディタ (Chord Diagram Editor)

`chord` 定義（`docs/specs/guitardsl-syntax.md` §7.4）を GUI で編集する Webview パネル。Guitar Pro のコードダイアグラムエディタに相当する。

### 4A.1 パネル
- アクティブなエディタグループに開く。パネルはシングルトンで、別のキーで開くと内容を置き換えて再表示する。タイトルは `コードダイアグラム編集: <キー>`。
- 開いたときの内容:
  - キーの `chord` 定義がある場合: その定義（編集中表示「n 行目の定義を編集中」）。
  - ない場合: そのキーの解決結果（§7.3）を初期値とする新規定義（表示「新規定義」）。コード名とラベルはキーから入れる。

### 4A.2 プリセット
- ルート（`C`〜`B` の 12 音）とタイプ（`maj m 7 maj7 m7 sus2 sus4 7sus4 6 m6 add9 9 m9 dim aug`）を選ぶと、プリセットライブラリ（§7.3）の押さえ方をダイアグラムのサムネイルで一覧表示する。
- サムネイルをクリックすると、その押さえ方（フレット、セーハ、開始フレット）をグリッドに読み込み、コード名を `ルート + タイプ` にする。指番号は消去し、ラベルは変えない。
- 開いたとき、コード名のルートとタイプがプリセットにあれば、それを選択した状態にする。

### 4A.3 指板グリッド
6 弦 × 5 フレットのグリッド。左に各フレットの番号を表示する。ツールを切り替えて編集する。
- **押弦**: マスをクリックすると、その弦をそのフレットで押弦する。押弦中のマスをもう一度クリックすると開放弦に戻す。
- **開放／ミュート**: ナットより上をクリックすると、その弦を開放 ⇔ ミュートに切り替える（押弦中なら開放にする）。
- **指番号**: 指（`1`〜`4`、`T`、消去）を選んでから押弦位置をクリックすると、その弦に指番号を付ける。
- **セーハ**: 同じフレットの 2 本の弦を順にクリックすると、その範囲のセーハを作る。範囲内でミュート・開放・より低いフレットの弦は、そのフレットの押弦にする。既存のセーハをクリックすると削除する。
- **クリア**: 全弦を開放にし、指番号とセーハを消す。
- **開始フレット**: 1〜20。グリッドの表示範囲を移動する。自動で決まる値（§7.4.1）と同じなら `base:` を書かない。

### 4A.4 名前・プレビュー・保存
- **コード名 / ラベル**: テキスト入力。ラベルが空欄ならラベルなし（既定の押さえ方）。
- **自動判定**: 鳴っている弦の音（標準チューニング EADGBE）から、コード名の候補を順位付きで表示する。候補は §7.1 の構文に合う名前だけで、構成音の集合がコードのタイプと一致するもの（7th・9th 系は 5 度の省略を許す）。最低音がルートでなければ分数コードにする。候補をクリックするとコード名に入れる。
- **プレビュー**: 楽譜と同じ描画で、編集中のダイアグラムを表示する。
- **DSL**: 保存される `chord` 行を表示する。定義として不正な場合（コード名が不正、押弦位置が 5 フレットに収まらない等）はエラー理由を表示し、保存ボタンを無効にする。
- **保存**:
  - 既存の定義を編集している場合は、その行を置き換える（行頭のインデントと行末コメントは残す）。
  - 新規の場合は、最後の `chord` 定義行の次に挿入する。定義行がなければ、最初のスコア行（セクション見出し、小節行、`mel:` / `lyr:`、改ページ）の前の空行の前に挿入する。スコア行がなければ末尾に追加する。
  - 保存後のキーが、編集中の行以外の定義と重複する場合は保存せず、エラーを表示する。
  - 保存はエディタの編集（元に戻せる）として行い、ファイルへの書き込みはしない。
- **別バリエーションとして保存**: 編集中の行を残したまま、新規として挿入する（ラベルを変えないと重複エラーになる）。
- **閉じる**: パネルを閉じる。
- 小節内の参照（`C@barre` 等）の書き換えは行わない。

---

## 5. アウトライン仕様 (DocumentSymbol Specification)

`GuitarDslDocumentSymbolProvider` により、VS Code の「アウトライン (Outline)」ビューおよび「シンボルへ移動 (Go to Symbol in File)」に楽譜の論理構造を提供する。

### 5.1 シンボル階層
- **メタデータシンボル**:
  - `SymbolKind.Property`
  - 楽曲メタデータ（`title`, `artist`, `key`, `capo`, `bpm` 等）をプロパティシンボルとしてツリー最上部に表示。
- **セクションシンボル**:
  - `SymbolKind.Namespace`
  - セクション見出し（`[Intro]`, `[Aメロ]`, `[Chorus]` 等）を行範囲として認識。
- **小節要約シンボル (Children)**:
  - `SymbolKind.Field`
  - セクション内に含まれる各小節行を展開し、含まれるコードネームの要約（例: `| C | G | Am | Em |`）を子シンボルとして一覧表示。
  - アウトライン項目をクリックすることで、エディタ上の該当セクションまたは小節へ即座にカーソルがジャンプする。

---

## 5A. 診断仕様 (Diagnostics)

- GuitarDSL 文書（言語 ID `guitardsl`）を開いたとき・編集したときに、コンパイラが検出した構文上の問題を VS Code の診断（「問題」パネルおよびエディタ上の波線）として表示する。
- 文書を閉じると、その文書の診断はクリアされる。
- 重大度は **エラー**（記述が無視される問題）と **警告**（描画は継続されるが意図とずれている可能性がある問題）の2種類。
- 診断メッセージはロケール（§6.1）に従い日本語または英語で表示する。
- 診断の対象（`docs/specs/guitardsl-syntax.md` 参照）:

| 重大度 | 内容 |
|---|---|
| エラー | 音名が大文字（§12.2） |
| エラー | 不正なメロディ音符（§12.2） |
| エラー | コード・メロディの長さ指定が不正（`/` の音価、`:` の拍数、§7.2, §12.2） |
| エラー | `mel:` 行の最初の音符でオクターブまたは長さが省略されている（§12.2） |
| エラー | `mel:` のセル数が未割り当て小節数を超えている（§12.3） |
| エラー | `mel:` の `%` の直前小節にメロディがない（§12.1） |
| エラー | `mel:` より前の `lyr:`（§13.1） |
| 警告 | 小節の合計拍数が 4 拍と一致しない（§8.2.1, §12.3） |
| 警告 | 歌詞の音節数と音符数の不一致、`\|` 位置の不一致（§13.2） |
| 警告 | 同一小節での `l:"..."` とメロディの併記（§9.2） |
| 警告 | `measures_per_row` の範囲外・不正値（§14.3） |
| エラー | 不正なコード定義（§7.4.3） |
| 警告 | コード定義の重複、定義のない `@ラベル` の参照（§7.4.3） |

---

## 6. 国際化・多言語対応仕様 (Internationalization / Localization)

拡張機能は日本語および英語の表示に対応する。

### 6.1 ロケール解決規則
- VS Code の環境設定 `vscode.env.language` を参照する。
- 言語コードが `ja` または `ja-` で始まる場合（大文字小文字問わず）は **日本語 (Japanese)** として解決する。
- それ以外のすべての言語コード（`en`, `fr`, `de`, `zh-cn`、または未設定等）は **英語 (English)** として解決する（「日本語以外は英語」規則）。

### 6.2 パッケージマニフェスト (`package.json`) のローカライズ
- コマンドタイトルなどの貢献項目テキストは NLS 形式（`%key%`）で参照し、以下のファイルにより多言語化する。
  - `package.nls.json`: デフォルト言語（英語）
  - `package.nls.ja.json`: 日本語
- 定義キー:
  - `%command.showPreview.title%`
  - `%command.exportPdf.title%`
  - `%command.editChordDiagram.title%`
  - `%command.transcribeYouTube.title%`
  - `%command.setGeminiApiKey.title%`
  - `%command.clearGeminiApiKey.title%`
  - `%config.geminiModel.description%`

### 6.3 拡張機能メッセージのローカライズ
- 以下のホスト側UIメッセージおよびダイアログは、解決されたロケールに従ってローカライズされる。
  - Webview パネルタイトル: `GuitarDSL Score Preview` (EN) / `GuitarDSL スコアプレビュー` (JA)
  - PDF保存ダイアログタイトル: `Save GuitarDSL Score as PDF` (EN) / `GuitarDSL スコアをPDFとして保存` (JA)
  - PDF保存完了通知およびアクションボタン「Open File」 / 「ファイルを開く」: 英語 / 日本語
  - 各種警告・エラー通知: 英語 / 日本語

### 6.4 Webview プレビューツールバーのローカライズ
- `compileGuitarDslToHtml(dslContent, options?: { locale?: string; pageSize?; orientation?; fontUris? })` を提供する（`src/render/previewHtml.ts`）。
- 指定されたロケールに従い、ツールバーの各コントロール（表示モード切替、用紙サイズ、向き切替、PDF保存ボタン）の表示ラベルおよびツールチップ（title 属性）をローカライズして描画する。
- 引数 `options` が省略された場合のデフォルトロケールは英語（`en`）とする。

### 6.5 コードダイアグラムエディタのローカライズ
- エディタパネルの全ラベル・説明・ボタン、CodeLens の表示、クイックピックと入力ボックスの文言、保存結果とエラーの表示をロケールに従ってローカライズする。

### 6.6 YouTube 自動採譜メッセージのローカライズ
- YouTube URL 入力ボックス、API キー入力プロンプト、進捗メッセージ、および各種エラー通知メッセージ（API エラー、URL 不正、バリデーション失敗等）をロケールに従ってローカライズする。

