// Shared music-notation helpers for the rhythm staff (svg.ts) and the melody staff (melodyStaff.ts).
// All coordinates are system unit coordinates (see layout.ts).

import { MeasureData, ParsedScore } from '../compiler';
import { Fraction, NoteBase, NoteValuePart, ZERO, fadd, fnum, isDyadic, partBeats, parseRhythmDuration } from '../duration';
import { SYSTEM_UNIT_WIDTH } from './layout';

export function escapeXml(str: string): string {
  return str.replace(/[&<>"']/g, c => {
    switch (c) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      case "'": return '&#39;';
      default: return c;
    }
  });
}

export const FETA_TREBLE_CLEF_PATH = "m12.049 3.5296c0.305 3.1263-2.019 5.6563-4.0772 7.7014-0.9349 0.897-0.155 0.148-0.6437 0.594-0.1022-0.479-0.2986-1.731-0.2802-2.11 0.1304-2.6939 2.3198-6.5875 4.2381-8.0236 0.309 0.5767 0.563 0.6231 0.763 1.8382zm0.651 16.142c-1.232-0.906-2.85-1.144-4.3336-0.885-0.1913-1.255-0.3827-2.51-0.574-3.764 2.3506-2.329 4.9066-5.0322 5.0406-8.5394 0.059-2.232-0.276-4.6714-1.678-6.4836-1.7004 0.12823-2.8995 2.156-3.8019 3.4165-1.4889 2.6705-1.1414 5.9169-0.57 8.7965-0.8094 0.952-1.9296 1.743-2.7274 2.734-2.3561 2.308-4.4085 5.43-4.0046 8.878 0.18332 3.334 2.5894 6.434 5.8702 7.227 1.2457 0.315 2.5639 0.346 3.8241 0.099 0.2199 2.25 1.0266 4.629 0.0925 6.813-0.7007 1.598-2.7875 3.004-4.3325 2.192-0.5994-0.316-0.1137-0.051-0.478-0.252 1.0698-0.257 1.9996-1.036 2.26-1.565 0.8378-1.464-0.3998-3.639-2.1554-3.358-2.262 0.046-3.1904 3.14-1.7356 4.685 1.3468 1.52 3.833 1.312 5.4301 0.318 1.8125-1.18 2.0395-3.544 1.8325-5.562-0.07-0.678-0.403-2.67-0.444-3.387 0.697-0.249 0.209-0.059 1.193-0.449 2.66-1.053 4.357-4.259 3.594-7.122-0.318-1.469-1.044-2.914-2.302-3.792zm0.561 5.757c0.214 1.991-1.053 4.321-3.079 4.96-0.136-0.795-0.172-1.011-0.2626-1.475-0.4822-2.46-0.744-4.987-1.116-7.481 1.6246-0.168 3.4576 0.543 4.0226 2.184 0.244 0.577 0.343 1.197 0.435 1.812zm-5.1486 5.196c-2.5441 0.141-4.9995-1.595-5.6343-4.081-0.749-2.153-0.5283-4.63 0.8207-6.504 1.1151-1.702 2.6065-3.105 4.0286-4.543 0.183 1.127 0.366 2.254 0.549 3.382-2.9906 0.782-5.0046 4.725-3.215 7.451 0.5324 0.764 1.9765 2.223 2.7655 1.634-1.102-0.683-2.0033-1.859-1.8095-3.227-0.0821-1.282 1.3699-2.911 2.6513-3.198 0.4384 2.869 0.9413 6.073 1.3797 8.943-0.5054 0.1-1.0211 0.143-1.536 0.143z";

export function fmt(n: number, digits = 2): string {
  return String(Number(n.toFixed(digits)));
}

/** First barline x of a system without a key signature. */
export const BASE_START_X = 78;
const KEY_ACCIDENTAL_SPACING = 7;
const KEY_SIGNATURE_PADDING = 6;
const MEASURE_PAD = 14;

export interface RenderContext {
  score: ParsedScore;
  /** Key signature drawn on melody staves (0 when the score has no melody). */
  keySignature: number;
  keySignatureWidth: number;
  /** First barline x, shared by all systems so that barlines line up. */
  startX: number;
  totalWidth: number;
}

