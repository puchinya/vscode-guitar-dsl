import { DEFAULT_MEASURES_PER_ROW, MeasureData, ParsedScore, expandMeasureRepeat } from '../compiler';
import { ZERO, fadd, fnum, partBeats } from '../duration';
import { beamGroupIndex, structuralChange } from '../scoreEvents';
import { AnnotationLane, laneLayout, rowAnnotations } from './annotations';
import { DIAGRAM_FINGER_UNIT_HEIGHT, DIAGRAM_UNIT_HEIGHT, DIAGRAM_UNIT_WIDTH, hasFingers } from './chordDiagram';
import { ResolvedChordDiagram, resolveScoreDiagrams } from './chordLibrary';
import { keyAlter, writtenStaffPosition } from './notation';

// All layout coordinates are in PDF points (1pt = 1/72 inch).
// A sheet SVG uses a viewBox equal to its paper size in pt, so the same SVG maps 1:1 onto a PDF page.

export type PageSize = 'A4' | 'A3' | 'A5' | 'B4' | 'B5' | 'Letter';
export type PageOrientation = 'portrait' | 'landscape';

export const PAGE_CONFIG: Record<PageSize, { widthMm: number; heightMm: number; name: string }> = {
  A4: { widthMm: 210, heightMm: 297, name: 'A4' },
  A3: { widthMm: 297, heightMm: 420, name: 'A3' },
  A5: { widthMm: 148, heightMm: 210, name: 'A5' },
  B4: { widthMm: 250, heightMm: 353, name: 'B4' },
  B5: { widthMm: 176, heightMm: 250, name: 'B5' },
  Letter: { widthMm: 215.9, heightMm: 279.4, name: 'Letter' }
};

export const PT_PER_MM = 72 / 25.4;

export function isPageSize(value: unknown): value is PageSize {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(PAGE_CONFIG, value);
}

export function isPageOrientation(value: unknown): value is PageOrientation {
  return value === 'portrait' || value === 'landscape';
}

// Sheet margins and landscape gutter
export const MARGIN_TOP = 10 * PT_PER_MM;
export const MARGIN_BOTTOM = 10 * PT_PER_MM;
export const MARGIN_SIDE = 12 * PT_PER_MM;
export const COLUMN_GUTTER = 12 * PT_PER_MM;

// A system (one row of measures) is drawn in its own unit space and scaled to the column width.
export const MEASURES_PER_ROW = DEFAULT_MEASURES_PER_ROW;
export const SYSTEM_UNIT_WIDTH = 780;
export const SYSTEM_UNIT_HEIGHT = 140;
export const SYSTEM_UNIT_GAP = 8;

// Melody staff geometry (system unit coordinates). The melody staff sits where the rhythm staff
// sits in a rhythm-only system (lines y = 70..102); the rhythm staff of a melody system is drawn
// below the lyrics by translating the rhythm drawing down by `rhythmOffset`.
export const MELODY_STAVE_TOP = 70;
export const MELODY_STAVE_BOTTOM = MELODY_STAVE_TOP + 32;
const MELODY_LYRIC_FIRST_BASELINE_GAP = 26; // below the bottom staff line (leaves room for 2 ledger lines)
const MELODY_BLOCK_BOTTOM_PADDING = 8;
const MELODY_NO_LYRIC_BOTTOM = MELODY_STAVE_BOTTOM + 22;
// The rhythm drawing starts at its accent row (y = 38) and ends at the system height (140).
const RHYTHM_BLOCK_TOP = 36;
const LEAD_SHEET_BOTTOM_PADDING = 6;
// Upper limit of the melody technique marks (melodyStaff.ts MARK_CEILING).
const MELODY_MARK_CEILING = 42;

export type SystemKind = 'rhythm' | 'melody' | 'leadSheet';

