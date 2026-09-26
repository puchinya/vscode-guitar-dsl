// Melody staff of a melody system: notes, key signature, accidentals, ties, tuplets, grace notes, techniques
// and syllable lyrics (docs/specs/guitardsl-syntax.md §12–§16). Drawn in system unit coordinates above the
// rhythm staff.

import { MeasureData } from '../compiler';
import { Fraction, NoteBase, NoteValuePart, ZERO, fadd, fnum, tupletGroups } from '../duration';
import { MelodyNote, isGrace } from '../melody';
import { beamGroupIndex } from '../scoreEvents';
import { RowSpanCollector, connectionLinks, isLetRing, isPalmMute } from './annotations';
import { MELODY_STAVE_BOTTOM, MELODY_STAVE_TOP, SystemGeometry, estimateTextWidth } from './layout';
import {
  FLAG_16_STEM_EXTENSION,
  FETA_TREBLE_CLEF_PATH,
  HEAD_RX,
  RenderContext,
  SystemPrefix,
  barBeats,
  chordXAt,
  computeMeasureColumns,
  escapeXml,
  expandParts,
  fmt,
  keyAlter,
  measureBounds,
  renderAccidental,
  renderChordName,
  renderFlags,
  renderNotehead,
  renderRestGlyph,
  renderSystemKeySignature,
  renderTieArc,
  renderTimeSignature,
  staffPosition,
  writtenStaffPosition
} from './notation';
import {
  renderBend,
  renderBreath,
  renderFermata,
  renderGliss,
  renderHammerPull,
  renderSlide,
  renderSlur,
  renderStaccato,
  renderTenuto,
  renderVibrato
} from './technique';

export { staffPosition };

const STAVE_LINES = [0, 8, 16, 24, 32].map(dy => MELODY_STAVE_TOP + dy);
const MID_Y = STAVE_LINES[2];
const STEM_LENGTH = 26;
/** Lowest y for marks above the staff (below the chord names, baseline 33). */
const MARK_CEILING = 42;
const GRACE_SCALE = 0.62;
const GRACE_SPACING = 9;

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
  beamGroup: string;
  keySignature: number;
}

export interface MelodyStaffOptions {
  isFirstSystem: boolean;
  geometry: SystemGeometry;
  /** Columns include the rhythm onsets (melody system) or only the melody (lead sheet). */
  includeRhythmColumns: boolean;
  prefix: SystemPrefix;
  spans: RowSpanCollector;
}

/** All melody notes of the score in order (for connections / slurs / spans across systems). */
const melodySequenceCache = new WeakMap<object, MelodyNote[]>();
function melodySequence(ctx: RenderContext): MelodyNote[] {
  let seq = melodySequenceCache.get(ctx.score);
  if (!seq) {
    seq = ctx.score.measures.flatMap(m => m.melody ?? []);
    melodySequenceCache.set(ctx.score, seq);
  }
  return seq;
}

