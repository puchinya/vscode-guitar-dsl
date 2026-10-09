// GuitarDSL compiler front-end: parses DSL text into the score AST (ParsedScore).
// Rendering (SVG / HTML / PDF) lives in src/render and src/pdf.ts.

import {
  Fraction,
  NoteValuePart,
  ZERO,
  decomposeBeats,
  fadd,
  fmul,
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
import { splitHeaderValue } from './headerValue';
import {
  MelodyNote,
  MelodyTokenState,
  NoteGroupToken,
  NoteTechniques,
  Pitch,
  isGrace,
  parseMelodyToken,
  parseNoteGroupToken,
  pitchTextLength,
  takesSyllable,
  tokenizeLyrics
} from './melody';
import type { Syllable } from './melody';
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
import { resolvePlayOrder } from './playOrder';
import type { PlayOrderDiagnosticCode, PlayOrderMeasure, PlayOrderResult } from './playOrder';
import { lowerArrangement, scanArrangementBlockLines } from './arrangement';
import type { ArrangementDiagnosticCode, ArrangementSection, SourceSpan } from './arrangement';
import { createInstrumentModel, MAX_CAPO, parseTuningValue, STANDARD_TUNING, Tuning } from './instrumentModel';
import {
  parseTabCell,
  parseTabLinePrefix,
  resolveTabLinkTarget,
  splitTabCells,
  tokenizeTabItems
} from './tab';
import type {
  ParsedTabBeat,
  TabBeat,
  TabDiagnosticCode,
  TabNote,
  TabVoiceMeasure
} from './tab';

export type { MelodyNote, NoteTechniques, Pitch, Syllable } from './melody';
export type { ChordDefinition } from './chordDefinition';
export type { Tuning } from './instrumentModel';
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
  /** Single inline pitch; undefined for slashes, rests and note groups. */
  pitch?: Pitch;
  /** Inline simultaneous note group (spec §18): two or more pitches, `pitch` undefined. */
  pitches?: Pitch[];
  inlineLyric?: string;
  /** Inline note `{...}` block, or slash modifiers `.pm .lr .stacc .ten .fermata .vib .breath`. */
  techniques?: NoteTechniques;
  /** Exact shared note-value data for inline pitches; `duration` remains the established renderer token. */
  inlineDuration?: { beats: Fraction; parts: NoteValuePart[] };
}

/**
 * Source location of a pitch (`c#4`, octave included when written) in a `mel:` note, an inline note, a single
 * note of a `let` definition (`fragment`) or a note-group member (`group`, always with an explicit octave).
 */
export interface PitchTokenSpan {
  line: number;
  startCol: number;
  endCol: number;
  pitch: Pitch;
  kind: 'melody' | 'inline' | 'fragment' | 'group';
  /** The octave digit is written (otherwise it is inherited from the previous note of `sequence`). */
  explicitOctave: boolean;
  /**
   * Notes sharing octave inheritance: one `mel:` line, one bar of a measure line or one `let` definition.
   * Group members never take part in the inheritance.
   */
  sequence: number;
}

/** Pitches of a rhythm item or melody note: none (rest / slash), one (single note) or several (note group). */
export function eventPitches(event: { pitch?: Pitch; pitches?: Pitch[] }): Pitch[] {
  if (event.pitches) return event.pitches;
  return event.pitch ? [event.pitch] : [];
}