export interface SystemGeometry {
  kind: SystemKind;
  /** Total height including the annotation lanes above and the dynamics lane below. */
  unitHeight: number;
  verseCount: number;
  /** Baseline of verse 1 of the syllable lyrics (melody systems). */
  lyricBaseline: number;
  lyricLineHeight: number;
  /** Vertical translation of the rhythm drawing (melody systems with the rhythm staff). */
  rhythmOffset: number;
  /** Height of the annotation lanes; the notation content is drawn translated down by this. */
  annotationTop: number;
  /** Top y of each present lane (system units, 0 = system top). */
  lanes: Map<AnnotationLane, number>;
  /** Height the dynamics add below the content (0 when they fit in the space under the lowest staff). */
  annotationBottom: number;
  /** Baseline of the dynamics (system units, 0 = system top); 0 when the row has no dynamics. */
  dynamicsBaseline: number;
  /** Height of the notation content (unitHeight without the lanes). */
  contentHeight: number;
  /**
   * How far the header of a melody staff (section label, chord names, volta bracket, special mark)
   * is moved down towards the staff; the content is drawn this much higher (0 for rhythm systems).
   */
  lift: number;
}

type GeometryScore = Pick<ParsedScore, 'showRhythm' | 'style'> & Partial<Pick<ParsedScore, 'measures' | 'feel'>>;

// Dynamics sit this far below the lowest ink of the content (baseline), like engraved dynamics under a staff.
const DYNAMICS_BASELINE_GAP = 15;
const DYNAMICS_DESCENT = 4;
// Space kept between the dynamics and the next system.
const DYNAMICS_CLEARANCE = 6;
// Chord names are drawn on this baseline (notation.ts renderChordName).
const CHORD_BASELINE = 33;
// Space kept between the lowest annotation lane and the ink below it.
const LANE_CLEARANCE = 8;
const MAX_LANE_OVERLAP = 14;

/** Content layout facts that decide how close the annotation lanes may come. */
interface ContentInk {
  /** Lowest ink of the content (content units), below which the dynamics go. */
  bottom: number;
  /** Highest ink of the lifted content (content units minus `lift`) the top lanes must stay above. */
  top: number;
}

/**
 * Lowest ink of a rhythm staff (lines y = 70..102): measure lyrics, inline notes below the staff,
 * their articulations and the connection arcs that hang below them (svg.ts).
 */
function rhythmStaffInkBottom(measures: MeasureData[]): number {
  let bottom = MELODY_STAVE_BOTTOM;
  const hasArcs = measures.some(m => m.rhythms.some(r => r.pitch && (r.techniques?.connection || r.techniques?.slurStart || r.techniques?.slurEnd)));
  for (const m of measures) {
    if (!m.melody && m.lyric) bottom = Math.max(bottom, MELODY_STAVE_BOTTOM + 22);
    for (const r of m.rhythms) {
      if (!r.pitch || r.isRest) continue;
      const y = MELODY_STAVE_BOTTOM - writtenStaffPosition(r.pitch, m.context?.ottava ?? 'none') * 4;
      let b = y + 5;
      if (r.techniques?.staccato || r.techniques?.tenuto) b = y + 16;
      if (hasArcs) b = Math.max(b, y + 34);
      bottom = Math.max(bottom, b);
    }
  }
  return bottom;
}

/**
 * Highest ink of the top of the content: section labels, volta brackets and special marks use
 * y = 2..27, chord names sit on y = 33, high notes (and their bends) may rise above them.
 * `melodyTop` is the melody staff ink (melody systems); rhythm systems pass Infinity and their inline notes count.
 */
function contentInkTop(measures: MeasureData[], score: GeometryScore, melodyTop: number): number {
  if (measures.some(m => m.sectionName || m.bracket || m.specialMark)) return 0;
  const chordSize = score.style.chordSize ?? 15;
  const hasLabel = measures.some(m => m.chords.some(c => c.label));
  let top = CHORD_BASELINE - chordSize * 0.8 - (hasLabel ? 4 : 0);
  if (Number.isFinite(melodyTop)) return Math.min(top, melodyTop);
  for (const m of measures) {
    for (const r of m.rhythms) {
      if (!r.pitch || r.isRest) continue;
      const y = MELODY_STAVE_BOTTOM - writtenStaffPosition(r.pitch, m.context?.ottava ?? 'none') * 4;
      top = Math.min(top, y - 5);
    }
  }
  return Math.min(top, melodyTop);
}

// Melody staff placement rules mirrored for the header lift (melodyStaff.ts / technique.ts / notation.ts).
const MELODY_STEM_LENGTH = 26;
const MELODY_MID_Y = MELODY_STAVE_TOP + 16;
// Ink of an empty melody staff below the header: staff top, key signature, clef and short stems.
const MELODY_DEFAULT_INK_TOP = 62;
// Space kept between the lowest header item (chord names) and the melody ink below it.
const HEADER_CLEARANCE = 8;