export function renderMelodyStaff(measures: MeasureData[], ctx: RenderContext, opts: MelodyStaffOptions): string {
  const style = ctx.score.style;
  const chordSize = style.chordSize ?? 15;
  const sectionSize = style.sectionSize ?? 9.5;
  const lyricSize = style.lyricSize ?? 10;
  const leadSheet = opts.geometry.kind === 'leadSheet';

  let out = '';
  // Section label, chord names, volta brackets and special marks: moved down together by the header lift.
  let header = '';
  STAVE_LINES.forEach(y => {
    out += `<line x1="25" y1="${y}" x2="${ctx.totalWidth - 5}" y2="${y}" stroke="#000" stroke-width="1"/>`;
  });
  out += `<line x1="25" y1="${STAVE_LINES[0]}" x2="25" y2="${STAVE_LINES[4]}" stroke="#000" stroke-width="2"/>`;
  out += `<g transform="translate(28, 53.36) scale(1.6)"><path d="${FETA_TREBLE_CLEF_PATH}" fill="#000"/></g>`;
  out += renderSystemKeySignature(opts.prefix, MELODY_STAVE_BOTTOM);
  out += renderTimeSignature(opts.prefix, MELODY_STAVE_TOP);

  const heads: Head[] = [];
  const graces: { note: MelodyNote; x: number; y: number; pos: number; part: NoteValuePart }[] = [];

  measures.forEach((m, idx) => {
    const { bx, width } = measureBounds(ctx, measures.length, idx);
    const bEnd = bx + width;
    const columns = computeMeasureColumns(m, bx, width, opts.includeRhythmColumns);
    const ottava = m.context.ottava;
    const ts = m.context.timeSignature;

    out += renderBarline(m, bx, bEnd);

    if (m.sectionName) {
      header += `<rect x="${fmt(bx + 4)}" y="2" width="${fmt(m.sectionName.length * (sectionSize * 0.95) + 12)}" height="${fmt(sectionSize + 5)}" fill="#fff" stroke="#000" stroke-width="1.2"/>`;
      header += `<text x="${fmt(bx + 10)}" y="${fmt(sectionSize + 3.5)}" font-size="${sectionSize}" font-weight="bold">${escapeXml(m.sectionName)}</text>`;
    }

    const chords = m.chords.length > 0 ? m.chords : (m.chord ? [{ name: m.chord, beat: 0 }] : []);
    let lastChordRight = bx;
    chords.forEach((ch, chIdx) => {
      let chordX = bx + 8;
      if (chIdx > 0 || ch.beat > 0) chordX = chordXAt(columns, bx, width, ch.beat, barBeats(m));
      chordX = Math.max(lastChordRight + 6, chordX);
      const chordName = renderChordName(ch, chordX, chordSize);
      lastChordRight = chordX + chordName.width;
      header += chordName.svg;
    });

    // Volta Bracket ([1.], [2.], etc.)
    if (m.bracket) {
      const bracketY = 16;
      const hookH = 7;
      header += `<line x1="${fmt(bx)}" y1="${fmt(bracketY + hookH)}" x2="${fmt(bx)}" y2="${fmt(bracketY)}" stroke="#000" stroke-width="1.2"/>`;
      header += `<line x1="${fmt(bx)}" y1="${fmt(bracketY)}" x2="${fmt(bEnd)}" y2="${fmt(bracketY)}" stroke="#000" stroke-width="1.2"/>`;
      header += `<text x="${fmt(bx + 4)}" y="${fmt(bracketY + 9)}" font-size="9" font-weight="bold" fill="#000">${escapeXml(m.bracket)}</text>`;
      if (m.repeatEnd) {
        header += `<line x1="${fmt(bEnd)}" y1="${fmt(bracketY)}" x2="${fmt(bEnd)}" y2="${fmt(bracketY + hookH)}" stroke="#000" stroke-width="1.2"/>`;
      }
    }

    // Special Mark (Fine, D.C., D.S., Coda, Segno)
    if (m.specialMark) {
      const markY = 16;
      let markText = '';
      if (m.specialMark === 'fine') markText = 'Fine';
      else if (m.specialMark === 'dc') markText = 'D.C.';
      else if (m.specialMark === 'ds') markText = 'D.S.';
      else if (m.specialMark === 'coda') markText = '𝄌 Coda';
      else if (m.specialMark === 'to_coda') markText = 'to Coda';
      else if (m.specialMark === 'segno') markText = '𝄋 Segno';
      if (markText) {
        header += `<text x="${fmt(bEnd - 4)}" y="${fmt(markY)}" font-size="9.5" font-style="italic" font-weight="bold" text-anchor="end" fill="#000">${markText}</text>`;
      }
    }

    if (!m.melody) {
      if (leadSheet) {
        // Beat slashes on the melody staff for measures without melody (spec §14.2): one per beat unit
        // (4/4: four quarters), or one per beat group in an eighth / sixteenth meter.
        const count = ts.denominator >= 8 ? ts.groups.length : ts.numerator;
        for (let beat = 0; beat < count; beat++) {
          const x = bx + 14 + (beat + 0.5) * ((width - 28) / count);
          out += `<polygon points="${fmt(x - 5.5)},${MID_Y + 7} ${fmt(x)},${MID_Y + 7} ${fmt(x + 6.5)},${MID_Y - 7} ${fmt(x + 1)},${MID_Y - 7}" fill="#000"/>`;
        }
        if (m.lyric) {
          out += `<text x="${fmt(bx + width / 2)}" y="${fmt(opts.geometry.lyricBaseline)}" font-size="${lyricSize}" text-anchor="middle" fill="#222">${escapeXml(m.lyric)}</text>`;
        }
      }
      return;
    }

    let offset: Fraction = ZERO;
    const pendingGraces: MelodyNote[] = [];
    const placeGraces = (targetX: number) => {
      pendingGraces.forEach((g, k) => {
        const pos = g.pitch ? writtenStaffPosition(g.pitch, ottava) : 4;
        graces.push({ note: g, x: targetX - 12 - (pendingGraces.length - 1 - k) * GRACE_SPACING, y: yOf(pos), pos, part: g.parts[0] ?? { base: 8, dotted: false } });
      });
      pendingGraces.length = 0;
    };
    m.melody.forEach(note => {
      if (isGrace(note)) {
        pendingGraces.push(note);
        return;
      }
      const expanded = expandParts(note.parts, offset);
      expanded.forEach((h, i) => {
        const x = columns.xAt(h.offset) ?? bx + width / 2;
        // Grace notes lean on the next sounding note; a rest keeps them pending (spec §12.2.1).
        if (i === 0 && !note.isRest) placeGraces(x);
        const pos = note.pitch ? writtenStaffPosition(note.pitch, ottava) : 4;
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
          beamed: false,
          beamGroup: `${idx}:${beamGroupIndex(ts, fnum(h.offset))}`,
          keySignature: m.context.keySignature ?? 0
        });
        offset = fadd(h.offset, h.beats);
      });
    });
    // A trailing grace group without a timed note is drawn at the end of the measure (the parser warns).
    if (pendingGraces.length > 0) placeGraces(bEnd - 6);
  });

  // The header is drawn before the notes (as before), so notes stay on top of the section label box.
  const lift = opts.geometry.lift;
  out += lift > 0 ? `<g class="melody-header" transform="translate(0, ${fmt(lift)})">${header}</g>` : header;
  out += renderBeams(heads);
  out += renderHeads(heads);
  out += renderGraceNotes(graces);
  out += renderTies(heads, ctx);
  out += renderTuplets(heads);
  out += renderArticulations(heads);
  out += renderConnections(heads, graces, ctx);
  collectSpans(heads, measures, ctx, opts.spans);
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
  } else if (m.finalEnd) {
    out += `<line x1="${fmt(bEnd - 5)}" y1="${top}" x2="${fmt(bEnd - 5)}" y2="${bottom}" stroke="#000" stroke-width="1.2"/>`;
    out += `<line x1="${fmt(bEnd)}" y1="${top}" x2="${fmt(bEnd)}" y2="${bottom}" stroke="#000" stroke-width="3"/>`;
  } else if (m.doubleEnd) {
    out += `<line x1="${fmt(bEnd - 4)}" y1="${top}" x2="${fmt(bEnd - 4)}" y2="${bottom}" stroke="#000" stroke-width="1.2"/>`;
    out += `<line x1="${fmt(bEnd)}" y1="${top}" x2="${fmt(bEnd)}" y2="${bottom}" stroke="#000" stroke-width="1.2"/>`;
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

/** Beams 8th/16th notes within the same beat group of a measure; the stem direction follows the group average. */
function renderBeams(heads: Head[]): string {
  const groups = new Map<string, Head[]>();
  for (const h of heads) {
    if (h.note.isRest || h.part.base < 8) continue;
    if (!groups.has(h.beamGroup)) groups.set(h.beamGroup, []);
    groups.get(h.beamGroup)!.push(h);
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

function renderHeads(heads: Head[]): string {
  let out = '';
  // Accidental state per measure: "<step><octave>" -> alteration currently in effect. The key signature is
  // the measure's own (a modulation resets it at the barline).
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

    out += renderLedgerLines(h.x, h.pos);

    // Accidentals: only when the alteration differs from the key signature / earlier notes of the measure.
    if (h.isFirstPart) {
      const expected = state.has(k) ? state.get(k)! : keyAlter(h.keySignature, pitch.step);
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

function renderLedgerLines(x: number, pos: number, half = 8): string {
  let out = '';
  for (let p = -2; p >= pos; p -= 2) {
    out += `<line x1="${fmt(x - half)}" y1="${fmt(yOf(p))}" x2="${fmt(x + half)}" y2="${fmt(yOf(p))}" stroke="#000" stroke-width="1"/>`;
  }
  for (let p = 10; p <= pos; p += 2) {
    out += `<line x1="${fmt(x - half)}" y1="${fmt(yOf(p))}" x2="${fmt(x + half)}" y2="${fmt(yOf(p))}" stroke="#000" stroke-width="1"/>`;
  }
  return out;
}

/** Grace notes: scaled notehead, stem up, flag and accidental (no beat, spec §12.2.1). */
function renderGraceNotes(graces: { note: MelodyNote; x: number; y: number; pos: number; part: NoteValuePart }[]): string {
  let out = '';
  for (const g of graces) {
    if (!g.note.pitch) continue;
    out += renderLedgerLines(g.x, g.pos, 6);
    const stemTop = -STEM_LENGTH;
    let inner = renderNotehead(g.part.base, 0, 0)
      + `<line x1="${fmt(HEAD_RX - 0.4)}" y1="-1" x2="${fmt(HEAD_RX - 0.4)}" y2="${stemTop}" stroke="#000" stroke-width="1.5"/>`
      + renderFlags(Math.max(8, g.part.base) as NoteBase, HEAD_RX - 0.4, stemTop);
    if (g.note.pitch.alter !== 0) inner += renderAccidental(g.note.pitch.alter, -10, 0);
    out += `<g class="technique-grace" transform="translate(${fmt(g.x)}, ${fmt(g.y)}) scale(${GRACE_SCALE})">${inner}</g>`;
  }
  return out;
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

/** Tuplet brackets / numbers per measure (same ratio runs, spec §8.2.1); the number is the `actual` count. */
function renderTuplets(heads: Head[]): string {
  let out = '';
  const byMeasure = new Map<number, Head[]>();
  heads.forEach(h => {
    if (!byMeasure.has(h.measureIdx)) byMeasure.set(h.measureIdx, []);
    byMeasure.get(h.measureIdx)!.push(h);
  });
  byMeasure.forEach(list => {
    for (const { items: group } of tupletGroups(list)) {
      const x1 = group[0].x - 4;
      const x2 = group[group.length - 1].x + 4;
      const top = Math.min(...group.map(h => Math.min(h.y, h.part.base >= 2 && !h.note.isRest ? h.stemEndY : h.y))) - 6;
      const cx = (x1 + x2) / 2;
      const allBeamed = group.every(h => h.beamed);
      const label = String(group[0].part.tuplet!.actual);
      if (!allBeamed) {
        out += `<path d="M ${fmt(x1)},${fmt(top + 3)} L ${fmt(x1)},${fmt(top)} L ${fmt(cx - 5)},${fmt(top)} M ${fmt(cx + 5)},${fmt(top)} L ${fmt(x2)},${fmt(top)} L ${fmt(x2)},${fmt(top + 3)}" fill="none" stroke="#000" stroke-width="0.8"/>`;
      }
      out += `<text class="tuplet-number" x="${fmt(cx)}" y="${fmt(top + 3)}" font-size="8" font-style="italic" text-anchor="middle" fill="#000">${label}</text>`;
    }
  });
  return out;
}

/** Top of the drawn note (notehead or stem end) for marks placed above it. */
function noteTop(h: Head): number {
  return h.part.base >= 2 && h.stemUp ? Math.min(h.y - 5, h.stemEndY) : h.y - 5;
}

/** Articulations on the first head of each note (staccato, tenuto, fermata, breath, vibrato, bend). */
function renderArticulations(heads: Head[]): string {
  let out = '';
  for (const h of heads) {
    const tech = h.note.techniques;
    if (!tech || !h.isFirstPart) continue;
    if (!h.note.isRest) {
      // Staccato / tenuto on the notehead side opposite the stem.
      const artY = h.stemUp ? h.y + 8 : h.y - 8;
      if (tech.staccato) out += renderStaccato(h.x, tech.tenuto ? artY + (h.stemUp ? 4 : -4) : artY);
      if (tech.tenuto) out += renderTenuto(h.x, artY);
    }
    const aboveY = Math.max(MARK_CEILING + 8, Math.min(STAVE_LINES[0] - 4, noteTop(h) - 4));
    if (tech.fermata) {
      // No room between the chord names and a very high note: use the inverted fermata below it.
      const roomAbove = noteTop(h) - 4 >= MARK_CEILING + 8;
      out += roomAbove || h.note.isRest ? renderFermata(h.x, aboveY) : renderFermata(h.x, (h.stemUp ? h.y : Math.max(h.y, h.stemEndY)) + 8, true);
    }
    if (tech.vibrato) out += renderVibrato(h.x - 4, h.x + 14, Math.max(MARK_CEILING, aboveY - (tech.fermata ? 10 : 2)));
    if (tech.breath) out += renderBreath(h.x + 11, STAVE_LINES[0] - 9);
    if (tech.bend && !h.note.isRest) out += renderBend(h.x, h.y, Math.max(MARK_CEILING + 4, h.y - 22), tech.bend);
  }
  return out;
}

/**
 * Hammer-on / pull-off / slide / gliss and slurs. Links come from the whole melody so a connection crossing
 * a system is drawn as an outgoing piece (to the system end) and an incoming piece (from the system start).
 */
function renderConnections(heads: Head[], graces: { note: MelodyNote; x: number; y: number }[], ctx: RenderContext): string {
  const seq = melodySequence(ctx);
  const at = new Map<MelodyNote, { x: number; y: number; stemUp: boolean }>();
  for (const h of heads) {
    if (h.isFirstPart) at.set(h.note, { x: h.x, y: h.y, stemUp: h.stemUp });
  }
  for (const g of graces) at.set(g.note, { x: g.x, y: g.y, stemUp: true });
  const rowStart = ctx.startX - 4;
  const rowEnd = ctx.totalWidth - 8;
  let out = '';
  for (const link of connectionLinks(seq)) {
    const from = at.get(seq[link.from]);
    const to = at.get(seq[link.to]);
    if (!from && !to) continue;
    const below = (from ?? to)!.stemUp;
    const x1 = from ? from.x + 6 : rowStart;
    const x2 = to ? to.x - 6 : rowEnd;
    const y1 = from ? from.y : to!.y;
    const y2 = to ? to.y : from!.y;
    const arcY = below ? Math.max(y1, y2) + 6 : Math.min(y1, y2) - 6;
    if (link.kind === 'hammer' || link.kind === 'pull') out += renderHammerPull(link.kind, x1, x2, arcY, below);
    else if (link.kind === 'slur') out += renderSlur(x1, x2, arcY, below);
    else if (link.kind === 'slide') out += renderSlide(x1 + 1, y1, x2 - 1, y2);
    else out += renderGliss(x1 + 1, y1, x2 - 1, y2);
  }
  return out;
}

/** P.M. / let ring flags of the melody notes of this row, with the neighbouring notes outside the row. */
function collectSpans(heads: Head[], measures: MeasureData[], ctx: RenderContext, spans: RowSpanCollector): void {
  const entries = heads.filter(h => h.isFirstPart && !h.note.isRest).map(h => ({ x: h.x, palmMute: isPalmMute(h.note), letRing: isLetRing(h.note) }));
  if (entries.length === 0) return;
  const seq = melodySequence(ctx).filter(n => !n.isRest && !isGrace(n));
  const first = heads.find(h => !h.note.isRest)?.note;
  const last = [...heads].reverse().find(h => !h.note.isRest)?.note;
  const firstIdx = first ? seq.indexOf(first) : -1;
  const lastIdx = last ? seq.indexOf(last) : -1;
  const prev = firstIdx > 0 && !measures.some(m => m.melody?.includes(seq[firstIdx - 1])) ? seq[firstIdx - 1] : undefined;
  const next = lastIdx >= 0 && lastIdx + 1 < seq.length && !measures.some(m => m.melody?.includes(seq[lastIdx + 1])) ? seq[lastIdx + 1] : undefined;
  spans.staffs.push({
    entries,
    before: { palmMute: prev ? isPalmMute(prev) : false, letRing: prev ? isLetRing(prev) : false },
    after: { palmMute: next ? isPalmMute(next) : false, letRing: next ? isLetRing(next) : false }
  });
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
