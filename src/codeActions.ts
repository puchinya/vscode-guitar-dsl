/** Pure planners for music-aware editor actions. Source ranges are supplied by the compiler. */
import { chordKey, isValidChordName } from './chordDefinition';
import {
  CodeActionDefinitionSpan,
  CodeActionSourceToken,
  ChordTokenSpan,
  ParsedScore,
  PitchTokenSpan,
  parseGuitarDsl
} from './compiler';
import { formatNoteValuePart, fmul, frac, parseBeats, parseNoteValue, parseRhythmDuration } from './duration';
import { normalizeChordSpelling, toggleChordEnharmonicSpelling, transposeChordName } from './capo';
import { transposePitch, isValidSemitones } from './transpose';
import { SourceOffsetEdit, spliceSourceOffsets } from './sourceEdits';

export interface SourceSelection {
  start: number;
  end: number;
}

export type MusicCodeAction =
  | { kind: 'extractLet'; selection: SourceSelection }
  | { kind: 'inlineLet'; selection: SourceSelection }
  | { kind: 'transpose'; selection: SourceSelection; semitones: number }
  | { kind: 'enharmonic'; selection: SourceSelection }
  | { kind: 'doubleDuration'; selection: SourceSelection }
  | { kind: 'halveDuration'; selection: SourceSelection }
  | { kind: 'normalizePitchNames'; selection: SourceSelection }
  | { kind: 'removeUnusedChordDefinition'; line: number };

export type MusicCodeActionFailure =
  | 'sourceParseError'
  | 'invalidSelection'
  | 'unsupportedBoundary'
  | 'definitionNotFound'
  | 'definitionInUse'
  | 'collision'
  | 'unsupportedDuration'
  | 'pitchOutOfRange'
  | 'staleSource'
  | 'validationFailed';

export type MusicCodeActionPlan =
  | { ok: true; text: string; edits: SourceOffsetEdit[] }
  | { ok: false; code: MusicCodeActionFailure };

export interface CodeActionHint {
  kind: 'unusedChordDefinition' | 'repeatedFragmentCandidate';
  line: number;
  startCol: number;
  endCol: number;
  text: string;
}

interface OffsetSpan {
  start: number;
  end: number;
}

interface SelectedToken<T extends CodeActionSourceToken = CodeActionSourceToken> {
  token: T;
  span: OffsetSpan;
}

interface SelectedMusic {
  chordTokens: ChordTokenSpan[];
  pitchTokens: PitchTokenSpan[];
}

function lineStarts(source: string): number[] {
  const starts = [0];
  for (let i = 0; i < source.length; i++) if (source[i] === '\n') starts.push(i + 1);
  return starts;
}

function offsetOf(starts: readonly number[], line: number, column: number): number | undefined {
  const start = starts[line];
  return start === undefined ? undefined : start + column;
}

function tokenOffset(token: Pick<CodeActionSourceToken, 'line' | 'startCol' | 'endCol'>, starts: readonly number[]): OffsetSpan | undefined {
  const start = offsetOf(starts, token.line, token.startCol);
  const end = offsetOf(starts, token.line, token.endCol);
  return start === undefined || end === undefined ? undefined : { start, end };
}

function normalizeSelection(source: string, selection: SourceSelection): SourceSelection | undefined {
  if (!Number.isInteger(selection.start) || !Number.isInteger(selection.end) || selection.start < 0 || selection.end > source.length || selection.end <= selection.start) return undefined;
  let start = selection.start;
  let end = selection.end;
  while (start < end && /\s/.test(source[start])) start++;
  while (end > start && /\s/.test(source[end - 1])) end--;
  return start < end ? { start, end } : undefined;
}

function coversOnlyTokens(source: string, window: SourceSelection, tokens: SelectedToken[]): boolean {
  const sorted = [...tokens].sort((a, b) => a.span.start - b.span.start);
  let cursor = window.start;
  for (const item of sorted) {
    if (item.span.start < cursor || source.slice(cursor, item.span.start).trim()) return false;
    cursor = item.span.end;
  }
  return cursor <= window.end && !source.slice(cursor, window.end).trim();
}

