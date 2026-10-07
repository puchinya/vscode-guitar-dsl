import type { BeginnerPreviewUiModel } from '../beginnerMode';
import type { CapoPreviewUiModel } from '../capo';
import { parseGuitarDsl } from '../compiler';
import type { ParsedScore } from '../compiler';
import { fnum } from '../duration';
import { resolveLocale, getMessages } from '../i18n';
import type { Messages } from '../i18n';
import { playbackEventMidiNotes } from '../playbackSynth';
import { buildPlaybackTimeline } from '../playbackTimeline';
import type { PlaybackEvent } from '../playbackTimeline';
import { beamGroupStarts, measureBeats } from '../scoreEvents';
import { PageOrientation, PageSize, getSheetSize } from './layout';
import { FONT_FAMILY_SANS, SCORE_FONT_FAMILY, escapeXml, renderContinuousSvg, renderScoreSheets } from './svg';

export interface ScoreFontUris {
  regular: string;
  bold: string;
}

export interface CompileHtmlOptions {
  locale?: string;
  pageSize?: PageSize;
  orientation?: PageOrientation;
  /** Webview URIs of the bundled Noto Sans JP fonts. When omitted, the preview falls back to installed fonts. */
  fontUris?: ScoreFontUris;
  expandPageBreakRepeats?: boolean;
  /** Precomputed capo / playability state; when present the capo bar is shown (never printed). */
  capo?: CapoPreviewUiModel;
  /** Beginner Mode controls in the capo bar (spec extension §4.5); omitted = off. */
  beginner?: BeginnerPreviewUiModel;
  /** Production Webview CSP source; omitted by non-Webview/test callers. */
  cspSource?: string;
  /** Fresh production nonce for the executable script and main style element. */
  nonce?: string;
}

type PlaybackHtmlEvent = PlaybackEvent & {
  midiNotes: number[];
};

interface PlaybackHtmlOccurrence {
  occurrenceIndex: number;
  measureIndex: number;
  sectionName?: string;
  startSeconds: number;
  durationSeconds: number;
  countInDurationSeconds: number;
  countInClicks: { timeSeconds: number; accent: boolean }[];
}

interface PlaybackHtmlData {
  available: boolean;
  durationSeconds: number;
  events: PlaybackHtmlEvent[];
  occurrences: PlaybackHtmlOccurrence[];
  countInDurationSeconds: number;
  countInClicks: { timeSeconds: number; accent: boolean }[];
  labels: Record<string, string>;
  error?: string;
}

const PX_PER_PT = 96 / 72;

