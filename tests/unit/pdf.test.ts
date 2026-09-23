import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { getBundledFontFiles, renderScorePdf, writeScorePdf } from '../../src/pdf';

const fonts = getBundledFontFiles(path.resolve(__dirname, '../..'));

function countPages(pdf: Buffer): number {
  return (pdf.toString('latin1').match(/\/Type \/Page\b/g) || []).length;
}

describe('pdf - browser-free export', () => {
  const dsl = [
    'title: 風のコンパス',
    'artist: テスト',
    '[Aメロ]',
    '| C | G | Am | F | l:"あさのひかり"',
    'pagebreak',
    '| C | G | Am | F |'
  ].join('\n');

  it('bundled Noto Sans JP fonts should exist', () => {
    assert.ok(fs.existsSync(fonts.regular));
    assert.ok(fs.existsSync(fonts.bold));
  });

  it('should render one PDF page per sheet with embedded font subsets', async () => {
    const portrait = await renderScorePdf(dsl, 'A4', 'portrait', fonts);
    assert.strictEqual(portrait.subarray(0, 5).toString('latin1'), '%PDF-');
    assert.strictEqual(countPages(portrait), 2);
    assert.ok(portrait.toString('latin1').includes('/FontFile2'), 'TrueType font must be embedded');
    // Subset embedding keeps the file far smaller than the ~5MB source fonts
    assert.ok(portrait.length < 500 * 1024);

    const landscape = await renderScorePdf(dsl, 'A4', 'landscape', fonts);
    assert.strictEqual(countPages(landscape), 1);
  });

  it('should render scores without artist / title metadata', async () => {
    for (const input of ['| C | G |', 'title:\nartist:\n| C |', '']) {
      const pdf = await renderScorePdf(input, 'A4', 'portrait', fonts);
      assert.strictEqual(pdf.subarray(0, 5).toString('latin1'), '%PDF-');
      assert.ok(!pdf.toString('latin1').includes('/Author'), 'Author must be omitted when artist is empty');
    }
  });

  it('should set Author metadata when artist is given', async () => {
    const pdf = await renderScorePdf('artist: Someone\n| C |', 'A4', 'portrait', fonts);
    assert.ok(pdf.toString('latin1').includes('/Author'));
  });

  it('should write the PDF to the target path', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'guitardsl-pdf-'));
    try {
      const target = path.join(dir, 'score.pdf');
      await writeScorePdf(target, dsl, 'A5', 'portrait', fonts);
      assert.ok(fs.readFileSync(target).subarray(0, 5).toString('latin1') === '%PDF-');
      assert.deepStrictEqual(fs.readdirSync(dir), ['score.pdf']);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('should fail without leaving a partial file when the font is missing', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'guitardsl-pdf-'));
    try {
      const target = path.join(dir, 'score.pdf');
      await assert.rejects(writeScorePdf(target, dsl, 'A4', 'portrait', { regular: path.join(dir, 'none.ttf'), bold: path.join(dir, 'none.ttf') }));
      assert.deepStrictEqual(fs.readdirSync(dir), []);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
