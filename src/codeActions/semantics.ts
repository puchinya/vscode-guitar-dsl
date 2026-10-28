/** Pure semantic post-validation for music-aware Code Action plans. */
import { CodeActionSourceToken, ParsedScore, PitchTokenSpan, parseGuitarDsl } from '../compiler';
import { SourceOffsetEdit, spliceSourceOffsets } from '../sourceEdits';
import { MusicCodeActionPlan } from './sourceIndex';

export function parseFailed(score: ParsedScore): boolean {
  return score.diagnostics.some(d => d.severity === 'error');
}

export function hasTab(score: ParsedScore): boolean {
  return score.hasTab === true;
}

export function hasUnsupportedMeasureBoundary(score: ParsedScore, token: CodeActionSourceToken): boolean {
  if (token.measureIndex === undefined) return true;
  const measure = score.measures[token.measureIndex];
  return !measure || measure.rhythmOrigin !== 'explicit' || measure.isMeasureRepeat === true || measure.expandedFromRepeat === true;
}

export function duplicateChordDefinitionKeys(score: ParsedScore): Set<string> {
  return new Set(score.diagnostics
    .filter(diagnostic => diagnostic.code === 'duplicateChordDefinition' && typeof diagnostic.args?.chord === 'string')
    .map(diagnostic => String(diagnostic.args!.chord)));
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

export function makePlan(
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

function selectedPitchEventIndexes(
  score: ParsedScore,
  selectedPitches: readonly PitchTokenSpan[]
): { rhythm: Map<number, Set<number>>; melody: Map<number, Set<number>> } | undefined {
  const selected = { rhythm: new Map<number, Set<number>>(), melody: new Map<number, Set<number>>() };
  for (const pitch of selectedPitches) {
    const owners = (score.codeActionTokens ?? []).filter(token => token.line === pitch.line
      && token.measureIndex !== undefined && token.eventRange !== undefined
      && token.startCol <= pitch.startCol && token.endCol >= pitch.endCol);
    if (owners.length !== 1) return undefined;
    const owner = owners[0];
    const range = owner.eventRange!;
    if (!Number.isInteger(owner.measureIndex) || range.start < 0 || range.end <= range.start) return undefined;
    if (range.collection === 'tab') return undefined;
    const indexes = selected[range.collection].get(owner.measureIndex!) ?? new Set<number>();
    for (let index = range.start; index < range.end; index++) indexes.add(index);
    selected[range.collection].set(owner.measureIndex!, indexes);
  }
  return selected;
}

function soundingPitchSignature(event: { pitch?: PitchTokenSpan['pitch']; pitches?: PitchTokenSpan['pitch'][] }): string {
  const semitones: Record<PitchTokenSpan['pitch']['step'], number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
  const pitches = event.pitches ?? (event.pitch ? [event.pitch] : []);
  return JSON.stringify(pitches.map(pitch => pitch.octave * 12 + semitones[pitch.step] + pitch.alter));
}

/** Reject name changes whose reparsed inheritance changes any event outside the selected pitches. */
export function unselectedEventPitchesMatch(
  before: ParsedScore,
  after: ParsedScore,
  selectedPitches: readonly PitchTokenSpan[]
): boolean {
  if (before.measures.length !== after.measures.length) return false;
  const selected = selectedPitchEventIndexes(before, selectedPitches);
  if (!selected) return false;
  for (let measureIndex = 0; measureIndex < before.measures.length; measureIndex++) {
    const left = before.measures[measureIndex];
    const right = after.measures[measureIndex];
    if (left.rhythms.length !== right.rhythms.length || (left.melody?.length ?? 0) !== (right.melody?.length ?? 0)) return false;
    const selectedRhythm = selected.rhythm.get(measureIndex) ?? new Set<number>();
    for (let index = 0; index < left.rhythms.length; index++) {
      if (selectedRhythm.has(index)) continue;
      if (soundingPitchSignature(left.rhythms[index]) !== soundingPitchSignature(right.rhythms[index])) return false;
    }
    const selectedMelody = selected.melody.get(measureIndex) ?? new Set<number>();
    for (let index = 0; index < (left.melody?.length ?? 0); index++) {
      if (selectedMelody.has(index)) continue;
      if (soundingPitchSignature(left.melody![index]) !== soundingPitchSignature(right.melody![index])) return false;
    }
  }
  return true;
}

export function makePitchPreservingPlan(
  source: string,
  score: ParsedScore,
  edits: SourceOffsetEdit[],
  selectedPitches: readonly PitchTokenSpan[]
): MusicCodeActionPlan {
  if (edits.length === 0) return { ok: false, code: 'invalidSelection' };
  const spliced = spliceSourceOffsets(source, edits);
  if (!spliced.ok) return { ok: false, code: 'staleSource' };
  const next = parseGuitarDsl(spliced.text);
  if (parseFailed(next) || structureFingerprint(score) !== structureFingerprint(next)
    || !unselectedEventPitchesMatch(score, next, selectedPitches)) return { ok: false, code: 'validationFailed' };
  return { ok: true, text: spliced.text, edits };
}

export function unselectedEventDurationsMatch(
  before: ParsedScore,
  after: ParsedScore,
  selectedTokens: readonly CodeActionSourceToken[]
): boolean {
  if (before.measures.length !== after.measures.length) return false;
  const selectedRhythm = new Map<number, Set<number>>();
  const selectedMelody = new Map<number, Set<number>>();
  for (const token of selectedTokens) {
    if (token.kind === 'chord') continue;
    const range = token.eventRange;
    const measureIndex = token.measureIndex;
    if (!range || measureIndex === undefined || range.start < 0 || range.end < range.start) return false;
    const targets = range.collection === 'rhythm' ? selectedRhythm : selectedMelody;
    const indexes = targets.get(measureIndex) ?? new Set<number>();
    for (let i = range.start; i < range.end; i++) indexes.add(i);
    targets.set(measureIndex, indexes);
  }

  const signature = (value: unknown) => JSON.stringify(value);
  for (let measureIndex = 0; measureIndex < before.measures.length; measureIndex++) {
    const left = before.measures[measureIndex];
    const right = after.measures[measureIndex];
    if (left.rhythms.length !== right.rhythms.length || (left.melody?.length ?? 0) !== (right.melody?.length ?? 0)) return false;
    const skippedRhythms = selectedRhythm.get(measureIndex) ?? new Set<number>();
    for (let i = 0; i < left.rhythms.length; i++) {
      if (skippedRhythms.has(i)) continue;
      const a = left.rhythms[i];
      const b = right.rhythms[i];
      if (signature([a.duration, a.inlineDuration?.beats]) !== signature([b.duration, b.inlineDuration?.beats])) return false;
    }
    const skippedMelody = selectedMelody.get(measureIndex) ?? new Set<number>();
    for (let i = 0; i < (left.melody?.length ?? 0); i++) {
      if (skippedMelody.has(i)) continue;
      if (signature(left.melody![i].beats) !== signature(right.melody![i].beats)) return false;
    }
  }
  return true;
}

export function makeDurationPlan(
  source: string,
  score: ParsedScore,
  edits: SourceOffsetEdit[],
  selectedTokens: readonly CodeActionSourceToken[]
): MusicCodeActionPlan {
  if (edits.length === 0) return { ok: false, code: 'invalidSelection' };
  const spliced = spliceSourceOffsets(source, edits);
  if (!spliced.ok) return { ok: false, code: 'staleSource' };
  const next = parseGuitarDsl(spliced.text);
  if (parseFailed(next) || structureFingerprint(score) !== structureFingerprint(next)
    || !unselectedEventDurationsMatch(score, next, selectedTokens)) return { ok: false, code: 'validationFailed' };
  return { ok: true, text: spliced.text, edits };
}
