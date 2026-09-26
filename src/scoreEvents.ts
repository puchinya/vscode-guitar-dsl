// Score events (`@key:`, `@tempo:`, `@time:` ... ) and the per-measure musical context they resolve to
// (docs/specs/guitardsl-syntax.md §16). Pure module: no VS Code / Webview dependency. The parser owns the
// source syntax (line recognition, columns); this module owns the event/context types and their rules.

import { Fraction, frac } from './duration';

export type BeatUnit = 1 | 2 | 4 | 8 | 16;

export interface TimeSignature {
  numerator: number;
  denominator: BeatUnit;
  /** Beat grouping in denominator units; sums to `numerator`. */
  groups: number[];
}

export type Feel = 'straight' | 'swing' | 'shuffle';
export type Ottava = 'none' | '8va' | '8vb';
export type Dynamic = 'ppp' | 'pp' | 'p' | 'mp' | 'mf' | 'f' | 'ff' | 'fff' | 'sfz' | 'fp';
export type TempoMark = 'ritardando' | 'accelerando' | 'aTempo' | 'tempoPrimo';

export interface ResolvedMeasureContext {
  key: string;
  keySignature: number | null;
  tempoBpm: number | null;
  timeSignature: TimeSignature;
  feel: Feel;
  ottava: Ottava;
}

interface ScoreEventBase {
  /** Directive name as written, lower-cased with the `@` (e.g. `@bpm`). */
  directive: string;
  /** 0-based source line and the value column range [valueStart, valueEnd) (no trailing comment). */
  line: number;
  valueStart: number;
  valueEnd: number;
  /** Global zero-based index of the measure the event applies before. */
  beforeMeasure: number;
}

export type ScoreEventPayload =
  | { kind: 'keyChange'; key: string; keySignature: number }
  | { kind: 'tempoChange'; bpm: number }
  | { kind: 'tempoMark'; mark: TempoMark }
  | { kind: 'timeSignatureChange'; timeSignature: TimeSignature }
  | { kind: 'feelChange'; feel: Feel }
  | { kind: 'dynamic'; dynamic: Dynamic }
  | { kind: 'rehearsalMark'; text: string }
  | { kind: 'text'; text: string }
  | { kind: 'ottavaChange'; ottava: Ottava };

export type ScoreEvent = ScoreEventBase & ScoreEventPayload;

export const DEFAULT_TIME_SIGNATURE: TimeSignature = { numerator: 4, denominator: 4, groups: [1, 1, 1, 1] };
export const DEFAULT_FEEL: Feel = 'straight';

// ---------------------------------------------------------------------------
// Key signatures
// ---------------------------------------------------------------------------

const MAJOR_KEY_SIGNATURES: Record<string, number> = {
  C: 0, G: 1, D: 2, A: 3, E: 4, B: 5, 'F#': 6, 'C#': 7,
  F: -1, Bb: -2, Eb: -3, Ab: -4, Db: -5, Gb: -6, Cb: -7
};
const MINOR_KEY_SIGNATURES: Record<string, number> = {
  A: 0, E: 1, B: 2, 'F#': 3, 'C#': 4, 'G#': 5, 'D#': 6, 'A#': 7,
  D: -1, G: -2, C: -3, F: -4, Bb: -5, Eb: -6, Ab: -7
};

