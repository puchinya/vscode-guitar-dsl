import { MeasureData, ParsedScore, RhythmItem, ScoreStyle, parseDurationToBeats, parseGuitarDsl } from '../compiler';
import { getChordFrets } from './chordLibrary';
import {
  BLOCK_SPACING,
  DIAGRAM_CELL_WIDTH,
  DIAGRAM_GAP_X,
  DIAGRAM_GAP_Y,
  DIAGRAM_CELL_HEIGHT,
  DIAGRAM_NAME_HEIGHT,
  DIAGRAM_SCALE,
  DiagramGrid,
  FOOTER_HEIGHT,
  HeaderMetrics,
  LayoutPage,
  MARGIN_BOTTOM,
  MARGIN_SIDE,
  MARGIN_TOP,
  COLUMN_GUTTER,
  MEASURES_PER_ROW,
  META_FONT_SIZE,
  PAGE_BREAK_SEPARATOR_HEIGHT,
  PageOrientation,
  PageSize,
  RUNNING_HEADER_HEIGHT,
  SYSTEM_UNIT_GAP,
  SYSTEM_UNIT_HEIGHT,
  SYSTEM_UNIT_WIDTH,
  ScoreLayout,
  SystemRow,
  estimateTextWidth,
  getDiagramGrid,
  getHeaderMetrics,
  getSheetSize,
  layoutScore,
  splitIntoRows,
  DEFAULT_TITLE_SIZE
} from './layout';

// Bundled Noto Sans JP (media/fonts) is loaded under this name in the preview and embedded in PDFs.
export const SCORE_FONT_FAMILY = 'GuitarDSL Noto Sans JP';
export const FONT_FAMILY_SANS = "'GuitarDSL Noto Sans JP', 'Noto Sans JP', sans-serif";

const MIN_TITLE_SIZE = 8;

/** One SVG per physical sheet (1 page in portrait, 2 pages side by side in landscape). */
export function renderScoreSheets(score: ParsedScore, pageSize: PageSize, orientation: PageOrientation): string[] {
  const layout = layoutScore(score, pageSize, orientation);
  const totalPages = layout.pages.length;

  return layout.sheets.map(sheet => {
    let body = '';
    sheet.pages.forEach((page, col) => {
      const x = MARGIN_SIDE + col * (layout.columnWidth + COLUMN_GUTTER);
      body += `<g transform="translate(${fmt(x)}, ${fmt(MARGIN_TOP)})">${renderPage(score, layout, page, totalPages)}</g>\n`;
    });
    return wrapSvg(layout.sheetWidth, layout.sheetHeight, body, 'sheet-svg', `data-pages="${sheet.pages.map(p => p.pageNumber).join(',')}"`);
  });
}

/** Unpaginated score (continuous / web mode): header, diagrams and all systems in one tall SVG. */
export function renderContinuousSvg(score: ParsedScore, pageSize: PageSize = 'A4'): string {
  const { width } = getSheetSize(pageSize, 'portrait');
  const contentWidth = width - 2 * MARGIN_SIDE;
  const scale = contentWidth / SYSTEM_UNIT_WIDTH;
  const systemHeight = SYSTEM_UNIT_HEIGHT * scale;
  const systemGap = SYSTEM_UNIT_GAP * scale;
  const header = getHeaderMetrics(score.style.titleSize ?? DEFAULT_TITLE_SIZE);
  const grid = getDiagramGrid(score.usedChords.length, contentWidth);

  let body = renderScoreHeader(score, contentWidth, header);
  let y = header.height;
  body += `<g transform="translate(0, ${fmt(y)})">${renderDiagramGrid(score.usedChords, contentWidth, grid)}</g>`;
  y += grid.height;

  splitIntoRows(score).forEach((rows, pIdx) => {
    if (pIdx > 0) {
      body += renderPageBreakSeparator(score.pages[pIdx].pageNumber, contentWidth, y);
      y += PAGE_BREAK_SEPARATOR_HEIGHT;
    }
    for (const row of rows) {
      body += renderSystem(row, scale, y, score.style);
      y += systemHeight + systemGap;
    }
  });

  const height = MARGIN_TOP + y + MARGIN_BOTTOM;
  return wrapSvg(width, height, `<g transform="translate(${fmt(MARGIN_SIDE)}, ${fmt(MARGIN_TOP)})">${body}</g>`, 'continuous-svg');
}

export function compileGuitarDslToSvg(dslContent: string): string {
  return renderContinuousSvg(parseGuitarDsl(dslContent));
}

function wrapSvg(width: number, height: number, body: string, className: string, extraAttrs = ''): string {
  return `<svg class="${className}" ${extraAttrs} width="${fmt(width)}" height="${fmt(height)}" viewBox="0 0 ${fmt(width)} ${fmt(height)}" xmlns="http://www.w3.org/2000/svg" font-family="${FONT_FAMILY_SANS}">
<rect x="0" y="0" width="${fmt(width)}" height="${fmt(height)}" fill="#ffffff"/>
${body}</svg>`;
}

