/** Pure planners for music-aware editor actions. */
import { chordKey, isValidChordName } from '../chordDefinition';
import { CodeActionDefinitionSpan, CodeActionSourceToken, ParsedScore, PitchTokenSpan } from '../compiler';
import { formatNoteValuePart, fmul, frac, parseBeats, parseNoteValue, parseRhythmDuration } from '../duration';
import { normalizeChordSpelling, toggleChordEnharmonicSpelling, transposeChordName } from '../capo';
import { transposePitch, isValidSemitones } from '../transpose';
import { SourceOffsetEdit } from '../sourceEdits';
import {
  MusicCodeActionFailure, MusicCodeActionPlan, SelectedToken, SourceSelection, lineStarts, offsetOf,
  selectCodeTokens, selectedMusic
} from './sourceIndex';
import { duplicateChordDefinitionKeys, hasTab, hasUnsupportedMeasureBoundary, makeDurationPlan, makePitchPreservingPlan, makePlan, parseFailed } from './semantics';

export type MusicCodeAction =
  | { kind: 'extractLet'; selection: SourceSelection }
  | { kind: 'inlineLet'; selection: SourceSelection }
  | { kind: 'transpose'; selection: SourceSelection; semitones: number }
  | { kind: 'enharmonic'; selection: SourceSelection }
  | { kind: 'doubleDuration'; selection: SourceSelection }
  | { kind: 'halveDuration'; selection: SourceSelection }
  | { kind: 'normalizePitchNames'; selection: SourceSelection }
  | { kind: 'removeUnusedChordDefinition'; line: number };

function sourceDefinition(score: ParsedScore, kind: CodeActionDefinitionSpan['kind'], name: string): CodeActionDefinitionSpan | undefined {
  return (score.sourceDefinitions ?? []).find(definition => definition.kind === kind && definition.name === name && !definition.duplicate);
}

function definitionInsertOffset(source: string, score: ParsedScore): { offset: number; prefix: string; suffix: string } {
  const starts = lineStarts(source);
  const eol = source.includes('\r\n') ? '\r\n' : '\n';
  if (score.firstBodyLine !== undefined) return { offset: starts[score.firstBodyLine] ?? source.length, prefix: '', suffix: eol };
  return { offset: source.length, prefix: source.length > 0 && !source.endsWith('\n') ? eol : '', suffix: eol };
}

function planExtractLet(source: string, score: ParsedScore, selection: SourceSelection): MusicCodeActionPlan {
  if (hasTab(score)) return { ok: false, code: 'unsupportedBoundary' };
  const allowed = new Set<CodeActionSourceToken['kind']>(['rhythm', 'noteGroup', 'inlineNote', 'melodyNote', 'melodyGroup', 'melodyRest']);
  const selected = selectCodeTokens(source, score, selection, allowed);
  if (!selected.ok) return selected;
  if (selected.tokens.length < 2 || new Set(selected.tokens.map(x => x.token.cellId)).size !== 1) return { ok: false, code: 'unsupportedBoundary' };
  for (const { token } of selected.tokens) {
    if (token.cellId.startsWith('measure:') && hasUnsupportedMeasureBoundary(score, token)) return { ok: false, code: 'unsupportedBoundary' };
  }
  const names = new Set((score.sourceDefinitions ?? []).filter(d => d.kind === 'let').map(d => d.name));
  let suffix = 1;
  while (names.has(`fragment${suffix}`)) suffix++;
  const name = `fragment${suffix}`;
  const first = selected.tokens[0];
  const last = selected.tokens[selected.tokens.length - 1];
  const start = first.span.start;
  const end = last.span.end;
  const selectedText = source.slice(start, end);
  const insertion = definitionInsertOffset(source, score);
  const definition = `let ${name} = ${selectedText}`;
  const edits: SourceOffsetEdit[] = [
    { start, end, expected: selectedText, text: `$${name}` },
    { start: insertion.offset, end: insertion.offset, expected: '', text: insertion.prefix + definition + insertion.suffix }
  ];
  return makePlan(source, score, edits, 'sameMusic');
}

