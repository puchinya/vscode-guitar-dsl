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

interface PlaybackHtmlData {
  available: boolean;
  durationSeconds: number;
  events: PlaybackHtmlEvent[];
  countInDurationSeconds: number;
  countInClicks: { timeSeconds: number; accent: boolean }[];
  labels: { play: string; resume: string; audioUnavailable: string };
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
  .toolbar-left, .toolbar-center, .toolbar-right {
    display: flex;
    align-items: center;
    gap: 8px;
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
    <span class="playback-error" id="playback-error" role="status" aria-live="polite">${escapeXml(playback.error ?? '')}</span>
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

      if (vscode) {
        const state = vscode.getState();
        if (state && ['single', 'spread', 'web'].includes(state.currentMode)) {
          currentMode = state.currentMode;
        }
        if (state && typeof state.countInEnabled === 'boolean') countInEnabled = state.countInEnabled;
        if (state && typeof state.metronomeEnabled === 'boolean') metronomeEnabled = state.metronomeEnabled;
      }

      const modeButtons = document.querySelectorAll('.tool-btn[data-mode]');
      const orientationButtons = document.querySelectorAll('.tool-btn[data-orientation]');
      const pageSizeSelect = document.getElementById('select-page-size');
      const savePdfBtn = document.getElementById('btn-save-pdf');
      const countInToggle = document.getElementById('count-in-toggle');
      const metronomeToggle = document.getElementById('metronome-toggle');
      if (countInToggle) countInToggle.checked = countInEnabled;
      if (metronomeToggle) metronomeToggle.checked = metronomeEnabled;

      function persistWebviewState() {
        if (vscode) vscode.setState({ currentMode, countInEnabled, metronomeEnabled });
      }

      const playbackDataElement = document.getElementById('playback-data');
      let playbackData;
      try {
        playbackData = JSON.parse(playbackDataElement ? playbackDataElement.textContent : '{}');
      } catch (_) {
        playbackData = { available: false, durationSeconds: 0, events: [], countInClicks: [], countInDurationSeconds: 0, labels: {}, error: '' };
      }
      if (!playbackData || typeof playbackData !== 'object') {
        playbackData = { available: false, durationSeconds: 0, events: [], countInClicks: [], countInDurationSeconds: 0, labels: {}, error: '' };
      }
      const playbackAvailable = playbackData.available === true;
      const playbackDuration = Math.max(0, Number(playbackData.durationSeconds) || 0);
      const playbackEvents = Array.isArray(playbackData.events) ? playbackData.events : [];
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
      let nextPlaybackEventIndex = 0;
      let schedulerTimer = null;
      let audioContext = null;
      let masterGain = null;
      let startPending = false;
      let scrubbing = false;
      let disposed = false;
      const activeNodes = new Set();
      const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;

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
        return clampScoreTime(scoreAnchorSeconds + elapsed);
      }