export function getRenderContext(score: ParsedScore): RenderContext {
  const hasMelody = score.measures.some(m => m.melody !== undefined);
  const keySignature = hasMelody ? (score.keySignature ?? 0) : 0;
  const keySignatureWidth = keySignature !== 0 ? Math.abs(keySignature) * KEY_ACCIDENTAL_SPACING + KEY_SIGNATURE_PADDING : 0;
  return { score, keySignature, keySignatureWidth, startX: BASE_START_X + keySignatureWidth, totalWidth: SYSTEM_UNIT_WIDTH };
}

export function measureBounds(ctx: RenderContext, count: number, idx: number): { bx: number; width: number } {
  const usableWidth = (ctx.totalWidth - 5) - ctx.startX;
  const width = usableWidth / count;
  return { bx: ctx.startX + idx * width, width };
}

/** One notehead / slash head produced by a rhythm token or melody note (compound values expand to several). */
export interface ExpandedHead {
  offset: Fraction;
  beats: Fraction;
  part: NoteValuePart;
  /** False for the 2nd+ head of a compound value (`4+8`), which is tied from the previous head. */
  isFirstPart: boolean;
}

const FALLBACK_PART: NoteValuePart = { base: 4, dotted: false, triplet: false };

export function expandParts(parts: NoteValuePart[], start: Fraction): ExpandedHead[] {
  const heads: ExpandedHead[] = [];
  let offset = start;
  parts.forEach((part, i) => {
    const beats = partBeats(part);
    heads.push({ offset, beats, part, isFirstPart: i === 0 });
    offset = fadd(offset, beats);
  });
  return heads;
}

export function rhythmParts(duration: string): NoteValuePart[] {
  return parseRhythmDuration(duration)?.parts ?? [FALLBACK_PART];
}

function key(f: Fraction): string {
  return `${f.n}/${f.d}`;
}

export interface MeasureColumns {
  /** x of the column at the given beat offset. */
  xAt(offset: Fraction): number | undefined;
  /** Sorted beat offsets (as numbers) and their x positions. */
  columns: { beat: number; x: number }[];
}

/**
 * Horizontal positions inside a measure: the union of rhythm and melody onsets, equally spaced.
 * For a measure without melody this reproduces the original equal spacing of the rhythm items.
 */
export function computeMeasureColumns(m: MeasureData, bx: number, width: number, includeRhythm: boolean): MeasureColumns {
  const onsets = new Map<string, Fraction>();
  if (includeRhythm && !m.isMeasureRepeat) {
    let offset = ZERO;
    for (const r of m.rhythms) {
      for (const head of expandParts(rhythmParts(r.duration), offset)) {
        onsets.set(key(head.offset), head.offset);
        offset = fadd(head.offset, head.beats);
      }
    }
  }
  if (m.melody) {
    let offset = ZERO;
    for (const note of m.melody) {
      for (const head of expandParts(note.parts, offset)) {
        onsets.set(key(head.offset), head.offset);
        offset = fadd(head.offset, head.beats);
      }
    }
  }
  const sorted = Array.from(onsets.values()).sort((a, b) => fnum(a) - fnum(b));
  const usableW = width - MEASURE_PAD - MEASURE_PAD;
  const count = sorted.length;
  const step = usableW / (count > 0 ? count : 1);
  const xs = new Map<string, number>();
  const columns = sorted.map((f, idx) => {
    const x = count === 1 ? bx + width / 2 : bx + MEASURE_PAD + (idx + 0.5) * step;
    xs.set(key(f), x);
    return { beat: fnum(f), x };
  });
  return { xAt: (offset: Fraction) => xs.get(key(offset)), columns };
}

/** x for a chord placed at `beat`: the matching column, or proportional when no note starts there. */
export function chordXAt(columns: MeasureColumns, bx: number, width: number, beat: number): number {
  const match = columns.columns.find(c => Math.abs(c.beat - beat) < 0.05);
  if (match) return Math.max(bx + 8, match.x - 4);
  return Math.max(bx + 8, bx + MEASURE_PAD + (beat / 4.0) * (width - 2 * MEASURE_PAD));
}

/**
 * Groups consecutive triplet heads; a group closes when its accumulated length is a plain
 * (non-triplet) value, e.g. three 8t = 1 beat, three 4t = 2 beats.
 */