/** Page content in column coordinates (origin = top-left of the printable column). */
function renderPage(score: ParsedScore, layout: ScoreLayout, page: LayoutPage, totalPages: number): string {
  const width = layout.columnWidth;
  let out = '';
  let y = 0;
  if (page.hasScoreHeader) {
    out += renderScoreHeader(score, width, layout.header);
    y += layout.header.height;
    out += `<g transform="translate(0, ${fmt(y)})">${renderDiagramGrid(score.usedChords, width, layout.diagrams)}</g>`;
    y += layout.diagrams.height;
  } else {
    out += renderRunningHeader(score.title, page.pageNumber, width);
    y += RUNNING_HEADER_HEIGHT;
  }

  for (const row of page.rows) {
    out += renderSystem(row, layout.systemScale, y, score.style);
    y += layout.systemHeight + layout.systemGap;
  }

  out += renderFooter(page.pageNumber, totalPages, width, layout.columnHeight);
  return out;
}

function renderSystem(row: SystemRow, scale: number, y: number, style: ScoreStyle): string {
  const barWidth = SYSTEM_UNIT_WIDTH / MEASURES_PER_ROW;
  return `<g class="system" transform="translate(0, ${fmt(y)}) scale(${fmt(scale, 5)})">${renderSystemSvgContent(row.measures, row.isFirstSystem, barWidth, SYSTEM_UNIT_HEIGHT, SYSTEM_UNIT_WIDTH, style)}</g>\n`;
}

function renderScoreHeader(score: ParsedScore, width: number, m: HeaderMetrics): string {
  const { title, artist, capo, originalKey, bpm } = score;
  const keyText = `Key: ${originalKey} ／ BPM: ${bpm}`;
  const capoText = `Capo: ${capo}`;
  const capoFont = 8.5;
  const badgeWidth = estimateTextWidth(capoText, capoFont, true) + 10;
  const rightBlock = Math.max(estimateTextWidth(keyText, META_FONT_SIZE), badgeWidth);

  // Shrink an overlong title instead of wrapping it
  const available = Math.max(width - rightBlock - 16, width * 0.3);
  const natural = estimateTextWidth(title, m.titleSize, true);
  const titleSize = natural > available ? Math.max(MIN_TITLE_SIZE, m.titleSize * available / natural) : m.titleSize;
  const titleText = fitText(title, titleSize, available, true);

  const keyBaseline = Math.max(META_FONT_SIZE, m.metaBaseline - 16);
  let out = `<text x="0" y="${fmt(m.titleBaseline)}" font-size="${fmt(titleSize)}" font-weight="900" fill="#111">${escapeXml(titleText)}</text>`;
  if (artist) {
    out += `<text x="0" y="${fmt(m.metaBaseline)}" font-size="${META_FONT_SIZE}" fill="#444">Words &amp; Music: ${escapeXml(artist)}</text>`;
  }
  out += `<text x="${fmt(width)}" y="${fmt(keyBaseline)}" font-size="${META_FONT_SIZE}" text-anchor="end" fill="#111">${escapeXml(keyText)}</text>`;
  out += `<rect x="${fmt(width - badgeWidth)}" y="${fmt(m.metaBaseline - 9)}" width="${fmt(badgeWidth)}" height="12" rx="2" fill="#000"/>`;
  out += `<text x="${fmt(width - badgeWidth / 2)}" y="${fmt(m.metaBaseline)}" font-size="${capoFont}" font-weight="bold" text-anchor="middle" fill="#fff">${escapeXml(capoText)}</text>`;
  out += `<line x1="0" y1="${fmt(m.ruleY)}" x2="${fmt(width)}" y2="${fmt(m.ruleY)}" stroke="#000" stroke-width="1.5"/>`;
  return out;
}

function renderDiagramGrid(chords: string[], width: number, grid: DiagramGrid): string {
  if (grid.rows === 0) {
    return '';
  }
  let out = '';
  chords.forEach((name, idx) => {
    const col = idx % grid.perRow;
    const row = Math.floor(idx / grid.perRow);
    const x = col * (DIAGRAM_CELL_WIDTH + DIAGRAM_GAP_X);
    const y = row * (DIAGRAM_CELL_HEIGHT + DIAGRAM_GAP_Y);
    out += `<g transform="translate(${fmt(x)}, ${fmt(y)})">`;
    out += `<text x="${fmt(DIAGRAM_CELL_WIDTH / 2)}" y="9" font-size="9.5" font-weight="bold" text-anchor="middle" fill="#000">${escapeXml(name)}</text>`;
    out += `<g transform="translate(0, ${DIAGRAM_NAME_HEIGHT}) scale(${DIAGRAM_SCALE})">${renderChordDiagramSvg(getChordFrets(name))}</g>`;
    out += `</g>`;
  });
  const ruleY = grid.height - BLOCK_SPACING;
  out += `<line x1="0" y1="${fmt(ruleY)}" x2="${fmt(width)}" y2="${fmt(ruleY)}" stroke="#aaa" stroke-width="0.75"/>`;
  return out;
}

