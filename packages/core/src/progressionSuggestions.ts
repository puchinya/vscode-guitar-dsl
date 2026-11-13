import { CHORD_QUALITIES, NOTE_NAMES, parseChordName } from './chordDetect';
import { eventPitches, expandMeasureRepeat, type ParsedScore } from './compiler';
import { analyzeHarmony, parseKeyContext, type HarmonicMode } from './harmonicAnalysis';
import { fnum } from './duration';
import { pitchToMidi } from './playbackSynth';
import { parseCapoValue, transposeChordName } from './capo';

export type ProgressionBars = 4 | 8 | 16;

export interface ProgressionTarget {
  /** Zero-based source measure index; `measures.length` is the safe append position. */
  startMeasure: number;
  /** Authored chord immediately before the caret/target, when the caller has an exact one. */
  previousChord?: string;
  /** Explicit context for an empty parser cell between source measures. */
  key?: string;
}

/** Resolves an authored target cell before falling back to the previous measure for a true append. */
export function resolveProgressionTargetKey(score: ParsedScore, measureIndex: number, includePendingKeyChange = true): string {
  const measureKey = score.measures[measureIndex]?.context.key;
  if (measureKey) return measureKey;
  if (includePendingKeyChange) {
    const keyChange = score.events
      .filter((event): event is Extract<typeof event, { kind: 'keyChange' }> => event.kind === 'keyChange'
        && event.beforeMeasure <= measureIndex)
      .sort((left, right) => left.beforeMeasure - right.beforeMeasure || left.line - right.line)
      .at(-1);
    if (keyChange) return keyChange.key;
  }
  return score.measures[measureIndex - 1]?.context.key ?? score.originalKey;
}

export interface ProgressionScoreBreakdown {
  followsPreviousRoot: number;
  identicalOpeningChord: number;
  tonicEnding: number;
  melody: number;
  total: number;
}

export interface ProgressionCandidate {
  id: string;
  target: { startMeasure: number; bars: number };
  chords: string[];
  romanNumerals: string[];
  key: string;
  mode: HarmonicMode;
  rationale: string;
  melodyEvaluated: boolean;
  score: ProgressionScoreBreakdown;
  catalogOrder: number;
}

export type ProgressionSuggestionFailureCode =
  | 'invalidTarget'
  | 'sourceHasErrors'
  | 'keyNotDeclared'
  | 'invalidKey'
  | 'invalidCapo'
  | 'unsupportedQuality'
  | 'ambiguousHarmony'
  | 'keyBoundary';

export type ProgressionSuggestionResult =
  | { ok: true; candidates: ProgressionCandidate[] }
  | { ok: false; code: ProgressionSuggestionFailureCode; detail?: string };

interface RomanChord {
  roman: string;
  degree: number;
  accidental: -1 | 0 | 1;
  suffix: string;
}

interface Pattern {
  id: string;
  chords: readonly RomanChord[];
}

const chord = (roman: string, degree: number, suffix: string, accidental: -1 | 0 | 1 = 0): RomanChord => ({
  roman, degree, accidental, suffix
});

const MAJOR_PATTERNS: readonly Pattern[] = [
  { id: 'major-1', chords: [chord('I', 1, ''), chord('V', 5, ''), chord('vi', 6, 'm'), chord('IV', 4, '')] },
  { id: 'major-2', chords: [chord('I', 1, ''), chord('vi', 6, 'm'), chord('IV', 4, ''), chord('V', 5, '')] },
  { id: 'major-3', chords: [chord('I', 1, ''), chord('vi', 6, 'm'), chord('ii', 2, 'm'), chord('V', 5, '')] },
  { id: 'major-4', chords: [chord('vi', 6, 'm'), chord('IV', 4, ''), chord('I', 1, ''), chord('V', 5, '')] },
  { id: 'major-5', chords: [chord('I', 1, ''), chord('IV', 4, ''), chord('iv', 4, 'm'), chord('I', 1, '')] }
];

