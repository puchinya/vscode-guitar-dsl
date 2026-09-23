// Webview panel for YouTube transcription settings and execution GUI.
import * as vscode from 'vscode';
import { SupportedLocale, getMessages } from '../i18n';
import { isValidYouTubeUrl } from './youtube';
import { transcribeWithGemini } from './gemini';
import { serializeSongToGuitarDsl } from './serializer';
import { parseGuitarDsl } from '../compiler';

export class TranscribePanel {
  public static currentPanel: TranscribePanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private disposables: vscode.Disposable[] = [];

  public static createOrShow(
    extensionUri: vscode.Uri,
    secretStorage: vscode.SecretStorage,
    locale: SupportedLocale
  ): TranscribePanel {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : vscode.ViewColumn.One;

    if (TranscribePanel.currentPanel) {
      TranscribePanel.currentPanel.panel.reveal(column);
      return TranscribePanel.currentPanel;
    }

    const title = locale === 'ja' ? 'YouTubeから自動採譜' : 'Transcribe from YouTube';
    const panel = vscode.window.createWebviewPanel(
      'guitardslTranscribe',
      title,
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true
      }
    );

    TranscribePanel.currentPanel = new TranscribePanel(panel, extensionUri, secretStorage, locale);
    return TranscribePanel.currentPanel;
  }

  private constructor(
    panel: vscode.WebviewPanel,
    private readonly extensionUri: vscode.Uri,
    private readonly secretStorage: vscode.SecretStorage,
    private readonly locale: SupportedLocale
  ) {
    this.panel = panel;
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage(
      message => this.handleMessage(message),
      null,
      this.disposables
    );

    this.initHtml();
  }

  private async initHtml(): Promise<void> {
    const apiKey = (await this.secretStorage.get('guitardsl.geminiApiKey')) || '';
    const config = vscode.workspace.getConfiguration('guitardsl');
    const model = config.get<string>('gemini.model') || 'gemini-3.8-flash';
    const compressRepeats = config.get<boolean>('transcription.compressRepeats') ?? false;

    this.panel.webview.html = this.getHtmlContent({
      hasApiKey: !!apiKey,
      model,
      compressRepeats,
      locale: this.locale
    });
  }

  private async handleMessage(message: any): Promise<void> {
    switch (message.command) {
      case 'saveApiKey': {
        const key = message.apiKey?.trim();
        if (key) {
          await this.secretStorage.store('guitardsl.geminiApiKey', key);
          this.panel.webview.postMessage({ type: 'apiKeySaved', success: true });
        }
        break;
      }
      case 'clearApiKey': {
        await this.secretStorage.delete('guitardsl.geminiApiKey');
        this.panel.webview.postMessage({ type: 'apiKeyCleared', success: true });
        break;
      }
      case 'startTranscription': {
        await this.runTranscription(message.options);
        break;
      }
    }
  }

  private async runTranscription(options: {
    youtubeUrl: string;
    apiKey?: string;
    bpmMode: 'auto' | 'manual';
    bpmValue?: number;
    capoMode: 'auto' | 'manual';
    capoValue?: number;
    compressRepeats: boolean;
    model: string;
  }): Promise<void> {
    const isJa = this.locale === 'ja';
    let apiKey = (await this.secretStorage.get('guitardsl.geminiApiKey')) || '';
    if (options.apiKey && options.apiKey.trim()) {
      apiKey = options.apiKey.trim();
      await this.secretStorage.store('guitardsl.geminiApiKey', apiKey);
    }

    if (!apiKey) {
      this.panel.webview.postMessage({
        type: 'error',
        message: isJa
          ? 'Gemini API キーを設定してください。'
          : 'Please configure your Gemini API key.'
      });
      return;
    }

    const url = options.youtubeUrl?.trim() || '';
    if (!isValidYouTubeUrl(url)) {
      this.panel.webview.postMessage({
        type: 'error',
        message: isJa
          ? '有効なYouTube動画のURL（https://...）を入力してください。'
          : 'Please enter a valid YouTube URL (https://...).'
      });
      return;
    }

    this.panel.webview.postMessage({ type: 'transcribing' });

    try {
      const song = await transcribeWithGemini({
        apiKey,
        youtubeUrl: url,
        model: options.model
      });

      // Override BPM if manually specified
      if (options.bpmMode === 'manual' && options.bpmValue && options.bpmValue >= 30 && options.bpmValue <= 300) {
        song.bpm = Math.round(options.bpmValue);
      }

      // Override Capo if manually specified
      if (options.capoMode === 'manual' && options.capoValue !== undefined && options.capoValue >= 0 && options.capoValue <= 12) {
        song.capo = options.capoValue;
      }

      const dslText = serializeSongToGuitarDsl(song, {
        compressRepeats: options.compressRepeats
      });

      const parsed = parseGuitarDsl(dslText);
      const errors = parsed.diagnostics.filter(d => d.severity === 'error');
      if (errors.length > 0) {
        throw new Error(`Compiler validation failed: ${errors.map(e => e.code).join(', ')}`);
      }

      this.panel.webview.postMessage({ type: 'success' });

      // Open new document with generated GuitarDSL
      const doc = await vscode.workspace.openTextDocument({
        language: 'guitardsl',
        content: dslText
      });
      await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
    } catch (err: any) {
      this.panel.webview.postMessage({
        type: 'error',
        message: err?.message || 'Transcription failed'
      });
    }
  }

  public dispose(): void {
    TranscribePanel.currentPanel = undefined;
    this.panel.dispose();
    while (this.disposables.length) {
      const x = this.disposables.pop();
      if (x) x.dispose();
    }
  }

  private getHtmlContent(ctx: {
    hasApiKey: boolean;
    model: string;
    compressRepeats: boolean;
    locale: SupportedLocale;
  }): string {
    const isJa = ctx.locale === 'ja';

    return `<!DOCTYPE html>
<html lang="${ctx.locale}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${isJa ? 'YouTubeから自動採譜' : 'Transcribe from YouTube'}</title>
  <style>
    :root {
      --vscode-font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }
    body {
      font-family: var(--vscode-font-family);
      padding: 24px 32px;
      max-width: 680px;
      margin: 0 auto;
      color: var(--vscode-foreground);
      background-color: var(--vscode-editor-background);
      line-height: 1.5;
    }
    h2 {
      margin-top: 0;
      margin-bottom: 8px;
      font-size: 1.4em;
      border-bottom: 1px solid var(--vscode-panel-border, #ccc);
      padding-bottom: 8px;
    }
    .desc {
      color: var(--vscode-descriptionForeground, #888);
      font-size: 0.9em;
      margin-bottom: 24px;
    }
    .section-title {
      font-weight: 600;
      margin-top: 20px;
      margin-bottom: 8px;
      font-size: 1em;
    }
    .field-group {
      margin-bottom: 18px;
    }
    label {
      display: block;
      font-weight: 500;
      margin-bottom: 6px;
      font-size: 0.9em;
    }
    input[type="text"], input[type="password"], input[type="number"], select {
      width: 100%;
      box-sizing: border-box;
      padding: 8px 10px;
      background: var(--vscode-input-background, #fff);
      color: var(--vscode-input-foreground, #000);
      border: 1px solid var(--vscode-input-border, #ccc);
      border-radius: 4px;
      font-size: 0.95em;
    }
    input:focus, select:focus {
      outline: 1px solid var(--vscode-focusBorder, #007acc);
    }
    .inline-row {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-top: 6px;
    }
    .inline-row input[type="number"] {
      width: 100px;
    }
    .checkbox-label {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      font-weight: normal;
      cursor: pointer;
      margin-top: 6px;
    }
    .checkbox-label input {
      margin-top: 3px;
    }
    .btn-primary {
      background: var(--vscode-button-background, #007acc);
      color: var(--vscode-button-foreground, #fff);
      border: none;
      padding: 10px 20px;
      border-radius: 4px;
      font-size: 1em;
      font-weight: 600;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      margin-top: 16px;
    }
    .btn-primary:hover {
      background: var(--vscode-button-hoverBackground, #0062a3);
    }
    .btn-secondary {
      background: var(--vscode-button-secondaryBackground, #5a5d5e);
      color: var(--vscode-button-secondaryForeground, #fff);
      border: none;
      padding: 6px 12px;
      border-radius: 3px;
      font-size: 0.85em;
      cursor: pointer;
    }
    .btn-secondary:hover {
      background: var(--vscode-button-secondaryHoverBackground, #464849);
    }
    .status-box {
      margin-top: 20px;
      padding: 12px 16px;
      border-radius: 4px;
      display: none;
    }
    .status-box.error {
      display: block;
      background: rgba(255, 0, 0, 0.1);
      border: 1px solid #e74c3c;
      color: #e74c3c;
    }
    .status-box.loading {
      display: flex;
      align-items: center;
      gap: 12px;
      background: rgba(0, 122, 204, 0.1);
      border: 1px solid #007acc;
      color: var(--vscode-foreground);
    }
    .spinner {
      border: 3px solid rgba(0, 0, 0, 0.1);
      width: 20px;
      height: 20px;
      border-radius: 50%;
      border-left-color: #007acc;
      animation: spin 1s linear infinite;
    }
    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
    .tag {
      display: inline-block;
      padding: 2px 6px;
      border-radius: 3px;
      font-size: 0.75em;
      background: var(--vscode-badge-background, #4d4d4d);
      color: var(--vscode-badge-foreground, #fff);
      margin-left: 6px;
    }
  </style>
</head>
<body>
  <h2>🎸 ${isJa ? 'YouTube 音源から自動採譜' : 'Transcribe from YouTube'}</h2>
  <div class="desc">${isJa ? 'Gemini AI を使用してYouTubeの動画からコード、ストロークリズム、メロディ五線譜、歌詞を解析し、GuitarDSL楽譜を自動生成します。' : 'Uses Gemini AI to transcribe guitar chords, strumming rhythms, vocal melody, and lyrics from YouTube into GuitarDSL.'}</div>

  <div class="field-group">
    <label for="youtubeUrl">${isJa ? 'YouTube 動画 URL' : 'YouTube Video URL'} <span style="color:#e74c3c">*</span></label>
    <input type="text" id="youtubeUrl" placeholder="https://www.youtube.com/watch?v=..." autofocus />
  </div>

  <div class="field-group">
    <label for="apiKey">Gemini API Key <span style="color:#e74c3c">*</span></label>
    <div style="display:flex; gap:8px;">
      <input type="password" id="apiKey" placeholder="${ctx.hasApiKey ? (isJa ? '保存済み（変更する場合のみ入力）' : 'Saved (enter only to change)') : 'AIzaSy...'}" />
      <button class="btn-secondary" id="btnSaveKey">${isJa ? 'キーを保存' : 'Save Key'}</button>
      ${ctx.hasApiKey ? `<button class="btn-secondary" id="btnClearKey">${isJa ? '削除' : 'Clear'}</button>` : ''}
    </div>
  </div>

  <div class="section-title">⚙️ ${isJa ? '採譜設定 (オプション)' : 'Transcription Options'}</div>

  <div class="field-group">
    <label>${isJa ? 'テンポ (BPM)' : 'Tempo (BPM)'}</label>
    <div class="inline-row">
      <label style="font-weight:normal; margin-bottom:0; display:flex; align-items:center; gap:4px; cursor:pointer;">
        <input type="radio" name="bpmMode" value="auto" checked /> ${isJa ? 'AIによる自動検出' : 'Auto Detect'}
      </label>
      <label style="font-weight:normal; margin-bottom:0; display:flex; align-items:center; gap:4px; cursor:pointer;">
        <input type="radio" name="bpmMode" value="manual" /> ${isJa ? '指定:' : 'Specify:'}
      </label>
      <input type="number" id="bpmValue" min="30" max="300" placeholder="185" disabled />
    </div>
    <div class="desc" style="margin-top:4px; margin-bottom:0;">
      ${isJa ? '※アップテンポな8ビート（PLAYERS等）でBPMが分かっている場合は数値を指定すると正確に反映されます。' : 'Specify BPM if you already know the exact tempo of fast 8-beat songs.'}
    </div>
  </div>

  <div class="field-group">
    <label>${isJa ? 'カポタスト (Capo)' : 'Capo'}</label>
    <div class="inline-row">
      <label style="font-weight:normal; margin-bottom:0; display:flex; align-items:center; gap:4px; cursor:pointer;">
        <input type="radio" name="capoMode" value="auto" checked /> ${isJa ? '自動判定（押さえやすいオープンコードを提案）' : 'Auto Recommend'}
      </label>
      <label style="font-weight:normal; margin-bottom:0; display:flex; align-items:center; gap:4px; cursor:pointer;">
        <input type="radio" name="capoMode" value="manual" /> ${isJa ? 'カポ指定:' : 'Capo:'}
      </label>
      <input type="number" id="capoValue" min="0" max="12" placeholder="0" disabled />
    </div>
  </div>

  <div class="field-group">
    <label class="checkbox-label">
      <input type="checkbox" id="compressRepeats" ${ctx.compressRepeats ? 'checked' : ''} />
      <span>
        <strong>${isJa ? '繰り返し区間を圧縮して楽譜を短縮（複数行歌詞）' : 'Compress repeated sections (multi-line lyrics)'}</strong><br/>
        <span style="font-size:0.85em; color:var(--vscode-descriptionForeground, #888);">
          ${isJa ? '同一のコード進行・メロディを持つセクション（1番・2番のAメロ等）をリピート記号（|: :|）と複数行歌詞にまとめてコンパクトに出力します。' : 'Combine identical chord/melody sections into repeat barlines (|: :|) with 1st and 2nd verse lyrics.'}
        </span>
      </span>
    </label>
  </div>

  <div class="field-group">
    <label for="modelSelect">${isJa ? 'AIモデル' : 'AI Model'}</label>
    <select id="modelSelect">
      <option value="gemini-3.8-flash" ${ctx.model === 'gemini-3.8-flash' ? 'selected' : ''}>Gemini 3.8 Flash (${isJa ? '推奨・高速高精度' : 'Recommended, fast & accurate'})</option>
      <option value="gemini-2.5-pro" ${ctx.model === 'gemini-2.5-pro' ? 'selected' : ''}>Gemini 2.5 Pro</option>
    </select>
  </div>

  <button class="btn-primary" id="btnStart">
    <span>▶ ${isJa ? '採譜を開始する' : 'Start Transcription'}</span>
  </button>

  <div class="status-box" id="statusBox">
    <div class="spinner"></div>
    <div id="statusText">${isJa ? 'GeminiでYouTube音源を解析中... (30〜60秒ほどかかります)' : 'Analyzing YouTube audio with Gemini...'}</div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();

    const bpmRadios = document.querySelectorAll('input[name="bpmMode"]');
    const bpmValue = document.getElementById('bpmValue');
    bpmRadios.forEach(r => r.addEventListener('change', () => {
      bpmValue.disabled = (r.value === 'auto' && r.checked);
      if (!bpmValue.disabled) bpmValue.focus();
    }));

    const capoRadios = document.querySelectorAll('input[name="capoMode"]');
    const capoValue = document.getElementById('capoValue');
    capoRadios.forEach(r => r.addEventListener('change', () => {
      capoValue.disabled = (r.value === 'auto' && r.checked);
      if (!capoValue.disabled) capoValue.focus();
    }));

    document.getElementById('btnSaveKey').addEventListener('click', () => {
      const key = document.getElementById('apiKey').value;
      if (key) {
        vscode.postMessage({ command: 'saveApiKey', apiKey: key });
      }
    });

    const btnClear = document.getElementById('btnClearKey');
    if (btnClear) {
      btnClear.addEventListener('click', () => {
        vscode.postMessage({ command: 'clearApiKey' });
      });
    }

    const btnStart = document.getElementById('btnStart');
    const statusBox = document.getElementById('statusBox');
    const statusText = document.getElementById('statusText');

    btnStart.addEventListener('click', () => {
      const url = document.getElementById('youtubeUrl').value;
      const key = document.getElementById('apiKey').value;
      const bpmMode = document.querySelector('input[name="bpmMode"]:checked').value;
      const bpmVal = parseInt(bpmValue.value, 10);
      const capoMode = document.querySelector('input[name="capoMode"]:checked').value;
      const capoVal = parseInt(capoValue.value, 10);
      const compressRepeats = document.getElementById('compressRepeats').checked;
      const model = document.getElementById('modelSelect').value;

      vscode.postMessage({
        command: 'startTranscription',
        options: {
          youtubeUrl: url,
          apiKey: key,
          bpmMode,
          bpmValue: isNaN(bpmVal) ? undefined : bpmVal,
          capoMode,
          capoValue: isNaN(capoVal) ? undefined : capoVal,
          compressRepeats,
          model
        }
      });
    });

    window.addEventListener('message', event => {
      const msg = event.data;
      if (msg.type === 'transcribing') {
        statusBox.className = 'status-box loading';
        statusText.textContent = '${isJa ? 'GeminiでYouTube音源を解析中... (30〜60秒ほどかかります)' : 'Analyzing YouTube audio with Gemini...'}';
        btnStart.disabled = true;
      } else if (msg.type === 'error') {
        statusBox.className = 'status-box error';
        statusText.textContent = '❌ ' + msg.message;
        btnStart.disabled = false;
      } else if (msg.type === 'success') {
        statusBox.className = 'status-box';
        statusBox.style.display = 'none';
        btnStart.disabled = false;
      } else if (msg.type === 'apiKeySaved') {
        alert('${isJa ? 'Gemini API キーを保存しました。' : 'Gemini API key saved.'}');
      } else if (msg.type === 'apiKeyCleared') {
        alert('${isJa ? 'Gemini API キーを削除しました。' : 'Gemini API key cleared.'}');
      }
    });
  </script>
</body>
</html>`;
  }
}