function samePitchSet(left: readonly Pitch[] | undefined, right: readonly Pitch[] | undefined): boolean {
  if (!left || !right || left.length !== right.length) return false;
  const key = (pitch: Pitch) => `${pitch.step}:${pitch.alter}:${pitch.octave}`;
  const leftKeys = left.map(key).sort();
  const rightKeys = right.map(key).sort();
  return leftKeys.every((value, index) => value === rightKeys[index]);
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

/**
 * Source location of a measure's rhythm expression (spec extension §8.7): `explicit` = the column range
 * [startCol, endCol) holds the measure's rhythm tokens (including `$name` fragments and inline notes) and
 * nothing else; `implicit` = no rhythm was written and `startCol === endCol` is the insertion anchor right
 * after the cell's last token; `repeat` = the `%` token (the measure inherits the previous source measure).
 */
export interface MeasureRhythmSource {
  line: number;
  startCol: number;
  endCol: number;
  kind: 'explicit' | 'implicit' | 'repeat';
}

export interface MeasureData {
  chord: string;
  chords: ChordPlacement[];
  /** Parser-owned origin of the authored rhythm staff; implicit slashes are not authored rhythm. */
  rhythmOrigin: 'explicit' | 'implicit' | 'repeat';
  /** Parser-owned chord positioning mode. Numeric ChordPlacement.beat remains the renderer authority. */
  chordPlacementMode: 'equalSplit' | 'explicitDuration' | 'inline';
  /** Exact quarter-beat chord onsets; one entry per chords[] value. */
  chordBeatOffsets: readonly Fraction[];
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
  /** TAB voice measures assigned from an independent `tab:` source group. */
  tabVoices?: readonly TabVoiceMeasure[];
  /** Global zero-based measure index. */
  measureIndex: number;
  /** Musical context in effect for this measure (after `eventsBefore`). */
  context: ResolvedMeasureContext;
  /** Score events applied immediately before this measure, in source order. */
  eventsBefore: ScoreEvent[];
  /** Expected length in quarter beats (the pickup length for a pickup measure). */
  expectedBeats: Fraction;
  isPickup?: boolean;
  /**
   * Where this source-authored measure's rhythm is written; undefined when it cannot be isolated (rhythm
   * tokens interleaved with chords / marks / a lyric, or an empty cell).
   */
  rhythmSource?: MeasureRhythmSource;
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
  | 'invalidTuningStringCount'
  | 'invalidTuningPitch'
  | 'unknownTuningPreset'
  | 'duplicateTuning'
  | 'tuningOutsideHeader'
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
  | 'unclosedSlur'
  | 'invalidLetDefinition'
  | 'duplicateVariable'
  | 'unknownVariable'
  | 'cyclicVariableReference'
  | 'invalidVariableValue'
  | 'variableContextMismatch'
  | 'invalidNoteGroup'
  | 'unsupportedNoteGroupTechnique'
  | 'unknownMeasureToken'
  | 'unsupportedContinuationLine'
  | 'repeatEndWithoutStart'
  | TabDiagnosticCode
  | ArrangementDiagnosticCode
  | PlayOrderDiagnosticCode;

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
  invalidTuningStringCount: 'error',
  invalidTuningPitch: 'error',
  unknownTuningPreset: 'error',
  duplicateTuning: 'error',
  tuningOutsideHeader: 'error',
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
  unclosedSlur: 'warning',
  invalidLetDefinition: 'error',
  duplicateVariable: 'error',
  unknownVariable: 'error',
  cyclicVariableReference: 'error',
  invalidVariableValue: 'error',
  variableContextMismatch: 'error',
  invalidNoteGroup: 'error',
  unsupportedNoteGroupTechnique: 'error',
  unknownMeasureToken: 'error',
  unsupportedContinuationLine: 'error',
  repeatEndWithoutStart: 'warning',
  invalidTabToken: 'error',
  unsupportedTabVoice: 'error',
  invalidTabString: 'error',
  invalidTabFret: 'error',
  duplicateTabString: 'error',
  tabRepeatWithoutPrevious: 'error',
  invalidTabEffect: 'error',
  invalidTabEffectScope: 'error',
  invalidTabConnection: 'warning',
  danglingTabConnection: 'warning',
  invalidTabTie: 'error',
  tooManyTabMeasures: 'error',
  arrangementInvalidSyntax: 'error',
  arrangementDuplicateBlock: 'error',
  arrangementUnterminatedBlock: 'error',
  arrangementUnexpectedEnd: 'error',
  arrangementOutsideHeader: 'error',
  arrangementEmpty: 'error',
  arrangementDuplicateSection: 'error',
  arrangementEmptySection: 'error',
  arrangementUnassignedMeasures: 'error',
  arrangementUnknownReference: 'error',
  arrangementAmbiguousReference: 'error',
  arrangementNavigationConflict: 'error',
  arrangementLyricVerseUnavailable: 'error',
  playOrderMultipleNavigationJumps: 'error',
  playOrderMissingDestination: 'error',
  playOrderAmbiguousDestination: 'error',
  playOrderInvalidVolta: 'error',
  playOrderVoltaWithoutRepeat: 'error',
  playOrderUnclosedRepeat: 'error',
  playOrderLimitExceeded: 'error'
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
  tuning: Tuning;
  originalKey: string;
  bpm: string;
  memo: string;
  style: ScoreStyle;
  /** Diagram keys (`name` or `name@label`) in order of first use. */
  usedChords: string[];
  /** `chord` definitions in source order (first valid definition of a key wins). */
  chordDefinitions: ChordDefinition[];
  measures: MeasureData[];
  /** Authored `mel:` group boundaries and final lyric-row counts. */
  melodyGroups: ParsedMelodyGroupSummary[];
  playOrder: PlayOrderResult;
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

export interface ParsedMelodyGroupSummary {
  startMeasure: number;
  endMeasureExclusive: number;
  verseCount: number;
}

const RHYTHM_REGEX = /^(?:r?(?:(?:16|8|4|2|1)(?:t|\{[0-9]+:[0-9]+\})?(?:\+(?:16|8|4|2|1)(?:t|\{[0-9]+:[0-9]+\})?)*|w|h|q)|r[a-z0-9]*)(\.[a-z][a-z0-9:\-]*)*$/;
const NOTE_TOKEN_REGEX = /^[a-g][#b]?[0-9]?(?:\/|:|$|~|\{)/;
/** Start of a note group token `[c4,...` (spec §18); `[Intro]`-like or `[1.]` tokens do not match. */
const NOTE_GROUP_START = /^\[[a-gA-G][#b]?[0-9]?[,\]]/;
const VARIABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Deep copy of plain AST data (keys holding `undefined` are kept, so copies compare equal to literals). */
function cloneData<T>(value: T): T {
  if (Array.isArray(value)) return value.map(cloneData) as unknown as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value)) out[key] = cloneData((value as Record<string, unknown>)[key]);
    return out as T;
  }
  return value;
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
  startMeasure: number;
  endMeasureExclusive: number;
  notes: MelodyNote[];
  cellRanges: { start: number; end: number }[];
  verseCount: number;
  sectionIndex: number | null;
}

interface TabSourceGroup {
  voice: number;
  line: number;
  startCol: number;
  cells: ReturnType<typeof splitTabCells>;
  lyrics: { text: string; line: number; startCol: number; endCol: number }[];
  assignedCells: { measureIndex: number; beatIndices: number[] }[];
}

const DIRECTIVE_LINE_RE = /^(\s*@)([A-Za-z_]+)(\s*:)(.*)$/;
const HEADER_LINE_RE = /^(title|artist|capo|tuning|key|original_key|tempo|bpm|memo|show_rhythm|rhythm|measures_per_row|bars_per_row|time|time_signature|meter|feel|pickup|expand_page_break_repeats|expand_page_break_repeat|expand_page_repeats|expand_page_repeat|(?:style_)?(?:chord_size|lyric_size|title_size|section_size|font_size)):\s*(.*)$/i;
const SECTION_LABEL_RE = /^\[([^\]]+)\]$/;
const MELODY_LINE_RE = /^(\s*mel:)(.*)$/i;
const LYRICS_LINE_RE = /^(\s*lyr:)(.*)$/i;

function isTabFragmentToken(token: string): boolean {
  return /^\d+[fx]/i.test(token)
    || /^\[(?:\s*\d+(?:f\d+|x)\s*,){1,}/i.test(token);
}

export type SourceLineKind =
  | 'continuation'
  | 'blank'
  | 'let'
  | 'pageBreak'
  | 'chordDefinition'
  | 'directive'
  | 'header'
  | 'section'
  | 'melody'
  | 'tab'
  | 'lyrics'
  | 'measure'
  | 'other';

/**
 * Kind of a source line, in the parser's own precedence. `afterMelodyLine` = the previous line was a `mel:` /
 * `lyr:` line or a continuation line (see `continuesMelodyContext`). Shared with tools that scan lines cheaply
 * (the accompaniment CodeLens) so they classify exactly like `parseGuitarDsl`.
 */
export function classifySourceLine(rawLine: string, afterMelodyLine: boolean, masked = false): SourceLineKind {
  if (masked) return 'blank';
  if (afterMelodyLine && /^\s+\|/.test(rawLine)) return 'continuation';
  const line = rawLine.trim();
  if (!line || line.startsWith('#')) return 'blank';
  if (/^let\s/.test(line)) return 'let';
  if (/^---+$/.test(line) || /^pagebreak$/i.test(line)) return 'pageBreak';
  if (isChordDefinitionLine(line)) return 'chordDefinition';
  if (DIRECTIVE_LINE_RE.test(rawLine)) return 'directive';
  if (HEADER_LINE_RE.test(line)) return 'header';
  if (SECTION_LABEL_RE.test(line)) return 'section';
  if (parseTabLinePrefix(rawLine)) return 'tab';
  if (MELODY_LINE_RE.test(rawLine)) return 'melody';
  if (LYRICS_LINE_RE.test(rawLine)) return 'lyrics';
  return line.includes('|') ? 'measure' : 'other';
}

/** Whether a line of this kind lets the next indented `|` line be a (reported) continuation. */
export const continuesMelodyContext = (kind: SourceLineKind): boolean => kind === 'continuation' || kind === 'melody' || kind === 'tab' || kind === 'lyrics';

/** Non-empty measure cells of a measure line; the line yields a measure per cell (after chord/rhythm merging). */
export function measureCellsOf(rawLine: string): string[] {
  return rawLine.split('|').map(s => s.trim()).filter(s => s.length > 0 && s !== ':' && s !== ']' && s !== ':]');
}

export interface ParseGuitarDslOptions {
  expandPageBreakRepeats?: boolean;
}

export function parseGuitarDsl(dslContent: string, options?: ParseGuitarDslOptions): ParsedScore {
  const lines = dslContent.split(/\r?\n/);
  const arrangementScan = scanArrangementBlockLines(lines);

  let title = 'Guitar Rhythm Score';
  let artist = '';
  let capo = '0';
  let tuning = STANDARD_TUNING;
  let tuningSeen = false;
  let originalKey = 'C';
  let bpm = '90';
  let memo = '';
  let showRhythm = true;
  let measuresPerRow = DEFAULT_MEASURES_PER_ROW;
  let expandPageBreakRepeats = options?.expandPageBreakRepeats ?? true;
  const style: ScoreStyle = {};
  const diagnostics: ScoreDiagnostic[] = [];

  const measures: MeasureData[] = [];
  interface MeasureSourceLocation {
    line: number;
    startCol: number;
    endCol: number;
  }
  const measureSourceLocations: MeasureSourceLocation[] = [];
  const pages: ScorePage[] = [{ pageNumber: 1, measures: [] }];
  let currentPageIndex = 0;
  let currentSection = '';
  const sectionDefinitions: { name: string; start: number; labelSpan: SourceSpan }[] = [];
  const melodyGroups: MelodyGroup[] = [];
  const tabGroups: TabSourceGroup[] = [];
  let currentArrangementSectionIndex: number | null = null;
  const usedChordsSet = new Set<string>();
  const chordDefinitions: ChordDefinition[] = [];
  const chordDefinitionLines: { text: string; line: number; startCol: number; endCol: number }[] = [];
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
  const repeatInheritedChords = new Set<MeasureData>();
  const repeatChecks: { measureIdx: number; line: number; startCol: number; endCol: number }[] = [];
  interface NoteLocation { line: number; startCol: number; endCol: number }
  const melodyLocations = new WeakMap<MelodyNote, NoteLocation>();
  const inlineLocations = new WeakMap<RhythmItem, NoteLocation>();
  const tabNoteLocations = new WeakMap<TabNote, NoteLocation>();
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
  let lastLyricTarget: { kind: 'melody'; group: MelodyGroup } | { kind: 'tab'; group: TabSourceGroup } | null = null;

  const report = (lineIdx: number, startCol: number, endCol: number, code: DiagnosticCode, args?: Record<string, string | number>) => {
    diagnostics.push({ line: lineIdx, startCol, endCol: Math.max(endCol, startCol + 1), severity: DIAGNOSTIC_SEVERITY[code], code, args });
  };

  for (const diagnostic of arrangementScan.diagnostics) {
    report(diagnostic.span.line, diagnostic.span.startCol, diagnostic.span.endCol, diagnostic.code, diagnostic.args);
  }

  // `let` fragments (spec §17): every definition is parsed and resolved before the score lines, so
  // references may come before or after their definition. All state here belongs to this parse call.
  const CTX_MEASURE = 1;
  const CTX_MELODY = 2;
  const CTX_TAB = 4;
  type FragmentEvent = { kind: 'rhythm'; item: RhythmItem } | { kind: 'note'; note: MelodyNote } | { kind: 'tab'; beat: ParsedTabBeat } | { kind: 'dualRest'; beat: ParsedTabBeat; note: MelodyNote };
  interface FragmentEntry { event: FragmentEvent; loc: NoteLocation; token: string }
  interface FragmentElement { entry?: FragmentEntry; ref?: string; ctx: number; loc: NoteLocation; token: string }
  interface LetDefinition {
    name: string;
    nameLoc: NoteLocation;
    elements: FragmentElement[];
    invalid: boolean;
    /** 0 = unresolved, 1 = resolving (cycle detection), 2 = resolved. */
    state: 0 | 1 | 2;
    ctx: number;
    entries: FragmentEntry[];
  }
  const letDefinitions = new Map<string, LetDefinition>();

  lines.forEach((rawLine, lineIdx) => {
    if (arrangementScan.maskedLines[lineIdx]) return;
    const trimmed = rawLine.trim();
    if (!/^let\s/.test(trimmed)) return;
    const lineStart = rawLine.indexOf(trimmed);
    const comment = rawLine.slice(lineStart).search(/\s#/);
    const body = comment >= 0 ? rawLine.slice(0, lineStart + comment) : rawLine;
    const m = body.match(/^(\s*let\s+)([A-Za-z_][A-Za-z0-9_]*)(\s*=\s*)(\S.*?)?\s*$/);
    if (!m || m[4] === undefined) {
      report(lineIdx, lineStart, lineStart + body.trim().length, 'invalidLetDefinition', { token: body.trim() });
      return;
    }
    const name = m[2];
    const nameLoc = { line: lineIdx, startCol: m[1].length, endCol: m[1].length + name.length };
    if (letDefinitions.has(name)) {
      report(lineIdx, nameLoc.startCol, nameLoc.endCol, 'duplicateVariable', { name });
      return;
    }
    const def: LetDefinition = { name, nameLoc, elements: [], invalid: false, state: 0, ctx: 0, entries: [] };
    letDefinitions.set(name, def);

    // Single notes inherit only inside this definition, starting from an empty state (no default octave).
    const state: MelodyTokenState = {};
    let tabFragmentDuration: TabBeat['duration'] | undefined;
    // The first pitched single note (a grace note included) writes its own octave and length: a rest or a
    // note group before it does not establish them (spec §17.4).
    let firstSingle = true;
    const sequence = pitchSequence++;
    const valueStart = m[1].length + name.length + m[3].length;
    const re = /\S+/g;
    let t: RegExpExecArray | null;
    while ((t = re.exec(m[4])) !== null) {
      const tok = t[0];
      const col = valueStart + t.index;
      const loc = { line: lineIdx, startCol: col, endCol: col + tok.length };
      const fail = (code: DiagnosticCode, args: Record<string, string | number>) => {
        report(lineIdx, loc.startCol, loc.endCol, code, args);
        def.invalid = true;
      };
      if (tok === '%') {
        fail('invalidVariableValue', { name, token: tok, reason: 'percent' });
      } else if (tok.startsWith('$')) {
        if (VARIABLE_NAME.test(tok.slice(1))) def.elements.push({ ref: tok.slice(1), ctx: 0, loc, token: tok });
        else fail('invalidVariableValue', { name, token: tok, reason: 'token' });
      } else if (isTabFragmentToken(tok)) {
        const parsed = parseTabCell({ text: tok, startCol: col, endCol: col + tok.length });
        for (const issue of parsed.issues) {
          report(lineIdx, issue.startCol, issue.endCol, issue.code as DiagnosticCode, issue.args ? { ...issue.args } : undefined);
          def.invalid = true;
        }
        const beat = parsed.beats[0];
        if (!beat || parsed.beats.length !== 1) {
          fail('invalidVariableValue', { name, token: tok, reason: 'token' });
          continue;
        }
        const duration = beat.duration ?? tabFragmentDuration;
        if (!duration) {
          report(lineIdx, loc.startCol, loc.endCol, 'missingInitialOctaveOrLength', { token: tok });
          def.invalid = true;
          continue;
        }
        tabFragmentDuration = duration;
        def.elements.push({
          entry: { event: { kind: 'tab', beat: { ...beat, duration } }, loc, token: tok },
          ctx: CTX_TAB,
          loc,
          token: tok
        });
      } else if (/^r(?:\/|:|$)/i.test(tok)) {
        // `r/8` is also the established melody-rest spelling. Keep its meaning context-sensitive
        // so adding TAB fragments does not make existing melody-only `let` definitions TAB-only.
        const melodyRest = parseMelodyToken(tok, state);
        const parsedTab = parseTabCell({ text: tok, startCol: col, endCol: col + tok.length });
        if (typeof melodyRest === 'string') {
          fail(melodyRest, { token: tok });
          continue;
        }
        if (parsedTab.issues.length > 0 || parsedTab.beats.length !== 1 || !parsedTab.beats[0].isRest) {
          fail('invalidVariableValue', { name, token: tok, reason: 'token' });
          continue;
        }
        const beat = parsedTab.beats[0];
        const duration = beat.duration ?? tabFragmentDuration;
        if (!duration) {
          // Without a fragment-local TAB duration the token remains a valid melody rest only.
          def.elements.push({ entry: { event: { kind: 'note', note: melodyRest }, loc, token: tok }, ctx: CTX_MELODY, loc, token: tok });
          continue;
        }
        tabFragmentDuration = duration;
        def.elements.push({
          entry: { event: { kind: 'dualRest', beat: { ...beat, duration }, note: melodyRest }, loc, token: tok },
          ctx: CTX_MELODY | CTX_TAB,
          loc,
          token: tok
        });
      } else if (tok.startsWith('[')) {
        const parsed = parseNoteGroupToken(tok);
        if (typeof parsed === 'string') {
          fail(parsed, { token: tok });
          continue;
        }
        pushGroupPitchTokens(parsed, lineIdx, col, sequence);
        def.elements.push({ entry: { event: { kind: 'note', note: parsed.note }, loc, token: tok }, ctx: CTX_MEASURE | CTX_MELODY, loc, token: tok });
      } else if (RHYTHM_REGEX.test(tok)) {
        const item = parseRhythmToken(tok, lineIdx, col);
        if (!item) {
          def.invalid = true;
          continue;
        }
        def.elements.push({ entry: { event: { kind: 'rhythm', item }, loc, token: tok }, ctx: CTX_MEASURE, loc, token: tok });
      } else if (/^[a-gA-Gr]/.test(tok)) {
        const parsed = parseMelodyToken(tok, state);
        if (typeof parsed === 'string') {
          fail(parsed, { token: tok });
          continue;
        }
        if (parsed.pitch) {
          const pitchLen = pitchTextLength(tok);
          const incomplete = firstSingle && (!/[0-9]$/.test(tok.slice(0, pitchLen)) || !/^[/:]/.test(tok.slice(pitchLen)));
          firstSingle = false;
          if (incomplete) {
            fail('missingInitialOctaveOrLength', { token: tok });
            continue;
          }
        }
        if (parsed.pitch) {
          const len = pitchTextLength(tok);
          pitchTokens.push({
            line: lineIdx,
            startCol: col,
            endCol: col + len,
            pitch: parsed.pitch,
            kind: 'fragment',
            explicitOctave: /[0-9]$/.test(tok.slice(0, len)),
            sequence
          });
        }
        // A pitched note works in both line types; a rest written as r/8 or r:1 only in mel: (r8 is a rhythm rest).
        def.elements.push({ entry: { event: { kind: 'note', note: parsed }, loc, token: tok }, ctx: parsed.isRest ? CTX_MELODY : CTX_MEASURE | CTX_MELODY, loc, token: tok });
      } else {
        fail('invalidVariableValue', { name, token: tok, reason: 'token' });
      }
    }
  });

  /** Resolves references (memoized depth-first search); returns null for an invalid definition. */
  function resolveLet(def: LetDefinition): FragmentEntry[] | null {
    if (def.state === 2) return def.invalid ? null : def.entries;
    def.state = 1;
    let ctx = CTX_MEASURE | CTX_MELODY | CTX_TAB;
    const entries: FragmentEntry[] = [];
    for (const el of def.elements) {
      if (el.ref === undefined) {
        ctx &= el.ctx;
        entries.push(el.entry!);
        continue;
      }
      const target = letDefinitions.get(el.ref);
      if (!target) {
        report(el.loc.line, el.loc.startCol, el.loc.endCol, 'unknownVariable', { name: el.ref });
        def.invalid = true;
        continue;
      }
      if (target.state === 1) {
        report(el.loc.line, el.loc.startCol, el.loc.endCol, 'cyclicVariableReference', { name: el.ref });
        def.invalid = true;
        continue;
      }
      const sub = resolveLet(target);
      if (!sub) {
        // The referenced definition already reported its own error.
        def.invalid = true;
        continue;
      }
      ctx &= target.ctx;
      // Nested entries are attributed to the reference inside this definition.
      entries.push(...sub.map(e => ({ event: e.event, loc: el.loc, token: el.token })));
    }
    if (!def.invalid && ctx === 0) {
      report(def.nameLoc.line, def.nameLoc.startCol, def.nameLoc.endCol, 'invalidVariableValue', { name: def.name, token: def.name, reason: 'noContext' });
      def.invalid = true;
    }
    if (!def.invalid && !validateFragmentBoundary(def, entries)) def.invalid = true;
    def.state = 2;
    def.ctx = ctx;
    def.entries = entries;
    return def.invalid ? null : entries;
  }

  /** A fragment leaves no open tie, connection, slur or grace sequence for its caller (spec §17.5). */
  function validateFragmentBoundary(def: LetDefinition, entries: FragmentEntry[]): boolean {
    let ok = true;
    const fail = (entry: FragmentEntry, reason: string) => {
      report(entry.loc.line, entry.loc.startCol, entry.loc.endCol, 'invalidVariableValue', { name: def.name, token: entry.token, reason });
      ok = false;
    };
    const nonTabEntries = entries.filter((e): e is FragmentEntry & { event: Exclude<FragmentEvent, { kind: 'tab' }> } => e.event.kind !== 'tab');
    const items = nonTabEntries.map(e => e.event.kind === 'rhythm' ? e.event.item : e.event.note);
    let openSlur: FragmentEntry | undefined;
    items.forEach((item, i) => {
      const entry = nonTabEntries[i];
      const tied = 'tieToNext' in item ? item.tieToNext : item.tie;
      if (tied) {
        // The tie continues into the very next event, which must be a valid target inside the fragment.
        const next = items[i + 1];
        if (!next) fail(entry, 'openTie');
        else if ('tieToNext' in item) {
          if (next.isRest || !eventPitches(next).length) fail(entry, 'tieTarget');
          else if ((item.pitches || next.pitches) && !samePitchSet(item.pitches, next.pitches)) {
            report(entry.loc.line, entry.loc.startCol, entry.loc.endCol, 'unsupportedNoteGroupTechnique', { token: entry.token });
            ok = false;
          }
        } else if (item.pitches || next.pitches) {
          if (!samePitchSet(item.pitches, next.pitches)) fail(entry, 'tieTarget');
        } else if (next.isRest || !next.pitch) {
          report(entry.loc.line, entry.loc.startCol, entry.loc.endCol, 'unsupportedNoteGroupTechnique', { token: entry.token });
          ok = false;
        }
      }
      const tech = item.techniques;
      if (!tech) return;
      if (tech.connection) {
        const target = nextConnectionTarget(items, i);
        if (target < 0 || !items[target].pitch) fail(entry, 'danglingConnection');
      }
      if (tech.grace && !items.slice(i + 1).some(x => !x.techniques?.grace && eventPitches(x).length > 0)) fail(entry, 'danglingGrace');
      if (tech.slurStart) {
        if (openSlur) fail(entry, 'nestedSlur');
        else openSlur = entry;
      }
      if (tech.slurEnd) {
        if (!openSlur) fail(entry, 'unmatchedSlurEnd');
        openSlur = undefined;
      }
    });
    if (openSlur) fail(openSlur, 'openSlur');

    const tabEntries = entries.filter(e => e.event.kind === 'tab');
    const tabBeats = tabEntries.map(entry => entry.event.kind === 'tab' ? entry.event.beat : undefined)
      .filter((beat): beat is ParsedTabBeat => beat !== undefined);
    tabEntries.forEach((entry, i) => {
      if (entry.event.kind !== 'tab') return;
      for (const note of entry.event.beat.notes) {
        const connections = note.effects.filter(effect => ['hammer', 'pull', 'slide', 'gliss'].includes(effect.name));
        if (!note.tieToNext && connections.length === 0) continue;
        if (note.tieToNext) {
          const result = resolveTabLinkTarget(tabBeats, i, note, 'tie');
          if (result.status !== 'valid') fail(entry, result.status === 'dangling' ? 'openTie' : 'tieTarget');
        }
        if (connections.length > 0) {
          const result = resolveTabLinkTarget(tabBeats, i, note, 'connection');
          if (result.status !== 'valid') fail(entry, result.status === 'dangling' ? 'danglingConnection' : 'connectionTarget');
        }
      }
    });
    return ok;
  }

  for (const def of letDefinitions.values()) resolveLet(def);

  /**
   * Events of `$name` for a use in a measure cell (CTX_MEASURE) or a mel: cell (CTX_MELODY); null after
   * reporting an unknown name or a context mismatch, or silently for a definition that has its own error.
   */
  function useFragment(tok: string, lineIdx: number, col: number, ctx: number): FragmentEvent[] | null {
    const name = tok.slice(1);
    const def = VARIABLE_NAME.test(name) ? letDefinitions.get(name) : undefined;
    if (!def) {
      report(lineIdx, col, col + tok.length, 'unknownVariable', { name });
      return null;
    }
    if (def.invalid) return null;
    if (!(def.ctx & ctx)) {
      report(lineIdx, col, col + tok.length, 'variableContextMismatch', { name, context: ctx === CTX_MELODY ? 'melody' : ctx === CTX_TAB ? 'tab' : 'measure' });
      return null;
    }
    return def.entries.map(e => {
      if (e.event.kind !== 'dualRest') return e.event;
      return ctx === CTX_TAB ? { kind: 'tab', beat: e.event.beat } : { kind: 'note', note: e.event.note };
    });
  }

  /** `$name` of a valid definition usable in a measure cell (counts as rhythm content for the cell merge). */
  const isMeasureReference = (tok: string) => {
    const def = tok.startsWith('$') ? letDefinitions.get(tok.slice(1)) : undefined;
    return def !== undefined && !def.invalid && (def.ctx & CTX_MEASURE) !== 0;
  };

  let continuableLine = false;
  // `:|` needs a `|:` since the score start or the previous `:|` (D4). Consecutive volta endings share one
  // `|:` (D5): after a `:|` that closed an ending, the very next measure must start the next ending (a bracket,
  // same section and page) for the shared start to stay usable; any other measure ends the sharing.
  let repeatOpen = false;
  let voltaSinceEnd = false;
  let awaitingNextEnding = false;
  let sharedStartOpen = false;
  let endingPage = -1;
  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const rawLine = lines[lineIdx];
    const line = rawLine.trim();
    // An indented `|` line right after a `mel:` / `lyr:` line (or another such line) is an attempted
    // continuation, which the syntax does not have: report it and do not read it as a measure (§6).
    const kind = classifySourceLine(rawLine, continuableLine, arrangementScan.maskedLines[lineIdx]);
    continuableLine = continuesMelodyContext(kind);
    if (lastLyricTarget?.kind === 'tab' && kind !== 'lyrics') lastLyricTarget = null;
    if (arrangementScan.maskedLines[lineIdx]) continue;
    if (kind === 'continuation') {
      const start = rawLine.indexOf('|');
      report(lineIdx, start, rawLine.trimEnd().length, 'unsupportedContinuationLine');
      continue;
    }
    if (!line || line.startsWith('#')) continue;
    // `let` definitions were handled above; they never change measures, sections, pages or the melody cursor.
    if (/^let\s/.test(line)) continue;
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
      lastLyricTarget = null;
      continue;
    }

    // Chord diagram definition: chord C@barre = x35553 base:3
    if (isChordDefinitionLine(line)) {
      // The final tuning and capo may appear later in the file. Defer validity and duplicate
      // ownership together so an invalid early definition cannot shadow a later valid one.
      chordDefinitionLines.push({ text: line, line: lineIdx, startCol: lineStart, endCol: lineEnd });
      continue;
    }

    // Score event: @key: D, @tempo: 132, ... (spec §16). Applies before the next measure.
    const directiveMatch = rawLine.match(DIRECTIVE_LINE_RE);
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
    const headerMatch = line.match(HEADER_LINE_RE);
    if (headerMatch) {
      const key = headerMatch[1].toLowerCase().replace(/^style_/, '');
      const parts = splitHeaderValue(headerMatch[2]);
      const valueStart = lineEnd - headerMatch[2].length;
      headerLines.push({ key: headerMatch[1].toLowerCase(), line: lineIdx, valueStart, valueEnd: valueStart + parts.source.length });
      if (key === 'title') title = parts.value;
      else if (key === 'artist') artist = parts.value;
      else if (key === 'capo') capo = parts.value;
      else if (key === 'tuning') {
        if (tuningSeen) {
          report(lineIdx, valueStart, valueStart + parts.source.length, 'duplicateTuning', { value: parts.value });
        } else {
          tuningSeen = true;
          if (firstBodyLine !== undefined) {
            report(lineIdx, valueStart, valueStart + parts.source.length, 'tuningOutsideHeader', { value: parts.value });
          } else {
            const parsedTuning = parseTuningValue(parts.value);
            if (parsedTuning.ok) {
              tuning = parsedTuning.tuning;
            } else if (parsedTuning.reason === 'stringCount') {
              report(lineIdx, valueStart, valueStart + parts.source.length, 'invalidTuningStringCount', { value: parts.value, count: parsedTuning.detail });
            } else if (parsedTuning.reason === 'invalidPitch') {
              const pitchOffset = parts.source.indexOf(parsedTuning.detail);
              const pitchStart = pitchOffset < 0 ? valueStart : valueStart + pitchOffset;
              report(lineIdx, pitchStart, pitchStart + parsedTuning.detail.length, 'invalidTuningPitch', { value: parts.value, pitch: parsedTuning.detail });
            } else {
              report(lineIdx, valueStart, valueStart + parts.source.length, 'unknownTuningPreset', { value: parts.value });
            }
          }
        }
      }
      else if (key === 'key' || key === 'original_key') originalKey = parts.value;
      else if (key === 'bpm' || key === 'tempo') bpm = parts.value;
      else if (key === 'memo') memo = parts.value;
      else if (key === 'time' || key === 'time_signature' || key === 'meter') {
        const ts = parseTimeSignature(parts.value);
        if (ts.ok) timeSignature = ts.value;
        else report(lineIdx, valueStart, valueStart + parts.source.length, ts.code, { directive: headerMatch[1], value: parts.value });
      } else if (key === 'feel') {
        const f = parseFeel(parts.value);
        if (f) feel = f;
        else report(lineIdx, valueStart, valueStart + parts.source.length, 'invalidFeel', { directive: headerMatch[1], value: parts.value });
      } else if (key === 'pickup') {
        const v = parseNoteValue(parts.value);
        if (v) pickup = { value: v.beats, line: lineIdx, startCol: valueStart, endCol: valueStart + parts.source.length };
        else report(lineIdx, valueStart, valueStart + parts.source.length, 'invalidPickup', { value: parts.value });
      }
      else if (key.startsWith('expand_page')) {
        const v = parts.value.toLowerCase();
        if (['false', 'off', 'no', '0'].includes(v)) expandPageBreakRepeats = false;
        else if (['true', 'on', 'yes', '1'].includes(v)) expandPageBreakRepeats = true;
      } else if (key === 'show_rhythm' || key === 'rhythm') {
        const v = parts.value.toLowerCase();
        if (['false', 'off', 'no', '0'].includes(v)) showRhythm = false;
        else if (['true', 'on', 'yes', '1'].includes(v)) showRhythm = true;
      } else if (key === 'measures_per_row' || key === 'bars_per_row') {
        const n = Number(parts.value);
        if (Number.isInteger(n) && n >= 1 && n <= MAX_MEASURES_PER_ROW) {
          measuresPerRow = n;
        } else {
          measuresPerRow = DEFAULT_MEASURES_PER_ROW;
          report(lineIdx, lineStart, lineEnd, 'invalidMeasuresPerRow', { value: parts.value });
        }
      } else if (key === 'chord_size') {
        const n = parseFloat(parts.value);
        if (!isNaN(n) && n > 0) style.chordSize = n;
      } else if (key === 'lyric_size') {
        const n = parseFloat(parts.value);
        if (!isNaN(n) && n > 0) style.lyricSize = n;
      } else if (key === 'title_size') {
        const n = parseFloat(parts.value);
        if (!isNaN(n) && n > 0) style.titleSize = n;
      } else if (key === 'section_size') {
        const n = parseFloat(parts.value);
        if (!isNaN(n) && n > 0) style.sectionSize = n;
      } else if (key === 'font_size') {
        const n = parseFloat(parts.value);
        if (!isNaN(n) && n > 0) style.fontSize = n;
      }
      continue;
    }

    // Section label [Intro], [Aメロ] etc
    const secMatch = line.match(SECTION_LABEL_RE);
    if (secMatch) {
      markBody(lineIdx);
      currentSection = secMatch[1];
      currentArrangementSectionIndex = sectionDefinitions.length;
      sectionDefinitions.push({
        name: secMatch[1],
        start: measures.length,
        labelSpan: { line: lineIdx, startCol: lineStart, endCol: lineEnd }
      });
      melodyCursor = measures.length;
      lastMelodyGroup = null;
      lastLyricTarget = null;
      continue;
    }

    // Melody line: mel: | e4/8 d c | ... |
    const melMatch = rawLine.match(MELODY_LINE_RE);
    if (melMatch) {
      markBody(lineIdx);
      lastMelodyGroup = parseMelodyLine(rawLine, melMatch[1].length, lineIdx, currentArrangementSectionIndex);
      melodyGroups.push(lastMelodyGroup);
      lastLyricTarget = { kind: 'melody', group: lastMelodyGroup };
      continue;
    }

    // TAB rows are collected before score measures are finalized; assignment and pitch resolution happen
    // later, after all tuning/capo headers and measure contexts are known.
    const tabPrefix = parseTabLinePrefix(rawLine);
    if (tabPrefix) {
      markBody(lineIdx);
      if (tabPrefix.voice !== 1) {
        report(lineIdx, lineStart, lineStart + tabPrefix.bodyStart, 'unsupportedTabVoice', { voice: tabPrefix.voice });
        lastLyricTarget = null;
        lastMelodyGroup = null;
        continue;
      }
      const group: TabSourceGroup = {
        voice: tabPrefix.voice,
        line: lineIdx,
        startCol: tabPrefix.bodyStart,
        cells: splitTabCells(rawLine, tabPrefix.bodyStart),
        lyrics: [],
        assignedCells: []
      };
      tabGroups.push(group);
      lastLyricTarget = { kind: 'tab', group };
      lastMelodyGroup = null;
      continue;
    }

    // Syllable lyric line: lyr: あさの ひかりを | ...
    const lyrMatch = rawLine.match(LYRICS_LINE_RE);
    if (lyrMatch) {
      markBody(lineIdx);
      if (lastLyricTarget?.kind === 'tab') {
        lastLyricTarget.group.lyrics.push({ text: lyrMatch[2], line: lineIdx, startCol: rawLine.indexOf(lyrMatch[2]), endCol: lineEnd });
      } else if (lastLyricTarget?.kind === 'melody' && lastMelodyGroup) {
        assignLyrics(lastMelodyGroup, lyrMatch[2], lineIdx, rawLine.indexOf(lyrMatch[2]), lineEnd);
      } else if (!lastMelodyGroup) {
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
    const rawBars = measureCellsOf(rawLine);

    const bars: string[] = [];
    const CHORD_REGEX = new RegExp(`^${CHORD_NAME_PATTERN}(?:@${CHORD_LABEL_PATTERN})?(?::[0-9][0-9.]*|\\/[0-9][0-9.t+{}:]*)?$`);
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
        const nextHasRhythm = nextTokens.some(t => RHYTHM_REGEX.test(t.split('.')[0]) || t === '%' || isNoteToken(t) || NOTE_GROUP_START.test(t) || isMeasureReference(t));

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
        accumBeatFraction: Fraction;
      }
      const rawChords: RawParsedChord[] = [];
      const rhythms: RhythmItem[] = [];
      let runningBeat = ZERO;
      let isMeasureRepeat = false;
      let noChordMarker = false;
      let noChordMarkerCol = -1;
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
      // A cell with an unusable `$name` is not length-checked (the reference already has its diagnostic).
      let fragmentFailed = false;
      // Rhythm expression span (rhythm tokens, `$name`, inline notes / groups) and the end of the last token.
      let rhythmStartCol = -1;
      let rhythmEndCol = -1;
      let otherAfterRhythm = false;
      let rhythmInterleaved = false;
      let lastTokenEnd = -1;

      for (let tokIdx = 0; tokIdx < tokens.length; tokIdx++) {
        const tok = tokens[tokIdx];
        if (!tok || tok === ':' || tok === '|') continue;
        const found = rawLine.indexOf(tok, searchPos);
        const tokCol = found >= 0 ? found : searchPos;
        if (found >= 0) searchPos = found + tok.length;
        if (firstTokenCol < 0) firstTokenCol = tokCol;
        const isRhythmToken = tok.startsWith('$') || RHYTHM_REGEX.test(tok) || NOTE_GROUP_START.test(tok) || (NOTE_TOKEN_REGEX.test(tok) && !CHORD_REGEX.test(tok));
        if (isRhythmToken) {
          if (otherAfterRhythm) rhythmInterleaved = true;
          if (rhythmStartCol < 0) rhythmStartCol = tokCol;
          rhythmEndCol = tokCol + tok.length;
        } else if (rhythmStartCol >= 0) {
          otherAfterRhythm = true;
        }
        lastTokenEnd = Math.max(lastTokenEnd, tokCol + tok.length);

        if (tok === '%') {
          isMeasureRepeat = true;
          repeatTokenCol = tokCol;
          continue;
        }

        if (tok.toUpperCase() === 'N.C.') {
          noChordMarker = true;
          noChordMarkerCol = tokCol;
          continue;
        }

        if (tok.startsWith('$')) {
          // `let` fragment: fresh copies of the resolved events; the bar's inline inheritance is untouched.
          const fragment = useFragment(tok, lineIdx, tokCol, CTX_MEASURE);
          if (!fragment) {
            fragmentFailed = true;
            continue;
          }
          for (const ev of fragment) {
            if (ev.kind === 'rhythm') {
              const item = cloneData(ev.item);
              rhythms.push(item);
              runningBeat = fadd(runningBeat, rhythmBeatsFraction(item.duration));
            } else if (ev.kind === 'note') {
              const item = inlineItem(cloneData(ev.note));
              rhythms.push(item);
              inlineLocations.set(item, { line: lineIdx, startCol: tokCol, endCol: tokCol + tok.length });
              runningBeat = fadd(runningBeat, ev.note.beats);
            }
          }
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
          const codaCol = rawLine.indexOf(tokens[tokIdx], searchPos);
          if (codaCol >= 0) {
            searchPos = codaCol + tokens[tokIdx].length;
            lastTokenEnd = Math.max(lastTokenEnd, searchPos);
          }
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
            accumBeatAtToken: fnum(runningBeat),
            accumBeatFraction: { ...runningBeat }
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
          const item = parseRhythmToken(tok, lineIdx, tokCol);
          if (!item) continue;
          rhythms.push(item);
          runningBeat = fadd(runningBeat, rhythmBeatsFraction(item.duration));
        } else if (NOTE_GROUP_START.test(tok)) {
          // Inline simultaneous note group (e.g. [c4,e4,g4]/4, [c4,e4]/8{staccato}); no inheritance either way.
          const parsed = parseNoteGroupToken(tok);
          if (typeof parsed === 'string') {
            report(lineIdx, tokCol, tokCol + tok.length, parsed, { token: tok });
            continue;
          }
          const item = inlineItem(parsed.note);
          rhythms.push(item);
          inlineLocations.set(item, { line: lineIdx, startCol: tokCol, endCol: tokCol + tok.length });
          pushGroupPitchTokens(parsed, lineIdx, tokCol, barSequence);
          runningBeat = fadd(runningBeat, parsed.note.beats);
        } else if (NOTE_TOKEN_REGEX.test(tok)) {
          // Inline arpeggio / melody note token (e.g. c3/8, e4, g4/4, f#4:0.5, a4/8{hammer})
          const parsed = parseMelodyToken(tok, inlineMelodyState);
          if (typeof parsed !== 'string') {
            const item = inlineItem(parsed);
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
        } else {
          // Not a chord, rhythm, inline note / group, `$name`, `%`, bracket or mark: never drop it silently.
          report(lineIdx, tokCol, tokCol + tok.length, 'unknownMeasureToken', { token: tok });
        }
      }

      if (noChordMarker && rawChords.length > 0) {
        report(lineIdx, noChordMarkerCol, noChordMarkerCol + 4, 'unknownMeasureToken', { token: 'N.C.' });
      }

      if (!isMeasureRepeat && rhythms.length > 0 && !fragmentFailed) {
        const col = firstTokenCol >= 0 ? firstTokenCol : 0;
        const heads = rhythms.filter(r => !r.techniques?.grace).flatMap(r => (parseRhythmDuration(r.duration)?.parts ?? []).map(part => ({ part })));
        lengthChecks.push({ measureIdx: measures.length, line: lineIdx, startCol: col, endCol: searchPos, beats: runningBeat, heads });
      }
      if (isMeasureRepeat && repeatTokenCol >= 0) {
        repeatChecks.push({ measureIdx: measures.length, line: lineIdx, startCol: repeatTokenCol, endCol: repeatTokenCol + 1 });
      }

      let barChords: ChordPlacement[] = [];
      let chordPlacementMode: MeasureData['chordPlacementMode'] = 'equalSplit';
      let chordBeatOffsets: Fraction[] = [];
      let repeatChordsWereInherited = false;
      if (rawChords.length === 1) {
        barChords = [placement(rawChords[0], rawChords[0].accumBeatAtToken)];
        chordPlacementMode = rawChords[0].accumBeatAtToken === 0 && rhythms.length === 0 ? 'equalSplit' : 'inline';
        chordBeatOffsets = [{ ...rawChords[0].accumBeatFraction }];
      } else if (rawChords.length > 1) {
        const allChordsBeforeRhythm = rawChords.every(c => c.accumBeatAtToken === 0);
        if (allChordsBeforeRhythm) {
          const anyHasDuration = rawChords.some(c => c.duration !== undefined);
          if (anyHasDuration && !invalidChordLength) {
            let curB = ZERO;
            chordPlacementMode = 'explicitDuration';
            barChords = rawChords.map(c => {
              const b = curB;
              curB = fadd(curB, c.duration ?? frac(2));
              chordBeatOffsets.push({ ...b });
              return placement(c, fnum(b));
            });
          } else {
            // Positions are fixed once the measure length is known (resolveMeasures).
            const step = 4.0 / rawChords.length;
            barChords = rawChords.map((c, idx) => placement(c, idx * step));
            chordPlacementMode = 'equalSplit';
            chordBeatOffsets = rawChords.map(() => ({ ...ZERO }));
            multiChordEqualSplit = true;
          }
        } else {
          barChords = rawChords.map(c => placement(c, c.accumBeatAtToken));
          chordPlacementMode = 'inline';
          chordBeatOffsets = rawChords.map(c => ({ ...c.accumBeatFraction }));
        }
      } else if (isMeasureRepeat && measures.length > 0) {
        const prev = measures[measures.length - 1];
        if (prev.chords && prev.chords.length > 0) {
          barChords = prev.chords.map(c => ({ ...c }));
          chordPlacementMode = prev.chordPlacementMode;
          chordBeatOffsets = prev.chordBeatOffsets.map(offset => ({ ...offset }));
          repeatChordsWereInherited = true;
        } else if (prev.chord) {
          barChords = [{ name: prev.chord, beat: 0 }];
          chordPlacementMode = prev.chordPlacementMode;
          chordBeatOffsets = prev.chordBeatOffsets.map(offset => ({ ...offset }));
          repeatChordsWereInherited = true;
        }
        barChords.forEach(c => usedChordsSet.add(chordKey(c.name, c.label)));
      }

      const mData: MeasureData = newMeasure({
        chord: barChords.length > 0 ? barChords[0].name : '',
        chords: barChords,
        rhythmOrigin: isMeasureRepeat ? 'repeat' : rhythms.length > 0 ? 'explicit' : 'implicit',
        chordPlacementMode,
        chordBeatOffsets,
        isMeasureRepeat,
        repeatStart: rStart,
        repeatEnd: rEnd,
        doubleEnd: dEnd,
        finalEnd: fEnd,
        bracket: mBracket,
        specialMark: mSpecialMark,
        sectionName: currentSection,
        rhythms: isMeasureRepeat ? [] : (rhythms.length > 0 ? rhythms : noChordMarker ? [] : defaultRhythms()),
        lyric: mLyric
      });
      if (repeatChordsWereInherited && rawChords.length === 0) repeatInheritedChords.add(mData);
      if (rStart) {
        repeatOpen = true;
        voltaSinceEnd = false;
        sharedStartOpen = false;
        awaitingNextEnding = false;
      } else if (awaitingNextEnding) {
        sharedStartOpen = mBracket !== undefined && !currentSection && currentPageIndex === endingPage;
        awaitingNextEnding = false;
      }
      if (mBracket !== undefined) voltaSinceEnd = true;
      if (rEnd) {
        if (!repeatOpen && !sharedStartOpen) {
          const endCol = rawLine.indexOf(':|', Math.max(firstTokenCol, 0));
          const col = endCol >= 0 ? endCol : Math.max(firstTokenCol, 0);
          report(lineIdx, col, endCol >= 0 ? endCol + 2 : rawLine.trimEnd().length, 'repeatEndWithoutStart');
        }
        awaitingNextEnding = voltaSinceEnd;
        endingPage = currentPageIndex;
        repeatOpen = false;
        sharedStartOpen = false;
        voltaSinceEnd = false;
      }
      if (isMeasureRepeat && repeatTokenCol >= 0) {
        mData.rhythmSource = { line: lineIdx, startCol: repeatTokenCol, endCol: repeatTokenCol + 1, kind: 'repeat' };
      } else if (rhythmStartCol >= 0) {
        if (!rhythmInterleaved && !rawLine.slice(rhythmStartCol, rhythmEndCol).includes('l:"')) {
          mData.rhythmSource = { line: lineIdx, startCol: rhythmStartCol, endCol: rhythmEndCol, kind: 'explicit' };
        }
      } else if (lastTokenEnd >= 0) {
        mData.rhythmSource = { line: lineIdx, startCol: lastTokenEnd, endCol: lastTokenEnd, kind: 'implicit' };
      }
      if (!isMeasureRepeat && !noChordMarker && rhythms.length === 0) defaultRhythmMeasures.add(mData);
      if (multiChordEqualSplit) equalSplitChords.add(mData);
      const sourceStart = firstTokenCol >= 0 ? firstTokenCol : 0;
      const sourceEnd = firstTokenCol >= 0
        ? Math.max(sourceStart + 1, Math.min(rawLine.length, searchPos))
        : Math.max(1, rawLine.length);
      measureSourceLocations.push({ line: lineIdx, startCol: sourceStart, endCol: sourceEnd });
      measures.push(mData);
      pages[currentPageIndex].measures.push(mData);
      currentSection = ''; // consume section for the first bar
    }
  }

  /** Rhythm item of an inline note or note group of a measure cell (the note's length as a rhythm duration). */
  function inlineItem(parsed: MelodyNote): RhythmItem {
    const baseParts = parsed.parts;
    if (parsed.pitches) {
      // Every part is kept so a compound group length (4+16) keeps its tied heads.
      const duration = baseParts.map(p => (p.tuplet ? formatNoteValuePart(p) : p.dotted ? `${p.base}+${p.base * 2}` : String(p.base))).join('+');
      const group: RhythmItem = { duration, isRest: false, down: false, up: false, ghost: false, accent: false, tie: parsed.tieToNext, pitches: parsed.pitches, inlineDuration: { beats: { ...parsed.beats }, parts: parsed.parts.map(part => ({ ...part, ...(part.tuplet ? { tuplet: { ...part.tuplet } } : {}) })) } };
      if (parsed.techniques) group.techniques = parsed.techniques;
      return group;
    }
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
      pitch: parsed.pitch,
      inlineDuration: { beats: { ...parsed.beats }, parts: parsed.parts.map(part => ({ ...part, ...(part.tuplet ? { tuplet: { ...part.tuplet } } : {}) })) }
    };
    if (parsed.techniques) item.techniques = parsed.techniques;
    return item;
  }

  /** One source span per note-group member; members always carry their octave and never join inheritance. */
  function pushGroupPitchTokens(parsed: NoteGroupToken, lineIdx: number, tokCol: number, sequence: number) {
    parsed.members.forEach((member, i) => {
      pitchTokens.push({
        line: lineIdx,
        startCol: tokCol + member.offset,
        endCol: tokCol + member.offset + member.length,
        pitch: parsed.note.pitches![i],
        kind: 'group',
        explicitOctave: true,
        sequence
      });
    });
  }

  /** Rhythm token (4.d, 8.u, r8, 8t.d, 4+8.pm, ...) of a measure cell or a `let` value; null (reported) when invalid. */
  function parseRhythmToken(tok: string, lineIdx: number, tokCol: number): RhythmItem | null {
    const parts = tok.split('.');
    const dur = parts[0];
    const isRest = dur.startsWith('r');
    const durationValue = parseRhythmDurationDetailed(dur);
    if (durationValue === 'invalidTuplet') {
      report(lineIdx, tokCol, tokCol + tok.length, 'invalidTuplet', { token: tok });
      return null;
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
    return item;
  }

  function placement(c: { name: string; label?: string }, beat: number): ChordPlacement {
    return c.label !== undefined ? { name: c.name, beat, label: c.label } : { name: c.name, beat };
  }

  function parseMelodyLine(rawLine: string, bodyStart: number, lineIdx: number, sectionIndex: number | null): MelodyGroup {
    const group: MelodyGroup = { startMeasure: melodyCursor, endMeasureExclusive: melodyCursor, notes: [], cellRanges: [], verseCount: 0, sectionIndex };
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
      let fragmentFailed = false;

      if (cell.text.trim() === '%') {
        repeatChecks.push({ measureIdx, line: lineIdx, startCol: trimmedCol, endCol: trimmedEnd });
        const prevMelody = measureIdx > 0 ? measures[measureIdx - 1].melody : undefined;
        if (!prevMelody) {
          report(lineIdx, trimmedCol, trimmedEnd, 'melodyRepeatWithoutPrevious');
        } else {
          notes = prevMelody.map(n => ({ ...n, pitch: n.pitch ? { ...n.pitch } : undefined, ...(n.pitches ? { pitches: n.pitches.map(p => ({ ...p })) } : {}), tiedFromPrev: false, syllables: [] }));
          const last = prevMelody[prevMelody.length - 1];
          if (last) state.octave = last.pitch?.octave ?? state.octave;
        }
      } else {
        const re = /\S+/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(cell.text)) !== null) {
          const col = cell.col + m.index;
          if (m[0].startsWith('$')) {
            // `let` fragment: fresh copies; the line's inheritance state is neither read nor changed.
            const fragment = useFragment(m[0], lineIdx, col, CTX_MELODY);
            if (!fragment) {
              fragmentFailed = true;
              continue;
            }
            for (const ev of fragment) {
              if (ev.kind !== 'note') continue;
              const note = cloneData(ev.note);
              notes.push(note);
              melodyLocations.set(note, { line: lineIdx, startCol: col, endCol: col + m[0].length });
            }
            continue;
          }
          if (m[0].startsWith('[')) {
            const group = parseNoteGroupToken(m[0]);
            if (typeof group === 'string') {
              report(lineIdx, col, col + m[0].length, group, { token: m[0] });
              continue;
            }
            notes.push(group.note);
            melodyLocations.set(group.note, { line: lineIdx, startCol: col, endCol: col + m[0].length });
            pushGroupPitchTokens(group, lineIdx, col, sequence);
            continue;
          }
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
        if (prevNote?.tieToNext && !note.isRest) {
          const groupKindMatches = Boolean(prevNote.pitches) === Boolean(note.pitches);
          const groupPitchesMatch = !prevNote.pitches || !note.pitches || samePitchSet(prevNote.pitches, note.pitches);
          if (groupKindMatches && groupPitchesMatch) note.tiedFromPrev = true;
        }
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
      if (notes.length > 0 && cell.text.trim() !== '%' && !fragmentFailed) {
        const heads = notes.filter(n => !isGrace(n)).flatMap(n => n.parts.map(part => ({ part })));
        lengthChecks.push({ measureIdx, line: lineIdx, startCol: trimmedCol, endCol: Math.min(trimmedEnd, cellEnd), beats: total, heads });
      }
    }
    group.endMeasureExclusive = melodyCursor;
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

  const rawCapo = capo.trim();
  const definitionCapo = /^[0-9]+$/.test(rawCapo) && Number(rawCapo) <= MAX_CAPO ? Number(rawCapo) : 0;
  const definitionInstrument = createInstrumentModel(tuning, definitionCapo);
  const validDefinitionKeys = new Set<string>();
  for (const source of chordDefinitionLines) {
    const result = parseChordDefinition(source.text, definitionInstrument);
    let diagnostic: ScoreDiagnostic | undefined;
    if (!result.ok) {
      diagnostic = {
        line: source.line,
        startCol: source.startCol,
        endCol: Math.max(source.endCol, source.startCol + 1),
        severity: DIAGNOSTIC_SEVERITY.invalidChordDefinition,
        code: 'invalidChordDefinition',
        args: { reason: result.error, detail: result.detail }
      };
    } else {
      const key = chordKey(result.definition.name, result.definition.label);
      if (validDefinitionKeys.has(key)) {
        diagnostic = {
          line: source.line,
          startCol: source.startCol,
          endCol: Math.max(source.endCol, source.startCol + 1),
          severity: DIAGNOSTIC_SEVERITY.duplicateChordDefinition,
          code: 'duplicateChordDefinition',
          args: { chord: key }
        };
      } else {
        validDefinitionKeys.add(key);
        chordDefinitions.push({ ...result.definition, line: source.line });
      }
    }
    if (diagnostic) {
      const index = diagnostics.findIndex(d => d.line > source.line || (d.line === source.line && d.startCol > source.startCol));
      if (index < 0) diagnostics.push(diagnostic);
      else diagnostics.splice(index, 0, diagnostic);
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
  compileTabGroups();
  validateConnections();

  const playOrderInput: PlayOrderMeasure[] = measures.map(measure => ({
    measureIndex: measure.measureIndex,
    repeatStart: measure.repeatStart,
    repeatEnd: measure.repeatEnd,
    bracket: measure.bracket,
    specialMark: measure.specialMark,
    sectionName: measure.sectionName
  }));

  let arrangementInvalid = arrangementScan.present && arrangementScan.diagnostics.length > 0;
  let resolverInput = playOrderInput;
  if (arrangementScan.present) {
    let hasNavigationConflict = false;
    for (let index = 0; index < measures.length; index++) {
      const measure = measures[index];
      if (!measure.repeatStart && !measure.repeatEnd && measure.bracket === undefined && measure.specialMark === undefined) continue;
      const location = measureSourceLocations[index];
      if (location) report(location.line, location.startCol, location.endCol, 'arrangementNavigationConflict', { measure: index + 1 });
      hasNavigationConflict = true;
    }
    arrangementInvalid ||= hasNavigationConflict;

    if (!arrangementInvalid) {
      const arrangementSections: ArrangementSection[] = sectionDefinitions.map((section, index) => {
        const end = sectionDefinitions[index + 1]?.start ?? measures.length;
        let lyricVerseCount = Number.POSITIVE_INFINITY;
        for (const group of melodyGroups) {
          if (group.sectionIndex !== index || group.verseCount <= 0 || !group.notes.some(takesSyllable)) continue;
          lyricVerseCount = Math.min(lyricVerseCount, group.verseCount);
        }
        return {
          name: section.name,
          start: section.start,
          end,
          labelSpan: section.labelSpan,
          lyricVerseCount: Number.isFinite(lyricVerseCount) ? lyricVerseCount : 0
        };
      });
      const firstSectionStart = sectionDefinitions[0]?.start;
      const unassignedMeasuresSpan = measures.length > 0 && (firstSectionStart === undefined || firstSectionStart > 0)
        ? measureSourceLocations[0]
        : undefined;
      const lowered = lowerArrangement(arrangementScan.entries, arrangementSections, playOrderInput, unassignedMeasuresSpan);
      for (const diagnostic of lowered.diagnostics) {
        report(diagnostic.span.line, diagnostic.span.startCol, diagnostic.span.endCol, diagnostic.code, diagnostic.args);
      }
      arrangementInvalid = !lowered.valid;
      resolverInput = arrangementInvalid ? [] : lowered.measures;
    } else {
      resolverInput = [];
    }
  }

  const resolvedPlayOrder = resolvePlayOrder(resolverInput);
  const playOrder: PlayOrderResult = arrangementInvalid
    ? { valid: false, occurrences: [], diagnostics: [] }
    : resolvedPlayOrder;
  for (const playDiagnostic of playOrder.diagnostics) {
    const location = measureSourceLocations[playDiagnostic.measureIndex] ?? { line: 0, startCol: 0, endCol: 1 };
    diagnostics.push({
      line: location.line,
      startCol: location.startCol,
      endCol: location.endCol,
      severity: 'error',
      code: playDiagnostic.code,
      args: playDiagnostic.args
    });
  }

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
        m.chordBeatOffsets = m.chords.map((_, idx) => fmul(m.expectedBeats, frac(idx, m.chords.length)));
      }
    });

    for (const measure of repeatInheritedChords) {
      const index = measures.indexOf(measure);
      let source: MeasureData | undefined;
      for (let i = index - 1; i >= 0; i--) {
        if (!measures[i].isMeasureRepeat) {
          source = measures[i];
          break;
        }
      }
      if (source) {
        measure.chordPlacementMode = source.chordPlacementMode;
        measure.chordBeatOffsets = source.chordBeatOffsets.map(offset => ({ ...offset }));
      }
    }

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
  function compileTabGroups() {
    const byMeasure = new Map<number, TabBeat[]>();
    let cursor = 0;
    const cloneMeasure = (source: TabVoiceMeasure): TabVoiceMeasure => ({
      voice: source.voice,
      beats: source.beats.map(beat => ({
        ...beat,
        duration: { ...beat.duration, beats: { ...beat.duration.beats }, parts: beat.duration.parts.map(part => ({ ...part, ...(part.tuplet ? { tuplet: { ...part.tuplet } } : {}) })) },
        notes: beat.notes.map(note => ({ ...note, effects: note.effects.map(effect => ({ ...effect, args: { ...effect.args } })) })),
        effects: beat.effects.map(effect => ({ ...effect, args: { ...effect.args } })),
        syllables: beat.syllables.map(syllable => syllable ? { ...syllable } : null)
      }))
    });
    const cloneEffects = (effects: ParsedTabBeat['effects']) => effects.map(effect => ({ ...effect, args: { ...effect.args } }));

    const nextUnassigned = () => {
      while (cursor < measures.length && measures[cursor].tabVoices?.some(voice => voice.voice === 1)) cursor++;
      return cursor < measures.length ? cursor : -1;
    };

    for (const group of tabGroups) {
      let inheritedDuration: TabBeat['duration'] | undefined;
      for (const cell of group.cells) {
        const measureIndex = nextUnassigned();
        if (measureIndex < 0) {
          report(group.line, cell.startCol, cell.endCol, 'tooManyTabMeasures', { count: group.cells.length, available: measures.length });
          continue;
        }
        cursor = measureIndex + 1;
        const targetMeasure = measures[measureIndex];
        const parsed = parseTabCell(cell);
        if (parsed.isRepeat) {
          const previous = measures[measureIndex - 1]?.tabVoices?.find(voice => voice.voice === 1);
          if (!previous) {
            report(group.line, cell.startCol, cell.endCol, 'tabRepeatWithoutPrevious');
            continue;
          }
          const cloned = cloneMeasure(previous);
          targetMeasure.tabVoices = [cloned];
          byMeasure.set(measureIndex, [...cloned.beats]);
          group.assignedCells.push({ measureIndex, beatIndices: cloned.beats.map((_beat, index) => index) });
          continue;
        }

        const beats: TabBeat[] = [];
        let total = frac(0);
        const tokenized = tokenizeTabItems(cell.text);
        for (const token of tokenized) {
          const tokenStart = cell.startCol + token.start;
          if (token.text === '%') {
            report(group.line, tokenStart, tokenStart + token.text.length, 'invalidTabToken', { token: token.text });
            continue;
          }
          let parsedBeats: ParsedTabBeat[] = [];
          if (token.text.startsWith('$')) {
            const fragment = useFragment(token.text, group.line, tokenStart, CTX_TAB);
            if (!fragment) continue;
            parsedBeats = fragment.flatMap(event => {
              if (event.kind !== 'tab') return [];
              const delta = tokenStart - event.beat.startCol;
              return [{
                ...event.beat,
                startCol: tokenStart,
                endCol: tokenStart + token.text.length,
                notes: event.beat.notes.map(note => ({ ...note, startCol: note.startCol + delta, endCol: note.endCol + delta }))
              }];
            });
          } else {
            const tokenCell = { text: token.text, startCol: tokenStart, endCol: tokenStart + token.text.length };
            const parsedToken = parseTabCell(tokenCell);
            for (const issue of parsedToken.issues) {
              report(group.line, issue.startCol, issue.endCol, issue.code as DiagnosticCode, issue.args ? { ...issue.args } : undefined);
            }
            parsedBeats = [...parsedToken.beats];
          }
          for (const sourceBeat of parsedBeats) {
            const duration = sourceBeat.duration ?? inheritedDuration;
            if (!duration) {
              report(group.line, sourceBeat.startCol, sourceBeat.endCol, 'missingInitialOctaveOrLength', { token: token.text });
              continue;
            }
            if (!token.text.startsWith('$')) inheritedDuration = duration;
            total = fadd(total, duration.beats);
            const counts = new Map<number, number>();
            sourceBeat.notes.forEach(note => counts.set(note.string, (counts.get(note.string) ?? 0) + 1));
            const notes: TabNote[] = [];
            if (!sourceBeat.isRest) {
              for (const sourceNote of sourceBeat.notes) {
                if (sourceNote.string < 1 || sourceNote.string > 6 || counts.get(sourceNote.string) !== 1) continue;
                if (!sourceNote.dead && sourceNote.fret === undefined) {
                  report(group.line, sourceNote.startCol + String(sourceNote.string).length + 1, sourceNote.endCol, 'invalidTabFret', { fret: -1 });
                  continue;
                }
                let soundingPitch: number | undefined;
                if (!sourceNote.dead && sourceNote.fret !== undefined) {
                  try {
                    soundingPitch = definitionInstrument.pitchAt(sourceNote.string as TabNote['string'], sourceNote.fret);
                  } catch {
                    report(group.line, sourceNote.startCol, sourceNote.endCol, 'invalidTabFret', { fret: sourceNote.fret });
                    continue;
                  }
                }
                const note: TabNote = {
                  string: sourceNote.string as TabNote['string'],
                  ...(sourceNote.fret === undefined ? {} : { fret: sourceNote.fret }),
                  dead: sourceNote.dead,
                  ...(soundingPitch === undefined ? {} : { soundingPitch }),
                  tieToNext: sourceNote.tieToNext,
                  effects: cloneEffects(sourceNote.effects)
                };
                tabNoteLocations.set(note, { line: group.line, startCol: sourceNote.startCol, endCol: sourceNote.endCol });
                notes.push(note);
              }
            }
            beats.push({ isRest: sourceBeat.isRest, notes, duration, effects: cloneEffects(sourceBeat.effects), syllables: [] });
          }
        }
        targetMeasure.tabVoices = [{ voice: 1, beats }];
        byMeasure.set(measureIndex, beats);
        group.assignedCells.push({ measureIndex, beatIndices: beats.map((_beat, index) => index) });
        if (beats.length > 0 && !feq(total, targetMeasure.expectedBeats)) {
          report(group.line, cell.startCol, cell.endCol, 'beatCountMismatch', { beats: formatBeats(total), expected: formatBeats(targetMeasure.expectedBeats) });
        }
      }
    }

    validateTabConnections(byMeasure);
    for (const group of tabGroups) assignTabLyrics(group, byMeasure);
  }

  function validateTabConnections(byMeasure: Map<number, TabBeat[]>) {
    const positions = measures.flatMap((measure, measureIndex) => (byMeasure.get(measureIndex) ?? []).map((beat, beatIndex) => ({ measureIndex, beatIndex, beat })));
    const beats = positions.map(position => position.beat);
    positions.forEach((position, positionIndex) => {
      for (const note of position.beat.notes) {
        const loc = noteAtTab(note);
        if (!loc) continue;
        if (note.tieToNext) {
          const result = resolveTabLinkTarget(beats, positionIndex, note, 'tie');
          if (result.status !== 'valid') {
            report(loc.line, loc.startCol, loc.endCol, 'invalidTabTie', { string: note.string, fret: note.fret ?? -1 });
          }
        }
        for (const effect of note.effects) {
          if (!['hammer', 'pull', 'slide', 'gliss'].includes(effect.name)) continue;
          const result = resolveTabLinkTarget(beats, positionIndex, note, 'connection');
          if (result.status !== 'valid') {
            report(loc.line, loc.startCol, loc.endCol, result.status === 'dangling' ? 'danglingTabConnection' : 'invalidTabConnection', { technique: effect.name, string: note.string });
          }
        }
      }
    });
  }

  function assignTabLyrics(group: TabSourceGroup, byMeasure: Map<number, TabBeat[]>) {
    const flattened = group.assignedCells.flatMap(cell => cell.beatIndices.map(beatIndex => ({
      measureIndex: cell.measureIndex,
      beatIndex,
      beat: byMeasure.get(cell.measureIndex)?.[beatIndex]
    }))).filter((entry): entry is { measureIndex: number; beatIndex: number; beat: TabBeat } => entry.beat !== undefined);
    const takesSlot = (at: number, note: TabNote) => {
      if (note.dead) return true;
      for (let index = at - 1; index >= 0; index--) {
        const previous = flattened[index].beat;
        if (previous.isRest || previous.notes.length === 0) continue;
        const linked = previous.notes.find(candidate => candidate.string === note.string);
        return !(linked?.tieToNext && linked.fret === note.fret);
      }
      return true;
    };
    for (const lyric of group.lyrics) {
      const items = tokenizeLyrics(lyric.text);
      const sung = flattened.map((entry, index) => ({ entry, index })).filter(({ entry, index }) =>
        !entry.beat.isRest && entry.beat.notes.some(note => takesSlot(index, note))
      );
      let cursor = 0;
      let consumed = 0;
      for (const item of items) {
        if (item.kind === 'bar') continue;
        consumed++;
        const slot = sung[cursor++];
        if (!slot) continue;
        const syllables = [...slot.entry.beat.syllables];
        const verse = group.lyrics.indexOf(lyric);
        const syllable: Syllable | null = item.kind === 'syllable'
          ? { text: item.text, hyphenToNext: item.hyphenToNext, extend: false }
          : item.kind === 'extend'
            ? { text: '', hyphenToNext: false, extend: true }
            : null;
        syllables[verse] = syllable;
        const updated = { ...slot.entry.beat, syllables };
        const beats = byMeasure.get(slot.entry.measureIndex)!;
        beats[slot.entry.beatIndex] = updated;
        slot.entry.beat = updated;
      }
      if (consumed !== sung.length) {
        report(lyric.line, lyric.startCol, lyric.endCol, 'syllableCountMismatch', { syllables: consumed, notes: sung.length });
      }
      if (items.some(item => item.kind === 'bar')) {
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
        const expected = group.assignedCells.map(cell => {
          const cellBeatIndexes = new Set(cell.beatIndices);
          return flattened.reduce((total, entry, index) => {
          if (entry.measureIndex !== cell.measureIndex || !cellBeatIndexes.has(entry.beatIndex)) return total;
          return total + (!entry.beat.isRest && entry.beat.notes.some(note => takesSlot(index, note)) ? 1 : 0);
          }, 0);
        });
        const matches = segments.length === expected.length && segments.every((value, index) => value === expected[index]);
        if (!matches) report(lyric.line, lyric.startCol, lyric.endCol, 'lyricBarMismatch');
      }
    }
    for (const cell of group.assignedCells) {
      const beats = byMeasure.get(cell.measureIndex) ?? [];
      const voice = measures[cell.measureIndex].tabVoices?.find(item => item.voice === 1);
      if (voice) measures[cell.measureIndex].tabVoices = [{ ...voice, beats }];
    }
  }

  function noteAtTab(note: TabNote): NoteLocation | undefined {
    return tabNoteLocations.get(note);
  }

  /** Connection targets, slurs and grace notes (spec §12.2.1) over the melody and the inline-note sequences. */
  function validateConnections() {
    const melody = measures.flatMap(m => (m.melody ?? []).map(n => ({ n, loc: melodyLocations.get(n), measure: m })));
    const inline = measures.flatMap(m => (m.isMeasureRepeat ? [] : m.rhythms).map(r => ({ n: r, loc: inlineLocations.get(r), measure: m })));
    const check = <T extends { isRest: boolean; techniques?: NoteTechniques; pitch?: Pitch; pitches?: Pitch[] }>(
      seq: { n: T; loc?: NoteLocation; measure: MeasureData }[],
      tied: (n: T) => boolean
    ) => {
      const items = seq.map(s => s.n);
      let openSlur: NoteLocation | undefined;
      let openSlurSeen = false;
      seq.forEach(({ n, loc, measure }, i) => {
        // A group tie applies to every pitch and can continue only into the same pitch set.
        if (loc && tied(n) && (n.pitches || items[i + 1]?.pitches)) {
          if (!samePitchSet(n.pitches, items[i + 1]?.pitches)) {
            report(loc.line, loc.startCol, loc.endCol, 'unsupportedNoteGroupTechnique', { token: lines[loc.line].slice(loc.startCol, loc.endCol) });
          }
        }
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
          if (!rest.some(s => !s.n.isRest && !s.n.techniques?.grace)) report(loc.line, loc.startCol, loc.endCol, 'danglingGrace');
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
    check(melody, n => n.tieToNext);
    check(inline, r => r.tie);
  }

  // `let` definitions are read before the score lines: keep the documented source order.
  pitchTokens.sort((a, b) => a.line - b.line || a.startCol - b.startCol);

  const validPages = pages.filter((p, idx) => p.measures.length > 0 || idx === 0);
  validPages.forEach((p, idx) => {
    p.pageNumber = idx + 1;
  });

  return {
    title,
    artist,
    capo,
    tuning,
    originalKey,
    bpm,
    memo,
    style,
    usedChords: Array.from(usedChordsSet),
    chordDefinitions,
    measures,
    melodyGroups: melodyGroups.map(({ startMeasure, endMeasureExclusive, verseCount }) => ({ startMeasure, endMeasureExclusive, verseCount })),
    playOrder,
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
        pitch: r.pitch ? { ...r.pitch } : undefined,
        ...(r.pitches ? { pitches: r.pitches.map(p => ({ ...p })) } : {}),
        ...(r.inlineDuration ? { inlineDuration: { beats: { ...r.inlineDuration.beats }, parts: r.inlineDuration.parts.map(part => ({ ...part, ...(part.tuplet ? { tuplet: { ...part.tuplet } } : {}) })) } } : {})
      }))
    : defaultRhythms(measure.context.timeSignature, measure.expectedBeats);

  const chords = measure.chords && measure.chords.length > 0
    ? measure.chords.map(c => ({ ...c }))
    : (source?.chords?.map(c => ({ ...c })) ?? (source?.chord ? [{ name: source.chord, beat: 0 }] : []));

  const chord = measure.chord || source?.chord || (chords[0]?.name ?? '');

  const clonePitches = (n: MelodyNote) => (n.pitches ? { pitches: n.pitches.map(p => ({ ...p })) } : {});
  const tabVoices = measure.tabVoices?.map(voice => ({
    voice: voice.voice,
    beats: voice.beats.map(beat => ({
      ...beat,
      duration: { ...beat.duration, parts: beat.duration.parts.map(part => ({ ...part, ...(part.tuplet ? { tuplet: { ...part.tuplet } } : {}) })) },
      notes: beat.notes.map(note => ({ ...note, effects: note.effects.map(effect => ({ ...effect, args: { ...effect.args } })) })),
      effects: beat.effects.map(effect => ({ ...effect, args: { ...effect.args } })),
      syllables: beat.syllables.map(syllable => syllable ? { ...syllable } : null)
    }))
  }));
  const melody = measure.melody
    ? measure.melody.map(n => ({ ...n, pitch: n.pitch ? { ...n.pitch } : undefined, ...clonePitches(n) }))
    : (source?.melody ? source.melody.map(n => ({ ...n, pitch: n.pitch ? { ...n.pitch } : undefined, ...clonePitches(n), tiedFromPrev: false, syllables: [] })) : undefined);

  return {
    ...measure,
    chord,
    chords,
    isMeasureRepeat: false,
    expandedFromRepeat: true,
    rhythms,
    melody,
    ...(tabVoices ? { tabVoices } : {})
  };
}

function formatBeats(b: Fraction): string {
  return b.d === 1 ? String(b.n) : `${b.n}/${b.d}`;
}