/**
 * Highest ink of a melody staff below its header (content units), estimated from the placement rules of
 * the melody renderer with a small safety margin: noteheads and accidentals, stems and beams, tuplet
 * numbers, ties, H/P and slur arcs, staccato / tenuto, fermata, vibrato, bend, breath and grace notes.
 */
function melodyInkTop(measures: MeasureData[]): number {
  type Note = NonNullable<MeasureData['melody']>[number];
  interface InkHead { n: Note; y: number; base: number; stemUp: boolean; stemEnd: number; accidental: boolean }
  let top = MELODY_DEFAULT_INK_TOP;
  const seq: InkHead[] = [];
  for (const m of measures) {
    const ottava = m.context?.ottava ?? 'none';
    const ts = m.context?.timeSignature;
    // Beam groups of this measure: eighth-or-shorter heads sharing a beat group; stems up when their mean position is below the middle line.
    const beams = new Map<number, { pos: number; y: number }[]>();
    const heads: { n: Note; pos: number; y: number; base: number; group?: number; accidental: boolean }[] = [];
    // Accidental state of the measure, as in melodyStaff.ts: drawn when the alteration differs from the key / earlier notes.
    const state = new Map<string, number>();
    const keySignature = m.context?.keySignature ?? 0;
    let offset = ZERO;
    for (const n of m.melody ?? []) {
      const pos = n.pitch ? writtenStaffPosition(n.pitch, ottava) : 4;
      const y = n.isRest ? MELODY_MID_Y : MELODY_STAVE_BOTTOM - pos * 4;
      if (n.techniques?.grace) {
        top = Math.min(top, y - 18);
        continue;
      }
      n.parts.forEach((part, i) => {
        const group = ts && !n.isRest && part.base >= 8 ? beamGroupIndex(ts, fnum(offset)) : undefined;
        if (group !== undefined) {
          if (!beams.has(group)) beams.set(group, []);
          beams.get(group)!.push({ pos, y });
        }
        if (i === 0) {
          let accidental = false;
          if (n.pitch && !n.isRest) {
            const k = `${n.pitch.step}${n.pitch.octave}`;
            const expected = state.has(k) ? state.get(k)! : keyAlter(keySignature, n.pitch.step);
            accidental = !n.tiedFromPrev && n.pitch.alter !== expected;
            state.set(k, n.pitch.alter);
          }
          heads.push({ n, pos, y, base: part.base, group, accidental });
        }
        offset = fadd(offset, partBeats(part));
      });
    }
    for (const h of heads) {
      const beam = h.group !== undefined ? beams.get(h.group) : undefined;
      const beamed = beam !== undefined && beam.length >= 2;
      const stemUp = beamed ? beam.reduce((a, b) => a + b.pos, 0) / beam.length < 4 : h.pos < 4;
      let stemEnd = h.y;
      if (!h.n.isRest && h.base >= 2 && stemUp) {
        stemEnd = beamed ? Math.min(...beam.map(b => b.y)) - MELODY_STEM_LENGTH - 2 : h.y - MELODY_STEM_LENGTH - (h.base >= 16 ? 4 : 0) - 2;
      }
      seq.push({ n: h.n, y: h.y, base: h.base, stemUp, stemEnd, accidental: h.accidental });
    }
  }

  const sounding = seq.filter(h => !h.n.isRest);
  sounding.forEach((h, i) => {
    const tech = h.n.techniques;
    // Arcs go above only when the source note has its stem down (melodyStaff.ts renderConnections).
    if (!h.stemUp && (tech?.connection === 'hammer' || tech?.connection === 'pull')) {
      const to = sounding[i + 1];
      top = Math.min(top, Math.min(h.y, to?.y ?? h.y) - 32);
    }
    if (!h.stemUp && tech?.slurStart) {
      const end = sounding.slice(i + 1).find(o => o.n.techniques?.slurEnd);
      top = Math.min(top, Math.min(h.y, end?.y ?? h.y) - 17);
    }
  });

  for (const h of seq) {
    const { n, y, stemUp, stemEnd } = h;
    const tech = n.techniques;
    if (!n.isRest) {
      top = Math.min(top, y - (h.accidental ? 12 : 5), stemEnd);
      if (!stemUp) {
        if (n.tieToNext || n.tiedFromPrev) top = Math.min(top, y - 12);
        if (tech?.staccato || tech?.tenuto) top = Math.min(top, y - 14);
      }
    }
    if (n.parts.some(p => p.tuplet)) top = Math.min(top, Math.min(y, stemEnd) - 10);
    if (!tech) continue;
    const noteTop = !n.isRest && h.base >= 2 && stemUp ? Math.min(y - 5, stemEnd) : y - 5;
    const aboveY = Math.max(MELODY_MARK_CEILING + 8, Math.min(MELODY_STAVE_TOP - 4, noteTop - 4));
    if (tech.fermata) top = Math.min(top, aboveY - 7);
    if (tech.vibrato) top = Math.min(top, Math.max(MELODY_MARK_CEILING, aboveY - (tech.fermata ? 10 : 2)) - 3);
    if (tech.breath) top = Math.min(top, MELODY_STAVE_TOP - 10);
    if (tech.bend && !n.isRest) top = Math.min(top, Math.min(Math.max(MELODY_MARK_CEILING + 4, y - 22), y - 10) - 9);
  }
  return top;
}

