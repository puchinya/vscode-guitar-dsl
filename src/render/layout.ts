import { MeasureData, ParsedScore } from '../compiler';

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
export const MEASURES_PER_ROW = 4;
export const SYSTEM_UNIT_WIDTH = 780;
export const SYSTEM_UNIT_HEIGHT = 140;
export const SYSTEM_UNIT_GAP = 8;

// Header / running header / footer metrics (pt)
export const DEFAULT_TITLE_SIZE = 20;
export const META_FONT_SIZE = 9;
export const RUNNING_HEADER_HEIGHT = 24;
export const FOOTER_HEIGHT = 18;
export const BLOCK_SPACING = 10;

// Chord diagram grid (pt)
export const DIAGRAM_SCALE = 0.6; // diagram unit box is 50 x 58
export const DIAGRAM_CELL_WIDTH = 50 * DIAGRAM_SCALE;
export const DIAGRAM_NAME_HEIGHT = 11;
export const DIAGRAM_CELL_HEIGHT = DIAGRAM_NAME_HEIGHT + 58 * DIAGRAM_SCALE;
export const DIAGRAM_GAP_X = 8;
export const DIAGRAM_GAP_Y = 6;

// Continuous (web) mode separator height
export const PAGE_BREAK_SEPARATOR_HEIGHT = 28;

export interface SystemRow {
  measures: MeasureData[];
  isFirstSystem: boolean;
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

export function getDiagramGrid(count: number, width: number): DiagramGrid {
  if (count === 0) {
    return { perRow: 0, rows: 0, height: 0 };
  }
  const perRow = Math.max(1, Math.floor((width + DIAGRAM_GAP_X) / (DIAGRAM_CELL_WIDTH + DIAGRAM_GAP_X)));
  const rows = Math.ceil(count / perRow);
  const gridHeight = rows * DIAGRAM_CELL_HEIGHT + (rows - 1) * DIAGRAM_GAP_Y;
  // grid + space + separator rule + space
  return { perRow, rows, height: gridHeight + 6 + BLOCK_SPACING };
}

/** Splits each manual page into system rows (4 measures per row). */
export function splitIntoRows(score: ParsedScore): SystemRow[][] {
  return score.pages.map((page, pIdx) => {
    const rows: SystemRow[] = [];
    for (let i = 0; i < page.measures.length; i += MEASURES_PER_ROW) {
      rows.push({
        measures: page.measures.slice(i, i + MEASURES_PER_ROW),
        isFirstSystem: pIdx === 0 && i === 0
      });
    }
    return rows;
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
  const diagrams = getDiagramGrid(score.usedChords.length, columnWidth);

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
    for (const row of manualRows) {
      if (current!.rows.length > 0 && remaining < systemHeight) {
        openPage();
      }
      current!.rows.push(row);
      remaining -= systemHeight + systemGap;
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
