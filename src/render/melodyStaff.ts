// Melody staff of a melody system: notes, key signature, accidentals, ties, triplets and syllable lyrics
// (docs/specs/guitardsl-syntax.md §12–§14). Drawn in system unit coordinates above the rhythm staff.

import { MeasureData } from '../compiler';
import { Fraction, NoteBase, NoteValuePart, ZERO, fadd, fnum } from '../duration';
import { MelodyNote, Pitch } from '../melody';
import { MELODY_STAVE_BOTTOM, MELODY_STAVE_TOP, SystemGeometry, estimateTextWidth } from './layout';
import {
  FETA_TREBLE_CLEF_PATH,
  FLAG_16_STEM_EXTENSION,
  RenderContext,
  chordXAt,
  computeMeasureColumns,
  escapeXml,
  expandParts,
  fmt,
  keyAlter,
  measureBounds,
  renderAccidental,
  renderFlags,
  renderKeySignature,
  renderRestGlyph,
  renderTieArc,
  tripletGroups
} from './notation';

const STAVE_LINES = [0, 8, 16, 24, 32].map(dy => MELODY_STAVE_TOP + dy);
const MID_Y = STAVE_LINES[2];
const STEM_LENGTH = 26;
const HEAD_RX = 5;
const HEAD_RY = 3.7;
const STEP_INDEX: Record<string, number> = { c: 0, d: 1, e: 2, f: 3, g: 4, a: 5, b: 6 };

/** Staff position: 0 = bottom line (E4), +1 per diatonic step. */
export function staffPosition(p: Pitch): number {
  return p.octave * 7 + STEP_INDEX[p.step] - (4 * 7 + 2);
}

function yOf(pos: number): number {
  return MELODY_STAVE_BOTTOM - pos * 4;
}

interface Head {
  measureIdx: number;
  note: MelodyNote;
  part: NoteValuePart;
  beats: Fraction;
  offset: number;
  x: number;
  pos: number;
  y: number;
  isFirstPart: boolean;
  isLastPart: boolean;
  stemUp: boolean;
  stemX: number;
  stemEndY: number;
  beamed: boolean;
}

export interface MelodyStaffOptions {
  isFirstSystem: boolean;
  geometry: SystemGeometry;
  /** Columns include the rhythm onsets (melody system) or only the melody (lead sheet). */
  includeRhythmColumns: boolean;
}