/** Header lift of a melody staff: the chord names come down to `HEADER_CLEARANCE` above the melody ink. */
function headerLift(inkTop: number, score: GeometryScore): number {
  const headerBottom = CHORD_BASELINE + (score.style.chordSize ?? 15) * 0.25;
  return Math.max(0, Math.floor(inkTop - HEADER_CLEARANCE - headerBottom));
}

/**
 * Adds the annotation lanes of the row to a content-only geometry. The top lanes may overlap the
 * free space above the chord names; the dynamics use the free space under the lowest staff and
 * only extend the system when that space is too small.
 */
function withLanes(measures: MeasureData[], score: GeometryScore, base: Omit<SystemGeometry, 'annotationTop' | 'lanes' | 'annotationBottom' | 'dynamicsBaseline' | 'contentHeight' | 'lift'>, ink: ContentInk, lift = 0): SystemGeometry {
  const annotations = rowAnnotations(measures, { measures: score.measures ?? [], feel: score.feel }, base.kind === 'rhythm', base.kind !== 'leadSheet');
  const { positions, height } = laneLayout(annotations.lanes);
  const overlap = Math.max(0, Math.min(height, MAX_LANE_OVERLAP, Math.floor(ink.top - LANE_CLEARANCE)));
  const annotationTop = height - overlap;
  let bottom = 0;
  let dynamicsBaseline = 0;
  if (annotations.dynamics.length > 0) {
    const baseline = ink.bottom + DYNAMICS_BASELINE_GAP;
    bottom = Math.max(0, baseline + DYNAMICS_DESCENT + DYNAMICS_CLEARANCE - base.unitHeight);
    dynamicsBaseline = annotationTop - lift + baseline;
  }
  const contentHeight = base.unitHeight - lift;
  return {
    ...base,
    unitHeight: contentHeight + annotationTop + bottom,
    annotationTop,
    lanes: positions,
    annotationBottom: bottom,
    dynamicsBaseline,
    contentHeight,
    lift
  };
}

export function lyricLineHeight(lyricSize: number): number {
  return Math.round(lyricSize * 1.5 * 100) / 100;
}

/**
 * Height and vertical layout of one system; rhythm-only systems keep the original 140 unit content height.
 * Annotation lanes (score events, technique spans) add to the height (spec §11).
 */
