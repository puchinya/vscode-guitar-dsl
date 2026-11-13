import regularFontUrl from '../../media/fonts/NotoSansJP-Regular.ttf?url';
import boldFontUrl from '../../media/fonts/NotoSansJP-Bold.ttf?url';
import type { PageOrientation, PageSize } from '@guitardsl/pdf';

export const scoreFontUrls = { regular: regularFontUrl, bold: boldFontUrl };

export interface BrowserPdfOptions {
  pageSize: PageSize;
  orientation: PageOrientation;
  expandPageBreakRepeats: boolean;
}

/** Browser adapter: load the shared score fonts, render the shared page SVGs, and download the PDF bytes. */
export async function downloadScorePdf(source: string, documentName: string, options: BrowserPdfOptions): Promise<void> {
  const { renderPdfBytes } = await import('@guitardsl/pdf');
  const [regularResponse, boldResponse] = await Promise.all([fetch(regularFontUrl), fetch(boldFontUrl)]);
  if (!regularResponse.ok || !boldResponse.ok) throw new Error('Bundled score fonts could not be loaded.');
  const [regular, bold] = await Promise.all([
    regularResponse.arrayBuffer().then(bytes => new Uint8Array(bytes)),
    boldResponse.arrayBuffer().then(bytes => new Uint8Array(bytes))
  ]);
  const bytes = await renderPdfBytes(source, options, { regular, bold });
  const pdfBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const blobUrl = URL.createObjectURL(new Blob([pdfBuffer], { type: 'application/pdf' }));
  try {
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = `${documentName.replace(/\.(guitardsl|gdsl)$/i, '') || 'score'}.pdf`;
    link.click();
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(blobUrl), 10_000);
  }
}
