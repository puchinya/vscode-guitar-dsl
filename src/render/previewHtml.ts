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
  /** Precomputed capo / playability state retained for the host's effective DSL and export flow. */
  capo?: CapoPreviewUiModel;
  /** Beginner Mode state retained for the host's effective DSL and export flow. */
  beginner?: BeginnerPreviewUiModel;
  /** Host-owned Inspector progression-audition lease; locks playback on newly rendered Preview pages. */
  progressionAudioLeaseId?: string;
  /** Production Webview CSP source; omitted by non-Webview/test callers. */
  cspSource?: string;
  /** Fresh production nonce for the executable script and main style element. */
  nonce?: string;
  /** One-shot target to focus after the host rebuilds Preview for a paper/orientation change. */
  restoreFocusControl?: PreviewFocusControl;
  /** Identity bound to the one-shot focus hint so stale messages cannot restore focus. */
  documentUri?: string;
  documentVersion?: number;
  previewGeneration?: number;
}

export type PreviewLayoutFocusControl = 'select-page-size' | 'orientation-portrait' | 'orientation-landscape';

export type PreviewFocusControl = PreviewLayoutFocusControl
  | 'preview-capo-select'
  | 'toggle-preview-beginner'
  | 'select-preview-barre-policy'
  | 'select-preview-beginner-capo-mode';

export function isPreviewLayoutFocusControl(value: unknown): value is PreviewLayoutFocusControl {
  return value === 'select-page-size' || value === 'orientation-portrait' || value === 'orientation-landscape';
}

export function isPreviewFocusControl(value: unknown): value is PreviewFocusControl {
  return isPreviewLayoutFocusControl(value)
    || value === 'preview-capo-select'
    || value === 'toggle-preview-beginner'
    || value === 'select-preview-barre-policy'
    || value === 'select-preview-beginner-capo-mode';
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
  rhythmTieRestartEvents?: PlaybackHtmlEvent[];
  occurrences: PlaybackHtmlOccurrence[];
  countInDurationSeconds: number;
  countInClicks: { timeSeconds: number; accent: boolean }[];
  labels: Record<string, string>;
  error?: string;
  progressionAudioLeaseId?: string;
}

export type ProgressionAuditionMode = 'chord' | 'bars' | 'melody' | 'song';

export interface ProgressionAuditionPlaybackData {
  readonly durationSeconds: number;
  readonly events: readonly {
    readonly kind: 'pitched' | 'rhythmAttack';
    readonly source?: 'melody' | 'inline' | 'rhythm';
    readonly timeSeconds: number;
    readonly durationSeconds: number;
    readonly midiNotes: readonly number[];
  }[];
}

export type ProgressionAuditionPlaybackResult =
  | { readonly ok: true; readonly data: ProgressionAuditionPlaybackData }
  | { readonly ok: false; readonly code: 'audioUnavailable' | 'fullSongOnly'; readonly message: string };

const PX_PER_PT = 96 / 72;