/** Number of sharps (positive) or flats (negative) for a `key:` value, or null when it cannot be parsed. */
export function parseKeySignature(key: string): number | null {
  const m = key.trim().match(/^([A-G][b#]?)(m)?$/);
  if (!m) return null;
  const table = m[2] ? MINOR_KEY_SIGNATURES : MAJOR_KEY_SIGNATURES;
  return table[m[1]] ?? null;
}

// ---------------------------------------------------------------------------
// Time signatures
// ---------------------------------------------------------------------------

const DENOMINATORS: readonly number[] = [1, 2, 4, 8, 16];

/** Grouping used when a time signature is written without `(...)` (spec §16.2). */
export function defaultBeatGroups(numerator: number, denominator: number): number[] {
  if ((denominator === 8 || denominator === 16) && numerator > 3 && numerator % 3 === 0) {
    return Array(numerator / 3).fill(3);
  }
  if (numerator >= 5 && numerator % 2 === 1) {
    return [...Array((numerator - 3) / 2).fill(2), 3];
  }
  return Array(numerator).fill(1);
}

export type TimeSignatureParseResult =
  | { ok: true; value: TimeSignature }
  | { ok: false; code: 'invalidTimeSignature' | 'invalidBeatGrouping' };

/** Parses `N/D` or `N/D(g+g+...)`; whitespace around the parts is allowed. */
export function parseTimeSignature(text: string): TimeSignatureParseResult {
  const m = text.trim().match(/^([0-9]+)\s*\/\s*([0-9]+)\s*(?:\(([^)]*)\))?$/);
  if (!m) return { ok: false, code: 'invalidTimeSignature' };
  const numerator = Number(m[1]);
  const denominator = Number(m[2]);
  if (!Number.isInteger(numerator) || numerator < 1 || numerator > 32 || !DENOMINATORS.includes(denominator)) {
    return { ok: false, code: 'invalidTimeSignature' };
  }
  let groups: number[];
  if (m[3] !== undefined) {
    const terms = m[3].split('+').map(s => s.trim());
    if (terms.some(s => !/^[0-9]+$/.test(s))) return { ok: false, code: 'invalidBeatGrouping' };
    groups = terms.map(Number);
    const sum = groups.reduce((a, b) => a + b, 0);
    if (groups.some(g => g < 1 || g >= numerator) || sum !== numerator) {
      return { ok: false, code: 'invalidBeatGrouping' };
    }
  } else {
    groups = defaultBeatGroups(numerator, denominator);
  }
  return { ok: true, value: { numerator, denominator: denominator as BeatUnit, groups } };
}

/** Length of one measure in quarter-note beats: numerator × 4 / denominator. */
export function measureBeats(ts: TimeSignature): Fraction {
  return frac(ts.numerator * 4, ts.denominator);
}

export function sameTimeSignature(a: TimeSignature, b: TimeSignature): boolean {
  return a.numerator === b.numerator && a.denominator === b.denominator
    && a.groups.length === b.groups.length && a.groups.every((g, i) => g === b.groups[i]);
}

/** `7/8`, or `7/8(3+2+2)` when the grouping differs from the default. */
export function formatTimeSignature(ts: TimeSignature): string {
  const base = `${ts.numerator}/${ts.denominator}`;
  const def = defaultBeatGroups(ts.numerator, ts.denominator);
  const isDefault = def.length === ts.groups.length && def.every((g, i) => g === ts.groups[i]);
  return isDefault ? base : `${base}(${ts.groups.join('+')})`;
}

/**
 * Start offsets (quarter beats) of the beam groups of a measure. Groups follow the beat grouping;
 * for an eighth/sixteenth meter whose groups are all single units (e.g. 3/8) the whole measure is one group.
 */
export function beamGroupStarts(ts: TimeSignature): Fraction[] {
  const unit = frac(4, ts.denominator);
  const groups = ts.denominator >= 8 && ts.groups.every(g => g === 1) ? [ts.numerator] : ts.groups;
  const starts: Fraction[] = [];
  let acc = 0;
  for (const g of groups) {
    starts.push(frac(acc * unit.n, unit.d));
    acc += g;
  }
  return starts;
}

/** Index of the beam group containing `offset` (quarter beats). */
export function beamGroupIndex(ts: TimeSignature, offset: number): number {
  const starts = beamGroupStarts(ts).map(f => f.n / f.d);
  let idx = 0;
  for (let i = 0; i < starts.length; i++) {
    if (offset + 1e-9 >= starts[i]) idx = i;
  }
  return idx;
}

// ---------------------------------------------------------------------------
// Directive values
// ---------------------------------------------------------------------------

const FEELS: readonly Feel[] = ['straight', 'swing', 'shuffle'];
const DYNAMICS: readonly Dynamic[] = ['ppp', 'pp', 'p', 'mp', 'mf', 'f', 'ff', 'fff', 'sfz', 'fp'];

export function parseFeel(text: string): Feel | null {
  const v = text.trim().toLowerCase();
  return (FEELS as readonly string[]).includes(v) ? (v as Feel) : null;
}

/** Positive decimal BPM, or null. */
export function parseBpm(text: string): number | null {
  const v = text.trim();
  if (!/^[0-9]+(?:\.[0-9]+)?$/.test(v)) return null;
  const n = Number(v);
  return n > 0 ? n : null;
}

function parseTempoMark(text: string): TempoMark | null {
  const v = text.trim().toLowerCase().replace(/\s+/g, ' ');
  if (v === 'rit.' || v === 'rit' || v === 'ritardando') return 'ritardando';
  if (v === 'accel.' || v === 'accel' || v === 'accelerando') return 'accelerando';
  if (v === 'a tempo') return 'aTempo';
  if (v === 'tempo primo' || v === 'tempo i') return 'tempoPrimo';
  return null;
}

export type DirectiveFailureCode = 'invalidScoreEvent' | 'invalidTimeSignature' | 'invalidBeatGrouping' | 'invalidFeel';

export type DirectiveParseResult =
  | { ok: true; payload: ScoreEventPayload }
  | { ok: false; code: DirectiveFailureCode };

/** Directive names (without `@`, lower-case) accepted by parseDirective. */
export const DIRECTIVE_NAMES: readonly string[] = ['key', 'tempo', 'bpm', 'time', 'meter', 'feel', 'dynamic', 'mark', 'text', 'ottava'];

/** Validates one directive value; `name` is lower-case without `@`. */
export function parseDirective(name: string, value: string): DirectiveParseResult {
  const v = value.trim();
  const invalid: DirectiveParseResult = { ok: false, code: 'invalidScoreEvent' };
  switch (name) {
    case 'key': {
      const keySignature = parseKeySignature(v);
      return keySignature === null ? invalid : { ok: true, payload: { kind: 'keyChange', key: v, keySignature } };
    }
    case 'tempo':
    case 'bpm': {
      const bpm = parseBpm(v);
      if (bpm !== null) return { ok: true, payload: { kind: 'tempoChange', bpm } };
      const mark = name === 'tempo' ? parseTempoMark(v) : null;
      return mark ? { ok: true, payload: { kind: 'tempoMark', mark } } : invalid;
    }
    case 'time':
    case 'meter': {
      const ts = parseTimeSignature(v);
      return ts.ok ? { ok: true, payload: { kind: 'timeSignatureChange', timeSignature: ts.value } } : { ok: false, code: ts.code };
    }
    case 'feel': {
      const feel = parseFeel(v);
      return feel ? { ok: true, payload: { kind: 'feelChange', feel } } : { ok: false, code: 'invalidFeel' };
    }
    case 'dynamic': {
      const d = v.toLowerCase();
      return (DYNAMICS as readonly string[]).includes(d) ? { ok: true, payload: { kind: 'dynamic', dynamic: d as Dynamic } } : invalid;
    }
    case 'mark':
      return v ? { ok: true, payload: { kind: 'rehearsalMark', text: v } } : invalid;
    case 'text':
      return v ? { ok: true, payload: { kind: 'text', text: v } } : invalid;
    case 'ottava': {
      const o = v.toLowerCase();
      if (o === '8va' || o === '8vb') return { ok: true, payload: { kind: 'ottavaChange', ottava: o } };
      if (o === 'off') return { ok: true, payload: { kind: 'ottavaChange', ottava: 'none' } };
      return invalid;
    }
    default:
      return invalid;
  }
}

// ---------------------------------------------------------------------------
// Context resolution
// ---------------------------------------------------------------------------

export interface InitialScoreMetadata {
  key: string;
  bpm: string;
  timeSignature: TimeSignature;
  feel: Feel;
}

export function initialContext(initial: InitialScoreMetadata): ResolvedMeasureContext {
  return {
    key: initial.key,
    keySignature: parseKeySignature(initial.key),
    tempoBpm: parseBpm(initial.bpm),
    timeSignature: initial.timeSignature,
    feel: initial.feel,
    ottava: 'none'
  };
}

/** True for events that change the persistent context (the others are measure annotations). */
export function isPersistentEvent(event: ScoreEventPayload): boolean {
  return event.kind === 'keyChange' || event.kind === 'tempoChange' || event.kind === 'timeSignatureChange'
    || event.kind === 'feelChange' || event.kind === 'ottavaChange' || (event.kind === 'tempoMark' && event.mark === 'tempoPrimo');
}

/** Context after `event`; `initialBpm` is the valid initial score BPM used by `tempo primo` (null = none). */
export function applyScoreEvent(ctx: ResolvedMeasureContext, event: ScoreEventPayload, initialBpm: number | null): ResolvedMeasureContext {
  switch (event.kind) {
    case 'keyChange':
      return { ...ctx, key: event.key, keySignature: event.keySignature };
    case 'tempoChange':
      return { ...ctx, tempoBpm: event.bpm };
    case 'tempoMark':
      return event.mark === 'tempoPrimo' && initialBpm !== null ? { ...ctx, tempoBpm: initialBpm } : ctx;
    case 'timeSignatureChange':
      return { ...ctx, timeSignature: event.timeSignature };
    case 'feelChange':
      return { ...ctx, feel: event.feel };
    case 'ottavaChange':
      return { ...ctx, ottava: event.ottava };
    default:
      return ctx;
  }
}

/** Structural changes (forcing a new system) at a measure: a changed key or a changed time signature. */
export function structuralChange(
  prev: ResolvedMeasureContext | undefined,
  measure: { context: ResolvedMeasureContext; eventsBefore: readonly ScoreEvent[] }
): { key: boolean; time: boolean } {
  if (!prev) return { key: false, time: false };
  const hasKey = measure.eventsBefore.some(e => e.kind === 'keyChange');
  const hasTime = measure.eventsBefore.some(e => e.kind === 'timeSignatureChange');
  return {
    key: hasKey && prev.key !== measure.context.key,
    time: hasTime && !sameTimeSignature(prev.timeSignature, measure.context.timeSignature)
  };
}

/** Human-readable value of an event for outlines (`@tempo: 132`). */
export function describeScoreEvent(event: ScoreEvent): string {
  switch (event.kind) {
    case 'keyChange': return event.key;
    case 'tempoChange': return String(event.bpm);
    case 'tempoMark': return { ritardando: 'rit.', accelerando: 'accel.', aTempo: 'a tempo', tempoPrimo: 'tempo primo' }[event.mark];
    case 'timeSignatureChange': return formatTimeSignature(event.timeSignature);
    case 'feelChange': return event.feel;
    case 'dynamic': return event.dynamic;
    case 'rehearsalMark': return event.text;
    case 'text': return event.text;
    case 'ottavaChange': return event.ottava === 'none' ? 'off' : event.ottava;
  }
}