export function renderMelodyStaff(measures: MeasureData[], ctx: RenderContext, opts: MelodyStaffOptions): string {
  const style = ctx.score.style;
  const chordSize = style.chordSize ?? 15;
  const sectionSize = style.sectionSize ?? 9.5;
  const lyricSize = style.lyricSize ?? 10;
  const leadSheet = opts.geometry.kind === 'leadSheet';

  let out = '';
  STAVE_LINES.forEach(y => {
    out += `<line x1="25" y1="${y}" x2="${ctx.totalWidth - 5}" y2="${y}" stroke="#000" stroke-width="1"/>`;
  });
  out += `<line x1="25" y1="${STAVE_LINES[0]}" x2="25" y2="${STAVE_LINES[4]}" stroke="#000" stroke-width="2"/>`;
  out += `<g transform="translate(28, 53.36) scale(1.6)"><path d="${FETA_TREBLE_CLEF_PATH}" fill="#000"/></g>`;
  if (ctx.keySignature !== 0) {
    out += renderKeySignature(ctx.keySignature, 54, MELODY_STAVE_BOTTOM);
  }
  if (opts.isFirstSystem) {
    const tx = 58 + ctx.keySignatureWidth;
    out += `<text x="${tx}" y="${MELODY_STAVE_TOP + 14}" font-size="14" font-weight="bold">4</text>`;
    out += `<text x="${tx}" y="${MELODY_STAVE_TOP + 30}" font-size="14" font-weight="bold">4</text>`;
  }

  const heads: Head[] = [];

  measures.forEach((m, idx) => {
    const { bx, width } = measureBounds(ctx, measures.length, idx);
    const bEnd = bx + width;
    const columns = computeMeasureColumns(m, bx, width, opts.includeRhythmColumns);

    out += renderBarline(m, bx, bEnd);

    if (m.sectionName) {
      out += `<rect x="${fmt(bx + 4)}" y="2" width="${fmt(m.sectionName.length * (sectionSize * 0.95) + 12)}" height="${fmt(sectionSize + 5)}" fill="#fff" stroke="#000" stroke-width="1.2"/>`;
      out += `<text x="${fmt(bx + 10)}" y="${fmt(sectionSize + 3.5)}" font-size="${sectionSize}" font-weight="bold">${escapeXml(m.sectionName)}</text>`;
    }

    const chords = m.chords.length > 0 ? m.chords : (m.chord ? [{ name: m.chord, beat: 0 }] : []);
    let lastChordRight = bx;
    chords.forEach((ch, chIdx) => {
      let chordX = bx + 8;
      if (chIdx > 0 || ch.beat > 0) chordX = chordXAt(columns, bx, width, ch.beat);
      chordX = Math.max(lastChordRight + 6, chordX);
      lastChordRight = chordX + ch.name.length * (chordSize * 0.6);
      out += `<text x="${fmt(chordX)}" y="33" font-size="${chordSize}" font-weight="900" fill="#000">${escapeXml(ch.name)}</text>`;
    });

    if (!m.melody) {
      if (leadSheet) {
        // Beat slashes on the melody staff for measures without melody (spec §14.2).
        for (let beat = 0; beat < 4; beat++) {
          const x = bx + 14 + (beat + 0.5) * ((width - 28) / 4);
          out += `<polygon points="${fmt(x - 5.5)},${MID_Y + 7} ${fmt(x)},${MID_Y + 7} ${fmt(x + 6.5)},${MID_Y - 7} ${fmt(x + 1)},${MID_Y - 7}" fill="#000"/>`;
        }
        if (m.lyric) {
          out += `<text x="${fmt(bx + width / 2)}" y="${fmt(opts.geometry.lyricBaseline)}" font-size="${lyricSize}" text-anchor="middle" fill="#222">${escapeXml(m.lyric)}</text>`;
        }
      }
      return;
    }

    let offset: Fraction = ZERO;
    m.melody.forEach(note => {
      const expanded = expandParts(note.parts, offset);
      expanded.forEach((h, i) => {
        const x = columns.xAt(h.offset) ?? bx + width / 2;
        const pos = note.pitch ? staffPosition(note.pitch) : 4;
        const stemUp = pos < 4;
        // Beamed stems are recomputed later; only an unbeamed 16th keeps this extension.
        const stemLength = STEM_LENGTH + (h.part.base >= 16 ? FLAG_16_STEM_EXTENSION : 0);
        heads.push({
          measureIdx: idx,
          note,
          part: h.part,
          beats: h.beats,
          offset: fnum(h.offset),
          x,
          pos,
          y: note.isRest ? MID_Y : yOf(pos),
          isFirstPart: h.isFirstPart,
          isLastPart: i === expanded.length - 1,
          stemUp,
          stemX: stemUp ? x + HEAD_RX - 0.4 : x - HEAD_RX + 0.4,
          stemEndY: stemUp ? yOf(pos) - stemLength : yOf(pos) + stemLength,
          beamed: false
        });
        offset = fadd(h.offset, h.beats);
      });
    });
  });

  out += renderBeams(heads);
  out += renderHeads(heads, ctx);
  out += renderTies(heads, ctx);
  out += renderTriplets(heads);
  out += renderSyllables(heads, opts.geometry, lyricSize);
  return out;
}