const MINOR_PATTERNS: readonly Pattern[] = [
  { id: 'minor-1', chords: [chord('i', 1, 'm'), chord('VI', 6, ''), chord('III', 3, ''), chord('VII', 7, '')] },
  { id: 'minor-2', chords: [chord('i', 1, 'm'), chord('iv', 4, 'm'), chord('V', 5, ''), chord('i', 1, 'm')] },
  { id: 'minor-3', chords: [chord('i', 1, 'm'), chord('VII', 7, ''), chord('VI', 6, ''), chord('V', 5, '')] },
  { id: 'minor-4', chords: [chord('i', 1, 'm'), chord('iv', 4, 'm'), chord('VII', 7, ''), chord('III', 3, '')] },
  { id: 'minor-5', chords: [chord('i', 1, 'm'), chord('VI', 6, ''), chord('iv', 4, 'm'), chord('V', 5, '')] }
];

const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11] as const;
const MINOR_SCALE = [0, 2, 3, 5, 7, 8, 10] as const;
const mod12 = (value: number): number => ((value % 12) + 12) % 12;

function patternsFor(mode: HarmonicMode): readonly Pattern[] {
  return mode === 'major' ? MAJOR_PATTERNS : MINOR_PATTERNS;
}

function degreeOffset(entry: RomanChord, mode: HarmonicMode): number {
  const scale = mode === 'major' ? MAJOR_SCALE : MINOR_SCALE;
  return scale[entry.degree - 1] + entry.accidental;
}

function chordForContext(entry: RomanChord, tonicPc: number, mode: HarmonicMode, capo: number): string | null {
  const soundingRoot = NOTE_NAMES[mod12(tonicPc + degreeOffset(entry, mode))];
  return transposeChordName(soundingRoot + entry.suffix, -capo);
}

function sourceErrors(score: ParsedScore): boolean {
  return score.diagnostics.some(diagnostic => diagnostic.severity === 'error');
}

function contextFor(score: ParsedScore, target: ProgressionTarget, rangeBars: number): { key: string; tonicPc: number; mode: HarmonicMode; capo: number } | ProgressionSuggestionResult {
  if (!Number.isInteger(target.startMeasure) || target.startMeasure < 0 || target.startMeasure > score.measures.length) {
    return { ok: false, code: 'invalidTarget' };
  }
  if (sourceErrors(score)) return { ok: false, code: 'sourceHasErrors' };
  const capo = parseCapoValue(score.capo);
  if (capo === null) return { ok: false, code: 'invalidCapo', detail: score.capo };
  const explicitKeyAvailable = (score.headerLines ?? []).some(line => line.key === 'key' || line.key === 'original_key')
    || score.events.some(event => event.kind === 'keyChange' && event.beforeMeasure <= target.startMeasure);
  if (!explicitKeyAvailable) return { ok: false, code: 'keyNotDeclared' };
  const contextMeasure = score.measures[target.startMeasure] ?? score.measures[target.startMeasure - 1];
  const key = target.key ?? contextMeasure?.context.key ?? score.originalKey;
  const parsedKey = parseKeyContext(key);
  if (!parsedKey) return { ok: false, code: 'invalidKey', detail: key };

  const harmony = analyzeHarmony(score);
  if (harmony.diagnostics.some(diagnostic => diagnostic.code === 'invalidCapo')) {
    return { ok: false, code: 'invalidCapo', detail: score.capo };
  }
  const first = score.measures[target.startMeasure];
  if (first) {
    const withinRange = score.measures.slice(target.startMeasure, target.startMeasure + rangeBars);
    const rangeEnd = target.startMeasure + rangeBars;
    if (score.events.some(event => event.kind === 'keyChange'
      && event.beforeMeasure > target.startMeasure && event.beforeMeasure < rangeEnd)) {
      return { ok: false, code: 'keyBoundary' };
    }
    if (withinRange.some(measure => measure.context.key !== key)) {
      return { ok: false, code: 'keyBoundary' };
    }
    if (withinRange.some(measure => !parseKeyContext(measure.context.key))) {
      return { ok: false, code: 'invalidKey', detail: withinRange.find(measure => !parseKeyContext(measure.context.key))?.context.key };
    }
  }
  const unsupported = harmony.diagnostics.find(diagnostic =>
    diagnostic.code === 'unsupportedQuality' && diagnostic.measureIndex !== undefined
      && diagnostic.measureIndex >= target.startMeasure
      && diagnostic.measureIndex < target.startMeasure + rangeBars
  );
  if (unsupported) return { ok: false, code: 'unsupportedQuality', detail: unsupported.value };
  const ambiguous = harmony.chords.find(chord => chord.status === 'ambiguous'
    && chord.measureIndex >= target.startMeasure
    && chord.measureIndex < target.startMeasure + rangeBars);
  if (ambiguous) return { ok: false, code: 'ambiguousHarmony', detail: ambiguous.writtenName };
  return { key, tonicPc: parsedKey.tonicPc, mode: parsedKey.mode, capo };
}

