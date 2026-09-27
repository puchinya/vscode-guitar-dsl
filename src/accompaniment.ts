// Deterministic accompaniment engine (spec extension.md §3.10 / §8.7, design architecture.md §2.19).
// The AI (or the manual QuickPick) chooses the musical intent; this module owns everything that must be
// exact: meter compatibility, preset selection, physical down/up phase, syncopation semantics, duration
// generation, chord-interval articulation, phrase / transition / ending arrangement and the
// source-preserving edit. Pure module: no VS Code, Gemini, transcription or Audio MIR dependency.

import { MeasureData, ParsedScore, RhythmItem, parseGuitarDsl, rhythmItemBeats } from './compiler';
import { Fraction, ZERO, decomposeBeats, fadd, fcmp, feq, fmul, fnum, frac, fsub } from './duration';
import { TimeSignature, beamGroupStarts, formatTimeSignature, measureBeats, parseTimeSignature, sameTimeSignature } from './scoreEvents';
import {
  AccompanimentDensity,
  AccompanimentDifficulty,
  AccompanimentEmphasis,
  AccompanimentEnergy,
  AccompanimentFamily,
  AccompanimentStyle,
  AccompanimentSyncopation,
  FAMILY_ORDER,
  STRUMMING_PATTERN_PRESETS,
  ScoreFeel,
  StrummingPatternPreset,
  SyncopationKind,
  VariationRole,
  getPresetById,
  parseRhythmPattern
} from './strummingPatterns';

// ---------------------------------------------------------------------------
// Public input / result types (spec extension §8.7)
// ---------------------------------------------------------------------------

export type ArrangementRole = 'base' | 'variation' | 'finale';
export type GridUnit = 'quarter' | 'eighth' | 'sixteenth' | 'tripletEighth';
export type PhraseLength = 2 | 4 | 8;

interface PlanCommon {
  sectionIndex: number;
  phraseLength?: PhraseLength;
  arrangementGroup?: string;
  arrangementRole?: ArrangementRole;
}

export interface IntentPlan extends PlanCommon {
  mode: 'intent';
  style: AccompanimentStyle;
  subdivision: 'auto' | 'quarter' | 'eighth' | 'sixteenth' | 'triplet';
  family?: AccompanimentFamily;
  energy: AccompanimentEnergy;
  density: AccompanimentDensity;
  syncopation: AccompanimentSyncopation;
  syncopationKinds?: SyncopationKind[];
  emphasis: AccompanimentEmphasis;
  preferredPresetId?: string;
  difficulty?: AccompanimentDifficulty;
  operation: 'replace' | 'adapt';
}

export interface PresetPlan extends PlanCommon {
  mode: 'preset';
  presetId: string;
}

export interface GridPlan extends PlanCommon {
  mode: 'grid';
  style: 'strum' | 'arpeggio';
  gridUnit: GridUnit;
  attacks: number[];
  accents?: number[];
  ghosts?: number[];
}

export interface DslPlan extends PlanCommon {
  mode: 'dsl';
  style: AccompanimentStyle;
  pattern: string;
  directionPolicy?: 'physical' | 'literal';
}

export type AccompanimentPlan = IntentPlan | PresetPlan | GridPlan | DslPlan;

export type StructuredPatternCandidate =
  | { source: 'preset'; presetId: string }
  | { source: 'grid'; gridUnit: GridUnit; attacks: number[]; accents?: number[]; ghosts?: number[] }
  | { source: 'hold' };

export interface TransitionCandidate {
  intent: 'space' | 'hold' | 'lift' | 'fill' | 'cadence';
  targetMeasureOffset: -2 | -1;
  pattern: StructuredPatternCandidate;
}

export interface TransitionProposal {
  afterSectionIndex: number;
  candidates: TransitionCandidate[];
}

export type EndingKind = 'hold' | 'finalHit' | 'fillToHold' | 'breakThenHit' | 'rolledFinal';

export interface EndingMeasureCandidate {
  relativeMeasure: -2 | -1;
  pattern: StructuredPatternCandidate;
}

export interface EndingCandidate {
  kind: EndingKind;
  measures: EndingMeasureCandidate[];
  fermataFinal?: boolean;
}

export interface AccompanimentRequest {
  plans: AccompanimentPlan[];
  transitions?: TransitionProposal[];
  ending?: { candidates: EndingCandidate[] };
}

export type AccompanimentFailureCode =
  | 'invalidInput'
  | 'sectionNotFound'
  | 'duplicateSectionPlan'
  | 'mixedMeterSection'
  | 'mixedFeelSection'
  | 'invalidPresetForContext'
  | 'invalidGridAttack'
  | 'invalidRhythmPattern'
  | 'rhythmBeatCountMismatch'
  | 'unnaturalStrokeDirection'
  | 'measureContainsInlinePitch'
  | 'repeatWouldChangeMeaning'
  | 'patternMissesChordChange'
  | 'noCompatibleAdaptation'
  | 'invalidVariationRelationship'
  | 'unsupportedCrossBarSyncopation'
  | 'editRejected';

export type RejectionReason = 'meter' | 'style' | 'subdivision' | 'scoreFeel' | 'difficulty' | 'syncopationKind' | 'chordChange' | 'adaptation';

export interface SelectionRationale {
  matchedTraits: string[];
  rejectedCandidates?: { id: string; reason: RejectionReason }[];
}

export interface AccompanimentWarning {
  code: 'partialMeasurePreserved' | 'vocalTimingUnknown';
  sectionIndex?: number;
  /** 1-based measure number in source order. */
  measureNumber?: number;
}

export interface AppliedSection {
  sectionIndex: number;
  mode: AccompanimentPlan['mode'];
  selectedPresetId?: string;
  generatedPattern?: string;
  meter: string;
  /** The effective score feel of the target measures, or `mixed`. */
  scoreFeel: ScoreFeel | 'mixed';
  operation: 'replace' | 'adapt';
  phraseLength?: PhraseLength;
  arrangementGroup?: string;
  arrangementRole?: ArrangementRole;
  variationPresetsUsed: string[];
  selectionRationale: SelectionRationale;
}

export interface TransitionResult {
  afterSectionIndex: number;
  applied: boolean;
  candidateIndex?: number;
  intent?: TransitionCandidate['intent'];
  rationale?: string;
}

export interface EndingResult {
  applied: boolean;
  kind?: EndingKind;
  windowMeasures?: number;
  usedFermata?: boolean;
  rationale?: string;
}

export type AccompanimentPlanResult =
  | {
      ok: true;
      text: string;
      changed: boolean;
      appliedSections: AppliedSection[];
      transitionResults?: TransitionResult[];
      endingResult?: EndingResult;
      warnings: AccompanimentWarning[];
    }
  | { ok: false; code: AccompanimentFailureCode; detail?: string };

export interface AccompanimentOptions {
  /** Phrase-end variations (spec §8.7.6); the manual QuickPick applies the chosen preset exactly. */
  phraseVariation?: boolean;
}

// ---------------------------------------------------------------------------
// Rhythm events, phase and syncopation
// ---------------------------------------------------------------------------

/** One rhythm item placed in its measure (quarter-beat offsets). */
export interface PatternEvent {
  item: RhythmItem;
  onset: Fraction;
  beats: Fraction;
  /** A struck event (not a rest, not the continuation of a `.t` tie); ghost strokes count. */
  stroke: boolean;
  /** Presents the chord: a stroke that is not a ghost (D3). */
  harmonic: boolean;
}

export function patternEvents(rhythms: readonly RhythmItem[]): PatternEvent[] {
  const events: PatternEvent[] = [];
  let onset = ZERO;
  let tiedIn = false;
  for (const item of rhythms) {
    const beats = rhythmItemBeats(item);
    const stroke = !item.isRest && !tiedIn;
    events.push({ item, onset, beats, stroke, harmonic: stroke && !item.ghost });
    tiedIn = !item.isRest && item.tie;
    onset = fadd(onset, beats);
  }
  return events;
}

function eventsLength(events: readonly PatternEvent[]): Fraction {
  return events.reduce((acc, e) => fadd(acc, e.beats), ZERO);
}

const isMultiple = (value: Fraction, unit: Fraction): boolean => {
  const q = frac(value.n * unit.d, value.d * unit.n);
  return q.d === 1;
};

const floorBeat = (f: Fraction): Fraction => frac(Math.floor(f.n / f.d));

/** Quarter-beat pulses of the meter (group starts; `ts.groups` is the grouping authority). */
function pulses(ts: TimeSignature): Fraction[] {
  return beamGroupStarts(ts);
}

/** Simple meters reset the stroke phase every quarter beat; compound / odd x/8 meters every beat group. */
function phaseGroupStart(ts: TimeSignature, onset: Fraction): Fraction {
  if (ts.denominator <= 4) return floorBeat(onset);
  let start = ZERO;
  for (const p of pulses(ts)) if (fcmp(p, onset) <= 0) start = p;
  return start;
}

type PhaseGrid = { kind: 'straight'; unit: Fraction } | { kind: 'swing' } | { kind: 'triplet'; unit: Fraction };

const STRAIGHT_UNITS = [frac(1), frac(1, 2), frac(1, 4), frac(1, 8)];

/**
 * Coarsest pendulum compatible with every stroke onset (spec §9.2 / §9.4): quarter, eighth or sixteenth for
 * straight grids; for triplet grids the swung-eighth pair (first + third triplet = D U) unless a middle
 * triplet is struck, then the full triplet phase (D U D). Null for grids that mix straight and triplet
 * positions.
 */
function phaseGrid(ts: TimeSignature, onsets: readonly Fraction[]): PhaseGrid | null {
  const groupStarts = ts.denominator <= 4 ? [] : pulses(ts);
  for (const unit of STRAIGHT_UNITS) {
    if (onsets.every(o => isMultiple(fsub(o, phaseGroupStart(ts, o)), unit)) && groupStarts.every(g => isMultiple(g, unit))) {
      return { kind: 'straight', unit };
    }
  }
  const inBeat = onsets.map(o => fsub(o, floorBeat(o)));
  if (inBeat.every(r => r.n === 0 || feq(r, frac(2, 3)))) return { kind: 'swing' };
  if (inBeat.every(r => isMultiple(r, frac(1, 3)))) return { kind: 'triplet', unit: frac(1, 3) };
  if (inBeat.every(r => isMultiple(r, frac(1, 6)))) return { kind: 'triplet', unit: frac(1, 6) };
  return null;
}

function expectedDirection(ts: TimeSignature, grid: PhaseGrid, onset: Fraction): 'd' | 'u' {
  if (grid.kind === 'swing') return fsub(onset, floorBeat(onset)).n === 0 ? 'd' : 'u';
  const start = grid.kind === 'triplet' ? floorBeat(onset) : phaseGroupStart(ts, onset);
  const pos = frac(fsub(onset, start).n * grid.unit.d, fsub(onset, start).d * grid.unit.n);
  return pos.n % 2 === 0 ? 'd' : 'u';
}

const directionOf = (item: RhythmItem): 'd' | 'u' | null => (item.down && !item.up ? 'd' : item.up && !item.down ? 'u' : null);

/**
 * Checks a strum pattern against the physical pendulum (spec §9): every stroke needs exactly one of
 * `.d` / `.u`, matching the metric phase. Rests and tie continuations advance the phase silently.
 */
export function strokeDirectionProblem(ts: TimeSignature, events: readonly PatternEvent[]): string | undefined {
  const strokes = events.filter(e => e.stroke);
  const grid = phaseGrid(ts, strokes.map(e => e.onset));
  if (!grid) return 'the pattern mixes straight and triplet positions';
  for (const e of strokes) {
    const dir = directionOf(e.item);
    if (!dir) return `stroke at beat ${formatOffset(e.onset)} needs exactly one of .d / .u`;
    const expected = expectedDirection(ts, grid, e.onset);
    if (dir !== expected) return `stroke at beat ${formatOffset(e.onset)} should be .${expected} (physical down/up phase)`;
  }
  return undefined;
}

/** Physical direction for a stroke at `onset` among `onsets` (used when generating patterns). */
function physicalDirections(ts: TimeSignature, onsets: readonly Fraction[]): ('d' | 'u')[] | null {
  const grid = phaseGrid(ts, onsets);
  return grid ? onsets.map(o => expectedDirection(ts, grid, o)) : null;
}

/**
 * Syncopation kinds of a one-measure pattern (spec §10), judged on metric onsets and durations only:
 * - `anticipation` + `beatCrossing`: an off-pulse stroke sounds through the next pulse, which is not struck;
 * - `offbeat`: an off-pulse stroke is followed by a silent pulse, or carries `.a` between unaccented pulses.
 * The pulse at the barline is out of scope (no cross-bar syncopation).
 */