export function getSystemGeometry(measures: MeasureData[], score: GeometryScore): SystemGeometry {
  const hasMelody = measures.some(m => m.melody !== undefined);
  const lyricSize = score.style.lyricSize ?? 10;
  const lineHeight = lyricLineHeight(lyricSize);
  if (!hasMelody) {
    return withLanes(measures, score, { kind: 'rhythm', unitHeight: SYSTEM_UNIT_HEIGHT, verseCount: 0, lyricBaseline: 0, lyricLineHeight: lineHeight, rhythmOffset: 0 },
      { bottom: rhythmStaffInkBottom(measures), top: contentInkTop(measures, score, Infinity) });
  }
  let verseCount = 0;
  for (const m of measures) {
    for (const n of m.melody ?? []) {
      verseCount = Math.max(verseCount, n.syllables.length);
    }
  }
  const leadSheet = !score.showRhythm;
  // Lead sheets draw the measure lyric (l:"...") of melody-less measures on the first lyric line.
  if (leadSheet && verseCount === 0 && measures.some(m => !m.melody && m.lyric)) {
    verseCount = 1;
  }
  // Dynamically compute the lowest visual point among all melody notes in this system (low noteheads, stems, ties, ledger lines)
  let maxMelodyBottom = MELODY_STAVE_BOTTOM; // bottom staff line (y = 102)
  for (const m of measures) {
    for (const n of m.melody ?? []) {
      if (!n.isRest && n.pitch) {
        const pos = writtenStaffPosition(n.pitch, m.context?.ottava ?? 'none');
        const y = MELODY_STAVE_BOTTOM - pos * 4;
        let bottom = y + 5; // notehead bottom
        if (pos <= 3) {
          // Stems up: tie / connection / slur arcs and articulations hang below the notehead
          const tech = n.techniques;
          if (n.tieToNext || n.tiedFromPrev || tech?.connection || tech?.slurStart || tech?.slurEnd) {
            bottom = Math.max(bottom, y + 18);
          }
          if (tech?.staccato || tech?.tenuto) {
            bottom = Math.max(bottom, y + 12);
          }
        } else {
          // Stems down: stem reaches downwards
          bottom = Math.max(bottom, y + 32);
        }
        if (pos <= -2) {
          bottom = Math.max(bottom, y + 6);
        }
        maxMelodyBottom = Math.max(maxMelodyBottom, bottom);
      }
    }
  }

  const minBaseline = maxMelodyBottom + lyricSize * 0.9 + 6;
  const lyricBaseline = Math.round(Math.max(MELODY_STAVE_BOTTOM + MELODY_LYRIC_FIRST_BASELINE_GAP, minBaseline) * 100) / 100;
  const melodyBottom = verseCount > 0
    ? lyricBaseline + (verseCount - 1) * lineHeight + MELODY_BLOCK_BOTTOM_PADDING
    : MELODY_NO_LYRIC_BOTTOM;
  // The header comes down towards the staff; lane and dynamics positions are then computed on the lifted content.
  const inkTop = melodyInkTop(measures);
  const lift = headerLift(inkTop, score);
  const top = contentInkTop(measures, score, inkTop - lift);
  if (leadSheet) {
    const inkBottom = verseCount > 0 ? lyricBaseline + (verseCount - 1) * lineHeight + 3 : maxMelodyBottom;
    return withLanes(measures, score, { kind: 'leadSheet', unitHeight: melodyBottom + LEAD_SHEET_BOTTOM_PADDING, verseCount, lyricBaseline, lyricLineHeight: lineHeight, rhythmOffset: 0 },
      { bottom: inkBottom, top }, lift);
  }
  const rhythmOffset = melodyBottom - RHYTHM_BLOCK_TOP;
  return withLanes(measures, score, { kind: 'melody', unitHeight: SYSTEM_UNIT_HEIGHT + rhythmOffset, verseCount, lyricBaseline, lyricLineHeight: lineHeight, rhythmOffset },
    { bottom: rhythmOffset + rhythmStaffInkBottom(measures), top }, lift);
}

// Header / running header / footer metrics (pt)
export const DEFAULT_TITLE_SIZE = 20;
export const META_FONT_SIZE = 9;
export const RUNNING_HEADER_HEIGHT = 24;
export const FOOTER_HEIGHT = 18;
export const BLOCK_SPACING = 10;

// Chord diagram grid (pt)
export const DIAGRAM_SCALE = 0.6; // scale of the diagram unit box (chordDiagram.ts)
export const DIAGRAM_CELL_WIDTH = DIAGRAM_UNIT_WIDTH * DIAGRAM_SCALE;
export const DIAGRAM_NAME_HEIGHT = 11;
/** Row for `@label` captions; reserved only when a diagram in the grid has a label. */
export const DIAGRAM_LABEL_HEIGHT = 7;
export const DIAGRAM_GAP_X = 8;
export const DIAGRAM_GAP_Y = 6;

// Continuous (web) mode separator height
export const PAGE_BREAK_SEPARATOR_HEIGHT = 28;

export interface SystemRow {
  measures: MeasureData[];
  isFirstSystem: boolean;
  geometry: SystemGeometry;
}

export interface LayoutPage {
  pageNumber: number;
  hasScoreHeader: boolean;
  rows: SystemRow[];
}

export interface Sheet {
  pages: LayoutPage[]; // 1 page (portrait) or up to 2 pages (landscape)
}