function renderRunningHeader(title: string, pageNumber: number, width: number): string {
  const titleText = fitText(title, 9, width - 40, true);
  return `<text x="0" y="9" font-size="9" font-weight="bold" fill="#222">${escapeXml(titleText)}</text>`
    + `<text x="${fmt(width)}" y="9" font-size="8.5" text-anchor="end" fill="#666">- ${pageNumber} -</text>`
    + `<line x1="0" y1="14" x2="${fmt(width)}" y2="14" stroke="#999" stroke-width="0.75"/>`;
}

function renderFooter(pageNumber: number, totalPages: number, width: number, columnHeight: number): string {
  const ruleY = columnHeight - FOOTER_HEIGHT + 6;
  return `<line x1="0" y1="${fmt(ruleY)}" x2="${fmt(width)}" y2="${fmt(ruleY)}" stroke="#ddd" stroke-width="0.5"/>`
    + `<text x="${fmt(width)}" y="${fmt(columnHeight - 2)}" font-size="7.5" text-anchor="end" fill="#888">${pageNumber} / ${totalPages}</text>`;
}

function renderPageBreakSeparator(pageNumber: number, width: number, y: number): string {
  const cy = y + PAGE_BREAK_SEPARATOR_HEIGHT / 2 - 4;
  const label = `PAGE BREAK (${pageNumber})`;
  const labelWidth = estimateTextWidth(label, 8, true) + 24;
  const left = (width - labelWidth) / 2;
  return `<line x1="0" y1="${fmt(cy)}" x2="${fmt(left)}" y2="${fmt(cy)}" stroke="#bbb" stroke-dasharray="3 2"/>`
    + `<line x1="${fmt(left + labelWidth)}" y1="${fmt(cy)}" x2="${fmt(width)}" y2="${fmt(cy)}" stroke="#bbb" stroke-dasharray="3 2"/>`
    + `<text x="${fmt(width / 2)}" y="${fmt(cy + 3)}" font-size="8" font-weight="bold" text-anchor="middle" fill="#777">${label}</text>`;
}

/** Truncates with an ellipsis when the text is still wider than maxWidth at the given size. */
function fitText(text: string, fontSize: number, maxWidth: number, bold: boolean): string {
  if (estimateTextWidth(text, fontSize, bold) <= maxWidth) {
    return text;
  }
  const chars = Array.from(text);
  while (chars.length > 0 && estimateTextWidth(chars.join('') + '…', fontSize, bold) > maxWidth) {
    chars.pop();
  }
  return chars.join('') + '…';
}

function fmt(n: number, digits = 2): string {
  return String(Number(n.toFixed(digits)));
}

const FETA_TREBLE_CLEF_PATH = "m12.049 3.5296c0.305 3.1263-2.019 5.6563-4.0772 7.7014-0.9349 0.897-0.155 0.148-0.6437 0.594-0.1022-0.479-0.2986-1.731-0.2802-2.11 0.1304-2.6939 2.3198-6.5875 4.2381-8.0236 0.309 0.5767 0.563 0.6231 0.763 1.8382zm0.651 16.142c-1.232-0.906-2.85-1.144-4.3336-0.885-0.1913-1.255-0.3827-2.51-0.574-3.764 2.3506-2.329 4.9066-5.0322 5.0406-8.5394 0.059-2.232-0.276-4.6714-1.678-6.4836-1.7004 0.12823-2.8995 2.156-3.8019 3.4165-1.4889 2.6705-1.1414 5.9169-0.57 8.7965-0.8094 0.952-1.9296 1.743-2.7274 2.734-2.3561 2.308-4.4085 5.43-4.0046 8.878 0.18332 3.334 2.5894 6.434 5.8702 7.227 1.2457 0.315 2.5639 0.346 3.8241 0.099 0.2199 2.25 1.0266 4.629 0.0925 6.813-0.7007 1.598-2.7875 3.004-4.3325 2.192-0.5994-0.316-0.1137-0.051-0.478-0.252 1.0698-0.257 1.9996-1.036 2.26-1.565 0.8378-1.464-0.3998-3.639-2.1554-3.358-2.262 0.046-3.1904 3.14-1.7356 4.685 1.3468 1.52 3.833 1.312 5.4301 0.318 1.8125-1.18 2.0395-3.544 1.8325-5.562-0.07-0.678-0.403-2.67-0.444-3.387 0.697-0.249 0.209-0.059 1.193-0.449 2.66-1.053 4.357-4.259 3.594-7.122-0.318-1.469-1.044-2.914-2.302-3.792zm0.561 5.757c0.214 1.991-1.053 4.321-3.079 4.96-0.136-0.795-0.172-1.011-0.2626-1.475-0.4822-2.46-0.744-4.987-1.116-7.481 1.6246-0.168 3.4576 0.543 4.0226 2.184 0.244 0.577 0.343 1.197 0.435 1.812zm-5.1486 5.196c-2.5441 0.141-4.9995-1.595-5.6343-4.081-0.749-2.153-0.5283-4.63 0.8207-6.504 1.1151-1.702 2.6065-3.105 4.0286-4.543 0.183 1.127 0.366 2.254 0.549 3.382-2.9906 0.782-5.0046 4.725-3.215 7.451 0.5324 0.764 1.9765 2.223 2.7655 1.634-1.102-0.683-2.0033-1.859-1.8095-3.227-0.0821-1.282 1.3699-2.911 2.6513-3.198 0.4384 2.869 0.9413 6.073 1.3797 8.943-0.5054 0.1-1.0211 0.143-1.536 0.143z";

