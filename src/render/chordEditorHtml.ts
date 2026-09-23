import { ChordEditorMessages } from '../i18n';
import { escapeXml } from './notation';

/** Static shell of the chord diagram editor webview; media/chordEditor.js fills it via messages. */
export function renderChordEditorHtml(m: ChordEditorMessages, scriptUri: string, lang: string): string {
  const l10n: Record<string, string> = {};
  for (const [k, v] of Object.entries(m)) {
    if (typeof v === 'string') l10n[k] = v;
  }
  const json = JSON.stringify(l10n).replace(/</g, '\\u003c');
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
  h2:first-child { margin-top: 0; }
  .layout { display: flex; gap: 20px; align-items: flex-start; flex-wrap: wrap; }
  .presets { flex: 1 1 280px; min-width: 260px; max-width: 460px; }
  .editor { flex: 0 1 auto; }
  .side { flex: 1 1 220px; min-width: 200px; }
  [hidden] { display: none !important; }
  button { font: inherit; cursor: pointer; }
  .chip, .tool-btn { border: 1px solid var(--vscode-button-secondaryBackground, #555); background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); border-radius: 3px; padding: 2px 8px; margin: 0 4px 4px 0; min-width: 32px; }
  .chip.active, .tool-btn.active { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border-color: var(--vscode-focusBorder); }
  .chip:focus-visible, .tool-btn:focus-visible, .preset:focus-visible, .primary:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 1px; }
  .preset-items { display: flex; flex-wrap: wrap; gap: 6px; max-height: 360px; overflow-y: auto; }
  .preset { background: #fff; border: 1px solid transparent; border-radius: 4px; padding: 2px; line-height: 0; }
  .preset:hover { border-color: var(--vscode-focusBorder); }
  .paper { background: #fff; border-radius: 4px; display: inline-block; padding: 6px; }
  #grid .hit { fill: transparent; cursor: pointer; }
  #grid .cell:hover { fill: rgba(0, 120, 212, 0.12); }
  #grid .cell.pending { fill: rgba(0, 120, 212, 0.25); }
  #grid .nut { stroke: #000; stroke-width: 6; }
  #grid .fret { stroke: #888; stroke-width: 1.5; }
  #grid .string { stroke: #000; stroke-width: 1.2; pointer-events: none; }
  #grid .dot, #grid .barre { fill: #000; pointer-events: none; }
  #grid .open { fill: none; stroke: #000; stroke-width: 1.6; pointer-events: none; }
  #grid .marker { font-size: 18px; fill: #000; pointer-events: none; }
  #grid .fret-no { font-size: 12px; fill: #666; }
  #grid .finger { font-size: 13px; font-weight: bold; fill: #fff; pointer-events: none; }
  .row { display: flex; align-items: center; gap: 6px; margin-bottom: 8px; flex-wrap: wrap; }
  .row label { min-width: 84px; color: var(--vscode-descriptionForeground); }
  input[type=text], input[type=number] { font: inherit; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, transparent); padding: 3px 6px; border-radius: 2px; }
  input[type=number] { width: 52px; }
  .help { color: var(--vscode-descriptionForeground); font-size: 12px; margin: 4px 0 8px; max-width: 300px; }
  code#dsl-line { display: block; font-family: var(--vscode-editor-font-family); background: var(--vscode-textCodeBlock-background); padding: 6px 8px; border-radius: 3px; word-break: break-all; }
  .error, #error { color: var(--vscode-errorForeground); min-height: 1.2em; margin-top: 4px; }
  .status { margin-top: 8px; min-height: 1.2em; color: var(--vscode-descriptionForeground); }
  .actions { margin-top: 12px; display: flex; gap: 6px; flex-wrap: wrap; }
  .primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; border-radius: 2px; padding: 5px 12px; }
  .primary:disabled { opacity: 0.5; cursor: default; }
  .secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); border: none; border-radius: 2px; padding: 5px 12px; }
  #editing { color: var(--vscode-descriptionForeground); font-size: 12px; margin-bottom: 8px; }
</style>
</head>
<body>
<script id="l10n" type="application/json">${json}</script>
<div class="layout">
  <section class="presets" aria-label="${t(m.presets)}">
    <h2>${t(m.presets)}</h2>
    <div class="row"><label>${t(m.root)}</label><div id="preset-roots"></div></div>
    <div class="row"><label>${t(m.quality)}</label><div id="preset-qualities"></div></div>
    <div id="preset-items" class="preset-items"></div>
  </section>

  <section class="editor">
    <h2>${t(m.panelTitle)}</h2>
    <div id="editing"></div>
    <div class="row">
      <button class="tool-btn active" data-tool="fret">${t(m.toolFret)}</button>
      <button class="tool-btn" data-tool="finger">${t(m.toolFinger)}</button>
      <button class="tool-btn" data-tool="barre">${t(m.toolBarre)}</button>
      <button class="secondary" id="btn-clear">${t(m.clear)}</button>
    </div>
    <div class="row" id="finger-picker" hidden>
      <button class="chip active" data-finger="1">1</button>
      <button class="chip" data-finger="2">2</button>
      <button class="chip" data-finger="3">3</button>
      <button class="chip" data-finger="4">4</button>
      <button class="chip" data-finger="T">T</button>
      <button class="chip" data-finger="-">${t(m.fingerNone)}</button>
    </div>
    <div class="help" id="tool-help">${t(m.help_fret)}</div>
    <div class="paper"><svg id="grid" xmlns="http://www.w3.org/2000/svg" font-family="sans-serif"></svg></div>
    <div class="row" style="margin-top:8px">
      <label for="base-fret">${t(m.baseFret)}</label>
      <button class="chip" id="base-down" aria-label="-1">−</button>
      <input type="number" id="base-fret" min="1" max="20">
      <button class="chip" id="base-up" aria-label="+1">+</button>
    </div>
  </section>

  <section class="side">
    <h2>${t(m.name)}</h2>
    <div class="row"><label for="chord-name">${t(m.name)}</label><input type="text" id="chord-name" size="10" spellcheck="false"></div>
    <div class="row"><label for="chord-label">${t(m.label)}</label><input type="text" id="chord-label" size="10" spellcheck="false" placeholder="${t(m.labelPlaceholder)}"></div>
    <div class="row"><label>${t(m.detected)}</label><div id="candidates"></div></div>
    <h2>${t(m.preview)}</h2>
    <div class="paper" id="preview"></div>
    <h2>${t(m.dslLine)}</h2>
    <code id="dsl-line"></code>
    <div id="error" role="alert"></div>
    <div class="actions">
      <button class="primary" id="btn-save">${t(m.save)}</button>
      <button class="secondary" id="btn-save-new">${t(m.saveAsNew)}</button>
      <button class="secondary" id="btn-close">${t(m.close)}</button>
    </div>
    <div class="status" id="status" role="status"></div>
  </section>
</div>
<script src="${scriptUri}"></script>
</body>
</html>`;
}
