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
  - メロディ行: 行頭 `mel:` (`keyword.other.melody.guitardsl`)、音符 `e4/8` 等 (`constant.other.note.guitardsl`)、休符 (`constant.other.rest.guitardsl`)、解釈できないトークン (`invalid.illegal.note.guitardsl`)
  - 音節歌詞行: 行頭 `lyr:` (`keyword.other.lyrics.guitardsl`)、歌詞本文 (`string.unquoted.lyric.guitardsl`)、`_` `*` (`keyword.operator.melisma.guitardsl`)

---

## 3. コマンド仕様 (Commands)

拡張機能は以下の2つのコマンドを提供する。

| コマンドID | コマンドタイトル | 実行可能コンテキスト | アイコン |
|---|---|---|---|
| `guitardsl.showPreview` | `GuitarDSL: Open Preview to the Side` | エディタタイトルバー、エクスプローラーコンテキストメニュー、コマンドパレット | `$(open-preview)` |
| `guitardsl.exportPdf` | `GuitarDSL: Export PDF / Print` | コマンドパレット、プレビュー内ツールバー | - |

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

### 4.3 楽譜レンダリング仕様
- **ページ SVG**: 各シート（物理ページ）を用紙サイズの単一 SVG として描画する。ヘッダー、コードダイアグラム、楽譜本体、ランニングヘッダー、フッターはすべて SVG 内に描画し、プレビューと PDF は同一の SVG から生成される。
  - 縦向き: 1 シートに 1 ページ。
  - 横向き: 1 シートに 2 ページを左右に配置する。
- **フォント**: 全テキストを同梱の Noto Sans JP で描画する。長いタイトルはヘッダー幅に収まるよう縮小し、なお収まらない場合は末尾を `…` で省略する。
- **1ページ目のヘッダー**: タイトル、アーティスト（`Words & Music: ...`）、`Key / BPM`、`Capo` バッジ、および楽曲中で使用されているコードのギター指板ダイアグラム（フレット、押弦位置、ミュート記号、開放弦記号）の一覧。
- **2ページ目以降**: ランニングヘッダー（タイトル、`- n -`）。
- **フッター**: `n / 総ページ数`。
- **五線譜と音部記号**: ト音記号（FETA Treble Clef ベクターパス）を描画した五線譜。1 段 4 小節。
- **リズムスラッシュ**: 拍の位置に応じたスラッシュノートヘッド。
- **ストローク記号**: スラッシュ上部にダウンストローク記号（門型記号）、アップストローク記号（V字記号）を描画。アクセント（`>`）およびゴーストノート（`()`）にも対応。
- **タイ・連符**: 符尾間のタイ弧線、および8分・16分音符の符桁（ビーム）または符尾（フラッグ）を正確に描画。
- **改ページ**:
  - 手動: `pagebreak` 指定の位置で必ず新しいページを開始する。
  - 自動: 段がページの残り高さに収まらない場合、次のページへ送る。ページ番号・総ページ数は自動改ページ後のページ数に基づく。

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