function renderChordDiagramSvg(frets: (number | 'x' | 'o')[]): string {
  let circles = '';
  let topMarks = '';

  for (let s = 0; s < 6; s++) {
    const x = 5 + s * 8;
    const f = frets[s];
    if (f === 'x') {
      topMarks += `<text x="${x}" y="9" font-size="8" text-anchor="middle" fill="#000">×</text>`;
    } else if (f === 'o') {
      topMarks += `<circle cx="${x}" cy="7" r="2" fill="none" stroke="#000" stroke-width="0.8"/>`;
    } else if (typeof f === 'number' && f > 0) {
      const y = 14 + (f - 1) * 9 + 4.5;
      circles += `<circle cx="${x}" cy="${y}" r="3" fill="#000"/>`;
    }
  }

  return `
    ${topMarks}
    <!-- Nut -->
    <line x1="5" y1="14" x2="45" y2="14" stroke="#000" stroke-width="2.2"/>
    <!-- Frets -->
    <line x1="5" y1="23" x2="45" y2="23" stroke="#888" stroke-width="0.7"/>
    <line x1="5" y1="32" x2="45" y2="32" stroke="#888" stroke-width="0.7"/>
    <line x1="5" y1="41" x2="45" y2="41" stroke="#888" stroke-width="0.7"/>
    <line x1="5" y1="50" x2="45" y2="50" stroke="#888" stroke-width="0.7"/>
    <!-- Strings -->
    <line x1="5" y1="14" x2="5" y2="50" stroke="#000" stroke-width="0.7"/>
    <line x1="13" y1="14" x2="13" y2="50" stroke="#000" stroke-width="0.7"/>
    <line x1="21" y1="14" x2="21" y2="50" stroke="#000" stroke-width="0.7"/>
    <line x1="29" y1="14" x2="29" y2="50" stroke="#000" stroke-width="0.7"/>
    <line x1="37" y1="14" x2="37" y2="50" stroke="#000" stroke-width="0.7"/>
    <line x1="45" y1="14" x2="45" y2="50" stroke="#000" stroke-width="0.7"/>
    ${circles}`;
}

