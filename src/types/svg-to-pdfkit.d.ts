declare module 'svg-to-pdfkit' {
  interface SVGtoPDFOptions {
    width?: number;
    height?: number;
    preserveAspectRatio?: string;
    assumePt?: boolean;
    useCSS?: boolean;
    fontCallback?: (family: string, bold: boolean, italic: boolean, fontOptions: { fauxItalic: boolean; fauxBold: boolean }) => string;
    warningCallback?: (message: string) => void;
  }
  function SVGtoPDF(doc: PDFKit.PDFDocument, svg: string, x?: number, y?: number, options?: SVGtoPDFOptions): void;
  export = SVGtoPDF;
}