/** Builds the webview document: an HTML toolbar plus one SVG per sheet (and a continuous SVG for web mode). */
export function compileGuitarDslToHtml(dslContent: string, options?: CompileHtmlOptions): string {
  const locale = resolveLocale(options?.locale);
  const msgs = getMessages(locale);
  const pageSize = options?.pageSize ?? 'A4';
  const orientation = options?.orientation ?? 'portrait';
  const score = parseGuitarDsl(dslContent, {
    expandPageBreakRepeats: options?.expandPageBreakRepeats
  });
  const playback = buildPlaybackHtmlData(score, msgs);
  const playbackJson = escapeJsonForHtml(JSON.stringify(playback));
  const nonceAttribute = options?.nonce ? ` nonce="${escapeXml(options.nonce)}"` : '';
  const cspMeta = options?.cspSource && options.nonce
    ? renderCspMeta(options.cspSource, options.nonce)
    : '';

  const sheets = renderScoreSheets(score, pageSize, orientation);
  const spreadGroups: string[] = [];
  for (let i = 0; i < sheets.length; i += 2) {
    spreadGroups.push(`<div class="spread-sheet">${sheets.slice(i, i + 2).join('\n')}</div>`);
  }
  const continuousSvg = renderContinuousSvg(score, pageSize);

  const sheetMaxWidthPx = Math.round(getSheetSize(pageSize, orientation).width * PX_PER_PT);
  const capoBar = options?.capo ? renderCapoBar(options.capo, msgs, options.beginner) : '';
  const practiceSpeedOptions = Array.from({ length: 36 }, (_, index) => 25 + index * 5)
    .map(speed => `<option value="${speed}"${speed === 100 ? ' selected' : ''}>${speed}%</option>`)
    .join('');
  const continuousMaxWidthPx = Math.round(getSheetSize(pageSize, 'portrait').width * PX_PER_PT);

  const fontFaces = options?.fontUris ? `
  @font-face {
    font-family: '${SCORE_FONT_FAMILY}';
    src: url('${options.fontUris.regular}') format('truetype');
    font-weight: 100 500;
  }
  @font-face {
    font-family: '${SCORE_FONT_FAMILY}';
    src: url('${options.fontUris.bold}') format('truetype');
    font-weight: 600 900;
  }` : '';

  return `<!DOCTYPE html>
<html lang="${locale}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
${cspMeta}
<title>${escapeXml(score.title)}</title>
<style${nonceAttribute}>${fontFaces}
  * {
    box-sizing: border-box;
  }
  body {
    font-family: ${FONT_FAMILY_SANS};
    color: #111;
    margin: 0;
    padding: 108px 16px 36px 16px;
    background: #e9ecef;
    min-height: 100vh;
  }

  /* Fixed External Toolbar */
  .toolbar-container {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    height: 48px;
    background: #252526;
    border-bottom: 1px solid #3c3c3c;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 16px;
    z-index: 1000;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
    color: #cccccc;
    user-select: none;
  }
  .toolbar-scroll {
    display: flex;
    align-items: center;
    flex: 1 1 auto;
    min-width: 0;
    overflow-x: auto;
    overflow-y: hidden;
  }
  .toolbar-left, .toolbar-center, .toolbar-right {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 0 0 auto;
  }
  .toolbar-right {
    white-space: nowrap;
  }
  .playback-toolbar {
    position: fixed;
    top: 48px;
    left: 0;
    right: 0;
    height: 42px;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 16px;
    background: #2d2d30;
    border-bottom: 1px solid #3c3c3c;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.18);
    color: #eeeeee;
    z-index: 999;
    white-space: nowrap;
    overflow-x: auto;
    user-select: none;
  }
  .playback-control-btn {
    flex: 0 0 auto;
    border: 1px solid #555;
    border-radius: 4px;
    background: #252526;
    color: #eeeeee;
    padding: 4px 9px;
    font: inherit;
    font-size: 12px;
    cursor: pointer;
  }
  .playback-control-btn:hover:not(:disabled) { background: #3c3c3c; }
  .playback-control-btn:focus-visible, .playback-seek:focus-visible, .playback-toggle:focus-within {
    outline: 2px solid #3794ff;
    outline-offset: 1px;
  }
  .playback-control-btn:disabled { opacity: 0.45; cursor: default; }
  .playback-seek {
    flex: 1 1 180px;
    min-width: 80px;
    accent-color: #3794ff;
  }
  .playback-time {
    flex: 0 0 auto;
    min-width: 96px;
    color: #cccccc;
    font-variant-numeric: tabular-nums;
    font-size: 12px;
  }
  .playback-toggle {
    display: inline-flex;
    flex: 0 0 auto;
    align-items: center;
    gap: 4px;
    color: #cccccc;
    font-size: 12px;
    cursor: pointer;
  }
  .playback-error {
    flex: 0 0 auto;
    color: #f48771;
    font-size: 12px;
  }
  .playback-error:empty { display: none; }
  .practice-toggle[aria-pressed="true"] {
    background: #2e7d32;
    border-color: #2e7d32;
  }
  .practice-toolbar {
    position: fixed;
    top: 90px;
    left: 0;
    right: 0;
    height: 42px;
    display: none;
    align-items: center;
    gap: 8px;
    padding: 0 16px;
    background: #2d2d30;
    border-bottom: 1px solid #3c3c3c;
    color: #eeeeee;
    z-index: 998;
    white-space: nowrap;
    overflow-x: auto;
    user-select: none;
  }
  body.has-practice-row .practice-toolbar { display: flex; }
  .practice-control-label {
    display: inline-flex;
    flex: 0 0 auto;
    align-items: center;
    gap: 4px;
    color: #cccccc;
    font-size: 12px;
  }
  .practice-select {
    flex: 0 0 auto;
    min-width: 68px;
    border: 1px solid #555;
    border-radius: 4px;
    background: #252526;
    color: #eeeeee;
    padding: 3px 6px;
    font: inherit;
    font-size: 12px;
  }
  .practice-button {
    flex: 0 0 auto;
    border: 1px solid #555;
    border-radius: 4px;
    background: #252526;
    color: #eeeeee;
    padding: 4px 9px;
    font: inherit;
    font-size: 12px;
    cursor: pointer;
  }
  .practice-button:hover:not(:disabled) { background: #3c3c3c; }
  .practice-button:focus-visible, .practice-select:focus-visible {
    outline: 2px solid #3794ff;
    outline-offset: 1px;
  }
  .practice-button:disabled, .practice-select:disabled { opacity: 0.45; cursor: default; }
  .practice-button[aria-pressed="true"] { background: #2e7d32; border-color: #2e7d32; }
  .practice-status {
    flex: 1 0 140px;
    min-width: 140px;
    overflow: hidden;
    color: #cccccc;
    text-overflow: ellipsis;
    font-size: 12px;
  }
  .toolbar-label {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: #888;
    margin-right: 2px;
  }
  .segmented-control {
    display: inline-flex;
    background: #1e1e1e;
    border-radius: 4px;
    padding: 2px;
    border: 1px solid #3c3c3c;
  }
  .tool-btn {
    background: transparent;
    color: #aaa;
    border: none;
    padding: 4px 10px;
    font-size: 12px;
    font-weight: 500;
    border-radius: 3px;
    cursor: pointer;
    transition: all 0.15s ease;
  }
  .tool-btn:hover {
    color: #fff;
    background: rgba(255, 255, 255, 0.08);
  }
  .tool-btn.active {
    background: #007acc;
    color: #ffffff;
    font-weight: 600;
  }
  .tool-select {
    background: #1e1e1e;
    color: #eeeeee;
    border: 1px solid #3c3c3c;
    border-radius: 4px;
    padding: 4px 8px;
    font-size: 12px;
    cursor: pointer;
  }
  .tool-select:focus {
    outline: 1px solid #007acc;
  }
  .btn-pdf {
    background: #007acc;
    color: #fff;
    border: none;
    padding: 6px 14px;
    font-size: 12px;
    font-weight: bold;
    border-radius: 4px;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 6px;
    transition: background 0.15s ease;
  }
  .btn-pdf:hover {
    background: #0062a3;
  }
  .btn-help {
    background: transparent;
    color: #007acc;
    border: 1px solid #007acc;
    padding: 5px 10px;
    font-size: 12px;
    font-weight: bold;
    border-radius: 4px;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .btn-help:hover {
    background: rgba(0, 122, 204, 0.1);
  }
  .btn-help:focus-visible, .btn-pdf:focus-visible {
    outline: 2px solid #0062a3;
    outline-offset: 2px;
  }

  .sheet-svg, .continuous-svg {
    display: block;
    height: auto;
    background: #ffffff;
    box-shadow: 0 4px 18px rgba(0, 0, 0, 0.12);
  }
  .sheet-svg {
    width: 100%;
    max-width: ${sheetMaxWidthPx}px;
  }
  .continuous-svg {
    width: 100%;
    max-width: ${continuousMaxWidthPx}px;
    margin: 0 auto 32px auto;
  }

  /* Single page: sheets stacked vertically */
  body[data-display-mode="single"] .spread-sheet {
    display: contents;
  }
  body[data-display-mode="single"] .sheet-svg {
    margin: 0 auto 28px auto;
  }

  /* Spread: two sheets side by side */
  body[data-display-mode="spread"] .spread-sheet {
    display: flex;
    flex-direction: row;
    justify-content: center;
    align-items: flex-start;
    gap: 24px;
    margin: 0 auto 28px auto;
  }
  body[data-display-mode="spread"] .sheet-svg {
    flex: 0 1 ${sheetMaxWidthPx}px;
    min-width: 0;
  }

  /* Web: one continuous unpaginated score */
  .web-score-container {
    display: none;
  }
  body[data-display-mode="web"] .sheet-pages-wrapper {
    display: none;
  }
  body[data-display-mode="web"] .web-score-container {
    display: block;
  }
  .chord-diagram {
    cursor: pointer;
  }

  /* Capo / playability bar (toolbar UI only: not part of the SVG / PDF) */
  body.has-capo-bar {
    padding-top: 144px;
  }
  body.has-practice-row:not(.has-capo-bar) {
    padding-top: 150px;
  }
  body.has-practice-row.has-capo-bar {
    padding-top: 186px;
  }
  body.has-practice-row .capo-bar {
    top: 132px;
  }
  .capo-bar {
    position: fixed;
    top: 90px;
    left: 0;
    right: 0;
    height: 36px;
    background: #2d2d30;
    border-bottom: 1px solid #3c3c3c;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 0 16px;
    z-index: 999;
    color: #eeeeee;
    font-size: 12px;
    white-space: nowrap;
    overflow-x: auto;
  }
  .capo-badge {
    border-radius: 10px;
    padding: 2px 10px;
    font-weight: bold;
    background: #3c3c3c;
  }
  .capo-badge[data-level="veryEasy"], .capo-badge[data-level="easy"] { background: #2e7d32; }
  .capo-badge[data-level="moderate"] { background: #8d6e00; }
  .capo-badge[data-level="hard"], .capo-badge[data-level="veryHard"] { background: #b71c1c; }
  .capo-note {
    color: #f0c674;
  }
  .capo-warning {
    color: #ff8a80;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .capo-btn {
    background: #3c3c3c;
    color: #eeeeee;
    border: 1px solid #555;
    border-radius: 4px;
    padding: 3px 10px;
    font-size: 12px;
    cursor: pointer;
  }
  .beginner-toggle[aria-pressed="true"] {
    background: #2e7d32;
    color: #fff;
    border-color: #2e7d32;
  }
  .capo-btn:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .capo-btn.primary:not(:disabled) {
    background: #007acc;
    border-color: #007acc;
  }
  .chord-diagram:hover > rect:first-child {
    fill: #0078d4;
    fill-opacity: 0.08;
  }
</style>
</head>
<body data-display-mode="single" data-orientation="${orientation}" data-page-size="${pageSize}"${capoBar ? ' class="has-capo-bar"' : ''}>
  <div class="toolbar-container">
    <div class="toolbar-scroll">
      <div class="toolbar-left">
        <span class="toolbar-label">${escapeXml(msgs.uiView)}</span>
        <div class="segmented-control">
          <button class="tool-btn active" data-mode="single" title="${escapeXml(msgs.uiSinglePageTitle)}">${escapeXml(msgs.uiSinglePage)}</button>
          <button class="tool-btn" data-mode="spread" title="${escapeXml(msgs.uiSpreadTitle)}">${escapeXml(msgs.uiSpread)}</button>
          <button class="tool-btn" data-mode="web" title="${escapeXml(msgs.uiWebTitle)}">${escapeXml(msgs.uiWeb)}</button>
        </div>
      </div>

      <div class="toolbar-center">
        <span class="toolbar-label">${escapeXml(msgs.uiPaper)}</span>
        <select id="select-page-size" class="tool-select" title="${escapeXml(msgs.uiPaperTitle)}">
          <option value="A4" selected>A4 (210×297mm)</option>
          <option value="A3">A3 (297×420mm)</option>
          <option value="A5">A5 (148×210mm)</option>
          <option value="B4">B4 (250×353mm)</option>
          <option value="B5">B5 (176×250mm)</option>
          <option value="Letter">Letter (8.5×11")</option>
        </select>
        <span class="toolbar-label" style="margin-left: 8px;">${escapeXml(msgs.uiOrientation)}</span>
        <div class="segmented-control">
          <button class="tool-btn active" data-orientation="portrait" title="${escapeXml(msgs.uiPortraitTitle)}">${escapeXml(msgs.uiPortrait)}</button>
          <button class="tool-btn" data-orientation="landscape" title="${escapeXml(msgs.uiLandscapeTitle)}">${escapeXml(msgs.uiLandscape)}</button>
        </div>
      </div>
    </div>

    <div class="toolbar-right">
      <button class="btn-help" id="btn-help" type="button" title="${escapeXml(msgs.uiHelpTitle)}" aria-label="${escapeXml(msgs.uiHelpTitle)}"><span aria-hidden="true">?</span> ${escapeXml(msgs.uiHelp)}</button>
      <button class="btn-pdf" id="btn-save-pdf" title="${escapeXml(msgs.uiSavePdfTitle)}">${escapeXml(msgs.uiSavePdf)}</button>
    </div>
  </div>

  <div class="playback-toolbar" role="group" aria-label="${escapeXml(msgs.uiPlaybackGroup)}">
    <button class="playback-control-btn" id="btn-play" type="button" title="${escapeXml(msgs.uiPlay)}" aria-label="${escapeXml(msgs.uiPlay)}"${playback.available ? '' : ' disabled'}>▶ ${escapeXml(msgs.uiPlay)}</button>
    <button class="playback-control-btn" id="btn-pause" type="button" title="${escapeXml(msgs.uiPause)}" aria-label="${escapeXml(msgs.uiPause)}" disabled>Ⅱ ${escapeXml(msgs.uiPause)}</button>
    <button class="playback-control-btn" id="btn-stop" type="button" title="${escapeXml(msgs.uiStop)}" aria-label="${escapeXml(msgs.uiStop)}" disabled>■ ${escapeXml(msgs.uiStop)}</button>
    <input class="playback-seek" id="playback-seek" type="range" min="0" max="${playback.durationSeconds}" step="0.01" value="0" aria-label="${escapeXml(msgs.uiSeek)}"${playback.available ? '' : ' disabled'}>
    <span class="playback-time" id="playback-time" aria-label="${escapeXml(msgs.uiPlaybackTime)}">00:00 / ${formatPlaybackTime(playback.durationSeconds)}</span>
    <label class="playback-toggle"><input id="count-in-toggle" type="checkbox">${escapeXml(msgs.uiCountIn)}</label>
    <label class="playback-toggle"><input id="metronome-toggle" type="checkbox">${escapeXml(msgs.uiMetronome)}</label>
    <button class="playback-control-btn practice-toggle" id="practice-toggle" type="button" aria-pressed="false" title="${escapeXml(msgs.uiPracticeTitle)}" aria-label="${escapeXml(msgs.uiPracticeTitle)}"${playback.available ? '' : ' disabled'}>${escapeXml(msgs.uiPractice)}</button>
    <span class="playback-error" id="playback-error" role="status" aria-live="polite">${escapeXml(playback.error ?? '')}</span>
  </div>

  <div class="practice-toolbar" id="practice-toolbar" role="group" aria-label="${escapeXml(msgs.uiPractice)}">
    <label class="practice-control-label">${escapeXml(msgs.uiPracticeSpeed)}
      <select class="practice-select" id="practice-speed" aria-label="${escapeXml(msgs.uiPracticeSpeed)}"${playback.available ? '' : ' disabled'}>${practiceSpeedOptions}</select>
    </label>
    <label class="practice-control-label">${escapeXml(msgs.uiPracticeLoop)}
      <select class="practice-select" id="practice-loop" aria-label="${escapeXml(msgs.uiPracticeLoop)}"${playback.available ? '' : ' disabled'}>
        <option value="off">${escapeXml(msgs.uiPracticeLoopOff)}</option>
        <option value="measure">${escapeXml(msgs.uiPracticeLoopMeasure)}</option>
        <option value="section">${escapeXml(msgs.uiPracticeLoopSection)}</option>
        <option value="ab">${escapeXml(msgs.uiPracticeLoopAB)}</option>
      </select>
    </label>
    <button class="practice-button" id="practice-set-a" type="button" title="${escapeXml(msgs.uiPracticeSetA)}" aria-label="${escapeXml(msgs.uiPracticeSetA)}"${playback.available ? '' : ' disabled'}>${escapeXml(msgs.uiPracticeA)}</button>
    <button class="practice-button" id="practice-set-b" type="button" title="${escapeXml(msgs.uiPracticeSetB)}" aria-label="${escapeXml(msgs.uiPracticeSetB)}"${playback.available ? '' : ' disabled'}>${escapeXml(msgs.uiPracticeB)}</button>
    <button class="practice-button" id="practice-clear-loop" type="button" title="${escapeXml(msgs.uiPracticeClear)}" aria-label="${escapeXml(msgs.uiPracticeClear)}"${playback.available ? '' : ' disabled'}>${escapeXml(msgs.uiPracticeClear)}</button>
    <button class="practice-button" id="practice-follow" type="button" aria-pressed="true" title="${escapeXml(msgs.uiPracticeFollowTitle)}" aria-label="${escapeXml(msgs.uiPracticeFollowTitle)}"${playback.available ? '' : ' disabled'}>${escapeXml(msgs.uiPracticeFollow)}</button>
    <span class="practice-status" id="practice-status" role="status" aria-live="polite"></span>
  </div>

  ${capoBar}

  <div class="sheet-pages-wrapper">
    ${spreadGroups.join('\n')}
  </div>

  <div class="web-score-container">
    ${continuousSvg}
  </div>

  <script type="application/json" id="playback-data"${nonceAttribute}>${playbackJson}</script>
  <script${nonceAttribute}>
    (function() {
      const vscode = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : null;
      const body = document.body;
      // Paper size / orientation are owned by the extension host (the SVG is laid out for them);
      // only the display mode is restored from webview state.
      const currentPageSize = body.getAttribute('data-page-size');
      const currentOrientation = body.getAttribute('data-orientation');
      let currentMode = 'single';
      let countInEnabled = false;
      let metronomeEnabled = false;
      let practiceEnabled = false;
      let practiceSpeed = 100;
      let followEnabled = true;

      if (vscode) {
        const state = vscode.getState();
        if (state && ['single', 'spread', 'web'].includes(state.currentMode)) {
          currentMode = state.currentMode;
        }
        if (state && typeof state.countInEnabled === 'boolean') countInEnabled = state.countInEnabled;
        if (state && typeof state.metronomeEnabled === 'boolean') metronomeEnabled = state.metronomeEnabled;
        if (state && typeof state.practiceEnabled === 'boolean') practiceEnabled = state.practiceEnabled;
        if (state && Number.isFinite(state.practiceSpeed)) {
          practiceSpeed = Math.max(25, Math.min(200, Math.round(Number(state.practiceSpeed) / 5) * 5));
        }
        if (state && typeof state.followEnabled === 'boolean') followEnabled = state.followEnabled;
      }

      const modeButtons = document.querySelectorAll('.tool-btn[data-mode]');
      const orientationButtons = document.querySelectorAll('.tool-btn[data-orientation]');
      const pageSizeSelect = document.getElementById('select-page-size');
      const savePdfBtn = document.getElementById('btn-save-pdf');
      const countInToggle = document.getElementById('count-in-toggle');
      const metronomeToggle = document.getElementById('metronome-toggle');
      const practiceToggle = document.getElementById('practice-toggle');
      const practiceSpeedSelect = document.getElementById('practice-speed');
      const practiceLoopSelect = document.getElementById('practice-loop');
      const practiceSetAButton = document.getElementById('practice-set-a');
      const practiceSetBButton = document.getElementById('practice-set-b');
      const practiceClearButton = document.getElementById('practice-clear-loop');
      const practiceFollowButton = document.getElementById('practice-follow');
      const practiceStatus = document.getElementById('practice-status');
      if (countInToggle) countInToggle.checked = countInEnabled;
      if (metronomeToggle) metronomeToggle.checked = metronomeEnabled;
      if (practiceSpeedSelect) practiceSpeedSelect.value = String(practiceSpeed);

      function persistWebviewState() {
        if (vscode) vscode.setState({ currentMode, countInEnabled, metronomeEnabled, practiceEnabled, practiceSpeed, followEnabled });
      }

      const playbackDataElement = document.getElementById('playback-data');
      let playbackData;
      try {
        playbackData = JSON.parse(playbackDataElement ? playbackDataElement.textContent : '{}');
      } catch (_) {
        playbackData = { available: false, durationSeconds: 0, events: [], occurrences: [], countInClicks: [], countInDurationSeconds: 0, labels: {}, error: '' };
      }
      if (!playbackData || typeof playbackData !== 'object') {
        playbackData = { available: false, durationSeconds: 0, events: [], occurrences: [], countInClicks: [], countInDurationSeconds: 0, labels: {}, error: '' };
      }
      const playbackAvailable = playbackData.available === true;
      const playbackDuration = Math.max(0, Number(playbackData.durationSeconds) || 0);
      const playbackEvents = Array.isArray(playbackData.events) ? playbackData.events : [];
      const playbackOccurrences = Array.isArray(playbackData.occurrences) ? playbackData.occurrences : [];
      const playBtn = document.getElementById('btn-play');
      const pauseBtn = document.getElementById('btn-pause');
      const stopBtn = document.getElementById('btn-stop');
      const seekSlider = document.getElementById('playback-seek');
      const playbackTime = document.getElementById('playback-time');
      const playbackError = document.getElementById('playback-error');
      const audioLabels = playbackData.labels || {};
      let transport = 'stopped';
      let positionSeconds = 0;
      let scoreAnchorAudioTime = 0;
      let scoreAnchorSeconds = 0;
      let schedulerCursorAudioTime = 0;
      let schedulerCursorScoreSeconds = 0;
      let schedulerTimer = null;
      let audioContext = null;
      let masterGain = null;
      let startPending = false;
      let scrubbing = false;
      let disposed = false;
      let loopMode = 'off';
      let loopStartPoint = null;
      let loopEndPoint = null;
      let loopRange = null;
      let practiceNotice = '';
      let overlayVisible = false;
      let overlayAnchor = null;
      let overlayHighlight = null;
      let overlayPlayhead = null;
      let animationFrameId = null;
      let followProgrammaticTarget = null;
      const activeNodes = new Set();
      const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;

      function effectiveSpeed() {
        return practiceEnabled ? practiceSpeed / 100 : 1;
      }

      function clampScoreTime(value) {
        const finite = Number.isFinite(value) ? value : 0;
        return Math.max(0, Math.min(playbackDuration, finite));
      }

      function formatClock(value) {
        const whole = Math.max(0, Math.floor(value));
        const minutes = String(Math.floor(whole / 60)).padStart(2, '0');
        const seconds = String(whole % 60).padStart(2, '0');
        return minutes + ':' + seconds;
      }

      function scoreTimeFromAudioClock() {
        if (!audioContext) return positionSeconds;
        const elapsed = Math.max(0, audioContext.currentTime - scoreAnchorAudioTime);
        const raw = scoreAnchorSeconds + elapsed * effectiveSpeed();
        if (loopRange && raw >= loopRange.endSeconds) {
          const length = loopRange.endSeconds - loopRange.startSeconds;
          return loopRange.startSeconds + ((raw - loopRange.startSeconds) % length);
        }
        return clampScoreTime(raw);
      }

      function occurrenceAtScoreTime(seconds) {
        if (playbackOccurrences.length === 0) return null;
        const target = clampScoreTime(Number(seconds));
        return playbackOccurrences.find(occurrence =>
          target >= occurrence.startSeconds && target < occurrence.startSeconds + occurrence.durationSeconds
        ) ?? playbackOccurrences[playbackOccurrences.length - 1];
      }

      function pointAtScoreTime(seconds) {
        const target = clampScoreTime(Number(seconds));
        const occurrence = occurrenceAtScoreTime(target);
        return occurrence ? { occurrenceIndex: occurrence.occurrenceIndex, scoreSeconds: target } : null;
      }

      function normalizedSeekTarget(seconds) {
        const target = clampScoreTime(Number(seconds));
        if (!loopRange) return target;
        return target < loopRange.startSeconds || target >= loopRange.endSeconds
          ? loopRange.startSeconds
          : target;
      }

      function displayPositionText(seconds) {
        const occurrence = occurrenceAtScoreTime(seconds);
        if (!occurrence) return '';
        const measureLabel = audioLabels.practiceMeasure || 'Measure';
        const occurrenceLabel = audioLabels.practiceOccurrence || 'Occurrence';
        return measureLabel + ' ' + (occurrence.measureIndex + 1) + ' / ' + occurrenceLabel + ' ' + (occurrence.occurrenceIndex + 1);
      }

      function setPracticeNotice(message) {
        practiceNotice = message || '';
        updatePracticeUi();
      }

      function setPlaybackError(message) {
        if (playbackError) playbackError.textContent = message || '';
      }

      function removeSvgNode(node) {
        if (node && node.parentNode) node.parentNode.removeChild(node);
      }

      function removeScoreOverlay() {
        removeSvgNode(overlayHighlight);
        removeSvgNode(overlayPlayhead);
        overlayAnchor = null;
        overlayHighlight = null;
        overlayPlayhead = null;
      }

      function visibleMeasureAnchor(measureIndex) {
        const selector = currentMode === 'web'
          ? '.web-score-container .playback-measure-anchor'
          : '.sheet-pages-wrapper .playback-measure-anchor';
        return Array.from(document.querySelectorAll(selector)).find(anchor =>
          Number(anchor.getAttribute('data-measure-index')) === measureIndex
        ) ?? null;
      }

      function followAnchor(anchor) {
        if (!practiceEnabled || !followEnabled || typeof anchor.getBoundingClientRect !== 'function') return;
        const rect = anchor.getBoundingClientRect();
        const viewportHeight = Number(window.innerHeight) || 0;
        if (viewportHeight <= 0) return;
        const bandTop = viewportHeight * 0.2;
        const bandBottom = viewportHeight * 0.8;
        if (rect.top >= bandTop && rect.bottom <= bandBottom) return;
        const currentScroll = Number(window.scrollY) || 0;
        const target = Math.max(0, currentScroll + (rect.top + rect.bottom) / 2 - viewportHeight / 2);
        if (Math.abs(target - currentScroll) < 1) return;
        followProgrammaticTarget = target;
        window.scrollTo(0, target);
      }

      function playbackColumnX(anchor, beat, durationBeats, progress, x, width) {
        const serialized = anchor.getAttribute('data-playback-columns') || '';
        const columns = serialized.split(';').map(value => {
          const parts = value.split(':');
          return { beat: Number(parts[0]), x: Number(parts[1]) };
        }).filter(column => Number.isFinite(column.beat) && Number.isFinite(column.x));
        if (columns.length === 0 || !Number.isFinite(durationBeats) || durationBeats <= 0) {
          return x + width * progress;
        }

        const targetBeat = Math.max(0, Math.min(durationBeats, beat));
        const exact = columns.find(column => Math.abs(column.beat - targetBeat) < 0.00001);
        if (exact) return exact.x;

        const nextIndex = columns.findIndex(column => column.beat > targetBeat);
        if (nextIndex === 0) {
          const next = columns[0];
          const span = next.beat;
          const amount = span > 0 ? Math.max(0, Math.min(1, targetBeat / span)) : 1;
          return x + (next.x - x) * amount;
        }
        if (nextIndex > 0) {
          const previous = columns[nextIndex - 1];
          const next = columns[nextIndex];
          const span = next.beat - previous.beat;
          const amount = span > 0 ? Math.max(0, Math.min(1, (targetBeat - previous.beat) / span)) : 0;
          return previous.x + (next.x - previous.x) * amount;
        }

        const last = columns[columns.length - 1];
        const span = durationBeats - last.beat;
        const amount = span > 0 ? Math.max(0, Math.min(1, (targetBeat - last.beat) / span)) : 1;
        return last.x + (x + width - last.x) * amount;
      }

      function updateScoreOverlay() {
        if (!overlayVisible || disposed) {
          removeScoreOverlay();
          return;
        }
        const shownTime = transport === 'playing' || transport === 'counting-in'
          ? scoreTimeFromAudioClock()
          : positionSeconds;
        const occurrence = occurrenceAtScoreTime(shownTime);
        const anchor = occurrence ? visibleMeasureAnchor(occurrence.measureIndex) : null;
        const system = anchor && anchor.closest ? anchor.closest('.system') : null;
        if (!anchor || !system) {
          removeScoreOverlay();
          return;
        }

        if (overlayAnchor !== anchor) {
          removeScoreOverlay();
          overlayHighlight = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
          overlayHighlight.setAttribute('class', 'playback-highlight');
          overlayHighlight.setAttribute('fill', '#3794ff');
          overlayHighlight.setAttribute('fill-opacity', '0.13');
          overlayHighlight.setAttribute('pointer-events', 'none');
          overlayPlayhead = document.createElementNS('http://www.w3.org/2000/svg', 'line');
          overlayPlayhead.setAttribute('class', 'playback-playhead');
          overlayPlayhead.setAttribute('stroke', '#0078d4');
          overlayPlayhead.setAttribute('stroke-width', '1.5');
          overlayPlayhead.setAttribute('pointer-events', 'none');
          system.insertBefore(overlayHighlight, system.firstChild);
          system.appendChild(overlayPlayhead);
          overlayAnchor = anchor;
        }

        const x = Number(anchor.getAttribute('x')) || 0;
        const y = Number(anchor.getAttribute('y')) || 0;
        const width = Math.max(0, Number(anchor.getAttribute('width')) || 0);
        const height = Math.max(0, Number(anchor.getAttribute('height')) || 0);
        const progress = occurrence.durationSeconds > 0
          ? Math.max(0, Math.min(1, (shownTime - occurrence.startSeconds) / occurrence.durationSeconds))
          : 0;
        const durationBeats = Number(anchor.getAttribute('data-playback-duration-beats'));
        const beat = durationBeats * progress;
        const playheadX = playbackColumnX(anchor, beat, durationBeats, progress, x, width);
        for (const [name, value] of Object.entries({ x, y, width, height })) {
          overlayHighlight.setAttribute(name, String(value));
        }
        overlayPlayhead.setAttribute('x1', String(playheadX));
        overlayPlayhead.setAttribute('x2', String(playheadX));
        overlayPlayhead.setAttribute('y1', String(y));
        overlayPlayhead.setAttribute('y2', String(y + height));
        followAnchor(anchor);
      }

      function updatePracticeUi() {
        body.classList.toggle('has-practice-row', practiceEnabled);
        if (practiceToggle) {
          practiceToggle.setAttribute('aria-pressed', String(practiceEnabled));
          practiceToggle.disabled = !playbackAvailable || disposed;
        }
        if (practiceSpeedSelect) {
          practiceSpeedSelect.value = String(practiceSpeed);
          practiceSpeedSelect.disabled = !playbackAvailable || disposed || !practiceEnabled;
        }
        if (practiceLoopSelect) {
          practiceLoopSelect.value = loopMode;
          practiceLoopSelect.disabled = !playbackAvailable || disposed || !practiceEnabled;
        }
        for (const button of [practiceSetAButton, practiceSetBButton, practiceClearButton, practiceFollowButton]) {
          if (button) button.disabled = !playbackAvailable || disposed || !practiceEnabled;
        }
        if (practiceFollowButton) practiceFollowButton.setAttribute('aria-pressed', String(followEnabled));
        if (practiceStatus) {
          const shownTime = transport === 'playing' || transport === 'counting-in'
            ? scoreTimeFromAudioClock()
            : positionSeconds;
          const position = displayPositionText(shownTime);
          practiceStatus.textContent = [position, practiceNotice].filter(Boolean).join(' · ');
        }
      }

      function updatePlaybackUi() {
        const shownTime = transport === 'playing' || transport === 'counting-in'
          ? scoreTimeFromAudioClock()
          : positionSeconds;
        if (seekSlider && !scrubbing) seekSlider.value = String(shownTime);
        if (playbackTime) playbackTime.textContent = formatClock(shownTime) + ' / ' + formatClock(playbackDuration);
        if (playBtn) {
          const playLabel = transport === 'paused' ? audioLabels.resume : audioLabels.play;
          playBtn.textContent = '▶ ' + (playLabel || 'Play');
          playBtn.setAttribute('aria-label', playLabel || 'Play');
          playBtn.title = playLabel || 'Play';
          playBtn.disabled = !playbackAvailable || startPending || disposed || transport === 'playing' || transport === 'counting-in';
        }
        if (pauseBtn) pauseBtn.disabled = disposed || (transport !== 'playing' && transport !== 'counting-in');
        if (stopBtn) stopBtn.disabled = disposed || transport === 'stopped';
        updatePracticeUi();
        updateScoreOverlay();
      }

      function clearScheduler() {
        if (schedulerTimer !== null) {
          window.clearInterval(schedulerTimer);
          schedulerTimer = null;
        }
      }

      function gainAtTime(entry, time) {
        if (time <= entry.when || time >= entry.endTime) return 0;
        if (time < entry.attackEnd) return entry.volume * (time - entry.when) / (entry.attackEnd - entry.when);
        if (time < entry.releaseStart) return entry.volume;
        return entry.volume * (entry.endTime - time) / (entry.endTime - entry.releaseStart);
      }

      function cancelScheduledNodes(category) {
        const now = audioContext ? audioContext.currentTime : 0;
        for (const entry of Array.from(activeNodes)) {
          if (category && entry.category !== category) continue;
          if (entry.cancelAt !== undefined) continue;
          const currentGain = gainAtTime(entry, now);
          const fadeEnd = currentGain > 0 ? Math.min(now + 0.008, entry.endTime) : now;
          entry.cancelAt = fadeEnd;
          try {
            if (fadeEnd > now) {
              entry.gain.gain.cancelScheduledValues(now);
              entry.gain.gain.setValueAtTime(currentGain, now);
              entry.gain.gain.linearRampToValueAtTime(0, fadeEnd);
            }
            entry.oscillator.stop(fadeEnd);
          } catch (_) {
            try { entry.oscillator.stop(now); } catch (_) {}
          }
        }
      }

      async function ensureAudioContext() {
        if (disposed) return null;
        if (!AudioContextConstructor) {
          setPlaybackError(audioLabels.audioUnavailable || 'Web Audio is unavailable.');
          return null;
        }
        if (!audioContext) {
          audioContext = new AudioContextConstructor();
          masterGain = audioContext.createGain();
          masterGain.gain.value = 0.5;
          masterGain.connect(audioContext.destination);
        }
        if (audioContext.state === 'suspended') await audioContext.resume();
        return disposed ? null : audioContext;
      }

      function scheduleTone(ctx, when, duration, frequency, waveform, volume, category) {
        if (duration <= 0 || when < ctx.currentTime - 0.005) return;
        const oscillator = ctx.createOscillator();
        const gain = ctx.createGain();
        oscillator.type = waveform;
        oscillator.frequency.setValueAtTime(frequency, when);
        const attack = Math.min(0.008, duration / 3);
        const release = Math.min(0.04, duration / 3);
        const releaseStart = Math.max(when + attack, when + duration - release);
        gain.gain.setValueAtTime(0, when);
        gain.gain.linearRampToValueAtTime(volume, when + attack);
        gain.gain.setValueAtTime(volume, releaseStart);
        gain.gain.linearRampToValueAtTime(0, when + duration);
        oscillator.connect(gain);
        gain.connect(masterGain);
        const entry = {
          oscillator,
          gain,
          category,
          when,
          volume,
          attackEnd: when + attack,
          releaseStart,
          endTime: when + duration,
          cancelAt: undefined
        };
        activeNodes.add(entry);
        oscillator.onended = () => {
          activeNodes.delete(entry);
          try { oscillator.disconnect(); } catch (_) {}
          try { gain.disconnect(); } catch (_) {}
        };
        try {
          oscillator.start(when);
          oscillator.stop(when + duration + 0.002);
        } catch (_) {
          activeNodes.delete(entry);
          try { oscillator.stop(ctx.currentTime); } catch (_) {}
          try { oscillator.disconnect(); } catch (_) {}
          try { gain.disconnect(); } catch (_) {}
        }
      }

      function schedulePlaybackEvent(ctx, event, when, speed) {
        if (event.kind === 'metronome') {
          if (metronomeEnabled) {
            let duration = 0.03;
            if (loopRange) duration = Math.min(duration, Math.max(0, loopRange.endSeconds - event.timeSeconds));
            scheduleTone(ctx, when, duration / speed, event.accent ? 1000 : 700, 'sine', 0.25, 'metronome');
          }
          return;
        }
        if (event.kind === 'rest' || !Array.isArray(event.midiNotes) || event.midiNotes.length === 0) return;
        let duration = Math.max(0, Number(event.durationSeconds) || 0);
        if (loopRange) duration = Math.min(duration, Math.max(0, loopRange.endSeconds - event.timeSeconds));
        duration /= speed;
        if (duration <= 0) return;
        const isChord = event.kind === 'rhythmAttack';
        const voiceGain = (isChord ? 0.34 : 0.24) / event.midiNotes.length;
        for (const midi of event.midiNotes) {
          if (!Number.isFinite(midi)) continue;
          const frequency = 440 * Math.pow(2, (midi - 69) / 12);
          scheduleTone(ctx, when, duration, frequency, isChord ? 'triangle' : 'sine', voiceGain, 'score');
        }
      }

      function eventIndexAtScoreTime(scoreSeconds) {
        let low = 0;
        let high = playbackEvents.length;
        while (low < high) {
          const mid = (low + high) >>> 1;
          if (playbackEvents[mid].timeSeconds < scoreSeconds) low = mid + 1;
          else high = mid;
        }
        return low;
      }

      function scheduleEventsBetween(scoreStart, scoreEnd, audioStart, speed) {
        for (let index = eventIndexAtScoreTime(scoreStart); index < playbackEvents.length; index++) {
          const event = playbackEvents[index];
          if (event.timeSeconds >= scoreEnd) break;
          if (event.timeSeconds < scoreStart) continue;
          const when = audioStart + (event.timeSeconds - scoreStart) / speed;
          if (when >= audioContext.currentTime - 0.005) schedulePlaybackEvent(audioContext, event, when, speed);
        }
      }

      function finishPlayback() {
        clearScheduler();
        stopVisualLoop();
        cancelScheduledNodes();
        positionSeconds = playbackDuration;
        transport = 'ended';
        overlayVisible = true;
        updatePlaybackUi();
      }

      function schedulerTick() {
        if (!audioContext || (transport !== 'playing' && transport !== 'counting-in')) return;
        const now = audioContext.currentTime;
        if (transport === 'counting-in' && now >= scoreAnchorAudioTime) transport = 'playing';
        const horizon = now + 0.1;
        const speed = effectiveSpeed();
        let cursorAudio = schedulerCursorAudioTime;
        let cursorScore = schedulerCursorScoreSeconds;
        if (cursorAudio < now) {
          cursorAudio = now;
          cursorScore = scoreTimeFromAudioClock();
        }
        while (cursorAudio < horizon) {
          const boundary = loopRange ? loopRange.endSeconds : playbackDuration;
          if (cursorScore >= boundary) {
            if (!loopRange) break;
            cursorScore = loopRange.startSeconds;
          }
          const horizonScore = cursorScore + (horizon - cursorAudio) * speed;
          const segmentEndScore = Math.min(boundary, horizonScore);
          if (segmentEndScore <= cursorScore) break;
          scheduleEventsBetween(cursorScore, segmentEndScore, cursorAudio, speed);
          cursorAudio += (segmentEndScore - cursorScore) / speed;
          cursorScore = segmentEndScore;
          if (loopRange && cursorScore === loopRange.endSeconds) {
            cursorScore = loopRange.startSeconds;
          } else if (!loopRange && cursorScore >= playbackDuration) {
            break;
          }
        }
        schedulerCursorAudioTime = cursorAudio;
        schedulerCursorScoreSeconds = cursorScore;
        if (transport === 'playing') {
          positionSeconds = scoreTimeFromAudioClock();
          if (!loopRange && positionSeconds >= playbackDuration) {
            finishPlayback();
            return;
          }
        }
        updatePlaybackUi();
      }

      function startScheduler() {
        clearScheduler();
        schedulerTimer = window.setInterval(schedulerTick, 25);
        schedulerTick();
      }

      function setSchedulerCursor(scoreSeconds, audioTime) {
        schedulerCursorAudioTime = audioTime;
        schedulerCursorScoreSeconds = scoreSeconds;
      }

      function countInForPosition(scoreSeconds) {
        const occurrence = occurrenceAtScoreTime(scoreSeconds);
        if (occurrence) return occurrence;
        return {
          countInDurationSeconds: playbackData.countInDurationSeconds,
          countInClicks: playbackData.countInClicks || []
        };
      }

      function stopVisualLoop() {
        if (animationFrameId !== null && typeof window.cancelAnimationFrame === 'function') {
          window.cancelAnimationFrame(animationFrameId);
        }
        animationFrameId = null;
      }

      function visualFrame() {
        animationFrameId = null;
        if (disposed) return;
        updatePlaybackUi();
        if ((transport === 'playing' || transport === 'counting-in') && typeof window.requestAnimationFrame === 'function') {
          animationFrameId = window.requestAnimationFrame(visualFrame);
        }
      }

      function startVisualLoop() {
        if (animationFrameId === null && typeof window.requestAnimationFrame === 'function') {
          animationFrameId = window.requestAnimationFrame(visualFrame);
        }
      }

      async function startFromPosition(scoreSeconds, useCountIn) {
        if (startPending || disposed || !playbackAvailable) return;
        startPending = true;
        clearScheduler();
        stopVisualLoop();
        updatePlaybackUi();
        try {
          const ctx = await ensureAudioContext();
          if (!ctx) return;
          cancelScheduledNodes();
          positionSeconds = normalizedSeekTarget(scoreSeconds);
          scoreAnchorSeconds = positionSeconds;
          const scoreStartDelay = 0.025;
          const speed = effectiveSpeed();
          const countInData = countInForPosition(positionSeconds);
          const countInDurationSeconds = Math.max(0, Number(countInData.countInDurationSeconds) || 0);
          const countIn = useCountIn && countInDurationSeconds > 0;
          if (countIn) {
            const countInStart = ctx.currentTime + scoreStartDelay;
            for (const click of countInData.countInClicks || []) {
              scheduleTone(ctx, countInStart + click.timeSeconds / speed, 0.03 / speed, click.accent ? 1000 : 700, 'sine', 0.25, 'count-in');
            }
            scoreAnchorAudioTime = countInStart + countInDurationSeconds / speed;
            transport = 'counting-in';
          } else {
            scoreAnchorAudioTime = ctx.currentTime + scoreStartDelay;
            transport = 'playing';
          }
          setSchedulerCursor(positionSeconds, scoreAnchorAudioTime);
          overlayVisible = true;
          setPlaybackError('');
          startScheduler();
          startVisualLoop();
        } catch (_) {
          transport = 'stopped';
          overlayVisible = false;
          setPlaybackError(audioLabels.audioUnavailable || 'Web Audio is unavailable.');
        } finally {
          startPending = false;
          updatePlaybackUi();
        }
      }

      async function playOrResume() {
        if (transport === 'playing' || transport === 'counting-in' || startPending || disposed) return;
        if (transport === 'paused') {
          await startFromPosition(positionSeconds, false);
          return;
        }
        const from = normalizedSeekTarget(transport === 'ended' ? 0 : positionSeconds);
        const countIn = transport === 'stopped' && countInEnabled && (practiceEnabled || from === 0);
        await startFromPosition(from, countIn);
      }

      function rescheduleAtPosition(scoreSeconds) {
        const target = normalizedSeekTarget(scoreSeconds);
        positionSeconds = target;
        scoreAnchorSeconds = target;
        overlayVisible = true;
        if (transport === 'playing' || transport === 'counting-in') {
          clearScheduler();
          stopVisualLoop();
          cancelScheduledNodes();
          if (!audioContext) {
            transport = 'stopped';
            updatePlaybackUi();
            return;
          }
          scoreAnchorAudioTime = audioContext.currentTime + 0.025;
          transport = 'playing';
          setSchedulerCursor(target, scoreAnchorAudioTime);
          startScheduler();
          startVisualLoop();
        }
        updatePlaybackUi();
      }

      function pausePlayback() {
        if (transport !== 'playing' && transport !== 'counting-in') return;
        positionSeconds = scoreTimeFromAudioClock();
        clearScheduler();
        stopVisualLoop();
        cancelScheduledNodes();
        transport = 'paused';
        overlayVisible = true;
        updatePlaybackUi();
      }

      function stopPlayback() {
        if (disposed) return;
        clearScheduler();
        stopVisualLoop();
        cancelScheduledNodes();
        positionSeconds = loopRange ? loopRange.startSeconds : 0;
        scoreAnchorSeconds = positionSeconds;
        setSchedulerCursor(positionSeconds, 0);
        transport = 'stopped';
        overlayVisible = false;
        updatePlaybackUi();
      }

      async function seekTo(value) {
        if (!playbackAvailable || disposed) return;
        const target = normalizedSeekTarget(Number(value));
        const wasPlaying = transport === 'playing' || transport === 'counting-in';
        scrubbing = false;
        if (wasPlaying) {
          rescheduleAtPosition(target);
          return;
        }
        positionSeconds = target;
        if (transport === 'ended' && target < playbackDuration) transport = 'stopped';
        overlayVisible = true;
        updatePlaybackUi();
      }

      function currentScorePosition() {
        return transport === 'playing' || transport === 'counting-in'
          ? scoreTimeFromAudioClock()
          : positionSeconds;
      }

      function loopRangeFromPoints(startPoint, endPoint) {
        if (!startPoint || !endPoint || !Number.isFinite(startPoint.scoreSeconds) || !Number.isFinite(endPoint.scoreSeconds)) return null;
        if (endPoint.scoreSeconds <= startPoint.scoreSeconds) return null;
        return {
          startPoint: { occurrenceIndex: startPoint.occurrenceIndex, scoreSeconds: startPoint.scoreSeconds },
          endPoint: { occurrenceIndex: endPoint.occurrenceIndex, scoreSeconds: endPoint.scoreSeconds },
          startSeconds: startPoint.scoreSeconds,
          endSeconds: endPoint.scoreSeconds
        };
      }

      function commitLoopState(mode, range, startPoint, endPoint, notice) {
        const current = currentScorePosition();
        const wasPlaying = transport === 'playing' || transport === 'counting-in';
        let target = current;
        if (range && (current < range.startSeconds || current >= range.endSeconds)) target = range.startSeconds;
        loopMode = mode;
        loopRange = range;
        loopStartPoint = startPoint;
        loopEndPoint = endPoint;
        if (practiceLoopSelect) practiceLoopSelect.value = mode;
        if (wasPlaying) {
          rescheduleAtPosition(target);
        } else {
          positionSeconds = target;
          scoreAnchorSeconds = target;
          if (transport === 'ended' && target < playbackDuration) transport = 'stopped';
          updatePlaybackUi();
        }
        if (notice) announcePractice(notice);
      }

      function setLoopMode(mode) {
        if (!practiceEnabled || disposed) return;
        if (!playbackAvailable) {
          announcePractice(audioLabels.practiceUnavailable || audioLabels.audioUnavailable);
          return;
        }
        if (mode === 'off') {
          commitLoopState('off', null, null, null, audioLabels.practiceLoopCleared);
          return;
        }
        if (mode === 'ab') {
          commitLoopState('ab', loopRange, loopStartPoint, loopEndPoint, loopRange ? audioLabels.practiceLoopSet : '');
          if (!loopRange) announcePractice(audioLabels.practiceARequired);
          return;
        }

        const current = currentScorePosition();
        const currentOccurrence = occurrenceAtScoreTime(current);
        if (!currentOccurrence) return;
        const occurrences = playbackOccurrences;
        const currentIndex = occurrences.findIndex(item => item.occurrenceIndex === currentOccurrence.occurrenceIndex);
        if (currentIndex < 0) return;
        let firstIndex = currentIndex;
        let lastIndex = currentIndex;
        if (mode === 'section') {
          const sectionName = typeof currentOccurrence.sectionName === 'string' ? currentOccurrence.sectionName : '';
          if (!sectionName.trim()) {
            if (practiceLoopSelect) practiceLoopSelect.value = loopMode;
            announcePractice(audioLabels.practiceUnnamedSection);
            return;
          }
          while (firstIndex > 0 && occurrences[firstIndex - 1].sectionName === sectionName) firstIndex--;
          while (lastIndex + 1 < occurrences.length && occurrences[lastIndex + 1].sectionName === sectionName) lastIndex++;
        }
        const first = occurrences[firstIndex];
        const last = occurrences[lastIndex];
        const startPoint = { occurrenceIndex: first.occurrenceIndex, scoreSeconds: first.startSeconds };
        const endPoint = { occurrenceIndex: last.occurrenceIndex, scoreSeconds: last.startSeconds + last.durationSeconds };
        const range = loopRangeFromPoints(startPoint, endPoint);
        if (range) commitLoopState(mode, range, startPoint, endPoint, audioLabels.practiceLoopSet);
      }

      function setLoopStart() {
        if (!practiceEnabled || disposed) {
          announcePractice(audioLabels.practiceEnableFirst);
          return;
        }
        if (!playbackAvailable) {
          announcePractice(audioLabels.practiceUnavailable || audioLabels.audioUnavailable);
          return;
        }
        const current = currentScorePosition();
        const startPoint = pointAtScoreTime(current);
        const wasPlaying = transport === 'playing' || transport === 'counting-in';
        loopMode = 'ab';
        loopStartPoint = startPoint;
        loopEndPoint = null;
        loopRange = null;
        if (practiceLoopSelect) practiceLoopSelect.value = 'ab';
        if (wasPlaying) rescheduleAtPosition(current);
        else updatePlaybackUi();
        announcePractice(audioLabels.practiceASet);
      }

      function setLoopEnd() {
        if (!practiceEnabled || disposed) {
          announcePractice(audioLabels.practiceEnableFirst);
          return;
        }
        if (!playbackAvailable) {
          announcePractice(audioLabels.practiceUnavailable || audioLabels.audioUnavailable);
          return;
        }
        if (!loopStartPoint) {
          announcePractice(audioLabels.practiceARequired);
          return;
        }
        const endPoint = pointAtScoreTime(currentScorePosition());
        if (!endPoint || endPoint.scoreSeconds <= loopStartPoint.scoreSeconds) {
          announcePractice(audioLabels.practiceInvalidEnd);
          return;
        }
        const range = loopRangeFromPoints(loopStartPoint, endPoint);
        if (!range) {
          announcePractice(audioLabels.practiceInvalidEnd);
          return;
        }
        commitLoopState('ab', range, loopStartPoint, endPoint, audioLabels.practiceLoopSet);
      }

      function clearPracticeLoop() {
        if (!practiceEnabled || disposed) {
          announcePractice(audioLabels.practiceEnableFirst);
          return;
        }
        commitLoopState('off', null, null, null, audioLabels.practiceLoopCleared);
      }

      function announcePractice(message) {
        setPlaybackError(message || '');
        setPracticeNotice(message || '');
      }

      function togglePractice() {
        if (disposed) return;
        if (!playbackAvailable) {
          announcePractice(audioLabels.practiceUnavailable || audioLabels.audioUnavailable);
          return;
        }
        const wasPlaying = transport === 'playing' || transport === 'counting-in';
        const current = currentScorePosition();
        practiceEnabled = !practiceEnabled;
        if (!practiceEnabled) {
          loopMode = 'off';
          loopStartPoint = null;
          loopEndPoint = null;
          loopRange = null;
        }
        persistWebviewState();
        if (wasPlaying) rescheduleAtPosition(current);
        else updatePlaybackUi();
        announcePractice('');
      }

      function setPracticeSpeed(value) {
        if (!practiceEnabled || disposed) {
          announcePractice(audioLabels.practiceEnableFirst);
          return;
        }
        if (!playbackAvailable) {
          announcePractice(audioLabels.practiceUnavailable || audioLabels.audioUnavailable);
          return;
        }
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) return;
        const next = Math.max(25, Math.min(200, Math.round(numeric / 5) * 5));
        if (next === practiceSpeed) return;
        const current = currentScorePosition();
        practiceSpeed = next;
        persistWebviewState();
        if (transport === 'playing' || transport === 'counting-in') rescheduleAtPosition(current);
        else updatePlaybackUi();
        announcePractice('');
      }

      function toggleFollow() {
        if (!practiceEnabled || disposed) {
          announcePractice(audioLabels.practiceEnableFirst);
          return;
        }
        followEnabled = !followEnabled;
        persistWebviewState();
        updatePracticeUi();
      }

      function performPlaybackAction(action) {
        if (!playbackAvailable && action !== 'stop') {
          announcePractice(audioLabels.practiceUnavailable || audioLabels.audioUnavailable);
          return;
        }
        if (action === 'togglePlayPause') {
          if (transport === 'playing' || transport === 'counting-in') pausePlayback();
          else void playOrResume();
          return;
        }
        if (action === 'stop') {
          stopPlayback();
          return;
        }
        if (action === 'practiceToggle') {
          togglePractice();
          return;
        }
        if (!playbackAvailable) {
          announcePractice(audioLabels.practiceUnavailable || audioLabels.audioUnavailable);
          return;
        }
        if (!practiceEnabled) {
          announcePractice(audioLabels.practiceEnableFirst);
          return;
        }
        if (action === 'practiceSetLoopStart') setLoopStart();
        else if (action === 'practiceSetLoopEnd') setLoopEnd();
        else if (action === 'practiceClearLoop') clearPracticeLoop();
        else if (action === 'practiceSlower') setPracticeSpeed(practiceSpeed - 5);
        else if (action === 'practiceFaster') setPracticeSpeed(practiceSpeed + 5);
      }

      function disposePlayback() {
        if (disposed) return;
        disposed = true;
        clearScheduler();
        stopVisualLoop();
        cancelScheduledNodes();
        removeScoreOverlay();
        const contextToClose = audioContext;
        audioContext = null;
        masterGain = null;
        transport = 'stopped';
        if (contextToClose && contextToClose.state !== 'closed') {
          contextToClose.close().catch(() => {});
        }
      }

      if (playBtn) playBtn.addEventListener('click', playOrResume);
      if (pauseBtn) pauseBtn.addEventListener('click', pausePlayback);
      if (stopBtn) stopBtn.addEventListener('click', stopPlayback);
      if (practiceToggle) practiceToggle.addEventListener('click', togglePractice);
      if (practiceSpeedSelect) {
        practiceSpeedSelect.addEventListener('change', () => setPracticeSpeed(practiceSpeedSelect.value));
      }
      if (practiceLoopSelect) {
        practiceLoopSelect.addEventListener('change', () => setLoopMode(practiceLoopSelect.value));
      }
      if (practiceSetAButton) practiceSetAButton.addEventListener('click', setLoopStart);
      if (practiceSetBButton) practiceSetBButton.addEventListener('click', setLoopEnd);
      if (practiceClearButton) practiceClearButton.addEventListener('click', clearPracticeLoop);
      if (practiceFollowButton) practiceFollowButton.addEventListener('click', toggleFollow);
      window.addEventListener('message', (event) => {
        const message = event && event.data;
        if (message && message.command === 'playbackAction' && typeof message.action === 'string') {
          performPlaybackAction(message.action);
        }
      });
      const disableFollowForManualNavigation = () => {
        if (!practiceEnabled || !followEnabled || disposed) return;
        followEnabled = false;
        followProgrammaticTarget = null;
        persistWebviewState();
        updatePracticeUi();
      };
      window.addEventListener('wheel', disableFollowForManualNavigation, { passive: true });
      window.addEventListener('touchmove', disableFollowForManualNavigation, { passive: true });
      window.addEventListener('keydown', (event) => {
        const targetTag = String(event && event.target && event.target.tagName || '').toUpperCase();
        if (['BUTTON', 'INPUT', 'SELECT', 'TEXTAREA'].includes(targetTag)) return;
        if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) {
          disableFollowForManualNavigation();
        }
      });
      window.addEventListener('scroll', () => {
        if (followProgrammaticTarget !== null && Math.abs((Number(window.scrollY) || 0) - followProgrammaticTarget) < 2) {
          followProgrammaticTarget = null;
          return;
        }
        if (followProgrammaticTarget !== null) followProgrammaticTarget = null;
        disableFollowForManualNavigation();
      }, { passive: true });
      if (seekSlider) {
        seekSlider.addEventListener('pointerdown', () => { scrubbing = true; });
        seekSlider.addEventListener('keydown', () => { scrubbing = true; });
        seekSlider.addEventListener('input', () => {
          scrubbing = true;
          if (playbackTime) playbackTime.textContent = formatClock(Number(seekSlider.value)) + ' / ' + formatClock(playbackDuration);
        });
        seekSlider.addEventListener('change', () => { void seekTo(seekSlider.value); });
      }
      if (countInToggle) {
        countInToggle.addEventListener('change', () => {
          countInEnabled = countInToggle.checked;
          persistWebviewState();
        });
      }
      if (metronomeToggle) {
        metronomeToggle.addEventListener('change', () => {
          metronomeEnabled = metronomeToggle.checked;
          if (!metronomeEnabled) cancelScheduledNodes('metronome');
          persistWebviewState();
        });
      }
      window.addEventListener('pagehide', disposePlayback, { once: true });
      window.addEventListener('unload', disposePlayback, { once: true });
      updatePlaybackUi();

      if (pageSizeSelect) {
        pageSizeSelect.value = currentPageSize;
      }

      function requestLayout(pageSize, orientation) {
        if (vscode) {
          vscode.postMessage({ command: 'layoutChanged', pageSize, orientation });
        }
      }

      function updateView() {
        body.setAttribute('data-display-mode', currentMode);
        modeButtons.forEach(btn => {
          btn.classList.toggle('active', btn.getAttribute('data-mode') === currentMode);
        });
        orientationButtons.forEach(btn => {
          btn.classList.toggle('active', btn.getAttribute('data-orientation') === currentOrientation);
        });
        persistWebviewState();
      }

      modeButtons.forEach(btn => {
        btn.addEventListener('click', () => {
          currentMode = btn.getAttribute('data-mode');
          updateView();
        });
      });

      orientationButtons.forEach(btn => {
        btn.addEventListener('click', () => {
          const orientation = btn.getAttribute('data-orientation');
          if (orientation !== currentOrientation) {
            requestLayout(currentPageSize, orientation);
          }
        });
      });

      if (pageSizeSelect) {
        pageSizeSelect.addEventListener('change', (e) => {
          requestLayout(e.target.value, currentOrientation);
        });
      }

      if (savePdfBtn) {
        savePdfBtn.addEventListener('click', () => {
          if (vscode) {
            vscode.postMessage({
              command: 'savePdf',
              pageSize: currentPageSize,
              orientation: currentOrientation
            });
          }
        });
      }

      // Help: intent only; the extension host opens the packaged Help (guitardsl.openHelp).
      const helpBtn = document.getElementById('btn-help');
      if (helpBtn && vscode) {
        helpBtn.addEventListener('click', () => {
          vscode.postMessage({ command: 'openHelp' });
        });
      }

      // Capo bar: intents only; the extension host computes and re-renders.
      const capoSelect = document.getElementById('select-capo');
      if (capoSelect && vscode) {
        capoSelect.addEventListener('change', (e) => {
          vscode.postMessage({ command: 'capoChanged', capo: Number(e.target.value) });
        });
      }
      const applyCapoBtn = document.getElementById('btn-apply-capo');
      if (applyCapoBtn && vscode) {
        applyCapoBtn.addEventListener('click', () => {
          vscode.postMessage({ command: 'applyCapo', capo: Number(capoSelect ? capoSelect.value : NaN) });
        });
      }
      const beginnerBtn = document.getElementById('btn-beginner');
      if (beginnerBtn && vscode) {
        beginnerBtn.addEventListener('click', () => {
          vscode.postMessage({ command: 'beginnerToggled', enabled: beginnerBtn.getAttribute('aria-pressed') !== 'true' });
        });
      }
      const barreSelect = document.getElementById('select-barre');
      if (barreSelect && vscode) {
        barreSelect.addEventListener('change', (e) => {
          vscode.postMessage({ command: 'barrePolicyChanged', policy: e.target.value });
        });
      }
      const editCapoBtn = document.getElementById('btn-edit-capo');
      if (editCapoBtn && vscode) {
        editCapoBtn.addEventListener('click', () => {
          vscode.postMessage({ command: 'editCapo' });
        });
      }

      // Clicking a chord diagram opens the chord diagram editor.
      document.addEventListener('click', (e) => {
        const diagram = e.target.closest && e.target.closest('.chord-diagram');
        if (diagram && vscode) {
          vscode.postMessage({ command: 'editChord', key: diagram.getAttribute('data-chord-key') });
        }
      });

      updateView();
    })();
  </script>
</body>
</html>`;
}