function planInlineLet(source: string, score: ParsedScore, selection: SourceSelection): MusicCodeActionPlan {
  const selected = selectCodeTokens(source, score, selection, new Set(['letReference']));
  if (!selected.ok) return selected;
  if (selected.tokens.length !== 1) return { ok: false, code: 'invalidSelection' };
  const item = selected.tokens[0];
  const name = item.token.text.slice(1);
  const referencesInCell = (score.codeActionTokens ?? []).filter(t => t.cellId === item.token.cellId);
  if (referencesInCell.length !== 1) return { ok: false, code: 'unsupportedBoundary' };
  const definition = sourceDefinition(score, 'let', name);
  if (!definition || definition.valueStartCol === undefined || definition.valueEndCol === undefined) return { ok: false, code: 'definitionNotFound' };
  const starts = lineStarts(source);
  const valueStart = offsetOf(starts, definition.line, definition.valueStartCol);
  const valueEnd = offsetOf(starts, definition.line, definition.valueEndCol);
  if (valueStart === undefined || valueEnd === undefined) return { ok: false, code: 'staleSource' };
  const value = source.slice(valueStart, valueEnd);
  return makePlan(source, score, [{ start: item.span.start, end: item.span.end, expected: item.token.text, text: value }], 'sameMusic');
}

function pitchName(pitch: PitchTokenSpan['pitch']): string {
  const canonical = transposePitch(pitch, 0);
  if (!canonical) return '';
  return `${canonical.step}${canonical.alter === 1 ? '#' : canonical.alter === -1 ? 'b' : ''}${canonical.octave}`;
}

function chordCollision(score: ParsedScore, sourceKey: string, targetName: string): boolean {
  if (!isValidChordName(targetName)) return true;
  const targetKey = chordKey(targetName);
  const customKeys = score.chordDefinitions.map(definition => chordKey(definition.name, definition.label));
  return customKeys.includes(sourceKey) || customKeys.some(key => key === targetKey && key !== sourceKey);
}

function implicitOctavesToWrite(score: ParsedScore, selectedPitches: readonly PitchTokenSpan[], semitones: number): Set<PitchTokenSpan> {
  const selected = new Set(selectedPitches);
  const inheritedOctaves = new Map<number, number>();
  const writeOctaves = new Set<PitchTokenSpan>();
  for (const pitch of score.pitchTokens ?? []) {
    if (pitch.kind !== 'melody' && pitch.kind !== 'inline') continue;
    const currentOctave = inheritedOctaves.get(pitch.sequence) ?? pitch.pitch.octave;
    const target = selected.has(pitch) ? transposePitch(pitch.pitch, semitones) : null;
    if (pitch.explicitOctave) {
      inheritedOctaves.set(pitch.sequence, target?.octave ?? pitch.pitch.octave);
    } else if (selected.has(pitch)) {
      if (target && target.octave !== currentOctave) writeOctaves.add(pitch);
      inheritedOctaves.set(pitch.sequence, target?.octave ?? currentOctave);
    } else {
      // An unselected implicit pitch keeps the source inheritance state; the post-parse guard
      // rejects the plan if that means its resolved pitch would change.
      inheritedOctaves.set(pitch.sequence, currentOctave);
    }
  }
  return writeOctaves;
}

