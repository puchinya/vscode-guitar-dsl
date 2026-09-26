// GuitarDSL compiler front-end: parses DSL text into the score AST (ParsedScore).
// Rendering (SVG / HTML / PDF) lives in src/render and src/pdf.ts.

import {
  Fraction,
  NoteValuePart,
  ZERO,
  decomposeBeats,
  fadd,
  feq,
  fnum,
  formatNoteValuePart,
  frac,
  fsub,
  parseBeats,
  parseNoteValue,
  parseRhythmDuration,
  parseRhythmDurationDetailed,
  tupletGroups
} from './duration';
import {
  MelodyNote,
  MelodyTokenState,
  NoteTechniques,
  Pitch,
  isGrace,
  parseMelodyToken,
  pitchTextLength,
  takesSyllable,
  tokenizeLyrics
} from './melody';
import { CHORD_LABEL_PATTERN, CHORD_NAME_PATTERN, ChordDefinition, chordKey, isChordDefinitionLine, parseChordDefinition } from './chordDefinition';
import {
  DEFAULT_FEEL,
  DEFAULT_TIME_SIGNATURE,
  Feel,
  ResolvedMeasureContext,
  ScoreEvent,
  TimeSignature,
  applyScoreEvent,
  initialContext,
  measureBeats,
  DIRECTIVE_NAMES,
  parseBpm,
  parseDirective,
  parseFeel,
  parseKeySignature,
  parseTimeSignature,
  sameTimeSignature
} from './scoreEvents';

export type { MelodyNote, NoteTechniques, Pitch, Syllable } from './melody';
export type { ChordDefinition } from './chordDefinition';
export type { Feel, Ottava, ResolvedMeasureContext, ScoreEvent, TimeSignature } from './scoreEvents';
export { parseKeySignature } from './scoreEvents';

export interface RhythmItem {
  duration: string; // '4', '8', '16', '2', '1', 'w', 'h', 'q', '8t', '4+8', 'r...'
  isRest: boolean;
  down: boolean;
  up: boolean;
  ghost: boolean;
  accent: boolean;
  tie: boolean;
  arpeggio?: boolean;
  pitch?: Pitch;
  inlineLyric?: string;
  /** Inline note `{...}` block, or slash modifiers `.pm .lr .stacc .ten .fermata .vib .breath`. */
  techniques?: NoteTechniques;
}

/** Source location of a pitch (`c#4`, octave included when written) in a `mel:` note or an inline note. */
export interface PitchTokenSpan {
  line: number;
  startCol: number;
  endCol: number;
  pitch: Pitch;
  kind: 'melody' | 'inline';
  /** The octave digit is written (otherwise it is inherited from the previous note of `sequence`). */
  explicitOctave: boolean;
  /** Notes sharing octave inheritance: one `mel:` line, or one bar of a measure line. */
  sequence: number;
}

export interface ChordPlacement {
  /** Displayed chord name (without the `@label`). */
  name: string;
  beat: number;
  /** Diagram variant label from `name@label` (spec §7.4). */
  label?: string;
}

/** Source location of one chord token in a measure line (spec §7.1). */
export interface ChordTokenSpan {
  /** 0-based line index. */
  line: number;
  /** Column range [startCol, endCol) of the chord name only (no `@label` or length suffix). */
  startCol: number;
  endCol: number;
  name: string;
  label?: string;
}

/** Source location of one header line; the value range excludes the `key:` prefix. */
export interface HeaderLine {
  /** Lower-case header key as written (e.g. 'capo', 'original_key', 'style_chord_size'). */
  key: string;
  line: number;
  valueStart: number;
  valueEnd: number;
}

export interface MeasureData {
  chord: string;
  chords: ChordPlacement[];
  isMeasureRepeat?: boolean;
  expandedFromRepeat?: boolean;
  repeatStart: boolean;
  repeatEnd: boolean;
  doubleEnd: boolean;
  finalEnd?: boolean;
  bracket?: string; // '1.', '2.'
  specialMark?: string; // 'segno', 'coda', 'fine', 'to_coda', 'dc', 'ds'
  sectionName?: string;
  rhythms: RhythmItem[];
  lyric: string;
  /** Melody assigned by a `mel:` line; undefined when the measure has no melody. */
  melody?: MelodyNote[];
  /** Global zero-based measure index. */
  measureIndex: number;
  /** Musical context in effect for this measure (after `eventsBefore`). */
  context: ResolvedMeasureContext;
  /** Score events applied immediately before this measure, in source order. */
  eventsBefore: ScoreEvent[];
  /** Expected length in quarter beats (the pickup length for a pickup measure). */
  expectedBeats: Fraction;
  isPickup?: boolean;
}

export type DiagnosticSeverity = 'error' | 'warning';

export type DiagnosticCode =
  | 'upperCaseNoteName'
  | 'invalidMelodyNote'
  | 'invalidLength'
  | 'missingInitialOctaveOrLength'
  | 'tooManyMelodyMeasures'
  | 'melodyRepeatWithoutPrevious'
  | 'lyricsWithoutMelody'
  | 'beatCountMismatch'
  | 'syllableCountMismatch'
  | 'lyricBarMismatch'
  | 'measureLyricWithMelody'
  | 'invalidMeasuresPerRow'
  | 'invalidChordDefinition'
  | 'duplicateChordDefinition'
  | 'unknownChordVariant'
  | 'invalidTimeSignature'
  | 'invalidBeatGrouping'
  | 'invalidFeel'
  | 'invalidPickup'
  | 'invalidScoreEvent'
  | 'orphanScoreEvent'
  | 'measureRepeatMeterMismatch'
  | 'invalidTuplet'
  | 'incompleteTupletGroup'
  | 'invalidTechnique'
  | 'techniqueRequiresPitch'
  | 'danglingTechnique'
  | 'danglingGrace'
  | 'nestedSlur'
  | 'unmatchedSlurEnd'
  | 'unclosedSlur';

export interface ScoreDiagnostic {
  /** 0-based line index in the source text. */
  line: number;
  /** 0-based column range [startCol, endCol). */
  startCol: number;
  endCol: number;
  severity: DiagnosticSeverity;
  code: DiagnosticCode;
  args?: Record<string, string | number>;
}