export interface HeaderMetrics {
  titleSize: number;
  titleBaseline: number;
  metaBaseline: number;
  ruleY: number;
  height: number;
}

export interface DiagramGrid {
  perRow: number;
  rows: number;
  height: number;
  cellHeight: number;
  /** Height of the name area above each diagram body (name + optional label row). */
  headHeight: number;
}

export interface ScoreLayout {
  pageSize: PageSize;
  orientation: PageOrientation;
  sheetWidth: number;
  sheetHeight: number;
  columnWidth: number;
  columnHeight: number;
  systemScale: number;
  systemHeight: number;
  systemGap: number;
  header: HeaderMetrics;
  diagrams: DiagramGrid;
  pages: LayoutPage[];
  sheets: Sheet[];
}

export function getSheetSize(pageSize: PageSize, orientation: PageOrientation): { width: number; height: number } {
  const cfg = PAGE_CONFIG[pageSize];
  const w = cfg.widthMm * PT_PER_MM;
  const h = cfg.heightMm * PT_PER_MM;
  return orientation === 'landscape' ? { width: h, height: w } : { width: w, height: h };
}

export function getHeaderMetrics(titleSize: number): HeaderMetrics {
  const titleBaseline = titleSize * 0.95;
  const metaBaseline = titleBaseline + META_FONT_SIZE + 5;
  const ruleY = metaBaseline + 6;
  return { titleSize, titleBaseline, metaBaseline, ruleY, height: ruleY + BLOCK_SPACING };
}

export function getDiagramGrid(diagrams: ResolvedChordDiagram[], width: number): DiagramGrid {
  if (diagrams.length === 0) {
    return { perRow: 0, rows: 0, height: 0, cellHeight: 0, headHeight: 0 };
  }
  const headHeight = DIAGRAM_NAME_HEIGHT + (diagrams.some(d => d.label) ? DIAGRAM_LABEL_HEIGHT : 0);
  const bodyUnits = DIAGRAM_UNIT_HEIGHT + (diagrams.some(d => hasFingers(d.voicing)) ? DIAGRAM_FINGER_UNIT_HEIGHT : 0);
  const cellHeight = headHeight + bodyUnits * DIAGRAM_SCALE;
  const perRow = Math.max(1, Math.floor((width + DIAGRAM_GAP_X) / (DIAGRAM_CELL_WIDTH + DIAGRAM_GAP_X)));
  const rows = Math.ceil(diagrams.length / perRow);
  const gridHeight = rows * cellHeight + (rows - 1) * DIAGRAM_GAP_Y;
  // grid + space + separator rule + space
  return { perRow, rows, height: gridHeight + 6 + BLOCK_SPACING, cellHeight, headHeight };
}

/**
 * Splits each manual page into system rows: at most `measuresPerRow` measures (default 4), and a new row
 * before every measure with a structural change (a changed `@key` / `@time`, spec §11). A structural
 * break is not a page break; pagination may still move the row to the next page.
 */
export function splitIntoRows(score: ParsedScore): SystemRow[][] {
  const perRow = score.measuresPerRow || MEASURES_PER_ROW;
  return score.pages.map((page, pIdx) => {
    const groups: MeasureData[][] = [];
    let current: MeasureData[] = [];
    for (const m of page.measures) {
      const prev = m.measureIndex > 0 ? score.measures[m.measureIndex - 1]?.context : undefined;
      const change = m.context ? structuralChange(prev, m) : { key: false, time: false };
      if (current.length > 0 && (current.length >= perRow || change.key || change.time)) {
        groups.push(current);
        current = [];
      }
      current.push(m);
    }
    if (current.length > 0) groups.push(current);
    return groups.map((measures, i) => ({
      measures,
      isFirstSystem: pIdx === 0 && i === 0,
      geometry: getSystemGeometry(measures, score)
    }));
  });
}

/**
 * Paginates the score into fixed-size pages.
 * Each manual page (pagebreak) starts a new page; rows that do not fit in the remaining
 * height are carried over to a continuation page. A page always accepts at least one row
 * so that an oversize row can never cause an infinite loop.
 */