function previousChordAt(score: ParsedScore, target: ProgressionTarget): string | undefined {
  if (target.previousChord) return target.previousChord;
  for (let index = Math.min(target.startMeasure - 1, score.measures.length - 1); index >= 0; index--) {
    const measure = score.measures[index];
    const chords = measure.isMeasureRepeat ? expandMeasureRepeat(measure, score.measures).chords : measure.chords;
    if (chords.length > 0) return chords[chords.length - 1].name;
  }
  return undefined;
}

function generatedPattern(pattern: Pattern, bars: number, tonicPc: number, mode: HarmonicMode, capo: number): { chords: string[]; romans: string[] } | null {
  const entries = Array.from({ length: bars }, (_, index) => pattern.chords[index % pattern.chords.length]);
  const names = entries.map(entry => chordForContext(entry, tonicPc, mode, capo));
  if (names.some(name => name === null)) return null;
  return { chords: names as string[], romans: entries.map(entry => entry.roman) };
}

function melodyScore(score: ParsedScore, startMeasure: number, chords: readonly string[], capo: number): { value: number; evaluated: boolean } {
  let value = 0;
  let evaluated = false;
  for (let offset = 0; offset < chords.length; offset++) {
    const measure = score.measures[startMeasure + offset];
    if (!measure?.melody) continue;
    const parsed = parseChordName(chords[offset]);
    if (!parsed?.quality) continue;
    evaluated = true;
    const chordTones = new Set(parsed.quality.intervals.map(interval => mod12(parsed.rootPc + capo + interval)));
    if (parsed.bassPc !== undefined) chordTones.add(mod12(parsed.bassPc + capo));
    for (const note of measure.melody) {
      if (note.isRest) continue;
      const pitches = eventPitches(note);
      if (pitches.length === 0) continue;
      const weight = fnum(note.beats);
      for (const pitch of pitches) {
        value += (chordTones.has(mod12(pitchToMidi(pitch))) ? 2 : -1) * weight;
      }
    }
  }
  return { value, evaluated };
}

function buildCandidate(
  score: ParsedScore,
  target: ProgressionTarget,
  chords: string[],
  romanNumerals: string[],
  key: string,
  tonicPc: number,
  mode: HarmonicMode,
  capo: number,
  id: string,
  catalogOrder: number
): ProgressionCandidate {
  const previous = previousChordAt(score, target);
  const first = parseChordName(chords[0]);
  const last = parseChordName(chords[chords.length - 1]);
  const previousParsed = previous ? parseChordName(previous) : null;
  const followsPreviousRoot = previousParsed && first && previousParsed.rootPc === first.rootPc ? 4 : 0;
  const identicalOpeningChord = previous && previous === chords[0] ? -1 : 0;
  const tonicQuality = mode === 'major' ? '' : 'm';
  const tonicEnding = last && mod12(last.rootPc + capo) === mod12(tonicPc) && last.suffix === tonicQuality ? 2 : 0;
  const melody = melodyScore(score, target.startMeasure, chords, capo);
  const total = followsPreviousRoot + identicalOpeningChord + tonicEnding + melody.value;
  const bars = chords.length;
  const rationale = `${key} ${mode}; ${romanNumerals.join('–')}; previous-root ${followsPreviousRoot >= 0 ? '+' : ''}${followsPreviousRoot}, identical-opening ${identicalOpeningChord}, tonic-ending +${tonicEnding}, melody ${melody.evaluated ? (melody.value >= 0 ? '+' : '') + melody.value : 'not evaluated'}`;
  return {
    id,
    target: { startMeasure: target.startMeasure, bars },
    chords,
    romanNumerals,
    key,
    mode,
    rationale,
    melodyEvaluated: melody.evaluated,
    score: { followsPreviousRoot, identicalOpeningChord, tonicEnding, melody: melody.value, total },
    catalogOrder
  };
}

