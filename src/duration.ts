// Note value / beat-length parsing shared by chords, melody notes and rhythm tokens.
// Beat counts are kept as exact fractions so that tuplets (1/3, 2/5 beat, ...) sum without float drift.

export interface Fraction {
  n: number;
  d: number;
}

function gcd(a: number, b: number): number {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b) {
    [a, b] = [b, a % b];
  }
  return a || 1;
}

export function frac(n: number, d = 1): Fraction {
  if (d < 0) {
    n = -n;
    d = -d;
  }
  const g = gcd(n, d);
  return { n: n / g, d: d / g };
}

export const ZERO: Fraction = { n: 0, d: 1 };

export function fadd(a: Fraction, b: Fraction): Fraction {
  return frac(a.n * b.d + b.n * a.d, a.d * b.d);
}

export function fsub(a: Fraction, b: Fraction): Fraction {
  return frac(a.n * b.d - b.n * a.d, a.d * b.d);
}

export function fmul(a: Fraction, b: Fraction): Fraction {
  return frac(a.n * b.n, a.d * b.d);
}

export function fcmp(a: Fraction, b: Fraction): number {
  return a.n * b.d - b.n * a.d;
}

export function feq(a: Fraction, b: Fraction): boolean {
  return fcmp(a, b) === 0;
}

export function fnum(a: Fraction): number {
  return a.n / a.d;
}

export type NoteBase = 1 | 2 | 4 | 8 | 16;

/** `actual` notes in the time of `normal` notes of the same base value (`8t` = 3:2, `8{5:4}` = 5:4). */
export interface Tuplet {
  actual: number;
  normal: number;
}

export const TRIPLET: Tuplet = { actual: 3, normal: 2 };

export interface NoteValuePart {
  base: NoteBase;
  dotted: boolean;
  tuplet?: Tuplet;
}

export function sameTuplet(a: Tuplet | undefined, b: Tuplet | undefined): boolean {
  return a === b || (a !== undefined && b !== undefined && a.actual === b.actual && a.normal === b.normal);
}

/** True for a ratio with both numbers 2..16 and actual !== normal. */
export function isValidTuplet(t: Tuplet): boolean {
  const ok = (n: number) => Number.isInteger(n) && n >= 2 && n <= 16;
  return ok(t.actual) && ok(t.normal) && t.actual !== t.normal;
}

/** Canonical text of one term: `4`, `4.`, `8t` (3:2), `8{5:4}`. */
export function formatNoteValuePart(p: NoteValuePart): string {
  if (p.tuplet) {
    return sameTuplet(p.tuplet, TRIPLET) ? `${p.base}t` : `${p.base}{${p.tuplet.actual}:${p.tuplet.normal}}`;
  }
  return p.dotted ? `${p.base}.` : String(p.base);
}

export interface NoteValue {
  beats: Fraction;
  parts: NoteValuePart[];
}

export function partBeats(p: NoteValuePart): Fraction {
  let b = frac(4, p.base);
  if (p.dotted) b = fmul(b, frac(3, 2));
  if (p.tuplet) b = fmul(b, frac(p.tuplet.normal, p.tuplet.actual));
  return b;
}

export type NoteValueParseError = 'invalid' | 'invalidTuplet';

/**
 * Parses the common note value notation: `term ('+' term)*`, `term = (1|2|4|8|16) ('.' | 't' | '{a:n}')?`.
 * Rhythm tokens use '.' as the modifier separator, so they call this with allowDot = false.
 * Returns 'invalidTuplet' when the syntax is a tuplet ratio outside 2..16 or with actual === normal.
 */
export function parseNoteValueDetailed(str: string, allowDot = true): NoteValue | NoteValueParseError {
  if (!str) return 'invalid';
  const termRe = allowDot ? /^(16|8|4|2|1)(?:([.t])|\{([0-9]+):([0-9]+)\})?$/ : /^(16|8|4|2|1)(?:(t)|\{([0-9]+):([0-9]+)\})?$/;
  const parts: NoteValuePart[] = [];
  let beats = ZERO;
  for (const term of str.split('+')) {
    const m = term.match(termRe);
    if (!m) return 'invalid';
    const part: NoteValuePart = { base: Number(m[1]) as NoteBase, dotted: m[2] === '.' };
    if (m[2] === 't') part.tuplet = TRIPLET;
    if (m[3] !== undefined) {
      const tuplet = { actual: Number(m[3]), normal: Number(m[4]) };
      if (!isValidTuplet(tuplet)) return 'invalidTuplet';
      part.tuplet = tuplet;
    }
    parts.push(part);
    beats = fadd(beats, partBeats(part));
  }
  return { beats, parts };
}