export function layoutScore(score: ParsedScore, pageSize: PageSize, orientation: PageOrientation): ScoreLayout {
  const { width: sheetWidth, height: sheetHeight } = getSheetSize(pageSize, orientation);
  const columns = orientation === 'landscape' ? 2 : 1;
  const columnWidth = (sheetWidth - 2 * MARGIN_SIDE - (columns - 1) * COLUMN_GUTTER) / columns;
  const columnHeight = sheetHeight - MARGIN_TOP - MARGIN_BOTTOM;

  const systemScale = columnWidth / SYSTEM_UNIT_WIDTH;
  const systemHeight = SYSTEM_UNIT_HEIGHT * systemScale;
  const systemGap = SYSTEM_UNIT_GAP * systemScale;

  const header = getHeaderMetrics(score.style.titleSize ?? DEFAULT_TITLE_SIZE);
  const diagrams = getDiagramGrid(resolveScoreDiagrams(score), columnWidth);

  const pages: LayoutPage[] = [];
  let current: LayoutPage | null = null;
  let remaining = 0;

  const openPage = () => {
    const hasScoreHeader = pages.length === 0;
    current = { pageNumber: pages.length + 1, hasScoreHeader, rows: [] };
    pages.push(current);
    const top = hasScoreHeader ? header.height + diagrams.height : RUNNING_HEADER_HEIGHT;
    remaining = columnHeight - top - FOOTER_HEIGHT;
  };

  for (const manualRows of splitIntoRows(score)) {
    openPage();
    for (let rIdx = 0; rIdx < manualRows.length; rIdx++) {
      let row = manualRows[rIdx];
      const rowHeight = row.geometry.unitHeight * systemScale;
      if (current!.rows.length > 0 && remaining < rowHeight) {
        openPage();
      }
      if (current!.rows.length === 0 && pages.length > 1 && score.expandPageBreakRepeats !== false) {
        if (row.measures.length > 0 && row.measures[0].isMeasureRepeat) {
          row = {
            ...row,
            measures: [
              expandMeasureRepeat(row.measures[0], score.measures),
              ...row.measures.slice(1)
            ]
          };
          row.geometry = getSystemGeometry(row.measures, score);
        }
      }
      current!.rows.push(row);
      const actualHeight = row.geometry.unitHeight * systemScale;
      remaining -= actualHeight + systemGap;
    }
  }
  if (pages.length === 0) {
    openPage();
  }

  const sheets: Sheet[] = [];
  for (let i = 0; i < pages.length; i += columns) {
    sheets.push({ pages: pages.slice(i, i + columns) });
  }

  return {
    pageSize,
    orientation,
    sheetWidth,
    sheetHeight,
    columnWidth,
    columnHeight,
    systemScale,
    systemHeight,
    systemGap,
    header,
    diagrams,
    pages,
    sheets
  };
}

// Advance widths (1/1000 em) of ASCII 0x20-0x7E in the bundled Noto Sans JP.
const ASCII_ADVANCE_REGULAR = [224,323,474,555,555,921,680,278,338,338,467,555,278,347,278,392,555,555,555,555,555,555,555,555,555,555,278,278,555,555,555,474,946,608,657,638,688,589,552,689,728,293,535,646,543,812,723,742,633,742,635,596,599,721,575,878,573,531,603,338,392,338,555,559,606,563,618,510,620,554,325,564,607,275,275,552,284,926,610,606,620,620,388,468,377,607,521,802,498,521,475,338,270,338,555];
const ASCII_ADVANCE_BOLD = [227,370,574,590,590,963,740,325,378,378,507,590,325,370,325,387,590,590,590,590,590,590,590,590,590,590,325,325,590,590,590,514,1007,641,681,656,714,615,585,717,757,330,568,686,578,853,749,770,667,770,682,624,625,748,619,915,627,580,613,378,387,378,590,567,626,591,644,527,644,581,372,597,640,304,306,604,315,964,641,626,644,644,437,495,421,637,576,863,562,574,511,378,296,378,590];

/** Text advance estimation for the bundled font (no DOM available in the extension host). */
export function estimateTextWidth(text: string, fontSize: number, bold = false): number {
  const table = bold ? ASCII_ADVANCE_BOLD : ASCII_ADVANCE_REGULAR;
  let units = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (code >= 0x20 && code <= 0x7e) {
      units += table[code - 0x20];
    } else if (code >= 0xff61 && code <= 0xff9f) {
      units += 500; // half-width katakana
    } else {
      units += 1000; // CJK / full-width / other symbols
    }
  }
  return units / 1000 * fontSize;
}