function planMusicNames(source: string, score: ParsedScore, selection: SourceSelection, operation: 'transpose' | 'enharmonic' | 'normalizePitchNames', semitones = 0): MusicCodeActionPlan {
  if (hasTab(score)) return { ok: false, code: 'unsupportedBoundary' };
  if (operation === 'transpose' && !isValidSemitones(semitones)) return { ok: false, code: 'invalidSelection' };
  const selected = selectedMusic(source, score, selection);
  if (!selected.ok) return selected;
  const lineStartsBySource = lineStarts(source);
  const edits: SourceOffsetEdit[] = [];
  const transposeOctaves = operation === 'transpose' ? implicitOctavesToWrite(score, selected.pitches, semitones) : new Set<PitchTokenSpan>();
  for (const chord of selected.chords) {
    if (chord.label !== undefined) return { ok: false, code: 'unsupportedBoundary' };
    const start = offsetOf(lineStartsBySource, chord.line, chord.startCol);
    const end = offsetOf(lineStartsBySource, chord.line, chord.endCol);
    if (start === undefined || end === undefined) return { ok: false, code: 'staleSource' };
    let next: string | null = null;
    if (operation === 'transpose') next = transposeChordName(chord.name, semitones);
    else if (operation === 'enharmonic') next = toggleChordEnharmonicSpelling(chord.name);
    else next = normalizeChordSpelling(chord.name);
    if (next === null) return { ok: false, code: 'unsupportedBoundary' };
    if (operation !== 'transpose' && chordCollision(score, chordKey(chord.name), next)) return { ok: false, code: 'collision' };
    if (operation === 'transpose' && chordCollision(score, chordKey(chord.name), next)) return { ok: false, code: 'collision' };
    if (next !== chord.name) edits.push({ start, end, expected: chord.name, text: next });
  }
  for (const pitch of selected.pitches) {
    const start = offsetOf(lineStartsBySource, pitch.line, pitch.startCol);
    const end = offsetOf(lineStartsBySource, pitch.line, pitch.endCol);
    if (start === undefined || end === undefined) return { ok: false, code: 'staleSource' };
    let next: string;
    if (operation === 'transpose') {
      const value = transposePitch(pitch.pitch, semitones);
      if (!value) return { ok: false, code: 'pitchOutOfRange' };
      if (!pitch.explicitOctave && value.octave !== pitch.pitch.octave) return { ok: false, code: 'unsupportedBoundary' };
      next = `${value.step}${value.alter === 1 ? '#' : value.alter === -1 ? 'b' : ''}${pitch.explicitOctave || transposeOctaves.has(pitch) ? value.octave : ''}`;
    } else if (operation === 'enharmonic') {
      const current = `${pitch.pitch.step.toUpperCase()}${pitch.pitch.alter === 1 ? '#' : pitch.pitch.alter === -1 ? 'b' : ''}`;
      const respelled = toggleChordEnharmonicSpelling(current);
      if (!respelled) return { ok: false, code: 'unsupportedBoundary' };
      next = `${respelled.toLowerCase()}${pitch.explicitOctave ? pitch.pitch.octave : ''}`;
    } else {
      next = pitchName(pitch.pitch).toLowerCase();
      if (!pitch.explicitOctave) next = next.slice(0, -String(pitch.pitch.octave).length);
    }
    const expected = source.slice(start, end);
    if (next !== expected) edits.push({ start, end, expected, text: next });
  }
  return makePitchPreservingPlan(source, score, edits, selected.pitches);
}

function scaleDurationText(text: string, style: 'rhythm' | 'noteValue' | 'beats', double: boolean): string | null {
  const factor = double ? frac(2) : frac(1, 2);
  if (style === 'beats') {
    const beats = parseBeats(text);
    if (!beats) return null;
    const scaled = fmul(beats, factor);
    return formatFiniteDecimal(scaled);
  }
  const value = style === 'rhythm' ? parseRhythmDuration(text) : parseNoteValue(text);
  if (!value || value.parts.some(part => part.tuplet)) return null;
  const parts = value.parts.map(part => {
    const nextBase = double ? part.base / 2 : part.base * 2;
    if (![1, 2, 4, 8, 16].includes(nextBase)) return null;
    return { ...part, base: nextBase as 1 | 2 | 4 | 8 | 16 };
  });
  if (parts.some(part => part === null)) return null;
  return parts.map(part => formatNoteValuePart(part!)).join('+');
}

function formatFiniteDecimal(value: { n: number; d: number }): string | null {
  if (value.d === 1) return String(value.n);
  let rest = value.d;
  let twos = 0;
  let fives = 0;
  while (rest % 2 === 0) { rest /= 2; twos++; }
  while (rest % 5 === 0) { rest /= 5; fives++; }
  if (rest !== 1) return null;
  const places = Math.max(twos, fives);
  const scale = 10 ** places;
  const scaled = value.n * scale / value.d;
  if (!Number.isSafeInteger(scaled)) return null;
  const sign = scaled < 0 ? '-' : '';
  const digits = String(Math.abs(scaled)).padStart(places + 1, '0');
  const integer = digits.slice(0, -places);
  const fraction = digits.slice(-places).replace(/0+$/, '');
  return fraction ? `${sign}${integer}.${fraction}` : `${sign}${integer}`;
}

