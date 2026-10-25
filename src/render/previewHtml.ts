import type { BeginnerPreviewUiModel } from '../beginnerMode';
import type { CapoPreviewUiModel } from '../capo';
import { expandMeasureRepeat, parseGuitarDsl } from '../compiler';
import type { MeasureData, ParsedScore } from '../compiler';
import { fadd, fcmp, fnum, formatNoteValuePart, frac, parseRhythmDuration } from '../duration';
import { chordKey, resolveBaseFret } from '../chordDefinition';
import { resolveChordVoicing } from '../chordVoicingResolver';
import { createInstrumentModel, MAX_CAPO } from '../instrumentModel';
import { automaticPracticeGuideGrid, practiceGuideContinuationOffsets, practiceGuideHasWrittenRhythm, practiceGuideRestGlyph, practiceGuideRhythmLabel, practiceGuideTabEvents, practiceGuideValueContinuationOffsets, projectPracticeGuidePage } from '../practiceGuide';
import type { PracticeGuideGrid } from '../practiceGuide';
import { resolveLocale, getMessages } from '../i18n';
import type { Messages } from '../i18n';
import { pitchToMidi, playbackEventMidiNotes } from '../playbackSynth';
import { buildPlaybackTimeline } from '../playbackTimeline';
import type { PlaybackEvent } from '../playbackTimeline';
import { beamGroupStarts, measureBeats } from '../scoreEvents';
import { PageOrientation, PageSize, getSheetSize } from './layout';
import { FONT_FAMILY_SANS, SCORE_FONT_FAMILY, escapeXml, renderContinuousSvg, renderScoreSheets } from './svg';
import { practiceGuideStrokeVisualWidth, renderPracticeGuideStrokeSvg, renderPracticeGuideWaveSvg } from './practiceGuideStrokeSvg';
import type { PracticeGuideStrokeSpec } from './practiceGuideStrokeSvg';
import type { VisualSourceBinding } from '../compiler';

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
  /** Explicit Preview edit mode; false retains the existing toolbar and layout. */
  previewEditMode?: boolean;
  /** Source identity must be literal TextDocument text for editable Preview bindings. */
  previewEditAvailable?: boolean;
  /** Parser-owned authored token bindings, never inferred from SVG coordinates. */
  visualBindings?: readonly VisualSourceBinding[];
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
  lyricVerse?: number;
  startBeat: ReturnType<typeof frac>;
  durationBeats: ReturnType<typeof frac>;
  startSeconds: number;
  durationSeconds: number;
  tempoBpm: number;
  countInDurationSeconds: number;
  countInClicks: { timeSeconds: number; accent: boolean }[];
}

interface PlaybackHtmlData {
  available: boolean;
  durationSeconds: number;
  events: PlaybackHtmlEvent[];
  rhythmTieRestartEvents?: PlaybackHtmlEvent[];
  occurrences: PlaybackHtmlOccurrence[];
  practiceGuide: PracticeGuideData;
  countInDurationSeconds: number;
  countInClicks: { timeSeconds: number; accent: boolean }[];
  labels: Record<string, string>;
  error?: string;
  progressionAudioLeaseId?: string;
}

interface PracticeGuideDiagram {
  name: string;
  label?: string;
  svg?: string;
  beat: number;
}

interface PracticeGuideItem {
  at: ReturnType<typeof frac>;
  durationBeats: ReturnType<typeof frac>;
  eventStart: ReturnType<typeof frac>;
  eventEnd: ReturnType<typeof frac>;
  label: string;
  duration: string;
  kind?: 'attack' | 'continuation' | 'mute' | 'rest';
  grid?: PracticeGuideGrid;
  eventIndex?: number;
  restBase?: number;
  stroke?: PracticeGuideStrokeSpec;
  durationWaveEligible: boolean;
}

interface PracticeGuideMelodyNote {
  at: ReturnType<typeof frac>;
  durationBeats: ReturnType<typeof frac>;
  duration: string;
  label: string;
  pitches: { label: string; midi: number }[];
  isRest: boolean;
  eventIndex: number;
  restBase?: number;
}

interface PracticeGuideLyric {
  at: ReturnType<typeof frac>;
  durationBeats: ReturnType<typeof frac>;
  text: string;
  verse: number;
  eventIndex: number;
  hyphenToNext: boolean;
}

interface PracticeGuideMeasure {
  number: number;
  startBeat: ReturnType<typeof frac>;
  beats: ReturnType<typeof frac>;
  chords: PracticeGuideDiagram[];
  melody: PracticeGuideMelodyNote[];
  lyrics: PracticeGuideLyric[];
  techniques: PracticeGuideItem[];
}

interface PracticeGuideData {
  automaticGrid: 4 | 8 | 16;
  automaticFill: boolean;
  totalBeats: ReturnType<typeof frac>;
  lyricsHeight: number;
  pitchMinMidi: number;
  pitchMaxMidi: number;
  measures: PracticeGuideMeasure[];
  initialNextChord?: PracticeGuideDiagram;
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
  const hasPreviewDetails = Boolean((beginnerUi.active && beginnerUi.substitutions.length > 0) || capoUi?.warning);
  const previewDetailsIndicator = capoUi?.warning ? '⚠' : 'ⓘ';
  const capoCandidates: CapoPreviewUiModel['candidates'] = capoUi?.candidates.length === 13
    ? capoUi.candidates
    : Array.from({ length: 13 }, (_, capo) => ({ capo, supported: false, recommended: false }));
  const selectedCapo = capoUi?.sourceCapo === null || capoUi?.sourceCapo === undefined ? '' : String(capoUi.targetCapo);
  const capoOptionsHtml = [
    `<option value="" disabled${selectedCapo === '' ? ' selected' : ''} data-closed-label="${escapeXml(msgs.uiPlayabilityUnavailable)}" data-open-label="${escapeXml(msgs.uiPlayabilityUnavailable)}">${escapeXml(msgs.uiPlayabilityUnavailable)}</option>`,
    ...capoCandidates.map(candidate => {
      const closedLabel = String(candidate.capo);
      const openLabel = candidate.score !== undefined && candidate.level !== undefined
        ? `${candidate.capo} · ${candidate.score}/100 · ${msgs.playabilityLevels[candidate.level]}${candidate.recommended ? ` · ★ ${msgs.uiRecommended}` : ''}`
        : `${candidate.capo} · ${msgs.uiPlayabilityUnavailable}`;
      return `<option value="${candidate.capo}"${candidate.capo === Number(selectedCapo) && selectedCapo !== '' ? ' selected' : ''}${candidate.supported ? '' : ' disabled'} data-closed-label="${escapeXml(closedLabel)}" data-open-label="${escapeXml(openLabel)}">${escapeXml(closedLabel)}</option>`;
    })
  ].join('');
  const currentPlayabilityValueHtml = capoUi?.currentPlayability
    ? `<span class="score-settings-playability-value"><span>${capoUi.currentPlayability.score}/100</span><span class="score-settings-playability-separator"> · </span><span>${escapeXml(msgs.playabilityLevels[capoUi.currentPlayability.level])}</span></span>`
    : `<span class="score-settings-playability-value">${escapeXml(msgs.uiPlayabilityUnavailable)}</span>`;
  const currentPlayabilityControlLabel = capoUi?.currentPlayability
    ? `${msgs.uiPlayability} ${msgs.playabilityLevels[capoUi.currentPlayability.level]} ${capoUi.currentPlayability.score}/100`
    : `${msgs.uiPlayability} ${msgs.uiPlayabilityUnavailable}`;
  const playabilityLevel = capoUi?.currentPlayability?.level ?? 'unavailable';
  const capoSelectDisabled = capoUi?.sourceCapo === null || capoUi?.sourceCapo === undefined
    || (beginnerUi.active && beginnerUi.autoCapo);
  const score = parseGuitarDsl(dslContent, {
    expandPageBreakRepeats: options?.expandPageBreakRepeats
  });
  const previewEditAvailable = options?.previewEditAvailable === true;
  const previewEditMode = options?.previewEditMode === true;
  const visualBindings = previewEditAvailable ? (options?.visualBindings ?? []) : [];
  const visualBindingsJson = escapeJsonForHtml(JSON.stringify(visualBindings.map(binding => ({
    id: binding.id, kind: binding.kind, line: binding.line, startCol: binding.startCol,
    endCol: binding.endCol, expected: binding.expected
  }))));
  const visualBindingOptions = visualBindings.map(binding =>
    `<option value="${escapeXml(binding.id)}">L${binding.line + 1}:${binding.startCol + 1} · ${escapeXml(binding.kind)} · ${escapeXml(binding.expected)}</option>`
  ).join('');
  const playback = buildPlaybackHtmlData(score, msgs);
  if (options?.progressionAudioLeaseId) playback.progressionAudioLeaseId = options.progressionAudioLeaseId;
  const playbackJson = escapeJsonForHtml(JSON.stringify(playback));
  const nonceAttribute = options?.nonce ? ` nonce="${escapeXml(options.nonce)}"` : '';
  const cspMeta = options?.cspSource && options.nonce
    ? renderCspMeta(options.cspSource, options.nonce)
    : '';

