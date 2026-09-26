import { ScoreSettingsEditorMessages } from '../i18n';
import { escapeXml } from './notation';

/** Static shell of the score settings editor webview; media/scoreSettingsEditor.js renders sections via messages. */
export function renderScoreSettingsEditorHtml(m: ScoreSettingsEditorMessages, scriptUri: string, lang: string): string {
  const json = JSON.stringify(m).replace(/</g, '\\u003c');
  const t = (s: string) => escapeXml(s);

  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${t(m.panelTitle)}</title>
<style>
  body { font-family: var(--vscode-font-family); font-size: 13px; color: var(--vscode-foreground); background: var(--vscode-editor-background); margin: 0; padding: 12px 16px; }
  h2 { font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--vscode-descriptionForeground); margin: 14px 0 6px; font-weight: 600; }
  [hidden] { display: none !important; }
  button { font: inherit; cursor: pointer; }
  .tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--vscode-panel-border, #444); margin-bottom: 12px; }
  .tab { background: none; border: none; border-bottom: 2px solid transparent; color: var(--vscode-foreground); padding: 6px 10px; }
  .tab.active { border-bottom-color: var(--vscode-focusBorder); font-weight: 600; }
  .layout { display: flex; gap: 24px; align-items: flex-start; flex-wrap: wrap; }
  .col { flex: 1 1 320px; min-width: 280px; }
  .summary { display: flex; gap: 16px; flex-wrap: wrap; margin-bottom: 8px; }
  .summary b { font-size: 15px; }
  table { border-collapse: collapse; width: 100%; }
  th, td { text-align: left; padding: 4px 8px; border-bottom: 1px solid var(--vscode-panel-border, #333); white-space: nowrap; }
  th { color: var(--vscode-descriptionForeground); font-weight: 600; font-size: 12px; }
  tr.candidate { cursor: pointer; }
  tr.candidate:hover { background: var(--vscode-list-hoverBackground); }
  tr.candidate.selected { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
  tr.candidate.unsupported { opacity: 0.55; cursor: default; }
  .badge { display: inline-block; border-radius: 8px; padding: 0 6px; font-size: 11px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); margin-left: 4px; }
  .chips { display: flex; flex-wrap: wrap; gap: 4px; }
  .chip { border: 1px solid var(--vscode-panel-border, #555); border-radius: 3px; padding: 1px 6px; font-family: var(--vscode-editor-font-family); }
  .mapping td { font-family: var(--vscode-editor-font-family); }
  .warn { color: var(--vscode-editorWarning-foreground, #cca700); }
  .error { color: var(--vscode-errorForeground); min-height: 1.2em; }
  .status { margin-top: 8px; min-height: 1.2em; color: var(--vscode-descriptionForeground); }
  .status.error { color: var(--vscode-errorForeground); }
  .actions { margin-top: 12px; display: flex; gap: 6px; flex-wrap: wrap; }
  .primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; border-radius: 2px; padding: 5px 12px; }
  .primary:disabled { opacity: 0.5; cursor: default; }
  .secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); border: none; border-radius: 2px; padding: 5px 12px; }
</style>
</head>
<body>
<script id="l10n" type="application/json">${json}</script>
<nav class="tabs" id="tabs" role="tablist"></nav>
<main id="section"></main>
<div class="actions">
  <button class="primary" id="btn-apply" disabled>${t(m.apply)}</button>
  <button class="secondary" id="btn-close">${t(m.close)}</button>
</div>
<div class="status" id="status" role="status"></div>
<script src="${scriptUri}"></script>
</body>
</html>`;
}