function selectCodeTokens(
  source: string,
  score: ParsedScore,
  selection: SourceSelection,
  allowed: ReadonlySet<CodeActionSourceToken['kind']>
): { ok: true; window: SourceSelection; tokens: SelectedToken[] } | { ok: false; code: MusicCodeActionFailure } {
  const window = normalizeSelection(source, selection);
  if (!window) return { ok: false, code: 'invalidSelection' };
  const starts = lineStarts(source);
  const tokens = (score.codeActionTokens ?? []).flatMap(token => {
    const span = tokenOffset(token, starts);
    return span && span.start < window.end && span.end > window.start ? [{ token, span }] : [];
  });
  if (!tokens.length || tokens.some(item => !allowed.has(item.token.kind))) return { ok: false, code: 'invalidSelection' };
  if (tokens.some(item => item.span.start < window.start || item.span.end > window.end) || !coversOnlyTokens(source, window, tokens)) {
    return { ok: false, code: 'invalidSelection' };
  }
  return { ok: true, window, tokens };
}

function parseFailed(score: ParsedScore): boolean {
  return score.diagnostics.some(d => d.severity === 'error');
}

function hasTab(score: ParsedScore): boolean {
  return score.hasTab === true;
}

function hasUnsupportedMeasureBoundary(score: ParsedScore, token: CodeActionSourceToken): boolean {
  if (token.measureIndex === undefined) return true;
  const measure = score.measures[token.measureIndex];
  return !measure || measure.rhythmOrigin !== 'explicit' || measure.isMeasureRepeat === true || measure.expandedFromRepeat === true;
}

function musicalFingerprint(score: ParsedScore): string {
  return JSON.stringify(score.measures.map(measure => ({
    chords: measure.chords.map(chord => [chord.name, chord.label ?? '', chord.beat]),
    rhythms: measure.rhythms.map(item => ({
      duration: item.duration,
      isRest: item.isRest,
      down: item.down,
      up: item.up,
      ghost: item.ghost,
      accent: item.accent,
      tie: item.tie,
      arpeggio: item.arpeggio,
      pitch: item.pitch,
      pitches: item.pitches,
      inlineLyric: item.inlineLyric,
      techniques: item.techniques,
      inlineDuration: item.inlineDuration
    })),
    melody: (measure.melody ?? []).map(note => ({
      pitch: note.pitch,
      pitches: note.pitches,
      isRest: note.isRest,
      beats: note.beats,
      syllables: note.syllables,
      techniques: note.techniques,
      tieToNext: note.tieToNext,
      tiedFromPrev: note.tiedFromPrev
    })),
    lyric: measure.lyric
  })));
}

function structureFingerprint(score: ParsedScore): string {
  return JSON.stringify(score.measures.map(measure => [measure.chords.length, measure.rhythms.length, (measure.melody ?? []).length]));
}

function makePlan(
  source: string,
  score: ParsedScore,
  edits: SourceOffsetEdit[],
  validation: 'sameMusic' | 'sameStructure'
): MusicCodeActionPlan {
  if (edits.length === 0) return { ok: false, code: 'invalidSelection' };
  const spliced = spliceSourceOffsets(source, edits);
  if (!spliced.ok) return { ok: false, code: 'staleSource' };
  const next = parseGuitarDsl(spliced.text);
  if (parseFailed(next)) return { ok: false, code: 'validationFailed' };
  if (validation === 'sameMusic' && musicalFingerprint(score) !== musicalFingerprint(next)) return { ok: false, code: 'validationFailed' };
  if (validation === 'sameStructure' && structureFingerprint(score) !== structureFingerprint(next)) return { ok: false, code: 'validationFailed' };
  return { ok: true, text: spliced.text, edits };
}

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

