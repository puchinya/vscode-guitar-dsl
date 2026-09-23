// Note value / beat-length parsing shared by chords, melody notes and rhythm tokens.
// Beat counts are kept as exact fractions so that triplets (1/3 beat) sum without float drift.

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

/** True when the denominator has no factor 3, i.e. the value ends a triplet group. */
export function isDyadic(a: Fraction): boolean {
  return a.d % 3 !== 0;
}

export type NoteBase = 1 | 2 | 4 | 8 | 16;

export interface NoteValuePart {
  base: NoteBase;
  dotted: boolean;
  triplet: boolean;
}

export interface NoteValue {
  beats: Fraction;
  parts: NoteValuePart[];
}

export function partBeats(p: NoteValuePart): Fraction {
  let b = frac(4, p.base);
  if (p.dotted) b = fmul(b, frac(3, 2));
  if (p.triplet) b = fmul(b, frac(2, 3));
  return b;
}

/**
 * Parses the common note value notation: `term ('+' term)*`, `term = (1|2|4|8|16) ('.' | 't')?`.
 * Rhythm tokens use '.' as the modifier separator, so they call this with allowDot = false.
 */
export function parseNoteValue(str: string, allowDot = true): NoteValue | null {
  if (!str) return null;
  const termRe = allowDot ? /^(16|8|4|2|1)([.t]?)$/ : /^(16|8|4|2|1)(t?)$/;
  const parts: NoteValuePart[] = [];
  let beats = ZERO;
  for (const term of str.split('+')) {
    const m = term.match(termRe);
    if (!m) return null;
    const part: NoteValuePart = { base: Number(m[1]) as NoteBase, dotted: m[2] === '.', triplet: m[2] === 't' };
    parts.push(part);
    beats = fadd(beats, partBeats(part));
  }
  return { beats, parts };
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
  { beats: frac(4), part: { base: 1, dotted: false, triplet: false } },
  { beats: frac(3), part: { base: 2, dotted: true, triplet: false } },
  { beats: frac(2), part: { base: 2, dotted: false, triplet: false } },
  { beats: frac(3, 2), part: { base: 4, dotted: true, triplet: false } },
  { beats: frac(1), part: { base: 4, dotted: false, triplet: false } },
  { beats: frac(3, 4), part: { base: 8, dotted: true, triplet: false } },
  { beats: frac(1, 2), part: { base: 8, dotted: false, triplet: false } },
  { beats: frac(1, 4), part: { base: 16, dotted: false, triplet: false } }
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

/** Parses the duration part of a rhythm token (`4`, `q`, `8t`, `4+8`, with or without the `r` rest prefix). */
export function parseRhythmDuration(durationStr: string): NoteValue | null {
  const clean = durationStr.replace(/^r/, '').toLowerCase();
  return parseNoteValue(RHYTHM_ALIASES[clean] ?? clean, false);
}
