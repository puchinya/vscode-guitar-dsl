# vscode-guitar-dsl (GuitarDSL Previewer)

シンコー・ミュージック風の「五線譜 ＋ リズムスラッシュ ＋ ピッキング記号（п / ∨）＋ コードダイアグラム ＋ 歌詞」をリアルタイムにプレビュー・A4印刷できる VS Code 拡張機能です。

## 特徴
- `.guitardsl` ファイルのシンタックスハイライト
- 横分割 Webview によるリアルタイム SVG レンダリング
- 外部 CDN やインターネット接続不要の完全スタンドアロン動作
- ワンクリックで PDF 保存（外部ブラウザ不要。A4/A3/A5/B4/B5/Letter、縦・横見開き）

## ライセンス表記
- 同梱フォント `media/fonts/NotoSansJP-*.ttf`（Noto Sans JP）は SIL Open Font License 1.1 に従います（`media/fonts/OFL.txt`）。

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