function selectedMusic(source: string, score: ParsedScore, selection: SourceSelection): { ok: true; window: SourceSelection; spans: SelectedToken[]; chords: ChordTokenSpan[]; pitches: PitchTokenSpan[] } | { ok: false; code: MusicCodeActionFailure } {
  const window = normalizeSelection(source, selection);
  if (!window) return { ok: false, code: 'invalidSelection' };
  const starts = lineStarts(source);
  const allChords = (score.chordTokens ?? []).flatMap(token => {
    const start = offsetOf(starts, token.line, token.startCol);
    const end = offsetOf(starts, token.line, token.endCol);
    return start === undefined || end === undefined || start >= window.end || end <= window.start ? [] : [{ token, span: { start, end } }];
  });
  const allPitches = (score.pitchTokens ?? []).filter(token => token.kind !== 'fragment').flatMap(token => {
    const start = offsetOf(starts, token.line, token.startCol);
    const end = offsetOf(starts, token.line, token.endCol);
    return start === undefined || end === undefined || start >= window.end || end <= window.start ? [] : [{ token, span: { start, end } }];
  });
  const chordTokens: ChordTokenSpan[] = [];
  const pitchTokens: PitchTokenSpan[] = [];
  const covers: SelectedToken[] = [];
  const coveredChord = new Set<ChordTokenSpan>();
  const coveredPitch = new Set<PitchTokenSpan>();
  const sourceContainers = (score.codeActionTokens ?? []).filter(token =>
    token.kind === 'chord' || token.kind === 'inlineNote' || token.kind === 'melodyNote'
      || token.kind === 'noteGroup' || token.kind === 'melodyGroup'
  ).flatMap(token => {
    const span = tokenOffset(token, starts);
    return span && span.start >= window.start && span.end <= window.end ? [{ token, span }] : [];
  });
  for (const container of sourceContainers) {
    if (container.token.kind === 'chord') {
      const chord = allChords.find(item => item.token.line === container.token.line
        && item.span.start >= container.span.start && item.span.end <= container.span.end);
      if (chord) {
        chordTokens.push(chord.token);
        coveredChord.add(chord.token);
        covers.push(container);
      }
      continue;
    }
    const contained = allPitches.filter(item => item.token.line === container.token.line
      && item.span.start >= container.span.start && item.span.end <= container.span.end);
    if (contained.length) {
      for (const item of contained) {
        pitchTokens.push(item.token);
        coveredPitch.add(item.token);
      }
      covers.push(container);
    }
  }
  for (const item of allChords) {
    if (coveredChord.has(item.token)) continue;
    if (item.span.start < window.start || item.span.end > window.end) continue;
    chordTokens.push(item.token);
    covers.push({ token: { line: item.token.line, startCol: item.token.startCol, endCol: item.token.endCol, text: item.token.name, kind: 'chord', cellId: `measure:${item.token.line}` }, span: item.span });
  }
  for (const item of allPitches) {
    if (coveredPitch.has(item.token)) continue;
    if (item.span.start < window.start || item.span.end > window.end) continue;
    pitchTokens.push(item.token);
    covers.push({ token: { line: item.token.line, startCol: item.token.startCol, endCol: item.token.endCol, text: source.slice(item.span.start, item.span.end), kind: 'inlineNote', cellId: `pitch:${item.token.sequence}` }, span: item.span });
  }
  const all = covers.sort((a, b) => a.span.start - b.span.start);
  if (!all.length || all.some(item => item.span.start < window.start || item.span.end > window.end) || !coversOnlyTokens(source, window, all)) return { ok: false, code: 'invalidSelection' };
  return { ok: true, window, spans: all, chords: chordTokens, pitches: pitchTokens };
}

function pitchName(pitch: PitchTokenSpan['pitch']): string {
  const canonical = transposePitch(pitch, 0);
  if (!canonical) return '';
  return `${canonical.step}${canonical.alter === 1 ? '#' : canonical.alter === -1 ? 'b' : ''}${canonical.octave}`;
}

function chordCollision(score: ParsedScore, sourceKey: string, targetName: string): boolean {
  if (!isValidChordName(targetName)) return true;
  const targetKey = chordKey(targetName);
  return score.chordDefinitions.some(definition => chordKey(definition.name, definition.label) === targetKey && chordKey(definition.name, definition.label) !== sourceKey);
}

