import { DEFAULT_MEASURES_PER_ROW, MeasureData, ParsedScore, expandMeasureRepeat } from '../compiler';
import { structuralChange } from '../scoreEvents';
import { AnnotationLane, DYNAMICS_LANE_HEIGHT, laneLayout, rowAnnotations } from './annotations';
import { DIAGRAM_FINGER_UNIT_HEIGHT, DIAGRAM_UNIT_HEIGHT, DIAGRAM_UNIT_WIDTH, hasFingers } from './chordDiagram';
import { ResolvedChordDiagram, resolveScoreDiagrams } from './chordLibrary';
import { writtenStaffPosition } from './notation';

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
  /** Height of the dynamics lane below the content (0 when the row has no dynamics). */
  annotationBottom: number;
  /** Height of the notation content (unitHeight without the lanes). */
  contentHeight: number;
}

type GeometryScore = Pick<ParsedScore, 'showRhythm' | 'style'> & Partial<Pick<ParsedScore, 'measures' | 'feel'>>;

/** Adds the annotation lanes of the row to a content-only geometry. */
function withLanes(measures: MeasureData[], score: GeometryScore, base: Omit<SystemGeometry, 'annotationTop' | 'lanes' | 'annotationBottom' | 'contentHeight'>): SystemGeometry {
  const annotations = rowAnnotations(measures, { measures: score.measures ?? [], feel: score.feel }, base.kind === 'rhythm', base.kind !== 'leadSheet');
  const { positions, height } = laneLayout(annotations.lanes);
  const bottom = annotations.dynamics.length > 0 ? DYNAMICS_LANE_HEIGHT : 0;
  return {
    ...base,
    unitHeight: base.unitHeight + height + bottom,
    annotationTop: height,
    lanes: positions,
    annotationBottom: bottom,
    contentHeight: base.unitHeight
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
    return withLanes(measures, score, { kind: 'rhythm', unitHeight: SYSTEM_UNIT_HEIGHT, verseCount: 0, lyricBaseline: 0, lyricLineHeight: lineHeight, rhythmOffset: 0 });
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
  if (leadSheet) {
    return withLanes(measures, score, { kind: 'leadSheet', unitHeight: melodyBottom + LEAD_SHEET_BOTTOM_PADDING, verseCount, lyricBaseline, lyricLineHeight: lineHeight, rhythmOffset: 0 });
  }
  const rhythmOffset = melodyBottom - RHYTHM_BLOCK_TOP;
  return withLanes(measures, score, { kind: 'melody', unitHeight: SYSTEM_UNIT_HEIGHT + rhythmOffset, verseCount, lyricBaseline, lyricLineHeight: lineHeight, rhythmOffset });
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