  const sheets = renderScoreSheets(score, pageSize, orientation, previewEditMode && previewEditAvailable);
  const spreadGroups: string[] = [];
  for (let i = 0; i < sheets.length; i += 2) {
    spreadGroups.push(`<div class="spread-sheet">${sheets.slice(i, i + 2).join('\n')}</div>`);
  }
  const continuousSvg = renderContinuousSvg(score, pageSize, previewEditMode && previewEditAvailable);

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
  .score-settings-playability-value {
    box-sizing: border-box;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    column-gap: 0;
    min-height: 29px;
    padding: 2px 10px;
    border: 1px solid transparent;
    border-radius: 999px;
    color: #fff;
    font-size: 11px;
    font-weight: 600;
    line-height: 1.2;
  }
  .score-settings-playability[data-level="veryEasy"] .score-settings-playability-value,
  .score-settings-playability[data-level="easy"] .score-settings-playability-value { background-color: #2e7d32; border-color: #459e4b; }
  .score-settings-playability[data-level="moderate"] .score-settings-playability-value { background-color: #8d6e00; border-color: #b09200; }
  .score-settings-playability[data-level="hard"] .score-settings-playability-value,
  .score-settings-playability[data-level="veryHard"] .score-settings-playability-value { background-color: #b71c1c; border-color: #d95c5c; }
  .score-settings-playability[data-level="unavailable"] .score-settings-playability-value {
    min-height: 0;
    padding: 0;
    color: var(--vscode-descriptionForeground, #cccccc);
    font-weight: 400;
  }
  .score-settings-beginner { cursor: pointer; font-size: 11px; }
  .score-settings-beginner input { margin: 0; }
  .score-settings-overflow { flex: 1 1 auto; min-width: 0; display: flex; align-items: center; gap: 8px; }
  .score-settings-overflow-toggle { display: none; }
  .score-settings-row .score-settings-details-toggle { width: 28px; min-width: 28px; justify-content: center; padding-left: 0; padding-right: 0; }
  .score-settings-details-toggle[hidden],
  .score-settings-details-close[hidden] { display: none !important; }
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
  .score-settings-row .temporary-score-settings-panel[data-inline="true"]:not([data-details-open="true"]) .toolbar-panel-section:has(.settings-substitutions),
  .score-settings-row .temporary-score-settings-panel[data-inline="true"]:not([data-details-open="true"]) .toolbar-panel-section:has(.settings-warning) { display: none; }
  .score-settings-row .temporary-score-settings-panel[data-inline="true"][data-details-open="true"] {
    position: fixed;
    z-index: 1200;
    display: block;
    align-items: stretch;
    gap: 0;
    width: min(360px, calc(100vw - 16px));
    max-width: none;
    max-height: calc(100vh - 64px);
    overflow: auto;
    padding: 10px;
    border: 1px solid var(--vscode-widget-border, #555);
    border-radius: 6px;
    background: var(--vscode-editorWidget-background, #252526);
    box-shadow: 0 6px 18px rgba(0, 0, 0, 0.35);
  }
  .score-settings-row .temporary-score-settings-panel[data-inline="true"][data-details-open="true"] .toolbar-panel-section:not(:has(.settings-substitutions, .settings-warning)) { display: none; }
  .score-settings-row .temporary-score-settings-panel[data-inline="true"][data-details-open="true"] .toolbar-panel-section:has(.settings-substitutions),
  .score-settings-row .temporary-score-settings-panel[data-inline="true"][data-details-open="true"] .toolbar-panel-section:has(.settings-warning) {
    align-items: flex-start;
    gap: 8px;
    margin: 10px 0 0;
    padding: 10px 0 0;
    border-top: 1px solid var(--vscode-widget-border, #555);
    flex-wrap: wrap;
  }
  .score-settings-row .temporary-score-settings-panel[data-inline="true"][data-details-open="true"] .toolbar-panel-section:has(.settings-substitutions) { margin-top: 0; padding-top: 0; border-top: 0; }
  .score-settings-row .temporary-score-settings-panel[data-inline="true"][data-details-open="true"] .toolbar-panel-label { display: block; }
  .score-settings-row .temporary-score-settings-panel[data-inline="true"][data-details-open="true"] .score-settings-details-close { display: inline-flex; }
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
  .practice-guide-panel {
    --guide-panel-background: #ffffff;
    --guide-light-surface: #ffffff;
    --guide-melody-surface: #173149;
    --guide-lyrics-surface: #1b344d;
    --guide-ink: #21354b;
    --guide-muted: #66829c;
    --guide-border: #d2dde9;
    --guide-accent: #087fac;
    --guide-playhead: #00a1d7;
    position: fixed;
    box-sizing: border-box;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 997;
    display: none;
    flex-direction: column;
    height: auto;
    min-height: 0;
    max-height: calc(100vh - 312px);
    background: var(--guide-panel-background);
    color: var(--guide-ink);
    border-top: 1px solid var(--guide-border);
    box-shadow: 0 -4px 18px rgba(33, 53, 75, 0.14);
  }
  @media (max-height: 699px) {
    .practice-guide-panel { max-height: max(42px, calc(100vh - 152px - max(80px, 20vh))); }
  }
  body.has-practice-guide { padding-bottom: var(--practice-guide-panel-height, 0px) !important; }
  body.has-practice-guide .practice-guide-panel { display: flex; }
  body.guide-collapsed .practice-guide-panel { height: 42px; min-height: 42px; max-height: 42px; }
  body.guide-collapsed .practice-guide-layout { display: none; }
  body.guide-collapsed .practice-guide-compact { display: none; }
  body.guide-collapsed .practice-guide-header {
    box-sizing: border-box;
    height: 42px;
    min-height: 42px;
    max-height: 42px;
    flex-wrap: nowrap;
    padding: 0 8px;
    border-bottom: 0;
  }
  body.guide-collapsed .practice-guide-auto-fill,
  body.guide-collapsed .practice-guide-controls { display: none; }
  body.guide-melody-hidden .practice-guide-melody { display: none; }
  body.guide-melody-hidden .practice-guide-compact-melody { display: none; }
  body.guide-melody-hidden .practice-guide-label[data-guide-lane="melody"] { display: none; }
  body.guide-diagrams-hidden .practice-guide-diagrams { display: none; }
  body.guide-diagrams-hidden .practice-guide-label[data-guide-lane="diagrams"] { display: none; }
  body.guide-diagrams-hidden .practice-guide-next-chord-diagram { display: none; }
  body.guide-diagrams-hidden .practice-guide-compact-diagrams { display: none; }
  body.guide-compact-mode .practice-guide-scroll { display: none; }
  body.guide-compact-mode .practice-guide-compact { display: block; }
  .practice-guide-header {
    box-sizing: border-box;
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 9px;
    flex: 0 0 auto;
    min-height: 42px;
    min-width: 0;
    padding: 6px 12px;
    border-bottom: 1px solid #3a516b;
    background: #243953;
    color: #ffffff;
    white-space: normal;
  }
  .practice-guide-header > strong { flex: 0 0 auto; font-size: 14px; }
  .practice-guide-collapse {
    flex: 0 0 28px;
    width: 28px;
    height: 28px;
    border: 0;
    border-radius: 4px;
    background: transparent;
    color: inherit;
    cursor: pointer;
    font: inherit;
    font-size: 20px;
  }
  .practice-guide-auto-fill {
    flex: 0 0 auto;
    color: #bccde0;
    font-size: 11px;
  }
  .practice-guide-controls { display: flex; align-items: center; gap: 6px; margin-left: auto; flex-wrap: wrap; color: #e6edf9; }
  .practice-guide-controls label { display: inline-flex; align-items: center; gap: 5px; font-size: 11px; }
  .practice-guide-controls .practice-button { padding: 3px 7px; }
  .practice-guide-controls .practice-select { border-color: #cbd7e3; background: #ffffff; color: #21354b; }
  .practice-guide-controls .practice-button { border-color: #657f98; background: #344d68; color: #ffffff; }
  .practice-guide-controls .practice-button:hover:not(:disabled) { background: #3b5c78; }
  .practice-guide-controls .practice-button[aria-pressed="true"] { border-color: #087fac; background: #087fac; color: #ffffff; }
  .practice-guide-controls .practice-button:focus-visible, .practice-guide-controls .practice-select:focus-visible { outline-color: #50c8ff; }
  .practice-guide-compact-page-control { width: 28px; min-width: 28px; padding: 2px 4px !important; }
  .practice-guide-compact-range { min-width: 42px; color: #e6edf9; font-size: 11px; text-align: center; white-space: nowrap; }
  body:not(.guide-compact-mode) .practice-guide-compact-page-control,
  body:not(.guide-compact-mode) .practice-guide-compact-range { display: none; }
  @media (max-width: 900px) {
    .practice-guide-controls { flex: 1 1 100%; justify-content: flex-start; margin-left: 28px; }
  }
  .practice-guide-layout { display: grid; grid-template-columns: 76px minmax(0, 1fr) 112px; flex: 0 1 auto; min-width: 0; min-height: 0; overflow-x: hidden; overflow-y: auto; align-content: start; background: var(--guide-panel-background); }
  .practice-guide-label-rail-shell { position: relative; min-width: 0; overflow: hidden; }
  .practice-guide-label-rail, .practice-guide-timeline { display: flex; flex-direction: column; padding-top: 8px; padding-bottom: 12px; }
  .practice-guide-label-rail { box-sizing: border-box; min-width: 0; padding-left: 12px; background: var(--guide-light-surface); }
  .practice-guide-label { display: flex; flex: 0 0 auto; align-items: center; min-width: 0; padding-right: 6px; border-top: 1px solid var(--guide-border); background: var(--guide-light-surface); color: #263c56; font-size: 11px; overflow-wrap: normal; word-break: keep-all; }
  .practice-guide-label-short { display: none; }
  .practice-guide-label[data-guide-lane="ruler"] { height: 24px; border-top: 0; }
  .practice-guide-label[data-guide-lane="melody"] { height: 64px; flex-direction: column; align-items: flex-start; justify-content: center; gap: 2px; }
  .practice-guide-label[data-guide-lane="melody"] { border-color: #244158; background: var(--guide-melody-surface); color: #ffffff; }
  .practice-guide-label[data-guide-lane="lyrics"] { border-color: #244158; background: var(--guide-lyrics-surface); color: #ffffff; }
  .practice-guide-pitch-range { display: flex; flex-direction: column; color: #a0b4c8; font-size: 10px; line-height: 12px; }
  .practice-guide-label[data-guide-lane="lyrics"] { flex-basis: auto; }
  .practice-guide-label[data-guide-lane="technique"] { height: var(--guide-technique-height, 48px); }
  body.guide-compact-mode .practice-guide-label[data-guide-lane="technique"] { height: var(--guide-compact-technique-height, 48px); }
  .practice-guide-label[data-guide-lane="chord"] { height: 36px; }
  .practice-guide-label[data-guide-lane="diagrams"] { height: 154px; }
  .practice-guide-scroll { grid-column: 2; min-width: 0; min-height: 0; overflow-x: auto; overflow-y: hidden; overscroll-behavior-x: contain; }
  .practice-guide-timeline { position: relative; width: var(--guide-total-width); min-width: 100%; background: var(--guide-light-surface); }
  .practice-guide-ruler, .practice-guide-lane { position: relative; box-sizing: border-box; flex: 0 0 auto; width: var(--guide-total-width); background-image: none; }
  .practice-guide-ruler { height: 24px; background-color: var(--guide-light-surface); }
  .practice-guide-lane { border-top: 1px solid var(--guide-border); background-color: var(--guide-light-surface); }
  .practice-guide-lane.practice-guide-melody { height: 64px; border-color: #244158; background-color: var(--guide-melody-surface); }
  .practice-guide-lane.practice-guide-lyrics { height: var(--guide-lyrics-height, 38px); border-color: #244158; background-color: var(--guide-lyrics-surface); }
  .practice-guide-lane.practice-guide-technique { height: var(--guide-technique-height, 48px); }
  .practice-guide-lane.practice-guide-chords { height: 36px; }
  .practice-guide-lane.practice-guide-diagrams { height: 154px; }
  .practice-guide-measure-boundary { position: absolute; z-index: 2; top: 0; bottom: 0; width: 1px; background: var(--guide-border); pointer-events: none; }
  .practice-guide-measure-boundary.is-current { width: 2px; background: var(--guide-playhead); }
  .practice-guide-measure-number { position: absolute; top: 3px; z-index: 3; transform: translateX(4px); color: var(--guide-muted); font-size: 11px; font-weight: 600; }
  .practice-guide-playhead { position: absolute; z-index: 8; top: 0; bottom: 0; width: 2px; background: var(--guide-playhead); box-shadow: 0 0 3px var(--guide-playhead); pointer-events: none; }
  .practice-guide-playhead[hidden] { display: none; }
  .practice-guide-pitch-bar { position: absolute; z-index: 4; box-sizing: border-box; height: 12px; min-width: 3px; border: 1px solid #50c8ff; border-radius: 3px; background: #55d4ef; }
  .practice-guide-pitch-bar.is-past { opacity: 1; border-color: #7f95aa; background: #7f95aa; }
  .practice-guide-pitch-bar.is-next { border-color: #94a5b7; background: #94a5b7; }
  .practice-guide-pitch-bar.is-current { opacity: 1; border-color: var(--guide-playhead); background: var(--guide-playhead); box-shadow: 0 0 0 2px rgba(0, 161, 215, 0.35); }
  .practice-guide-melody-rest { position: absolute; z-index: 4; color: #a0b4c8; font-size: 18px; line-height: 24px; }
  .practice-guide-lyric { position: absolute; z-index: 4; display: inline-flex; align-items: center; min-width: 18px; height: 30px; overflow: visible; padding: 0; border-radius: 3px; color: #f4f5fe; font-size: 18px; line-height: 22px; white-space: nowrap; }
  .practice-guide-lyric.is-past { color: #57d8fb; }
  .practice-guide-lyric.is-next { color: #b8cee1; }
  .practice-guide-lyric.is-current { z-index: 6; color: #ffe788; font-size: 24px; font-weight: 700; line-height: 28px; border-bottom: 2px solid currentColor; }
  .practice-guide-technique-marker { position: absolute; z-index: 4; display: inline-flex; min-width: 14px; height: 22px; align-items: center; justify-content: center; transform: translateX(-50%); color: #244158; font-size: 14px; line-height: 18px; white-space: nowrap; }
  .practice-guide-technique-marker.is-past { color: #7f95aa; }
  .practice-guide-technique-marker.is-next { color: #94a5b7; }
  .practice-guide-technique-marker[data-guide-align="start"] { transform: translateX(0); }
  .practice-guide-technique-marker[data-guide-align="end"] { transform: translateX(-100%); }
  .practice-guide-technique-marker.is-current { border-radius: 3px; background: var(--guide-accent); color: #ffffff; font-weight: 700; }
  .practice-guide-grid-continuation { display: none; }
  #practice-guide-panel[data-guide-grid="4"] .practice-guide-grid-continuation[data-guide-grid="4"],
  #practice-guide-panel[data-guide-grid="8"] .practice-guide-grid-continuation[data-guide-grid="8"],
  #practice-guide-panel[data-guide-grid="16"] .practice-guide-grid-continuation[data-guide-grid="16"] { display: inline-flex; }
  .practice-guide-rest-symbol { display: block; width: 24px; height: 26px; overflow: visible; color: currentColor; font-family: "Apple Symbols", "Noto Music", "Bravura", "Segoe UI Symbol", serif; font-size: 23px; text-anchor: middle; }
  .practice-guide-chord-name { position: absolute; z-index: 4; top: 3px; display: flex; box-sizing: border-box; width: 160px; justify-content: center; transform: translateX(-50%); color: #21354b; font-size: 20px; font-weight: 700; text-align: center; white-space: nowrap; }
  .practice-guide-chord-name.is-current { color: var(--guide-accent); }
  .practice-guide-chord-name[data-guide-align="start"] { transform: translateX(0); }
  .practice-guide-chord-name[data-guide-align="end"] { transform: translateX(-100%); }
  .practice-guide-diagram-event { position: absolute; z-index: 4; top: 4px; display: block; width: 160px; height: 144px; transform: translateX(-50%); border-radius: 6px; background: #ffffff; color: #405268; }
  .practice-guide-diagram-event .practice-guide-diagram { margin: 0 auto; border-radius: 6px; background: #ffffff; box-shadow: inset 0 0 0 1px #d2dde9; }
  .practice-guide-diagram-event[data-guide-align="start"] { transform: translateX(0); }
  .practice-guide-diagram-event[data-guide-align="end"] { transform: translateX(-100%); }
  .practice-guide-diagram-event.is-current { outline: 2px solid var(--guide-playhead); outline-offset: -2px; }
  .practice-guide-diagram { display: block; width: 144px; height: 144px; margin: 0; overflow: visible; color: #405268; }
  .practice-guide-next-chord { grid-column: 3; box-sizing: border-box; min-width: 0; display: flex; flex-direction: column; align-items: center; gap: 7px; padding: 10px 5px; border-left: 1px solid var(--guide-border); background: var(--guide-light-surface); color: var(--guide-ink); text-align: center; }
  .practice-guide-next-chord-label { align-self: flex-start; color: var(--guide-muted); font-size: 11px; }
  .practice-guide-next-chord-name { max-width: 100%; overflow-wrap: anywhere; font-size: 24px; font-weight: 700; }
  .practice-guide-next-chord-diagram { box-sizing: border-box; width: 100%; padding: 4px; border: 1px solid #d2dde9; border-radius: 8px; background: #ffffff; }
  .practice-guide-next-chord-diagram .practice-guide-diagram { box-sizing: border-box; width: 100%; max-width: 144px; height: auto; aspect-ratio: 1; margin: 0 auto; }
  .practice-guide-compact { display: none; box-sizing: border-box; min-width: 0; min-height: 0; overflow: hidden; background: #ffffff; color: #21354b; }
  .practice-guide-pair-page { position: relative; box-sizing: border-box; width: 100%; min-width: 0; min-height: 0; overflow-x: auto; overflow-y: hidden; overscroll-behavior-x: contain; background: var(--guide-light-surface); }
  .practice-guide-pair-page:focus-visible { outline: 2px solid var(--guide-accent); outline-offset: -2px; }
  .practice-guide-scale-holder { position: relative; min-width: 0; flex: 0 0 auto; }
  .practice-guide-scale-layer { position: absolute; top: 0; transform-origin: top left; }
  .practice-guide-page-bank { position: absolute; top: 0; bottom: 0; display: flex; align-items: stretch; gap: 10px; opacity: 1; transition: opacity 220ms ease-in-out; }
  .practice-guide-page-bank[aria-hidden="true"] { pointer-events: none; }
  .practice-guide-page-bank.is-fading { will-change: opacity; }
  .practice-guide-page-bank[hidden], .practice-guide-page-bank[aria-hidden="true"].is-empty { display: none; }
  .practice-guide-bank-content { position: absolute; inset: 0; display: flex; align-items: stretch; gap: 8px; opacity: 1; transition: opacity 220ms ease-in-out; }
  .practice-guide-compact-measure { position: relative; display: flex; flex: 0 0 auto; flex-direction: column; min-width: 0; padding: 0 6px; background: var(--guide-light-surface); }
  .practice-guide-compact-ruler { box-sizing: border-box; flex: 0 0 24px; height: 24px; padding: 3px 2px; color: var(--guide-muted); font-size: 11px; font-weight: 600; }
  .practice-guide-compact-lane { position: relative; box-sizing: border-box; flex: 0 0 auto; overflow: visible; border-top: 1px solid var(--guide-border); background: var(--guide-light-surface); }
  .practice-guide-compact-melody { height: 64px; border-color: #244158; background: var(--guide-melody-surface); color: #ffffff; }
  .practice-guide-compact-lyrics { height: var(--guide-compact-lyrics-height, 38px); border-color: #244158; background: var(--guide-lyrics-surface); color: #ffffff; }
  .practice-guide-compact-technique { height: var(--guide-compact-technique-height, 48px); }
  .practice-guide-compact-chords { height: 36px; }
  .practice-guide-compact-diagrams { height: 154px; }
  .practice-guide-compact-measure.is-current > .practice-guide-compact-ruler { color: var(--guide-playhead); }
  .practice-guide-compact-playhead { position: absolute; z-index: 8; top: 24px; bottom: 0; width: 2px; background: var(--guide-playhead); box-shadow: 0 0 3px var(--guide-playhead); pointer-events: none; }
  .practice-guide-compact-playhead[hidden] { display: none; }
  .practice-guide-compact-melody-event, .practice-guide-compact-lyric, .practice-guide-compact-symbol, .practice-guide-compact-chord-name, .practice-guide-compact-diagram-event { position: absolute; }
  .practice-guide-compact-pitch-bar { position: absolute; display: block; height: 6px; min-width: 3px; border: 1px solid #50c8ff; border-radius: 3px; background: #55d4ef; box-sizing: border-box; }
  .practice-guide-compact-pitch-bar.is-current { border-color: var(--guide-playhead); background: var(--guide-playhead); box-shadow: 0 0 0 1px rgba(0, 161, 215, 0.35); }
  .practice-guide-compact-pitch-bar.is-past { border-color: #7f95aa; background: #7f95aa; }
  .practice-guide-compact-melody-rest { position: absolute; top: 17px; display: block; width: 24px; height: 26px; }
  .practice-guide-compact-melody-rest .practice-guide-rest-symbol { width: 24px; height: 26px; }
  .practice-guide-compact-lyric { top: 5px; min-width: 18px; color: #f4f5fe; font-size: 18px; line-height: 24px; white-space: nowrap; }
  .practice-guide-compact-lyric.is-current { color: #ffe788; font-weight: 700; }
  .practice-guide-compact-lyric.is-past { color: #57d8fb; }
  .practice-guide-compact-technique { color: #244158; }
  .practice-guide-compact-symbol { top: 2px; display: inline-flex; align-items: center; justify-content: flex-start; min-width: 14px; height: 28px; transform: translateX(-50%); color: #244158; white-space: nowrap; }
  .practice-guide-compact-symbol[data-guide-align="start"] { transform: translateX(0); }
  .practice-guide-compact-symbol[data-guide-align="end"] { transform: translateX(-100%); }
  .practice-guide-compact-symbol.is-current { border-radius: 3px; background: var(--guide-accent); color: #ffffff; }
  .practice-guide-stroke-icon { display: block; flex: 0 0 auto; color: currentColor; overflow: visible; }
  .practice-guide-pm-stroke { display: inline-flex; flex: 0 0 auto; align-items: center; gap: 2px; color: currentColor; }
  .practice-guide-pm-label { box-sizing: border-box; flex: 0 0 12px; width: 12px; font-size: 8px; font-weight: 700; line-height: 1; text-align: center; }
  .practice-guide-compact-wave { display: none; flex: 0 0 auto; align-items: center; height: 20px; color: currentColor; }
  #practice-guide-panel[data-guide-grid="4"] .practice-guide-compact-wave[data-guide-wave-grid="4"],
  #practice-guide-panel[data-guide-grid="8"] .practice-guide-compact-wave[data-guide-wave-grid="8"],
  #practice-guide-panel[data-guide-grid="16"] .practice-guide-compact-wave[data-guide-wave-grid="16"] { display: inline-flex; }
  .practice-guide-compact-symbol .practice-guide-rest-symbol { width: 24px; height: 26px; }
  .practice-guide-compact-chord-name { top: 5px; min-width: 36px; transform: translateX(-50%); color: #21354b; font-size: 17px; font-weight: 700; text-align: center; white-space: nowrap; }
  .practice-guide-compact-chord-name.is-current { color: #087fac; }
  .practice-guide-compact-diagram-event { top: 5px; width: 144px; height: 144px; transform: translateX(-50%); }
  .practice-guide-compact-diagram-event.is-current { outline: 2px solid var(--guide-playhead); outline-offset: -2px; }
  .practice-guide-compact-diagram-event .practice-guide-diagram { width: 144px; height: 144px; }
  .practice-guide-compact-lyric[hidden] { display: none !important; }
  @media (max-width: 600px) {
    .practice-guide-layout { grid-template-columns: 68px minmax(0, 1fr) 96px; }
    body.guide-compact-mode .practice-guide-label-full { display: none; }
    body.guide-compact-mode .practice-guide-label-short { display: inline; }
    body.guide-compact-mode .practice-guide-label[data-guide-lane="melody"] { flex-direction: row; }
    body.guide-compact-mode .practice-guide-label[data-guide-lane="melody"] .practice-guide-pitch-range { display: none; }
    .practice-guide-next-chord { padding: 6px 2px; }
    .practice-guide-next-chord-name { font-size: 15px; }
  }
  .practice-guide-empty { color: var(--vscode-descriptionForeground, #888); font-size: 11px; }
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
  @media (max-width: 600px) {
    .score-settings-playability-separator { display: none; }
    .score-settings-playability-value { column-gap: 4px; }
  }
  @media (max-width: 839px) {
    .score-settings-overflow { flex: 0 0 auto; }
    .score-settings-overflow-toggle { display: inline-flex; }
    .score-settings-details-toggle { display: none !important; }
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
  .preview-edit-row {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px;
    padding: 6px 10px;
    border-bottom: 1px solid var(--vscode-widget-border, #555);
    background: var(--vscode-editorWidget-background, #252526);
    color: var(--vscode-foreground, #eee);
    font-size: 12px;
  }
  .preview-edit-row[hidden] { display: none !important; }
  .preview-edit-controls { display: inline-flex; gap: 4px; }
  .preview-edit-controls[hidden], .preview-edit-row input[hidden], .preview-edit-row label[hidden], .preview-edit-row button[hidden] { display: none !important; }
  body[data-preview-edit-mode="true"] svg [data-visual-binding] { cursor: pointer; pointer-events: all; touch-action: none; }
  body[data-preview-edit-mode="true"] svg [data-visual-binding].preview-edit-selected { filter: drop-shadow(0 0 2px var(--vscode-focusBorder, #007fd4)); }
  .preview-edit-row select, .preview-edit-row input {
    min-width: 110px;
    max-width: min(42vw, 420px);
    min-height: 28px;
    padding: 3px 6px;
    background: var(--vscode-input-background, #1e1e1e);
    color: var(--vscode-input-foreground, #eee);
    border: 1px solid var(--vscode-input-border, #555);
    font: inherit;
  }
  .preview-edit-status { color: var(--vscode-descriptionForeground, #aaa); }
</style>
</head>
<body data-display-mode="single" data-orientation="${orientation}" data-page-size="${pageSize}"
  data-preview-document-uri="${escapeXml(options?.documentUri ?? '')}"
  data-preview-document-version="${Number.isSafeInteger(options?.documentVersion) ? options?.documentVersion : ''}"
  data-preview-generation="${Number.isSafeInteger(options?.previewGeneration) ? options?.previewGeneration : ''}"
  data-preview-edit-mode="${previewEditMode}" data-preview-edit-available="${previewEditAvailable}">
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

  <div class="preview-edit-row" id="preview-edit-row" role="group" aria-label="${escapeXml(msgs.uiPreviewEditMode)}"${previewEditMode ? '' : ' hidden'}>
    <label for="preview-edit-target">${escapeXml(msgs.uiPreviewEditTarget)}</label>
    <select id="preview-edit-target" aria-label="${escapeXml(msgs.uiPreviewEditTarget)}"${previewEditAvailable && visualBindings.length ? '' : ' disabled'}>${visualBindingOptions}</select>
    <label id="preview-edit-value-label" for="preview-edit-value">${escapeXml(msgs.uiPreviewEditValue)}</label>
    <input id="preview-edit-value" type="text" maxlength="256" autocomplete="off"${previewEditAvailable && visualBindings.length ? '' : ' disabled'}>
    <div class="preview-edit-controls" id="preview-edit-melody-controls" role="group" aria-label="${escapeXml(msgs.uiPreviewEditMode)}" hidden>
      <button class="toolbar-action" id="preview-edit-pitch-down" type="button" aria-label="${escapeXml(msgs.uiPreviewPitchDown)}">${escapeXml(msgs.uiPreviewPitchDown)}</button>
      <button class="toolbar-action" id="preview-edit-pitch-up" type="button" aria-label="${escapeXml(msgs.uiPreviewPitchUp)}">${escapeXml(msgs.uiPreviewPitchUp)}</button>
      <button class="toolbar-action" id="preview-edit-duration-longer" type="button" aria-label="${escapeXml(msgs.uiPreviewDurationLonger)}">${escapeXml(msgs.uiPreviewDurationLonger)}</button>
      <button class="toolbar-action" id="preview-edit-duration-shorter" type="button" aria-label="${escapeXml(msgs.uiPreviewDurationShorter)}">${escapeXml(msgs.uiPreviewDurationShorter)}</button>
    </div>
    <button class="toolbar-action" id="preview-edit-apply" type="button"${previewEditAvailable && visualBindings.length ? '' : ' disabled'}>${escapeXml(msgs.uiPreviewApplyEdit)}</button>
    <button class="toolbar-action" id="preview-edit-open-source" type="button" hidden>${escapeXml(msgs.uiOpenVisualSource)}</button>
    <button class="toolbar-action" id="preview-edit-mode-toggle" type="button" aria-pressed="true">${escapeXml(msgs.uiPreviewEditMode)}</button>
    <span class="preview-edit-status" id="preview-edit-status" role="status" aria-live="polite">${previewEditAvailable ? '' : escapeXml(msgs.uiPreviewEditDisabled)}</span>
  </div>

  <div class="score-settings-row" id="score-settings-row" role="group" aria-label="${escapeXml(msgs.uiScoreSettings)}">
    <div class="score-settings-primary">
      <label class="score-settings-capo" for="preview-capo-select"><span class="score-settings-label">${escapeXml(msgs.uiCapo)}</span><select id="preview-capo-select" class="score-settings-select" aria-label="${escapeXml(msgs.uiCapo)}" title="${escapeXml(msgs.uiCapoTitle)}"${capoSelectDisabled ? ' disabled' : ''}>${capoOptionsHtml}</select></label>
      <div class="score-settings-playability" id="preview-playability" data-level="${playabilityLevel}" role="status" aria-live="polite" aria-label="${escapeXml(currentPlayabilityControlLabel)}"><span class="score-settings-label">${escapeXml(msgs.uiPlayability)}</span>${currentPlayabilityValueHtml}</div>
      <label class="score-settings-beginner" title="${escapeXml(msgs.uiBeginnerModeTitle)}"><input id="toggle-preview-beginner" type="checkbox"${beginnerUi.active ? ' checked' : ''}><span>${escapeXml(msgs.uiBeginnerShort)}</span><span>${beginnerUi.active ? escapeXml(msgs.uiBeginnerOn) : escapeXml(msgs.uiBeginnerOff)}</span></label>
    </div>
    <div class="score-settings-overflow">
      <button class="toolbar-action score-settings-overflow-toggle" id="temporary-score-settings-toggle" type="button" aria-expanded="false" aria-controls="temporary-score-settings-panel" aria-label="${escapeXml(msgs.uiMoreScoreSettings)}" title="${escapeXml(msgs.uiMoreScoreSettings)}">⋯ <span>${escapeXml(msgs.uiMoreScoreSettings)}</span></button>
      <button class="toolbar-action score-settings-details-toggle" id="score-settings-details-toggle" type="button" aria-expanded="false" aria-controls="temporary-score-settings-panel" aria-label="${escapeXml(msgs.uiPreviewDetails)}" title="${escapeXml(msgs.uiPreviewDetails)}" data-has-details="${hasPreviewDetails}" hidden>${previewDetailsIndicator}</button>
      <div class="toolbar-disclosure-panel temporary-score-settings-panel" id="temporary-score-settings-panel" role="group" aria-label="${escapeXml(msgs.uiMoreScoreSettings)}" data-group-label="${escapeXml(msgs.uiMoreScoreSettings)}" data-details-label="${escapeXml(msgs.uiPreviewDetails)}" data-inline="false" data-details-open="false" hidden>
        <button class="toolbar-action score-settings-details-close" id="close-score-settings-details" type="button" aria-label="${escapeXml(msgs.uiClosePreviewDetails)}" title="${escapeXml(msgs.uiClosePreviewDetails)}" hidden>×</button>
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

  ${renderPracticeGuidePanel(playback.practiceGuide, msgs, playback.occurrences)}

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
      const previewVisualBindings = ${visualBindingsJson};
      const previewEditRow = document.getElementById('preview-edit-row');
      const previewEditTarget = document.getElementById('preview-edit-target');
      const previewEditValue = document.getElementById('preview-edit-value');
      const previewEditStatus = document.getElementById('preview-edit-status');
      const previewEditMelodyControls = document.getElementById('preview-edit-melody-controls');
      const previewEditOpenSource = document.getElementById('preview-edit-open-source');
      const previewEditPitchDown = document.getElementById('preview-edit-pitch-down');
      const previewEditPitchUp = document.getElementById('preview-edit-pitch-up');
      const previewEditDurationLonger = document.getElementById('preview-edit-duration-longer');
      const previewEditDurationShorter = document.getElementById('preview-edit-duration-shorter');
      let previewEditMode = body.dataset.previewEditMode === 'true';
      let melodyPointerGesture;
      const setPreviewEditMode = enabled => {
        previewEditMode = enabled === true;
        body.dataset.previewEditMode = String(previewEditMode);
        previewEditRow.hidden = !previewEditMode;
        document.getElementById('preview-edit-mode-toggle').setAttribute('aria-pressed', String(previewEditMode));
      };
      const previewEditIdentity = () => ({
        documentUri: body.dataset.previewDocumentUri || '',
        documentVersion: Number(body.dataset.previewDocumentVersion),
        previewGeneration: Number(body.dataset.previewGeneration)
      });
      const selectedPreviewBinding = () => previewVisualBindings.find(binding => binding.id === previewEditTarget.value);
      const markSelectedPreviewBinding = id => {
        document.querySelectorAll('[data-visual-binding].preview-edit-selected').forEach(element => element.classList.remove('preview-edit-selected'));
        if (id) document.querySelectorAll('[data-visual-binding]').forEach(element => {
          if (element.getAttribute('data-visual-binding') === id) element.classList.add('preview-edit-selected');
        });
      };
      const syncPreviewEditTarget = () => {
        const binding = selectedPreviewBinding();
        previewEditValue.value = binding ? binding.expected : '';
        const available = body.dataset.previewEditAvailable === 'true' && !!binding;
        const editableText = binding && ['chord', 'rhythm', 'noteGroup', 'inlineNote', 'tab', 'lyric'].includes(binding.kind);
        const melodyNote = binding?.kind === 'melodyNote';
        const melodyDuration = binding && ['melodyNote', 'melodyGroup', 'melodyRest', 'noteGroup', 'inlineNote'].includes(binding.kind);
        const readOnly = binding && !['chord', 'rhythm', 'noteGroup', 'inlineNote', 'tab', 'lyric', 'melodyNote', 'melodyGroup', 'melodyRest', 'letReference'].includes(binding.kind);
        previewEditValue.hidden = !editableText;
        document.getElementById('preview-edit-value-label').hidden = !editableText;
        previewEditMelodyControls.hidden = !melodyNote && !melodyDuration;
        previewEditPitchDown.hidden = !melodyNote;
        previewEditPitchUp.hidden = !melodyNote;
        previewEditDurationLonger.hidden = !melodyDuration;
        previewEditDurationShorter.hidden = !melodyDuration;
        previewEditTarget.disabled = !available;
        previewEditValue.disabled = !available || !editableText;
        document.getElementById('preview-edit-apply').disabled = !available || !editableText;
        previewEditOpenSource.hidden = !readOnly;
        markSelectedPreviewBinding(binding?.id);
        if (!available && body.dataset.previewEditAvailable !== 'true') previewEditStatus.textContent = '${escapeXml(msgs.uiPreviewEditDisabled)}';
        else if (binding?.kind === 'letReference') previewEditStatus.textContent = '${escapeXml(msgs.uiPreviewReferenceChoice)}';
        else if (readOnly) previewEditStatus.textContent = '${escapeXml(msgs.uiPreviewEditReadOnly)}';
        else if (!binding) previewEditStatus.textContent = '';
        else if (!available) previewEditStatus.textContent = '';
      };
      const requestPreviewReferenceChoice = binding => {
        if (!binding || binding.kind !== 'letReference' || !previewEditMode || body.dataset.previewEditAvailable !== 'true') return;
        vscode && vscode.postMessage({ ...previewEditIdentity(), command: 'previewEditReference', visualElementId: binding.id });
      };
      previewEditTarget.addEventListener('change', () => { syncPreviewEditTarget(); requestPreviewReferenceChoice(selectedPreviewBinding()); });
      document.addEventListener('pointerdown', event => {
        if (!event.isPrimary || event.button !== 0 || !previewEditMode || body.dataset.previewEditAvailable !== 'true') return;
        const element = event.target instanceof Element ? event.target.closest('[data-visual-binding]') : null;
        const id = element?.getAttribute('data-visual-binding');
        const binding = previewVisualBindings.find(item => item.id === id);
        if (!element || !binding || binding.kind !== 'melodyNote') return;
        previewEditTarget.value = binding.id;
        syncPreviewEditTarget();
        melodyPointerGesture = { pointerId: event.pointerId, bindingId: binding.id, startY: event.clientY };
        try { element.setPointerCapture(event.pointerId); } catch (_) { /* Document listeners still finish the gesture. */ }
      });
      document.addEventListener('pointerup', event => {
        const gesture = melodyPointerGesture;
        if (!gesture || gesture.pointerId !== event.pointerId) return;
        melodyPointerGesture = undefined;
        if (!previewEditMode || selectedPreviewBinding()?.id !== gesture.bindingId) return;
        const delta = gesture.startY - event.clientY;
        if (Math.abs(delta) < 8) return;
        const semitones = Math.max(-11, Math.min(11, Math.round(delta / 12)));
        if (semitones !== 0) postPreviewVisualEdit('transposeMelody', { semitones });
      });
      document.addEventListener('pointercancel', event => {
        if (melodyPointerGesture?.pointerId === event.pointerId) melodyPointerGesture = undefined;
      });
      document.addEventListener('click', event => {
        if (!previewEditMode || body.dataset.previewEditAvailable !== 'true') return;
        const element = event.target instanceof Element ? event.target.closest('[data-visual-binding]') : null;
        const id = element?.getAttribute('data-visual-binding');
        if (!id || !previewVisualBindings.some(binding => binding.id === id)) return;
        previewEditTarget.value = id;
        syncPreviewEditTarget();
        const binding = selectedPreviewBinding();
        if (binding?.kind === 'letReference') requestPreviewReferenceChoice(binding);
        else if (!previewEditValue.hidden) previewEditValue.focus();
        else document.getElementById('preview-edit-pitch-down').focus();
      });
      const postPreviewVisualEdit = (operation, payload) => {
        const binding = selectedPreviewBinding();
        if (!previewEditMode || !binding || body.dataset.previewEditAvailable !== 'true') return;
        vscode && vscode.postMessage({ ...previewEditIdentity(), command: 'previewVisualEdit', visualElementId: binding.id, operation, payload });
      };
      document.getElementById('preview-edit-pitch-down').addEventListener('click', () => postPreviewVisualEdit('transposeMelody', { semitones: -1 }));
      document.getElementById('preview-edit-pitch-up').addEventListener('click', () => postPreviewVisualEdit('transposeMelody', { semitones: 1 }));
      document.getElementById('preview-edit-duration-longer').addEventListener('click', () => postPreviewVisualEdit('changeDuration', { direction: 'longer' }));
      document.getElementById('preview-edit-duration-shorter').addEventListener('click', () => postPreviewVisualEdit('changeDuration', { direction: 'shorter' }));
      document.getElementById('preview-edit-apply').addEventListener('click', () => {
        const binding = selectedPreviewBinding();
        if (!previewEditMode || !binding || body.dataset.previewEditAvailable !== 'true'
          || !previewEditValue.value || previewEditValue.value.length > 256 || /[\\r\\n\\0]/.test(previewEditValue.value)) return;
        const operation = binding.kind === 'chord' ? 'replaceChord'
          : binding.kind === 'tab' ? 'replaceTabToken'
            : binding.kind === 'rhythm' ? 'replaceRhythmToken'
              : 'replaceLyric';
        vscode && vscode.postMessage({ ...previewEditIdentity(), command: 'previewVisualEdit', visualElementId: binding.id,
          operation, payload: binding.kind === 'chord' ? { name: previewEditValue.value } : { text: previewEditValue.value } });
      });
      document.getElementById('preview-edit-mode-toggle').addEventListener('click', () => {
        vscode && vscode.postMessage({ ...previewEditIdentity(), command: 'previewEditModeToggle', enabled: false });
      });
      previewEditOpenSource.addEventListener('click', () => {
        const binding = selectedPreviewBinding();
        if (binding && previewEditMode && body.dataset.previewEditAvailable === 'true') {
          vscode && vscode.postMessage({ ...previewEditIdentity(), command: 'previewOpenVisualSource', visualElementId: binding.id });
        }
      });
      syncPreviewEditTarget();
      let currentMode = 'single';
      let countInEnabled = false;
      let metronomeEnabled = false;
      let practiceEnabled = false;
      let practiceSpeed = 100;
      let followEnabled = true;
      let guideMelodyVisible = true;
      let guideDiagramsVisible = true;
      let guideCollapsed = false;
      let guideGrid = 'auto';
      let guideViewMode = 'compact';
      let guideCompactStartOccurrence = 0;
      let legacyGuideCompactStartMeasure = null;
      let hasRestoredGuideCompactStartOccurrence = false;
      let compactPageSeekPending = false;
      let lastPracticeGuideTime = null;

      if (vscode) {
        const state = vscode.getState();
        if (state && ['single', 'spread', 'web'].includes(state.currentMode)) {
          currentMode = state.currentMode;
        }
        if (state && typeof state.countInEnabled === 'boolean') countInEnabled = state.countInEnabled;
        if (state && typeof state.metronomeEnabled === 'boolean') metronomeEnabled = state.metronomeEnabled;
        if (state && typeof state.practiceEnabled === 'boolean') practiceEnabled = state.practiceEnabled;
        if (state && typeof state.guideMelodyVisible === 'boolean') guideMelodyVisible = state.guideMelodyVisible;
        if (state && typeof state.guideDiagramsVisible === 'boolean') guideDiagramsVisible = state.guideDiagramsVisible;
        if (state && typeof state.guideCollapsed === 'boolean') guideCollapsed = state.guideCollapsed;
        if (state && ['auto', '4', '8', '16'].includes(state.guideGrid)) guideGrid = state.guideGrid;
        if (state && ['detailed', 'compact'].includes(state.guideViewMode)) guideViewMode = state.guideViewMode;
        if (state && Number.isInteger(state.guideCompactStartOccurrence)) {
          guideCompactStartOccurrence = Math.max(0, state.guideCompactStartOccurrence);
          hasRestoredGuideCompactStartOccurrence = true;
        } else if (state && Number.isInteger(state.guideCompactStartMeasure)) {
          legacyGuideCompactStartMeasure = state.guideCompactStartMeasure;
        }
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
      const scoreSettingsDetailsToggle = document.getElementById('score-settings-details-toggle');
      const temporarySettingsPanel = document.getElementById('temporary-score-settings-panel');
      const scoreSettingsDetailsClose = document.getElementById('close-score-settings-details');
      function syncScoreSettingsLayout() {
        if (!temporarySettingsToggle || !temporarySettingsPanel) return;
        const inline = window.innerWidth >= 840;
        const wasInline = temporarySettingsPanel.dataset.inline === 'true';
        if (wasInline !== inline && temporarySettingsPanel.dataset.detailsOpen === 'true') {
          temporarySettingsPanel.dataset.detailsOpen = 'false';
          temporarySettingsPanel.setAttribute('role', 'group');
          temporarySettingsPanel.setAttribute('aria-label', temporarySettingsPanel.dataset.groupLabel);
          if (scoreSettingsDetailsClose) scoreSettingsDetailsClose.hidden = true;
        }
        temporarySettingsPanel.dataset.inline = String(inline);
        temporarySettingsToggle.hidden = inline;
        if (scoreSettingsDetailsToggle) {
          scoreSettingsDetailsToggle.hidden = !inline || scoreSettingsDetailsToggle.dataset.hasDetails !== 'true';
          scoreSettingsDetailsToggle.setAttribute('aria-expanded', String(inline && temporarySettingsPanel.dataset.detailsOpen === 'true'));
        }
        if (inline) {
          temporarySettingsPanel.hidden = false;
          temporarySettingsToggle.setAttribute('aria-expanded', 'false');
        } else if (wasInline) {
          temporarySettingsPanel.hidden = true;
          temporarySettingsToggle.setAttribute('aria-expanded', 'false');
        }
      }
      syncScoreSettingsLayout();
      const scoreSettingsDisclosure = {
        button: temporarySettingsToggle,
        buttons: [temporarySettingsToggle, scoreSettingsDetailsToggle].filter(Boolean),
        panel: temporarySettingsPanel,
        detailsButton: scoreSettingsDetailsToggle,
        groupLabel: temporarySettingsPanel?.dataset.groupLabel,
        detailsLabel: temporarySettingsPanel?.dataset.detailsLabel
      };
      const disclosureItems = [
        { button: playbackOptionsToggle, buttons: [playbackOptionsToggle], panel: document.getElementById('playback-options-panel') },
        { button: viewExportToggle, buttons: [viewExportToggle], panel: document.getElementById('view-export-panel') },
        scoreSettingsDisclosure
      ].filter(item => item.button && item.panel);
      const capoSelect = document.getElementById('preview-capo-select');
      const beginnerToggle = document.getElementById('toggle-preview-beginner');
      const barrePolicySelect = document.getElementById('select-preview-barre-policy');
      const beginnerCapoModeSelect = document.getElementById('select-preview-beginner-capo-mode');
      const openCapoSettingsButton = document.getElementById('open-score-settings-capo-from-preview');
      const openBeginnerSettingsButton = document.getElementById('open-score-settings-beginner-from-preview');
      let capoOptionDetailsVisible = false;
      function setCapoOptionDetailsVisible(visible) {
        if (!capoSelect || capoOptionDetailsVisible === visible) return;
        capoOptionDetailsVisible = visible;
        Array.from(capoSelect.options).forEach(option => {
          option.textContent = visible ? option.dataset.openLabel : option.dataset.closedLabel;
        });
      }
      function postTemporarySettings(action, value, focusControl) {
        if (vscode) vscode.postMessage({
          command: 'temporarySettingsChanged',
          action,
          value: { ...value, focusControl },
          ...previewIdentity
        });
      }
      if (capoSelect) {
        capoSelect.addEventListener('mousedown', () => setCapoOptionDetailsVisible(true));
        capoSelect.addEventListener('keydown', event => {
          if (event.key === 'Escape' || event.key === 'Tab') {
            setCapoOptionDetailsVisible(false);
          } else if (event.key === ' ') {
            setCapoOptionDetailsVisible(true);
          } else if (event.key === 'Enter' && !event.repeat) {
            setCapoOptionDetailsVisible(!capoOptionDetailsVisible);
          } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            setCapoOptionDetailsVisible(true);
          }
        }, true);
        capoSelect.addEventListener('blur', () => setCapoOptionDetailsVisible(false));
        capoSelect.addEventListener('change', () => {
          setCapoOptionDetailsVisible(false);
          postTemporarySettings('capoChanged', { capo: Number(capoSelect.value) }, 'preview-capo-select');
        });
        document.addEventListener('pointerdown', event => {
          if (event.target !== capoSelect) setCapoOptionDetailsVisible(false);
        }, true);
      }
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
      const practiceGuidePanel = document.getElementById('practice-guide-panel');
      const practiceGuideLayout = practiceGuidePanel?.querySelector?.('.practice-guide-layout');
      const practiceGuideLabelRailShell = practiceGuidePanel?.querySelector?.('.practice-guide-label-rail-shell');
      const practiceGuideLabelRail = practiceGuidePanel?.querySelector?.('.practice-guide-label-rail');
      const practiceGuideScroll = document.getElementById('practice-guide-scroll');
      const practiceGuideTimeline = document.getElementById('practice-guide-timeline');
      const practiceGuideCompact = document.getElementById('practice-guide-compact');
      const practiceGuidePairPage = document.getElementById('practice-guide-pair-page');
      const practiceGuideScaleHolder = document.getElementById('practice-guide-scale-holder');
      const practiceGuideScaleLayer = document.getElementById('practice-guide-scale-layer');
      const practiceGuideBanks = {
        left: document.getElementById('practice-guide-bank-left'),
        right: document.getElementById('practice-guide-bank-right')
      };
      const practiceGuidePlayhead = document.getElementById('practice-guide-playhead');
      const practiceGuideViewSelect = document.getElementById('practice-guide-view');
      const practiceGuideGridSelect = document.getElementById('practice-guide-grid');
      const practiceGuideCompactPrevious = document.getElementById('practice-guide-compact-previous');
      const practiceGuideCompactNext = document.getElementById('practice-guide-compact-next');
      const practiceGuideCompactRange = document.getElementById('practice-guide-compact-range');
      const practiceGuideDiagramsToggle = document.getElementById('practice-guide-diagrams-toggle');
      const practiceGuideMelodyToggle = document.getElementById('practice-guide-melody-toggle');
      const practiceGuideCollapseToggle = document.getElementById('practice-guide-collapse');
      const practiceGuideAutoFill = document.getElementById('practice-guide-auto-fill');
      const practiceGuideNextChordName = document.getElementById('practice-guide-next-chord-name');
      const practiceGuideNextChordDiagram = document.getElementById('practice-guide-next-chord-diagram');
      let currentGuideMeasureIndex = null;
      let practiceGuideResizeObserver = null;
      let practiceGuideLayoutFrame = 0;
      const guideProjections = (() => { try { return JSON.parse(practiceGuideCompact?.dataset.guideProjections || '{}'); } catch { return {}; } })();
      const guideMeasureWidths = (() => { try { return JSON.parse(practiceGuideCompact?.dataset.guideMeasureWidths || '[]'); } catch { return []; } })();
      const guideBankWidths = (() => { try { return JSON.parse(practiceGuideCompact?.dataset.guideBankWidths || '{}'); } catch { return {}; } })();
      const guideMeasureTemplates = new Map([...(practiceGuideCompact?.querySelectorAll?.('template[data-guide-template-measure]') ?? [])]
        .map(template => [Number(template.dataset.guideTemplateMeasure), template]));
      let lastGuideOccurrenceIndex = null;
      let lastGuidePageIndex = null;
      let lastGuideCurrentBank = 'left';
      let guideInstantReprojectPending = false;
      let guideCompactSnapPending = true;
      let lastGuideSnappedOccurrenceIndex = null;
      const guideBankGenerations = { left: 0, right: 0 };
      const guideBankFadeCleanups = { left: null, right: null };
      const clampCompactStart = value => {
        const occurrenceCount = playbackOccurrences.length;
        const maxPairStart = Math.max(0, Math.floor(Math.max(0, occurrenceCount - 3) / 2) * 2);
        const pairStart = Math.floor((Number(value) || 0) / 2) * 2;
        return Math.max(0, Math.min(maxPairStart, pairStart));
      };
      function syncPracticeGuidePanelGeometry() {
        if (!practiceGuidePanel) return;
        const viewportHeight = Math.max(0, window.innerHeight || 0);
        const reservedScoreHeight = viewportHeight >= 700 ? 160 : Math.max(80, viewportHeight * 0.2);
        practiceGuidePanel.style.maxHeight = Math.max(42, viewportHeight - 152 - reservedScoreHeight) + 'px';
        if (practiceGuideLayoutFrame) window.cancelAnimationFrame(practiceGuideLayoutFrame);
        practiceGuideLayoutFrame = window.requestAnimationFrame(() => {
          practiceGuideLayoutFrame = 0;
          if (body.classList.contains('guide-collapsed')) {
            practiceGuidePanel.style.height = '42px';
          } else if (!body.classList.contains('has-practice-guide')) {
            practiceGuidePanel.style.height = 'auto';
          } else {
            const layout = practiceGuidePanel.querySelector?.('.practice-guide-layout');
            const header = practiceGuidePanel.querySelector?.('.practice-guide-header');
            const labelRail = practiceGuidePanel.querySelector?.('.practice-guide-label-rail-shell');
            const timeline = practiceGuidePanel.querySelector?.('.practice-guide-timeline');
            const nextChord = practiceGuidePanel.querySelector?.('.practice-guide-next-chord');
            const compactGuide = practiceGuidePanel.querySelector?.('.practice-guide-compact');
            const panelTop = practiceGuidePanel.getBoundingClientRect().top;
            const layoutScrollTop = Number(layout?.scrollTop) || 0;
            const contentBottoms = [];
            const measureColumnBottom = element => {
              if (!element || typeof element.getBoundingClientRect !== 'function') return;
              const rect = element.getBoundingClientRect();
              contentBottoms.push(Math.max(rect.bottom, rect.top + (Number(element.scrollHeight) || 0)) + layoutScrollTop);
            };
            measureColumnBottom(labelRail);
            measureColumnBottom(nextChord);
            measureColumnBottom(compactGuide);
            measureColumnBottom(timeline);
            const timelineLanes = [...(timeline?.querySelectorAll?.('.practice-guide-lane') ?? [])]
              .filter(item => typeof getComputedStyle !== 'function' || getComputedStyle(item).display !== 'none');
            const laneBottom = timelineLanes.reduce((bottom, lane) =>
              Math.max(bottom, lane.getBoundingClientRect().bottom), -Infinity);
            if (Number.isFinite(laneBottom)) {
              const timelinePaddingBottom = typeof getComputedStyle === 'function'
                ? parseFloat(getComputedStyle(timeline).paddingBottom) || 0
                : 0;
              contentBottoms.push(laneBottom + layoutScrollTop + timelinePaddingBottom);
            }
            const headerHeight = typeof header?.getBoundingClientRect === 'function'
              ? header.getBoundingClientRect().height
              : 42;
            const borderTop = typeof getComputedStyle === 'function'
              ? parseFloat(getComputedStyle(practiceGuidePanel).borderTopWidth) || 0
              : 0;
            const headerBottom = typeof header?.getBoundingClientRect === 'function'
              ? header.getBoundingClientRect().bottom
              : panelTop + headerHeight;
            const contentBottom = Math.max(headerBottom, ...contentBottoms);
            practiceGuidePanel.style.height = Math.max(42, contentBottom - panelTop + borderTop) + 'px';
          }
          const panelHeight = body.classList.contains('has-practice-guide')
            ? practiceGuidePanel.getBoundingClientRect().height
            : 0;
          if (body.style && typeof body.style.setProperty === 'function') {
            body.style.setProperty('--practice-guide-panel-height', panelHeight + 'px');
          }
        });
      }
      window.addEventListener('resize', () => {
        guideCompactSnapPending = true;
        syncPracticeGuidePanelGeometry();
        updatePracticeUi();
      }, { passive: true });
      if (practiceGuidePanel && typeof ResizeObserver === 'function') {
        let previousGuidePanelWidth = 0;
        practiceGuideResizeObserver = new ResizeObserver(() => {
          syncPracticeGuidePanelGeometry();
          const width = practiceGuidePanel.getBoundingClientRect().width;
          if (previousGuidePanelWidth > 0 && Math.abs(width - previousGuidePanelWidth) > 1) {
            guideInstantReprojectPending = true;
            guideCompactSnapPending = true;
            updatePracticeUi();
          }
          previousGuidePanelWidth = width;
        });
        practiceGuideResizeObserver.observe(practiceGuidePanel);
      }
      if (countInToggle) countInToggle.checked = countInEnabled;
      if (metronomeToggle) metronomeToggle.checked = metronomeEnabled;
      if (practiceSpeedSelect) practiceSpeedSelect.value = String(practiceSpeed);

      function persistWebviewState() {
        if (vscode) vscode.setState({ currentMode, countInEnabled, metronomeEnabled, practiceEnabled, practiceSpeed, followEnabled, guideMelodyVisible, guideDiagramsVisible, guideCollapsed, guideGrid, guideViewMode, guideCompactStartOccurrence });
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
      if (!hasRestoredGuideCompactStartOccurrence && Number.isInteger(legacyGuideCompactStartMeasure)) {
        const legacyPosition = playbackOccurrences.findIndex(item => item.measureIndex === legacyGuideCompactStartMeasure);
        guideCompactStartOccurrence = Math.max(0, legacyPosition);
      }
      guideCompactStartOccurrence = clampCompactStart(guideCompactStartOccurrence);
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
      let brushBuffer = null;
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

      function cancelPracticeGuideBankFade(bankId) {
        const cleanup = guideBankFadeCleanups[bankId];
        if (cleanup) cleanup(true);
        guideBankFadeCleanups[bankId] = null;
        guideBankGenerations[bankId]++;
      }

      function cancelAllPracticeGuideFades(clearBanks) {
        for (const bankId of ['left', 'right']) {
          cancelPracticeGuideBankFade(bankId);
          if (clearBanks && typeof practiceGuideBanks[bankId]?.replaceChildren === 'function') practiceGuideBanks[bankId].replaceChildren();
        }
      }

      function buildPracticeGuideBankContent(bankId, occurrenceIds, capacity) {
        const content = document.createElement('div');
        content.className = 'practice-guide-bank-content';
        const widths = guideBankWidths[String(capacity)]?.[bankId] ?? [];
        for (let slot = 0; slot < occurrenceIds.length; slot++) {
          const occurrenceId = occurrenceIds[slot];
          const occurrence = playbackOccurrences.find(item => item.occurrenceIndex === occurrenceId);
          if (!occurrence) continue;
          const template = guideMeasureTemplates.get(occurrence.measureIndex);
          const card = template?.content?.firstElementChild?.cloneNode(true);
          if (!card) continue;
          const playbackPosition = playbackOccurrences.findIndex(item => item.occurrenceIndex === occurrence.occurrenceIndex);
          card.dataset.guideOccurrenceIndex = String(occurrence.occurrenceIndex);
          card.dataset.guidePlaybackPosition = String(playbackPosition + 1);
          card.dataset.guideMeasureIndex = String(occurrence.measureIndex);
          card.dataset.guideLyricVerse = String(Number(occurrence.lyricVerse) || 1);
          card.setAttribute('aria-label', (audioLabels.practiceMeasure || 'Measure') + ' ' + (occurrence.measureIndex + 1)
            + ', ' + (audioLabels.guidePlaybackOrder || 'Playback order') + ' ' + (playbackPosition + 1));
          const width = Number(widths[slot]) || Number(guideMeasureWidths[occurrence.measureIndex]) || 144;
          card.style.width = width + 'px';
          card.style.flexBasis = width + 'px';
          for (const lyric of card.querySelectorAll('.practice-guide-compact-lyric')) {
            lyric.hidden = Number(lyric.dataset.guideVerse) !== (Number(occurrence.lyricVerse) || 1);
          }
          content.appendChild(card);
        }
        return content;
      }

      function placePracticeGuideBanks(capacity) {
        if (!practiceGuidePairPage) return;
        const widths = guideBankWidths[String(capacity)] || guideBankWidths['4'];
        const bankWidth = bankId => (widths?.[bankId] || []).reduce((sum, width) => sum + (Number(width) || 144), 0)
          + Math.max(0, (widths?.[bankId]?.length || 1) - 1) * 8;
        const leftWidth = bankWidth('left');
        const rightWidth = bankWidth('right');
        const stripWidth = leftWidth + 10 + rightWidth;
        const scale = guideViewMode === 'compact' && window.innerWidth < 421
          ? Math.max(0.8, window.innerWidth / 421)
          : 1;
        const stageHeight = 20 + 24 + (guideMelodyVisible ? 64 : 0)
          + (Number(playbackData.practiceGuide?.lyricsHeight) || 38)
          + (Number(practiceGuideCompact?.dataset.guideTechniqueHeight) || 48) + 36
          + (guideDiagramsVisible ? 154 : 0);
        const laneHeight = stageHeight - 20;
        const scaledStageHeight = stageHeight * scale;
        const baseLabelWidth = window.innerWidth <= 600 ? 68 : 76;
        const nextChordWidth = window.innerWidth <= 600 ? 96 : 112;
        if (practiceGuideLayout) {
          practiceGuideLayout.style.gridTemplateColumns = (baseLabelWidth * scale) + 'px minmax(0, 1fr) ' + nextChordWidth + 'px';
        }
        if (guideViewMode === 'compact' && scale < 1 && practiceGuideLabelRailShell && practiceGuideLabelRail) {
          practiceGuideLabelRailShell.style.width = (baseLabelWidth * scale) + 'px';
          practiceGuideLabelRailShell.style.height = scaledStageHeight + 'px';
          practiceGuideLabelRail.style.width = baseLabelWidth + 'px';
          practiceGuideLabelRail.style.height = stageHeight + 'px';
          practiceGuideLabelRail.style.transform = 'scale(' + scale + ')';
          practiceGuideLabelRail.style.transformOrigin = 'top left';
          practiceGuideLabelRail.style.paddingTop = (8 / scale) + 'px';
        } else if (practiceGuideLabelRailShell && practiceGuideLabelRail) {
          practiceGuideLabelRailShell.style.removeProperty('width');
          practiceGuideLabelRailShell.style.removeProperty('height');
          practiceGuideLabelRail.style.removeProperty('width');
          practiceGuideLabelRail.style.removeProperty('height');
          practiceGuideLabelRail.style.removeProperty('transform');
          practiceGuideLabelRail.style.removeProperty('transform-origin');
          practiceGuideLabelRail.style.removeProperty('padding-top');
        }
        practiceGuidePairPage.dataset.guideCapacity = String(capacity);
        practiceGuidePairPage.dataset.guideScale = String(scale);
        practiceGuidePairPage.dataset.guideStripWidth = String(stripWidth);
        practiceGuidePairPage.style.height = scaledStageHeight + 'px';
        const viewportWidth = practiceGuidePairPage.clientWidth;
        const scaledStripWidth = stripWidth * scale;
        const centeredInset = scaledStripWidth <= viewportWidth
          ? Math.max(0, (viewportWidth - scaledStripWidth) / 2)
          : 0;
        if (practiceGuideScaleHolder && practiceGuideScaleLayer) {
          practiceGuideScaleHolder.style.width = Math.max(viewportWidth, scaledStripWidth) + 'px';
          practiceGuideScaleHolder.style.height = scaledStageHeight + 'px';
          practiceGuideScaleLayer.style.left = centeredInset + 'px';
          practiceGuideScaleLayer.style.top = '8px';
          practiceGuideScaleLayer.style.width = stripWidth + 'px';
          practiceGuideScaleLayer.style.height = laneHeight + 'px';
          practiceGuideScaleLayer.style.transform = 'scale(' + scale + ')';
        }
        practiceGuidePairPage.dataset.guideCentered = String(scaledStripWidth <= viewportWidth);
        for (const bankId of ['left', 'right']) {
          const bank = practiceGuideBanks[bankId];
          if (!bank) continue;
          bank.style.left = capacity === 1 || bankId === 'left' ? '0px' : (leftWidth + 10) + 'px';
          bank.style.width = bankWidth(bankId) + 'px';
        }
        const maxScroll = Math.max(0, practiceGuidePairPage.scrollWidth - practiceGuidePairPage.clientWidth);
        practiceGuidePairPage.scrollLeft = Math.min(practiceGuidePairPage.scrollLeft, maxScroll);
        if (scaledStripWidth <= viewportWidth) practiceGuidePairPage.scrollLeft = 0;
      }

      function ensureActiveCompactOccurrenceVisible(occurrencePosition) {
        if (!practiceGuidePairPage || !practiceGuideCompact || occurrencePosition < 0) return;
        const occurrence = playbackOccurrences[occurrencePosition];
        const card = occurrence && practiceGuidePairPage.querySelector(
          '.practice-guide-compact-measure[data-guide-occurrence-index="' + occurrence.occurrenceIndex + '"]');
        if (!card) return;
        const viewport = practiceGuidePairPage.getBoundingClientRect();
        const rect = card.getBoundingClientRect();
        const padding = 6;
        const visibleLeft = viewport.left + padding;
        const visibleRight = viewport.right - padding;
        let delta = 0;
        if (rect.width > visibleRight - visibleLeft) delta = rect.left - visibleLeft;
        else if (rect.left < visibleLeft) delta = rect.left - visibleLeft;
        else if (rect.right > visibleRight) delta = rect.right - visibleRight;
        if (Math.abs(delta) > 0.5) {
          const maxScroll = Math.max(0, practiceGuidePairPage.scrollWidth - practiceGuidePairPage.clientWidth);
          practiceGuidePairPage.scrollLeft = Math.max(0, Math.min(maxScroll, practiceGuidePairPage.scrollLeft + delta));
        }
        const updated = card.getBoundingClientRect();
        const visibleWidth = Math.max(0, Math.min(updated.right, viewport.right) - Math.max(updated.left, viewport.left));
        const usableViewportWidth = Math.max(0, visibleRight - visibleLeft);
        practiceGuidePairPage.dataset.guideActiveVisible = String(
          visibleWidth >= Math.min(updated.width, usableViewportWidth) - 1);
      }

      function replacePracticeGuideBank(bankId, occurrenceIds, capacity, animate, fadeOutOnly) {
        const bank = practiceGuideBanks[bankId];
        if (!bank) return;
        cancelPracticeGuideBankFade(bankId);
        const idsKey = occurrenceIds.join(',');
        const oldContent = bank.querySelector('.practice-guide-bank-content');
        if (!animate && !fadeOutOnly && bank.dataset.guideOccurrences === idsKey && oldContent) return;
        const generation = guideBankGenerations[bankId];
        if (!animate) {
          bank.replaceChildren();
          bank.dataset.guideOccurrences = fadeOutOnly ? '' : idsKey;
          if (!fadeOutOnly && occurrenceIds.length) bank.appendChild(buildPracticeGuideBankContent(bankId, occurrenceIds, capacity));
          bank.classList.toggle('is-empty', fadeOutOnly || occurrenceIds.length === 0);
          bank.setAttribute('aria-hidden', String(fadeOutOnly || occurrenceIds.length === 0));
          return;
        }

        const newContent = fadeOutOnly ? null : buildPracticeGuideBankContent(bankId, occurrenceIds, capacity);
        if (newContent) {
          newContent.style.opacity = '0';
          bank.appendChild(newContent);
          bank.dataset.guideOccurrences = idsKey;
          bank.classList.remove('is-empty');
          bank.setAttribute('aria-hidden', 'false');
        }
        if (oldContent) {
          oldContent.setAttribute('aria-hidden', 'true');
          oldContent.style.pointerEvents = 'none';
          oldContent.inert = true;
        }
        if (!oldContent && !newContent) {
          bank.classList.add('is-empty');
          bank.setAttribute('aria-hidden', 'true');
          return;
        }
        const outgoing = oldContent;
        let frame = 0;
        let timer = 0;
        let finished = false;
        const transitionTarget = newContent || outgoing;
        const finish = () => {
          if (finished || guideBankGenerations[bankId] !== generation) return;
          finished = true;
          if (frame) window.cancelAnimationFrame(frame);
          if (timer) window.clearTimeout(timer);
          transitionTarget?.removeEventListener('transitionend', onTransitionEnd);
          if (outgoing && outgoing !== newContent) outgoing.remove();
          if (newContent) newContent.style.opacity = '1';
          if (!newContent) {
            bank.replaceChildren();
            bank.dataset.guideOccurrences = '';
            bank.classList.add('is-empty');
            bank.setAttribute('aria-hidden', 'true');
          }
          guideBankFadeCleanups[bankId] = null;
        };
        const onTransitionEnd = event => {
          if (event.target === transitionTarget && event.propertyName === 'opacity') finish();
        };
        transitionTarget?.addEventListener('transitionend', onTransitionEnd);
        frame = window.requestAnimationFrame(() => {
          frame = 0;
          if (guideBankGenerations[bankId] !== generation) return;
          if (newContent) newContent.style.opacity = '1';
          if (outgoing) outgoing.style.opacity = '0';
        });
        timer = window.setTimeout(finish, 280);
        guideBankFadeCleanups[bankId] = commit => {
          if (finished) return;
          finished = true;
          if (frame) window.cancelAnimationFrame(frame);
          if (timer) window.clearTimeout(timer);
          transitionTarget?.removeEventListener('transitionend', onTransitionEnd);
          if (outgoing && outgoing !== newContent) outgoing.remove();
          if (newContent) newContent.style.opacity = '1';
          if (commit === false) bank.replaceChildren();
        };
      }

      function updatePracticeGuidePage(occurrence, animateRequested, snapRequested) {
        if (!practiceGuideCompact || !practiceGuidePairPage) return { pageIndex: -1, currentBank: 'left', occurrencePosition: -1 };
        const occurrencePosition = occurrence
          ? playbackOccurrences.findIndex(item => item.occurrenceIndex === occurrence.occurrenceIndex)
          : -1;
        const transportRunning = transport === 'playing' || transport === 'counting-in';
        if ((transportRunning || compactPageSeekPending) && occurrence) {
          guideCompactStartOccurrence = clampCompactStart(occurrencePosition);
        }
        const occurrenceCount = playbackOccurrences.length;
        const requestedOccurrencePosition = clampCompactStart(guideCompactStartOccurrence);
        const manualPosition = requestedOccurrencePosition < occurrenceCount ? requestedOccurrencePosition : -1;
        const manualFrame = manualPosition >= 0 ? guideProjections['4']?.[manualPosition] : null;
        const currentFrame = occurrencePosition >= 0 ? guideProjections['4']?.[occurrencePosition] : null;
        const currentOccurrenceSharesManualPage = !transportRunning && currentFrame && manualFrame
          && currentFrame.pageIndex === manualFrame.pageIndex;
        const projectionPosition = transportRunning || currentOccurrenceSharesManualPage
          ? occurrencePosition
          : manualPosition;
        const projectedOccurrence = projectionPosition >= 0 ? playbackOccurrences[projectionPosition] : null;
        const capacity = 4;
        const frame = projectionPosition >= 0 ? guideProjections[String(capacity)]?.[projectionPosition] : null;
        placePracticeGuideBanks(capacity);
        const rangeEnd = Math.min(occurrenceCount, requestedOccurrencePosition + capacity);
        if (practiceGuideCompactRange) {
          practiceGuideCompactRange.textContent = occurrenceCount
            ? String(requestedOccurrencePosition + 1) + '–' + String(rangeEnd) + '/' + String(occurrenceCount)
            : '0/0';
          practiceGuideCompactRange.setAttribute('aria-label', occurrenceCount
            ? (audioLabels.guidePlaybackOrder || 'Playback order') + ' ' + (requestedOccurrencePosition + 1) + '–' + rangeEnd + ' / ' + occurrenceCount
            : (audioLabels.guidePlaybackOrder || 'Playback order') + ' 0/0');
        }
        const canBrowse = !transportRunning && occurrenceCount > capacity;
        if (practiceGuideCompactPrevious) practiceGuideCompactPrevious.disabled = !canBrowse || requestedOccurrencePosition <= 0;
        if (practiceGuideCompactNext) practiceGuideCompactNext.disabled = !canBrowse || requestedOccurrencePosition + capacity >= occurrenceCount;
        if (!frame) {
          cancelAllPracticeGuideFades(true);
          practiceGuidePairPage.dataset.guideCurrentBank = '';
          practiceGuidePairPage.dataset.guidePageIndex = '-1';
          practiceGuidePairPage.dataset.guideOccurrenceIndex = '';
          return { pageIndex: -1, currentBank: 'left', occurrencePosition };
        }
        const guideFadeRunning = Boolean(guideBankFadeCleanups.left || guideBankFadeCleanups.right);
        const projectedOccurrenceId = projectedOccurrence?.occurrenceIndex ?? null;
        const occurrenceChanged = projectedOccurrenceId !== lastGuideSnappedOccurrenceIndex;
        practiceGuidePairPage.dataset.guideCurrentBank = frame.currentBank;
        practiceGuidePairPage.dataset.guidePageIndex = String(frame.pageIndex);
        practiceGuidePairPage.dataset.guideOccurrenceIndex = String(projectedOccurrenceId ?? '');
        if (guideFadeRunning && !guideInstantReprojectPending) {
          if (frame.pageIndex === lastGuidePageIndex) {
            if (guideViewMode === 'compact' && (snapRequested || occurrenceChanged)) {
              ensureActiveCompactOccurrenceVisible(projectionPosition);
              lastGuideSnappedOccurrenceIndex = projectedOccurrenceId;
            }
            lastGuideOccurrenceIndex = projectionPosition;
            lastGuideCurrentBank = frame.currentBank;
            return { pageIndex: frame.pageIndex, currentBank: frame.currentBank, occurrencePosition: projectionPosition };
          }
          cancelAllPracticeGuideFades(true);
          guideInstantReprojectPending = true;
        }
        const sequentialBoundary = lastGuideOccurrenceIndex !== null
          && projectionPosition === lastGuideOccurrenceIndex + 1
          && lastGuidePageIndex !== null && frame.pageIndex === lastGuidePageIndex + 1;
        const reduceMotion = typeof window.matchMedia === 'function'
          && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        const animate = Boolean(animateRequested && sequentialBoundary && !guideInstantReprojectPending && !reduceMotion
          && guideViewMode === 'compact' && practiceEnabled);
        const leftIds = frame.banks.left || [];
        const rightIds = frame.banks.right || [];
        const changedBank = animate ? lastGuideCurrentBank : null;
        replacePracticeGuideBank('left', leftIds, capacity, changedBank === 'left', false);
        replacePracticeGuideBank('right', rightIds, capacity, changedBank === 'right', false);
        if (guideViewMode === 'compact' && (snapRequested || occurrenceChanged)) {
          ensureActiveCompactOccurrenceVisible(projectionPosition);
          lastGuideSnappedOccurrenceIndex = projectedOccurrenceId;
        }
        lastGuideOccurrenceIndex = projectionPosition;
        lastGuidePageIndex = frame.pageIndex;
        lastGuideCurrentBank = frame.currentBank;
        guideInstantReprojectPending = false;
        return { pageIndex: frame.pageIndex, currentBank: frame.currentBank, occurrencePosition: projectionPosition };
      }

      function updatePracticeGuideUi() {
        body.classList.toggle('has-practice-guide', practiceEnabled);
        body.classList.toggle('guide-melody-hidden', !guideMelodyVisible);
        body.classList.toggle('guide-diagrams-hidden', !guideDiagramsVisible);
        body.classList.toggle('guide-collapsed', guideCollapsed);
        body.classList.toggle('guide-compact-mode', guideViewMode === 'compact');
        if (practiceGuideViewSelect) practiceGuideViewSelect.value = guideViewMode;
        if (practiceGuideGridSelect) practiceGuideGridSelect.value = guideGrid;
        if (practiceGuideDiagramsToggle) {
          practiceGuideDiagramsToggle.setAttribute('aria-pressed', String(guideDiagramsVisible));
          practiceGuideDiagramsToggle.textContent = (audioLabels.guideDiagrams || 'Chord diagrams') + (guideDiagramsVisible ? ' ON' : ' OFF');
        }
        if (practiceGuideMelodyToggle) {
          practiceGuideMelodyToggle.setAttribute('aria-pressed', String(guideMelodyVisible));
          practiceGuideMelodyToggle.textContent = (audioLabels.guideMelody || 'Melody') + (guideMelodyVisible ? ' ON' : ' OFF');
        }
        if (practiceGuideCollapseToggle) {
          practiceGuideCollapseToggle.setAttribute('aria-expanded', String(!guideCollapsed));
          practiceGuideCollapseToggle.setAttribute('title', guideCollapsed ? audioLabels.guideExpand : audioLabels.guideCollapse);
          practiceGuideCollapseToggle.textContent = guideCollapsed ? '›' : '⌄';
        }
        if (practiceGuideAutoFill) practiceGuideAutoFill.hidden = !(guideGrid === 'auto' && playbackData.practiceGuide?.automaticFill);
        syncPracticeGuidePanelGeometry();

        const selectedGrid = guideGrid === 'auto'
          ? Number(playbackData.practiceGuide?.automaticGrid) || 4
          : Number(guideGrid);
        if (Number.isFinite(selectedGrid)) practiceGuidePanel?.setAttribute('data-guide-grid', String(selectedGrid));
        const shownTime = transport === 'playing' || transport === 'counting-in' ? scoreTimeFromAudioClock() : positionSeconds;
        const occurrence = playbackOccurrences.find(item => shownTime >= item.startSeconds && shownTime < item.startSeconds + item.durationSeconds)
          ?? playbackOccurrences[playbackOccurrences.length - 1];
        const measureIndex = occurrence ? occurrence.measureIndex : null;
        const measureChanged = measureIndex !== currentGuideMeasureIndex;
        const guideTimeMovedBackwards = lastPracticeGuideTime !== null && shownTime < lastPracticeGuideTime - 0.000001;
        if (guideTimeMovedBackwards) guideInstantReprojectPending = true;
        const snapRequested = guideCompactSnapPending || guideInstantReprojectPending || compactPageSeekPending || guideTimeMovedBackwards;
        updatePracticeGuidePage(occurrence, true, snapRequested);
        guideCompactSnapPending = false;
        compactPageSeekPending = false;
        const guideMeasure = measureIndex === null ? null : playbackData.practiceGuide?.measures?.[measureIndex] ?? null;
        const measureBeats = Math.max(0, Number(guideMeasure?.beats?.n ?? guideMeasure?.beats ?? 0) / Number(guideMeasure?.beats?.d ?? 1));
        const secondsIntoMeasure = occurrence ? Math.max(0, shownTime - occurrence.startSeconds) : 0;
        const currentBeat = occurrence
          ? Math.max(0, Math.min(measureBeats, secondsIntoMeasure * (Number(occurrence.tempoBpm) || 0) / 60))
          : 0;
        const measureStartBeat = Number(guideMeasure?.startBeat?.n ?? guideMeasure?.startBeat ?? 0) / Number(guideMeasure?.startBeat?.d ?? 1);
        const pixelsPerBeat = Number(practiceGuideTimeline?.dataset.guidePxPerBeat) || 80;
        const currentX = (measureStartBeat + currentBeat) * pixelsPerBeat;
        let nextChord = playbackData.practiceGuide?.initialNextChord ?? null;
        if (occurrence && guideMeasure) {
          nextChord = guideMeasure?.chords?.find(chord => chord.beat > currentBeat + 0.000001) ?? null;
          if (!nextChord) {
            const occurrenceIndex = playbackOccurrences.indexOf(occurrence);
            for (let i = occurrenceIndex + 1; i < playbackOccurrences.length && !nextChord; i++) {
              const nextMeasure = playbackData.practiceGuide?.measures?.[playbackOccurrences[i].measureIndex];
              if (nextMeasure?.chords?.length) nextChord = nextMeasure.chords[0];
            }
          }
        }
        if (practiceGuideNextChordName) practiceGuideNextChordName.textContent = nextChord?.name ?? '—';
        if (practiceGuideNextChordDiagram) practiceGuideNextChordDiagram.innerHTML = nextChord?.svg ?? '';
        if (practiceGuidePlayhead) {
          practiceGuidePlayhead.style.left = currentX.toFixed(3) + 'px';
          practiceGuidePlayhead.hidden = !practiceEnabled || !occurrence || !overlayVisible;
        }
        const isCurrentBeat = (item, includeEnd = false) => {
          const start = Number(item.dataset.guideStartBeat);
          const end = Number(item.dataset.guideEndBeat);
          return measureIndex !== null && Number(item.dataset.guideMeasure) === measureIndex && currentBeat >= start - 0.000001 && (includeEnd ? currentBeat <= end + 0.000001 : currentBeat < end - 0.000001);
        };
        const melodyItems = [...practiceGuideTimeline?.querySelectorAll?.('.practice-guide-pitch-bar, .practice-guide-melody-rest') ?? []];
        for (const item of melodyItems) {
          const itemMeasure = Number(item.dataset.guideMeasure);
          const itemEnd = Number(item.dataset.guideEndBeat);
          const past = measureIndex !== null && (itemMeasure < measureIndex || (itemMeasure === measureIndex && itemEnd <= currentBeat + 0.000001));
          item.classList.toggle('is-past', past);
          item.classList.toggle('is-current', isCurrentBeat(item));
          item.classList.toggle('is-next', !past && !isCurrentBeat(item));
        }
        const currentOccurrenceId = occurrence?.occurrenceIndex;
        const matchesCompactOccurrence = item => Number(item.closest?.('.practice-guide-compact-measure')?.dataset.guideOccurrenceIndex) === Number(currentOccurrenceId);
        for (const item of practiceGuidePanel?.querySelectorAll?.('.practice-guide-compact-playhead') ?? []) {
          const card = item.closest?.('.practice-guide-compact-measure');
          const occurrenceMatches = Number(card?.dataset.guideOccurrenceIndex) === Number(currentOccurrenceId);
          const cardBeats = Math.max(0.000001, Number(card?.dataset.guideMeasureBeats) || 0);
          item.style.left = Math.max(0, Math.min(100, currentBeat / cardBeats * 100)) + '%';
          item.dataset.guideCurrentBeat = currentBeat.toFixed(3);
          item.hidden = !practiceEnabled || !occurrenceMatches || !overlayVisible || guideViewMode !== 'compact';
        }
        for (const item of practiceGuidePanel?.querySelectorAll?.('.practice-guide-compact-pitch-bar, .practice-guide-compact-melody-rest') ?? []) {
          const start = Number(item.dataset.guideStartBeat);
          const end = Number(item.dataset.guideEndBeat);
          const occurrenceMatches = matchesCompactOccurrence(item);
          const current = occurrenceMatches && currentBeat >= start - 0.000001 && currentBeat < end - 0.000001;
          item.classList.toggle('is-current', current);
          item.classList.toggle('is-past', occurrenceMatches && end <= currentBeat + 0.000001);
        }
        const selectedVerse = Number(occurrence?.lyricVerse) || 1;
        const lyricItems = [...practiceGuideTimeline?.querySelectorAll?.('.practice-guide-lyric') ?? []];
        for (const item of lyricItems) {
          const verseMatches = Number(item.dataset.guideVerse) === selectedVerse;
          const itemMeasure = Number(item.dataset.guideMeasure);
          const itemEnd = Number(item.dataset.guideEndBeat);
          const past = verseMatches && measureIndex !== null && (itemMeasure < measureIndex || (itemMeasure === measureIndex && itemEnd <= currentBeat + 0.000001));
          item.classList.toggle('is-past', past);
          item.classList.toggle('is-current', verseMatches && isCurrentBeat(item));
          item.classList.toggle('is-next', verseMatches && !past && !isCurrentBeat(item));
        }
        for (const item of practiceGuidePanel?.querySelectorAll?.('.practice-guide-compact-lyric') ?? []) {
          const verseMatches = Number(item.dataset.guideVerse) === selectedVerse;
          const occurrenceMatches = matchesCompactOccurrence(item);
          const start = Number(item.dataset.guideStartBeat);
          const end = Number(item.dataset.guideEndBeat);
          const current = occurrenceMatches && verseMatches && currentBeat >= start - 0.000001 && currentBeat < end - 0.000001;
          item.classList.toggle('is-current', current);
          item.classList.toggle('is-past', occurrenceMatches && verseMatches && end <= currentBeat + 0.000001);
          const card = item.closest('.practice-guide-compact-measure');
          if (card) card.classList.toggle('is-current', Number(card.dataset.guideOccurrenceIndex) === Number(currentOccurrenceId));
        }
        for (const card of practiceGuidePanel?.querySelectorAll?.('.practice-guide-compact-measure') ?? []) {
          card.classList.toggle('is-current', Number(card.dataset.guideOccurrenceIndex) === Number(currentOccurrenceId));
        }
        const techniqueMarkers = [...practiceGuidePanel?.querySelectorAll?.('.practice-guide-technique-marker, .practice-guide-compact-symbol') ?? []];
        const visibleTechniqueMarkers = techniqueMarkers.filter(item => item.getClientRects().length > 0);
        const techniqueSlotBeats = 4 / (Number.isFinite(selectedGrid) && selectedGrid > 0 ? selectedGrid : 4);
        const currentDetailedTechnique = visibleTechniqueMarkers.find(item => {
          if (!item.classList.contains('practice-guide-technique-marker')) return false;
          const start = Number(item.dataset.guideSlotStart);
          const end = Math.min(Number(item.dataset.guideEventEnd), start + techniqueSlotBeats);
          return measureIndex !== null && Number(item.dataset.guideMeasure) === measureIndex && currentBeat >= start - 0.000001 && currentBeat < end - 0.000001;
        });
        const activeCompactEvent = visibleTechniqueMarkers.find(item => {
          if (!item.classList.contains('practice-guide-compact-symbol')) return false;
          const start = Number(item.dataset.guideEventStart);
          const end = Number(item.dataset.guideEventEnd);
          return matchesCompactOccurrence(item) && measureIndex !== null && Number(item.dataset.guideMeasure) === measureIndex && currentBeat >= start - 0.000001 && currentBeat < end - 0.000001;
        });
        const activeCompactEventKey = activeCompactEvent?.dataset.guideTechniqueEventKey;
        const activeCompactContinuation = activeCompactEvent && activeCompactEventKey
          && currentBeat > Number(activeCompactEvent.dataset.guideEventStart) + 0.000001
          ? visibleTechniqueMarkers.find(item => item.classList.contains('practice-guide-compact-symbol')
            && item.dataset.guideTechniqueEventKey === activeCompactEventKey
            && item.dataset.guideKind === 'continuation')
          : undefined;
        const currentCompactTechnique = activeCompactContinuation ?? activeCompactEvent;
        const currentTechniqueKey = currentDetailedTechnique?.dataset.guideTechniqueKey;
        const currentTechniqueEventKey = currentCompactTechnique?.dataset.guideTechniqueEventKey;
        const currentTechniqueEventKind = currentCompactTechnique?.dataset.guideKind;
        for (const item of techniqueMarkers) {
          const start = Number(item.dataset.guideSlotStart);
          const slotEnd = Math.min(Number(item.dataset.guideEventEnd), start + techniqueSlotBeats);
          const itemMeasure = Number(item.dataset.guideMeasure);
          const isCompactTechnique = item.classList.contains('practice-guide-compact-symbol');
          const past = isCompactTechnique
            ? matchesCompactOccurrence(item) && slotEnd <= currentBeat + 0.000001
            : measureIndex !== null && (itemMeasure < measureIndex || (itemMeasure === measureIndex && slotEnd <= currentBeat + 0.000001));
          item.classList.toggle('is-past', past);
          const current = isCompactTechnique
            ? matchesCompactOccurrence(item) && Boolean(currentTechniqueEventKey) && item.dataset.guideTechniqueEventKey === currentTechniqueEventKey && item.dataset.guideKind === currentTechniqueEventKind
            : Boolean(currentTechniqueKey) && item.dataset.guideTechniqueKey === currentTechniqueKey;
          item.classList.toggle('is-current', current);
          item.classList.toggle('is-next', !past && !current);
        }
        let currentChord = guideMeasure?.chords?.filter(chord => chord.beat <= currentBeat + 0.000001).slice(-1)[0] ?? null;
        if (!currentChord && measureIndex !== null) {
          for (let previousIndex = measureIndex - 1; previousIndex >= 0 && !currentChord; previousIndex--) {
            currentChord = playbackData.practiceGuide?.measures?.[previousIndex]?.chords?.slice(-1)[0] ?? null;
          }
        }
        for (const item of practiceGuideTimeline?.querySelectorAll?.('.practice-guide-chord-name, .practice-guide-diagram-event') ?? []) {
          const current = measureIndex !== null && Number(item.dataset.guideMeasure) === measureIndex && item.dataset.guideChord === currentChord?.name;
          item.classList.toggle('is-current', current);
        }
        for (const item of practiceGuidePanel?.querySelectorAll?.('.practice-guide-compact-chord-name, .practice-guide-compact-diagram-event') ?? []) {
          const start = Number(item.dataset.guideStartBeat);
          const end = Number(item.dataset.guideEndBeat);
          const current = matchesCompactOccurrence(item) && measureIndex !== null
            && Number(item.dataset.guideMeasure) === measureIndex && item.dataset.guideChord === currentChord?.name
            && currentBeat >= start - 0.000001 && currentBeat < end - 0.000001;
          item.classList.toggle('is-current', current);
        }
        for (const item of practiceGuideTimeline?.querySelectorAll?.('.practice-guide-measure-boundary') ?? []) {
          item.classList.toggle('is-current', Number(item.dataset.guideMeasureBoundary) === measureIndex);
        }
        for (const item of practiceGuideTimeline?.querySelectorAll?.('.practice-guide-measure-number') ?? []) {
          item.classList.toggle('is-current', Number(item.dataset.guideMeasureNumber) === measureIndex);
        }
        if (practiceEnabled && followEnabled && practiceGuideScroll && practiceGuidePlayhead && !practiceGuidePlayhead.hidden) {
          const left = practiceGuideScroll.scrollLeft;
          const right = left + practiceGuideScroll.clientWidth;
          const margin = Math.min(28, Math.max(12, practiceGuideScroll.clientWidth * 0.12));
          if (currentX < left + margin || currentX > right - margin) {
            practiceGuideScroll.scrollLeft = Math.max(0, currentX - practiceGuideScroll.clientWidth * 0.35);
          }
        }
        currentGuideMeasureIndex = measureIndex;
        lastPracticeGuideTime = shownTime;
      }

      function updatePracticeUi() {
        body.classList.toggle('has-practice-row', practiceEnabled);
        updatePracticeGuideUi();
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

      function cancelScheduledNodes(category, atTime, fadeSeconds) {
        const currentTime = audioContext ? audioContext.currentTime : 0;
        const now = Number.isFinite(atTime) ? Math.max(currentTime, atTime) : currentTime;
        const fade = Number.isFinite(fadeSeconds) ? Math.max(0, Math.min(0.008, fadeSeconds)) : 0.008;
        for (const entry of Array.from(activeNodes)) {
          if (category && entry.category !== category) continue;
          if (entry.cancelAt !== undefined) continue;
          const currentGain = gainAtTime(entry, now);
          const fadeEnd = entry.when >= now || currentGain <= 0 ? now : Math.min(now + fade, entry.endTime);
          entry.cancelAt = fadeEnd;
          try {
            if (fadeEnd > now) {
              entry.gain.gain.cancelScheduledValues(now);
              entry.gain.gain.setValueAtTime(currentGain, now);
              entry.gain.gain.linearRampToValueAtTime(0, fadeEnd);
            }
            entry.source.stop(fadeEnd);
          } catch (_) {
            try { entry.source.stop(now); } catch (_) {}
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

      function scheduleTone(ctx, when, duration, frequency, waveform, volume, category, releaseTailSeconds = 0, endTimeLimit = Number.POSITIVE_INFINITY) {
        if (duration <= 0 || when < ctx.currentTime - 0.005) return;
        const oscillator = ctx.createOscillator();
        const gain = ctx.createGain();
        oscillator.type = waveform;
        oscillator.frequency.setValueAtTime(frequency, when);
        const attack = Math.min(0.008, duration / 3);
        const release = Math.min(0.04, duration / 3);
        const releaseTail = Math.min(0.12, Math.max(0, Number(releaseTailSeconds) || 0));
        const endTime = Math.min(when + duration + releaseTail, endTimeLimit);
        const releaseStart = Math.max(when + attack, endTime - release);
        gain.gain.setValueAtTime(0, when);
        gain.gain.linearRampToValueAtTime(volume, when + attack);
        gain.gain.setValueAtTime(volume, releaseStart);
        gain.gain.linearRampToValueAtTime(0, endTime);
        oscillator.connect(gain);
        gain.connect(masterGain);
        const entry = {
          source: oscillator,
          oscillator,
          gain,
          category,
          when,
          volume,
          attackEnd: when + attack,
          releaseStart,
          endTime,
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
          oscillator.stop(Math.min(endTime + 0.002, endTimeLimit));
        } catch (_) {
          activeNodes.delete(entry);
          try { oscillator.stop(ctx.currentTime); } catch (_) {}
          try { oscillator.disconnect(); } catch (_) {}
          try { gain.disconnect(); } catch (_) {}
        }
      }

      function scheduleBrush(ctx, when, duration, endTimeLimit = Number.POSITIVE_INFINITY) {
        if (duration <= 0 || when < ctx.currentTime - 0.005) return;
        const endTime = Math.min(when + duration, endTimeLimit);
        duration = endTime - when;
        if (duration <= 0) return;
        if (!brushBuffer || brushBuffer.sampleRate !== ctx.sampleRate) {
          const sampleCount = Math.max(1, Math.floor(ctx.sampleRate * 0.05));
          brushBuffer = ctx.createBuffer(1, sampleCount, ctx.sampleRate);
          const channel = brushBuffer.getChannelData(0);
          for (let index = 0; index < channel.length; index++) channel[index] = Math.random() * 2 - 1;
        }
        const source = ctx.createBufferSource();
        const gain = ctx.createGain();
        source.buffer = brushBuffer;
        const attack = Math.min(0.003, duration / 3);
        const release = Math.min(0.025, duration / 2);
        const releaseStart = Math.max(when + attack, endTime - release);
        gain.gain.setValueAtTime(0, when);
        gain.gain.linearRampToValueAtTime(0.14, when + attack);
        gain.gain.setValueAtTime(0.14, releaseStart);
        gain.gain.linearRampToValueAtTime(0, endTime);
        source.connect(gain);
        gain.connect(masterGain);
        const entry = {
          source,
          gain,
          category: 'rhythm',
          when,
          volume: 0.14,
          attackEnd: when + attack,
          releaseStart,
          endTime,
          cancelAt: undefined
        };
        activeNodes.add(entry);
        source.onended = () => {
          activeNodes.delete(entry);
          try { source.disconnect(); } catch (_) {}
          try { gain.disconnect(); } catch (_) {}
        };
        try {
          source.start(when);
          source.stop(Math.min(endTime + 0.002, endTimeLimit));
        } catch (_) {
          activeNodes.delete(entry);
          try { source.stop(ctx.currentTime); } catch (_) {}
          try { source.disconnect(); } catch (_) {}
          try { gain.disconnect(); } catch (_) {}
        }
      }

      function schedulePlaybackEvent(ctx, event, when, speed) {
        if (event.kind === 'rhythmMute') {
          cancelScheduledNodes('rhythm', when, 0.008);
          return;
        }
        const endTimeLimit = loopRange
          ? when + Math.max(0, loopRange.endSeconds - event.timeSeconds) / speed
          : Number.POSITIVE_INFINITY;
        if (event.kind === 'rhythmBrush') {
          let duration = Math.min(0.04, Math.max(0.012, Number(event.durationSeconds) || 0.03));
          if (loopRange) duration = Math.min(duration, Math.max(0, loopRange.endSeconds - event.timeSeconds));
          scheduleBrush(ctx, when, duration / speed, endTimeLimit);
          return;
        }
        if (event.kind === 'metronome') {
          if (metronomeEnabled) {
            let duration = 0.03;
            if (loopRange) duration = Math.min(duration, Math.max(0, loopRange.endSeconds - event.timeSeconds));
            scheduleTone(ctx, when, duration / speed, event.accent ? 1000 : 700, 'sine', 0.25, 'metronome', 0, endTimeLimit);
          }
          return;
        }
        if (event.kind === 'rest' || !Array.isArray(event.midiNotes) || event.midiNotes.length === 0) return;
        let duration = Math.max(0, Number(event.durationSeconds) || 0);
        if (loopRange) duration = Math.min(duration, Math.max(0, loopRange.endSeconds - event.timeSeconds));
        duration /= speed;
        if (duration <= 0) return;
        const isChord = event.kind === 'rhythmAttack';
        const category = isChord || event.source === 'inline' ? 'rhythm' : 'melody';
        const voiceGain = (isChord ? 0.34 : 0.24) / event.midiNotes.length;
        for (const midi of event.midiNotes) {
          if (!Number.isFinite(midi)) continue;
          const frequency = 440 * Math.pow(2, (midi - 69) / 12);
          const releaseTail = isChord || event.source === 'inline' ? event.releaseTailSeconds : 0;
          scheduleTone(ctx, when, duration, frequency, isChord ? 'triangle' : 'sine', voiceGain, category, releaseTail, endTimeLimit);
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
        compactPageSeekPending = true;
        guideInstantReprojectPending = true;
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
        if (practiceGuideResizeObserver) practiceGuideResizeObserver.disconnect();
        practiceGuideResizeObserver = null;
        window.removeEventListener('resize', syncPracticeGuidePanelGeometry);
        cancelAllPracticeGuideFades(true);
        if (practiceGuideLayoutFrame) window.cancelAnimationFrame(practiceGuideLayoutFrame);
        practiceGuideLayoutFrame = 0;
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
        if (body.style && typeof body.style.removeProperty === 'function') {
          body.style.removeProperty('--practice-guide-panel-height');
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
      if (practiceGuideViewSelect) {
        practiceGuideViewSelect.addEventListener('change', () => {
          if (!['detailed', 'compact'].includes(practiceGuideViewSelect.value)) return;
          guideViewMode = practiceGuideViewSelect.value;
          guideInstantReprojectPending = true;
          cancelAllPracticeGuideFades(false);
          persistWebviewState();
          updatePracticeUi();
        });
      }
      if (practiceGuideCompactPrevious) practiceGuideCompactPrevious.addEventListener('click', () => {
        guideCompactStartOccurrence = clampCompactStart(guideCompactStartOccurrence - 2);
        guideCompactSnapPending = false;
        persistWebviewState();
        updatePracticeUi();
      });
      if (practiceGuideCompactNext) practiceGuideCompactNext.addEventListener('click', () => {
        guideCompactStartOccurrence = clampCompactStart(guideCompactStartOccurrence + 2);
        guideCompactSnapPending = false;
        persistWebviewState();
        updatePracticeUi();
      });
      if (practiceGuideGridSelect) {
        practiceGuideGridSelect.addEventListener('change', () => {
          if (!['auto', '4', '8', '16'].includes(practiceGuideGridSelect.value)) return;
          guideGrid = practiceGuideGridSelect.value;
          persistWebviewState();
          updatePracticeUi();
        });
      }
      if (practiceGuideDiagramsToggle) practiceGuideDiagramsToggle.addEventListener('click', () => {
        guideDiagramsVisible = !guideDiagramsVisible;
        persistWebviewState();
        updatePracticeUi();
      });
      if (practiceGuideMelodyToggle) practiceGuideMelodyToggle.addEventListener('click', () => {
        guideMelodyVisible = !guideMelodyVisible;
        persistWebviewState();
        updatePracticeUi();
      });
      if (practiceGuideCollapseToggle) practiceGuideCollapseToggle.addEventListener('click', () => {
        guideCollapsed = !guideCollapsed;
        persistWebviewState();
        updatePracticeUi();
      });
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
        if (message && message.command === 'previewEditModeChanged'
          && message.documentUri === previewIdentity.documentUri
          && message.documentVersion === previewIdentity.documentVersion
          && message.previewGeneration === previewIdentity.previewGeneration) {
          setPreviewEditMode(message.enabled === true);
          if (message.available === false) previewEditStatus.textContent = '${escapeXml(msgs.uiPreviewEditDisabled)}';
          syncPreviewEditTarget();
          return;
        }
        if (message && message.command === 'previewVisualEditResult'
          && message.documentUri === previewIdentity.documentUri
          && message.documentVersion === previewIdentity.documentVersion
          && message.previewGeneration === previewIdentity.previewGeneration) {
          if (message.success === true) previewEditStatus.textContent = '${escapeXml(msgs.uiPreviewEditApplied)}';
          else if (message.reason === 'staleSource' || message.reason === 'staleContext') previewEditStatus.textContent = '${escapeXml(msgs.uiPreviewEditStale)}';
          else if (message.reason === 'unsupportedTarget') {
            previewEditStatus.textContent = '${escapeXml(msgs.uiPreviewEditReadOnly)}';
            previewEditOpenSource.hidden = false;
          } else if (message.reason === 'stopFailed') previewEditStatus.textContent = '${escapeXml(msgs.uiPreviewEditStopFailed)}';
          else previewEditStatus.textContent = '${escapeXml(msgs.uiPreviewEditFailed)}';
          return;
        }
        if (message && message.command === 'previewEditStopRequest' && typeof message.requestId === 'string') {
          const identity = {
            documentUri: body.dataset.previewDocumentUri || '',
            documentVersion: Number(body.dataset.previewDocumentVersion),
            previewGeneration: Number(body.dataset.previewGeneration)
          };
          const matches = message.documentUri === identity.documentUri
            && message.documentVersion === identity.documentVersion
            && message.previewGeneration === identity.previewGeneration;
          let stopped = false;
          if (matches && !progressionAudioLeaseId) {
            try { performPlaybackAction('stop'); stopped = true; } catch (_) { stopped = false; }
          }
          if (vscode) vscode.postMessage({ command: 'previewEditStopAcknowledged', requestId: message.requestId, stopped, ...identity });
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
        if (!item || !item.button || !item.panel || item.panel.hidden
          || (item.panel.dataset.inline === 'true' && item.panel.dataset.detailsOpen !== 'true')) return;
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
        if (!item || !item.panel || item.panel.hidden) return;
        const inlineDetails = item.panel.dataset.inline === 'true' && item.panel.dataset.detailsOpen === 'true';
        if (item.panel.dataset.inline === 'true' && !inlineDetails) return;
        const focusTarget = item.button;
        if (inlineDetails) {
          item.panel.dataset.detailsOpen = 'false';
          item.panel.setAttribute('role', 'group');
          item.panel.setAttribute('aria-label', item.groupLabel);
          const closeButton = item.panel.querySelector('.score-settings-details-close');
          if (closeButton) closeButton.hidden = true;
          item.buttons.forEach(button => {
            button.setAttribute('aria-expanded', 'false');
            button.setAttribute('aria-controls', item.panel.id);
          });
          item.button = item.buttons.find(button => button !== item.detailsButton) || item.button;
          if (returnFocus && focusTarget) focusTarget.focus();
          return;
        }
        item.panel.hidden = true;
        item.buttons.forEach(button => {
          button.setAttribute('aria-expanded', 'false');
          button.setAttribute('aria-controls', item.panel.id);
        });
        if (returnFocus && focusTarget) focusTarget.focus();
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
            const isDetails = item.detailsButton === button;
            const alreadyActive = isDetails
              ? item.panel.dataset.detailsOpen === 'true'
              : !item.panel.hidden && item.button === button;
            disclosureItems.forEach(other => { if (other !== item) closeDisclosure(other, false); });
            if (alreadyActive) {
              closeDisclosure(item, false);
              return;
            }
            item.panel.hidden = false;
            if (item.detailsButton) {
              item.panel.dataset.detailsOpen = String(isDetails);
              item.panel.setAttribute('role', isDetails ? 'region' : 'group');
              item.panel.setAttribute('aria-label', isDetails ? item.detailsLabel : item.groupLabel);
              const closeButton = item.panel.querySelector('.score-settings-details-close');
              if (closeButton) closeButton.hidden = !isDetails;
            }
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
      const scoreSettingsDisclosureItem = disclosureItems.find(item => item.panel === temporarySettingsPanel);
      if (scoreSettingsDetailsClose && scoreSettingsDisclosureItem) {
        scoreSettingsDetailsClose.addEventListener('click', () => closeDisclosure(scoreSettingsDisclosureItem, true));
      }
      [temporarySettingsToggle, scoreSettingsDetailsToggle].filter(Boolean).forEach(button => {
        button.addEventListener('keydown', event => {
          if (event.repeat || (event.key !== 'Enter' && event.key !== ' ')) return;
          event.preventDefault();
          button.click();
        });
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
      document.body.dataset.previewInteractionsReady = 'true';
    })();
  </script>
</body>
</html>`;
}

function guidePitchText(pitch: { step: string; alter: number; octave: number }): string {
  return pitch.step.toUpperCase() + (pitch.alter < 0 ? '♭' : pitch.alter > 0 ? '♯' : '') + pitch.octave;
}

function renderPracticeStringDiagram(voicing: Parameters<typeof resolveBaseFret>[0]): string {
  const base = resolveBaseFret(voicing);
  const left = 18;
  const fretWidth = 21.6;
  const top = 18;
  const stringGap = 21.6;
  const right = left + fretWidth * 5;
  const bottom = top + stringGap * 5;
  let content = '';
  for (let string = 1; string <= 6; string++) {
    const y = top + (string - 1) * stringGap;
    const fret = voicing.frets[6 - string];
    content += `<line x1="${left}" y1="${y}" x2="${right}" y2="${y}" stroke="#9aaec0" stroke-width="${string === 1 || string === 6 ? '1.35' : '1.1'}"/>`;
    if (fret === 'x') {
      content += `<path d="M5 ${y - 3}l6 6m0-6-6 6" fill="none" stroke="#556c82" stroke-width="1.8" stroke-linecap="round"/>`;
    } else if (fret === 0) {
      content += `<circle cx="8" cy="${y}" r="3" fill="none" stroke="#647e94" stroke-width="1.7"/>`;
    } else if (typeof fret === 'number' && fret >= base && fret < base + 5) {
      const x = left + (fret - base + 0.5) * fretWidth;
      content += `<circle cx="${x}" cy="${y}" r="4" fill="#121e2b"/>`;
    }
  }
  for (let fret = 0; fret <= 5; fret++) {
    const x = left + fret * fretWidth;
    content += `<line x1="${x}" y1="${top}" x2="${x}" y2="${bottom}" stroke="${fret === 0 && base === 1 ? '#5d7085' : '#b0bfce'}" stroke-width="${fret === 0 && base === 1 ? '2.25' : '1'}"/>`;
  }
  const label = base > 1 ? `<text x="${left}" y="140" font-size="10" fill="#556c82">${base}fr</text>` : '';
  return `<svg class="practice-guide-diagram" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 144 144" width="144" height="144" role="img" aria-label="${base} fret chord diagram">${content}${label}</svg>`;
}

const PRACTICE_GUIDE_PX_PER_BEAT = 80;

function practiceGuideTextWidth(text: string, fontSize: number): number {
  return Array.from(text).reduce((width, glyph) => width + (/[A-Z0-9]/i.test(glyph) ? fontSize * 0.62 : fontSize), 0);
}

function practiceGuidePixelsPerBeat(data: PracticeGuideData): number {
  let pixelsPerBeat = PRACTICE_GUIDE_PX_PER_BEAT;
  const lyrics = data.measures.flatMap(measure => measure.lyrics.map(lyric => ({
    start: fnum(measure.startBeat) + fnum(lyric.at),
    duration: fnum(lyric.durationBeats),
    text: lyric.text
  })));
  for (const lyric of lyrics) {
    if (lyric.duration > 0) pixelsPerBeat = Math.max(pixelsPerBeat, practiceGuideTextWidth(lyric.text, 24) / lyric.duration);
  }
  const chords = data.measures.flatMap(measure => measure.chords.map(chord => ({
    start: fnum(measure.startBeat) + chord.beat,
    name: chord.name,
    label: chord.label
  }))).sort((a, b) => a.start - b.start);
  for (let index = 1; index < chords.length; index++) {
    const previous = chords[index - 1];
    const current = chords[index];
    const beatDistance = current.start - previous.start;
    if (beatDistance <= 0) continue;
    pixelsPerBeat = Math.max(pixelsPerBeat, 168 / beatDistance);
    const previousName = practiceGuideTextWidth(previous.label ? `${previous.name}@${previous.label}` : previous.name, 20);
    const currentName = practiceGuideTextWidth(current.label ? `${current.name}@${current.label}` : current.name, 20);
    pixelsPerBeat = Math.max(pixelsPerBeat, (previousName + currentName + 4) / (2 * beatDistance));
  }
  return Math.ceil(pixelsPerBeat);
}

function renderPracticeGuideRestSvg(base: number | undefined, label: string): string {
  const safeBase = base && base >= 1 && base <= 16 ? base : 4;
  const shape = safeBase === 1
    ? '<rect x="4" y="14" width="14" height="3" rx="0.5" fill="currentColor"/>'
    : safeBase === 2
      ? '<rect x="4" y="10" width="14" height="3" rx="0.5" fill="currentColor"/>'
      : safeBase === 4
        ? '<path d="M15 1 9 8 15 13 9 20 13 23 9 27" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>'
        : safeBase === 8
          ? '<circle cx="16.5" cy="4" r="2" fill="currentColor"/><path d="M12 5 C17 6 17 10 13 13 C9 16 10 19 13 21 C16 23 15 25 11 27" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>'
          : '<circle cx="16.5" cy="3.5" r="2" fill="currentColor"/><circle cx="16.5" cy="9.5" r="2" fill="currentColor"/><path d="M12 5 C17 6 17 10 13 13 C9 16 10 19 13 21 C16 23 15 25 11 27 M12 11 C17 12 17 16 14 18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>';
  return `<svg class="practice-guide-rest-symbol" data-guide-rest-base="${safeBase}" viewBox="0 0 24 28" role="img" aria-label="${escapeXml(label)}"><title>${escapeXml(label)}</title>${shape}</svg>`;
}

function buildPracticeGuideData(score: ParsedScore): PracticeGuideData {
  const automaticGrid = automaticPracticeGuideGrid(score);
  const automaticFill = !practiceGuideHasWrittenRhythm(score);
  const parsedCapo = Number(score.capo);
  const capo = Number.isInteger(parsedCapo) && parsedCapo >= 0 && parsedCapo <= MAX_CAPO ? parsedCapo : 0;
  const instrument = createInstrumentModel(score.tuning, capo);
  let totalBeats = frac(0);
  let maxLyricVerses = 1;
  const pitchMidiValues: number[] = [];
  const measures = score.measures.map((sourceMeasure, index): PracticeGuideMeasure => {
    const measure = sourceMeasure.isMeasureRepeat ? expandMeasureRepeat(sourceMeasure, score.measures) : sourceMeasure;
    const beats = measure.expectedBeats;
    const startBeat = totalBeats;
    const chords: PracticeGuideDiagram[] = [];
    for (const chord of measure.chords) {
      const key = chordKey(chord.name, chord.label);
      const resolved = resolveChordVoicing(key, score.chordDefinitions, instrument);
      chords.push({
        name: chord.name,
        ...(chord.label === undefined ? {} : { label: chord.label }),
        beat: chord.beat,
        ...(resolved ? { svg: renderPracticeStringDiagram(resolved.voicing) } : {})
      });
    }

    const techniques: PracticeGuideItem[] = [];
    const appendTechnique = (
      itemStart: ReturnType<typeof frac>,
      eventDuration: ReturnType<typeof frac>,
      durationLabel: string,
      label: string,
      kind: PracticeGuideItem['kind'],
      eventIndex: number,
      restBase: number | undefined,
      getContinuationOffsets: (grid: PracticeGuideGrid) => ReturnType<typeof practiceGuideContinuationOffsets>,
      durationWaveEligible: boolean,
      stroke?: PracticeGuideStrokeSpec
    ) => {
      const eventEnd = fadd(itemStart, eventDuration);
      techniques.push({ at: itemStart, durationBeats: eventDuration, eventStart: itemStart, eventEnd, label, duration: durationLabel, kind, eventIndex, durationWaveEligible, ...(restBase === undefined ? {} : { restBase }), ...(stroke ? { stroke } : {}) });
      for (const grid of [4, 8, 16] as const) {
        for (const offset of getContinuationOffsets(grid)) {
          const continuationBeat = fadd(itemStart, offset);
          if (beats.n > 0 && fcmp(continuationBeat, beats) >= 0) continue;
          techniques.push({ at: continuationBeat, durationBeats: frac(0), eventStart: itemStart, eventEnd, label: '〜', duration: '', kind: 'continuation', grid, eventIndex, durationWaveEligible: false });
        }
      }
    };

    let sourceRhythmOrigin = sourceMeasure.rhythmOrigin;
    if (sourceMeasure.rhythmOrigin === 'repeat') {
      let sourceIndex = index - 1;
      while (sourceIndex >= 0 && score.measures[sourceIndex].isMeasureRepeat) sourceIndex--;
      if (sourceIndex >= 0) sourceRhythmOrigin = score.measures[sourceIndex].rhythmOrigin;
    }
    const tabVoices = measure.tabVoices ?? sourceMeasure.tabVoices;
    const useTabEvents = sourceRhythmOrigin !== 'explicit' && Boolean(tabVoices?.length);
    if (useTabEvents) {
      for (const [eventIndex, event] of practiceGuideTabEvents(tabVoices ?? []).entries()) {
        appendTechnique(
          event.at,
          event.duration.beats,
          event.durationLabel,
          event.label,
          event.kind,
          eventIndex,
          event.kind === 'rest' ? event.duration.parts[0]?.base : undefined,
          grid => practiceGuideValueContinuationOffsets(event.duration, grid, { isRest: event.kind === 'rest', percussive: event.percussive }),
          event.kind === 'attack' && !event.percussive,
          event.kind === 'rest' ? undefined : event.kind === 'continuation'
            ? { kind: 'tie', label: event.label }
            : event.percussive
              ? { kind: 'brush', direction: 'down', label: event.label }
              : { kind: 'string', stringNumber: Number(event.label.match(/[1-6]/)?.[0] ?? 1), label: event.label }
        );
      }
    } else {
      let beat = frac(0);
      for (const [eventIndex, item] of measure.rhythms.entries()) {
        const duration = parseRhythmDuration(item.duration);
        const itemBeats = duration?.beats ?? frac(0);
        const kind = item.mute ? 'mute' : item.isRest ? 'rest' : item.tiedFromPrev ? 'continuation' : 'attack';
        appendTechnique(
          beat,
          itemBeats,
          item.duration,
          practiceGuideRhythmLabel(item),
          kind,
          eventIndex,
          item.isRest ? duration?.parts[0]?.base : undefined,
          grid => practiceGuideContinuationOffsets(item, grid),
          kind === 'attack' && !item.mute && !item.isRest && !item.ghost && !item.invalidTechnique && !item.techniques?.staccato,
          item.mute
            ? { kind: 'mute', label: item.duration + ' mute' }
            : item.isRest
              ? undefined
              : item.tiedFromPrev
                ? { kind: 'tie', label: item.duration }
                : item.ghostModifier === 'b' || item.ghostModifier === 'g'
                  ? { kind: 'brush', direction: item.up ? 'up' : 'down', label: item.duration }
                  : item.stringAttack !== undefined
                    ? { kind: 'string', stringNumber: item.stringAttack, label: `${item.stringAttack}弦` }
                    : {
                      kind: 'attack',
                      direction: item.down && item.up ? 'both' : item.down ? 'down' : item.up ? 'up' : item.techniques?.palmMute ? 'down' : 'neutral',
                      palmMute: item.techniques?.palmMute,
                      label: item.techniques?.palmMute ? `PM ${item.duration}` : item.duration
                    }
        );
        beat = fadd(beat, itemBeats);
      }
    }

    let beat = frac(0);
    const melody: PracticeGuideMelodyNote[] = [];
    const lyrics: PracticeGuideLyric[] = [];
    const lastLyricByVerse = new Map<number, number>();
    for (const [eventIndex, note] of (measure.melody ?? []).entries()) {
      const pitches = note.isRest
        ? []
        : note.pitch
          ? [{ label: guidePitchText(note.pitch), midi: pitchToMidi(note.pitch) }]
          : (note.pitches ?? []).map(pitch => ({ label: guidePitchText(pitch), midi: pitchToMidi(pitch) }));
      for (const pitch of pitches) pitchMidiValues.push(pitch.midi);
      const duration = note.parts.map(formatNoteValuePart).join('+');
      melody.push({ at: beat, durationBeats: note.beats, duration, label: note.isRest ? 'rest' : pitches.map(pitch => pitch.label).join(' '), pitches, isRest: note.isRest, eventIndex, ...(note.isRest ? { restBase: note.parts[0]?.base } : {}) });
      for (const [verse, syllable] of note.syllables.entries()) {
        maxLyricVerses = Math.max(maxLyricVerses, verse + 1);
        const previousIndex = lastLyricByVerse.get(verse);
        if ((syllable?.extend || (!syllable && note.tiedFromPrev)) && previousIndex !== undefined) {
          const previous = lyrics[previousIndex];
          previous.durationBeats = fadd(previous.durationBeats, note.beats);
          continue;
        }
        if (!syllable?.text) continue;
        lyrics.push({ at: beat, durationBeats: note.beats, text: syllable.text, verse, eventIndex, hyphenToNext: syllable.hyphenToNext });
        lastLyricByVerse.set(verse, lyrics.length - 1);
      }
      beat = fadd(beat, note.beats);
    }
    if (!lyrics.length && measure.lyric.trim()) {
      lyrics.push({ at: frac(0), durationBeats: beats, text: measure.lyric.trim(), verse: 0, eventIndex: -1, hyphenToNext: false });
    }
    totalBeats = fadd(totalBeats, beats);
    return { number: index + 1, startBeat, beats, chords, melody, lyrics, techniques };
  });
  const lyricRows = Math.max(1, maxLyricVerses);
  const lyricsHeight = Math.max(38, lyricRows * 18 + 8);
  const pitchMinMidi = pitchMidiValues.length ? Math.min(...pitchMidiValues) : 60;
  const pitchMaxMidi = pitchMidiValues.length ? Math.max(...pitchMidiValues) : 72;
  const initialNextChord = measures[0]?.chords[1] ?? measures.slice(1).find(measure => measure.chords.length > 0)?.chords[0];
  return { automaticGrid, automaticFill, totalBeats, lyricsHeight, pitchMinMidi, pitchMaxMidi, measures, ...(initialNextChord ? { initialNextChord } : {}) };
}

export function renderPracticeGuidePanel(data: PracticeGuideData, msgs: Messages, occurrences: readonly PlaybackHtmlOccurrence[]): string {
  const pixelsPerBeat = practiceGuidePixelsPerBeat(data);
  const totalWidth = Math.max(pixelsPerBeat, fnum(data.totalBeats) * pixelsPerBeat);
  const guideX = (measure: PracticeGuideMeasure, localBeat: ReturnType<typeof frac>): number =>
    (fnum(measure.startBeat) + fnum(localBeat)) * pixelsPerBeat;
  const align = (x: number, inset = 18): 'start' | 'center' | 'end' => x < inset ? 'start' : x > totalWidth - inset ? 'end' : 'center';
  const boundaryMarks = (): string => data.measures.map(measure => {
    const left = fnum(measure.startBeat) * pixelsPerBeat;
    return `<span class="practice-guide-measure-boundary" data-guide-measure-boundary="${measure.number - 1}" style="left:${left.toFixed(3)}px"></span>`;
  }).join('') + `<span class="practice-guide-measure-boundary" data-guide-measure-boundary="end" style="left:${totalWidth.toFixed(3)}px"></span>`;
  const numbers = data.measures.map(measure => {
    const left = fnum(measure.startBeat) * pixelsPerBeat;
    return `<span class="practice-guide-measure-number" data-guide-measure-number="${measure.number - 1}" style="left:${left.toFixed(3)}px">${measure.number}</span>`;
  }).join('');
  const labelRail = `<div class="practice-guide-label-rail-shell"><div class="practice-guide-label-rail">
    <div class="practice-guide-label" data-guide-lane="ruler">${escapeXml(msgs.uiPracticeMeasure)}</div>
    <div class="practice-guide-label" data-guide-lane="melody" aria-label="${escapeXml(msgs.uiPracticeGuideMelodyRow)}"><span class="practice-guide-label-full" aria-hidden="true">${escapeXml(msgs.uiPracticeGuideMelodyRow)}</span><span class="practice-guide-label-short" aria-hidden="true">${escapeXml(msgs.uiPracticeGuideMelodyShort)}</span><span class="practice-guide-pitch-range"><span>↑ ${escapeXml(msgs.uiPracticeGuidePitchHigh)}</span><span>↓ ${escapeXml(msgs.uiPracticeGuidePitchLow)}</span></span></div>
    <div class="practice-guide-label" data-guide-lane="lyrics" style="height:${data.lyricsHeight}px">${escapeXml(msgs.uiPracticeGuideLyrics)}</div>
    <div class="practice-guide-label" data-guide-lane="technique" aria-label="${escapeXml(msgs.uiPracticeGuideTechnique)}"><span class="practice-guide-label-full" aria-hidden="true">${escapeXml(msgs.uiPracticeGuideTechnique)}</span><span class="practice-guide-label-short" aria-hidden="true">${escapeXml(msgs.uiPracticeGuideTechniqueShort)}</span></div>
    <div class="practice-guide-label" data-guide-lane="chord">${escapeXml(msgs.uiPracticeGuideChord)}</div>
    <div class="practice-guide-label" data-guide-lane="diagrams">${escapeXml(msgs.uiPracticeGuideDiagrams)}</div>
  </div></div>`;
  const melodyItems = data.measures.flatMap(measure => measure.melody.map(item => {
      const left = guideX(measure, item.at);
      const width = Math.max(item.durationBeats.n === 0 ? 6 : 3, fnum(item.durationBeats) * pixelsPerBeat);
      const start = fnum(item.at);
      const end = start + fnum(item.durationBeats);
      if (item.isRest) {
        const label = `${msgs.uiPracticeGuideRest} ${item.duration}`;
        return `<span class="practice-guide-melody-rest" data-guide-measure="${measure.number - 1}" data-guide-event="${item.eventIndex}" data-guide-start-beat="${start}" data-guide-end-beat="${end}" data-guide-align="${align(left)}" title="${escapeXml(label)}" style="left:${left.toFixed(3)}px">${renderPracticeGuideRestSvg(item.restBase, label)}</span>`;
      }
      const range = Math.max(1, data.pitchMaxMidi - data.pitchMinMidi);
      return item.pitches.map(pitch => {
        const top = 8 + (data.pitchMaxMidi - pitch.midi) / range * 40;
        const label = `${pitch.label} ${item.duration}`;
        return `<span class="practice-guide-pitch-bar" data-guide-measure="${measure.number - 1}" data-guide-event="${item.eventIndex}" data-guide-start-beat="${start}" data-guide-end-beat="${end}" data-guide-pitch-midi="${pitch.midi}" data-guide-pitch-label="${escapeXml(pitch.label)}" title="${escapeXml(label)}" aria-label="${escapeXml(label)}" style="left:${left.toFixed(3)}px;top:${top.toFixed(3)}px;width:${width.toFixed(3)}px"></span>`;
      }).join('');
    }));
  const lyricItems = data.measures.flatMap(measure => measure.lyrics.map(item => {
      const left = guideX(measure, item.at);
      const width = Math.max(18, fnum(item.durationBeats) * pixelsPerBeat);
      const text = item.text + (item.hyphenToNext ? '-' : '');
      const top = 4 + item.verse * 32;
      const start = fnum(item.at);
      const end = start + fnum(item.durationBeats);
      return `<span class="practice-guide-lyric" data-guide-measure="${measure.number - 1}" data-guide-event="${item.eventIndex}" data-guide-verse="${item.verse + 1}" data-guide-start-beat="${start}" data-guide-end-beat="${end}" title="${escapeXml(text)}" style="left:${left.toFixed(3)}px;top:${top}px;width:${width.toFixed(3)}px">${escapeXml(text)}</span>`;
    }));
  const techniqueEntries = data.measures.flatMap(measure => measure.techniques.map(item => {
    const key = `${measure.number - 1}:${item.eventIndex ?? -1}:${fnum(item.at)}:${item.kind ?? ''}`;
    const beat = fnum(measure.startBeat) + fnum(item.at);
    const width = item.kind === 'rest' ? 24 : Math.max(14, practiceGuideTextWidth(item.label, 14));
    return { measure, item, key, beat, width };
  }));
  const techniqueGroups = new Map<string, { beat: number; width: number }>();
  for (const entry of techniqueEntries) {
    const existing = techniqueGroups.get(entry.key);
    techniqueGroups.set(entry.key, { beat: entry.beat, width: Math.max(existing?.width ?? 0, entry.width) });
  }
  const techniqueRowByKey = new Map<string, number>();
  const techniqueRowRightEdges: number[] = [];
  for (const [key, group] of [...techniqueGroups.entries()].sort((a, b) => a[1].beat - b[1].beat)) {
    const center = group.beat * pixelsPerBeat;
    const itemAlign = center < 18 ? 'start' : center > totalWidth - 18 ? 'end' : 'center';
    const left = itemAlign === 'start' ? center : itemAlign === 'end' ? center - group.width : center - group.width / 2;
    let row = techniqueRowRightEdges.findIndex(right => right <= left + 1);
    if (row < 0) row = techniqueRowRightEdges.length;
    techniqueRowRightEdges[row] = left + group.width;
    techniqueRowByKey.set(key, row);
  }
  const techniqueHeight = Math.max(48, techniqueRowRightEdges.length * 24 + 2);
  const techniqueItems = techniqueEntries.map(({ measure, item, key }) => {
      const left = guideX(measure, item.at);
      const isContinuation = item.grid !== undefined;
      const classes = `practice-guide-technique-marker${isContinuation ? ' practice-guide-grid-continuation' : ''}`;
      const grid = item.grid === undefined ? '' : ` data-guide-grid="${item.grid}"`;
      const kind = item.kind === undefined ? '' : ` data-guide-kind="${item.kind}"`;
      const eventIndex = item.eventIndex === undefined ? '' : ` data-guide-event="${item.eventIndex}"`;
      const eventStart = fnum(item.eventStart);
      const eventEnd = fnum(item.eventEnd);
      const ariaLabel = item.kind === 'rest' ? `${msgs.uiPracticeGuideRest} ${item.duration}` : item.label;
      const techniqueKey = `${measure.number - 1}:${item.eventIndex ?? -1}:${fnum(item.at)}:${item.label}:${item.grid ?? 'attack'}`;
      const label = item.kind === 'rest'
        ? renderPracticeGuideRestSvg(item.restBase, ariaLabel)
        : item.stroke
          ? renderPracticeGuideStrokeSvg(item.stroke)
          : item.kind === 'continuation'
            ? renderPracticeGuideWaveSvg(ariaLabel, 18)
            : renderPracticeGuideStrokeSvg({ kind: 'attack', direction: 'neutral', label: ariaLabel });
      const rowTop = (techniqueRowByKey.get(key) ?? 0) * 24 + 1;
      return `<span class="${classes}" data-guide-measure="${measure.number - 1}" data-guide-technique-key="${escapeXml(techniqueKey)}" data-guide-align="${align(left)}"${grid}${kind}${eventIndex} data-guide-event-start="${eventStart}" data-guide-event-end="${eventEnd}" data-guide-at-beat="${fnum(item.at)}" data-guide-slot-start="${fnum(item.at)}" style="left:${left.toFixed(3)}px;top:${rowTop}px" title="${escapeXml(item.duration || ariaLabel)}" aria-label="${escapeXml(ariaLabel)}">${label}</span>`;
    });
  const chordSpans = (measure: PracticeGuideMeasure): { chord: PracticeGuideDiagram; start: number; end: number }[] => {
    const chords = [...measure.chords].sort((a, b) => a.beat - b.beat);
    const measureEnd = fnum(measure.beats);
    return chords.map((chord, index) => ({
      chord,
      start: chord.beat,
      end: chords[index + 1]?.beat ?? measureEnd
    }));
  };
  const chordNames = data.measures.flatMap(measure => chordSpans(measure).map(({ chord, start, end }) => {
      const centerBeat = (start + end) / 2;
      const measureStartX = fnum(measure.startBeat) * pixelsPerBeat;
      const measureEndX = (fnum(measure.startBeat) + fnum(measure.beats)) * pixelsPerBeat;
      const inset = Math.min(80, (measureEndX - measureStartX) / 2);
      const centerX = Math.max(measureStartX + inset, Math.min(measureEndX - inset, measureStartX + centerBeat * pixelsPerBeat));
      const label = chord.label ? `${chord.name}@${chord.label}` : chord.name;
      return `<span class="practice-guide-chord-name" data-guide-measure="${measure.number - 1}" data-guide-chord="${escapeXml(chord.name)}" data-guide-start-beat="${start}" data-guide-end-beat="${end}" data-guide-at-beat="${chord.beat}" data-guide-center-beat="${centerBeat}" data-guide-align="center" style="left:${centerX.toFixed(3)}px" title="${escapeXml(label)}">${escapeXml(label)}</span>`;
    }));
  const diagrams = data.measures.flatMap(measure => chordSpans(measure).map(({ chord, start, end }) => {
      const centerBeat = (start + end) / 2;
      const measureStartX = fnum(measure.startBeat) * pixelsPerBeat;
      const measureEndX = (fnum(measure.startBeat) + fnum(measure.beats)) * pixelsPerBeat;
      const inset = Math.min(80, (measureEndX - measureStartX) / 2);
      const centerX = Math.max(measureStartX + inset, Math.min(measureEndX - inset, measureStartX + centerBeat * pixelsPerBeat));
      const label = chord.label ? `${chord.name}@${chord.label}` : chord.name;
      const icon = chord.svg ?? `<span aria-label="${escapeXml(label)}">—</span>`;
      return `<span class="practice-guide-diagram-event" data-guide-measure="${measure.number - 1}" data-guide-chord="${escapeXml(chord.name)}" data-guide-diagram-chord="${escapeXml(chord.name)}" data-guide-start-beat="${start}" data-guide-end-beat="${end}" data-guide-at-beat="${chord.beat}" data-guide-center-beat="${centerBeat}" data-guide-align="center" style="left:${centerX.toFixed(3)}px" title="${escapeXml(label)}">${icon}</span>`;
    }));
  const measureWidth = (items: { at: number; width: number }[], duration: number, minGap = 2): number => {
    if (!items.length) return 144;
    const ordered = [...items].sort((a, b) => a.at - b.at).reduce<{ at: number; width: number }[]>((groups, item) => {
      const previous = groups[groups.length - 1];
      if (previous && Math.abs(previous.at - item.at) < 0.000001) previous.width = Math.max(previous.width, item.width);
      else groups.push({ ...item });
      return groups;
    }, []);
    let required = 144;
    for (let index = 0; index < ordered.length; index++) {
      const item = ordered[index];
      if (item.at <= 0.000001 || item.at >= duration - 0.000001) required = Math.max(required, item.width + 14);
      if (index === 0) continue;
      const previous = ordered[index - 1];
      const delta = item.at - previous.at;
      if (delta > 0) required = Math.max(required, (previous.width / 2 + item.width / 2 + minGap) * duration / delta);
    }
    return Math.ceil(required + 14);
  };
  const centeredMeasureWidth = (items: { at: number; width: number }[], duration: number, minGap = 2): number => {
    const edgeSafeWidth = items.reduce((required, item) => {
      const edgeDistance = Math.min(item.at, duration - item.at);
      return edgeDistance <= 0.000001
        ? Math.max(required, item.width + 14)
        : Math.max(required, (item.width + 14) * duration / (2 * edgeDistance));
    }, 144);
    return Math.ceil(Math.max(measureWidth(items, duration, minGap), edgeSafeWidth));
  };
  const leftAnchoredMeasureWidth = (items: { at: number; width: number }[], duration: number, minGap = 2): number => {
    if (!items.length) return 144;
    const ordered = [...items].sort((a, b) => a.at - b.at).reduce<{ at: number; width: number }[]>((groups, item) => {
      const previous = groups[groups.length - 1];
      if (previous && Math.abs(previous.at - item.at) < 0.000001) previous.width = Math.max(previous.width, item.width);
      else groups.push({ ...item });
      return groups;
    }, []);
    let required = 144;
    for (let index = 0; index < ordered.length; index++) {
      const item = ordered[index];
      const remainingBeats = Math.max(0, duration - item.at);
      if (remainingBeats <= 0.000001) {
        required = Math.max(required, item.width + 14);
      } else {
        // Lyrics start at their onset and keep their full visible width to the right.
        required = Math.max(required, Math.ceil((item.width + 8) * duration / remainingBeats) + 12);
      }
      if (index === 0) continue;
      const previous = ordered[index - 1];
      const delta = item.at - previous.at;
      if (delta > 0) required = Math.max(required, Math.ceil((previous.width + minGap) * duration / delta) + 12);
    }
    return Math.ceil(required);
  };
  const compactWaveGrids = (item: PracticeGuideItem, measure: PracticeGuideMeasure): (4 | 8 | 16)[] => {
    if (item.stroke?.kind === 'tie') return [];
    const base = Number(/^(?:r)?(\d+)/.exec(item.duration ?? '')?.[1]);
    return ([4, 8, 16] as const).filter(grid => {
      const durationAllowsWave = item.kind !== 'attack' || !Number.isFinite(base)
        || base === 4 || grid > base;
      const hasGridContinuation = measure.techniques.some(continuation => continuation.grid === grid
        && continuation.eventIndex === item.eventIndex && continuation.kind === 'continuation');
      const quarterAttackWave = item.kind === 'attack' && item.durationWaveEligible && base === 4;
      return durationAllowsWave && (hasGridContinuation || quarterAttackWave);
    });
  };
  const compactWaveWidth = (item: PracticeGuideItem, measure: PracticeGuideMeasure): number =>
    compactWaveGrids(item, measure).length > 0
      ? Math.max(24, Math.min(76, fnum(item.durationBeats) * 42))
      : 0;
  let carriedCompactChord: PracticeGuideDiagram | undefined;
  const compactTemplates: string[] = [];
  const compactMeasureWidths: number[] = [];
  const compactTechniqueHeights: number[] = [];
  for (const measure of data.measures) {
    const beatCount = Math.max(0.000001, fnum(measure.beats));
    const percent = (beat: number): number => Math.max(0, Math.min(100, beat / beatCount * 100));
    const sortedChords = [...measure.chords].sort((a, b) => a.beat - b.beat);
    const chordSpans: { chord?: PracticeGuideDiagram; start: number; end: number }[] = [];
    if (!sortedChords.length) chordSpans.push({ chord: carriedCompactChord, start: 0, end: beatCount });
    else {
      if (sortedChords[0].beat > 0) chordSpans.push({ chord: carriedCompactChord, start: 0, end: sortedChords[0].beat });
      for (let index = 0; index < sortedChords.length; index++) {
        chordSpans.push({ chord: sortedChords[index], start: sortedChords[index].beat, end: sortedChords[index + 1]?.beat ?? beatCount });
      }
      carriedCompactChord = sortedChords[sortedChords.length - 1];
    }
    const melody = measure.melody.flatMap(item => {
      const left = percent(fnum(item.at));
      const width = Math.max(0, percent(fnum(item.durationBeats)));
      const start = fnum(item.at);
      const end = fnum(fadd(item.at, item.durationBeats));
      if (item.isRest) {
        return [`<span class="practice-guide-compact-melody-rest" data-guide-measure="${measure.number - 1}" data-guide-event="${item.eventIndex}" data-guide-start-beat="${start}" data-guide-end-beat="${end}" style="left:${left}%" title="${escapeXml(`${msgs.uiPracticeGuideRest} ${item.duration}`)}">${renderPracticeGuideRestSvg(item.restBase, `${msgs.uiPracticeGuideRest} ${item.duration}`)}</span>`];
      }
      const range = Math.max(1, data.pitchMaxMidi - data.pitchMinMidi);
      return item.pitches.map((pitch, pitchIndex) => {
        const top = 12 + (data.pitchMaxMidi - pitch.midi) / range * 38 + pitchIndex * 2;
        return `<span class="practice-guide-compact-pitch-bar" data-guide-measure="${measure.number - 1}" data-guide-event="${item.eventIndex}" data-guide-pitch-midi="${pitch.midi}" data-guide-start-beat="${start}" data-guide-end-beat="${end}" style="left:${left}%;top:${top.toFixed(1)}px;width:${Math.max(0.6, width)}%" title="${escapeXml(`${pitch.label} ${item.duration}`)}" aria-label="${escapeXml(`${pitch.label} ${item.duration}`)}"></span>`;
      });
    }).join('');
    const lyrics = measure.lyrics.map(item => {
      const text = item.text + (item.hyphenToNext ? '-' : '');
      return `<span class="practice-guide-compact-lyric" data-guide-measure="${measure.number - 1}" data-guide-verse="${item.verse + 1}" data-guide-start-beat="${fnum(item.at)}" data-guide-end-beat="${fnum(fadd(item.at, item.durationBeats))}" style="left:${percent(fnum(item.at))}%" title="${escapeXml(text)}">${escapeXml(text)}</span>`;
    }).join('');
    const compactTechniqueEntries = measure.techniques.filter(item => item.grid === undefined).map(item => {
      const at = fnum(item.at);
      const rowKey = `${measure.number - 1}:${item.eventIndex ?? -1}:${at}:${item.kind ?? ''}`;
      const visualMarkWidth = item.kind === 'rest' ? 24
        : item.stroke ? practiceGuideStrokeVisualWidth(item.stroke)
          : practiceGuideStrokeVisualWidth({ kind: 'attack', direction: 'neutral', label: item.label });
      return { item, at, rowKey, width: visualMarkWidth + compactWaveWidth(item, measure) };
    });
    const chordSpanCenter = (span: { start: number; end: number }): number => (span.start + span.end) / 2;
    const melodyWidths = measure.melody.map(item => ({ at: fnum(item.at), width: item.isRest ? 28 : 3 }));
    const lyricWidths = measure.lyrics.map(item => ({ at: fnum(item.at), width: Math.max(18, practiceGuideTextWidth(item.text, 18)) }));
    const techniqueWidths = compactTechniqueEntries.map(({ at, width }) => ({ at, width }));
    const chordWidths = chordSpans.filter(span => span.chord).map(span => ({ at: chordSpanCenter(span), width: Math.max(36, practiceGuideTextWidth(span.chord!.name, 18)) }));
    const diagramWidths = chordSpans.filter(span => span.chord?.svg).map(span => ({ at: chordSpanCenter(span), width: 144 }));
    const minWidth = Math.max(
      leftAnchoredMeasureWidth(melodyWidths, beatCount), leftAnchoredMeasureWidth(lyricWidths, beatCount),
      leftAnchoredMeasureWidth(techniqueWidths, beatCount, 3), centeredMeasureWidth(chordWidths, beatCount),
      centeredMeasureWidth(diagramWidths, beatCount), 144
    );
    compactMeasureWidths.push(minWidth);
    const compactContentWidth = Math.max(0, minWidth - 12);
    const compactTechniqueGroups = new Map<string, { at: number; width: number }>();
    for (const entry of compactTechniqueEntries) {
      const existing = compactTechniqueGroups.get(entry.rowKey);
      compactTechniqueGroups.set(entry.rowKey, {
        at: entry.at,
        width: Math.max(existing?.width ?? 0, entry.width)
      });
    }
    const compactTechniqueRowByKey = new Map<string, number>();
    const compactTechniqueRowRightEdges: number[] = [];
    for (const [rowKey, group] of [...compactTechniqueGroups.entries()].sort((a, b) => a[1].at - b[1].at)) {
      const left = group.at / beatCount * compactContentWidth;
      let row = compactTechniqueRowRightEdges.findIndex(right => right + 3 <= left);
      if (row < 0) row = compactTechniqueRowRightEdges.length;
      compactTechniqueRowRightEdges[row] = left + group.width;
      compactTechniqueRowByKey.set(rowKey, row);
    }
    const compactTechniqueHeight = Math.max(48, compactTechniqueRowRightEdges.length * 31 + 5);
    compactTechniqueHeights.push(compactTechniqueHeight);
    const techniques = compactTechniqueEntries.map(({ item, at, rowKey }) => {
      const ariaLabel = item.kind === 'rest' ? `${msgs.uiPracticeGuideRest} ${item.duration}` : item.stroke?.label ?? item.label;
      const marker = item.kind === 'rest'
        ? renderPracticeGuideRestSvg(item.restBase, ariaLabel)
        : item.stroke
          ? renderPracticeGuideStrokeSvg(item.stroke)
          : renderPracticeGuideStrokeSvg({ kind: 'attack', direction: 'neutral', label: ariaLabel });
      const waves = compactWaveGrids(item, measure)
        .map(grid => `<span class="practice-guide-compact-wave" data-guide-wave-grid="${grid}">${renderPracticeGuideWaveSvg(`${item.duration} ${msgs.uiPracticeGuideTechnique}`, compactWaveWidth(item, measure))}</span>`).join('');
      const eventStart = fnum(item.eventStart);
      const eventEnd = fnum(item.eventEnd);
      const compactAlign = 'start';
      const key = `${measure.number - 1}:${item.eventIndex ?? -1}:${at}:${item.label}`;
      const eventKey = `${measure.number - 1}:${item.eventIndex ?? -1}`;
      const rowTop = 2 + (compactTechniqueRowByKey.get(rowKey) ?? 0) * 31;
      return `<span class="practice-guide-compact-symbol" data-guide-measure="${measure.number - 1}" data-guide-align="${compactAlign}" data-guide-technique-key="${escapeXml(key)}" data-guide-technique-event-key="${escapeXml(eventKey)}" data-guide-kind="${item.kind ?? ''}" data-guide-event="${item.eventIndex ?? -1}" data-guide-event-start="${eventStart}" data-guide-event-end="${eventEnd}" data-guide-start-beat="${at}" data-guide-slot-start="${at}" style="left:${percent(at)}%;top:${rowTop}px" title="${escapeXml(item.duration || ariaLabel)}" aria-label="${escapeXml(ariaLabel)}">${marker}${waves}</span>`;
    }).join('');
    const chordNames = chordSpans.filter(span => span.chord).map(span => {
      const chord = span.chord!;
      const centerBeat = chordSpanCenter(span);
      const label = chord.label ? `${chord.name}@${chord.label}` : chord.name;
      return `<span class="practice-guide-compact-chord-name" data-guide-measure="${measure.number - 1}" data-guide-chord="${escapeXml(chord.name)}" data-guide-start-beat="${span.start}" data-guide-end-beat="${span.end}" data-guide-center-beat="${centerBeat}" style="left:${percent(centerBeat)}%" title="${escapeXml(label)}">${escapeXml(label)}</span>`;
    }).join('');
    const diagrams = chordSpans.filter(span => span.chord?.svg).map(span => {
      const chord = span.chord!;
      const centerBeat = chordSpanCenter(span);
      const label = chord.label ? `${chord.name}@${chord.label}` : chord.name;
      return `<span class="practice-guide-compact-diagram-event" data-guide-measure="${measure.number - 1}" data-guide-chord="${escapeXml(chord.name)}" data-guide-start-beat="${span.start}" data-guide-end-beat="${span.end}" data-guide-center-beat="${centerBeat}" style="left:${percent(centerBeat)}%" title="${escapeXml(label)}">${chord.svg}</span>`;
    }).join('');
    const ruler = `<div class="practice-guide-compact-ruler" data-guide-compact-measure-label="${measure.number - 1}">${measure.number}</div>`;
    const compactCard = `<article class="practice-guide-compact-measure" data-guide-compact-measure="${measure.number - 1}" data-guide-measure-beats="${beatCount}" style="width:${minWidth}px;--guide-compact-lyrics-height:${data.lyricsHeight}px" aria-label="${escapeXml(msgs.uiPracticeMeasure)} ${measure.number}">
      <span class="practice-guide-compact-playhead" aria-hidden="true" hidden></span>
      ${ruler}
      <div class="practice-guide-compact-lane practice-guide-compact-melody" data-guide-lane="melody">${melody}</div>
      <div class="practice-guide-compact-lane practice-guide-compact-lyrics" data-guide-lane="lyrics">${lyrics}</div>
      <div class="practice-guide-compact-lane practice-guide-compact-technique" data-guide-lane="technique">${techniques}</div>
      <div class="practice-guide-compact-lane practice-guide-compact-chords" data-guide-lane="chord">${chordNames}</div>
      <div class="practice-guide-compact-lane practice-guide-compact-diagrams" data-guide-lane="diagrams">${diagrams}</div>
    </article>`;
    compactTemplates.push(`<template data-guide-template-measure="${measure.number - 1}">${compactCard}</template>`);
  }
  const stableBankWidths: Record<string, { left: number[]; right: number[] }> = {};
  for (const capacity of [4] as const) {
    const bankSize = 2;
    const widths = { left: Array(bankSize).fill(144) as number[], right: Array(bankSize).fill(144) as number[] };
    for (let index = 0; index < occurrences.length; index++) {
      const pageIndex = Math.floor(index / bankSize);
      const bank = pageIndex % 2 === 0 ? 'left' : 'right';
      const slot = index % bankSize;
      const measureWidth = compactMeasureWidths[occurrences[index].measureIndex] ?? 144;
      widths[bank][slot] = Math.max(widths[bank][slot], measureWidth);
    }
    stableBankWidths[String(capacity)] = widths;
  }
  const projections = Object.fromEntries(([4] as const).map(capacity => [capacity, occurrences.map(occurrence => {
    const projection = projectPracticeGuidePage(occurrences, occurrence.occurrenceIndex, capacity);
    return {
      currentOccurrenceIndex: projection.currentOccurrence?.occurrenceIndex ?? null,
      currentBank: projection.currentBank,
      pageIndex: projection.pageIndex,
      banks: {
        left: projection.banks.left.occurrences.map(item => item.occurrenceIndex),
        right: projection.banks.right.occurrences.map(item => item.occurrenceIndex)
      }
    };
  })]));
  const guideProjectionJson = escapeXml(JSON.stringify(projections));
  const guideWidthsJson = escapeXml(JSON.stringify(compactMeasureWidths));
  const guideBankWidthsJson = escapeXml(JSON.stringify(stableBankWidths));
  const compactTechniqueHeight = Math.max(48, ...compactTechniqueHeights);
  const compactGuide = `<div class="practice-guide-compact" id="practice-guide-compact" aria-label="${escapeXml(msgs.uiPracticeGuideCompact)}" data-guide-technique-height="${compactTechniqueHeight}" data-guide-projections="${guideProjectionJson}" data-guide-measure-widths="${guideWidthsJson}" data-guide-bank-widths="${guideBankWidthsJson}">
    <div class="practice-guide-pair-page" id="practice-guide-pair-page" data-guide-capacity="4" role="region" tabindex="0" aria-label="${escapeXml(msgs.uiPracticeGuideCompact)}">
      <div class="practice-guide-scale-holder" id="practice-guide-scale-holder">
        <div class="practice-guide-scale-layer" id="practice-guide-scale-layer">
          <div class="practice-guide-page-bank" id="practice-guide-bank-left" data-guide-bank="left" aria-hidden="false"></div>
          <div class="practice-guide-page-bank is-empty" id="practice-guide-bank-right" data-guide-bank="right" aria-hidden="true"></div>
        </div>
      </div>
    </div>
    ${compactTemplates.join('') || `<p class="practice-guide-empty">${escapeXml(msgs.uiPlaybackEmpty)}</p>`}
  </div>`;
  const boundaries = boundaryMarks();
  const lanes = `<div class="practice-guide-lane practice-guide-melody" data-guide-lane="melody" data-guide-pitch-high="${data.pitchMaxMidi}" data-guide-pitch-low="${data.pitchMinMidi}">${boundaries}${melodyItems.join('')}</div>
    <div class="practice-guide-lane practice-guide-lyrics" data-guide-lane="lyrics" style="--guide-lyrics-height:${data.lyricsHeight}px;height:${data.lyricsHeight}px">${boundaries}${lyricItems.join('')}</div>
    <div class="practice-guide-lane practice-guide-technique" data-guide-lane="technique" style="--guide-technique-height:${techniqueHeight}px;height:${techniqueHeight}px">${boundaries}${techniqueItems.join('')}</div>
    <div class="practice-guide-lane practice-guide-chords" data-guide-lane="chord">${boundaries}${chordNames.join('')}</div>
    <div class="practice-guide-lane practice-guide-diagrams" data-guide-lane="diagrams">${boundaries}${diagrams.join('')}</div>`;
  const ruler = `<div class="practice-guide-ruler">${boundaryMarks()}${numbers}</div>`;
  const initialNextChord = data.initialNextChord;
  const nextChord = `<aside class="practice-guide-next-chord" id="practice-guide-next-chord"><span class="practice-guide-next-chord-label">${escapeXml(msgs.uiPracticeGuideNextChord)}</span><strong class="practice-guide-next-chord-name" id="practice-guide-next-chord-name">${escapeXml(initialNextChord?.name ?? '—')}</strong><div class="practice-guide-next-chord-diagram" id="practice-guide-next-chord-diagram">${initialNextChord?.svg ?? ''}</div></aside>`;
  const autoLabel = data.automaticFill ? `<span class="practice-guide-auto-fill" id="practice-guide-auto-fill">${escapeXml(msgs.uiPracticeGuideAutoFill)}</span>` : `<span class="practice-guide-auto-fill" id="practice-guide-auto-fill" hidden>${escapeXml(msgs.uiPracticeGuideAutoFill)}</span>`;
  const timeline = `<div class="practice-guide-timeline" id="practice-guide-timeline" data-guide-total-beats="${fnum(data.totalBeats)}" data-guide-measure-count="${data.measures.length}" data-guide-px-per-beat="${pixelsPerBeat}" style="--guide-total-width:${totalWidth.toFixed(3)}px;--guide-lyrics-height:${data.lyricsHeight}px;--guide-technique-height:${techniqueHeight}px;width:${totalWidth.toFixed(3)}px">${ruler}${lanes}<span class="practice-guide-playhead" id="practice-guide-playhead" hidden></span>${data.measures.length ? '' : `<p class="practice-guide-empty">${escapeXml(msgs.uiPlaybackEmpty)}</p>`}</div>`;
  return `<aside class="practice-guide-panel" id="practice-guide-panel" aria-label="${escapeXml(msgs.uiPracticeGuideTitle)}" data-automatic-grid="${data.automaticGrid}" data-guide-grid="${data.automaticGrid}" style="--guide-compact-technique-height:${compactTechniqueHeight}px">
    <header class="practice-guide-header">
      <button class="practice-guide-collapse" id="practice-guide-collapse" type="button" aria-expanded="true" title="${escapeXml(msgs.uiPracticeGuideCollapse)}">⌄</button>
      <strong>${escapeXml(msgs.uiPracticeGuideTitle)}</strong>
      ${autoLabel}
      <div class="practice-guide-controls">
        <label>${escapeXml(msgs.uiPracticeGuideView)} <select class="practice-select" id="practice-guide-view" aria-label="${escapeXml(msgs.uiPracticeGuideView)}"><option value="compact">${escapeXml(msgs.uiPracticeGuideCompact)}</option><option value="detailed">${escapeXml(msgs.uiPracticeGuideDetailed)}</option></select></label>
        <label>${escapeXml(msgs.uiPracticeGuideGrid)} <select class="practice-select" id="practice-guide-grid"><option value="auto">${escapeXml(msgs.uiPracticeGuideAuto)} (${data.automaticGrid})</option><option value="4">${escapeXml(msgs.uiPracticeGuideGrid4)}</option><option value="8">${escapeXml(msgs.uiPracticeGuideGrid8)}</option><option value="16">${escapeXml(msgs.uiPracticeGuideGrid16)}</option></select></label>
        <button class="practice-button practice-guide-compact-page-control" id="practice-guide-compact-previous" type="button" aria-controls="practice-guide-pair-page" aria-label="${escapeXml(msgs.uiPracticeGuidePrevious)}" title="${escapeXml(msgs.uiPracticeGuidePrevious)}">‹</button>
        <span class="practice-guide-compact-range" id="practice-guide-compact-range" aria-live="polite"></span>
        <button class="practice-button practice-guide-compact-page-control" id="practice-guide-compact-next" type="button" aria-controls="practice-guide-pair-page" aria-label="${escapeXml(msgs.uiPracticeGuideNext)}" title="${escapeXml(msgs.uiPracticeGuideNext)}">›</button>
        <button class="practice-button" id="practice-guide-diagrams-toggle" type="button" aria-pressed="true">${escapeXml(msgs.uiPracticeGuideDiagrams)} ON</button>
        <button class="practice-button" id="practice-guide-melody-toggle" type="button" aria-pressed="true">${escapeXml(msgs.uiPracticeGuideMelody)} ON</button>
      </div>
    </header>
    <div class="practice-guide-layout">${labelRail}<div class="practice-guide-scroll" id="practice-guide-scroll" tabindex="0" aria-label="${escapeXml(msgs.uiPracticeGuideTitle)}">${timeline}</div>${compactGuide}${nextChord}</div>
  </aside>`;
}

function buildPlaybackHtmlData(score: ParsedScore, msgs: Messages): PlaybackHtmlData {
  const practiceGuide = buildPracticeGuideData(score);
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
    practiceLoopCleared: msgs.uiPracticeLoopCleared,
    guideTitle: msgs.uiPracticeGuideTitle,
    guideView: msgs.uiPracticeGuideView,
    guideDetailed: msgs.uiPracticeGuideDetailed,
    guideCompact: msgs.uiPracticeGuideCompact,
    guidePrevious: msgs.uiPracticeGuidePrevious,
    guideNext: msgs.uiPracticeGuideNext,
    guidePlaybackOrder: msgs.uiPracticeGuidePlaybackOrder,
    guideMeasures: msgs.uiPracticeGuideMeasures,
    guideRest: msgs.uiPracticeGuideRest,
    guideDiagrams: msgs.uiPracticeGuideDiagrams,
    guideMelody: msgs.uiPracticeGuideMelody,
    guideGrid: msgs.uiPracticeGuideGrid,
    guideAuto: msgs.uiPracticeGuideAuto,
    guideGrid4: msgs.uiPracticeGuideGrid4,
    guideGrid8: msgs.uiPracticeGuideGrid8,
    guideGrid16: msgs.uiPracticeGuideGrid16,
    guideChord: msgs.uiPracticeGuideChord,
    guideLyrics: msgs.uiPracticeGuideLyrics,
    guideTechnique: msgs.uiPracticeGuideTechnique,
    guideMelodyRow: msgs.uiPracticeGuideMelodyRow,
    guideAutoFill: msgs.uiPracticeGuideAutoFill,
    guideCollapse: msgs.uiPracticeGuideCollapse,
    guideExpand: msgs.uiPracticeGuideExpand
  };
  const result = buildPlaybackTimeline(score);
  if (!result.ok) {
    const error = result.code === 'invalidPlayOrder'
      ? msgs.uiPlaybackInvalidOrder
      : msgs.uiPlaybackUnresolvedTempo;
    return { available: false, durationSeconds: 0, events: [], occurrences: [], practiceGuide, countInDurationSeconds: 0, countInClicks: [], labels, error };
  }

  const { timeline } = result;
  if (timeline.occurrences.length === 0 || !Number.isFinite(timeline.durationSeconds) || timeline.durationSeconds <= 0) {
    return {
      available: false,
      durationSeconds: 0,
      events: [],
      occurrences: [],
      practiceGuide,
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
    ...(occurrence.lyricVerse === undefined ? {} : { lyricVerse: occurrence.lyricVerse }),
    startBeat: occurrence.startBeat,
    durationBeats: occurrence.durationBeats,
    startSeconds: occurrence.startSeconds,
    durationSeconds: occurrence.durationSeconds,
    tempoBpm: occurrence.tempoBpm,
    countInDurationSeconds: fnum(measureBeats(occurrence.timeSignature)) * 60 / occurrence.tempoBpm,
    countInClicks: beamGroupStarts(occurrence.timeSignature).map((beat, groupIndex) => ({
      timeSeconds: fnum(beat) * 60 / occurrence.tempoBpm,
      accent: groupIndex === 0
    }))
  }));

  return {
    available: true,
    durationSeconds: timeline.durationSeconds,
    events: timeline.events.map(event => ({ ...event, midiNotes: playbackEventMidiNotes(event, effectiveCapo, score.chordDefinitions, score.tuning) })),
    ...(timeline.rhythmTieRestartEvents ? {
      rhythmTieRestartEvents: timeline.rhythmTieRestartEvents.map(event => ({ ...event, midiNotes: playbackEventMidiNotes(event, effectiveCapo, score.chordDefinitions, score.tuning) }))
    } : {}),
    occurrences,
    practiceGuide,
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