export function parseNoteValue(str: string, allowDot = true): NoteValue | null {
  const v = parseNoteValueDetailed(str, allowDot);
  return typeof v === 'string' ? null : v;
}

/** Parses a decimal beat count (`2.5`, `3`) as used by the legacy `:` length syntax. */
export function parseBeats(str: string): Fraction | null {
  const m = str.match(/^([0-9]+)(?:\.([0-9]+))?$/);
  if (!m) return null;
  const decimals = m[2] ?? '';
  const scale = Math.pow(10, decimals.length);
  const value = frac(Number(m[1]) * scale + (decimals ? Number(decimals) : 0), scale);
  return value.n > 0 ? value : null;
}

const DECOMPOSE_TABLE: { beats: Fraction; part: NoteValuePart }[] = [
  { beats: frac(4), part: { base: 1, dotted: false } },
  { beats: frac(3), part: { base: 2, dotted: true } },
  { beats: frac(2), part: { base: 2, dotted: false } },
  { beats: frac(3, 2), part: { base: 4, dotted: true } },
  { beats: frac(1), part: { base: 4, dotted: false } },
  { beats: frac(3, 4), part: { base: 8, dotted: true } },
  { beats: frac(1, 2), part: { base: 8, dotted: false } },
  { beats: frac(1, 4), part: { base: 16, dotted: false } }
];

/** Splits a beat count (multiple of 1/4) into tied note values, largest first. Returns null otherwise. */
export function decomposeBeats(beats: Fraction): NoteValuePart[] | null {
  if (beats.n <= 0 || 4 % beats.d !== 0) return null;
  const parts: NoteValuePart[] = [];
  let rest = beats;
  for (const entry of DECOMPOSE_TABLE) {
    while (fcmp(rest, entry.beats) >= 0) {
      parts.push({ ...entry.part });
      rest = fsub(rest, entry.beats);
    }
  }
  return rest.n === 0 ? parts : null;
}

const RHYTHM_ALIASES: Record<string, string> = { w: '1', h: '2', q: '4' };

/** Parses the duration part of a rhythm token (`4`, `q`, `8t`, `8{5:4}`, `4+8`, with or without the `r` rest prefix). */
export function parseRhythmDuration(durationStr: string): NoteValue | null {
  const v = parseRhythmDurationDetailed(durationStr);
  return typeof v === 'string' ? null : v;
}

export function parseRhythmDurationDetailed(durationStr: string): NoteValue | NoteValueParseError {
  const clean = durationStr.replace(/^r/, '').toLowerCase();
  return parseNoteValueDetailed(RHYTHM_ALIASES[clean] ?? clean, false);
}

export interface TupletGroup<T> {
  items: T[];
  /** False when the run ended (other ratio, plain value or end of input) before the group was full. */
  complete: boolean;
}

/**
 * Groups consecutive heads with the same tuplet ratio. A group is full when its length is a multiple of
 * `normal` plain notes of the shortest base in the group (three `8t` = 1 beat, five `8{5:4}` = 2 beats,
 * `4t 8t` = 1 beat). Callers pass the heads of one measure so that groups never cross a barline.
 */
export function tupletGroups<T extends { part: NoteValuePart }>(heads: T[]): TupletGroup<T>[] {
  const groups: TupletGroup<T>[] = [];
  let current: T[] = [];
  let total = ZERO;
  let minPlain: Fraction | null = null;
  const flush = (complete: boolean) => {
    if (current.length > 0) groups.push({ items: current, complete });
    current = [];
    total = ZERO;
    minPlain = null;
  };
  for (const h of heads) {
    const tuplet = h.part.tuplet;
    if (!tuplet || (current.length > 0 && !sameTuplet(current[0].part.tuplet, tuplet))) flush(false);
    if (!tuplet) continue;
    current.push(h);
    total = fadd(total, partBeats(h.part));
    const plain = frac(4, h.part.base);
    if (minPlain === null || fcmp(plain, minPlain) < 0) minPlain = plain;
    const unit = fmul(minPlain, frac(tuplet.normal));
    const ratio = frac(total.n * unit.d, total.d * unit.n);
    if (ratio.d === 1) flush(true);
  }
  flush(false);
  return groups;
}
