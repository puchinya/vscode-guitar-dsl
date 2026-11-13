import PDFDocument from 'pdfkit';
import SVGtoPDF from 'svg-to-pdfkit';
import { parseGuitarDsl } from '@guitardsl/core/compiler';
import { PageOrientation, PageSize, getSheetSize } from '@guitardsl/core/render/layout';
import { renderScoreSheets } from '@guitardsl/core/render/svg';

export interface PdfFontBytes {
  regular: Uint8Array;
  bold: Uint8Array;
}

export interface PdfRenderOptions {
  pageSize: PageSize;
  orientation: PageOrientation;
  expandPageBreakRepeats?: boolean;
}

const FONT_REGULAR = 'ScoreRegular';
const FONT_BOLD = 'ScoreBold';

/** Render the shared score-page SVGs into portable PDF bytes without host file APIs. */
export function renderPdfBytes(
  dslContent: string,
  options: PdfRenderOptions,
  fontBytes: PdfFontBytes
): Promise<Uint8Array> {
  const score = parseGuitarDsl(dslContent, { expandPageBreakRepeats: options.expandPageBreakRepeats });
  const sheets = renderScoreSheets(score, options.pageSize, options.orientation);
  const { width, height } = getSheetSize(options.pageSize, options.orientation);

  return new Promise<Uint8Array>((resolve, reject) => {
    try {
      const info: PDFKit.DocumentInfo = { Creator: 'GuitarDSL Previewer' };
      if (score.title) info.Title = score.title;
      if (score.artist) info.Author = score.artist;

      const doc = new PDFDocument({ autoFirstPage: false, info, font: null as never });
      const chunks: Uint8Array[] = [];
      doc.on('data', (chunk: Uint8Array) => chunks.push(new Uint8Array(chunk)));
      doc.on('end', () => {
        const total = chunks.reduce((size, chunk) => size + chunk.byteLength, 0);
        const bytes = new Uint8Array(total);
        let offset = 0;
        for (const chunk of chunks) {
          bytes.set(chunk, offset);
          offset += chunk.byteLength;
        }
        resolve(bytes);
      });
      doc.on('error', reject);

      // Keep the shared API host-neutral; the browser and Node PDFKit builds accept byte arrays.
      doc.registerFont(FONT_REGULAR, fontBytes.regular as never);
      doc.registerFont(FONT_BOLD, fontBytes.bold as never);
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
    } catch (error) {
      reject(error);
    }
  });
}

export type { PageOrientation, PageSize };