/** Builds the webview document: an HTML toolbar plus one SVG per sheet (and a continuous SVG for web mode). */
export function compileGuitarDslToHtml(dslContent: string, options?: CompileHtmlOptions): string {
  const locale = resolveLocale(options?.locale);
  const msgs = getMessages(locale);
  const pageSize = options?.pageSize ?? 'A4';
  const orientation = options?.orientation ?? 'portrait';
  const capoUi = options?.capo;
  const beginnerUi = options?.beginner ?? { active: false, barrePolicy: 'forbid' as const, autoCapo: true, substitutions: [] };
  const capoCandidates: CapoPreviewUiModel['candidates'] = capoUi?.candidates.length === 13
    ? capoUi.candidates
    : Array.from({ length: 13 }, (_, capo) => ({ capo, supported: false, recommended: false }));
  const selectedCapo = capoUi?.sourceCapo === null || capoUi?.sourceCapo === undefined ? '' : String(capoUi.targetCapo);
  const capoOptionsHtml = [
    `<option value="" disabled${selectedCapo === '' ? ' selected' : ''}>${escapeXml(msgs.uiPlayabilityUnavailable)}</option>`,
    ...capoCandidates.map(candidate => {
      const recommended = candidate.recommended ? ' ★' : '';
      return `<option value="${candidate.capo}"${candidate.capo === Number(selectedCapo) && selectedCapo !== '' ? ' selected' : ''}${candidate.supported ? '' : ' disabled'}>${candidate.capo}${recommended}</option>`;
    })
  ].join('');
  const currentPlayabilityLabel = capoUi?.currentPlayability
    ? `${capoUi.currentPlayability.score}/100 · ${msgs.playabilityLevels[capoUi.currentPlayability.level]}`
    : msgs.uiPlayabilityUnavailable;
  const currentPlayabilityControlLabel = capoUi?.currentPlayability
    ? `${msgs.uiPlayability} ${msgs.playabilityLevels[capoUi.currentPlayability.level]} ${capoUi.currentPlayability.score}/100`
    : `${msgs.uiPlayability} ${msgs.uiPlayabilityUnavailable}`;
  const playabilityLevel = capoUi?.currentPlayability?.level ?? 'unavailable';
  const capoSelectDisabled = capoUi?.sourceCapo === null || capoUi?.sourceCapo === undefined
    || (beginnerUi.active && beginnerUi.autoCapo);
  const score = parseGuitarDsl(dslContent, {
    expandPageBreakRepeats: options?.expandPageBreakRepeats
  });
  const playback = buildPlaybackHtmlData(score, msgs);
  if (options?.progressionAudioLeaseId) playback.progressionAudioLeaseId = options.progressionAudioLeaseId;
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
  const previewIdentityJson = escapeJsonForHtml(JSON.stringify({
    documentUri: options?.documentUri ?? null,
    documentVersion: Number.isSafeInteger(options?.documentVersion) ? options?.documentVersion : null,
    previewGeneration: Number.isSafeInteger(options?.previewGeneration) ? options?.previewGeneration : null
  }));
  const restoreFocusControlJson = JSON.stringify(isPreviewFocusControl(options?.restoreFocusControl)
    ? options.restoreFocusControl
    : null);
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
    padding: 110px 16px 36px 16px;
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
    background: var(--vscode-editorWidget-background, #252526);
    border-bottom: 1px solid var(--vscode-editorWidget-border, #3c3c3c);
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 8px;
    z-index: 1000;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
    color: var(--vscode-foreground, #cccccc);
    user-select: none;
  }
  .score-settings-row {
    position: fixed;
    top: 48px;
    left: 0;
    right: 0;
    height: 44px;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 8px;
    background: var(--vscode-editorWidget-background, #252526);
    border-bottom: 1px solid var(--vscode-editorWidget-border, #3c3c3c);
    color: var(--vscode-foreground, #cccccc);
    z-index: 999;
    user-select: none;
  }
  .score-settings-primary,
  .score-settings-capo,
  .score-settings-beginner,
  .score-settings-playability {
    display: flex;
    align-items: center;
    flex: 0 0 auto;
    gap: 5px;
    min-width: 0;
    white-space: nowrap;
  }
  .score-settings-primary { flex: 0 0 auto; gap: 8px; }
  .score-settings-label { color: var(--vscode-descriptionForeground, #cccccc); font-size: 11px; }
  .score-settings-select {
    min-width: 0;
    max-width: 92px;
    height: 28px;
    border: 1px solid var(--vscode-widget-border, #555);
    border-radius: 4px;
    padding: 2px 4px;
    background: var(--vscode-input-background, #252526);
    color: var(--vscode-input-foreground, #eeeeee);
    font: inherit;
    font-size: 11px;
  }
  .score-settings-playability {
    font-size: 11px;
    font-variant-numeric: tabular-nums;
  }
  .score-settings-playability[data-level="veryEasy"],
  .score-settings-playability[data-level="easy"] { color: #2e7d32; font-weight: 600; }
  .score-settings-playability[data-level="moderate"] { color: #8d6e00; font-weight: 600; }
  .score-settings-playability[data-level="hard"],
  .score-settings-playability[data-level="veryHard"] { color: #b71c1c; font-weight: 600; }
  .score-settings-playability[data-level="unavailable"] { color: var(--vscode-descriptionForeground, #cccccc); }
  .score-settings-beginner { cursor: pointer; font-size: 11px; }
  .score-settings-beginner input { margin: 0; }
  .score-settings-overflow { flex: 1 1 auto; min-width: 0; display: flex; align-items: center; gap: 8px; }
  .score-settings-overflow-toggle { display: none; }
  .score-settings-row .temporary-score-settings-panel[data-inline="true"] {
    position: static;
    display: flex;
    align-items: center;
    gap: 8px;
    width: auto;
    max-width: none;
    max-height: none;
    overflow: visible;
    padding: 0;
    border: 0;
    border-radius: 0;
    background: transparent;
    box-shadow: none;
  }
  .score-settings-row .temporary-score-settings-panel[data-inline="true"] .toolbar-panel-section,
  .score-settings-row .temporary-score-settings-panel[data-inline="true"] .toolbar-panel-section + .toolbar-panel-section {
    align-items: center;
    gap: 6px;
    margin: 0;
    padding: 0;
    border: 0;
    flex-wrap: nowrap;
  }
  .score-settings-row .temporary-score-settings-panel[data-inline="true"] .toolbar-panel-field { min-width: 82px; flex: 0 0 auto; }
  .score-settings-row .temporary-score-settings-panel[data-inline="true"] .toolbar-action { padding-left: 4px; padding-right: 4px; white-space: nowrap; }
  .score-settings-row .temporary-score-settings-panel[data-inline="true"] .toolbar-panel-field > span,
  .score-settings-row .temporary-score-settings-panel[data-inline="true"] .toolbar-panel-label { display: none; }
  .score-settings-row .temporary-score-settings-panel[data-inline="true"] .toolbar-panel-section:has(.settings-substitutions),
  .score-settings-row .temporary-score-settings-panel[data-inline="true"] .toolbar-panel-section:has(.settings-warning) { display: none; }
  .toolbar-transport, .toolbar-actions {
    display: flex;
    align-items: center;
    gap: 6px;
    flex: 0 0 auto;
    min-width: 0;
  }
  .toolbar-transport {
    flex: 1 1 auto;
    gap: 4px;
  }
  .toolbar-actions {
    position: relative;
    max-width: 72%;
    overflow-x: auto;
    overflow-y: hidden;
    scrollbar-width: thin;
  }
  .toolbar-action, .playback-control-btn {
    flex: 0 0 auto;
    min-height: 30px;
    border: 1px solid var(--vscode-button-border, #555);
    border-radius: 4px;
    background: var(--vscode-button-secondaryBackground, #252526);
    color: var(--vscode-button-secondaryForeground, #eeeeee);
    padding: 4px 8px;
    font: inherit;
    font-size: 12px;
    cursor: pointer;
  }
  .toolbar-action:hover, .playback-control-btn:hover:not(:disabled) {
    background: var(--vscode-button-secondaryHoverBackground, #3c3c3c);
  }
  .toolbar-action:focus-visible, .playback-control-btn:focus-visible,
  .playback-seek:focus-visible, .toolbar-disclosure-panel :focus-visible {
    outline: 2px solid var(--vscode-focusBorder, #3794ff);
    outline-offset: 1px;
  }
  .playback-control-btn:disabled { opacity: 0.45; cursor: default; }
  .playback-seek {
    flex: 1 1 120px;
    min-width: 44px;
    accent-color: var(--vscode-focusBorder, #3794ff);
  }
  .playback-time {
    flex: 0 0 auto;
    min-width: 88px;
    color: var(--vscode-descriptionForeground, #cccccc);
    font-variant-numeric: tabular-nums;
    font-size: 12px;
    white-space: nowrap;
  }
  .toolbar-action-label { white-space: nowrap; }
  .practice-toggle[aria-pressed="true"] {
    background: var(--vscode-button-background, #0e639c);
    color: var(--vscode-button-foreground, #fff);
  }
  .toolbar-disclosure { position: relative; flex: 0 0 auto; }
  .toolbar-disclosure-panel {
    position: fixed;
    z-index: 1200;
    width: min(360px, calc(100vw - 16px));
    max-height: calc(100vh - 64px);
    overflow: auto;
    padding: 10px;
    border: 1px solid var(--vscode-widget-border, #555);
    border-radius: 6px;
    background: var(--vscode-editorWidget-background, #252526);
    color: var(--vscode-foreground, #eeeeee);
    box-shadow: 0 6px 18px rgba(0, 0, 0, 0.35);
  }
  .toolbar-disclosure-panel[hidden] { display: none; }
  #temporary-score-settings-panel[hidden] { display: none !important; }
  .toolbar-panel-section { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .toolbar-panel-section + .toolbar-panel-section { margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--vscode-widget-border, #555); }
  .toolbar-panel-label { flex: 0 0 100%; color: var(--vscode-descriptionForeground, #aaa); font-size: 11px; }
  .toolbar-disclosure-panel .segmented-control { background: var(--vscode-input-background, #1e1e1e); }
  .toolbar-disclosure-panel .tool-btn { color: var(--vscode-foreground, #aaa); }
  .toolbar-disclosure-panel .tool-btn.active { background: var(--vscode-button-background, #007acc); color: var(--vscode-button-foreground, #fff); }
  .toolbar-disclosure-panel .tool-select { background: var(--vscode-input-background, #1e1e1e); color: var(--vscode-input-foreground, #eee); }
  .temporary-score-settings-panel .toolbar-panel-section { align-items: flex-start; }
  .temporary-score-settings-panel .toolbar-panel-field { display: grid; gap: 4px; min-width: 132px; flex: 1 1 132px; }
  .temporary-score-settings-panel .toolbar-panel-field > span,
  .temporary-score-settings-panel .toolbar-panel-label { color: var(--vscode-descriptionForeground, #aaa); font-size: 11px; }
  .temporary-score-settings-panel .tool-select { width: 100%; min-width: 0; max-width: 100%; box-sizing: border-box; }
  .temporary-score-settings-panel .settings-playability {
    display: block;
    min-width: 0;
    max-width: 100%;
    color: var(--vscode-descriptionForeground, #aaa);
    font-size: 12px;
    white-space: normal;
    overflow-wrap: anywhere;
  }
  .temporary-score-settings-panel .settings-warning { flex: 1 1 100%; color: var(--vscode-errorForeground, #f48771); font-size: 12px; }
  .temporary-score-settings-panel .settings-substitutions { margin: 0; padding-left: 18px; font-size: 12px; }
  .toolbar-score-indicator { margin-left: 4px; color: var(--vscode-descriptionForeground, #ccc); font-variant-numeric: tabular-nums; }
  .playback-toggle {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: var(--vscode-foreground, #cccccc);
    font-size: 12px;
    cursor: pointer;
  }
  .playback-error {
    margin: 0 16px 8px;
    color: var(--vscode-errorForeground, #f48771);
    font-size: 12px;
    overflow-wrap: anywhere;
  }
  .playback-error:empty { display: none; }
  .practice-toolbar {
    position: fixed;
    top: 92px;
    left: 0;
    right: 0;
    height: 42px;
    display: none;
    align-items: center;
    gap: 8px;
    padding: 0 16px;
    background: var(--vscode-editorWidget-background, #2d2d30);
    border-bottom: 1px solid var(--vscode-editorWidget-border, #3c3c3c);
    color: var(--vscode-foreground, #eeeeee);
    z-index: 998;
    white-space: nowrap;
    overflow-x: auto;
    user-select: none;
  }
  body.has-practice-row { padding-top: 152px !important; }
  body.has-practice-row .practice-toolbar { display: flex; }
  .practice-control-label {
    display: inline-flex;
    flex: 0 0 auto;
    align-items: center;
    gap: 4px;
    color: var(--vscode-foreground, #cccccc);
    font-size: 12px;
  }
  .practice-select {
    flex: 0 0 auto;
    min-width: 68px;
    border: 1px solid #555;
    border-radius: 4px;
    background: var(--vscode-input-background, #252526);
    color: var(--vscode-input-foreground, #eeeeee);
    padding: 3px 6px;
    font: inherit;
    font-size: 12px;
  }
  .practice-button {
    flex: 0 0 auto;
    border: 1px solid var(--vscode-widget-border, #555);
    border-radius: 4px;
    background: var(--vscode-button-secondaryBackground, #252526);
    color: var(--vscode-button-secondaryForeground, #eeeeee);
    padding: 4px 9px;
    font: inherit;
    font-size: 12px;
    cursor: pointer;
  }
  .practice-button:hover:not(:disabled) { background: var(--vscode-button-secondaryHoverBackground, #3c3c3c); }
  .practice-button:focus-visible, .practice-select:focus-visible {
    outline: 2px solid var(--vscode-focusBorder, #3794ff);
    outline-offset: 1px;
  }
  .practice-button:disabled, .practice-select:disabled { opacity: 0.45; cursor: default; }
  .practice-button[aria-pressed="true"] { background: var(--vscode-button-background, #0e639c); border-color: var(--vscode-button-background, #0e639c); }
  .practice-status {
    flex: 1 0 140px;
    min-width: 140px;
    overflow: hidden;
    color: var(--vscode-descriptionForeground, #cccccc);
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

  @media (max-width: 899px) {
    .toolbar-action-label { display: none; }
    .toolbar-action, .playback-control-btn { padding-left: 6px; padding-right: 6px; }
    .toolbar-actions { max-width: 57%; gap: 4px; }
  }
  @media (max-width: 660px) {
    .transport-label { display: none; }
    .playback-time { min-width: 70px; }
    .toolbar-actions { max-width: 60%; }
  }
  @media (max-width: 839px) {
    .score-settings-overflow { flex: 0 0 auto; }
    .score-settings-overflow-toggle { display: inline-flex; }
    .score-settings-row .temporary-score-settings-panel[data-inline="false"] {
      position: fixed;
      display: block;
    }
  }
  @media (max-width: 440px) {
    .toolbar-container { padding-left: 4px; padding-right: 4px; gap: 3px; }
    .toolbar-transport { gap: 2px; }
    .transport-label { display: none; }
    .playback-time { min-width: 70px; font-size: 10px; }
    .playback-control-btn { width: 30px; padding: 3px 2px; font-size: 11px; }
    .toolbar-actions { max-width: 36%; gap: 3px; }
    .score-settings-row { gap: 3px; padding-left: 4px; padding-right: 4px; }
    .score-settings-primary { gap: 4px; }
    .score-settings-label, .score-settings-playability { font-size: 10px; }
    .score-settings-select { max-width: 64px; height: 26px; padding: 2px; font-size: 10px; }
    .score-settings-beginner { gap: 2px; font-size: 10px; }
    .score-settings-overflow-toggle { min-height: 26px; padding: 2px 5px; font-size: 10px; }
  }
  @media (max-width: 360px) {
    .playback-time { min-width: 62px; font-size: 9px; }
    .playback-seek { min-width: 28px; }
    .playback-control-btn { width: 28px; }
    .toolbar-actions { max-width: 32%; }
  }
  .chord-diagram:hover > rect:first-child {
    fill: #0078d4;
    fill-opacity: 0.08;
  }
</style>
</head>
<body data-display-mode="single" data-orientation="${orientation}" data-page-size="${pageSize}"
  data-preview-document-uri="${escapeXml(options?.documentUri ?? '')}"
  data-preview-document-version="${Number.isSafeInteger(options?.documentVersion) ? options?.documentVersion : ''}"
  data-preview-generation="${Number.isSafeInteger(options?.previewGeneration) ? options?.previewGeneration : ''}">
  <div class="toolbar-container" role="group" aria-label="${escapeXml(msgs.uiPlaybackGroup)}">
    <div class="toolbar-transport">
    <button class="playback-control-btn" id="btn-play" type="button" title="${escapeXml(msgs.uiPlay)}" aria-label="${escapeXml(msgs.uiPlay)}"${playback.available ? '' : ' disabled'}><span class="transport-glyph" aria-hidden="true">▶</span> <span id="play-label" class="transport-label">${escapeXml(msgs.uiPlay)}</span></button>
    <button class="playback-control-btn" id="btn-pause" type="button" title="${escapeXml(msgs.uiPause)}" aria-label="${escapeXml(msgs.uiPause)}" disabled><span aria-hidden="true">Ⅱ</span> <span class="transport-label">${escapeXml(msgs.uiPause)}</span></button>
    <button class="playback-control-btn" id="btn-stop" type="button" title="${escapeXml(msgs.uiStop)}" aria-label="${escapeXml(msgs.uiStop)}" disabled><span aria-hidden="true">■</span> <span class="transport-label">${escapeXml(msgs.uiStop)}</span></button>
    <input class="playback-seek" id="playback-seek" type="range" min="0" max="${playback.durationSeconds}" step="0.01" value="0" aria-label="${escapeXml(msgs.uiSeek)}"${playback.available ? '' : ' disabled'}>
    <span class="playback-time" id="playback-time" aria-label="${escapeXml(msgs.uiPlaybackTime)}">00:00 / ${formatPlaybackTime(playback.durationSeconds)}</span>
    </div>
    <div id="toolbar-actions" class="toolbar-actions">
      <button class="toolbar-action practice-toggle" id="practice-toggle" type="button" aria-pressed="false" title="${escapeXml(msgs.uiPracticeTitle)}" aria-label="${escapeXml(msgs.uiPracticeTitle)}"${playback.available ? '' : ' disabled'}><span aria-hidden="true">◎</span> <span class="toolbar-action-label">${escapeXml(msgs.uiPractice)}</span></button>
      <div class="toolbar-disclosure">
        <button class="toolbar-action" id="playback-options-toggle" type="button" aria-expanded="false" aria-controls="playback-options-panel" aria-label="${escapeXml(msgs.uiPlaybackOptionsTitle)}" title="${escapeXml(msgs.uiPlaybackOptionsTitle)}"><span aria-hidden="true">⚙</span> <span class="toolbar-action-label">${escapeXml(msgs.uiPlaybackOptions)}</span></button>
        <div class="toolbar-disclosure-panel" id="playback-options-panel" role="group" aria-label="${escapeXml(msgs.uiPlaybackOptions)}" hidden>
          <label class="playback-toggle"><input id="count-in-toggle" type="checkbox">${escapeXml(msgs.uiCountIn)}</label>
          <label class="playback-toggle"><input id="metronome-toggle" type="checkbox">${escapeXml(msgs.uiMetronome)}</label>
        </div>
      </div>
      <div class="toolbar-disclosure">
        <button class="toolbar-action" id="view-export-toggle" type="button" aria-expanded="false" aria-controls="view-export-panel" aria-label="${escapeXml(msgs.uiViewAndExportTitle)}" title="${escapeXml(msgs.uiViewAndExportTitle)}"><span aria-hidden="true">▤</span> <span class="toolbar-action-label">${escapeXml(msgs.uiViewAndExport)}</span></button>
        <div class="toolbar-disclosure-panel" id="view-export-panel" role="group" aria-label="${escapeXml(msgs.uiViewAndExport)}" hidden>
          <div class="toolbar-panel-section">
            <span class="toolbar-panel-label">${escapeXml(msgs.uiView)}</span>
            <div class="segmented-control">
              <button class="tool-btn active" data-mode="single" aria-pressed="true" title="${escapeXml(msgs.uiSinglePageTitle)}">${escapeXml(msgs.uiSinglePage)}</button>
              <button class="tool-btn" data-mode="spread" aria-pressed="false" title="${escapeXml(msgs.uiSpreadTitle)}">${escapeXml(msgs.uiSpread)}</button>
              <button class="tool-btn" data-mode="web" aria-pressed="false" title="${escapeXml(msgs.uiWebTitle)}">${escapeXml(msgs.uiWeb)}</button>
            </div>
          </div>
          <div class="toolbar-panel-section">
            <label class="toolbar-panel-label" for="select-page-size">${escapeXml(msgs.uiPaper)}</label>
            <select id="select-page-size" class="tool-select" title="${escapeXml(msgs.uiPaperTitle)}">
              <option value="A4" selected>A4 (210×297mm)</option><option value="A3">A3 (297×420mm)</option>
              <option value="A5">A5 (148×210mm)</option><option value="B4">B4 (250×353mm)</option>
              <option value="B5">B5 (176×250mm)</option><option value="Letter">Letter (8.5×11")</option>
            </select>
            <span class="toolbar-panel-label">${escapeXml(msgs.uiOrientation)}</span>
            <div class="segmented-control">
              <button class="tool-btn active" id="orientation-portrait" data-orientation="portrait" aria-pressed="true" title="${escapeXml(msgs.uiPortraitTitle)}">${escapeXml(msgs.uiPortrait)}</button>
              <button class="tool-btn" id="orientation-landscape" data-orientation="landscape" aria-pressed="false" title="${escapeXml(msgs.uiLandscapeTitle)}">${escapeXml(msgs.uiLandscape)}</button>
            </div>
            <button class="toolbar-action btn-pdf" id="btn-save-pdf" type="button" title="${escapeXml(msgs.uiSavePdfTitle)}" aria-label="${escapeXml(msgs.uiSavePdfTitle)}">${escapeXml(msgs.uiSavePdf)}</button>
          </div>
        </div>
      </div>
      <button class="toolbar-action btn-help" id="btn-help" type="button" title="${escapeXml(msgs.uiHelpTitle)}" aria-label="${escapeXml(msgs.uiHelpTitle)}"><span aria-hidden="true">?</span><span class="toolbar-action-label"> ${escapeXml(msgs.uiHelp)}</span></button>
    </div>
  </div>

  <div class="score-settings-row" id="score-settings-row" role="group" aria-label="${escapeXml(msgs.uiScoreSettings)}">
    <div class="score-settings-primary">
      <label class="score-settings-capo" for="preview-capo-select"><span class="score-settings-label">${escapeXml(msgs.uiCapo)}</span><select id="preview-capo-select" class="score-settings-select" aria-label="${escapeXml(msgs.uiCapo)}" title="${escapeXml(msgs.uiCapoTitle)}"${capoSelectDisabled ? ' disabled' : ''}>${capoOptionsHtml}</select></label>
      <div class="score-settings-playability" id="preview-playability" data-level="${playabilityLevel}" role="status" aria-live="polite" aria-label="${escapeXml(currentPlayabilityControlLabel)}"><span class="score-settings-label">${escapeXml(msgs.uiPlayability)}</span><span>${escapeXml(currentPlayabilityLabel)}</span></div>
      <label class="score-settings-beginner" title="${escapeXml(msgs.uiBeginnerModeTitle)}"><input id="toggle-preview-beginner" type="checkbox"${beginnerUi.active ? ' checked' : ''}><span>${escapeXml(msgs.uiBeginnerShort)}</span><span>${beginnerUi.active ? escapeXml(msgs.uiBeginnerOn) : escapeXml(msgs.uiBeginnerOff)}</span></label>
    </div>
    <div class="score-settings-overflow">
      <button class="toolbar-action score-settings-overflow-toggle" id="temporary-score-settings-toggle" type="button" aria-expanded="false" aria-controls="temporary-score-settings-panel" aria-label="${escapeXml(msgs.uiMoreScoreSettings)}" title="${escapeXml(msgs.uiMoreScoreSettings)}">⋯ <span>${escapeXml(msgs.uiMoreScoreSettings)}</span></button>
      <div class="toolbar-disclosure-panel temporary-score-settings-panel" id="temporary-score-settings-panel" role="group" aria-label="${escapeXml(msgs.uiMoreScoreSettings)}" data-inline="false" hidden>
        <div class="toolbar-panel-section" data-settings-section="beginner">
          <label class="toolbar-panel-field" for="select-preview-barre-policy"><span>${escapeXml(msgs.uiBarreChords)}</span><select id="select-preview-barre-policy" class="score-settings-select" title="${escapeXml(msgs.uiBarreTitle)}"${beginnerUi.active ? '' : ' disabled'}><option value="forbid"${beginnerUi.barrePolicy === 'forbid' ? ' selected' : ''}>${escapeXml(msgs.uiBarreForbid)}</option><option value="allow"${beginnerUi.barrePolicy === 'allow' ? ' selected' : ''}>${escapeXml(msgs.uiBarreAllow)}</option></select></label>
          <label class="toolbar-panel-field" for="select-preview-beginner-capo-mode"><span>${escapeXml(msgs.uiBeginnerCapoMode)}</span><select id="select-preview-beginner-capo-mode" class="score-settings-select"${beginnerUi.active ? '' : ' disabled'}><option value="auto"${beginnerUi.autoCapo ? ' selected' : ''}>${escapeXml(msgs.uiBeginnerAuto)}</option><option value="fixed"${beginnerUi.autoCapo ? '' : ' selected'}>${escapeXml(msgs.uiBeginnerFixed)}</option></select></label>
        </div>
        ${beginnerUi.active && beginnerUi.substitutions.length ? `<div class="toolbar-panel-section"><span class="toolbar-panel-label">${escapeXml(msgs.uiBeginnerSubstitutions)}</span><ul class="settings-substitutions">${beginnerUi.substitutions.map(([source, target]) => `<li>${escapeXml(source)} → ${escapeXml(target)}</li>`).join('')}</ul></div>` : ''}
        ${capoUi?.warning ? `<div class="toolbar-panel-section"><p class="settings-warning" role="status">${escapeXml(capoUi.warning)}</p></div>` : ''}
        <div class="toolbar-panel-section"><button class="toolbar-action" id="open-score-settings-capo-from-preview" type="button" aria-label="${escapeXml(msgs.uiOpenScoreSettings)}" title="${escapeXml(msgs.uiOpenScoreSettings)}">↗ ${escapeXml(msgs.uiCapo)}</button><button class="toolbar-action" id="open-score-settings-beginner-from-preview" type="button" aria-label="${escapeXml(msgs.uiOpenBeginnerSettings)}" title="${escapeXml(msgs.uiOpenBeginnerSettings)}">↗ ${escapeXml(msgs.uiBeginnerShort)}</button></div>
      </div>
    </div>
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

  <div class="playback-error" id="playback-error" role="status" aria-live="polite" aria-atomic="true">${escapeXml(playback.error ?? '')}</div>

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
      const previewIdentity = ${previewIdentityJson};
      const restoreFocusControl = ${restoreFocusControlJson};
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
      const playbackOptionsToggle = document.getElementById('playback-options-toggle');
      const viewExportToggle = document.getElementById('view-export-toggle');
      const temporarySettingsToggle = document.getElementById('temporary-score-settings-toggle');
      const temporarySettingsPanel = document.getElementById('temporary-score-settings-panel');
      function syncScoreSettingsLayout() {
        if (!temporarySettingsToggle || !temporarySettingsPanel) return;
        const inline = window.innerWidth >= 840;
        const wasInline = temporarySettingsPanel.dataset.inline === 'true';
        temporarySettingsPanel.dataset.inline = String(inline);
        temporarySettingsToggle.hidden = inline;
        if (inline) {
          temporarySettingsPanel.hidden = false;
          temporarySettingsToggle.setAttribute('aria-expanded', 'false');
        } else if (wasInline) {
          temporarySettingsPanel.hidden = true;
          temporarySettingsToggle.setAttribute('aria-expanded', 'false');
        }
      }
      syncScoreSettingsLayout();
      const disclosureItems = [
        { button: playbackOptionsToggle, buttons: [playbackOptionsToggle], panel: document.getElementById('playback-options-panel') },
        { button: viewExportToggle, buttons: [viewExportToggle], panel: document.getElementById('view-export-panel') },
        { button: temporarySettingsToggle, buttons: [temporarySettingsToggle], panel: temporarySettingsPanel }
      ].filter(item => item.button && item.panel);
      const capoSelect = document.getElementById('preview-capo-select');
      const beginnerToggle = document.getElementById('toggle-preview-beginner');
      const barrePolicySelect = document.getElementById('select-preview-barre-policy');
      const beginnerCapoModeSelect = document.getElementById('select-preview-beginner-capo-mode');
      const openCapoSettingsButton = document.getElementById('open-score-settings-capo-from-preview');
      const openBeginnerSettingsButton = document.getElementById('open-score-settings-beginner-from-preview');
      function postTemporarySettings(action, value, focusControl) {
        if (vscode) vscode.postMessage({
          command: 'temporarySettingsChanged',
          action,
          value: { ...value, focusControl },
          ...previewIdentity
        });
      }
      if (capoSelect) capoSelect.addEventListener('change', () => postTemporarySettings('capoChanged', { capo: Number(capoSelect.value) }, 'preview-capo-select'));
      if (beginnerToggle) beginnerToggle.addEventListener('change', () => postTemporarySettings('beginnerToggled', { enabled: beginnerToggle.checked }, 'toggle-preview-beginner'));
      if (barrePolicySelect) barrePolicySelect.addEventListener('change', () => postTemporarySettings('barrePolicyChanged', { policy: barrePolicySelect.value }, 'select-preview-barre-policy'));
      if (beginnerCapoModeSelect) beginnerCapoModeSelect.addEventListener('change', () => postTemporarySettings('beginnerCapoModeChanged', {
        mode: beginnerCapoModeSelect.value,
        capo: capoSelect ? Number(capoSelect.value) : undefined
      }, 'select-preview-beginner-capo-mode'));
      if (vscode) {
        if (openCapoSettingsButton) openCapoSettingsButton.addEventListener('click', () => vscode.postMessage({
          command: 'openScoreSettingsFromPreview', section: 'capo', ...previewIdentity
        }));
        if (openBeginnerSettingsButton) openBeginnerSettingsButton.addEventListener('click', () => vscode.postMessage({
          command: 'openScoreSettingsFromPreview', section: 'beginner', ...previewIdentity
        }));
      }
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
      let playbackAvailable = playbackData.available === true;
      let playbackDuration = Math.max(0, Number(playbackData.durationSeconds) || 0);
      let playbackEvents = Array.isArray(playbackData.events) ? playbackData.events : [];
      let rhythmTieRestartEvents = Array.isArray(playbackData.rhythmTieRestartEvents) ? playbackData.rhythmTieRestartEvents : [];
      let playbackOccurrences = Array.isArray(playbackData.occurrences) ? playbackData.occurrences : [];
      const playBtn = document.getElementById('btn-play');
      const playLabelNode = document.getElementById('play-label');
      const pauseBtn = document.getElementById('btn-pause');
      const stopBtn = document.getElementById('btn-stop');
      const seekSlider = document.getElementById('playback-seek');
      const playbackTime = document.getElementById('playback-time');
      const playbackError = document.getElementById('playback-error');
      let audioLabels = playbackData.labels || {};
      let progressionAudioLeaseId = typeof playbackData.progressionAudioLeaseId === 'string'
        ? playbackData.progressionAudioLeaseId : '';
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
      let abStartPoint = null;
      let abEndPoint = null;
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
        const requestedTarget = Math.max(0, currentScroll + (rect.top + rect.bottom) / 2 - viewportHeight / 2);
        const scrollRoot = document.scrollingElement || document.documentElement || document.body;
        const scrollHeight = Number(scrollRoot && scrollRoot.scrollHeight);
        const maxScroll = Math.max(0, (Number.isFinite(scrollHeight) ? scrollHeight : 0) - viewportHeight);
        const target = Math.min(maxScroll, requestedTarget);
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
          practiceToggle.disabled = !playbackAvailable || disposed || !!progressionAudioLeaseId;
        }
        if (practiceSpeedSelect) {
          practiceSpeedSelect.value = String(practiceSpeed);
          practiceSpeedSelect.disabled = !playbackAvailable || disposed || !practiceEnabled || !!progressionAudioLeaseId;
        }
        if (practiceLoopSelect) {
          practiceLoopSelect.value = loopMode;
          practiceLoopSelect.disabled = !playbackAvailable || disposed || !practiceEnabled || !!progressionAudioLeaseId;
        }
        for (const button of [practiceSetAButton, practiceSetBButton, practiceClearButton, practiceFollowButton]) {
          if (button) button.disabled = !playbackAvailable || disposed || !practiceEnabled || !!progressionAudioLeaseId;
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
          if (playLabelNode) playLabelNode.textContent = playLabel || 'Play';
          playBtn.setAttribute('aria-label', playLabel || 'Play');
          playBtn.title = playLabel || 'Play';
          playBtn.disabled = !playbackAvailable || startPending || disposed || !!progressionAudioLeaseId || transport === 'playing' || transport === 'counting-in';
        }
        if (pauseBtn) pauseBtn.disabled = disposed || !!progressionAudioLeaseId || (transport !== 'playing' && transport !== 'counting-in');
        if (stopBtn) stopBtn.disabled = disposed || transport === 'stopped';
        updatePracticeUi();
        updateScoreOverlay();
      }

      function activatePlaybackData(data) {
        playbackData = data && typeof data === 'object' ? data : {};
        playbackAvailable = playbackData.available === true;
        playbackDuration = Math.max(0, Number(playbackData.durationSeconds) || 0);
        playbackEvents = Array.isArray(playbackData.events) ? playbackData.events : [];
        playbackOccurrences = Array.isArray(playbackData.occurrences) ? playbackData.occurrences : [];
        audioLabels = playbackData.labels || {};
        loopMode = 'off';
        loopRange = null;
        abStartPoint = null;
        abEndPoint = null;
        positionSeconds = 0;
        scoreAnchorSeconds = 0;
        transport = 'stopped';
        overlayVisible = false;
        if (seekSlider) {
          seekSlider.max = String(playbackDuration);
          seekSlider.value = '0';
          seekSlider.disabled = !playbackAvailable;
        }
        if (playBtn) playBtn.disabled = !playbackAvailable;
        updatePlaybackUi();
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
        // A practice loop jumps to its start instead of carrying sound from before the range.
        // Re-attack a tie continuation exactly at that boundary, then keep its remaining chain.
        if (loopRange && Math.abs(scoreStart - loopRange.startSeconds) < 0.000001) {
          for (const event of rhythmTieRestartEvents) {
            if (Math.abs(event.timeSeconds - scoreStart) >= 0.000001) continue;
            if (event.kind !== 'rhythmAttack') continue;
            if (audioStart >= audioContext.currentTime - 0.005) schedulePlaybackEvent(audioContext, event, audioStart, speed);
          }
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
          if (!ctx || progressionAudioLeaseId) return;
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
        if (progressionAudioLeaseId || transport === 'playing' || transport === 'counting-in' || startPending || disposed) return;
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

      function commitLoopState(mode, range, notice) {
        const current = currentScorePosition();
        const wasPlaying = transport === 'playing' || transport === 'counting-in';
        let target = current;
        if (range && (current < range.startSeconds || current >= range.endSeconds)) target = range.startSeconds;
        loopMode = mode;
        loopRange = range;
        if (mode !== 'ab') {
          abStartPoint = null;
          abEndPoint = null;
        }
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
          commitLoopState('off', null, audioLabels.practiceLoopCleared);
          return;
        }
        if (mode === 'ab') {
          const range = loopRangeFromPoints(abStartPoint, abEndPoint);
          commitLoopState('ab', range, range ? audioLabels.practiceLoopSet : '');
          if (!range) announcePractice(audioLabels.practiceARequired);
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
        if (range) commitLoopState(mode, range, audioLabels.practiceLoopSet);
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
        abStartPoint = startPoint;
        abEndPoint = null;
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
        if (!abStartPoint) {
          announcePractice(audioLabels.practiceARequired);
          return;
        }
        const endPoint = pointAtScoreTime(currentScorePosition());
        if (!endPoint || endPoint.scoreSeconds <= abStartPoint.scoreSeconds) {
          announcePractice(audioLabels.practiceInvalidEnd);
          return;
        }
        const range = loopRangeFromPoints(abStartPoint, endPoint);
        if (!range) {
          announcePractice(audioLabels.practiceInvalidEnd);
          return;
        }
        abEndPoint = endPoint;
        commitLoopState('ab', range, audioLabels.practiceLoopSet);
      }

      function clearPracticeLoop() {
        if (!practiceEnabled || disposed) {
          announcePractice(audioLabels.practiceEnableFirst);
          return;
        }
        commitLoopState('off', null, audioLabels.practiceLoopCleared);
      }

      function announcePractice(message) {
        setPlaybackError(message || '');
        setPracticeNotice(message || '');
      }

      function togglePractice() {
        if (disposed || progressionAudioLeaseId) return;
        if (!playbackAvailable) {
          announcePractice(audioLabels.practiceUnavailable || audioLabels.audioUnavailable);
          return;
        }
        const wasPlaying = transport === 'playing' || transport === 'counting-in';
        const current = currentScorePosition();
        const practiceRow = document.getElementById('practice-toolbar');
        const activeElement = document.activeElement;
        if (practiceEnabled && activeElement && practiceRow?.contains(activeElement)) {
          practiceToggle?.focus();
        }
        practiceEnabled = !practiceEnabled;
        if (!practiceEnabled) {
          loopMode = 'off';
          abStartPoint = null;
          abEndPoint = null;
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
        if (progressionAudioLeaseId && action !== 'stop') return;
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
        if (message && message.command === 'progressionAudioLock' && typeof message.leaseId === 'string') {
          if (progressionAudioLeaseId && progressionAudioLeaseId !== message.leaseId) return;
          progressionAudioLeaseId = message.leaseId;
          body.dataset.progressionAudioLocked = 'true';
          updatePlaybackUi();
          stopPlayback();
          if (vscode) vscode.postMessage({ command: 'progressionAudioPreviewStopped', leaseId: progressionAudioLeaseId });
          return;
        }
        if (message && message.command === 'progressionAudioUnlock' && message.leaseId === progressionAudioLeaseId) {
          progressionAudioLeaseId = '';
          body.dataset.progressionAudioLocked = 'false';
          updatePlaybackUi();
          return;
        }
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
          const focusControl = orientation !== currentOrientation
            ? (orientation === 'landscape' ? 'orientation-landscape' : 'orientation-portrait')
            : 'select-page-size';
          vscode.postMessage({
            command: 'layoutChanged', pageSize, orientation, focusControl,
            documentUri: previewIdentity.documentUri,
            documentVersion: previewIdentity.documentVersion,
            previewGeneration: previewIdentity.previewGeneration
          });
        }
      }

      function positionDisclosure(item) {
        if (!item || !item.button || !item.panel || item.panel.hidden || item.panel.dataset.inline === 'true') return;
        if (item.button.getClientRects().length === 0) {
          item.button = item.buttons.find(button => button && button.getClientRects().length > 0) || item.button;
          item.buttons.forEach(button => button.setAttribute('aria-expanded', String(button === item.button)));
        }
        const trigger = item.button.getBoundingClientRect();
        const width = Math.min(360, Math.max(0, window.innerWidth - 16));
        const panelHeight = Math.min(item.panel.scrollHeight, Math.max(0, window.innerHeight - 64));
        item.panel.style.width = width + 'px';
        item.panel.style.left = Math.max(8, Math.min(window.innerWidth - width - 8, trigger.right - width)) + 'px';
        item.panel.style.top = Math.max(56, Math.min(trigger.bottom + 4, window.innerHeight - panelHeight - 8)) + 'px';
      }

      function closeDisclosure(item, returnFocus) {
        if (!item || !item.panel || item.panel.hidden || item.panel.dataset.inline === 'true') return;
        item.panel.hidden = true;
        item.buttons.forEach(button => {
          button.setAttribute('aria-expanded', 'false');
          button.setAttribute('aria-controls', item.panel.id);
        });
        if (returnFocus) item.button.focus();
      }

      disclosureItems.forEach(item => {
        const handleDisclosureKeydown = (event, button) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            if (button) item.button = button;
            closeDisclosure(item, true);
          } else if (event.key === 'Tab' && !event.shiftKey && button?.hasAttribute('data-settings-focus-target') && !item.panel.hidden) {
            const target = document.getElementById(button.getAttribute('data-settings-focus-target'));
            if (target) {
              event.preventDefault();
              target.focus();
            }
          }
        };
        item.buttons.forEach(button => {
          button.addEventListener('click', () => {
            const alreadyActive = !item.panel.hidden && item.button === button;
            disclosureItems.forEach(other => { if (other !== item) closeDisclosure(other, false); });
            if (alreadyActive) {
              closeDisclosure(item, false);
              return;
            }
            item.panel.hidden = false;
            item.button = button;
            item.buttons.forEach(trigger => {
              trigger.setAttribute('aria-expanded', String(trigger === button));
              trigger.setAttribute('aria-controls', item.panel.id);
            });
            positionDisclosure(item);
          });
          button.addEventListener('keydown', event => handleDisclosureKeydown(event, button));
        });
        item.panel.addEventListener('keydown', event => handleDisclosureKeydown(event));
      });
      document.addEventListener('pointerdown', event => {
        disclosureItems.forEach(item => {
          if (!item.panel.hidden && !item.buttons.some(button => button.contains(event.target)) && !item.panel.contains(event.target)) {
            closeDisclosure(item, false);
          }
        });
      });
      document.addEventListener('focusin', event => {
        disclosureItems.forEach(item => {
          if (!item.panel.hidden && !item.buttons.some(button => button.contains(event.target)) && !item.panel.contains(event.target)) {
            closeDisclosure(item, false);
          }
        });
      });
      const toolbarActions = document.getElementById('toolbar-actions');
      if (toolbarActions) toolbarActions.addEventListener('focusin', event => {
        if (event.target && typeof event.target.scrollIntoView === 'function') {
          event.target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        }
      });
      window.addEventListener('resize', () => {
        syncScoreSettingsLayout();
        disclosureItems.forEach(item => {
          if (!item.panel.hidden) positionDisclosure(item);
        });
      });

      function updateView() {
        body.setAttribute('data-display-mode', currentMode);
        updateScoreOverlay();
        modeButtons.forEach(btn => {
          const active = btn.getAttribute('data-mode') === currentMode;
          btn.classList.toggle('active', active);
          btn.setAttribute('aria-pressed', String(active));
        });
        orientationButtons.forEach(btn => {
          const active = btn.getAttribute('data-orientation') === currentOrientation;
          btn.classList.toggle('active', active);
          btn.setAttribute('aria-pressed', String(active));
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

      function restoreLayoutFocus() {
        if (!restoreFocusControl) return;
        const target = document.getElementById(restoreFocusControl);
        const scoreSettingsTarget = target?.closest('#score-settings-row');
        const item = disclosureItems.find(entry => target && entry.panel.contains(target))
          || (!scoreSettingsTarget && disclosureItems.find(entry => entry.button === viewExportToggle));
        if (item && item.panel.dataset.inline !== 'true') {
          disclosureItems.forEach(other => closeDisclosure(other, false));
          item.panel.hidden = false;
          if (item.button.getClientRects().length === 0) {
            item.button = item.buttons.find(button => button && button.getClientRects().length > 0) || item.button;
          }
          item.buttons.forEach(button => button.setAttribute('aria-expanded', String(button === item.button)));
          positionDisclosure(item);
        }
        (target || item && item.button || viewExportToggle).focus();
        if (target && typeof target.scrollIntoView === 'function') target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
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

      // Clicking a chord diagram opens the chord diagram editor.
      document.addEventListener('click', (e) => {
        const diagram = e.target.closest && e.target.closest('.chord-diagram');
        if (diagram && vscode) {
          vscode.postMessage({ command: 'editChord', key: diagram.getAttribute('data-chord-key') });
        }
      });

      updateView();
      restoreLayoutFocus();
      body.dataset.progressionAudioLocked = String(!!progressionAudioLeaseId);
      if (progressionAudioLeaseId && vscode) {
        stopPlayback();
        vscode.postMessage({ command: 'progressionAudioPreviewStopped', leaseId: progressionAudioLeaseId });
      }
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
    ...(timeline.rhythmTieRestartEvents ? {
      rhythmTieRestartEvents: timeline.rhythmTieRestartEvents.map(event => ({ ...event, midiNotes: playbackEventMidiNotes(event, effectiveCapo) }))
    } : {}),
    occurrences,
    countInDurationSeconds,
    countInClicks,
    labels
  };
}

/** Builds a normalized, renderer-ready event payload for one explicit Inspector audition. */
export function buildProgressionAuditionPlaybackData(
  dslContent: string,
  options: {
    startMeasure: number;
    bars: number;
    mode: ProgressionAuditionMode;
    locale?: string;
    expandPageBreakRepeats?: boolean;
  }
): ProgressionAuditionPlaybackResult {
  const msgs = getMessages(resolveLocale(options.locale));
  const score = parseGuitarDsl(dslContent, { expandPageBreakRepeats: options.expandPageBreakRepeats });
  const playback = buildPlaybackHtmlData(score, msgs);
  if (!playback.available) {
    return { ok: false, code: 'audioUnavailable', message: msgs.uiProgressionAudioUnavailable || playback.error || '' };
  }

  let durationSeconds = playback.durationSeconds;
  let events = playback.events;
  if (options.mode === 'chord') {
    const occurrence = playback.occurrences.find(item => item.measureIndex === options.startMeasure);
    const availableAttacks = [...playback.events, ...(playback.rhythmTieRestartEvents ?? [])];
    const attack = occurrence && availableAttacks
      .filter(event => event.occurrenceIndex === occurrence.occurrenceIndex
        && event.kind === 'rhythmAttack' && event.midiNotes.length > 0)
      .sort((left, right) => left.timeSeconds - right.timeSeconds)[0];
    if (!attack) return { ok: false, code: 'fullSongOnly', message: msgs.uiProgressionFullSongOnly };
    durationSeconds = Math.max(0.05, Number(attack.durationSeconds) || 0.5);
    events = [{ ...attack, timeSeconds: 0, durationSeconds }];
  } else if (options.mode !== 'song') {
    const targetOccurrences = playback.occurrences.map((item, index) => ({ item, index }))
      .filter(({ item }) => item.measureIndex >= options.startMeasure && item.measureIndex < options.startMeasure + options.bars);
    const contiguous = targetOccurrences.length === options.bars
      && targetOccurrences.every(({ item, index }, offset) => item.measureIndex === options.startMeasure + offset
        && (offset === 0 || index === targetOccurrences[offset - 1].index + 1));
    if (!contiguous) return { ok: false, code: 'fullSongOnly', message: msgs.uiProgressionFullSongOnly };

    const first = targetOccurrences[0].item;
    const last = targetOccurrences[targetOccurrences.length - 1].item;
    const startSeconds = first.startSeconds;
    const endSeconds = last.startSeconds + last.durationSeconds;
    const occurrenceIds = new Set(targetOccurrences.map(({ item }) => item.occurrenceIndex));
    events = playback.events.filter(event => occurrenceIds.has(event.occurrenceIndex)
      && event.timeSeconds >= startSeconds && event.timeSeconds < endSeconds
      && (options.mode !== 'bars' || !(event.kind === 'pitched' && event.source === 'melody')))
      .map(event => ({
        ...event,
        timeSeconds: event.timeSeconds - startSeconds,
        durationSeconds: Math.min(event.durationSeconds, Math.max(0, endSeconds - event.timeSeconds))
      }));
    const firstOccurrence = first.occurrenceIndex;
    const startRestarts = (playback.rhythmTieRestartEvents ?? [])
      .filter(event => event.occurrenceIndex === firstOccurrence && Math.abs(event.timeSeconds - startSeconds) < 0.000001)
      .filter(restart => !events.some(event => event.kind === 'rhythmAttack'
        && event.occurrenceIndex === restart.occurrenceIndex && Math.abs(event.timeSeconds) < 0.000001))
      .map(event => ({
        ...event,
        timeSeconds: 0,
        durationSeconds: Math.min(event.durationSeconds, endSeconds - startSeconds)
      }));
    events.push(...startRestarts);
    events.sort((left, right) => left.timeSeconds - right.timeSeconds);
    durationSeconds = endSeconds - startSeconds;
  }

  const auditionEvents = events.filter(event => (event.kind === 'pitched' || event.kind === 'rhythmAttack')
    && event.midiNotes.length > 0)
    .map(event => ({
      kind: event.kind as 'pitched' | 'rhythmAttack',
      ...(event.kind === 'pitched' ? { source: event.source } : {}),
      timeSeconds: event.timeSeconds,
      durationSeconds: event.durationSeconds,
      midiNotes: event.midiNotes
    }));
  if (auditionEvents.length === 0) {
    return { ok: false, code: 'audioUnavailable', message: msgs.uiProgressionAudioUnavailable };
  }
  return {
    ok: true,
    data: {
      durationSeconds,
      events: auditionEvents
    }
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