const DIAGNOSTIC_SEVERITY: Record<DiagnosticCode, DiagnosticSeverity> = {
  upperCaseNoteName: 'error',
  invalidMelodyNote: 'error',
  invalidLength: 'error',
  missingInitialOctaveOrLength: 'error',
  tooManyMelodyMeasures: 'error',
  melodyRepeatWithoutPrevious: 'error',
  lyricsWithoutMelody: 'error',
  beatCountMismatch: 'warning',
  syllableCountMismatch: 'warning',
  lyricBarMismatch: 'warning',
  measureLyricWithMelody: 'warning',
  invalidMeasuresPerRow: 'warning',
  invalidChordDefinition: 'error',
  duplicateChordDefinition: 'warning',
  unknownChordVariant: 'warning',
  invalidTimeSignature: 'error',
  invalidBeatGrouping: 'error',
  invalidFeel: 'error',
  invalidPickup: 'error',
  invalidScoreEvent: 'error',
  orphanScoreEvent: 'warning',
  measureRepeatMeterMismatch: 'error',
  invalidTuplet: 'error',
  incompleteTupletGroup: 'warning',
  invalidTechnique: 'error',
  techniqueRequiresPitch: 'error',
  danglingTechnique: 'warning',
  danglingGrace: 'warning',
  nestedSlur: 'warning',
  unmatchedSlurEnd: 'warning',
  unclosedSlur: 'warning'
};

/** Beats of a rhythm token duration ('4', 'q', '8t', '4+8', 'r8', ...). Unknown durations count as 1 beat. */
export function parseDurationToBeats(durationStr: string): number {
  const value = parseRhythmDuration(durationStr);
  return value ? fnum(value.beats) : 1;
}

function rhythmBeatsFraction(durationStr: string): Fraction {
  const value = parseRhythmDuration(durationStr);
  return value ? value.beats : frac(1);
}

/** Rhythmic length of a rhythm item; grace notes take no time. */
export function rhythmItemBeats(item: RhythmItem): Fraction {
  return item.techniques?.grace ? ZERO : rhythmBeatsFraction(item.duration);
}

/** Default slashes of a measure without rhythm tokens (spec §8.6): legacy 4/4 pattern, else one per beat unit. */
export function defaultRhythms(ts: TimeSignature = DEFAULT_TIME_SIGNATURE, length: Fraction = measureBeats(ts)): RhythmItem[] {
  const slash = (duration: string, down: boolean): RhythmItem => ({ duration, isRest: false, down, up: false, ghost: false, accent: false, tie: false });
  if (sameTimeSignature(ts, DEFAULT_TIME_SIGNATURE) && feq(length, frac(4))) {
    return [slash('4', true), slash('4', false), slash('4', true), slash('4', false)];
  }
  const unit = frac(4, ts.denominator);
  const count = frac(length.n * unit.d, length.d * unit.n);
  if (count.d === 1) {
    const groupStarts = new Set<number>();
    let acc = 0;
    for (const g of ts.groups) {
      groupStarts.add(acc);
      acc += g;
    }
    return Array.from({ length: count.n }, (_, i) => slash(String(ts.denominator), groupStarts.has(i)));
  }
  const parts = decomposeBeats(length) ?? [];
  return parts.map((p, i) => slash(p.dotted ? `${p.base}+${p.base * 2}` : formatNoteValuePart(p), i === 0));
}

/**
 * Connection target of `items[i]` (hammer / pull / slide / gliss): the next item that is neither a rest nor
 * a grace note, or -1. Shared by the diagnostics and the renderers so both agree.
 */
export function nextConnectionTarget<T extends { isRest: boolean; techniques?: NoteTechniques }>(items: readonly T[], i: number): number {
  for (let j = i + 1; j < items.length; j++) {
    if (!items[j].isRest && !items[j].techniques?.grace) return j;
  }
  return -1;
}

/** Slash / rest technique modifiers (spec §8.4) and the technique they set. */
const RHYTHM_TECHNIQUE_MODIFIERS: Record<string, keyof NoteTechniques> = {
  pm: 'palmMute',
  lr: 'letRing',
  stacc: 'staccato',
  ten: 'tenuto',
  fermata: 'fermata',
  vib: 'vibrato',
  breath: 'breath'
};
/** Techniques that need a pitch; as slash modifiers they are rejected (`techniqueRequiresPitch`). */
const PITCHED_ONLY_TECHNIQUES: readonly string[] = ['hammer', 'pull', 'slide', 'gliss', 'bend', 'grace', 'slur-start', 'slur-end'];

// Optional `@label` selects a diagram variant (§7.4). Length: ':' = beat count (legacy), '/' followed by a digit = note value.
const CHORD_TOKEN_RE = new RegExp(`^(${CHORD_NAME_PATTERN})(?:@(${CHORD_LABEL_PATTERN}))?(?::([0-9][0-9.]*)|\\/([0-9][0-9.t+{}:]*))?$`);

interface ParsedChordToken {
  name: string;
  label?: string;
  duration?: Fraction;
  invalidLength?: boolean;
}

function parseChordToken(tok: string): ParsedChordToken | null {
  const match = tok.match(CHORD_TOKEN_RE);
  if (!match) return null;
  const base = { name: match[1], label: match[2] };
  if (match[3] !== undefined) {
    const beats = parseBeats(match[3]);
    return beats ? { ...base, duration: beats } : { ...base, invalidLength: true };
  }
  if (match[4] !== undefined) {
    const value = parseNoteValue(match[4]);
    return value ? { ...base, duration: value.beats } : { ...base, invalidLength: true };
  }
  return base;
}

export const DEFAULT_MEASURES_PER_ROW = 4;
const MAX_MEASURES_PER_ROW = 8;

export interface ScoreStyle {
  chordSize?: number;
  lyricSize?: number;
  titleSize?: number;
  sectionSize?: number;
  fontSize?: number;
}

export interface ScorePage {
  pageNumber: number;
  measures: MeasureData[];
}

export interface ParsedScore {
  title: string;
  artist: string;
  capo: string;
  originalKey: string;
  bpm: string;
  memo: string;
  style: ScoreStyle;
  /** Diagram keys (`name` or `name@label`) in order of first use. */
  usedChords: string[];
  /** `chord` definitions in source order (first definition of a key wins). */
  chordDefinitions: ChordDefinition[];
  measures: MeasureData[];
  pages: ScorePage[];
  /** Sharps (> 0) / flats (< 0) derived from `key:`; null when the key cannot be parsed. */
  keySignature: number | null;
  showRhythm: boolean;
  measuresPerRow: number;
  expandPageBreakRepeats: boolean;
  diagnostics: ScoreDiagnostic[];
  /** Chord tokens written in measure lines, in source order (repeats `%` add none). */
  chordTokens?: ChordTokenSpan[];
  /** Header lines in source order. */
  headerLines?: HeaderLine[];
  /** First line of the body (section, measure, melody, lyric, score event or page break); undefined when none. */
  firstBodyLine?: number;
  /** Initial time signature (`time:`, default 4/4). */
  timeSignature: TimeSignature;
  /** Initial feel (`feel:`, default straight). */
  feel: Feel;
  /** Pickup length in quarter beats (`pickup:`); undefined when none or invalid. */
  pickup?: Fraction;
  /** Valid score events in source order (orphans after the last measure included). */
  events: ScoreEvent[];
  /** Pitches of `mel:` notes and inline notes, in source order. */
  pitchTokens?: PitchTokenSpan[];
}

