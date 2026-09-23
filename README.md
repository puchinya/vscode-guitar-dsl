# vscode-guitar-dsl (GuitarDSL Previewer)

シンコー・ミュージック風の「五線譜 ＋ リズムスラッシュ ＋ ピッキング記号（п / ∨）＋ コードダイアグラム ＋ 歌詞」をリアルタイムにプレビュー・A4印刷できる VS Code 拡張機能です。

## 特徴
- `.guitardsl` ファイルのシンタックスハイライト
- 横分割 Webview によるリアルタイム SVG レンダリング
- 外部 CDN やインターネット接続不要の完全スタンドアロン動作
- ワンクリックでブラウザ印刷ダイアログを起動し、A4 PDF 保存可能

## 使い方・開発
1. 依存ライブラリのインストール:
   ```bash
   npm install
   ```
2. TypeScript のビルド:
   ```bash
   npm run compile
   ```
3. VS Code で本フォルダを開き、`F5` キーを押すと拡張機能開発ホストが起動します。
4. 開発ホスト側で `samples/sample.guitardsl` を開き、右上のプレビューボタン（または `Ctrl+Shift+P` -> `GuitarDSL: Open Preview to the Side`）を実行してください。