function suggestionContext(score: ParsedScore, target: ProgressionTarget, rangeBars: number): { key: string; tonicPc: number; mode: HarmonicMode; capo: number } | ProgressionSuggestionResult {
  const context = contextFor(score, target, rangeBars);
  if ('ok' in context) return context;
  const previous = previousChordAt(score, target);
  if (previous) {
    const parsed = parseChordName(previous);
    if (!parsed?.quality) return { ok: false, code: 'unsupportedQuality', detail: previous };
  }
  return context;
}

/** Suggests up to five deterministic next authored chord names for the target measure. */
export function suggestNextChords(score: ParsedScore, target: ProgressionTarget): ProgressionSuggestionResult {
  const context = suggestionContext(score, target, 1);
  if ('ok' in context) return context;
  const patterns = patternsFor(context.mode);
  const unique = new Map<string, { entry: RomanChord; order: number }>();
  let order = 0;
  for (const pattern of patterns) {
    for (const entry of pattern.chords) {
      const name = chordForContext(entry, context.tonicPc, context.mode, context.capo);
      if (name && !unique.has(name)) unique.set(name, { entry, order });
      order++;
    }
  }
  const candidates = [...unique.entries()].map(([name, value]) =>
    buildCandidate(score, target, [name], [value.entry.roman], context.key, context.tonicPc, context.mode, context.capo, `next-${target.startMeasure}-${value.order}`, value.order)
  );
  candidates.sort((a, b) => b.score.total - a.score.total || a.catalogOrder - b.catalogOrder);
  return { ok: true, candidates: candidates.slice(0, 5) };
}

/** Suggests one of the fixed four-bar patterns, repeated as needed for 8/16 bars. */
export function suggestProgressions(score: ParsedScore, target: ProgressionTarget, bars: ProgressionBars): ProgressionSuggestionResult {
  const context = suggestionContext(score, target, bars);
  if ('ok' in context) return context;
  const candidates = patternsFor(context.mode).flatMap((pattern, catalogOrder) => {
    const generated = generatedPattern(pattern, bars, context.tonicPc, context.mode, context.capo);
    if (!generated) return [];
    return [buildCandidate(score, target, generated.chords, generated.romans, context.key, context.tonicPc, context.mode, context.capo, `${pattern.id}-${bars}-${target.startMeasure}`, catalogOrder)];
  });
  candidates.sort((a, b) => b.score.total - a.score.total || a.catalogOrder - b.catalogOrder);
  return { ok: true, candidates: candidates.slice(0, 5) };
}

/** Quality intervals used by tests and audition validation without duplicating chord parsing rules. */
export function chordTonePitchClasses(name: string, capo: number): ReadonlySet<number> | null {
  const parsed = parseChordName(name);
  if (!parsed?.quality) return null;
  return new Set([
    ...parsed.quality.intervals.map(interval => mod12(parsed.rootPc + capo + interval)),
    ...(parsed.bassPc === undefined ? [] : [mod12(parsed.bassPc + capo)])
  ]);
}

export function supportedSuggestionQuality(name: string): boolean {
  const parsed = parseChordName(name);
  return !!parsed?.quality && CHORD_QUALITIES.some(quality => quality.suffix === parsed.suffix);
}