function planMusicNames(source: string, score: ParsedScore, selection: SourceSelection, operation: 'transpose' | 'enharmonic' | 'normalizePitchNames', semitones = 0): MusicCodeActionPlan {
  if (hasTab(score)) return { ok: false, code: 'unsupportedBoundary' };
  if (operation === 'transpose' && !isValidSemitones(semitones)) return { ok: false, code: 'invalidSelection' };
  const selected = selectedMusic(source, score, selection);
  if (!selected.ok) return selected;
  const lineStartsBySource = lineStarts(source);
  const edits: SourceOffsetEdit[] = [];
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
      next = `${value.step}${value.alter === 1 ? '#' : value.alter === -1 ? 'b' : ''}${pitch.explicitOctave ? value.octave : ''}`;
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
  return makePlan(source, score, edits, 'sameStructure');
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
  return makePlan(source, score, edits, 'sameStructure');
}

function planRemoveUnusedChord(source: string, score: ParsedScore, line: number): MusicCodeActionPlan {
  const definition = (score.sourceDefinitions ?? []).find(d => d.kind === 'chord' && d.line === line);
  if (!definition) return { ok: false, code: 'definitionNotFound' };
  const key = chordKey(definition.name, definition.label);
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

export function computeCodeActionHints(source: string, score: ParsedScore): CodeActionHint[] {
  if (parseFailed(score)) return [];
  const starts = lineStarts(source);
  const hints: CodeActionHint[] = [];
  for (const definition of score.sourceDefinitions ?? []) {
    if (definition.kind !== 'chord') continue;
    if (score.usedChords.includes(chordKey(definition.name, definition.label))) continue;
    hints.push({ kind: 'unusedChordDefinition', line: definition.line, startCol: definition.startCol, endCol: definition.endCol, text: definition.name });
  }

  if (!hasTab(score)) {
    const cells = new Map<string, SelectedToken[]>();
    for (const token of score.codeActionTokens ?? []) {
      if (token.kind !== 'rhythm' || token.measureIndex === undefined || hasUnsupportedMeasureBoundary(score, token)) continue;
      const span = tokenOffset(token, starts);
      if (!span) continue;
      const cell = cells.get(token.cellId) ?? [];
      cell.push({ token, span });
      cells.set(token.cellId, cell);
    }
    const windows: { key: string; tokens: SelectedToken[]; start: number; end: number }[] = [];
    for (const cell of cells.values()) {
      const sorted = [...cell].sort((a, b) => a.span.start - b.span.start);
      for (let length = 4; length <= Math.min(16, sorted.length); length++) {
        for (let i = 0; i + length <= sorted.length; i++) {
          const tokens = sorted.slice(i, i + length);
          if (!tokens.slice(1).every((token, index) => !source.slice(tokens[index].span.end, token.span.start).trim())) continue;
          windows.push({ key: tokens.map(item => item.token.text).join(' '), tokens, start: tokens[0].span.start, end: tokens[tokens.length - 1].span.end });
        }
      }
    }
    windows.sort((a, b) => b.tokens.length - a.tokens.length || a.start - b.start);
    const seen = new Set<string>();
    for (const first of windows) {
      if (seen.has(first.key)) continue;
      const second = windows.find(other => other.key === first.key && other.start >= first.end);
      if (!second) continue;
      seen.add(first.key);
      const token = first.tokens[0].token;
      const lastToken = first.tokens[first.tokens.length - 1].token;
      hints.push({ kind: 'repeatedFragmentCandidate', line: token.line, startCol: token.startCol, endCol: lastToken.endCol, text: first.key });
      if (hints.filter(hint => hint.kind === 'repeatedFragmentCandidate').length >= 40) break;
    }
  }
  return hints.slice(0, 40);
}

export function codeActionSelectionCanTransform(source: string, score: ParsedScore, selection: SourceSelection): boolean {
  return !hasTab(score) && selectedMusic(source, score, selection).ok;
}