function renderBarline(m: MeasureData, bx: number, bEnd: number): string {
  const [top, , , , bottom] = STAVE_LINES;
  let out = '';
  if (m.repeatEnd) {
    out += `<circle cx="${fmt(bEnd - 12)}" cy="${STAVE_LINES[1] + 4}" r="2" fill="#000"/>`;
    out += `<circle cx="${fmt(bEnd - 12)}" cy="${STAVE_LINES[2] + 4}" r="2" fill="#000"/>`;
    out += `<line x1="${fmt(bEnd - 5)}" y1="${top}" x2="${fmt(bEnd - 5)}" y2="${bottom}" stroke="#000" stroke-width="1.2"/>`;
    out += `<line x1="${fmt(bEnd)}" y1="${top}" x2="${fmt(bEnd)}" y2="${bottom}" stroke="#000" stroke-width="3"/>`;
  } else {
    out += `<line x1="${fmt(bEnd)}" y1="${top}" x2="${fmt(bEnd)}" y2="${bottom}" stroke="#000" stroke-width="1.2"/>`;
  }
  if (m.repeatStart) {
    out += `<line x1="${fmt(bx)}" y1="${top}" x2="${fmt(bx)}" y2="${bottom}" stroke="#000" stroke-width="3"/>`;
    out += `<line x1="${fmt(bx + 5)}" y1="${top}" x2="${fmt(bx + 5)}" y2="${bottom}" stroke="#000" stroke-width="1.2"/>`;
    out += `<circle cx="${fmt(bx + 12)}" cy="${STAVE_LINES[1] + 4}" r="2" fill="#000"/>`;
    out += `<circle cx="${fmt(bx + 12)}" cy="${STAVE_LINES[2] + 4}" r="2" fill="#000"/>`;
  }
  return out;
}