export function tripletGroups<T extends { part: NoteValuePart; beats: Fraction }>(heads: T[]): T[][] {
  const groups: T[][] = [];
  let current: T[] = [];
  let total = ZERO;
  for (const h of heads) {
    if (!h.part.triplet) {
      if (current.length > 0) groups.push(current);
      current = [];
      total = ZERO;
      continue;
    }
    current.push(h);
    total = fadd(total, h.beats);
    if (isDyadic(total)) {
      groups.push(current);
      current = [];
      total = ZERO;
    }
  }
  if (current.length > 0) groups.push(current);
  return groups;
}

/** Rest glyph centred on (x, midY); `staveLines` are the five line y positions (top to bottom). */
export function renderRestGlyph(base: NoteBase, rx: number, midY: number, staveLines: number[]): string {
  if (base === 1) {
    return `<rect x="${rx - 6}" y="${staveLines[1]}" width="12" height="5" fill="#000"/>`;
  }
  if (base === 2) {
    return `<rect x="${rx - 6}" y="${staveLines[2] - 5}" width="12" height="5" fill="#000"/>`;
  }
  if (base === 8) {
    return `<g transform="translate(${rx}, ${midY})">
            <circle cx="-2" cy="-5" r="2.4" fill="#000"/>
            <path d="M -0.2,-5 C 1.2,-5 2.8,-6.2 3.8,-8.5 L 4.5,-8.5 C 3.2,-3.5 0.5,3.5 -3.5,8.5 L -4.5,8.0 C -1.5,4.0 0.8,-1.5 1.5,-4.5 C 0.8,-4.2 0.2,-4.2 -0.2,-4.2 Z" fill="#000"/>
          </g>`;
  }
  if (base === 16) {
    return `<g transform="translate(${rx}, ${midY})">
            <circle cx="-2" cy="-8" r="2.2" fill="#000"/>
            <circle cx="-3" cy="-1" r="2.2" fill="#000"/>
            <path d="M -0.2,-8 C 1.2,-8 2.5,-9.2 3.5,-11.5 L 4.2,-11.5 C 3.0,-6.5 0.5,2.5 -3.5,8.5 L -4.5,8.0 C -1.5,4.0 0.8,-2.5 1.5,-5.5 C 0.8,-5.2 0.2,-5.2 -0.2,-5.2 Z" fill="#000"/>
            <path d="M -1.2,-1 C 0.2,-1 1.5,-2.2 2.5,-4.5 L 3.2,-4.5 C 2.5,-1.5 1.5,2.5 -0.5,5.5 L -1.5,5.0 C 0,-1.0 0.5,-3.0 0.5,-3.0 Z" fill="#000"/>
          </g>`;
  }
  // Quarter rest: zigzag glyph spanning 3 staff spaces (y = -12..12 around the middle line).
  return `<g transform="translate(${rx}, ${midY})"><path d="M -1.6,-12 L 3.6,-5.4 C 2,-3.6 1.2,-2 1.6,-0.4 L 3.8,4.2 C 1.4,3.4 -1.4,4.2 -1.4,6.8 C -1.4,8.8 -0.2,10.6 1.2,12 C -2.2,10.8 -4.2,8.4 -4.2,5.8 C -4.2,3.4 -2.4,2.2 0,2.4 L -2.8,-1.6 C -1,-3.2 -0.2,-4.8 -0.6,-6.8 L -3,-9.6 Z" fill="#000"/></g>`;
}

/** Flag(s) for an unbeamed 8th / 16th note. `down` mirrors the flag for a downward stem ending at stemEndY. */
export function renderFlags(base: NoteBase, stemX: number, stemEndY: number, down = false, opacity = '1.0'): string {
  if (base < 8) return '';
  const flag = (y: number) => `<path d="M ${stemX},${y} C ${stemX + 4},${y + 4} ${stemX + 6},${y + 8} ${stemX + 6},${y + 13} C ${stemX + 4},${y + 10} ${stemX + 2},${y + 8} ${stemX},${y + 6} Z" fill="#000" opacity="${opacity}"/>`;
  let out = flag(stemEndY);
  if (base >= 16) out += flag(stemEndY + 5);
  return down ? `<g transform="translate(0, ${fmt(2 * stemEndY)}) scale(1, -1)">${out}</g>` : out;
}