/** Column of `tok` in `rawLine` at or after `from`, delimited like a measure token; -1 when absent. */
function locateToken(rawLine: string, tok: string, from: number): number {
  for (let at = rawLine.indexOf(tok, from); at >= 0; at = rawLine.indexOf(tok, at + 1)) {
    const before = at === 0 ? '' : rawLine[at - 1];
    const after = rawLine[at + tok.length] ?? '';
    if ((before === '' || /[\s|:]/.test(before)) && (after === '' || /[\s|:\]]/.test(after))) return at;
  }
  return -1;
}

/** A `mel:` line: the notes it produced (in order) and the note index range of each cell. */
interface MelodyGroup {
  notes: MelodyNote[];
  cellRanges: { start: number; end: number }[];
  verseCount: number;
}

export interface ParseGuitarDslOptions {
  expandPageBreakRepeats?: boolean;
}

export function parseGuitarDsl(dslContent: string, options?: ParseGuitarDslOptions): ParsedScore {
  const lines = dslContent.split(/\r?\n/);

  let title = 'Guitar Rhythm Score';
  let artist = '';
  let capo = '0';
  let originalKey = 'C';
  let bpm = '90';
  let memo = '';
  let showRhythm = true;
  let measuresPerRow = DEFAULT_MEASURES_PER_ROW;
  let expandPageBreakRepeats = options?.expandPageBreakRepeats ?? true;
  const style: ScoreStyle = {};
  const diagnostics: ScoreDiagnostic[] = [];

  const measures: MeasureData[] = [];
  const pages: ScorePage[] = [{ pageNumber: 1, measures: [] }];
  let currentPageIndex = 0;
  let currentSection = '';
  const usedChordsSet = new Set<string>();
  const chordDefinitions: ChordDefinition[] = [];
  const chordUses: { key: string; line: number; startCol: number; endCol: number }[] = [];
  const chordTokens: ChordTokenSpan[] = [];
  const headerLines: HeaderLine[] = [];
  let firstBodyLine: number | undefined;
  const markBody = (lineIdx: number) => {
    if (firstBodyLine === undefined) firstBodyLine = lineIdx;
  };

  let timeSignature: TimeSignature = DEFAULT_TIME_SIGNATURE;
  let feel: Feel = DEFAULT_FEEL;
  let pickup: { value: Fraction; line: number; startCol: number; endCol: number } | undefined;
  let pickupBeats: Fraction | undefined;
  const events: ScoreEvent[] = [];
  const pitchTokens: PitchTokenSpan[] = [];
  let pitchSequence = 0;

  // Checks that need the resolved measure context run after all lines are read (see resolveMeasures).
  interface LengthCheck { measureIdx: number; line: number; startCol: number; endCol: number; beats: Fraction; heads: { part: NoteValuePart }[] }
  const lengthChecks: LengthCheck[] = [];
  const defaultRhythmMeasures = new Set<MeasureData>();
  const equalSplitChords = new Set<MeasureData>();
  const repeatChecks: { measureIdx: number; line: number; startCol: number; endCol: number }[] = [];
  interface NoteLocation { line: number; startCol: number; endCol: number }
  const melodyLocations = new WeakMap<MelodyNote, NoteLocation>();
  const inlineLocations = new WeakMap<RhythmItem, NoteLocation>();
  const newMeasure = (fields: Omit<MeasureData, 'measureIndex' | 'context' | 'eventsBefore' | 'expectedBeats'>): MeasureData => ({
    ...fields,
    measureIndex: measures.length,
    context: initialContext({ key: originalKey, bpm, timeSignature, feel }),
    eventsBefore: [],
    expectedBeats: frac(4)
  });

  // Index of the first measure that has not received a melody yet (§12.3).
  let melodyCursor = 0;
  let lastMelodyGroup: MelodyGroup | null = null;

  const report = (lineIdx: number, startCol: number, endCol: number, code: DiagnosticCode, args?: Record<string, string | number>) => {
    diagnostics.push({ line: lineIdx, startCol, endCol: Math.max(endCol, startCol + 1), severity: DIAGNOSTIC_SEVERITY[code], code, args });
  };

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const rawLine = lines[lineIdx];
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const lineStart = rawLine.indexOf(line);
    const lineEnd = lineStart + line.length;

    // Page break: --- or pagebreak
    if (/^---+$/.test(line) || /^pagebreak$/i.test(line)) {
      markBody(lineIdx);
      if (pages[currentPageIndex].measures.length > 0) {
        currentPageIndex++;
        pages.push({ pageNumber: currentPageIndex + 1, measures: [] });
      }
      melodyCursor = measures.length;
      lastMelodyGroup = null;
      continue;
    }

    // Chord diagram definition: chord C@barre = x35553 base:3
    if (isChordDefinitionLine(line)) {
      const result = parseChordDefinition(line);
      if (!result.ok) {
        report(lineIdx, lineStart, lineEnd, 'invalidChordDefinition', { reason: result.error, detail: result.detail });
      } else {
        const key = chordKey(result.definition.name, result.definition.label);
        if (chordDefinitions.some(d => chordKey(d.name, d.label) === key)) {
          report(lineIdx, lineStart, lineEnd, 'duplicateChordDefinition', { chord: key });
        } else {
          chordDefinitions.push({ ...result.definition, line: lineIdx });
        }
      }
      continue;
    }

    // Score event: @key: D, @tempo: 132, ... (spec §16). Applies before the next measure.
    const directiveMatch = rawLine.match(/^(\s*@)([A-Za-z_]+)(\s*:)(.*)$/);
    if (directiveMatch) {
      markBody(lineIdx);
      const name = directiveMatch[2].toLowerCase();
      const nameStart = directiveMatch[1].length - 1;
      const bodyStart = directiveMatch[1].length + directiveMatch[2].length + directiveMatch[3].length;
      const body = directiveMatch[4];
      const comment = body.search(/\s+#/);
      const rawValue = comment >= 0 ? body.slice(0, comment) : body;
      const valueStart = bodyStart + (rawValue.length - rawValue.trimStart().length);
      const valueEnd = bodyStart + rawValue.trimEnd().length;
      const parsed = parseDirective(name, rawValue);
      if (parsed.ok) {
        events.push({ ...parsed.payload, directive: `@${name}`, line: lineIdx, valueStart, valueEnd, beforeMeasure: measures.length });
      } else if (!DIRECTIVE_NAMES.includes(name)) {
        report(lineIdx, nameStart, bodyStart, 'invalidScoreEvent', { directive: `@${name}`, value: rawValue.trim() });
      } else {
        report(lineIdx, valueStart, valueEnd, parsed.code, { directive: `@${name}`, value: rawValue.trim() });
      }
      continue;
    }

    // Headers
    const headerMatch = line.match(/^(title|artist|capo|key|original_key|tempo|bpm|memo|show_rhythm|rhythm|measures_per_row|bars_per_row|time|time_signature|meter|feel|pickup|expand_page_break_repeats|expand_page_break_repeat|expand_page_repeats|expand_page_repeat|(?:style_)?(?:chord_size|lyric_size|title_size|section_size|font_size)):\s*(.*)$/i);
    if (headerMatch) {
      const key = headerMatch[1].toLowerCase().replace(/^style_/, '');
      const val = headerMatch[2].trim();
      // Value range without a trailing comment (whitespace + `#`, spec §2.3).
      const inlineComment = headerMatch[2].search(/\s+#/);
      const rawValue = inlineComment >= 0 ? headerMatch[2].slice(0, inlineComment) : headerMatch[2];
      const valueStart = lineEnd - headerMatch[2].length;
      headerLines.push({ key: headerMatch[1].toLowerCase(), line: lineIdx, valueStart, valueEnd: valueStart + rawValue.length });
      if (key === 'title') title = val;
      else if (key === 'artist') artist = val;
      else if (key === 'capo') capo = rawValue.trim();
      else if (key === 'key' || key === 'original_key') originalKey = val;
      else if (key === 'bpm' || key === 'tempo') bpm = val;
      else if (key === 'memo') memo = val;
      else if (key === 'time' || key === 'time_signature' || key === 'meter') {
        const ts = parseTimeSignature(rawValue);
        if (ts.ok) timeSignature = ts.value;
        else report(lineIdx, valueStart, valueStart + rawValue.length, ts.code, { directive: headerMatch[1], value: rawValue.trim() });
      } else if (key === 'feel') {
        const f = parseFeel(rawValue);
        if (f) feel = f;
        else report(lineIdx, valueStart, valueStart + rawValue.length, 'invalidFeel', { directive: headerMatch[1], value: rawValue.trim() });
      } else if (key === 'pickup') {
        const v = parseNoteValue(rawValue.trim());
        if (v) pickup = { value: v.beats, line: lineIdx, startCol: valueStart, endCol: valueStart + rawValue.length };
        else report(lineIdx, valueStart, valueStart + rawValue.length, 'invalidPickup', { value: rawValue.trim() });
      }
      else if (key.startsWith('expand_page')) {
        const v = val.toLowerCase();
        if (['false', 'off', 'no', '0'].includes(v)) expandPageBreakRepeats = false;
        else if (['true', 'on', 'yes', '1'].includes(v)) expandPageBreakRepeats = true;
      } else if (key === 'show_rhythm' || key === 'rhythm') {
        const v = val.toLowerCase();
        if (['false', 'off', 'no', '0'].includes(v)) showRhythm = false;
        else if (['true', 'on', 'yes', '1'].includes(v)) showRhythm = true;
      } else if (key === 'measures_per_row' || key === 'bars_per_row') {
        const n = Number(val);
        if (Number.isInteger(n) && n >= 1 && n <= MAX_MEASURES_PER_ROW) {
          measuresPerRow = n;
        } else {
          measuresPerRow = DEFAULT_MEASURES_PER_ROW;
          report(lineIdx, lineStart, lineEnd, 'invalidMeasuresPerRow', { value: val });
        }
      } else if (key === 'chord_size') {
        const n = parseFloat(val);
        if (!isNaN(n) && n > 0) style.chordSize = n;
      } else if (key === 'lyric_size') {
        const n = parseFloat(val);
        if (!isNaN(n) && n > 0) style.lyricSize = n;
      } else if (key === 'title_size') {
        const n = parseFloat(val);
        if (!isNaN(n) && n > 0) style.titleSize = n;
      } else if (key === 'section_size') {
        const n = parseFloat(val);
        if (!isNaN(n) && n > 0) style.sectionSize = n;
      } else if (key === 'font_size') {
        const n = parseFloat(val);
        if (!isNaN(n) && n > 0) style.fontSize = n;
      }
      continue;
    }

    // Section label [Intro], [Aメロ] etc
    const secMatch = line.match(/^\[([^\]]+)\]$/);
    if (secMatch) {
      markBody(lineIdx);
      currentSection = secMatch[1];
      melodyCursor = measures.length;
      lastMelodyGroup = null;
      continue;
    }

    // Melody line: mel: | e4/8 d c | ... |
    const melMatch = rawLine.match(/^(\s*mel:)(.*)$/i);
    if (melMatch) {
      markBody(lineIdx);
      lastMelodyGroup = parseMelodyLine(rawLine, melMatch[1].length, lineIdx);
      continue;
    }

    // Syllable lyric line: lyr: あさの ひかりを | ...
    const lyrMatch = rawLine.match(/^(\s*lyr:)(.*)$/i);
    if (lyrMatch) {
      markBody(lineIdx);
      if (!lastMelodyGroup) {
        report(lineIdx, lineStart, lineEnd, 'lyricsWithoutMelody');
      } else {
        assignLyrics(lastMelodyGroup, lyrMatch[2], lineIdx, lineStart, lineEnd);
      }
      continue;
    }

    // Measure line: | C | 4.d 4.d 4.d 4.d l:"..." | or | C 4.d ... |
    if (line.includes('|')) {
      markBody(lineIdx);
      parseMeasureLine(rawLine, lineIdx);
    }
  }

  function parseMeasureLine(rawLine: string, lineIdx: number) {
    const rawBars = rawLine.split('|').map(s => s.trim()).filter(s => s.length > 0 && s !== ':' && s !== ']' && s !== ':]');

    const bars: string[] = [];
    const CHORD_REGEX = new RegExp(`^${CHORD_NAME_PATTERN}(?:@${CHORD_LABEL_PATTERN})?(?::[0-9][0-9.]*|\\/[0-9][0-9.t+{}:]*)?$`);
    const RHYTHM_REGEX = /^(?:r?(?:(?:16|8|4|2|1)(?:t|\{[0-9]+:[0-9]+\})?(?:\+(?:16|8|4|2|1)(?:t|\{[0-9]+:[0-9]+\})?)*|w|h|q)|r[a-z0-9]*)(\.[a-z][a-z0-9:\-]*)*$/;
    const NOTE_TOKEN_REGEX = /^[a-g][#b]?[0-9]?(?:\/|:|$|~|\{)/;
    let searchPos = 0;

    let bi = 0;
    while (bi < rawBars.length) {
      const cur = rawBars[bi];
      const next = rawBars[bi + 1];
      const curTokens = cur.replace(/^:+|:+$/g, '').trim().split(/\s+/).filter(Boolean);
      const isCurOnlyChords = curTokens.length >= 1 && curTokens.every(t => CHORD_REGEX.test(t));

      if (isCurOnlyChords && next) {
        const nextClean = next.replace(/l:\"[^\"]*\"/, '').trim();
        const nextTokens = nextClean.replace(/^:+|:+$/g, '').trim().split(/\s+/).filter(Boolean);
        const nextHasChord = nextTokens.some(t => CHORD_REGEX.test(t));
        const isNoteToken = (t: string) => NOTE_TOKEN_REGEX.test(t);
        const nextHasRhythm = nextTokens.some(t => RHYTHM_REGEX.test(t.split('.')[0]) || t === '%' || isNoteToken(t));

        if (!nextHasChord && nextHasRhythm) {
          bars.push(cur + ' ' + next);
          bi += 2;
          continue;
        }
      }
      bars.push(cur);
      bi++;
    }

    for (let barIdx = 0; barIdx < bars.length; barIdx++) {
      const bar = bars[barIdx];
      if (bar === ':' || bar === '') continue;

      let mLyric = '';
      let cleanBar = bar;

      // Extract l:"..."
      const lyricMatch = cleanBar.match(/l:\"([^\"]*)\"/);
      if (lyricMatch) {
        mLyric = lyricMatch[1];
        cleanBar = cleanBar.replace(/l:\"([^\"]*)\"/, '').trim();
      }

      let rStart = false;
      let rEnd = false;
      let dEnd = false;
      let fEnd = false;

      if (cleanBar.startsWith(':')) {
        rStart = true;
        cleanBar = cleanBar.replace(/^:+/, '').trim();
      } else if (barIdx === 0 && rawLine.trim().startsWith('|:')) {
        rStart = true;
      }

      if (cleanBar.endsWith(':')) {
        rEnd = true;
        cleanBar = cleanBar.replace(/:+$/, '').trim();
      } else if (barIdx === bars.length - 1 && rawLine.trim().endsWith(':|')) {
        rEnd = true;
      }

      if (barIdx === bars.length - 1) {
        const trimmedLine = rawLine.trim();
        if (trimmedLine.endsWith('|]') || trimmedLine.endsWith(':|]')) {
          fEnd = true;
        } else if (trimmedLine.endsWith('||')) {
          dEnd = true;
        }
      }
      if (cleanBar.endsWith(']') && !/\[[^\]]+\]$/.test(cleanBar)) {
        fEnd = true;
        cleanBar = cleanBar.replace(/\]+$/, '').trim();
      }

      if (cleanBar.endsWith('||')) {
        dEnd = true;
        cleanBar = cleanBar.replace(/\|\|+$/, '').trim();
      }

      const tokens = cleanBar.split(/\s+/);
      interface RawParsedChord {
        name: string;
        label?: string;
        duration?: Fraction;
        accumBeatAtToken: number;
      }
      const rawChords: RawParsedChord[] = [];
      const rhythms: RhythmItem[] = [];
      let runningBeat = ZERO;
      let isMeasureRepeat = false;
      let invalidChordLength = false;
      let firstTokenCol = -1;
      let mBracket: string | undefined = undefined;
      let mSpecialMark: string | undefined = undefined;
      const inlineMelodyState: MelodyTokenState = {
        octave: 4,
        length: { parts: [{ base: 8, dotted: false }], beats: frac(1, 2) }
      };
      const barSequence = pitchSequence++;
      let repeatTokenCol = -1;
      let multiChordEqualSplit = false;

      for (let tokIdx = 0; tokIdx < tokens.length; tokIdx++) {
        const tok = tokens[tokIdx];
        if (!tok || tok === ':' || tok === '|') continue;
        const found = rawLine.indexOf(tok, searchPos);
        const tokCol = found >= 0 ? found : searchPos;
        if (found >= 0) searchPos = found + tok.length;
        if (firstTokenCol < 0) firstTokenCol = tokCol;

        if (tok === '%') {
          isMeasureRepeat = true;
          repeatTokenCol = tokCol;
          continue;
        }

        const bracketMatch = tok.match(/^\[([0-9]+[.,\-0-9]*)\]$/);
        if (bracketMatch) {
          mBracket = bracketMatch[1];
          continue;
        }

        if (tok.toLowerCase() === 'to' && tokens[tokIdx + 1]?.toLowerCase() === 'coda') {
          mSpecialMark = 'to_coda';
          tokIdx++;
          continue;
        }

        const markMatch = tok.match(/^(D\.C\.|D\.S\.|Fine|Coda|Segno|to_?Coda)$/i);
        if (markMatch) {
          let norm = markMatch[1].toLowerCase().replace(/[\s.]+/g, '_').replace(/^_|_$/g, '');
          if (norm === 'd_c') norm = 'dc';
          if (norm === 'd_s') norm = 'ds';
          mSpecialMark = norm;
          continue;
        }

        const parsedChord = parseChordToken(tok);
        if (parsedChord) {
          if (parsedChord.invalidLength) {
            invalidChordLength = true;
            report(lineIdx, tokCol, tokCol + tok.length, 'invalidLength', { token: tok });
          }
          rawChords.push({
            name: parsedChord.name,
            label: parsedChord.label,
            duration: parsedChord.duration,
            accumBeatAtToken: fnum(runningBeat)
          });
          const key = chordKey(parsedChord.name, parsedChord.label);
          usedChordsSet.add(key);
          const spanCol = locateToken(rawLine, tok, tokCol);
          if (spanCol >= 0) {
            const span: ChordTokenSpan = { line: lineIdx, startCol: spanCol, endCol: spanCol + parsedChord.name.length, name: parsedChord.name };
            if (parsedChord.label !== undefined) span.label = parsedChord.label;
            chordTokens.push(span);
            // Continue after the adopted position: an earlier match (e.g. inside l:"...") must not be reused.
            searchPos = Math.max(searchPos, spanCol + tok.length);
          }
          if (parsedChord.label !== undefined) {
            chordUses.push({ key, line: lineIdx, startCol: tokCol, endCol: tokCol + tok.length });
          }
        } else if (RHYTHM_REGEX.test(tok)) {
          // Rhythm token e.g. 4.d, 8.u, 16.d.a, rq, 8t.d, 8{5:4}.d, 4+8.d, 4.pm, etc.
          const parts = tok.split('.');
          const dur = parts[0];
          const isRest = dur.startsWith('r');
          const durationValue = parseRhythmDurationDetailed(dur);
          if (durationValue === 'invalidTuplet') {
            report(lineIdx, tokCol, tokCol + tok.length, 'invalidTuplet', { token: tok });
            continue;
          }
          let down = false, up = false, ghost = false, accent = false, tie = false, arpeggio = false;
          let inlineL: string | undefined = undefined;
          const techniques: NoteTechniques = {};
          let techniqueError: 'invalidTechnique' | 'techniqueRequiresPitch' | undefined;

          for (let i = 1; i < parts.length; i++) {
            const mod = parts[i];
            if (mod === 'd') down = true;
            else if (mod === 'u') up = true;
            else if (mod === 'g' || mod === 'ghost') ghost = true;
            else if (mod === 'a' || mod === 'accent') accent = true;
            else if (mod === 't' || mod === 'tie') tie = true;
            else if (mod === 'arp' || mod === 'arpeggio') arpeggio = true;
            else if (RHYTHM_TECHNIQUE_MODIFIERS[mod]) {
              const key = RHYTHM_TECHNIQUE_MODIFIERS[mod];
              if (isRest && key !== 'fermata' && key !== 'breath') techniqueError = 'techniqueRequiresPitch';
              else (techniques as Record<string, unknown>)[key] = true;
            } else if (PITCHED_ONLY_TECHNIQUES.includes(mod.replace(/:.*$/, ''))) {
              techniqueError = 'techniqueRequiresPitch';
            }
          }
          if (techniqueError) report(lineIdx, tokCol, tokCol + tok.length, techniqueError, { token: tok });

          const item: RhythmItem = {
            duration: dur,
            isRest,
            down,
            up,
            ghost,
            accent,
            tie,
            arpeggio: arpeggio || undefined,
            inlineLyric: inlineL
          };
          if (Object.keys(techniques).length > 0) item.techniques = techniques;
          rhythms.push(item);
          runningBeat = fadd(runningBeat, rhythmBeatsFraction(dur));
        } else if (NOTE_TOKEN_REGEX.test(tok)) {
          // Inline arpeggio / melody note token (e.g. c3/8, e4, g4/4, f#4:0.5, a4/8{hammer})
          const parsed = parseMelodyToken(tok, inlineMelodyState);
          if (typeof parsed !== 'string') {
            const baseParts = parsed.parts;
            const primaryBase = baseParts[0]?.base ?? 8;
            let durStr = String(primaryBase);
            if (baseParts[0]?.tuplet) durStr = formatNoteValuePart(baseParts[0]);
            else if (baseParts[0]?.dotted) durStr = `${primaryBase}+${primaryBase * 2}`;

            const item: RhythmItem = {
              duration: durStr,
              isRest: parsed.isRest,
              down: false,
              up: false,
              ghost: false,
              accent: false,
              tie: parsed.tieToNext,
              pitch: parsed.pitch
            };
            if (parsed.techniques) item.techniques = parsed.techniques;
            rhythms.push(item);
            inlineLocations.set(item, { line: lineIdx, startCol: tokCol, endCol: tokCol + tok.length });
            if (parsed.pitch) {
              const len = pitchTextLength(tok);
              pitchTokens.push({
                line: lineIdx,
                startCol: tokCol,
                endCol: tokCol + len,
                pitch: parsed.pitch,
                kind: 'inline',
                explicitOctave: /[0-9]$/.test(tok.slice(0, len)),
                sequence: barSequence
              });
            }
            runningBeat = fadd(runningBeat, parsed.beats);
          } else {
            report(lineIdx, tokCol, tokCol + tok.length, parsed, { token: tok });
          }
        }
      }

      if (!isMeasureRepeat && rhythms.length > 0) {
        const col = firstTokenCol >= 0 ? firstTokenCol : 0;
        const heads = rhythms.filter(r => !r.techniques?.grace).flatMap(r => (parseRhythmDuration(r.duration)?.parts ?? []).map(part => ({ part })));
        lengthChecks.push({ measureIdx: measures.length, line: lineIdx, startCol: col, endCol: searchPos, beats: runningBeat, heads });
      }
      if (isMeasureRepeat && repeatTokenCol >= 0) {
        repeatChecks.push({ measureIdx: measures.length, line: lineIdx, startCol: repeatTokenCol, endCol: repeatTokenCol + 1 });
      }

      let barChords: ChordPlacement[] = [];
      if (rawChords.length === 1) {
        barChords = [placement(rawChords[0], rawChords[0].accumBeatAtToken)];
      } else if (rawChords.length > 1) {
        const allChordsBeforeRhythm = rawChords.every(c => c.accumBeatAtToken === 0);
        if (allChordsBeforeRhythm) {
          const anyHasDuration = rawChords.some(c => c.duration !== undefined);
          if (anyHasDuration && !invalidChordLength) {
            let curB = ZERO;
            barChords = rawChords.map(c => {
              const b = curB;
              curB = fadd(curB, c.duration ?? frac(2));
              return placement(c, fnum(b));
            });
          } else {
            // Positions are fixed once the measure length is known (resolveMeasures).
            const step = 4.0 / rawChords.length;
            barChords = rawChords.map((c, idx) => placement(c, idx * step));
            multiChordEqualSplit = true;
          }
        } else {
          barChords = rawChords.map(c => placement(c, c.accumBeatAtToken));
        }
      } else if (isMeasureRepeat && measures.length > 0) {
        const prev = measures[measures.length - 1];
        if (prev.chords && prev.chords.length > 0) {
          barChords = prev.chords.map(c => ({ ...c }));
        } else if (prev.chord) {
          barChords = [{ name: prev.chord, beat: 0 }];
        }
        barChords.forEach(c => usedChordsSet.add(chordKey(c.name, c.label)));
      }

      const mData: MeasureData = newMeasure({
        chord: barChords.length > 0 ? barChords[0].name : '',
        chords: barChords,
        isMeasureRepeat,
        repeatStart: rStart,
        repeatEnd: rEnd,
        doubleEnd: dEnd,
        finalEnd: fEnd,
        bracket: mBracket,
        specialMark: mSpecialMark,
        sectionName: currentSection,
        rhythms: isMeasureRepeat ? [] : (rhythms.length > 0 ? rhythms : defaultRhythms()),
        lyric: mLyric
      });
      if (!isMeasureRepeat && rhythms.length === 0) defaultRhythmMeasures.add(mData);
      if (multiChordEqualSplit) equalSplitChords.add(mData);
      measures.push(mData);
      pages[currentPageIndex].measures.push(mData);
      currentSection = ''; // consume section for the first bar
    }
  }

  function placement(c: { name: string; label?: string }, beat: number): ChordPlacement {
    return c.label !== undefined ? { name: c.name, beat, label: c.label } : { name: c.name, beat };
  }

  function parseMelodyLine(rawLine: string, bodyStart: number, lineIdx: number): MelodyGroup {
    const group: MelodyGroup = { notes: [], cellRanges: [], verseCount: 0 };
    const state: MelodyTokenState = {};
    const sequence = pitchSequence++;

    // Split the body into cells at '|', keeping source columns.
    const cells: { text: string; col: number }[] = [];
    let cellStart = bodyStart;
    for (let i = bodyStart; i <= rawLine.length; i++) {
      if (i === rawLine.length || rawLine[i] === '|') {
        const text = rawLine.slice(cellStart, i);
        if (text.trim()) cells.push({ text, col: cellStart });
        cellStart = i + 1;
      }
    }

    let prevNote: MelodyNote | null = null;
    for (const cell of cells) {
      const cellEnd = cell.col + cell.text.length;
      const trimmedCol = cell.col + (cell.text.length - cell.text.trimStart().length);
      const trimmedEnd = cell.col + cell.text.trimEnd().length;

      if (melodyCursor >= measures.length) {
        report(lineIdx, trimmedCol, trimmedEnd, 'tooManyMelodyMeasures');
        continue;
      }
      const measureIdx = melodyCursor++;
      const measure = measures[measureIdx];
      const start = group.notes.length;
      let notes: MelodyNote[] = [];

      if (cell.text.trim() === '%') {
        repeatChecks.push({ measureIdx, line: lineIdx, startCol: trimmedCol, endCol: trimmedEnd });
        const prevMelody = measureIdx > 0 ? measures[measureIdx - 1].melody : undefined;
        if (!prevMelody) {
          report(lineIdx, trimmedCol, trimmedEnd, 'melodyRepeatWithoutPrevious');
        } else {
          notes = prevMelody.map(n => ({ ...n, pitch: n.pitch ? { ...n.pitch } : undefined, tiedFromPrev: false, syllables: [] }));
          const last = prevMelody[prevMelody.length - 1];
          if (last) state.octave = last.pitch?.octave ?? state.octave;
        }
      } else {
        const re = /\S+/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(cell.text)) !== null) {
          const col = cell.col + m.index;
          const parsed = parseMelodyToken(m[0], state);
          if (typeof parsed === 'string') {
            report(lineIdx, col, col + m[0].length, parsed, { token: m[0] });
            continue;
          }
          notes.push(parsed);
          melodyLocations.set(parsed, { line: lineIdx, startCol: col, endCol: col + m[0].length });
          if (parsed.pitch) {
            const len = pitchTextLength(m[0]);
            pitchTokens.push({
              line: lineIdx,
              startCol: col,
              endCol: col + len,
              pitch: parsed.pitch,
              kind: 'melody',
              explicitOctave: /[0-9]$/.test(m[0].slice(0, len)),
              sequence
            });
          }
        }
      }

      for (const note of notes) {
        if (prevNote?.tieToNext && !note.isRest) note.tiedFromPrev = true;
        prevNote = note;
      }

      measure.melody = notes;
      group.notes.push(...notes);
      group.cellRanges.push({ start, end: group.notes.length });

      if (measure.lyric) {
        report(lineIdx, trimmedCol, trimmedEnd, 'measureLyricWithMelody');
      }
      const total = notes.reduce((acc, n) => fadd(acc, n.beats), ZERO);
      // A `%` cell copies an already checked measure (a meter mismatch is reported by resolveMeasures).
      if (notes.length > 0 && cell.text.trim() !== '%') {
        const heads = notes.filter(n => !isGrace(n)).flatMap(n => n.parts.map(part => ({ part })));
        lengthChecks.push({ measureIdx, line: lineIdx, startCol: trimmedCol, endCol: Math.min(trimmedEnd, cellEnd), beats: total, heads });
      }
    }
    return group;
  }

  function assignLyrics(group: MelodyGroup, text: string, lineIdx: number, lineStart: number, lineEnd: number) {
    const verse = group.verseCount++;
    const items = tokenizeLyrics(text);
    const sung = group.notes.map((n, idx) => ({ n, idx })).filter(x => takesSyllable(x.n));

    let noteCursor = 0;
    let consumed = 0;
    for (const item of items) {
      if (item.kind === 'bar') continue;
      consumed++;
      if (noteCursor >= sung.length) continue;
      const note = sung[noteCursor++].n;
      if (item.kind === 'syllable') {
        note.syllables[verse] = { text: item.text, hyphenToNext: item.hyphenToNext, extend: false };
      } else if (item.kind === 'extend') {
        note.syllables[verse] = { text: '', hyphenToNext: false, extend: true };
      } else {
        note.syllables[verse] = null;
      }
    }
    if (consumed !== sung.length) {
      report(lineIdx, lineStart, lineEnd, 'syllableCountMismatch', { syllables: consumed, notes: sung.length });
    }

    // Optional '|' markers: each segment must cover exactly the sung notes of the matching cell.
    if (items.some(i => i.kind === 'bar')) {
      const segments: number[] = [];
      let count = 0;
      let seenContent = false;
      for (const item of items) {
        if (item.kind === 'bar') {
          if (seenContent) segments.push(count);
          count = 0;
          seenContent = false;
        } else {
          count++;
          seenContent = true;
        }
      }
      if (seenContent) segments.push(count);
      const expected = group.cellRanges.map(r => group.notes.slice(r.start, r.end).filter(takesSyllable).length);
      const matches = segments.length === expected.length && segments.every((c, i) => c === expected[i]);
      if (!matches) {
        report(lineIdx, lineStart, lineEnd, 'lyricBarMismatch');
      }
    }
  }

  // `name@label` references need a matching definition (definitions may appear anywhere in the file).
  const definedKeys = new Set(chordDefinitions.map(d => chordKey(d.name, d.label)));
  for (const use of chordUses) {
    if (!definedKeys.has(use.key)) {
      report(use.line, use.startCol, use.endCol, 'unknownChordVariant', { chord: use.key });
    }
  }

  resolveMeasures();
  validateConnections();

  /** Applies score events, resolves each measure's context and runs the length / meter checks. */
  function resolveMeasures() {
    const initialBpm = parseBpm(bpm);
    const initialLength = measureBeats(timeSignature);
    let validPickup: Fraction | undefined;
    if (pickup) {
      if (pickup.value.n > 0 && fsub(initialLength, pickup.value).n > 0) validPickup = pickup.value;
      else report(pickup.line, pickup.startCol, pickup.endCol, 'invalidPickup', { value: formatBeats(pickup.value) });
    }
    pickupBeats = validPickup;

    const byMeasure = new Map<number, ScoreEvent[]>();
    for (const ev of events) {
      if (ev.beforeMeasure >= measures.length) {
        report(ev.line, ev.valueStart, ev.valueEnd, 'orphanScoreEvent', { directive: ev.directive });
        continue;
      }
      const list = byMeasure.get(ev.beforeMeasure) ?? [];
      list.push(ev);
      byMeasure.set(ev.beforeMeasure, list);
    }

    let ctx = initialContext({ key: originalKey, bpm, timeSignature, feel });
    measures.forEach((m, i) => {
      const before = byMeasure.get(i) ?? [];
      for (const ev of before) ctx = applyScoreEvent(ctx, ev, initialBpm);
      m.measureIndex = i;
      m.context = ctx;
      m.eventsBefore = before;
      const full = measureBeats(ctx.timeSignature);
      if (i === 0 && validPickup) {
        m.expectedBeats = validPickup;
        m.isPickup = true;
      } else {
        m.expectedBeats = full;
      }
      if (defaultRhythmMeasures.has(m)) m.rhythms = defaultRhythms(ctx.timeSignature, m.expectedBeats);
      if (equalSplitChords.has(m)) {
        const step = fnum(m.expectedBeats) / m.chords.length;
        m.chords = m.chords.map((c, idx) => ({ ...c, beat: idx * step }));
      }
    });

    const last = measures.length - 1;
    for (const check of lengthChecks) {
      const m = measures[check.measureIdx];
      if (!m) continue;
      const completesPickup = validPickup !== undefined && check.measureIdx === last && last > 0
        && sameTimeSignature(m.context.timeSignature, timeSignature) && feq(check.beats, fsub(initialLength, validPickup));
      if (!feq(check.beats, m.expectedBeats) && !completesPickup) {
        report(check.line, check.startCol, check.endCol, 'beatCountMismatch', { beats: formatBeats(check.beats), expected: formatBeats(m.expectedBeats) });
      }
      if (tupletGroups(check.heads).some(g => !g.complete)) {
        report(check.line, check.startCol, check.endCol, 'incompleteTupletGroup');
      }
    }
    for (const check of repeatChecks) {
      const m = measures[check.measureIdx];
      const prev = measures[check.measureIdx - 1];
      if (m && prev && !sameTimeSignature(m.context.timeSignature, prev.context.timeSignature)) {
        report(check.line, check.startCol, check.endCol, 'measureRepeatMeterMismatch');
      }
    }
  }

  /** Connection targets, slurs and grace notes (spec §12.2.1) over the melody and the inline-note sequences. */
  function validateConnections() {
    const melody = measures.flatMap(m => (m.melody ?? []).map(n => ({ n, loc: melodyLocations.get(n), measure: m })));
    const inline = measures.flatMap(m => (m.isMeasureRepeat ? [] : m.rhythms).map(r => ({ n: r, loc: inlineLocations.get(r), measure: m })));
    const check = <T extends { isRest: boolean; techniques?: NoteTechniques; pitch?: Pitch }>(seq: { n: T; loc?: NoteLocation; measure: MeasureData }[]) => {
      const items = seq.map(s => s.n);
      let openSlur: NoteLocation | undefined;
      let openSlurSeen = false;
      seq.forEach(({ n, loc, measure }, i) => {
        const tech = n.techniques;
        if (!tech || !loc) return;
        if (tech.connection) {
          const target = nextConnectionTarget(items, i);
          if (target < 0 || !items[target].pitch) {
            report(loc.line, loc.startCol, loc.endCol, 'danglingTechnique', { technique: tech.connection });
          }
        }
        if (tech.grace) {
          const rest = seq.slice(i + 1).filter(s => s.measure === measure);
          if (!rest.some(s => !s.n.techniques?.grace)) report(loc.line, loc.startCol, loc.endCol, 'danglingGrace');
        }
        if (tech.slurStart) {
          if (openSlurSeen) report(loc.line, loc.startCol, loc.endCol, 'nestedSlur');
          else {
            openSlur = loc;
            openSlurSeen = true;
          }
        }
        if (tech.slurEnd) {
          if (!openSlurSeen) report(loc.line, loc.startCol, loc.endCol, 'unmatchedSlurEnd');
          openSlur = undefined;
          openSlurSeen = false;
        }
      });
      if (openSlur) report(openSlur.line, openSlur.startCol, openSlur.endCol, 'unclosedSlur');
    };
    check(melody);
    check(inline);
  }

  const validPages = pages.filter((p, idx) => p.measures.length > 0 || idx === 0);
  validPages.forEach((p, idx) => {
    p.pageNumber = idx + 1;
  });

  return {
    title,
    artist,
    capo,
    originalKey,
    bpm,
    memo,
    style,
    usedChords: Array.from(usedChordsSet),
    chordDefinitions,
    measures,
    pages: validPages,
    keySignature: parseKeySignature(originalKey),
    showRhythm,
    measuresPerRow,
    expandPageBreakRepeats,
    diagnostics,
    chordTokens,
    headerLines,
    firstBodyLine,
    timeSignature,
    feel,
    pickup: pickupBeats,
    events,
    pitchTokens
  };
}

