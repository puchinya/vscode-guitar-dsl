import { MeasureData, ParsedScore, RhythmItem, parseGuitarDsl } from '../compiler';
import { Fraction, NoteValuePart, ZERO, fadd, fnum } from '../duration';
import { diagramStringX, renderChordDiagramSvg } from './chordDiagram';
import { ResolvedChordDiagram, resolveScoreDiagrams } from './chordLibrary';
import {
  BLOCK_SPACING,
  DIAGRAM_CELL_WIDTH,
  DIAGRAM_GAP_X,
  DIAGRAM_GAP_Y,
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
  META_FONT_SIZE,
  PAGE_BREAK_SEPARATOR_HEIGHT,
  PageOrientation,
  PageSize,
  RUNNING_HEADER_HEIGHT,
  SYSTEM_UNIT_GAP,
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
import { renderMelodyStaff } from './melodyStaff';
import {
  FETA_TREBLE_CLEF_PATH,
  RenderContext,
  chordXAt,
  computeMeasureColumns,
  escapeXml,
  expandParts,
  fmt,
  getRenderContext,
  measureBounds,
  renderChordName,
  renderFlags,
  renderRestGlyph,
  renderTieArc,
  rhythmParts,
  tripletGroups
} from './notation';

export { escapeXml } from './notation';

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
  const systemGap = SYSTEM_UNIT_GAP * scale;
  const ctx = getRenderContext(score);
  const header = getHeaderMetrics(score.style.titleSize ?? DEFAULT_TITLE_SIZE);
  const diagrams = resolveScoreDiagrams(score);
  const grid = getDiagramGrid(diagrams, contentWidth);

  let body = renderScoreHeader(score, contentWidth, header);
  let y = header.height;
  body += `<g transform="translate(0, ${fmt(y)})">${renderDiagramGrid(diagrams, contentWidth, grid)}</g>`;
  y += grid.height;

  splitIntoRows(score).forEach((rows, pIdx) => {
    if (pIdx > 0) {
      body += renderPageBreakSeparator(score.pages[pIdx].pageNumber, contentWidth, y);
      y += PAGE_BREAK_SEPARATOR_HEIGHT;
    }
    for (const row of rows) {
      body += renderSystem(row, scale, y, ctx);
      y += row.geometry.unitHeight * scale + systemGap;
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
    out += `<g transform="translate(0, ${fmt(y)})">${renderDiagramGrid(resolveScoreDiagrams(score), width, layout.diagrams)}</g>`;
    y += layout.diagrams.height;
  } else {
    out += renderRunningHeader(score.title, page.pageNumber, width);
    y += RUNNING_HEADER_HEIGHT;
  }

  const ctx = getRenderContext(score);
  for (const row of page.rows) {
    out += renderSystem(row, layout.systemScale, y, ctx);
    y += row.geometry.unitHeight * layout.systemScale + layout.systemGap;
  }

  out += renderFooter(page.pageNumber, totalPages, width, layout.columnHeight);
  return out;
}

function renderSystem(row: SystemRow, scale: number, y: number, ctx: RenderContext): string {
  const geometry = row.geometry;
  let content: string;
  if (geometry.kind === 'rhythm') {
    content = renderSystemSvgContent(row.measures, row.isFirstSystem, ctx, { drawHeader: true, drawTimeSignature: true });
  } else {
    // Melody system: melody staff + syllable lyrics on top, then (unless lead sheet) the rhythm staff shifted down.
    content = renderMelodyStaff(row.measures, ctx, {
      isFirstSystem: row.isFirstSystem,
      geometry,
      includeRhythmColumns: geometry.kind === 'melody'
    });
    if (geometry.kind === 'melody') {
      content += `<g transform="translate(0, ${fmt(geometry.rhythmOffset)})">${renderSystemSvgContent(row.measures, row.isFirstSystem, ctx, { drawHeader: false, drawTimeSignature: true })}</g>`;
    }
  }
  return `<g class="system" transform="translate(0, ${fmt(y)}) scale(${fmt(scale, 5)})">${content}</g>\n`;
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

/** Diagram cells carry `data-chord-key` so the preview can open the chord editor on click. */
function renderDiagramGrid(diagrams: ResolvedChordDiagram[], width: number, grid: DiagramGrid): string {
  if (grid.rows === 0) {
    return '';
  }
  const centerX = (diagramStringX(0) + diagramStringX(5)) / 2 * DIAGRAM_SCALE;
  let out = '';
  diagrams.forEach((d, idx) => {
    const col = idx % grid.perRow;
    const row = Math.floor(idx / grid.perRow);
    const x = col * (DIAGRAM_CELL_WIDTH + DIAGRAM_GAP_X);
    const y = row * (grid.cellHeight + DIAGRAM_GAP_Y);
    out += `<g class="chord-diagram" data-chord-key="${escapeXml(d.key)}" transform="translate(${fmt(x)}, ${fmt(y)})">`;
    out += `<rect x="0" y="0" width="${fmt(DIAGRAM_CELL_WIDTH)}" height="${fmt(grid.cellHeight)}" fill="#fff" fill-opacity="0"/>`;
    out += `<text x="${fmt(centerX)}" y="9" font-size="9.5" font-weight="bold" text-anchor="middle" fill="#000">${escapeXml(d.name)}</text>`;
    if (d.label) {
      out += `<text x="${fmt(centerX)}" y="${fmt(DIAGRAM_NAME_HEIGHT + 4.5)}" font-size="6" text-anchor="middle" fill="#777">${escapeXml(d.label)}</text>`;
    }
    out += `<g transform="translate(0, ${fmt(grid.headHeight)}) scale(${DIAGRAM_SCALE})">${renderChordDiagramSvg(d.voicing)}</g>`;
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



interface RhythmStaffOptions {
  /** Draw section labels and chord names (false when the melody staff above already shows them). */
  drawHeader: boolean;
  /** Omit the time signature (drawn on the melody staff instead). */
  drawTimeSignature: boolean;
}

function renderSystemSvgContent(measures: MeasureData[], isFirst: boolean, ctx: RenderContext, opts: RhythmStaffOptions): string {
  const style = ctx.score.style;
  const totalWidth = ctx.totalWidth;
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
  if (isFirst && opts.drawTimeSignature) {
    const tx = 58 + ctx.keySignatureWidth;
    clefSvg += `<text x="${tx}" y="${staveY + 14}" font-size="14" font-weight="bold">4</text>`;
    clefSvg += `<text x="${tx}" y="${staveY + 30}" font-size="14" font-weight="bold">4</text>`;
  }

  let barsSvg = '';

  measures.forEach((m, idx) => {
    // Align measure barlines consistently across all rows
    const { bx, width: actualBarWidth } = measureBounds(ctx, measures.length, idx);
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
    if (opts.drawHeader && m.sectionName) {
      barsSvg += renderSectionLabel(m.sectionName, bx, sectionSize);
    }

    // The measure lyric is replaced by syllable lyrics when the measure has a melody (spec §9.2).
    const measureLyric = m.melody ? '' : m.lyric;

    if (m.isMeasureRepeat) {
      // Chords (placed clearly above: baseline at y = 33)
      if (opts.drawHeader) {
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
          const chordName = renderChordName(ch, chordX, chordSize);
          lastChordRight = chordX + chordName.width;
          barsSvg += chordName.svg;
        });
      }

      // Measure Repeat Sign (Simile mark: diagonal slash with two dots)
      const centerX = bx + actualBarWidth / 2;
      // Diagonal slash across stave lines 2 to 4 (y=74 to y=98)
      barsSvg += `<line x1="${centerX - 13}" y1="98" x2="${centerX + 13}" y2="74" stroke="#000" stroke-width="3.6" stroke-linecap="round"/>`;
      // Upper dot in space 2 (y=82)
      barsSvg += `<circle cx="${centerX - 7}" cy="82" r="2.6" fill="#000"/>`;
      // Lower dot in space 3 (y=90)
      barsSvg += `<circle cx="${centerX + 7}" cy="90" r="2.6" fill="#000"/>`;

      // Lyric (placed below bottom stave line: baseline y = 120)
      if (measureLyric) {
        barsSvg += `<text x="${bx + actualBarWidth / 2}" y="${staveLines[4] + 18}" font-size="${lyricSize}" text-anchor="middle" fill="#222">${escapeXml(measureLyric)}</text>`;
      }
      return;
    }

    // Rhythms with duration calculation, Guitar Pro style slash heads, and beam grouping
    const midY = staveLines[2]; // 3rd line = 86
    const stemTopY = 60;

    // Pre-calculate positions and metrics for all rhythm heads in this measure.
    // Compound values (4+8) expand into tied heads; triplets (8t) keep their base note shape.
    interface RenderedRhythm {
      item: RhythmItem;
      beats: number;
      beatFraction: Fraction;
      part: NoteValuePart;
      beatOffset: number;
      rx: number;
      stemX: number;
      isWhole: boolean;
      isHalf: boolean;
      isQuarterOrShorter: boolean;
      isFirstPart: boolean;
    }

    const columns = computeMeasureColumns(m, bx, actualBarWidth, true);
    const rhythmDetails: RenderedRhythm[] = [];

    let curBeat = ZERO;
    m.rhythms.forEach(r => {
      for (const head of expandParts(rhythmParts(r.duration), curBeat)) {
        const isWhole = head.part.base === 1;
        const isHalf = head.part.base === 2;
        const rx = columns.xAt(head.offset) ?? bx + actualBarWidth / 2;
        rhythmDetails.push({
          item: r,
          beats: fnum(head.beats),
          beatFraction: head.beats,
          part: head.part,
          beatOffset: fnum(head.offset),
          rx,
          stemX: isWhole ? rx : rx + 6.5,
          isWhole,
          isHalf,
          isQuarterOrShorter: !isWhole && !isHalf,
          isFirstPart: head.isFirstPart
        });
        curBeat = fadd(head.offset, head.beats);
      }
    });

    // Chords (placed clearly above picking marks: baseline at y = 33)
    if (opts.drawHeader) {
      const chordsToRender = m.chords && m.chords.length > 0
        ? m.chords
        : (m.chord ? [{ name: m.chord, beat: 0 }] : []);

      let lastChordRight = bx;
      chordsToRender.forEach((ch, chIdx) => {
        let chordX = bx + 8;
        if (chIdx > 0 || ch.beat > 0) {
          chordX = chordXAt(columns, bx, actualBarWidth, ch.beat);
        }
        chordX = Math.max(lastChordRight + 6, chordX);
        const chordName = renderChordName(ch, chordX, chordSize);
        lastChordRight = chordX + chordName.width;
        barsSvg += chordName.svg;
      });
    }

    // Beam grouping for eighth and sixteenth notes (group by integer beat floor)
    const beamedIndices = new Set<number>();
    const beatGroups: Map<number, number[]> = new Map();

    rhythmDetails.forEach((rd, idx) => {
      if (!rd.item.isRest && rd.part.base >= 8) {
        const beatKey = Math.floor(rd.beatOffset + 1e-9);
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
          if (rd.part.base >= 16) {
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

    // Triplet numbers: above the stroke marks (y = 47..52), below the chord names
    for (const group of tripletGroups(rhythmDetails.map(rd => ({ ...rd, beats: rd.beatFraction })))) {
      const cx = (group[0].stemX + group[group.length - 1].stemX) / 2;
      barsSvg += `<text x="${fmt(cx)}" y="45" font-size="8" font-style="italic" text-anchor="middle" fill="#000">3</text>`;
    }

    // Render individual rhythm items
    rhythmDetails.forEach((rd, rIdx) => {
      const r = rd.item;
      const rx = rd.rx;
      const stemX = rd.stemX;
      const opacity = r.ghost ? '0.35' : '1.0';

      if (r.isRest) {
        barsSvg += renderRestGlyph(rd.part.base, rx, midY, staveLines);
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
            barsSvg += renderFlags(rd.part.base, stemX, stemTopY, false, opacity);
          }
        }

        // Tie from the previous head of a compound value (4+8)
        if (!rd.isFirstPart && rIdx > 0) {
          const prev = rhythmDetails[rIdx - 1];
          barsSvg += renderTieArc(prev.rx + 5, rx - 5, midY + 9, true);
        }

        // Down / Up stroke mark (placed at y = 47 to 52, above stemTopY = 60, below chord baseline = 32)
        if (rd.isFirstPart) {
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
      }
    });

    // Lyric (placed below bottom stave line: baseline y = 120)
    if (measureLyric) {
      barsSvg += `<text x="${bx + actualBarWidth / 2}" y="${staveLines[4] + 18}" font-size="${lyricSize}" text-anchor="middle" fill="#222">${escapeXml(measureLyric)}</text>`;
    }
  });

  return `
    ${staveSvg}
    ${clefSvg}
    ${barsSvg}`;
}

function renderSectionLabel(name: string, bx: number, sectionSize: number): string {
  return `
        <rect x="${bx + 4}" y="2" width="${name.length * (sectionSize * 0.95) + 12}" height="${sectionSize + 5}" fill="#fff" stroke="#000" stroke-width="1.2"/>
        <text x="${bx + 10}" y="${sectionSize + 3.5}" font-size="${sectionSize}" font-weight="bold">${escapeXml(name)}</text>
      `;
}