export function classifySyncopation(ts: TimeSignature, events: readonly PatternEvent[]): SyncopationKind[] {
  const kinds = new Set<SyncopationKind>();
  const length = eventsLength(events);
  const ps = pulses(ts).filter(p => fcmp(p, length) < 0);
  const isPulse = (o: Fraction) => ps.some(p => feq(p, o));
  const strokeAt = (o: Fraction) => events.find(e => e.stroke && feq(e.onset, o));
  const soundingAt = (o: Fraction) => events.some(e => !e.item.isRest && fcmp(e.onset, o) <= 0 && fcmp(fadd(e.onset, e.beats), o) > 0);
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    if (!e.stroke || isPulse(e.onset)) continue;
    const next = ps.find(p => fcmp(p, e.onset) > 0);
    const prev = [...ps].reverse().find(p => fcmp(p, e.onset) < 0);
    if (next && !strokeAt(next)) {
      // Sounding through the pulse: the stroke itself, or its tie continuation.
      let end = fadd(e.onset, e.beats);
      for (let j = i + 1; j < events.length && events[j - 1].item.tie && !events[j].item.isRest; j++) end = fadd(end, events[j].beats);
      if (fcmp(end, next) > 0) {
        kinds.add('anticipation');
        kinds.add('beatCrossing');
      } else if (!soundingAt(next)) {
        kinds.add('offbeat');
      }
    }
    if (e.item.accent && !e.item.ghost) {
      const accented = (p: Fraction | undefined) => (p ? strokeAt(p)?.item.accent === true : false);
      if (!accented(next) && !accented(prev)) kinds.add('offbeat');
    }
  }
  return ['offbeat', 'anticipation', 'beatCrossing'].filter(k => kinds.has(k as SyncopationKind)) as SyncopationKind[];
}

// ---------------------------------------------------------------------------
// Chord-interval articulation (decision D3)
// ---------------------------------------------------------------------------

/** Chord intervals [start, end) of a measure; consecutive placements of the same chord merge. */
function chordIntervals(measure: MeasureData, length: Fraction): { start: Fraction; end: Fraction }[] {
  const placements = [...measure.chords].sort((a, b) => a.beat - b.beat);
  const starts: Fraction[] = [];
  let prevKey: string | undefined;
  for (const c of placements) {
    const key = `${c.name}@${c.label ?? ''}`;
    if (key !== prevKey) starts.push(toFraction(c.beat));
    prevKey = key;
  }
  return starts
    .filter(s => fcmp(s, length) < 0)
    .map((start, i, all) => ({ start, end: i + 1 < all.length ? all[i + 1] : length }));
}

/** Hard rule: every chord interval of the measure contains at least one harmonic attack. */
function missesChordChange(measure: MeasureData, events: readonly PatternEvent[]): boolean {
  const length = eventsLength(events);
  return chordIntervals(measure, length).some(
    iv => !events.some(e => e.harmonic && fcmp(e.onset, iv.start) >= 0 && fcmp(e.onset, iv.end) < 0)
  );
}

/** Soft rule input: some chord onset has no harmonic attack exactly on it. */
function delaysChordOnset(measure: MeasureData, events: readonly PatternEvent[]): boolean {
  const length = eventsLength(events);
  return chordIntervals(measure, length).some(iv => !events.some(e => e.harmonic && feq(e.onset, iv.start)));
}

function toFraction(beat: number): Fraction {
  return frac(Math.round(beat * 48), 48);
}

function formatOffset(f: Fraction): string {
  return String(Math.round(fnum(f) * 1000) / 1000);
}

// ---------------------------------------------------------------------------
// Token formatting
// ---------------------------------------------------------------------------

const TRIPLET_PARTS: { beats: Fraction; token: string }[] = [
  { beats: frac(4), token: '1' },
  { beats: frac(2), token: '2' },
  { beats: frac(1), token: '4' },
  { beats: frac(2, 3), token: '4t' },
  { beats: frac(1, 2), token: '8' },
  { beats: frac(1, 3), token: '8t' },
  { beats: frac(1, 4), token: '16' },
  { beats: frac(1, 6), token: '16t' }
];

/** Duration parts (rhythm-token syntax: no dots) for an exact beat length, largest first; null when impossible. */
function durationParts(beats: Fraction): string[] | null {
  if (beats.n <= 0) return null;
  const straight = decomposeBeats(beats);
  if (straight) return straight.flatMap(p => (p.dotted ? [String(p.base), String(p.base * 2)] : [String(p.base)]));
  const parts: string[] = [];
  let rest = beats;
  for (const entry of TRIPLET_PARTS) {
    while (fcmp(rest, entry.beats) >= 0) {
      parts.push(entry.token);
      rest = fsub(rest, entry.beats);
    }
  }
  return rest.n === 0 ? parts : null;
}

const MODIFIER_ORDER: [keyof NonNullable<RhythmItem['techniques']>, string][] = [
  ['palmMute', 'pm'],
  ['letRing', 'lr'],
  ['staccato', 'stacc'],
  ['tenuto', 'ten'],
  ['fermata', 'fermata'],
  ['vibrato', 'vib'],
  ['breath', 'breath']
];

/** Rhythm token of an item with a (possibly new) duration string. */
function formatItem(item: RhythmItem, duration = item.duration.replace(/^r/, '')): string {
  const mods: string[] = [];
  if (item.down) mods.push('d');
  if (item.up) mods.push('u');
  if (item.accent) mods.push('a');
  if (item.ghost) mods.push('g');
  if (item.arpeggio) mods.push('arp');
  for (const [key, mod] of MODIFIER_ORDER) if (item.techniques?.[key]) mods.push(mod);
  if (item.tie) mods.push('t');
  return [(item.isRest ? 'r' : '') + duration, ...mods].join('.');
}

export function formatRhythms(rhythms: readonly RhythmItem[]): string {
  return rhythms.map(r => formatItem(r)).join(' ');
}

/** Rest tokens filling `beats` (one token per part). */
function restTokens(beats: Fraction): string[] | null {
  const parts = durationParts(beats);
  return parts ? parts.map(p => `r${p}`) : null;
}

// ---------------------------------------------------------------------------
// Pattern analysis of catalog presets / explicit patterns
// ---------------------------------------------------------------------------

export function timeSignatureOf(meter: string): TimeSignature | null {
  const parsed = parseTimeSignature(meter);
  return parsed.ok ? parsed.value : null;
}

interface ParsedPattern {
  rhythms: RhythmItem[];
  events: PatternEvent[];
  text: string;
}

const presetPatternCache = new Map<string, ParsedPattern>();

function parsePresetPattern(preset: StrummingPatternPreset): ParsedPattern {
  const cached = presetPatternCache.get(preset.id);
  if (cached) return cached;
  const parsed = parseRhythmPattern(preset.pattern, preset.meter);
  if (!parsed.ok) throw new Error(`invalid catalog pattern ${preset.id}: ${parsed.detail}`);
  const value = { rhythms: parsed.rhythms, events: patternEvents(parsed.rhythms), text: formatRhythms(parsed.rhythms) };
  presetPatternCache.set(preset.id, value);
  return value;
}

/**
 * Catalog self-check (spec §4.4) of one preset; returns the problems found. Exported for tests: the
 * catalog is data, so its consistency is verified mechanically rather than trusted.
 */
export function presetProblems(preset: StrummingPatternPreset): string[] {
  const problems: string[] = [];
  const ts = timeSignatureOf(preset.meter);
  if (!ts) return [`invalid meter ${preset.meter}`];
  const parsed = parseRhythmPattern(preset.pattern, preset.meter);
  if (!parsed.ok) return [`pattern does not parse: ${parsed.detail}`];
  if (!feq(parsed.beats, measureBeats(ts))) problems.push('pattern length differs from the meter');
  const events = patternEvents(parsed.rhythms);
  const strokes = events.filter(e => e.stroke);
  const hasDirection = parsed.rhythms.some(r => r.down || r.up);
  if (preset.directionModel === 'pendulum') {
    const problem = strokeDirectionProblem(ts, events);
    if (problem) problems.push(`pendulum: ${problem}`);
  } else if (preset.directionModel === 'authored') {
    if (strokes.some(e => !directionOf(e.item))) problems.push('authored: every stroke needs a direction');
    if (!strokeDirectionProblem(ts, events)) problems.push('authored: the pattern follows the pendulum; use pendulum');
  } else if (hasDirection) {
    problems.push('none: the pattern must not carry .d / .u');
  }
  const kinds = classifySyncopation(ts, events);
  const declared = [...preset.syncopationKinds].sort().join('+');
  if (kinds.slice().sort().join('+') !== declared) problems.push(`syncopationKinds ${declared || 'none'} but the pattern has ${kinds.join('+') || 'none'}`);
  if ((preset.syncopation === 'none') !== (preset.syncopationKinds.length === 0)) problems.push('syncopation level and kinds disagree');
  // Style vs modifiers.
  const arp = parsed.rhythms.filter(r => r.arpeggio).length;
  if (preset.style === 'rolled' && arp !== strokes.length) problems.push('rolled: every stroke needs .arp');
  if (preset.style !== 'rolled' && arp > 0) problems.push('.arp belongs to rolled presets');
  if (preset.style === 'arpeggio' && parsed.rhythms.some(r => r.ghost || r.techniques?.palmMute)) problems.push('arpeggio: no ghost / palm mute');
  if (['arpeggio', 'rolled'].includes(preset.style) && preset.directionModel !== 'none') problems.push(`${preset.style}: directionModel must be none`);
  if (['strum', 'sustain'].includes(preset.style) && preset.directionModel === 'none') problems.push(`${preset.style}: needs stroke directions`);
  // Emphasis vs explicit accents.
  const accents = events.filter(e => e.stroke && e.item.accent).map(e => e.onset);
  const pulseIndex = (o: Fraction) => pulses(ts).findIndex(p => feq(p, o));
  if (preset.emphasis === 'none' && accents.length > 0) problems.push('emphasis none but the pattern has .a');
  if (preset.emphasis === 'backbeat' && accents.some(o => pulseIndex(o) < 0 || pulseIndex(o) % 2 === 0)) problems.push('backbeat accents must fall on pulses 2 / 4');
  if (preset.emphasis === 'downbeat' && accents.some(o => pulseIndex(o) !== 0)) problems.push('downbeat accents must fall on the first pulse');
  if (preset.emphasis === 'offbeat' && accents.some(o => pulseIndex(o) >= 0)) problems.push('offbeat accents must fall between pulses');
  if (preset.feelCompatibility !== 'any' && (preset.feelCompatibility.length === 0 || preset.feelCompatibility.some(f => !['straight', 'swing', 'shuffle'].includes(f)))) {
    problems.push('feelCompatibility must be any or a non-empty list of straight / swing / shuffle');
  }
  if (preset.variationOf !== undefined || preset.variationRole !== undefined) {
    const root = preset.variationOf ? getPresetById(preset.variationOf) : undefined;
    if (!root || !preset.variationRole) problems.push('variationOf / variationRole must name an existing preset together');
    else if (root.meter !== preset.meter || root.family !== preset.family) problems.push('a variation must share meter and family with its root');
  }
  return problems;
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

export interface AccompanimentSection {
  sectionIndex: number;
  name: string | null;
  /** 0-based line of the `[name]` label; null for the unnamed leading section. */
  labelLine: number | null;
  measures: MeasureData[];
}

const SECTION_LABEL = /^\[([^\]]+)\]$/;

/**
 * Sections in source order (spec §8.7.2): measures before the first label form an unnamed section 0; every
 * label starts a new section (repeated names are separate sections). Membership is propagated from the
 * first measure, since the parser keeps `sectionName` only there.
 */
export function accompanimentSections(score: ParsedScore, text: string): AccompanimentSection[] {
  const sections: AccompanimentSection[] = [];
  for (const m of score.measures) {
    if (sections.length === 0 || m.sectionName) {
      sections.push({ sectionIndex: sections.length, name: m.sectionName ? m.sectionName : null, labelLine: null, measures: [] });
    }
    sections[sections.length - 1].measures.push(m);
  }
  const labels = text
    .split(/\r?\n/)
    .map((raw, line) => ({ line, match: raw.trim().match(SECTION_LABEL) }))
    .filter(l => l.match)
    .map(l => ({ line: l.line, name: (l.match as RegExpMatchArray)[1] }));
  let from = 0;
  for (const section of sections) {
    if (section.name === null) continue;
    const firstLine = firstMeasureLine(section);
    let chosen = -1;
    for (let i = from; i < labels.length; i++) {
      if (firstLine !== undefined && labels[i].line > firstLine) break;
      if (labels[i].name === section.name) chosen = i;
      if (firstLine === undefined && chosen >= 0) break;
    }
    if (chosen >= 0) {
      section.labelLine = labels[chosen].line;
      from = chosen + 1;
    }
  }
  return sections;
}

function firstMeasureLine(section: AccompanimentSection): number | undefined {
  for (const m of section.measures) if (m.rhythmSource) return m.rhythmSource.line;
  return undefined;
}

const isFullMeasure = (m: MeasureData): boolean => feq(m.expectedBeats, measureBeats(m.context.timeSignature));
const hasInlinePitch = (m: MeasureData): boolean => m.rhythms.some(r => r.pitch || r.pitches);

/** Rhythm items a measure plays (a `%` measure plays its source measure's rhythm). */
function effectiveRhythms(m: MeasureData, all: readonly MeasureData[]): RhythmItem[] {
  if (!m.isMeasureRepeat) return m.rhythms;
  for (let i = m.measureIndex - 1; i >= 0; i--) if (!all[i].isMeasureRepeat) return all[i].rhythms;
  return [];
}

