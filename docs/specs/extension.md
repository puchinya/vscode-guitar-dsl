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
現在対象となっている GuitarDSL ドキュメントのスコアをPDF形式でエクスポートする。

- **処理フロー**:
  1. 対象 GuitarDSL ドキュメントの解決（`showPreview` と同一規則）。
  2. ユーザーへファイル保存ダイアログを表示（デフォルト拡張子: `.pdf`）。
  3. ローカルシステム上のヘッドレスブラウザ（Chrome / Edge / Chromium / Brave 等）の存在を確認。
  4. 印刷用HTMLを一時ファイルに生成し、ブラウザをバックグラウンド実行（`--headless=new --print-to-pdf`）してPDFを出力。
  5. 出力完了後、完了通知および「ファイルを開く」アクションを表示。一時ファイルを安全に削除。
- **エラーハンドリング**:
  - 対象ブラウザが未インストールの場合はエラーメッセージを表示しインストールを促す。

---

## 4. プレビュー機能仕様 (Webview Preview Specification)

プレビュー画面は VS Code Webview API を使用して提供される。

### 4.1 リアルタイム同期と追従
- **編集追従**: 対象ドキュメントの編集イベント（`onDidChangeTextDocument`）を購読し、キーストロークによる変更をリアルタイムに再コンパイルしてプレビューへ反映する。
- **アクティブエディタ追従**: 別の GuitarDSL ファイルへエディタタブを切り替えた場合（`onDidChangeActiveTextEditor`）、プレビュー表示も自動的に切り替える。
- **表示状態の維持**: タブがバックグラウンドに回っても再描画コストや表示位置がリセットされないよう `retainContextWhenHidden: true` を有効化する。

### 4.2 プレビューUIとツールバー
プレビュー画面上部には以下の操作を提供するツールバーが配置される。

1. **ページ送りコントロール**:
   - `[< 前へ]` ボタン: 前のページへ遷移。
   - ページインジケーター: `X / Y ページ` を表示。
   - `[次へ >]` ボタン: 次のページへ遷移。
2. **表示モードセレクター (View Modes)**:
   - `連続スクロール (Continuous)`: 全ページを縦方向に連続して一覧表示するモード。
   - `単一ページ (Single Page)`: 1ページずつ大きく表示し、ページ送りで閲覧するモード。
   - `見開き2ページ (Spread 2 Pages)`: 見開き（2ページ並び）で表示するモード（横スクロールまたはページ送り）。
3. **印刷・PDF保存コントロール**:
   - `[印刷 / PDF保存]` ボタン: 印刷・PDF保存モーダルダイアログを開く。
   - 設定項目:
     - 用紙サイズ: `A4`, `A3`, `A5`, `B4`, `B5`, `Letter`
     - 用紙の向き: `縦 (Portrait)`, `横 (Landscape)`
   - 実行アクション:
     - `PDFとして保存`: 拡張機能ホストにメッセージ送信し、ヘッドレスブラウザ経由で高解像度PDFを出力。
     - `ブラウザで印刷`: システムの標準印刷ダイアログを起動（`window.print()`）。

### 4.3 楽譜レンダリング仕様
- **五線譜と音部記号**: ト音記号（FETA Treble Clef ベクターパス）を描画した五線譜。
- **リズムスラッシュ**: 拍の位置に応じたスラッシュノートヘッド。
- **ストローク記号**: スラッシュ上部にダウンストローク記号（門型記号）、アップストローク記号（V字記号）を描画。アクセント（`>`）およびゴーストノート（`()`）にも対応。
- **タイ・連符**: 符尾間のタイ弧線、および8分・16分音符の符桁（ビーム）または符尾（フラッグ）を正確に描画。
- **コードダイアグラム**: ヘッダー下部に、楽曲中で使用されているコードのギター指板ダイアグラム（フレット、押弦位置、ミュート記号、開放弦記号）を一覧表示。
- **改ページ (`pagebreak`)**: 楽譜中の改ページ指定に従い、独立したページ要素（`.page`）として分割出力。

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