function buildPlaybackHtmlData(score: ParsedScore, msgs: Messages): PlaybackHtmlData {
  const labels = {
    play: msgs.uiPlay,
    resume: msgs.uiResume,
    audioUnavailable: msgs.uiPlaybackAudioUnavailable,
    practiceMeasure: msgs.uiPracticeMeasure,
    practiceOccurrence: msgs.uiPracticeOccurrence,
    practiceUnavailable: msgs.uiPracticeUnavailable,
    practiceEnableFirst: msgs.uiPracticeEnableFirst,
    practiceARequired: msgs.uiPracticeARequired,
    practiceInvalidEnd: msgs.uiPracticeInvalidEnd,
    practiceUnnamedSection: msgs.uiPracticeUnnamedSection,
    practiceASet: msgs.uiPracticeASet,
    practiceLoopSet: msgs.uiPracticeLoopSet,
    practiceLoopCleared: msgs.uiPracticeLoopCleared
  };
  const result = buildPlaybackTimeline(score);
  if (!result.ok) {
    const error = result.code === 'invalidPlayOrder'
      ? msgs.uiPlaybackInvalidOrder
      : msgs.uiPlaybackUnresolvedTempo;
    return { available: false, durationSeconds: 0, events: [], occurrences: [], countInDurationSeconds: 0, countInClicks: [], labels, error };
  }

  const { timeline } = result;
  if (timeline.occurrences.length === 0 || !Number.isFinite(timeline.durationSeconds) || timeline.durationSeconds <= 0) {
    return {
      available: false,
      durationSeconds: 0,
      events: [],
      occurrences: [],
      countInDurationSeconds: 0,
      countInClicks: [],
      labels,
      error: msgs.uiPlaybackEmpty
    };
  }

  const parsedCapo = Number(score.capo);
  const effectiveCapo = Number.isInteger(parsedCapo) && parsedCapo >= 0 && parsedCapo <= 12 ? parsedCapo : 0;
  const first = timeline.occurrences[0];
  const countInDurationSeconds = fnum(measureBeats(first.timeSignature)) * 60 / first.tempoBpm;
  const countInClicks = beamGroupStarts(first.timeSignature).map((beat, groupIndex) => ({
    timeSeconds: fnum(beat) * 60 / first.tempoBpm,
    accent: groupIndex === 0
  }));
  const occurrences: PlaybackHtmlOccurrence[] = timeline.occurrences.map(occurrence => ({
    occurrenceIndex: occurrence.occurrenceIndex,
    measureIndex: occurrence.measureIndex,
    ...(occurrence.sectionName === undefined ? {} : { sectionName: occurrence.sectionName }),
    startSeconds: occurrence.startSeconds,
    durationSeconds: occurrence.durationSeconds,
    countInDurationSeconds: fnum(measureBeats(occurrence.timeSignature)) * 60 / occurrence.tempoBpm,
    countInClicks: beamGroupStarts(occurrence.timeSignature).map((beat, groupIndex) => ({
      timeSeconds: fnum(beat) * 60 / occurrence.tempoBpm,
      accent: groupIndex === 0
    }))
  }));

  return {
    available: true,
    durationSeconds: timeline.durationSeconds,
    events: timeline.events.map(event => ({ ...event, midiNotes: playbackEventMidiNotes(event, effectiveCapo) })),
    occurrences,
    countInDurationSeconds,
    countInClicks,
    labels
  };
}