function meterString(ts: TimeSignature): string {
  return formatTimeSignature(ts);
}

// ---------------------------------------------------------------------------
// Preset matching, families, adaptation candidates
// ---------------------------------------------------------------------------

const meterMatches = (preset: StrummingPatternPreset, ts: TimeSignature): boolean => {
  const pts = timeSignatureOf(preset.meter);
  return !!pts && sameTimeSignature(pts, ts);
};

const feelAllows = (preset: StrummingPatternPreset, feels: readonly ScoreFeel[]): boolean =>
  preset.feelCompatibility === 'any' || feels.every(f => (preset.feelCompatibility as ScoreFeel[]).includes(f));

/** Canonical presets whose exact pattern the measure plays (meter and feel compatible). */
function matchingPresets(m: MeasureData, all: readonly MeasureData[]): StrummingPatternPreset[] {
  const text = formatRhythms(effectiveRhythms(m, all));
  return STRUMMING_PATTERN_PRESETS.filter(
    p => meterMatches(p, m.context.timeSignature) && feelAllows(p, [m.context.feel]) && parsePresetPattern(p).text === text
  );
}

/** Structural family of a rhythm that matches no preset (arpeggio / rolled / quarter / eighth / sixteenth / triplet). */
function structuralFamily(m: MeasureData, all: readonly MeasureData[]): AccompanimentFamily | null {
  const rhythms = effectiveRhythms(m, all);
  const events = patternEvents(rhythms).filter(e => e.stroke);
  if (events.length === 0) return null;
  if (rhythms.some(r => r.arpeggio)) return 'rolled';
  if (!rhythms.some(r => r.down || r.up)) return 'arpeggio';
  const grid = phaseGrid(m.context.timeSignature, events.map(e => e.onset));
  if (!grid) return null;
  if (grid.kind === 'swing') return 'shuffle';
  if (grid.kind === 'triplet') return 'triplet';
  if (feq(grid.unit, frac(1))) return 'quarter';
  return feq(grid.unit, frac(1, 2)) ? 'eighth' : 'sixteenth';
}

/** Most frequent canonical match among the section's full source measures (ties: catalog order). */
function currentPreset(section: AccompanimentSection, all: readonly MeasureData[]): StrummingPatternPreset | undefined {
  const counts = new Map<string, number>();
  for (const m of section.measures.filter(isFullMeasure)) for (const p of matchingPresets(m, all)) counts.set(p.id, (counts.get(p.id) ?? 0) + 1);
  let best: StrummingPatternPreset | undefined;
  for (const p of STRUMMING_PATTERN_PRESETS) {
    const c = counts.get(p.id) ?? 0;
    if (c > 0 && (!best || c > (counts.get(best.id) ?? 0))) best = p;
  }
  return best;
}

const relatedByVariation = (a: StrummingPatternPreset, b: StrummingPatternPreset): boolean =>
  a.variationOf === b.id || b.variationOf === a.id || (!!a.variationOf && a.variationOf === b.variationOf);

/** Same-family / style / subdivision structural candidates for `adapt` (max 5; variation relatives first). */
function adaptationCandidates(current: StrummingPatternPreset, ts: TimeSignature, feels: readonly ScoreFeel[]): StrummingPatternPreset[] {
  const same = STRUMMING_PATTERN_PRESETS.filter(
    p =>
      p.id !== current.id &&
      meterMatches(p, ts) &&
      feelAllows(p, feels) &&
      p.family === current.family &&
      p.style === current.style &&
      p.subdivision === current.subdivision
  );
  return [...same.filter(p => relatedByVariation(p, current)), ...same.filter(p => !relatedByVariation(p, current))].slice(0, 5);
}

/** Families with at least one preset for the meter / feels, in display order. */
export function availableFamilies(ts: TimeSignature, feels: readonly ScoreFeel[]): AccompanimentFamily[] {
  return FAMILY_ORDER.filter(f => STRUMMING_PATTERN_PRESETS.some(p => p.family === f && meterMatches(p, ts) && feelAllows(p, feels)));
}

/** Presets of one family compatible with the meter / feels, in catalog order. */
export function presetsForFamily(family: AccompanimentFamily, ts: TimeSignature, feels: readonly ScoreFeel[]): StrummingPatternPreset[] {
  return STRUMMING_PATTERN_PRESETS.filter(p => p.family === family && meterMatches(p, ts) && feelAllows(p, feels));
}

// ---------------------------------------------------------------------------
// Analysis (read-only tool)
// ---------------------------------------------------------------------------

export interface PresetSummary {
  id: string;
  name: string;
  family: AccompanimentFamily;
  usageGroup: StrummingPatternPreset['usageGroup'];
  style: AccompanimentStyle;
  subdivision: StrummingPatternPreset['subdivision'];
  feelCompatibility: StrummingPatternPreset['feelCompatibility'];
  energy: AccompanimentEnergy;
  density: AccompanimentDensity;
  syncopation: AccompanimentSyncopation;
  syncopationKinds: SyncopationKind[];
  emphasis: AccompanimentEmphasis;
  difficulty: AccompanimentDifficulty;
  chordArticulation: StrummingPatternPreset['chordArticulation'];
  variationOf?: string;
  variationRole?: VariationRole;
  tags: string[];
}

export function presetSummary(p: StrummingPatternPreset, locale: 'ja' | 'en' = 'en'): PresetSummary {
  return {
    id: p.id,
    name: locale === 'ja' ? p.nameJa : p.nameEn,
    family: p.family,
    usageGroup: p.usageGroup,
    style: p.style,
    subdivision: p.subdivision,
    feelCompatibility: p.feelCompatibility,
    energy: p.energy,
    density: p.density,
    syncopation: p.syncopation,
    syncopationKinds: [...p.syncopationKinds],
    emphasis: p.emphasis,
    difficulty: p.difficulty,
    chordArticulation: p.chordArticulation,
    ...(p.variationOf ? { variationOf: p.variationOf, variationRole: p.variationRole } : {}),
    tags: [...p.tags]
  };
}

export interface SectionAnalysis {
  sectionIndex: number;
  name: string | null;
  measureCount: number;
  meters: string[];
  /** Distinct measure lengths in quarter beats (partial measures show their pickup / complement length). */
  expectedBeats: number[];
  feels: ScoreFeel[];
  currentRhythmFamilies: AccompanimentFamily[];
  currentPresetMatches: string[];
  adaptationCandidates: string[];
  availableFamilies: AccompanimentFamily[];
}

export interface VocalBoundaryContext {
  currentLastSungEnd?: number;
  currentTrailingSpaceBeats?: number;
  nextFirstSungOnset?: number;
  continuesByTie: boolean;
  continuesByHyphen: boolean;
  continuesByMelisma: boolean;
  confidence: 'exact' | 'measureOnly' | 'none';
}

export interface TransitionContext {
  afterSectionIndex: number;
  currentMeter: string;
  currentFeel: ScoreFeel;
  nextMeter: string;
  nextFeel: ScoreFeel;
  vocal: VocalBoundaryContext;
}

export interface EndingContext {
  finalSectionIndex: number;
  measureCount: number;
  vocalEnding: {
    lastSungOnset?: number;
    lastSungEnd?: number;
    trailingSpaceBeats?: number;
    continuesByTie: boolean;
    continuesByHyphen: boolean;
    continuesByMelisma: boolean;
    confidence: 'exact' | 'measureOnly' | 'none';
  };
  finalChordOnsets: number[];
  finalMelodyEnd?: number;
  finalMeasureBeats: number;
  hasFinalBarline: boolean;
}

export type AccompanimentAnalysis =
  | {
      ok: true;
      bpm: number | null;
      sections: SectionAnalysis[];
      selectedSection?: { sectionIndex: number; family?: AccompanimentFamily; availablePresets?: PresetSummary[] };
      transitionContexts?: TransitionContext[];
      endingContext?: EndingContext;
      warnings: { code: string; sectionIndex?: number }[];
    }
  | { ok: false; code: 'invalidInput' | 'sectionNotFound'; detail?: string };

function distinctMeters(measures: readonly MeasureData[]): TimeSignature[] {
  const out: TimeSignature[] = [];
  for (const m of measures) if (!out.some(t => sameTimeSignature(t, m.context.timeSignature))) out.push(m.context.timeSignature);
  return out;
}

function distinctFeels(measures: readonly MeasureData[]): ScoreFeel[] {
  return [...new Set(measures.map(m => m.context.feel))];
}

function analyzeSection(section: AccompanimentSection, all: readonly MeasureData[]): SectionAnalysis {
  const full = section.measures.filter(isFullMeasure);
  const meters = distinctMeters(section.measures);
  const fullMeters = distinctMeters(full);
  const feels = distinctFeels(full.length > 0 ? full : section.measures);
  const matches = new Set<string>();
  const families = new Set<AccompanimentFamily>();
  for (const m of full) {
    const found = matchingPresets(m, all);
    found.forEach(p => {
      matches.add(p.id);
      families.add(p.family);
    });
    if (found.length === 0) {
      const f = structuralFamily(m, all);
      if (f) families.add(f);
    }
  }
  const current = currentPreset(section, all);
  const single = fullMeters.length === 1 ? fullMeters[0] : undefined;
  return {
    sectionIndex: section.sectionIndex,
    name: section.name,
    measureCount: section.measures.length,
    meters: meters.map(meterString),
    expectedBeats: [...new Set(section.measures.map(m => fnum(m.expectedBeats)))],
    feels,
    currentRhythmFamilies: FAMILY_ORDER.filter(f => families.has(f)),
    currentPresetMatches: STRUMMING_PATTERN_PRESETS.filter(p => matches.has(p.id)).map(p => p.id),
    adaptationCandidates: current && single ? adaptationCandidates(current, single, feels).map(p => p.id) : [],
    availableFamilies: single ? availableFamilies(single, feels) : []
  };
}

export function analyzeAccompaniment(
  text: string,
  query: { sectionIndex?: number; family?: AccompanimentFamily },
  locale: 'ja' | 'en' = 'en'
): AccompanimentAnalysis {
  const score = parseGuitarDsl(text);
  const sections = accompanimentSections(score, text);
  const bpmValue = Number(score.bpm);
  const bpm = Number.isFinite(bpmValue) && bpmValue > 0 ? bpmValue : null;
  const warnings: { code: string; sectionIndex?: number }[] = [];
  if (query.family !== undefined && query.sectionIndex === undefined) return { ok: false, code: 'invalidInput', detail: 'family requires sectionIndex' };
  if (query.sectionIndex === undefined) {
    const analyses = sections.map(s => analyzeSection(s, score.measures));
    analyses.filter(a => a.meters.length > 1).forEach(a => warnings.push({ code: 'mixedMeterSection', sectionIndex: a.sectionIndex }));
    const transitionContexts = sections.slice(0, -1).map((s, i) => transitionContext(s, sections[i + 1]));
    const endingContext = sections.length > 0 ? buildEndingContext(sections[sections.length - 1]) : undefined;
    return { ok: true, bpm, sections: analyses, transitionContexts, ...(endingContext ? { endingContext } : {}), warnings };
  }
  const section = sections[query.sectionIndex];
  if (!section) return { ok: false, code: 'sectionNotFound', detail: `sectionIndex ${query.sectionIndex} (0-based) does not exist; the score has ${sections.length} section(s)` };
  const analysis = analyzeSection(section, score.measures);
  const selectedSection: { sectionIndex: number; family?: AccompanimentFamily; availablePresets?: PresetSummary[] } = { sectionIndex: section.sectionIndex };
  if (query.family !== undefined) {
    selectedSection.family = query.family;
    const full = section.measures.filter(isFullMeasure);
    const meters = distinctMeters(full);
    if (meters.length === 1) {
      selectedSection.availablePresets = presetsForFamily(query.family, meters[0], distinctFeels(full)).map(p => presetSummary(p, locale));
    } else {
      selectedSection.availablePresets = [];
      warnings.push({ code: meters.length > 1 ? 'mixedMeterSection' : 'partialMeasurePreserved', sectionIndex: section.sectionIndex });
    }
  }
  return { ok: true, bpm, sections: [analysis], selectedSection, warnings };
}

// ---------------------------------------------------------------------------
// Vocal timing (mel: + lyr:) for transitions and endings
// ---------------------------------------------------------------------------

interface VocalWindow {
  confidence: 'exact' | 'measureOnly' | 'none';
  /** Latest end of sung material over all verses, relative to the start of `anchor`; undefined = none sung. */
  lastSungEnd?: Fraction;
  lastSungOnset?: Fraction;
  continuesByTie: boolean;
  continuesByHyphen: boolean;
}