/** Beams 8th/16th notes within the same beat of a measure; the stem direction follows the group average. */
function renderBeams(heads: Head[]): string {
  const groups = new Map<string, Head[]>();
  for (const h of heads) {
    if (h.note.isRest || h.part.base < 8) continue;
    const k = `${h.measureIdx}:${Math.floor(h.offset + 1e-9)}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(h);
  }

  let out = '';
  groups.forEach(group => {
    if (group.length < 2) return;
    const avg = group.reduce((acc, h) => acc + h.pos, 0) / group.length;
    const up = avg < 4;
    const beamY = up
      ? Math.min(...group.map(h => h.y)) - STEM_LENGTH
      : Math.max(...group.map(h => h.y)) + STEM_LENGTH;
    for (const h of group) {
      h.beamed = true;
      h.stemUp = up;
      h.stemX = up ? h.x + HEAD_RX - 0.4 : h.x - HEAD_RX + 0.4;
      h.stemEndY = beamY;
    }
    const first = group[0];
    const last = group[group.length - 1];
    out += `<line x1="${fmt(first.stemX)}" y1="${fmt(beamY)}" x2="${fmt(last.stemX)}" y2="${fmt(beamY)}" stroke="#000" stroke-width="3.6" stroke-linecap="butt"/>`;

    // Secondary beam for runs of 16th notes (a lone 16th gets a short flaglet).
    const subY = up ? beamY + 5 : beamY - 5;
    let run: Head[] = [];
    const flush = (isEnd: boolean) => {
      if (run.length === 1) {
        const h = run[0];
        const toward = h === last || (!isEnd && h !== first) ? -6 : 6;
        out += `<line x1="${fmt(h.stemX)}" y1="${fmt(subY)}" x2="${fmt(h.stemX + toward)}" y2="${fmt(subY)}" stroke="#000" stroke-width="2.4" stroke-linecap="butt"/>`;
      } else if (run.length > 1) {
        out += `<line x1="${fmt(run[0].stemX)}" y1="${fmt(subY)}" x2="${fmt(run[run.length - 1].stemX)}" y2="${fmt(subY)}" stroke="#000" stroke-width="2.4" stroke-linecap="butt"/>`;
      }
      run = [];
    };
    for (const h of group) {
      if (h.part.base >= 16) run.push(h);
      else flush(false);
    }
    flush(true);
  });
  return out;
}

function renderHeads(heads: Head[], ctx: RenderContext): string {
  let out = '';
  // Accidental state per measure: "<step><octave>" -> alteration currently in effect.
  let state = new Map<string, number>();
  let stateMeasure = -1;

  for (const h of heads) {
    if (h.measureIdx !== stateMeasure) {
      state = new Map();
      stateMeasure = h.measureIdx;
    }

    if (h.note.isRest) {
      out += renderRestGlyph(h.part.base, h.x, MID_Y, STAVE_LINES);
      if (h.part.dotted) out += `<circle cx="${fmt(h.x + 8)}" cy="${MID_Y - 4}" r="1.6" fill="#000"/>`;
      continue;
    }

    const pitch = h.note.pitch!;
    const k = `${pitch.step}${pitch.octave}`;

    // Ledger lines
    for (let p = -2; p >= h.pos; p -= 2) {
      out += `<line x1="${fmt(h.x - 8)}" y1="${fmt(yOf(p))}" x2="${fmt(h.x + 8)}" y2="${fmt(yOf(p))}" stroke="#000" stroke-width="1"/>`;
    }
    for (let p = 10; p <= h.pos; p += 2) {
      out += `<line x1="${fmt(h.x - 8)}" y1="${fmt(yOf(p))}" x2="${fmt(h.x + 8)}" y2="${fmt(yOf(p))}" stroke="#000" stroke-width="1"/>`;
    }

    // Accidentals: only when the alteration differs from the key signature / earlier notes of the measure.
    if (h.isFirstPart) {
      const expected = state.has(k) ? state.get(k)! : keyAlter(ctx.keySignature, pitch.step);
      if (!h.note.tiedFromPrev && pitch.alter !== expected) {
        out += renderAccidental(pitch.alter, h.x - 11, h.y);
      }
      state.set(k, pitch.alter);
    }

    // Notehead
    out += renderNotehead(h.part.base, h.x, h.y);

    if (h.part.dotted) {
      const dotY = h.pos % 2 === 0 ? h.y - 4 : h.y;
      out += `<circle cx="${fmt(h.x + 8.5)}" cy="${fmt(dotY)}" r="1.6" fill="#000"/>`;
    }

    // Stem and flags
    if (h.part.base >= 2) {
      const headEdge = h.stemUp ? h.y - 1 : h.y + 1;
      out += `<line x1="${fmt(h.stemX)}" y1="${fmt(headEdge)}" x2="${fmt(h.stemX)}" y2="${fmt(h.stemEndY)}" stroke="#000" stroke-width="1.35"/>`;
      if (!h.beamed) {
        out += renderFlags(h.part.base as NoteBase, h.stemX, h.stemEndY, !h.stemUp);
      }
    }
  }
  return out;
}

/** Closed ellipse path (usable with fill-rule="evenodd" to cut the hole of hollow noteheads). */
function ellipsePath(cx: number, cy: number, rx: number, ry: number, deg: number): string {
  const t = (deg * Math.PI) / 180;
  const dx = rx * Math.cos(t);
  const dy = rx * Math.sin(t);
  const p1 = `${fmt(cx + dx)},${fmt(cy + dy)}`;
  const p2 = `${fmt(cx - dx)},${fmt(cy - dy)}`;
  return `M ${p1} A ${rx} ${ry} ${deg} 1 0 ${p2} A ${rx} ${ry} ${deg} 1 0 ${p1} Z`;
}

/**
 * Whole note: level oval with thick sides and a hole tilted to the upper right.
 * Half note: tilted oval with a thin elongated hole. Quarter and shorter: filled tilted oval.
 */
function renderNotehead(base: NoteBase, x: number, y: number): string {
  if (base === 1) {
    return `<path class="notehead" d="${ellipsePath(x, y, 6.4, 4.2, 0)} ${ellipsePath(x, y, 3.3, 1.9, -55)}" fill="#000" fill-rule="evenodd"/>`;
  }
  if (base === 2) {
    return `<path class="notehead" d="${ellipsePath(x, y, HEAD_RX + 0.2, HEAD_RY + 0.1, -20)} ${ellipsePath(x, y, 4.3, 1.5, -30)}" fill="#000" fill-rule="evenodd"/>`;
  }
  return `<ellipse class="notehead" cx="${fmt(x)}" cy="${fmt(y)}" rx="${HEAD_RX}" ry="${HEAD_RY}" transform="rotate(-20 ${fmt(x)} ${fmt(y)})" fill="#000"/>`;
}

function renderTies(heads: Head[], ctx: RenderContext): string {
  let out = '';
  const sounding = heads.filter(h => !h.note.isRest);
  sounding.forEach((h, i) => {
    const below = h.stemUp;
    const tieY = below ? h.y + 6 : h.y - 6;
    // A note that continues a tie from the previous system starts with a half arc.
    if (i === 0 && h.isFirstPart && h.note.tiedFromPrev) {
      out += renderTieArc(ctx.startX - 4, h.x - 6, tieY, below);
    }
    const tiesForward = !h.isLastPart || h.note.tieToNext;
    if (!tiesForward) return;
    const next = sounding[i + 1];
    if (next) {
      out += renderTieArc(h.x + 6, next.x - 6, tieY, below);
    } else {
      out += renderTieArc(h.x + 6, ctx.totalWidth - 8, tieY, below);
    }
  });
  return out;
}

function renderTriplets(heads: Head[]): string {
  let out = '';
  const byMeasure = new Map<number, Head[]>();
  heads.forEach(h => {
    if (!byMeasure.has(h.measureIdx)) byMeasure.set(h.measureIdx, []);
    byMeasure.get(h.measureIdx)!.push(h);
  });
  byMeasure.forEach(list => {
    for (const group of tripletGroups(list)) {
      const x1 = group[0].x - 4;
      const x2 = group[group.length - 1].x + 4;
      const top = Math.min(...group.map(h => Math.min(h.y, h.part.base >= 2 && !h.note.isRest ? h.stemEndY : h.y))) - 6;
      const cx = (x1 + x2) / 2;
      const allBeamed = group.every(h => h.beamed);
      if (!allBeamed) {
        out += `<path d="M ${fmt(x1)},${fmt(top + 3)} L ${fmt(x1)},${fmt(top)} L ${fmt(cx - 5)},${fmt(top)} M ${fmt(cx + 5)},${fmt(top)} L ${fmt(x2)},${fmt(top)} L ${fmt(x2)},${fmt(top + 3)}" fill="none" stroke="#000" stroke-width="0.8"/>`;
      }
      out += `<text x="${fmt(cx)}" y="${fmt(top + 3)}" font-size="8" font-style="italic" text-anchor="middle" fill="#000">3</text>`;
    }
  });
  return out;
}

function renderSyllables(heads: Head[], geometry: SystemGeometry, lyricSize: number): string {
  let out = '';
  const sung = heads.filter(h => h.isFirstPart && !h.note.isRest);
  for (let verse = 0; verse < geometry.verseCount; verse++) {
    const baseline = geometry.lyricBaseline + verse * geometry.lyricLineHeight;
    let lastEnd: number | null = null;
    let pendingHyphenFrom: number | null = null;

    for (const h of sung) {
      const syl = h.note.syllables[verse];
      if (!syl) continue;
      if (syl.extend) {
        if (lastEnd !== null) {
          const x2 = h.x + HEAD_RX;
          out += `<line x1="${fmt(lastEnd + 1)}" y1="${fmt(baseline + 1)}" x2="${fmt(x2)}" y2="${fmt(baseline + 1)}" stroke="#222" stroke-width="0.8"/>`;
          lastEnd = x2;
        }
        continue;
      }
      const halfWidth = estimateTextWidth(syl.text, lyricSize, false) / 2;
      if (pendingHyphenFrom !== null) {
        const hx = (pendingHyphenFrom + (h.x - halfWidth)) / 2;
        out += `<text x="${fmt(hx)}" y="${fmt(baseline)}" font-size="${lyricSize}" text-anchor="middle" fill="#222">-</text>`;
        pendingHyphenFrom = null;
      }
      out += `<text x="${fmt(h.x)}" y="${fmt(baseline)}" font-size="${lyricSize}" text-anchor="middle" fill="#222">${escapeXml(syl.text)}</text>`;
      lastEnd = h.x + halfWidth;
      if (syl.hyphenToNext) pendingHyphenFrom = lastEnd;
    }
    if (pendingHyphenFrom !== null) {
      out += `<text x="${fmt(pendingHyphenFrom + 6)}" y="${fmt(baseline)}" font-size="${lyricSize}" text-anchor="middle" fill="#222">-</text>`;
    }
  }
  return out;
}