function escapeJsonForHtml(json: string): string {
  return json.replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
}

function formatPlaybackTime(seconds: number): string {
  const wholeSeconds = Math.max(0, Math.floor(seconds));
  const minutes = String(Math.floor(wholeSeconds / 60)).padStart(2, '0');
  const remainder = String(wholeSeconds % 60).padStart(2, '0');
  return `${minutes}:${remainder}`;
}

function renderCspMeta(cspSource: string, nonce: string): string {
  const policy = [
    "default-src 'none'",
    `font-src ${cspSource}`,
    `img-src ${cspSource} data:`,
    `style-src 'nonce-${nonce}'`,
    "style-src-attr 'unsafe-inline'",
    `script-src 'nonce-${nonce}'`,
    "connect-src 'none'",
    "media-src 'none'",
    "object-src 'none'",
    "worker-src 'none'"
  ].join('; ');
  return `<meta http-equiv="Content-Security-Policy" content="${escapeXml(policy)}">`;
}

/** Beginner Mode toggle and barre policy (shown before the capo buttons). */
function renderBeginnerControls(beginner: BeginnerPreviewUiModel | undefined, msgs: Messages, disabled: string): string {
  const active = beginner?.active === true;
  const toggle = `<button class="capo-btn beginner-toggle" id="btn-beginner" aria-pressed="${active}" title="${escapeXml(msgs.uiBeginnerModeTitle)}"${disabled}>${escapeXml(`${msgs.uiBeginnerMode}: ${active ? msgs.uiBeginnerOn : msgs.uiBeginnerOff}`)}</button>`;
  if (!active || !beginner) return toggle;
  const policy = (value: string, label: string) => `<option value="${value}"${beginner.barrePolicy === value ? ' selected' : ''}>${escapeXml(label)}</option>`;
  return `${toggle}
    <span class="toolbar-label">${escapeXml(msgs.uiBarreChords)}</span>
    <select id="select-barre" class="tool-select" title="${escapeXml(msgs.uiBarreTitle)}">${policy('allow', msgs.uiBarreAllow)}${policy('forbid', msgs.uiBarreForbid)}</select>`;
}