/** Latest sung onset / end in `measures` (all verses; ties and melismas extend a sung note), relative to the first measure. */
function vocalWindow(measures: readonly MeasureData[]): VocalWindow {
  let offset = ZERO;
  let exact = false;
  let measureLyric = false;
  let lastSungEnd: Fraction | undefined;
  let lastSungOnset: Fraction | undefined;
  let continuesByTie = false;
  let continuesByHyphen = false;
  let sungActive = false;
  for (const m of measures) {
    if (m.lyric.trim()) measureLyric = true;
    let pos = offset;
    for (const n of m.melody ?? []) {
      const syllables = n.syllables.filter((s): s is NonNullable<typeof s> => !!s);
      if (!n.isRest && syllables.length > 0) exact = true;
      const sung: boolean = !n.isRest && (syllables.length > 0 || (n.tiedFromPrev && sungActive) || (syllables.some(s => s.extend) && sungActive));
      if (sung) {
        lastSungOnset = pos;
        lastSungEnd = fadd(pos, n.beats);
        continuesByTie = n.tieToNext;
        continuesByHyphen = syllables.some(s => s.hyphenToNext);
      }
      sungActive = sung || (sungActive && !n.isRest);
      if (n.isRest) sungActive = false;
      pos = fadd(pos, n.beats);
    }
    offset = fadd(offset, m.expectedBeats);
  }
  const confidence = exact ? 'exact' : measureLyric ? 'measureOnly' : 'none';
  return { confidence, lastSungEnd, lastSungOnset, continuesByTie: exact && continuesByTie, continuesByHyphen: exact && continuesByHyphen };
}

/** Earliest sung onset of the measure and whether it continues a melisma. */
function firstSung(m: MeasureData | undefined): { onset?: Fraction; melisma: boolean } {
  let pos = ZERO;
  for (const n of m?.melody ?? []) {
    const syllables = n.syllables.filter((s): s is NonNullable<typeof s> => !!s);
    if (!n.isRest && (syllables.length > 0 || n.tiedFromPrev)) return { onset: pos, melisma: n.tiedFromPrev || syllables.some(s => s.extend) };
    pos = fadd(pos, n.beats);
  }
  return { melisma: false };
}

function windowStart(measures: readonly MeasureData[], anchor: MeasureData): Fraction {
  let offset = ZERO;
  for (const m of measures) {
    if (m === anchor) return offset;
    offset = fadd(offset, m.expectedBeats);
  }
  return offset;
}

function transitionContext(current: AccompanimentSection, next: AccompanimentSection): TransitionContext {
  const tail = current.measures.slice(-2);
  const last = tail[tail.length - 1];
  const window = vocalWindow(tail);
  const lastStart = windowStart(tail, last);
  const first = next.measures[0];
  const nextSung = firstSung(first);
  const nextHasLyrics = !!first && (first.lyric.trim().length > 0 || !!first.melody?.some(n => n.syllables.some(s => s)));
  const confidence = window.confidence === 'exact' || (first?.melody?.some(n => n.syllables.some(s => s)) ?? false)
    ? 'exact'
    : window.confidence === 'measureOnly' || nextHasLyrics ? 'measureOnly' : 'none';
  const vocal: VocalBoundaryContext = {
    continuesByTie: window.continuesByTie,
    continuesByHyphen: window.continuesByHyphen,
    continuesByMelisma: nextSung.melisma,
    confidence
  };
  if (window.lastSungEnd) {
    vocal.currentLastSungEnd = fnum(fsub(window.lastSungEnd, lastStart));
    vocal.currentTrailingSpaceBeats = Math.max(0, fnum(fsub(fadd(lastStart, last.expectedBeats), window.lastSungEnd)));
  }
  if (nextSung.onset) vocal.nextFirstSungOnset = fnum(nextSung.onset);
  return {
    afterSectionIndex: current.sectionIndex,
    currentMeter: meterString(last.context.timeSignature),
    currentFeel: last.context.feel,
    nextMeter: meterString(first.context.timeSignature),
    nextFeel: first.context.feel,
    vocal
  };
}

function buildEndingContext(section: AccompanimentSection): EndingContext {
  const tail = section.measures.slice(-2);
  const last = tail[tail.length - 1];
  const lastStart = windowStart(tail, last);
  const window = vocalWindow(tail);
  const rel = (f: Fraction | undefined) => (f ? fnum(fsub(f, lastStart)) : undefined);
  let melodyEnd: Fraction | undefined;
  let pos = ZERO;
  for (const n of last.melody ?? []) {
    pos = fadd(pos, n.beats);
    if (!n.isRest) melodyEnd = pos;
  }
  return {
    finalSectionIndex: section.sectionIndex,
    measureCount: section.measures.length,
    vocalEnding: {
      lastSungOnset: rel(window.lastSungOnset),
      lastSungEnd: rel(window.lastSungEnd),
      trailingSpaceBeats: window.lastSungEnd ? Math.max(0, fnum(fsub(fadd(lastStart, last.expectedBeats), window.lastSungEnd))) : undefined,
      continuesByTie: window.continuesByTie,
      continuesByHyphen: window.continuesByHyphen,
      continuesByMelisma: false,
      confidence: window.confidence
    },
    finalChordOnsets: last.chords.map(c => c.beat),
    ...(melodyEnd ? { finalMelodyEnd: fnum(melodyEnd) } : {}),
    finalMeasureBeats: fnum(last.expectedBeats),
    hasFinalBarline: !!last.finalEnd
  };
}

// ---------------------------------------------------------------------------
// Input validation (tool schema)
// ---------------------------------------------------------------------------

const STYLES = ['strum', 'arpeggio', 'rolled', 'sustain'];
const SUBDIVISIONS = ['auto', 'quarter', 'eighth', 'sixteenth', 'triplet'];
const LEVELS3 = ['low', 'medium', 'high'];
const DENSITIES = ['sparse', 'medium', 'dense'];
const SYNC_LEVELS = ['none', 'light', 'medium', 'strong'];
const SYNC_KINDS = ['offbeat', 'anticipation', 'beatCrossing'];
const EMPHASES = ['none', 'downbeat', 'backbeat', 'offbeat', 'custom'];
const DIFFICULTIES = ['beginner', 'intermediate', 'advanced'];
const GRID_UNITS = ['quarter', 'eighth', 'sixteenth', 'tripletEighth'];
const ROLES = ['base', 'variation', 'finale'];
const TRANSITION_INTENTS = ['space', 'hold', 'lift', 'fill', 'cadence'];
const ENDING_KINDS = ['hold', 'finalHit', 'fillToHold', 'breakThenHit', 'rolledFinal'];

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
const oneOf = (v: unknown, list: readonly string[]): boolean => typeof v === 'string' && list.includes(v);
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

function slotListProblem(v: unknown, name: string): string | undefined {
  if (v === undefined) return undefined;
  if (!Array.isArray(v) || !v.every(isInt)) return `${name} must be an array of integer slot indices`;
  for (let i = 1; i < v.length; i++) if ((v[i] as number) <= (v[i - 1] as number)) return `${name} must be strictly ascending (unique)`;
  return undefined;
}

function structuredCandidateProblem(p: unknown, where: string): string | undefined {
  if (!isObj(p)) return `${where}.pattern must be an object`;
  if (p.source === 'hold') return undefined;
  if (p.source === 'preset') return typeof p.presetId === 'string' ? undefined : `${where}.pattern.presetId must be a string`;
  if (p.source === 'grid') {
    if (!oneOf(p.gridUnit, GRID_UNITS)) return `${where}.pattern.gridUnit must be one of ${GRID_UNITS.join(', ')}`;
    return (
      slotListProblem(p.attacks, `${where}.pattern.attacks`) ??
      slotListProblem(p.accents, `${where}.pattern.accents`) ??
      slotListProblem(p.ghosts, `${where}.pattern.ghosts`) ??
      (Array.isArray(p.attacks) && p.attacks.length > 0 ? undefined : `${where}.pattern.attacks must not be empty`)
    );
  }
  return `${where}.pattern.source must be preset, grid or hold (raw down/up tokens are not accepted)`;
}

function commonPlanProblem(plan: Record<string, unknown>, where: string): string | undefined {
  if (!isInt(plan.sectionIndex) || plan.sectionIndex < 0) return `${where}.sectionIndex must be a 0-based integer`;
  if (plan.phraseLength !== undefined && ![2, 4, 8].includes(plan.phraseLength as number)) return `${where}.phraseLength must be 2, 4 or 8`;
  if (plan.arrangementGroup !== undefined && (typeof plan.arrangementGroup !== 'string' || !plan.arrangementGroup)) return `${where}.arrangementGroup must be a non-empty string`;
  if (plan.arrangementRole !== undefined && !oneOf(plan.arrangementRole, ROLES)) return `${where}.arrangementRole must be base, variation or finale`;
  return undefined;
}

