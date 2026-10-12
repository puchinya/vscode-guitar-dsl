import { parseGuitarDsl, type MeasureData, type ParsedScore } from './compiler';
import { spliceSourceOffsets, type SourceOffsetEdit } from './sourceEdits';
import { supportedSuggestionQuality, type ProgressionCandidate, type ProgressionTarget } from './progressionSuggestions';

export type ProgressionEditOperation = 'replace' | 'append';

export interface ProgressionEditTarget extends ProgressionTarget {
  bars: number;
  operation: ProgressionEditOperation;
}

export type ProgressionEditFailureCode =
  | 'invalidTarget'
  | 'sourceHasErrors'
  | 'unsupportedMeasure'
  | 'keyBoundary'
  | 'invalidCandidate'
  | 'sourceSpanMismatch'
  | 'postValidationFailed'
  | 'semanticMismatch';

export type ProgressionEditPlan =
  | { ok: true; edits: SourceOffsetEdit[]; previewSource: string }
  | { ok: false; reason: ProgressionEditFailureCode; detail?: string };

function lineOffsets(source: string): number[] {
  const offsets = [0];
  for (let index = 0; index < source.length; index++) {
    if (source[index] === '\n') offsets.push(index + 1);
  }
  return offsets;
}

function lineStartOffset(source: string, line: number): number | undefined {
  return lineOffsets(source)[line];
}

function measureSemantics(measure: MeasureData): unknown {
  const { chord: _chord, chords: _chords, chordBeatOffsets: _chordBeatOffsets, rhythmSource, ...rest } = measure;
  return { ...rest, rhythmSourceKind: rhythmSource?.kind };
}

function protectedSemanticsMatch(before: ParsedScore, after: ParsedScore, target: ProgressionEditTarget): boolean {
  if (after.measures.length !== before.measures.length + (target.operation === 'append' ? target.bars : 0)) return false;
  const targetEnd = target.startMeasure + (target.operation === 'replace' ? target.bars : 0);
  for (let index = 0; index < before.measures.length; index++) {
    if (target.operation === 'replace' && index >= target.startMeasure && index < targetEnd) {
      const left = measureSemantics(before.measures[index]);
      const right = measureSemantics(after.measures[index]);
      if (JSON.stringify(left) !== JSON.stringify(right)) return false;
    } else if (JSON.stringify(before.measures[index]) !== JSON.stringify(after.measures[index])) {
      return false;
    }
  }
  return true;
}

function checkRangeContext(score: ParsedScore, target: ProgressionEditTarget): ProgressionEditPlan | undefined {
  const end = target.startMeasure + (target.operation === 'replace' ? target.bars : 0);
  const measures = score.measures.slice(target.startMeasure, end);
  if (measures.some(measure => measure.context.key !== measures[0]?.context.key)) {
    return { ok: false, reason: 'keyBoundary' };
  }
  return undefined;
}

function appendEdit(source: string, chords: readonly string[]): SourceOffsetEdit {
  const eol = source.includes('\r\n') ? '\r\n' : '\n';
  const trailing = source.match(/(?:\r?\n)*$/)?.[0] ?? '';
  const insertionOffset = source.length - trailing.length;
  const prefix = source.slice(0, insertionOffset);
  const line = `| ${chords.join(' | ')} |`;
  const separator = prefix.length === 0 ? '' : eol;
  return { start: insertionOffset, end: insertionOffset, expected: '', text: separator + line };
}

/** Plans exact chord-name replacements or a body-end append, then reparses and checks protected semantics. */
export function planProgressionEdit(
  source: string,
  score: ParsedScore,
  target: ProgressionEditTarget,
  candidate: ProgressionCandidate
): ProgressionEditPlan {
  if (!Number.isInteger(target.startMeasure) || !Number.isInteger(target.bars) || target.bars < 1
    || candidate.target.startMeasure !== target.startMeasure || candidate.target.bars !== target.bars || candidate.chords.length !== target.bars) {
    return { ok: false, reason: 'invalidTarget' };
  }
  if (score.diagnostics.some(diagnostic => diagnostic.severity === 'error')) {
    return { ok: false, reason: 'sourceHasErrors' };
  }
  if (candidate.chords.some(name => name.includes('/') || !supportedSuggestionQuality(name))) {
    return { ok: false, reason: 'invalidCandidate' };
  }

  const edits: SourceOffsetEdit[] = [];
  if (target.operation === 'replace') {
    if (target.startMeasure + target.bars > score.measures.length) return { ok: false, reason: 'invalidTarget' };
    const contextFailure = checkRangeContext(score, target);
    if (contextFailure) return contextFailure;
    for (let offset = 0; offset < target.bars; offset++) {
      const measureIndex = target.startMeasure + offset;
      const measure = score.measures[measureIndex];
      const tokens = (score.codeActionTokens ?? []).filter(token => token.kind === 'chord' && token.measureIndex === measureIndex);
      const token = tokens[0];
      if (!measure || measure.isMeasureRepeat || measure.tabVoices?.length || measure.chords.length !== 1 || tokens.length !== 1
        || measure.chordPlacementMode === 'explicitDuration' || token?.duration || token?.text.includes('@')) {
        return { ok: false, reason: 'unsupportedMeasure', detail: String(measureIndex) };
      }
      const span = (score.chordTokens ?? []).find(item => item.line === token.line && item.startCol === token.startCol && item.name === measure.chords[0].name);
      if (!span || span.label !== undefined) return { ok: false, reason: 'unsupportedMeasure', detail: String(measureIndex) };
      const lineStart = lineStartOffset(source, span.line);
      if (lineStart === undefined) return { ok: false, reason: 'sourceSpanMismatch' };
      edits.push({
        start: lineStart + span.startCol,
        end: lineStart + span.endCol,
        expected: span.name,
        text: candidate.chords[offset]
      });
    }
  } else {
    if (target.startMeasure !== score.measures.length) return { ok: false, reason: 'invalidTarget' };
    edits.push(appendEdit(source, candidate.chords));
  }

  const spliced = spliceSourceOffsets(source, edits);
  if (!spliced.ok) return { ok: false, reason: 'sourceSpanMismatch', detail: spliced.detail };
  const previewSource = spliced.text;

  const parsedAfter = parseGuitarDsl(previewSource);
  if (parsedAfter.diagnostics.some(diagnostic => diagnostic.severity === 'error')) {
    return { ok: false, reason: 'postValidationFailed' };
  }
  if (!protectedSemanticsMatch(score, parsedAfter, target)) {
    return { ok: false, reason: 'semanticMismatch' };
  }
  if (target.operation === 'append') {
    const appended = parsedAfter.measures.slice(score.measures.length);
    if (appended.length !== target.bars || appended.some((measure, index) => measure.chords.length !== 1 || measure.chords[0].name !== candidate.chords[index])) {
      return { ok: false, reason: 'postValidationFailed' };
    }
  }
  return { ok: true, edits, previewSource };
}

/** Converts a planned UTF-16 offset edit into source line/columns for a VS Code TextDocument. */
export function offsetToLineColumn(source: string, offset: number): { line: number; character: number } {
  const offsets = lineOffsets(source);
  let low = 0;
  let high = offsets.length;
  while (low + 1 < high) {
    const middle = (low + high) >>> 1;
    if (offsets[middle] <= offset) low = middle;
    else high = middle;
  }
  return { line: low, character: offset - offsets[low] };
}
