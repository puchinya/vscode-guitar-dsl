# vscode-guitar-dsl (GuitarDSL Previewer)

シンコー・ミュージック風の「五線譜 ＋ リズムスラッシュ ＋ ピッキング記号（п / ∨）＋ コードダイアグラム ＋ 歌詞」をリアルタイムにプレビュー・A4印刷できる VS Code 拡張機能です。

## 特徴
- `.guitardsl` ファイルのシンタックスハイライト
- 横分割 Webview によるリアルタイム SVG レンダリング
- 外部 CDN やインターネット接続不要の完全スタンドアロン動作
- ワンクリックで PDF 保存（外部ブラウザ不要。A4/A3/A5/B4/B5/Letter、縦・横見開き）
- メロディライン（`mel:`）と音符単位の歌詞（`lyr:`）、調号、リードシート表示（`samples/sample_melody.guitardsl`, `samples/sample_leadsheet.guitardsl`。使える音符・記号の一覧は `samples/sample_notes.guitardsl`）
- 記述ミスをエディタの「問題」パネルに表示
- コードダイアグラムの定義（`chord C@barre = x35553 ...`）と `@ラベル` による押さえ方の使い分け、Guitar Pro 風の GUI エディタ（プリセット、指番号、セーハ、コード名の自動判定）。プレビューのダイアグラムをクリック、`chord` 行の CodeLens、または `GuitarDSL: Edit Chord Diagram` で開く（`samples/sample_voicings.guitardsl`、サンプル曲 `samples/sample_voicing_song.guitardsl`）

- （実験的）ローカル音源からの採譜: `GuitarDSL: Transcribe Local Audio (Experimental)` で PCM WAV（16/24 bit、44.1/48 kHz、モノラル/ステレオ、15 分・128 MiB 以内）を選ぶと、ネットワークや API キーなしで Rust/WASM の解析エンジンがコード進行（16 分単位）とストロークの位置（8 分 / 3 連 / 16 分グリッド）を推定し、未保存の GuitarDSL を開きます。4/4 のみ対応です。ダウン/アップはグリッド位置からの推定で、小節をまたぐサステイン・ゴースト・アルペジオは判別しません。分数コードは出力せず、コード推定の精度はまだ検証中です。

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
   ローカル音源採譜の解析エンジン（`wasm/` の Rust ワークスペース）をビルドするには、Rust（rustup の `wasm32-unknown-unknown` ターゲット）と `wasm-pack` が必要です:
   ```bash
   npm run build:audio-mir      # media/audio-mir-wasm/ に生成（コミットしない）
   npm run test:audio-mir-wasm  # 生成された WASM の Node スモークテスト
   ```
   実際の曲で定量評価するには `node scripts/evaluate-audio-mir.mjs <audio.wav> <reference.lab> [--bpm <n>]` を実行します（音源と LAB はコミットしないでください）。
3. VS Code で本フォルダを開き、`F5` キーを押すと拡張機能開発ホストが起動します。
4. 開発ホスト側で `samples/sample.guitardsl` を開き、右上のプレビューボタン（または `Ctrl+Shift+P` -> `GuitarDSL: Open Preview to the Side`）を実行してください。