/** Beginner Mode notes (auto capo, substitution summary), shown after the capo buttons. */
function renderBeginnerNotes(beginner: BeginnerPreviewUiModel | undefined, msgs: Messages): string {
  if (!beginner?.active) return '';
  const subs = beginner.substitutions.map(([from, to]) => `${from} → ${to}`).join(', ');
  return `${beginner.autoCapo ? `<span class="capo-note" id="beginner-auto">${escapeXml(`${msgs.uiCapo}: ${msgs.uiBeginnerAuto}`)}</span>` : ''}
    ${subs ? `<span class="capo-note" id="beginner-substitutions">${escapeXml(`${msgs.uiBeginnerSubstitutions}: ${subs}`)}</span>` : ''}`;
}

function renderCapoBar(model: CapoPreviewUiModel, msgs: Messages, beginner?: BeginnerPreviewUiModel): string {
  const options = model.candidates.map(c => {
    const parts = [`${msgs.uiCapo} ${c.capo}`];
    if (c.score !== undefined) parts.push(`${c.score}`);
    if (c.recommended) parts.push(`★ ${msgs.uiRecommended}`);
    if (!c.supported) parts.push('—');
    const attrs = [`value="${c.capo}"`];
    if (c.capo === model.targetCapo) attrs.push('selected');
    if (!c.supported) attrs.push('disabled');
    return `<option ${attrs.join(' ')}>${escapeXml(parts.join(' · '))}</option>`;
  }).join('');
  const recommended = model.candidates.find(c => c.recommended);
  const play = model.currentPlayability;
  const badge = play
    ? `<span class="capo-badge" id="capo-playability" data-level="${play.level}" data-score="${play.score}">${escapeXml(`${msgs.playabilityLevels[play.level]} ${play.score}/100`)}</span>`
    : `<span class="capo-badge" id="capo-playability">${escapeXml(msgs.uiPlayabilityUnavailable)}</span>`;
  const disabled = model.sourceCapo === null ? ' disabled' : '';
  return `<div class="capo-bar" id="capo-bar" data-source-capo="${model.sourceCapo ?? ''}" data-target-capo="${model.targetCapo}" data-beginner="${beginner?.active === true}">
    <span class="toolbar-label">${escapeXml(msgs.uiCapo)}</span>
    <select id="select-capo" class="tool-select" title="${escapeXml(msgs.uiCapoTitle)}"${disabled}>${options}</select>
    <span class="toolbar-label">${escapeXml(msgs.uiPlayability)}</span>
    ${badge}
    ${recommended ? `<span class="toolbar-label">★ ${escapeXml(msgs.uiRecommended)}: ${escapeXml(`${msgs.uiCapo} ${recommended.capo}`)}</span>` : ''}
    ${model.overridden ? `<span class="capo-note">${escapeXml(msgs.uiCapoPreviewOnly)}</span>` : ''}
    ${renderBeginnerControls(beginner, msgs, disabled)}
    <button class="capo-btn primary" id="btn-apply-capo" title="${escapeXml(msgs.uiApplyToDslTitle)}"${model.canApply ? '' : ' disabled'}>${escapeXml(msgs.uiApplyToDsl)}</button>
    <button class="capo-btn" id="btn-edit-capo" title="${escapeXml(msgs.uiEditCapoTitle)}">${escapeXml(msgs.uiEditCapo)}</button>
    ${renderBeginnerNotes(beginner, msgs)}
    ${model.warning ? `<span class="capo-warning" id="capo-warning">${escapeXml(model.warning)}</span>` : ''}
  </div>`;
}