function planDuration(source: string, score: ParsedScore, selection: SourceSelection, double: boolean): MusicCodeActionPlan {
  if (hasTab(score)) return { ok: false, code: 'unsupportedBoundary' };
  const allowed = new Set<CodeActionSourceToken['kind']>(['rhythm', 'noteGroup', 'inlineNote', 'melodyNote', 'melodyGroup', 'melodyRest', 'chord']);
  const selected = selectCodeTokens(source, score, selection, allowed);
  if (!selected.ok) return selected;
  if (selected.tokens.some(({ token }) => !token.duration)) return { ok: false, code: 'unsupportedDuration' };
  for (const { token } of selected.tokens) {
    if (token.kind !== 'chord' && token.cellId.startsWith('measure:') && hasUnsupportedMeasureBoundary(score, token)) return { ok: false, code: 'unsupportedBoundary' };
  }
  const starts = lineStarts(source);
  const edits: SourceOffsetEdit[] = [];
  for (const { token } of selected.tokens) {
    const duration = token.duration!;
    const start = offsetOf(starts, token.line, duration.startCol);
    const end = offsetOf(starts, token.line, duration.endCol);
    if (start === undefined || end === undefined || source.slice(start, end) !== duration.text) return { ok: false, code: 'staleSource' };
    const next = scaleDurationText(duration.text, duration.style, double);
    if (next === null) return { ok: false, code: 'unsupportedDuration' };
    edits.push({ start, end, expected: duration.text, text: next });
  }
  return makeDurationPlan(source, score, edits, selected.tokens.map(({ token }) => token));
}

function planRemoveUnusedChord(source: string, score: ParsedScore, line: number): MusicCodeActionPlan {
  const definition = (score.sourceDefinitions ?? []).find(d => d.kind === 'chord' && d.line === line);
  if (!definition) return { ok: false, code: 'definitionNotFound' };
  const key = chordKey(definition.name, definition.label);
  if (definition.duplicate || duplicateChordDefinitionKeys(score).has(key)) return { ok: false, code: 'unsupportedBoundary' };
  if (score.usedChords.includes(key)) return { ok: false, code: 'definitionInUse' };
  if (definition.trailingComment) return { ok: false, code: 'unsupportedBoundary' };
  const starts = lineStarts(source);
  const start = starts[line];
  if (start === undefined) return { ok: false, code: 'staleSource' };
  const end = line + 1 < starts.length ? starts[line + 1] : source.length;
  const expected = source.slice(start, end);
  const ending = expected.endsWith('\r\n') ? '\r\n' : expected.endsWith('\n') ? '\n' : '';
  const lineText = expected.slice(0, expected.length - ending.length);
  if (lineText.trimStart().slice(0, 5) !== 'chord') return { ok: false, code: 'staleSource' };
  return makePlan(source, score, [{ start, end, expected, text: '' }], 'sameMusic');
}

export function planMusicCodeAction(source: string, score: ParsedScore, action: MusicCodeAction): MusicCodeActionPlan {
  if (parseFailed(score)) return { ok: false, code: 'sourceParseError' };
  switch (action.kind) {
    case 'extractLet': return planExtractLet(source, score, action.selection);
    case 'inlineLet': return planInlineLet(source, score, action.selection);
    case 'transpose': return planMusicNames(source, score, action.selection, 'transpose', action.semitones);
    case 'enharmonic': return planMusicNames(source, score, action.selection, 'enharmonic');
    case 'normalizePitchNames': return planMusicNames(source, score, action.selection, 'normalizePitchNames');
    case 'doubleDuration': return planDuration(source, score, action.selection, true);
    case 'halveDuration': return planDuration(source, score, action.selection, false);
    case 'removeUnusedChordDefinition': return planRemoveUnusedChord(source, score, action.line);
  }
}

export function codeActionSelectionCanTransform(source: string, score: ParsedScore, selection: SourceSelection): boolean {
  return !hasTab(score) && selectedMusic(source, score, selection).ok;
}