      function setPlaybackError(message) {
        if (playbackError) playbackError.textContent = message || '';
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

      function schedulePlaybackEvent(ctx, event, when) {
        if (event.kind === 'metronome') {
          if (metronomeEnabled) scheduleTone(ctx, when, 0.03, event.accent ? 1000 : 700, 'sine', 0.25, 'metronome');
          return;
        }
        if (event.kind === 'rest' || !Array.isArray(event.midiNotes) || event.midiNotes.length === 0) return;
        const duration = Math.max(0, Number(event.durationSeconds) || 0);
        if (duration <= 0) return;
        const isChord = event.kind === 'rhythmAttack';
        const voiceGain = (isChord ? 0.34 : 0.24) / event.midiNotes.length;
        for (const midi of event.midiNotes) {
          if (!Number.isFinite(midi)) continue;
          const frequency = 440 * Math.pow(2, (midi - 69) / 12);
          scheduleTone(ctx, when, duration, frequency, isChord ? 'triangle' : 'sine', voiceGain, 'score');
        }
      }

      function setNextEventIndex(scoreSeconds) {
        let low = 0;
        let high = playbackEvents.length;
        while (low < high) {
          const mid = (low + high) >>> 1;
          if (playbackEvents[mid].timeSeconds < scoreSeconds - 0.000001) low = mid + 1;
          else high = mid;
        }
        nextPlaybackEventIndex = low;
      }

      function finishPlayback() {
        clearScheduler();
        cancelScheduledNodes();
        positionSeconds = playbackDuration;
        transport = 'ended';
        updatePlaybackUi();
      }

      function schedulerTick() {
        if (!audioContext || (transport !== 'playing' && transport !== 'counting-in')) return;
        const now = audioContext.currentTime;
        if (transport === 'counting-in' && now >= scoreAnchorAudioTime) transport = 'playing';
        const horizon = now + 0.1;
        while (nextPlaybackEventIndex < playbackEvents.length) {
          const event = playbackEvents[nextPlaybackEventIndex];
          const eventAudioTime = scoreAnchorAudioTime + event.timeSeconds - scoreAnchorSeconds;
          if (eventAudioTime > horizon) break;
          nextPlaybackEventIndex++;
          if (eventAudioTime >= now - 0.005) schedulePlaybackEvent(audioContext, event, eventAudioTime);
        }
        if (transport === 'playing') {
          positionSeconds = scoreTimeFromAudioClock();
          if (positionSeconds >= playbackDuration) {
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

      async function startFromPosition(scoreSeconds, useCountIn) {
        if (startPending || disposed || !playbackAvailable) return;
        startPending = true;
        clearScheduler();
        updatePlaybackUi();
        try {
          const ctx = await ensureAudioContext();
          if (!ctx) return;
          cancelScheduledNodes();
          positionSeconds = clampScoreTime(scoreSeconds);
          scoreAnchorSeconds = positionSeconds;
          const scoreStartDelay = 0.025;
          const countIn = useCountIn && playbackData.countInDurationSeconds > 0;
          if (countIn) {
            const countInStart = ctx.currentTime + scoreStartDelay;
            for (const click of playbackData.countInClicks || []) {
              scheduleTone(ctx, countInStart + click.timeSeconds, 0.03, click.accent ? 1000 : 700, 'sine', 0.25, 'count-in');
            }
            scoreAnchorAudioTime = countInStart + playbackData.countInDurationSeconds;
            transport = 'counting-in';
          } else {
            scoreAnchorAudioTime = ctx.currentTime + scoreStartDelay;
            transport = 'playing';
          }
          setNextEventIndex(positionSeconds);
          setPlaybackError('');
          startScheduler();
        } catch (_) {
          transport = 'stopped';
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
        const from = transport === 'ended' ? 0 : positionSeconds;
        const countIn = transport === 'stopped' && from === 0 && countInEnabled;
        await startFromPosition(from, countIn);
      }

      function pausePlayback() {
        if (transport !== 'playing' && transport !== 'counting-in') return;
        positionSeconds = scoreTimeFromAudioClock();
        clearScheduler();
        cancelScheduledNodes();
        transport = 'paused';
        updatePlaybackUi();
      }

      function stopPlayback() {
        if (disposed) return;
        clearScheduler();
        cancelScheduledNodes();
        positionSeconds = 0;
        scoreAnchorSeconds = 0;
        transport = 'stopped';
        updatePlaybackUi();
      }

      async function seekTo(value) {
        if (!playbackAvailable || disposed) return;
        const target = clampScoreTime(Number(value));
        const wasPlaying = transport === 'playing' || transport === 'counting-in';
        scrubbing = false;
        if (wasPlaying) {
          clearScheduler();
          cancelScheduledNodes();
          await startFromPosition(target, false);
          return;
        }
        positionSeconds = target;
        if (transport === 'ended' && target < playbackDuration) transport = 'stopped';
        updatePlaybackUi();
      }

      function disposePlayback() {
        if (disposed) return;
        disposed = true;
        clearScheduler();
        cancelScheduledNodes();
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
  const labels = { play: msgs.uiPlay, resume: msgs.uiResume, audioUnavailable: msgs.uiPlaybackAudioUnavailable };
  const result = buildPlaybackTimeline(score);
  if (!result.ok) {
    const error = result.code === 'invalidPlayOrder'
      ? msgs.uiPlaybackInvalidOrder
      : msgs.uiPlaybackUnresolvedTempo;
    return { available: false, durationSeconds: 0, events: [], countInDurationSeconds: 0, countInClicks: [], labels, error };
  }

  const { timeline } = result;
  if (timeline.occurrences.length === 0 || !Number.isFinite(timeline.durationSeconds) || timeline.durationSeconds <= 0) {
    return {
      available: false,
      durationSeconds: 0,
      events: [],
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

  return {
    available: true,
    durationSeconds: timeline.durationSeconds,
    events: timeline.events.map(event => ({ ...event, midiNotes: playbackEventMidiNotes(event, effectiveCapo) })),
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