/** Structural problems of an apply request (spec §8.7.4); undefined when well formed. */
export function accompanimentRequestProblem(input: unknown): string | undefined {
  if (!isObj(input)) return 'input must be an object';
  const plans = input.plans;
  const hasTransitions = Array.isArray(input.transitions) && input.transitions.length > 0;
  if (!Array.isArray(plans)) return 'plans must be an array';
  if (plans.length === 0 && !hasTransitions && input.ending === undefined) return 'pass at least one plan, transition or ending';
  for (let i = 0; i < plans.length; i++) {
    const plan = plans[i];
    const where = `plans[${i}]`;
    if (!isObj(plan)) return `${where} must be an object`;
    const common = commonPlanProblem(plan, where);
    if (common) return common;
    switch (plan.mode) {
      case 'intent':
        if (!oneOf(plan.style, STYLES)) return `${where}.style must be one of ${STYLES.join(', ')}`;
        if (!oneOf(plan.subdivision, SUBDIVISIONS)) return `${where}.subdivision must be one of ${SUBDIVISIONS.join(', ')}`;
        if (plan.family !== undefined && !oneOf(plan.family, FAMILY_ORDER)) return `${where}.family must be one of ${FAMILY_ORDER.join(', ')}`;
        if (!oneOf(plan.energy, LEVELS3)) return `${where}.energy must be low, medium or high`;
        if (!oneOf(plan.density, DENSITIES)) return `${where}.density must be sparse, medium or dense`;
        if (!oneOf(plan.syncopation, SYNC_LEVELS)) return `${where}.syncopation must be none, light, medium or strong`;
        if (plan.syncopationKinds !== undefined && !(Array.isArray(plan.syncopationKinds) && plan.syncopationKinds.every(k => oneOf(k, SYNC_KINDS)))) {
          return `${where}.syncopationKinds must list offbeat / anticipation / beatCrossing`;
        }
        if (!oneOf(plan.emphasis, EMPHASES)) return `${where}.emphasis must be one of ${EMPHASES.join(', ')}`;
        if (plan.preferredPresetId !== undefined && typeof plan.preferredPresetId !== 'string') return `${where}.preferredPresetId must be a string`;
        if (plan.difficulty !== undefined && !oneOf(plan.difficulty, DIFFICULTIES)) return `${where}.difficulty must be beginner, intermediate or advanced`;
        if (plan.operation !== 'replace' && plan.operation !== 'adapt') return `${where}.operation must be replace or adapt`;
        break;
      case 'preset':
        if (typeof plan.presetId !== 'string') return `${where}.presetId must be a string`;
        if ('operation' in plan) return `${where}: operation exists only in intent mode (preset is always a replacement)`;
        break;
      case 'grid': {
        if (plan.style !== 'strum' && plan.style !== 'arpeggio') return `${where}.style must be strum or arpeggio`;
        if (!oneOf(plan.gridUnit, GRID_UNITS)) return `${where}.gridUnit must be one of ${GRID_UNITS.join(', ')}`;
        const slots = slotListProblem(plan.attacks, `${where}.attacks`) ?? slotListProblem(plan.accents, `${where}.accents`) ?? slotListProblem(plan.ghosts, `${where}.ghosts`);
        if (slots) return slots;
        if ((plan.attacks as number[]).length === 0) return `${where}.attacks must not be empty`;
        if ('operation' in plan) return `${where}: operation exists only in intent mode (grid is always a replacement)`;
        break;
      }
      case 'dsl':
        if (!oneOf(plan.style, STYLES)) return `${where}.style must be one of ${STYLES.join(', ')}`;
        if (typeof plan.pattern !== 'string' || !plan.pattern.trim()) return `${where}.pattern must be a GuitarDSL rhythm pattern`;
        if (plan.directionPolicy !== undefined && plan.directionPolicy !== 'physical' && plan.directionPolicy !== 'literal') return `${where}.directionPolicy must be physical or literal`;
        if ('operation' in plan) return `${where}: operation exists only in intent mode (dsl is always a replacement)`;
        break;
      default:
        return `${where}.mode must be intent, preset, grid or dsl`;
    }
  }
  if (input.transitions !== undefined) {
    if (!Array.isArray(input.transitions)) return 'transitions must be an array';
    for (let i = 0; i < input.transitions.length; i++) {
      const t = input.transitions[i];
      const where = `transitions[${i}]`;
      if (!isObj(t) || !isInt(t.afterSectionIndex) || t.afterSectionIndex < 0) return `${where}.afterSectionIndex must be a 0-based integer`;
      if (!Array.isArray(t.candidates) || t.candidates.length < 1 || t.candidates.length > 3) return `${where}.candidates must hold 1 to 3 ordered candidates`;
      for (let j = 0; j < t.candidates.length; j++) {
        const c = t.candidates[j];
        const cw = `${where}.candidates[${j}]`;
        if (!isObj(c) || !oneOf(c.intent, TRANSITION_INTENTS)) return `${cw}.intent must be one of ${TRANSITION_INTENTS.join(', ')}`;
        if (c.targetMeasureOffset !== -1 && c.targetMeasureOffset !== -2) return `${cw}.targetMeasureOffset must be -1 or -2`;
        const p = structuredCandidateProblem(c.pattern, cw);
        if (p) return p;
      }
    }
  }
  if (input.ending !== undefined) {
    const e = input.ending;
    if (!isObj(e) || !Array.isArray(e.candidates) || e.candidates.length < 1 || e.candidates.length > 3) return 'ending.candidates must hold 1 to 3 ordered candidates';
    for (let j = 0; j < e.candidates.length; j++) {
      const c = e.candidates[j];
      const cw = `ending.candidates[${j}]`;
      if (!isObj(c) || !oneOf(c.kind, ENDING_KINDS)) return `${cw}.kind must be one of ${ENDING_KINDS.join(', ')}`;
      if (!Array.isArray(c.measures) || c.measures.length < 1 || c.measures.length > 2) return `${cw}.measures must hold 1 or 2 entries`;
      const seen = new Set<number>();
      for (let k = 0; k < c.measures.length; k++) {
        const m = c.measures[k];
        if (!isObj(m) || (m.relativeMeasure !== -1 && m.relativeMeasure !== -2)) return `${cw}.measures[${k}].relativeMeasure must be -1 or -2`;
        if (seen.has(m.relativeMeasure as number)) return `${cw}.measures has a duplicate relativeMeasure`;
        seen.add(m.relativeMeasure as number);
        const p = structuredCandidateProblem(m.pattern, `${cw}.measures[${k}]`);
        if (p) return p;
      }
      if (c.fermataFinal !== undefined && typeof c.fermataFinal !== 'boolean') return `${cw}.fermataFinal must be a boolean`;
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Pattern builders
// ---------------------------------------------------------------------------

type Built = { ok: true; rhythms: RhythmItem[]; text: string } | { ok: false; code: AccompanimentFailureCode; detail: string };

const GRID_UNIT_BEATS: Record<GridUnit, Fraction> = {
  quarter: frac(1),
  eighth: frac(1, 2),
  sixteenth: frac(1, 4),
  tripletEighth: frac(1, 3)
};

/** Number of grid slots of a measure length, or a problem. */
export function gridSlotCount(ts: TimeSignature, unit: GridUnit, length: Fraction): number | string {
  const u = GRID_UNIT_BEATS[unit];
  const count = frac(length.n * u.d, length.d * u.n);
  if (count.d !== 1) return `the measure length is not a whole number of ${unit} slots`;
  if (unit === 'tripletEighth' && ts.denominator > 4) return 'tripletEighth needs a simple meter (x/2 or x/4)';
  if (ts.denominator > 4 && !pulses(ts).every(p => isMultiple(p, u))) return `${unit} does not align with the beat groups of ${meterString(ts)}`;
  return count.n;
}

/**
 * Builds one measure from grid attacks (spec §7.3): the engine decides D/U (coarsest pendulum) and every
 * duration (an attack sounds until the next one; composite `+` values where needed). The AI never passes
 * D/U or `.t`.
 */
function buildGrid(
  ts: TimeSignature,
  length: Fraction,
  style: 'strum' | 'arpeggio',
  unit: GridUnit,
  attacks: readonly number[],
  accents: readonly number[] = [],
  ghosts: readonly number[] = [],
  breakBefore?: Fraction
): Built {
  const slots = gridSlotCount(ts, unit, length);
  if (typeof slots === 'string') return { ok: false, code: 'invalidGridAttack', detail: slots };
  if (attacks.length === 0 || attacks.some(a => a < 0 || a >= slots)) return { ok: false, code: 'invalidGridAttack', detail: `attacks must be slot indices 0..${slots - 1}` };
  if (accents.some(a => !attacks.includes(a)) || ghosts.some(g => !attacks.includes(g))) return { ok: false, code: 'invalidGridAttack', detail: 'accents / ghosts must be a subset of attacks' };
  if (accents.some(a => ghosts.includes(a))) return { ok: false, code: 'invalidGridAttack', detail: 'a slot cannot be both accent and ghost' };
  if (style === 'arpeggio' && ghosts.length > 0) return { ok: false, code: 'invalidGridAttack', detail: 'arpeggio grids take no ghosts' };
  const u = GRID_UNIT_BEATS[unit];
  const onsets = attacks.map(a => fmul(u, frac(a)));
  const dirs = style === 'strum' ? physicalDirections(ts, onsets) : null;
  if (style === 'strum' && !dirs) return { ok: false, code: 'invalidGridAttack', detail: 'the attacks do not form a playable stroke grid' };
  const tokens: string[] = [];
  if (onsets[0].n > 0) {
    const rests = restTokens(onsets[0]);
    if (!rests) return { ok: false, code: 'invalidGridAttack', detail: 'cannot notate the leading rest' };
    tokens.push(...rests);
  }
  for (let i = 0; i < onsets.length; i++) {
    const next = i + 1 < onsets.length ? onsets[i + 1] : length;
    // breakThenHit: the stroke before the hit stops one slot early, leaving an audible break (spec §11B.3).
    const breaks = !!breakBefore && feq(next, breakBefore);
    const end = breaks ? fsub(next, u) : next;
    if (fcmp(end, onsets[i]) <= 0) return { ok: false, code: 'invalidGridAttack', detail: 'breakThenHit needs an empty slot before the final hit' };
    const parts = durationParts(fsub(end, onsets[i]));
    if (!parts) return { ok: false, code: 'invalidGridAttack', detail: 'cannot notate a duration' };
    const mods = [dirs ? dirs[i] : '', accents.includes(attacks[i]) ? 'a' : '', ghosts.includes(attacks[i]) ? 'g' : ''].filter(Boolean);
    tokens.push([parts.join('+'), ...mods].join('.'));
    if (breaks) tokens.push(`r${durationParts(u)?.join('+')}`);
  }
  return parsedBuild(tokens.join(' '), ts);
}

function parsedBuild(text: string, ts: TimeSignature): Built {
  const parsed = parseRhythmPattern(text, meterString(ts));
  if (!parsed.ok) return { ok: false, code: 'invalidRhythmPattern', detail: parsed.detail };
  return { ok: true, rhythms: parsed.rhythms, text: formatRhythms(parsed.rhythms) };
}

/** Validates an explicit `dsl` pattern for one full measure (spec §7.4). */
function buildDsl(plan: DslPlan, ts: TimeSignature): Built {
  const parsed = parseRhythmPattern(plan.pattern, meterString(ts));
  if (!parsed.ok) return { ok: false, code: 'invalidRhythmPattern', detail: parsed.detail };
  if (!feq(parsed.beats, measureBeats(ts))) {
    return { ok: false, code: 'rhythmBeatCountMismatch', detail: `the pattern lasts ${formatOffset(parsed.beats)} beats; ${meterString(ts)} needs ${formatOffset(measureBeats(ts))}` };
  }
  const events = patternEvents(parsed.rhythms);
  const strokes = events.filter(e => e.stroke);
  if (strokes.length === 0) return { ok: false, code: 'invalidRhythmPattern', detail: 'the pattern has no stroke' };
  if (parsed.rhythms[parsed.rhythms.length - 1].tie) {
    return { ok: false, code: 'unsupportedCrossBarSyncopation', detail: 'a tie across the barline (cross-bar anticipation) is not generated by this tool' };
  }
  const arp = parsed.rhythms.filter(r => r.arpeggio).length;
  const directed = parsed.rhythms.some(r => r.down || r.up);
  if (plan.style === 'rolled' && (arp !== strokes.length || directed)) return { ok: false, code: 'invalidRhythmPattern', detail: 'rolled: every stroke is .arp without .d / .u' };
  if (plan.style !== 'rolled' && arp > 0) return { ok: false, code: 'invalidRhythmPattern', detail: '.arp needs style rolled' };
  if (plan.style === 'arpeggio' && (directed || parsed.rhythms.some(r => r.ghost))) return { ok: false, code: 'invalidRhythmPattern', detail: 'arpeggio: no .d / .u / .g' };
  if ((plan.style === 'strum' || plan.style === 'sustain') && (plan.directionPolicy ?? 'physical') === 'physical') {
    const problem = strokeDirectionProblem(ts, events);
    if (problem) return { ok: false, code: 'unnaturalStrokeDirection', detail: problem };
  }
  return { ok: true, rhythms: parsed.rhythms, text: formatRhythms(parsed.rhythms) };
}

/**
 * Hold: keeps the base measure up to its last stroke at or before `from`, then sustains that stroke to the
 * measure end (spec §11A.2). Null when there is no such stroke or when a chord change would be held over.
 */
function buildHold(base: readonly RhythmItem[], measure: MeasureData, ts: TimeSignature, from: Fraction): Built {
  const events = patternEvents(base);
  const length = eventsLength(events);
  const held = [...events].reverse().find(e => e.harmonic && fcmp(e.onset, from) <= 0);
  if (!held) return { ok: false, code: 'invalidRhythmPattern', detail: 'no stroke to hold' };
  if (chordIntervals(measure, length).some(iv => fcmp(iv.start, held.onset) > 0)) {
    return { ok: false, code: 'patternMissesChordChange', detail: 'a chord changes during the held stroke' };
  }
  const tokens = events.filter(e => fcmp(e.onset, held.onset) < 0).map(e => formatItem(e.item));
  const parts = durationParts(fsub(length, held.onset));
  if (!parts) return { ok: false, code: 'invalidRhythmPattern', detail: 'cannot notate the held length' };
  tokens.push(formatItem({ ...held.item, tie: false }, parts.join('+')));
  return parsedBuild(tokens.join(' '), ts);
}

function withFermata(rhythms: readonly RhythmItem[], ts: TimeSignature): Built {
  const items = rhythms.map((r, i) => (i === rhythms.length - 1 ? { ...r, techniques: { ...(r.techniques ?? {}), fermata: true } } : r));
  return parsedBuild(formatRhythms(items), ts);
}

// ---------------------------------------------------------------------------
// Deterministic preset selection (spec §8)
// ---------------------------------------------------------------------------

const ENERGY_ORD: Record<AccompanimentEnergy, number> = { low: 0, medium: 1, high: 2 };
const DENSITY_ORD: Record<AccompanimentDensity, number> = { sparse: 0, medium: 1, dense: 2 };
const SYNC_ORD: Record<AccompanimentSyncopation, number> = { none: 0, light: 1, medium: 2, strong: 3 };
const DIFFICULTY_ORD: Record<AccompanimentDifficulty, number> = { beginner: 0, intermediate: 1, advanced: 2 };

interface SectionTarget {
  section: AccompanimentSection;
  full: MeasureData[];
  ts?: TimeSignature;
  feels: ScoreFeel[];
}

/** Soft cost (lower is better): §8.2 weights plus the D3 chord-articulation preference. */
function softCost(p: StrummingPatternPreset, plan: IntentPlan, target: SectionTarget): number {
  let cost =
    6 * Math.abs(ENERGY_ORD[p.energy] - ENERGY_ORD[plan.energy]) +
    6 * Math.abs(DENSITY_ORD[p.density] - DENSITY_ORD[plan.density]) +
    8 * Math.abs(SYNC_ORD[p.syncopation] - SYNC_ORD[plan.syncopation]) +
    3 * (p.emphasis === plan.emphasis ? 0 : 1);
  if (p.chordArticulation === 'onsetPreferred' && target.full.some(m => delaysChordOnset(m, parsePresetPattern(p).events))) cost += 4;
  if (plan.preferredPresetId === p.id) cost -= 20;
  return cost;
}

/** First hard filter a preset fails for this plan, or undefined (spec §8.1, D3). */
function hardRejection(p: StrummingPatternPreset, plan: IntentPlan, target: SectionTarget, group?: GroupConstraint): RejectionReason | undefined {
  if (!target.ts || !meterMatches(p, target.ts)) return 'meter';
  if (p.style !== plan.style) return 'style';
  if (plan.family !== undefined && p.family !== plan.family) return 'style';
  if (p.directionModel === 'authored') return 'style';
  if (plan.subdivision !== 'auto' && p.subdivision !== plan.subdivision) return 'subdivision';
  if (!feelAllows(p, target.feels)) return 'scoreFeel';
  if (plan.syncopationKinds && !plan.syncopationKinds.every(k => p.syncopationKinds.includes(k))) return 'syncopationKind';
  if (plan.difficulty && DIFFICULTY_ORD[p.difficulty] > DIFFICULTY_ORD[plan.difficulty]) return 'difficulty';
  if (group && !group.allows(p)) return 'adaptation';
  if (target.full.some(m => missesChordChange(m, parsePresetPattern(p).events))) return 'chordChange';
  return undefined;
}

interface Selection {
  preset: StrummingPatternPreset;
  rationale: SelectionRationale;
}

function matchedTraits(p: StrummingPatternPreset, plan: IntentPlan | undefined, ts: TimeSignature): string[] {
  const traits = [meterString(ts)];
  if (plan) {
    if (p.energy === plan.energy) traits.push(`${p.energy} energy`);
    if (p.density === plan.density) traits.push(`${p.density} density`);
    if (p.syncopation === plan.syncopation) traits.push(p.syncopation === 'none' ? 'no syncopation' : `${p.syncopation} syncopation`);
    if (p.emphasis === plan.emphasis && p.emphasis !== 'none') traits.push(`${p.emphasis} emphasis`);
    if (plan.difficulty) traits.push(`${p.difficulty} (≤ ${plan.difficulty})`);
  }
  traits.push('chord changes articulated');
  return traits;
}

function selectPreset(
  plan: IntentPlan,
  target: SectionTarget,
  pool: readonly StrummingPatternPreset[],
  group?: GroupConstraint
): Selection | { rejected: { id: string; reason: RejectionReason }[]; reasons: Set<RejectionReason> } {
  const ranked = pool
    .map((p, order) => ({ p, order, cost: softCost(p, plan, target), reason: hardRejection(p, plan, target, group) }))
    .sort((a, b) => a.cost - b.cost || a.order - b.order);
  const winner = ranked.find(r => !r.reason);
  const rejectedAll = ranked.filter(r => r.reason && r.reason !== 'meter');
  const rejectedBetter = winner ? rejectedAll.filter(r => r.cost < winner.cost || (r.cost === winner.cost && r.order < winner.order)) : rejectedAll;
  const rejectedCandidates = rejectedBetter.slice(0, 3).map(r => ({ id: r.p.id, reason: r.reason as RejectionReason }));
  if (!winner) return { rejected: rejectedCandidates, reasons: new Set(rejectedAll.map(r => r.reason as RejectionReason)) };
  return {
    preset: winner.p,
    rationale: {
      matchedTraits: matchedTraits(winner.p, plan, target.ts as TimeSignature),
      ...(rejectedCandidates.length > 0 ? { rejectedCandidates } : {})
    }
  };
}

// ---------------------------------------------------------------------------
// Arrangement groups (spec §5A.4)
// ---------------------------------------------------------------------------

interface GroupConstraint {
  allows(p: StrummingPatternPreset): boolean;
}

function groupConstraint(base: StrummingPatternPreset, role: ArrangementRole): GroupConstraint {
  return {
    allows(p) {
      if (p.family !== base.family || p.style !== base.style || p.subdivision !== base.subdivision) return false;
      if (role === 'variation') return p.id === base.id || relatedByVariation(p, base);
      if (role === 'finale') return ENERGY_ORD[p.energy] <= ENERGY_ORD[base.energy] + 1 && DENSITY_ORD[p.density] <= DENSITY_ORD[base.density] + 1;
      return true;
    }
  };
}

// ---------------------------------------------------------------------------
// Apply planning
// ---------------------------------------------------------------------------

interface SectionOutcome {
  plan: AccompanimentPlan;
  target: SectionTarget;
  /** Base pattern per full target measure (measureIndex -> rhythms). */
  base: RhythmItem[];
  baseText: string;
  preset?: StrummingPatternPreset;
  energy?: AccompanimentEnergy;
  operation: 'replace' | 'adapt';
  rationale: SelectionRationale;
  variations: string[];
}

type Fail = { ok: false; code: AccompanimentFailureCode; detail?: string };
const fail = (code: AccompanimentFailureCode, detail?: string): Fail => ({ ok: false, code, detail });

/**
 * Plans and applies an accompaniment request to `text` (spec §8.7): all plans are resolved and validated
 * before any edit is built, edits touch only rhythm spans, and the result is re-parsed to confirm every
 * changed measure. Returns the new text (unchanged text when nothing needs to change) or one failure.
 */
export function planAccompanimentTransform(text: string, request: AccompanimentRequest, options: AccompanimentOptions = {}): AccompanimentPlanResult {
  const problem = accompanimentRequestProblem(request);
  if (problem) return fail('invalidInput', problem);
  const score = parseGuitarDsl(text);
  const all = score.measures;
  const sections = accompanimentSections(score, text);
  const warnings: AccompanimentWarning[] = [];

  const seen = new Set<number>();
  for (const plan of request.plans) {
    if (seen.has(plan.sectionIndex)) return fail('duplicateSectionPlan', `sectionIndex ${plan.sectionIndex} appears twice`);
    seen.add(plan.sectionIndex);
    if (!sections[plan.sectionIndex]) return fail('sectionNotFound', `sectionIndex ${plan.sectionIndex} (0-based) does not exist; the score has ${sections.length} section(s)`);
  }
  for (const t of request.transitions ?? []) {
    if (!sections[t.afterSectionIndex]) return fail('sectionNotFound', `transition afterSectionIndex ${t.afterSectionIndex} does not exist`);
    if (t.afterSectionIndex >= sections.length - 1) return fail('invalidInput', 'the final section takes an ending, not a transition');
  }
  if (new Set((request.transitions ?? []).map(t => t.afterSectionIndex)).size !== (request.transitions ?? []).length) {
    return fail('invalidInput', 'one transition proposal per section boundary');
  }
  if (request.ending && sections.length === 0) return fail('sectionNotFound', 'the score has no measures');

  // Desired rhythm per measure (index -> rhythms); precedence: base -> phrase variation -> transition -> ending.
  const desired = new Map<number, RhythmItem[]>();
  const outcomes = new Map<number, SectionOutcome>();

  // Base plans first, then variation / finale plans that depend on their group's base.
  const ordered = [...request.plans].sort((a, b) => roleRank(a) - roleRank(b) || a.sectionIndex - b.sectionIndex);
  const groupBase = new Map<string, StrummingPatternPreset>();
  for (const plan of ordered) {
    const section = sections[plan.sectionIndex];
    const outcome = resolvePlan(plan, section, all, groupBase, warnings);
    if ('code' in outcome) return outcome;
    outcomes.set(plan.sectionIndex, outcome);
    if (plan.arrangementGroup && outcome.preset && roleRank(plan) === 0 && !groupBase.has(plan.arrangementGroup)) groupBase.set(plan.arrangementGroup, outcome.preset);
    for (const m of outcome.target.full) desired.set(m.measureIndex, outcome.base);
  }

  // Phrase variations.
  if (options.phraseVariation !== false) {
    for (const [idx, outcome] of outcomes) {
      if (!outcome.preset || outcome.plan.mode === 'grid' || outcome.plan.mode === 'dsl') continue;
      const nextEnergy = outcomes.get(idx + 1)?.energy;
      applyPhraseVariation(outcome, nextEnergy, desired, all);
    }
  }

  // Transitions (non-final boundaries) and the ending (final section) — AI candidates, first legal wins.
  const transitionResults: TransitionResult[] = [];
  for (const proposal of request.transitions ?? []) {
    transitionResults.push(applyTransition(proposal, sections, all, desired, warnings));
  }
  let endingResult: EndingResult | undefined;
  if (request.ending) endingResult = applyEnding(request.ending.candidates, sections[sections.length - 1], all, desired, warnings);

  // Measures with changed rhythm must be editable and must not contain inline pitches.
  const changed = new Map<number, RhythmItem[]>();
  for (const [idx, rhythms] of desired) {
    const m = all[idx];
    if (formatRhythms(rhythms) !== formatRhythms(effectiveRhythms(m, all))) changed.set(idx, rhythms);
  }
  for (const idx of changed.keys()) {
    if (hasInlinePitch(all[idx])) return fail('measureContainsInlinePitch', `measure ${idx + 1} contains inline pitches; its rhythm is not overwritten`);
  }
  // Inline pitches anywhere in a planned section also block the whole request (spec §5.3).
  for (const outcome of outcomes.values()) {
    const pitched = outcome.target.section.measures.find(hasInlinePitch);
    if (pitched) return fail('measureContainsInlinePitch', `measure ${pitched.measureIndex + 1} in section ${outcome.target.section.sectionIndex} contains inline pitches`);
  }

  const edits = buildEdits(text, all, desired, changed);
  if ('code' in edits) return edits;
  const nextText = applyEdits(text, edits);

  // Post-condition: the edited source plays exactly the desired rhythms and nothing else moved.
  if (nextText !== text) {
    const after = parseGuitarDsl(nextText).measures;
    if (after.length !== all.length) return fail('editRejected', 'the edit would change the measure structure');
    for (let i = 0; i < all.length; i++) {
      const want = desired.has(i) ? formatRhythms(desired.get(i) as RhythmItem[]) : formatRhythms(effectiveRhythms(all[i], all));
      if (formatRhythms(effectiveRhythms(after[i], after)) !== want) return fail('editRejected', `measure ${i + 1} would not read back as planned`);
      if (JSON.stringify(after[i].chords) !== JSON.stringify(all[i].chords) || after[i].lyric !== all[i].lyric) {
        return fail('editRejected', `measure ${i + 1} chords or lyric would change`);
      }
    }
  }

  const appliedSections: AppliedSection[] = [...outcomes.values()]
    .sort((a, b) => a.plan.sectionIndex - b.plan.sectionIndex)
    .map(o => sectionResult(o));
  return {
    ok: true,
    text: nextText,
    changed: nextText !== text,
    appliedSections,
    ...(request.transitions ? { transitionResults } : {}),
    ...(endingResult ? { endingResult } : {}),
    warnings
  };
}

const roleRank = (plan: AccompanimentPlan): number => (plan.arrangementRole === 'variation' || plan.arrangementRole === 'finale' ? 1 : 0);

function sectionTarget(section: AccompanimentSection): SectionTarget | Fail {
  const full = section.measures.filter(isFullMeasure);
  const meters = distinctMeters(full);
  if (meters.length > 1) return fail('mixedMeterSection', `section ${section.sectionIndex} mixes ${meters.map(meterString).join(', ')}; plan each meter region separately`);
  return { section, full, ts: meters[0], feels: distinctFeels(full) };
}

function resolvePlan(
  plan: AccompanimentPlan,
  section: AccompanimentSection,
  all: readonly MeasureData[],
  groupBase: Map<string, StrummingPatternPreset>,
  warnings: AccompanimentWarning[]
): SectionOutcome | Fail {
  const target = sectionTarget(section);
  if ('code' in target) return target;
  for (const m of section.measures) {
    if (!isFullMeasure(m)) warnings.push({ code: 'partialMeasurePreserved', sectionIndex: section.sectionIndex, measureNumber: m.measureIndex + 1 });
  }
  if (!target.ts) {
    return { plan, target, base: [], baseText: '', operation: 'replace', rationale: { matchedTraits: ['no full measure to change'] }, variations: [] };
  }
  const ts = target.ts;
  const role = plan.arrangementRole ?? 'base';
  const groupBasePreset = plan.arrangementGroup && role !== 'base' ? groupBase.get(plan.arrangementGroup) : undefined;
  const chordFail = (events: PatternEvent[]) => target.full.find(m => missesChordChange(m, events));

  if (plan.mode === 'preset') {
    const preset = getPresetById(plan.presetId);
    if (!preset) return fail('invalidPresetForContext', `unknown presetId ${plan.presetId}`);
    if (!meterMatches(preset, ts)) return fail('invalidPresetForContext', `${preset.id} is ${preset.meter}; section ${section.sectionIndex} is ${meterString(ts)}`);
    if (!feelAllows(preset, target.feels)) {
      return target.feels.length > 1
        ? fail('mixedFeelSection', `${preset.id} needs feel ${(preset.feelCompatibility as string[]).join('/')}; the section mixes ${target.feels.join(', ')}`)
        : fail('invalidPresetForContext', `${preset.id} needs feel ${(preset.feelCompatibility as string[]).join('/')}; the section is ${target.feels[0]}`);
    }
    if (groupBasePreset && !groupConstraint(groupBasePreset, role).allows(preset)) {
      return fail('invalidVariationRelationship', `${preset.id} is not a ${role} of ${groupBasePreset.id} in arrangementGroup ${plan.arrangementGroup}`);
    }
    const parsed = parsePresetPattern(preset);
    const miss = chordFail(parsed.events);
    if (miss) return fail('patternMissesChordChange', `${preset.id} leaves a chord of measure ${miss.measureIndex + 1} without a harmonic attack`);
    return {
      plan,
      target,
      base: parsed.rhythms,
      baseText: parsed.text,
      preset,
      energy: preset.energy,
      operation: 'replace',
      rationale: { matchedTraits: [meterString(ts), 'explicit preset', 'chord changes articulated'] },
      variations: []
    };
  }

  if (plan.mode === 'grid') {
    const built = buildGrid(ts, measureBeats(ts), plan.style, plan.gridUnit, plan.attacks, plan.accents, plan.ghosts);
    if (!built.ok) return fail(built.code, built.detail);
    const miss = chordFail(patternEvents(built.rhythms));
    if (miss) return fail('patternMissesChordChange', `the grid leaves a chord of measure ${miss.measureIndex + 1} without a harmonic attack`);
    return { plan, target, base: built.rhythms, baseText: built.text, operation: 'replace', rationale: { matchedTraits: [meterString(ts), 'explicit grid', 'chord changes articulated'] }, variations: [] };
  }

  if (plan.mode === 'dsl') {
    const built = buildDsl(plan, ts);
    if (!built.ok) return fail(built.code, built.detail);
    const miss = chordFail(patternEvents(built.rhythms));
    if (miss) return fail('patternMissesChordChange', `the pattern leaves a chord of measure ${miss.measureIndex + 1} without a harmonic attack`);
    return { plan, target, base: built.rhythms, baseText: built.text, operation: 'replace', rationale: { matchedTraits: [meterString(ts), 'explicit pattern', 'chord changes articulated'] }, variations: [] };
  }

  // intent
  const explicitOverride = groupBasePreset && (plan.style !== groupBasePreset.style || (plan.family !== undefined && plan.family !== groupBasePreset.family));
  const group = groupBasePreset && !explicitOverride ? groupConstraint(groupBasePreset, role) : undefined;
  if (plan.operation === 'adapt') {
    const current = currentPreset(section, all);
    const currentFamily = current?.family ?? structuralFamilyOf(section, all);
    if (!currentFamily) return fail('noCompatibleAdaptation', 'the current rhythm has no recognizable family to adapt');
    if (current && plan.style !== current.style) return fail('noCompatibleAdaptation', `adapt keeps the current style (${current.style}); use operation replace to change it`);
    if (plan.family !== undefined && plan.family !== currentFamily) return fail('noCompatibleAdaptation', `adapt keeps the current family (${currentFamily}); use operation replace`);
    const pool = STRUMMING_PATTERN_PRESETS.filter(
      p => p.family === currentFamily && p.style === plan.style && (!current || (p.subdivision === current.subdivision && p.id !== current.id))
    );
    const baseline = current ? softCost(current, plan, target) : Number.POSITIVE_INFINITY;
    const related = current ? pool.filter(p => relatedByVariation(p, current)) : [];
    for (const candidates of [related, pool]) {
      const pick = selectPreset(plan, target, candidates, group);
      if ('preset' in pick && softCost(pick.preset, plan, target) < baseline) {
        return intentOutcome(plan, target, pick, 'adapt');
      }
    }
    return fail('noCompatibleAdaptation', `no ${currentFamily} preset moves closer to the requested energy / density / syncopation / emphasis${plan.difficulty ? ' / difficulty' : ''}`);
  }
  const pick = selectPreset(plan, target, STRUMMING_PATTERN_PRESETS, group);
  if (!('preset' in pick)) {
    // The last hard filter a preset reached names the failure: it passed every earlier filter.
    const chord = pick.reasons.has('chordChange');
    const feel = target.feels.length > 1 && pick.reasons.has('scoreFeel');
    const code: AccompanimentFailureCode = chord ? 'patternMissesChordChange' : feel ? 'mixedFeelSection' : 'invalidPresetForContext';
    const why = pick.rejected.map(r => `${r.id}: ${r.reason}`).join('; ');
    return fail(code, `no canonical preset satisfies the intent for ${meterString(ts)}${why ? ` (closest rejected: ${why})` : ''}`);
  }
  return intentOutcome(plan, target, pick, 'replace');
}

function structuralFamilyOf(section: AccompanimentSection, all: readonly MeasureData[]): AccompanimentFamily | null {
  const counts = new Map<AccompanimentFamily, number>();
  for (const m of section.measures.filter(isFullMeasure)) {
    const f = structuralFamily(m, all);
    if (f) counts.set(f, (counts.get(f) ?? 0) + 1);
  }
  let best: AccompanimentFamily | null = null;
  for (const f of FAMILY_ORDER) if ((counts.get(f) ?? 0) > (best ? counts.get(best) ?? 0 : 0)) best = f;
  return best;
}

function intentOutcome(plan: IntentPlan, target: SectionTarget, pick: Selection, operation: 'replace' | 'adapt'): SectionOutcome {
  const parsed = parsePresetPattern(pick.preset);
  return {
    plan,
    target,
    base: parsed.rhythms,
    baseText: parsed.text,
    preset: pick.preset,
    energy: plan.energy,
    operation,
    rationale: pick.rationale,
    variations: []
  };
}

/** Phrase length: explicit, else 8 / 4 / 2 by divisibility of the section's measure count (spec §5A.2). */
function phraseLengthOf(plan: AccompanimentPlan, count: number): number | undefined {
  if (plan.phraseLength) return plan.phraseLength;
  for (const l of [8, 4, 2]) if (count % l === 0) return l;
  return undefined;
}

/**
 * Deterministic phrase-end variation (spec §5A.2): only catalog `variationOf` relations are used; the last
 * measure of the section takes `lift` / `breakdown` when the next planned section's energy rises / falls,
 * other phrase ends take `fill` then `cadence`. Partial, `%` and chord-incompatible measures keep the base.
 */
function applyPhraseVariation(outcome: SectionOutcome, nextEnergy: AccompanimentEnergy | undefined, desired: Map<number, RhythmItem[]>, all: readonly MeasureData[]): void {
  const base = outcome.preset as StrummingPatternPreset;
  const measures = outcome.target.section.measures;
  const length = phraseLengthOf(outcome.plan, measures.length);
  if (!length) return;
  const intent = outcome.plan.mode === 'intent' ? outcome.plan : undefined;
  const variants = STRUMMING_PATTERN_PRESETS.filter(
    p =>
      p.variationOf === base.id &&
      feelAllows(p, outcome.target.feels) &&
      (!intent || p.directionModel !== 'authored') &&
      (!intent?.difficulty || DIFFICULTY_ORD[p.difficulty] <= DIFFICULTY_ORD[intent.difficulty])
  );
  if (variants.length === 0) return;
  measures.forEach((m, i) => {
    if ((i + 1) % length !== 0 || !isFullMeasure(m) || m.isMeasureRepeat) return;
    const last = i === measures.length - 1;
    const baseEnergy = outcome.energy ?? base.energy;
    const roles: VariationRole[] =
      last && nextEnergy && ENERGY_ORD[nextEnergy] > ENERGY_ORD[baseEnergy]
        ? ['lift']
        : last && nextEnergy && ENERGY_ORD[nextEnergy] < ENERGY_ORD[baseEnergy]
          ? ['breakdown']
          : ['fill', 'cadence'];
    for (const role of roles) {
      const v = variants.find(p => p.variationRole === role);
      if (!v) continue;
      const parsed = parsePresetPattern(v);
      if (missesChordChange(m, parsed.events)) continue;
      if (!repeatSafe(m, all, desired, parsed.rhythms)) continue;
      desired.set(m.measureIndex, parsed.rhythms);
      if (!outcome.variations.includes(v.id)) outcome.variations.push(v.id);
      return;
    }
  });
}

/** A change to measure `m` must not alter a following `%` measure that inherits from it. */
function repeatSafe(m: MeasureData, all: readonly MeasureData[], desired: Map<number, RhythmItem[]>, rhythms: readonly RhythmItem[]): boolean {
  const text = formatRhythms(rhythms);
  for (let i = m.measureIndex + 1; i < all.length && all[i].isMeasureRepeat; i++) {
    const want = desired.get(i);
    if (!want || formatRhythms(want) !== text) return false;
  }
  return true;
}

function sectionResult(o: SectionOutcome): AppliedSection {
  const plan = o.plan;
  const feels = o.target.feels;
  return {
    sectionIndex: plan.sectionIndex,
    mode: plan.mode,
    ...(o.preset ? { selectedPresetId: o.preset.id } : o.baseText ? { generatedPattern: o.baseText } : {}),
    meter: o.target.ts ? meterString(o.target.ts) : meterString(o.target.section.measures[0].context.timeSignature),
    scoreFeel: feels.length === 1 ? feels[0] : feels.length === 0 ? o.target.section.measures[0].context.feel : 'mixed',
    operation: o.operation,
    ...(plan.phraseLength ? { phraseLength: plan.phraseLength } : {}),
    ...(plan.arrangementGroup ? { arrangementGroup: plan.arrangementGroup } : {}),
    ...(plan.arrangementRole ? { arrangementRole: plan.arrangementRole } : {}),
    variationPresetsUsed: o.variations,
    selectionRationale: o.rationale
  };
}

// ---------------------------------------------------------------------------
// Transitions and endings (spec §11A / §11B)
// ---------------------------------------------------------------------------

interface WindowMeasure {
  measure: MeasureData;
  ts: TimeSignature;
  length: Fraction;
  base: RhythmItem[];
  /** Start of the vocal-safe region inside this measure (quarter beats); 0 = whole measure free. */
  safeStart: Fraction;
}

function windowMeasure(section: AccompanimentSection, offset: -2 | -1, all: readonly MeasureData[], desired: Map<number, RhythmItem[]>, vocal: VocalWindow): WindowMeasure | string {
  const tail = section.measures.slice(-2);
  const m = offset === -1 ? tail[tail.length - 1] : tail.length === 2 ? tail[0] : undefined;
  if (!m) return 'the section has no such measure';
  if (m.isMeasureRepeat) return 'the target measure is a % repeat';
  if (hasInlinePitch(m)) return 'the target measure contains inline pitches';
  const start = windowStart(tail, m);
  let safeStart = ZERO;
  if (vocal.confidence === 'exact' && vocal.lastSungEnd) {
    const rel = fsub(vocal.lastSungEnd, start);
    safeStart = fcmp(rel, ZERO) < 0 ? ZERO : fcmp(rel, m.expectedBeats) > 0 ? m.expectedBeats : rel;
  }
  return { measure: m, ts: m.context.timeSignature, length: m.expectedBeats, base: desired.get(m.measureIndex) ?? effectiveRhythms(m, all), safeStart };
}

/** Structured candidate -> rhythms for a window measure (preset: full measures only; grid: exact length). */
function buildCandidate(p: StructuredPatternCandidate, w: WindowMeasure, breakBefore?: Fraction): Built {
  if (p.source === 'hold') return buildHold(w.base, w.measure, w.ts, w.safeStart);
  if (p.source === 'preset') {
    const preset = getPresetById(p.presetId);
    if (!preset) return { ok: false, code: 'invalidPresetForContext', detail: `unknown presetId ${p.presetId}` };
    if (!isFullMeasure(w.measure) || !meterMatches(preset, w.ts)) return { ok: false, code: 'invalidPresetForContext', detail: `${preset.id} does not fit measure ${w.measure.measureIndex + 1}` };
    if (!feelAllows(preset, [w.measure.context.feel])) return { ok: false, code: 'invalidPresetForContext', detail: `${preset.id} needs another score feel` };
    const parsed = parsePresetPattern(preset);
    return { ok: true, rhythms: parsed.rhythms, text: parsed.text };
  }
  const style = w.base.some(r => r.down || r.up) || w.base.length === 0 ? 'strum' : 'arpeggio';
  return buildGrid(w.ts, w.length, style, p.gridUnit, p.attacks, p.accents, p.ghosts, breakBefore);
}

const strokeCount = (rhythms: readonly RhythmItem[], from = ZERO): number =>
  patternEvents(rhythms).filter(e => e.stroke && fcmp(e.onset, from) >= 0).length;

/** Events before `t` are the same (onset, modifiers; the event spanning `t` may change its length). */
function samePrefix(a: readonly RhythmItem[], b: readonly RhythmItem[], t: Fraction): boolean {
  const ea = patternEvents(a).filter(e => fcmp(e.onset, t) < 0);
  const eb = patternEvents(b).filter(e => fcmp(e.onset, t) < 0);
  if (ea.length !== eb.length) return false;
  return ea.every((x, i) => {
    const y = eb[i];
    const spans = fcmp(fadd(x.onset, x.beats), t) > 0 || fcmp(fadd(y.onset, y.beats), t) > 0;
    return feq(x.onset, y.onset) && (spans || feq(x.beats, y.beats)) && formatItem(x.item, '') === formatItem(y.item, '');
  });
}

function applyTransition(
  proposal: TransitionProposal,
  sections: readonly AccompanimentSection[],
  all: readonly MeasureData[],
  desired: Map<number, RhythmItem[]>,
  warnings: AccompanimentWarning[]
): TransitionResult {
  const current = sections[proposal.afterSectionIndex];
  const ctx = transitionContext(current, sections[proposal.afterSectionIndex + 1]);
  const vocal = vocalWindow(current.measures.slice(-2));
  const exact = ctx.vocal.confidence === 'exact';
  if (!exact) warnings.push({ code: 'vocalTimingUnknown', sectionIndex: current.sectionIndex });
  const continues = ctx.vocal.continuesByTie || ctx.vocal.continuesByHyphen || ctx.vocal.continuesByMelisma;
  const reasons: string[] = [];
  for (let i = 0; i < proposal.candidates.length; i++) {
    const c = proposal.candidates[i];
    const reject = (code: string, why: string) => reasons.push(`#${i + 1} ${c.intent}: ${code} (${why})`);
    const w = windowMeasure(current, c.targetMeasureOffset, all, desired, exact ? vocal : { ...vocal, confidence: 'none' });
    if (typeof w === 'string') {
      reject('invalidTransitionCandidate', w);
      continue;
    }
    if (c.intent === 'hold' && c.pattern.source !== 'hold') {
      reject('invalidTransitionCandidate', 'hold needs pattern.source hold');
      continue;
    }
    if (c.pattern.source === 'hold' && c.intent !== 'hold' && c.intent !== 'cadence' && c.intent !== 'space') {
      reject('invalidTransitionCandidate', `${c.intent} cannot be a plain hold`);
      continue;
    }
    if ((c.intent === 'fill' || c.intent === 'lift') && (!exact || continues)) {
      reject('transitionConflictsWithVocal', !exact ? 'vocal timing is not exact' : 'the vocal phrase continues across the boundary');
      continue;
    }
    const built = buildCandidate(c.pattern, w);
    if (!built.ok) {
      reject(built.code === 'patternMissesChordChange' ? 'transitionConflictsWithChordChange' : 'invalidTransitionCandidate', built.detail);
      continue;
    }
    if (missesChordChange(w.measure, patternEvents(built.rhythms))) {
      reject('transitionConflictsWithChordChange', 'a chord would get no harmonic attack');
      continue;
    }
    if (exact && !samePrefix(w.base, built.rhythms, w.safeStart)) {
      reject('transitionConflictsWithVocal', 'it changes the accompaniment under the sung phrase');
      continue;
    }
    const baseStrokes = strokeCount(w.base, w.safeStart);
    const newStrokes = strokeCount(built.rhythms, w.safeStart);
    if ((c.intent === 'space' || c.intent === 'cadence') && strokeCount(built.rhythms) > strokeCount(w.base)) {
      reject('invalidTransitionCandidate', `${c.intent} must not add strokes`);
      continue;
    }
    if (c.intent === 'lift' && newStrokes < baseStrokes) {
      reject('invalidTransitionCandidate', 'lift must keep at least the current density after the vocal');
      continue;
    }
    if (c.intent === 'cadence') {
      const ev = patternEvents(built.rhythms).filter(e => !e.item.isRest);
      const lastEv = ev[ev.length - 1];
      if (!lastEv || (!feq(fadd(lastEv.onset, lastEv.beats), w.length) && !lastEv.item.accent)) {
        reject('invalidTransitionCandidate', 'cadence must hold or accent its last stroke');
        continue;
      }
    }
    if (!repeatSafe(w.measure, all, desired, built.rhythms)) {
      reject('invalidTransitionCandidate', 'a following % measure would change');
      continue;
    }
    desired.set(w.measure.measureIndex, built.rhythms);
    return { afterSectionIndex: proposal.afterSectionIndex, applied: true, candidateIndex: i, intent: c.intent, rationale: legalRationale(i, c.intent, reasons) };
  }
  return { afterSectionIndex: proposal.afterSectionIndex, applied: false, rationale: `no legal candidate; base kept. ${reasons.join('; ')}` };
}

function applyEnding(
  candidates: readonly EndingCandidate[],
  section: AccompanimentSection,
  all: readonly MeasureData[],
  desired: Map<number, RhythmItem[]>,
  warnings: AccompanimentWarning[]
): EndingResult {
  const ctx = buildEndingContext(section);
  const vocal = vocalWindow(section.measures.slice(-2));
  const exact = vocal.confidence === 'exact';
  if (!exact) warnings.push({ code: 'vocalTimingUnknown', sectionIndex: section.sectionIndex });
  const continues = vocal.continuesByTie || vocal.continuesByHyphen;
  const trailing = ctx.vocalEnding.trailingSpaceBeats ?? (exact ? 0 : undefined);
  const reasons: string[] = [];
  candidateLoop: for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    const reject = (code: string, why: string) => reasons.push(`#${i + 1} ${c.kind}: ${code} (${why})`);
    if (!exact && !['hold', 'finalHit', 'rolledFinal'].includes(c.kind)) {
      reject('endingConflictsWithVocal', 'vocal timing is not exact; only hold / finalHit / rolledFinal');
      continue;
    }
    if ((c.kind === 'fillToHold' || c.kind === 'breakThenHit') && exact) {
      const limit = c.kind === 'fillToHold' ? 1 : 0.5;
      if (continues || trailing === undefined || trailing < limit) {
        reject('endingConflictsWithVocal', continues ? 'the vocal phrase continues' : `only ${trailing ?? 0} beat(s) after the vocal; needs ${limit}`);
        continue;
      }
    }
    const finalEntry = c.measures.find(m => m.relativeMeasure === -1);
    if (!finalEntry) {
      reject('invalidEndingCandidate', 'the final measure (-1) needs an entry');
      continue;
    }
    if (c.kind === 'hold' && finalEntry.pattern.source !== 'hold') {
      reject('invalidEndingCandidate', 'hold needs a hold final measure');
      continue;
    }
    if (c.kind === 'rolledFinal' && !(finalEntry.pattern.source === 'preset' && getPresetById(finalEntry.pattern.presetId)?.style === 'rolled')) {
      reject('invalidEndingCandidate', 'rolledFinal needs a rolled preset in the final measure');
      continue;
    }
    const staged = new Map(desired);
    const vocalForWindow = exact ? vocal : { ...vocal, confidence: 'none' as const };
    const finalWindow = windowMeasure(section, -1, all, staged, vocalForWindow);
    // A hit on the final measure's first beat takes its break at the end of the measure before.
    const hitOnDownbeat = c.kind === 'breakThenHit' && typeof finalWindow !== 'string' && finalChordOnset(finalWindow).n === 0;
    if (hitOnDownbeat && !c.measures.some(m => m.relativeMeasure === -2)) {
      reject('invalidEndingCandidate', 'a break before a downbeat hit needs a -2 measure entry');
      continue;
    }
    for (const entry of [...c.measures].sort((a, b) => a.relativeMeasure - b.relativeMeasure)) {
      const w = windowMeasure(section, entry.relativeMeasure, all, staged, vocalForWindow);
      if (typeof w === 'string') {
        reject('invalidEndingCandidate', w);
        continue candidateLoop;
      }
      const breakBefore =
        c.kind !== 'breakThenHit' ? undefined : entry.relativeMeasure === -1 ? (hitOnDownbeat ? undefined : finalChordOnset(w)) : hitOnDownbeat ? w.length : undefined;
      let built = buildCandidate(entry.pattern, w, breakBefore);
      if (built.ok && entry.relativeMeasure === -1 && c.fermataFinal) built = withFermata(built.rhythms, w.ts);
      if (!built.ok) {
        reject(built.code === 'patternMissesChordChange' ? 'endingConflictsWithChordChange' : 'invalidEndingCandidate', built.detail);
        continue candidateLoop;
      }
      const events = patternEvents(built.rhythms);
      if (missesChordChange(w.measure, events)) {
        reject('endingConflictsWithChordChange', `measure ${w.measure.measureIndex + 1} would leave a chord without a harmonic attack`);
        continue candidateLoop;
      }
      if ((c.kind === 'fillToHold' || c.kind === 'breakThenHit') && !samePrefix(w.base, built.rhythms, w.safeStart)) {
        reject('endingConflictsWithVocal', 'it changes the accompaniment under the sung phrase');
        continue candidateLoop;
      }
      if (entry.relativeMeasure === -1) {
        const problem = endingShapeProblem(c.kind, w, events);
        if (problem) {
          reject(problem.startsWith('chord') ? 'endingConflictsWithChordChange' : 'invalidEndingCandidate', problem);
          continue candidateLoop;
        }
      }
      if (!repeatSafe(w.measure, all, staged, built.rhythms)) {
        reject('invalidEndingCandidate', 'a following % measure would change');
        continue candidateLoop;
      }
      if (breakBefore && entry.relativeMeasure === -2 && !built.rhythms[built.rhythms.length - 1].isRest) {
        reject('invalidEndingCandidate', 'breakThenHit needs silence at the end of the -2 measure');
        continue candidateLoop;
      }
      staged.set(w.measure.measureIndex, built.rhythms);
    }
    for (const [k, v] of staged) desired.set(k, v);
    return { applied: true, kind: c.kind, windowMeasures: c.measures.length, usedFermata: !!c.fermataFinal, rationale: legalRationale(i, c.kind, reasons) };
  }
  return { applied: false, rationale: `no legal candidate; the ending is unchanged. ${reasons.join('; ')}` };
}

const legalRationale = (i: number, label: string, rejected: readonly string[]): string =>
  `candidate #${i + 1} (${label}) is legal${rejected.length > 0 ? `; rejected ${rejected.join('; ')}` : ''}`;

/** Onset of the last chord interval of a window measure (0 when the measure has no chord). */
function finalChordOnset(w: WindowMeasure): Fraction {
  const intervals = chordIntervals(w.measure, w.length);
  return intervals.length > 0 ? intervals[intervals.length - 1].start : ZERO;
}

/** Shape rules of the final measure per ending kind (spec §11B.3 item 10). */
function endingShapeProblem(kind: EndingKind, w: WindowMeasure, events: readonly PatternEvent[]): string | undefined {
  const strokes = events.filter(e => e.stroke);
  const last = strokes[strokes.length - 1];
  if (!last) return 'the final measure has no stroke';
  const sounding = events.filter(e => !e.item.isRest);
  const lastSounding = sounding[sounding.length - 1];
  const holdsToEnd = !!lastSounding && feq(fadd(lastSounding.onset, lastSounding.beats), w.length);
  const finalOnset = finalChordOnset(w);
  switch (kind) {
    case 'hold':
    case 'fillToHold':
    case 'rolledFinal':
      return holdsToEnd ? undefined : 'the final stroke must be held to the end of the song';
    case 'finalHit': {
      const hit = strokes.find(e => e.harmonic && feq(e.onset, finalOnset));
      if (!hit) return 'chord: finalHit needs a stroke on the final chord onset';
      return strokes.some(e => fcmp(e.onset, finalOnset) > 0) ? 'finalHit places no stroke after the hit' : undefined;
    }
    case 'breakThenHit': {
      const hit = strokes.find(e => e.harmonic && feq(e.onset, finalOnset));
      if (!hit) return 'chord: breakThenHit needs a stroke on the final chord onset';
      if (strokes.some(e => fcmp(e.onset, finalOnset) > 0)) return 'breakThenHit places no stroke after the hit';
      if (finalOnset.n === 0) return undefined; // the break is the -2 measure's closing rest
      const before = events.filter(e => fcmp(e.onset, finalOnset) < 0);
      const prev = before[before.length - 1];
      return prev && prev.item.isRest ? undefined : 'breakThenHit needs a rest right before the hit';
    }
  }
}

// ---------------------------------------------------------------------------
// Source edits
// ---------------------------------------------------------------------------

interface SourceEdit {
  line: number;
  startCol: number;
  endCol: number;
  text: string;
}

function buildEdits(text: string, all: readonly MeasureData[], desired: Map<number, RhythmItem[]>, changed: Map<number, RhythmItem[]>): SourceEdit[] | Fail {
  const lines = text.split(/\r?\n/);
  const edits: SourceEdit[] = [];
  // Rhythm each measure will play after the edit (for `%` inheritance).
  const played = (i: number): string => formatRhythms(desired.get(i) ?? all[i].rhythms);
  for (let i = 0; i < all.length; i++) {
    const m = all[i];
    if (m.isMeasureRepeat) {
      let src = i - 1;
      while (src >= 0 && all[src].isMeasureRepeat) src--;
      if (src < 0) continue;
      const inherited = played(src);
      const want = desired.has(i) ? formatRhythms(desired.get(i) as RhythmItem[]) : formatRhythms(effectiveRhythms(m, all));
      if (inherited !== want) {
        return fail('repeatWouldChangeMeaning', `measure ${i + 1} is a % repeat of measure ${src + 1}; the planned rhythms differ, so the % would change meaning (it is never expanded)`);
      }
      continue;
    }
    const rhythms = changed.get(i);
    if (!rhythms) continue;
    const src = m.rhythmSource;
    if (!src) return fail('editRejected', `measure ${i + 1}: its rhythm tokens are interleaved with chords, marks or a lyric and cannot be replaced safely`);
    const pattern = formatRhythms(rhythms);
    if (src.kind === 'explicit') {
      edits.push({ line: src.line, startCol: src.startCol, endCol: src.endCol, text: pattern });
    } else {
      const after = lines[src.line][src.startCol] ?? '';
      edits.push({ line: src.line, startCol: src.startCol, endCol: src.endCol, text: ` ${pattern}${after && !/\s/.test(after) ? ' ' : ''}` });
    }
  }
  return edits;
}

function applyEdits(text: string, edits: readonly SourceEdit[]): string {
  if (edits.length === 0) return text;
  const lineStarts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') lineStarts.push(i + 1);
  const absolute = edits
    .map(e => ({ start: lineStarts[e.line] + e.startCol, end: lineStarts[e.line] + e.endCol, text: e.text }))
    .sort((a, b) => b.start - a.start);
  let out = text;
  for (const e of absolute) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  return out;
}

// ---------------------------------------------------------------------------
// Manual UI helpers
// ---------------------------------------------------------------------------

/** Meter of the section's full measures when it is uniform, else null (mixed or none). */
export function uniformMeter(measures: readonly MeasureData[]): TimeSignature | null {
  const meters = distinctMeters(measures.filter(isFullMeasure));
  return meters.length === 1 ? meters[0] : null;
}

export function effectiveFeels(measures: readonly MeasureData[]): ScoreFeel[] {
  return distinctFeels(measures.filter(isFullMeasure));
}

/** Canonical adaptation shortcuts for a section whose current rhythm matches a preset (max 5). */
export function currentPatternShortcuts(section: AccompanimentSection, all: readonly MeasureData[]): StrummingPatternPreset[] {
  const current = currentPreset(section, all);
  const ts = uniformMeter(section.measures);
  if (!current || !ts) return [];
  return adaptationCandidates(current, ts, effectiveFeels(section.measures));
}
