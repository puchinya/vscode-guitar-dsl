import * as fs from 'fs';
import * as path from 'path';
import PDFDocument = require('pdfkit');
import SVGtoPDF = require('svg-to-pdfkit');
import { parseGuitarDsl } from './compiler';
import { PageOrientation, PageSize, getSheetSize } from './render/layout';
import { renderScoreSheets } from './render/svg';

// PDF generation without a browser: sheet SVGs are converted to vector PDF pages by pdfkit.
// All text uses the bundled Noto Sans JP, subset-embedded by pdfkit (only the glyphs in use).

export interface ScoreFontFiles {
  regular: string;
  bold: string;
}

const FONT_REGULAR = 'ScoreRegular';
const FONT_BOLD = 'ScoreBold';

/** Bundled font locations relative to the extension root. */
export function getBundledFontFiles(extensionRoot: string): ScoreFontFiles {
  const dir = path.join(extensionRoot, 'media', 'fonts');
  return {
    regular: path.join(dir, 'NotoSansJP-Regular.ttf'),
    bold: path.join(dir, 'NotoSansJP-Bold.ttf')
  };
}

export function renderScorePdf(
  dslContent: string,
  pageSize: PageSize,
  orientation: PageOrientation,
  fonts: ScoreFontFiles,
  options?: { expandPageBreakRepeats?: boolean }
): Promise<Buffer> {
  const score = parseGuitarDsl(dslContent, { expandPageBreakRepeats: options?.expandPageBreakRepeats });
  const sheets = renderScoreSheets(score, pageSize, orientation);
  const { width, height } = getSheetSize(pageSize, orientation);

  return new Promise<Buffer>((resolve, reject) => {
    try {
      // pdfkit calls valueOf() on every info entry, so empty fields must be omitted rather than set to undefined.
      const info: PDFKit.DocumentInfo = { Creator: 'GuitarDSL Previewer' };
      if (score.title) {
        info.Title = score.title;
      }
      if (score.artist) {
        info.Author = score.artist;
      }
      const doc = new PDFDocument({ autoFirstPage: false, info });
      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      doc.registerFont(FONT_REGULAR, fonts.regular);
      doc.registerFont(FONT_BOLD, fonts.bold);
      // Load both fonts eagerly: svg-to-pdfkit would otherwise silently fall back to Helvetica,
      // producing garbled Japanese text instead of an error.
      doc.font(FONT_BOLD);
      doc.font(FONT_REGULAR);

      for (const svg of sheets) {
        doc.addPage({ size: [width, height], margin: 0 });
        SVGtoPDF(doc, svg, 0, 0, {
          width,
          height,
          assumePt: true,
          fontCallback: (_family: string, bold: boolean) => (bold ? FONT_BOLD : FONT_REGULAR)
        });
      }
      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

/** Writes the PDF atomically: a failed export never leaves a partial file at the target path. */
export async function writeScorePdf(
  targetPath: string,
  dslContent: string,
  pageSize: PageSize,
  orientation: PageOrientation,
  fonts: ScoreFontFiles,
  options?: { expandPageBreakRepeats?: boolean }
): Promise<void> {
  const pdf = await renderScorePdf(dslContent, pageSize, orientation, fonts, options);
  const tmpPath = `${targetPath}.${process.pid}.tmp`;
  try {
    await fs.promises.writeFile(tmpPath, pdf);
    await fs.promises.rename(tmpPath, targetPath);
  } catch (err) {
    await fs.promises.rm(tmpPath, { force: true });
    throw err;
  }
}