/**
 * Expands a measure repeat (%) into full rhythms, chords, and melody from the preceding measure.
 * Returns a cloned MeasureData with `isMeasureRepeat: false` and `expandedFromRepeat: true`.
 */
export function expandMeasureRepeat(measure: MeasureData, allMeasures: MeasureData[]): MeasureData {
  if (!measure.isMeasureRepeat) {
    return measure;
  }
  const idx = allMeasures.indexOf(measure);
  let source: MeasureData | undefined;
  if (idx > 0) {
    for (let i = idx - 1; i >= 0; i--) {
      if (!allMeasures[i].isMeasureRepeat) {
        source = allMeasures[i];
        break;
      }
    }
  }
  const rhythms = source && source.rhythms.length > 0
    ? source.rhythms.map(r => ({
        ...r,
        pitch: r.pitch ? { ...r.pitch } : undefined
      }))
    : defaultRhythms(measure.context.timeSignature, measure.expectedBeats);

  const chords = measure.chords && measure.chords.length > 0
    ? measure.chords.map(c => ({ ...c }))
    : (source?.chords?.map(c => ({ ...c })) ?? (source?.chord ? [{ name: source.chord, beat: 0 }] : []));

  const chord = measure.chord || source?.chord || (chords[0]?.name ?? '');

  const melody = measure.melody
    ? measure.melody.map(n => ({ ...n, pitch: n.pitch ? { ...n.pitch } : undefined }))
    : (source?.melody ? source.melody.map(n => ({ ...n, pitch: n.pitch ? { ...n.pitch } : undefined, tiedFromPrev: false, syllables: [] })) : undefined);

  return {
    ...measure,
    chord,
    chords,
    isMeasureRepeat: false,
    expandedFromRepeat: true,
    rhythms,
    melody
  };
}

function formatBeats(b: Fraction): string {
  return b.d === 1 ? String(b.n) : `${b.n}/${b.d}`;
}