function renderSystemSvgContent(measures: MeasureData[], isFirst: boolean, barWidth: number, height: number, totalWidth: number, style?: ScoreStyle): string {
  const chordSize = style?.chordSize ?? 15;
  const sectionSize = style?.sectionSize ?? 9.5;
  const lyricSize = style?.lyricSize ?? 10;

  const staveY = 70;
  const staveLines = [0, 8, 16, 24, 32].map(dy => staveY + dy);

  let staveSvg = '';
  staveLines.forEach(y => {
    staveSvg += `<line x1="25" y1="${y}" x2="${totalWidth - 5}" y2="${y}" stroke="#000" stroke-width="1"/>`;
  });
  staveSvg += `<line x1="25" y1="${staveLines[0]}" x2="${25}" y2="${staveLines[4]}" stroke="#000" stroke-width="2"/>`;

  // Treble clef appears at the start of every system row (standard musical notation convention)
  let clefSvg = `<g transform="translate(28, 53.36) scale(1.6)"><path d="${FETA_TREBLE_CLEF_PATH}" fill="#000"/></g>`;
  if (isFirst) {
    clefSvg += `<text x="58" y="${staveY + 14}" font-size="14" font-weight="bold">4</text>`;
    clefSvg += `<text x="58" y="${staveY + 30}" font-size="14" font-weight="bold">4</text>`;
  }

  let barsSvg = '';
  // Align measure barlines consistently across all rows
  const startX = 78;
  const usableWidth = (totalWidth - 5) - startX;
  const actualBarWidth = usableWidth / measures.length;

  measures.forEach((m, idx) => {
    const bx = startX + idx * actualBarWidth;
    const bEnd = bx + actualBarWidth;

    // Barline
    if (m.repeatEnd) {
      barsSvg += `<circle cx="${bEnd - 12}" cy="${staveLines[1] + 4}" r="2" fill="#000"/>`;
      barsSvg += `<circle cx="${bEnd - 12}" cy="${staveLines[2] + 4}" r="2" fill="#000"/>`;
      barsSvg += `<line x1="${bEnd - 5}" y1="${staveLines[0]}" x2="${bEnd - 5}" y2="${staveLines[4]}" stroke="#000" stroke-width="1.2"/>`;
      barsSvg += `<line x1="${bEnd}" y1="${staveLines[0]}" x2="${bEnd}" y2="${staveLines[4]}" stroke="#000" stroke-width="3"/>`;
    } else {
      barsSvg += `<line x1="${bEnd}" y1="${staveLines[0]}" x2="${bEnd}" y2="${staveLines[4]}" stroke="#000" stroke-width="1.2"/>`;
    }

    if (m.repeatStart) {
      barsSvg += `<line x1="${bx}" y1="${staveLines[0]}" x2="${bx}" y2="${staveLines[4]}" stroke="#000" stroke-width="3"/>`;
      barsSvg += `<line x1="${bx + 5}" y1="${staveLines[0]}" x2="${bx + 5}" y2="${staveLines[4]}" stroke="#000" stroke-width="1.2"/>`;
      barsSvg += `<circle cx="${bx + 12}" cy="${staveLines[1] + 4}" r="2" fill="#000"/>`;
      barsSvg += `<circle cx="${bx + 12}" cy="${staveLines[2] + 4}" r="2" fill="#000"/>`;
    }

    // Section Label (placed at the top: y = 2 to 16)
    if (m.sectionName) {
      barsSvg += `
        <rect x="${bx + 4}" y="2" width="${m.sectionName.length * (sectionSize * 0.95) + 12}" height="${sectionSize + 5}" fill="#fff" stroke="#000" stroke-width="1.2"/>
        <text x="${bx + 10}" y="${sectionSize + 3.5}" font-size="${sectionSize}" font-weight="bold">${escapeXml(m.sectionName)}</text>
      `;
    }

    if (m.isMeasureRepeat) {
      // Chords (placed clearly above: baseline at y = 33)
      const chordsToRender = m.chords && m.chords.length > 0
        ? m.chords
        : (m.chord ? [{ name: m.chord, beat: 0 }] : []);

      const padLeft = 14;
      const padRight = 14;
      const usableW = actualBarWidth - padLeft - padRight;
      let lastChordRight = bx;

      chordsToRender.forEach((ch, chIdx) => {
        let chordX = bx + 8;
        if (chIdx > 0 || ch.beat > 0) {
          chordX = Math.max(bx + 8, bx + padLeft + (ch.beat / 4.0) * usableW);
        }
        chordX = Math.max(lastChordRight + 6, chordX);
        lastChordRight = chordX + ch.name.length * (chordSize * 0.6);
        barsSvg += `<text x="${chordX}" y="33" font-size="${chordSize}" font-weight="900" fill="#000">${escapeXml(ch.name)}</text>`;
      });

      // Measure Repeat Sign (Simile mark: diagonal slash with two dots)
      const centerX = bx + actualBarWidth / 2;
      // Diagonal slash across stave lines 2 to 4 (y=74 to y=98)
      barsSvg += `<line x1="${centerX - 13}" y1="98" x2="${centerX + 13}" y2="74" stroke="#000" stroke-width="3.6" stroke-linecap="round"/>`;
      // Upper dot in space 2 (y=82)
      barsSvg += `<circle cx="${centerX - 7}" cy="82" r="2.6" fill="#000"/>`;
      // Lower dot in space 3 (y=90)
      barsSvg += `<circle cx="${centerX + 7}" cy="90" r="2.6" fill="#000"/>`;

      // Lyric (placed below bottom stave line: baseline y = 120)
      if (m.lyric) {
        barsSvg += `<text x="${bx + actualBarWidth / 2}" y="${staveLines[4] + 18}" font-size="${lyricSize}" text-anchor="middle" fill="#222">${escapeXml(m.lyric)}</text>`;
      }
      return;
    }

    // Rhythms with duration calculation, Guitar Pro style slash heads, and beam grouping
    const midY = staveLines[2]; // 3rd line = 86
    const stemTopY = 60;

    // Pre-calculate positions and metrics for all rhythm items in this measure
    interface RenderedRhythm {
      item: RhythmItem;
      beats: number;
      beatOffset: number;
      rx: number;
      stemX: number;
      isWhole: boolean;
      isHalf: boolean;
      isQuarterOrShorter: boolean;
    }

    const rhythmDetails: RenderedRhythm[] = [];
    const padLeft = 14;
    const padRight = 14;
    const usableW = actualBarWidth - padLeft - padRight;
    const rCount = m.rhythms.length;
    const rStep = usableW / (rCount > 0 ? rCount : 1);

    let curBeat = 0;
    m.rhythms.forEach((r, idx) => {
      const beats = parseDurationToBeats(r.duration);
      const cleanDur = r.duration.replace(/^r/, '').toLowerCase();
      const isWhole = cleanDur === '1' || cleanDur === 'w';
      const isHalf = cleanDur === '2' || cleanDur === 'h';
      const isQuarterOrShorter = !isWhole && !isHalf;

      let rx: number;
      if (rCount === 1) {
        // Center single note in measure
        rx = bx + actualBarWidth / 2;
      } else {
        // Equal spacing across the measure
        rx = bx + padLeft + (idx + 0.5) * rStep;
      }

      const stemX = isWhole ? rx : rx + 6.5;

      rhythmDetails.push({
        item: r,
        beats,
        beatOffset: curBeat,
        rx,
        stemX,
        isWhole,
        isHalf,
        isQuarterOrShorter
      });

      curBeat += beats;
    });

    // Chords (placed clearly above picking marks: baseline at y = 33)
    const chordsToRender = m.chords && m.chords.length > 0
      ? m.chords
      : (m.chord ? [{ name: m.chord, beat: 0 }] : []);

    let lastChordRight = bx;
    chordsToRender.forEach((ch, chIdx) => {
      let chordX = bx + 8;
      if (chIdx > 0 || ch.beat > 0) {
        const matchingRhythm = rhythmDetails.find(rd => Math.abs(rd.beatOffset - ch.beat) < 0.05);
        if (matchingRhythm) {
          chordX = Math.max(bx + 8, matchingRhythm.rx - 4);
        } else {
          chordX = Math.max(bx + 8, bx + padLeft + (ch.beat / 4.0) * usableW);
        }
      }
      chordX = Math.max(lastChordRight + 6, chordX);
      lastChordRight = chordX + ch.name.length * (chordSize * 0.6);
      barsSvg += `<text x="${chordX}" y="33" font-size="${chordSize}" font-weight="900" fill="#000">${escapeXml(ch.name)}</text>`;
    });

    // Beam grouping for eighth and sixteenth notes (group by integer beat floor)
    const beamedIndices = new Set<number>();
    const beatGroups: Map<number, number[]> = new Map();

    rhythmDetails.forEach((rd, idx) => {
      if (!rd.item.isRest && rd.beats <= 0.5) {
        const beatKey = Math.floor(rd.beatOffset);
        if (!beatGroups.has(beatKey)) {
          beatGroups.set(beatKey, []);
        }
        beatGroups.get(beatKey)!.push(idx);
      }
    });

    // Render beams for groups with >= 2 notes
    beatGroups.forEach((indices) => {
      if (indices.length >= 2) {
        indices.forEach(i => beamedIndices.add(i));
        const first = rhythmDetails[indices[0]];
        const last = rhythmDetails[indices[indices.length - 1]];

        // Main beam at y = 60
        barsSvg += `<line x1="${first.stemX}" y1="${stemTopY}" x2="${last.stemX}" y2="${stemTopY}" stroke="#000" stroke-width="3.6" stroke-linecap="butt"/>`;

        // Sub-beam at y = 65 for sixteenth notes
        // Group consecutive 16th notes
        let subStart: RenderedRhythm | null = null;
        let subEnd: RenderedRhythm | null = null;

        for (let i = 0; i < indices.length; i++) {
          const rd = rhythmDetails[indices[i]];
          if (rd.beats <= 0.25) {
            if (!subStart) subStart = rd;
            subEnd = rd;
          } else {
            if (subStart && subEnd) {
              if (subStart === subEnd) {
                // Fractional beam (flaglet towards neighbor)
                const fracX = (i === 0) ? subStart.stemX + 6 : subStart.stemX - 6;
                barsSvg += `<line x1="${subStart.stemX}" y1="${stemTopY + 5}" x2="${fracX}" y2="${stemTopY + 5}" stroke="#000" stroke-width="2.4" stroke-linecap="butt"/>`;
              } else {
                barsSvg += `<line x1="${subStart.stemX}" y1="${stemTopY + 5}" x2="${subEnd.stemX}" y2="${stemTopY + 5}" stroke="#000" stroke-width="2.4" stroke-linecap="butt"/>`;
              }
              subStart = null;
              subEnd = null;
            }
          }
        }
        if (subStart && subEnd) {
          if (subStart === subEnd) {
            const fracX = (subStart === last) ? subStart.stemX - 6 : subStart.stemX + 6;
            barsSvg += `<line x1="${subStart.stemX}" y1="${stemTopY + 5}" x2="${fracX}" y2="${stemTopY + 5}" stroke="#000" stroke-width="2.4" stroke-linecap="butt"/>`;
          } else {
            barsSvg += `<line x1="${subStart.stemX}" y1="${stemTopY + 5}" x2="${subEnd.stemX}" y2="${stemTopY + 5}" stroke="#000" stroke-width="2.4" stroke-linecap="butt"/>`;
          }
        }
      }
    });

    // Render individual rhythm items
    rhythmDetails.forEach((rd, rIdx) => {
      const r = rd.item;
      const rx = rd.rx;
      const stemX = rd.stemX;
      const opacity = r.ghost ? '0.35' : '1.0';

      if (r.isRest) {
        const cleanDur = r.duration.replace(/^r/, '').toLowerCase();
        if (cleanDur === '1' || cleanDur === 'w') {
          // Whole rest: hanging from 4th stave line (index 1: y = 78)
          barsSvg += `<rect x="${rx - 6}" y="${staveLines[1]}" width="12" height="5" fill="#000"/>`;
        } else if (cleanDur === '2' || cleanDur === 'h') {
          // Half rest: sitting on 3rd stave line (index 2: y = 86)
          barsSvg += `<rect x="${rx - 6}" y="${staveLines[2] - 5}" width="12" height="5" fill="#000"/>`;
        } else if (cleanDur === '8') {
          // Eighth rest vector
          barsSvg += `<g transform="translate(${rx}, ${midY})">
            <circle cx="-2" cy="-5" r="2.4" fill="#000"/>
            <path d="M -0.2,-5 C 1.2,-5 2.8,-6.2 3.8,-8.5 L 4.5,-8.5 C 3.2,-3.5 0.5,3.5 -3.5,8.5 L -4.5,8.0 C -1.5,4.0 0.8,-1.5 1.5,-4.5 C 0.8,-4.2 0.2,-4.2 -0.2,-4.2 Z" fill="#000"/>
          </g>`;
        } else if (cleanDur === '16') {
          // Sixteenth rest vector
          barsSvg += `<g transform="translate(${rx}, ${midY})">
            <circle cx="-2" cy="-8" r="2.2" fill="#000"/>
            <circle cx="-3" cy="-1" r="2.2" fill="#000"/>
            <path d="M -0.2,-8 C 1.2,-8 2.5,-9.2 3.5,-11.5 L 4.2,-11.5 C 3.0,-6.5 0.5,2.5 -3.5,8.5 L -4.5,8.0 C -1.5,4.0 0.8,-2.5 1.5,-5.5 C 0.8,-5.2 0.2,-5.2 -0.2,-5.2 Z" fill="#000"/>
            <path d="M -1.2,-1 C 0.2,-1 1.5,-2.2 2.5,-4.5 L 3.2,-4.5 C 2.5,-1.5 1.5,2.5 -0.5,5.5 L -1.5,5.0 C 0,-1.0 0.5,-3.0 0.5,-3.0 Z" fill="#000"/>
          </g>`;
        } else {
          // Quarter rest vector (default)
          barsSvg += `<g transform="translate(${rx}, ${midY})">
            <path d="M 1.2,-14.5 C 1.8,-15.5 2.8,-16 4.0,-16 C 5.5,-16 6.8,-14.8 6.8,-13.2 C 6.8,-11.5 5.2,-9.8 3.5,-8.2 L -1.5,-3.5 C -0.8,-3.2 0,-3.2 0.8,-3.2 C 3.2,-3.2 5.2,-1.5 5.2,1.2 C 5.2,3.2 3.8,4.8 1.8,5.8 L -2.5,7.8 C -3.8,8.5 -4.8,9.8 -4.8,11.2 C -4.8,13.2 -3.0,14.8 -0.8,14.8 C 0.5,14.8 1.8,14.2 2.8,13.2 L 3.5,14.2 C 2.2,15.5 0.8,16.2 -0.8,16.2 C -3.8,16.2 -6.2,13.8 -6.2,10.8 C -6.2,8.8 -4.8,7.0 -2.8,6.0 L 1.2,4.0 C 2.5,3.2 3.2,2.2 3.2,1.2 C 3.2,-0.2 2.0,-1.5 0.5,-1.5 C -0.5,-1.5 -1.5,-1.0 -2.5,-0.2 L -3.8,-1.5 L 1.2,-6.2 C -0.5,-7.8 -2.2,-9.5 -2.2,-11.5 C -2.2,-13.8 0,-15.8 2.2,-16 L 1.2,-14.5 Z" fill="#000"/>
          </g>`;
        }
      } else {
        // Guitar Pro style slash heads
        if (rd.isWhole) {
          // Whole note: wide white slash, no stem
          barsSvg += `<polygon points="${rx - 12},${midY + 7} ${rx},${midY + 7} ${rx + 12},${midY - 7} ${rx},${midY - 7}" fill="#fff"/>`;
          barsSvg += `<path d="M ${rx - 12},${midY + 7} L ${rx},${midY + 7} L ${rx + 12},${midY - 7} L ${rx},${midY - 7} Z M ${rx - 8.5},${midY + 5.2} L ${rx - 1.5},${midY + 5.2} L ${rx + 8.5},${midY - 5.2} L ${rx + 1.5},${midY - 5.2} Z" fill="#000" fill-rule="evenodd" opacity="${opacity}"/>`;
        } else if (rd.isHalf) {
          // Half note: white slash with stem cleanly attached at top-right corner
          barsSvg += `<line x1="${stemX}" y1="${stemTopY}" x2="${stemX}" y2="${midY - 7}" stroke="#000" stroke-width="1.35" stroke-linecap="square" opacity="${opacity}"/>`;
          barsSvg += `<polygon points="${rx - 6.5},${midY + 7} ${rx + 0.5},${midY + 7} ${rx + 7},${midY - 7} ${rx},${midY - 7}" fill="#fff"/>`;
          barsSvg += `<path d="M ${rx - 6.5},${midY + 7} L ${rx + 0.5},${midY + 7} L ${rx + 7},${midY - 7} L ${rx},${midY - 7} Z M ${rx - 3.8},${midY + 5.2} L ${rx - 0.8},${midY + 5.2} L ${rx + 4.2},${midY - 5.2} L ${rx + 1.2},${midY - 5.2} Z" fill="#000" fill-rule="evenodd" opacity="${opacity}"/>`;
        } else {
          // Quarter or shorter: solid black slash with stem
          barsSvg += `<line x1="${stemX}" y1="${stemTopY}" x2="${stemX}" y2="${midY - 7}" stroke="#000" stroke-width="1.35" stroke-linecap="square" opacity="${opacity}"/>`;
          barsSvg += `<polygon points="${rx - 5.5},${midY + 7} ${rx},${midY + 7} ${rx + 6.5},${midY - 7} ${rx + 1},${midY - 7}" fill="#000" opacity="${opacity}"/>`;

          // If not beamed, draw flag for eighth / sixteenth notes
          if (!beamedIndices.has(rIdx)) {
            if (rd.beats === 0.5) {
              // 8th flag
              barsSvg += `<path d="M ${stemX},${stemTopY} C ${stemX + 4},${stemTopY + 4} ${stemX + 6},${stemTopY + 8} ${stemX + 6},${stemTopY + 13} C ${stemX + 4},${stemTopY + 10} ${stemX + 2},${stemTopY + 8} ${stemX},${stemTopY + 6} Z" fill="#000" opacity="${opacity}"/>`;
            } else if (rd.beats <= 0.25) {
              // 16th double flag
              barsSvg += `<path d="M ${stemX},${stemTopY} C ${stemX + 4},${stemTopY + 4} ${stemX + 6},${stemTopY + 8} ${stemX + 6},${stemTopY + 13} C ${stemX + 4},${stemTopY + 10} ${stemX + 2},${stemTopY + 8} ${stemX},${stemTopY + 6} Z" fill="#000" opacity="${opacity}"/>`;
              barsSvg += `<path d="M ${stemX},${stemTopY + 5} C ${stemX + 4},${stemTopY + 9} ${stemX + 6},${stemTopY + 13} ${stemX + 6},${stemTopY + 18} C ${stemX + 4},${stemTopY + 15} ${stemX + 2},${stemTopY + 13} ${stemX},${stemTopY + 11} Z" fill="#000" opacity="${opacity}"/>`;
            }
          }
        }

        // Down / Up stroke mark (placed at y = 47 to 52, above stemTopY = 60, below chord baseline = 32)
        const py = 47;
        const markX = rd.isWhole ? rx : stemX;
        if (r.down) {
          barsSvg += `<path d="M ${markX - 3},${py + 5} L ${markX - 3},${py} L ${markX + 3},${py} L ${markX + 3},${py + 5}" fill="none" stroke="#000" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" opacity="${opacity}"/>`;
        } else if (r.up) {
          barsSvg += `<path d="M ${markX - 3},${py} L ${markX},${py + 5} L ${markX + 3},${py}" fill="none" stroke="#000" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" opacity="${opacity}"/>`;
        }

        // Accent (placed at y = 38 to 44, between chord baseline = 32 and stroke mark = 47)
        const ay = 38;
        if (r.accent) {
          barsSvg += `<path d="M ${markX - 3},${ay} L ${markX + 3},${ay + 3} L ${markX - 3},${ay + 6}" fill="none" stroke="#000" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>`;
        }
      }
    });

    // Lyric (placed below bottom stave line: baseline y = 120)
    if (m.lyric) {
      barsSvg += `<text x="${bx + actualBarWidth / 2}" y="${staveLines[4] + 18}" font-size="${lyricSize}" text-anchor="middle" fill="#222">${escapeXml(m.lyric)}</text>`;
    }
  });

  return `
    ${staveSvg}
    ${clefSvg}
    ${barsSvg}`;
}
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