/** Sharp / flat / natural drawn as vector paths (independent of the embedded font). */
export function renderAccidental(alter: -1 | 0 | 1, x: number, y: number): string {
  if (alter === 1) {
    return `<g transform="translate(${fmt(x)}, ${fmt(y)})" stroke="#000" fill="none">`
      + `<line x1="-1.6" y1="-7" x2="-1.6" y2="7" stroke-width="0.9"/>`
      + `<line x1="1.6" y1="-7.8" x2="1.6" y2="6.2" stroke-width="0.9"/>`
      + `<line x1="-3.4" y1="-1.6" x2="3.4" y2="-3.4" stroke-width="2"/>`
      + `<line x1="-3.4" y1="3.4" x2="3.4" y2="1.6" stroke-width="2"/></g>`;
  }
  if (alter === -1) {
    return `<g transform="translate(${fmt(x)}, ${fmt(y)})">`
      + `<line x1="-2.2" y1="-10" x2="-2.2" y2="3.2" stroke="#000" stroke-width="1"/>`
      + `<path d="M -2.2,3.2 C 1.5,1.2 4.2,-0.6 3.4,-2.6 C 2.6,-4.2 0,-3.4 -2.2,-1.2 L -2.2,0.2 C -0.4,-1.8 1.6,-2.4 1.9,-1.6 C 2.2,-0.6 0.4,1 -2.2,2.4 Z" fill="#000"/></g>`;
  }
  return `<g transform="translate(${fmt(x)}, ${fmt(y)})" stroke="#000" fill="none">`
    + `<line x1="-2" y1="-8" x2="-2" y2="3.2" stroke-width="0.9"/>`
    + `<line x1="2" y1="-3.2" x2="2" y2="8" stroke-width="0.9"/>`
    + `<line x1="-2" y1="-1.2" x2="2" y2="-2.4" stroke-width="2"/>`
    + `<line x1="-2" y1="3.4" x2="2" y2="2.2" stroke-width="2"/></g>`;
}

// Staff positions (0 = bottom line E4, 1 step = half a staff space) of key signature accidentals.
const SHARP_POSITIONS = [8, 5, 9, 6, 3, 7, 4]; // F5 C5 G5 D5 A4 E5 B4
const FLAT_POSITIONS = [4, 7, 3, 6, 2, 5, 1]; // B4 E5 A4 D5 G4 C5 F4
const SHARP_ORDER = ['f', 'c', 'g', 'd', 'a', 'e', 'b'];
const FLAT_ORDER = ['b', 'e', 'a', 'd', 'g', 'c', 'f'];

export function renderKeySignature(keySignature: number, x: number, staveBottom: number): string {
  const count = Math.min(7, Math.abs(keySignature));
  const positions = keySignature > 0 ? SHARP_POSITIONS : FLAT_POSITIONS;
  let out = '';
  for (let i = 0; i < count; i++) {
    out += renderAccidental(keySignature > 0 ? 1 : -1, x + i * KEY_ACCIDENTAL_SPACING + 3, staveBottom - positions[i] * 4);
  }
  return out;
}

/** Alteration implied by the key signature for a pitch step. */
export function keyAlter(keySignature: number, step: string): -1 | 0 | 1 {
  if (keySignature > 0 && SHARP_ORDER.slice(0, keySignature).includes(step)) return 1;
  if (keySignature < 0 && FLAT_ORDER.slice(0, -keySignature).includes(step)) return -1;
  return 0;
}


/** Tie arc between two heads; `below` bends the arc downwards (y grows downwards). */
export function renderTieArc(x1: number, x2: number, y: number, below: boolean): string {
  const bend = below ? 5 : -5;
  const thick = below ? 1.6 : -1.6;
  const mid = (x1 + x2) / 2;
  return `<path d="M ${fmt(x1)},${fmt(y)} Q ${fmt(mid)},${fmt(y + bend * 2)} ${fmt(x2)},${fmt(y)} Q ${fmt(mid)},${fmt(y + bend * 2 - thick)} ${fmt(x1)},${fmt(y)} Z" fill="#000"/>`;
}
