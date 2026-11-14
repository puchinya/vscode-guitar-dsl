import * as fs from 'fs';
import * as path from 'path';
import { renderPdfBytes, type PageOrientation, type PageSize } from '@guitardsl/pdf';

export interface ScoreFontFiles {
  regular: string;
  bold: string;
}

/** Bundled font locations relative to the extension root. */
export function getBundledFontFiles(extensionRoot: string): ScoreFontFiles {
  const dir = path.join(extensionRoot, 'media', 'fonts');
  return {
    regular: path.join(dir, 'NotoSansJP-Regular.ttf'),
    bold: path.join(dir, 'NotoSansJP-Bold.ttf')
  };
}

/** Node host adapter: load the shared renderer's font bytes and return a Node Buffer. */
export async function renderScorePdf(
  dslContent: string,
  pageSize: PageSize,
  orientation: PageOrientation,
  fonts: ScoreFontFiles,
  options?: { expandPageBreakRepeats?: boolean }
): Promise<Buffer> {
  const [regular, bold] = await Promise.all([
    fs.promises.readFile(fonts.regular),
    fs.promises.readFile(fonts.bold)
  ]);
  const bytes = await renderPdfBytes(dslContent, {
    pageSize,
    orientation,
    expandPageBreakRepeats: options?.expandPageBreakRepeats
  }, { regular, bold });
  return Buffer.from(bytes);
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
  } catch (error) {
    await fs.promises.rm(tmpPath, { force: true });
    throw error;
  }
}
