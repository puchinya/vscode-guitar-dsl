/** Parser-owned source ranges and exact token selection helpers for Code Actions. */
import { CodeActionSourceToken, ChordTokenSpan, ParsedScore, PitchTokenSpan } from '../compiler';
import { SourceOffsetEdit } from '../sourceEdits';

export interface SourceSelection {
  start: number;
  end: number;
}

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

export interface OffsetSpan {
  start: number;
  end: number;
}

export interface SelectedToken<T extends CodeActionSourceToken = CodeActionSourceToken> {
  token: T;
  span: OffsetSpan;
}

export interface SelectedMusic {
  chordTokens: ChordTokenSpan[];
  pitchTokens: PitchTokenSpan[];
}

export function lineStarts(source: string): number[] {
  const starts = [0];
  for (let i = 0; i < source.length; i++) if (source[i] === '\n') starts.push(i + 1);
  return starts;
}

export function offsetOf(starts: readonly number[], line: number, column: number): number | undefined {
  const start = starts[line];
  return start === undefined ? undefined : start + column;
}

export function tokenOffset(token: Pick<CodeActionSourceToken, 'line' | 'startCol' | 'endCol'>, starts: readonly number[]): OffsetSpan | undefined {
  const start = offsetOf(starts, token.line, token.startCol);
  const end = offsetOf(starts, token.line, token.endCol);
  return start === undefined || end === undefined ? undefined : { start, end };
}

export function normalizeSelection(source: string, selection: SourceSelection): SourceSelection | undefined {
  if (!Number.isInteger(selection.start) || !Number.isInteger(selection.end) || selection.start < 0 || selection.end > source.length || selection.end <= selection.start) return undefined;
  let start = selection.start;
  let end = selection.end;
  while (start < end && /\s/.test(source[start])) start++;
  while (end > start && /\s/.test(source[end - 1])) end--;
  return start < end ? { start, end } : undefined;
}

export function coversOnlyTokens(source: string, window: SourceSelection, tokens: SelectedToken[]): boolean {
  const sorted = [...tokens].sort((a, b) => a.span.start - b.span.start);
  let cursor = window.start;
  for (const item of sorted) {
    if (item.span.start < cursor || source.slice(cursor, item.span.start).trim()) return false;
    cursor = item.span.end;
  }
  return cursor <= window.end && !source.slice(cursor, window.end).trim();
}

export function selectCodeTokens(
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

export function selectedMusic(source: string, score: ParsedScore, selection: SourceSelection): { ok: true; window: SourceSelection; spans: SelectedToken[]; chords: ChordTokenSpan[]; pitches: PitchTokenSpan[] } | { ok: false; code: MusicCodeActionFailure } {
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

export function cursorSelectionForTokenKinds(
  source: string,
  score: ParsedScore,
  cursor: number,
  allowed: ReadonlySet<CodeActionSourceToken['kind']>
): SourceSelection | undefined {
  const starts = lineStarts(source);
  for (const token of score.codeActionTokens ?? []) {
    if (!allowed.has(token.kind)) continue;
    const span = tokenOffset(token, starts);
    if (span && span.start <= cursor && cursor < span.end) return span;
  }
  return undefined;
}

export function musicNameSelectionAtCursor(source: string, score: ParsedScore, cursor: number): SourceSelection | undefined {
  const starts = lineStarts(source);
  const candidates: OffsetSpan[] = [];
  for (const token of score.chordTokens ?? []) {
    const start = offsetOf(starts, token.line, token.startCol);
    const end = offsetOf(starts, token.line, token.endCol);
    if (start !== undefined && end !== undefined && start <= cursor && cursor < end) candidates.push({ start, end });
  }
  for (const token of score.pitchTokens ?? []) {
    if (token.kind === 'fragment') continue;
    const start = offsetOf(starts, token.line, token.startCol);
    const end = offsetOf(starts, token.line, token.endCol);
    if (start !== undefined && end !== undefined && start <= cursor && cursor < end) candidates.push({ start, end });
  }
  candidates.sort((a, b) => (a.end - a.start) - (b.end - b.start) || a.start - b.start);
  const candidate = candidates[0];
  return candidate ? { start: candidate.start, end: candidate.end } : undefined;
}
