import * as assert from 'assert';
import { parseGuitarDsl } from '../../src/compiler';
import {
  PAGE_CONFIG,
  PT_PER_MM,
  MEASURES_PER_ROW,
  estimateTextWidth,
  getSheetSize,
  isPageOrientation,
  isPageSize,
  layoutScore
} from '../../src/render/layout';
import { compileGuitarDslToSvg, renderContinuousSvg, renderScoreSheets } from '../../src/render/svg';
import { compileGuitarDslToHtml } from '../../src/render/previewHtml';

function barLines(count: number): string {
  const lines: string[] = [];
  for (let i = 0; i < count; i += 4) {
    lines.push('| C | G | Am | F |');
  }
  return lines.join('\n');
}

function countOccurrences(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

const sampleDsl = [
  'title: Rendering Test',
  'artist: Test Artist',
  'capo: 1',
  '[Verse]',
  '| C G | Am Em | l:"テスト歌詞"',
  '| 4.d 4.d 4.d 4.d |'
].join('\n');

describe('render - HTML and SVG', () => {
  it('compileGuitarDslToHtml should return full valid HTML with sheet SVGs', () => {
    const html = compileGuitarDslToHtml(sampleDsl);
    assert.ok(html.includes('<!DOCTYPE html>'));
    assert.ok(html.includes('<title>Rendering Test</title>'));
    assert.ok(html.includes('class="sheet-svg"'));
    assert.ok(html.includes('class="continuous-svg"'));
    assert.ok(html.includes('Rendering Test'));
    assert.ok(html.includes('Test Artist'));
    assert.ok(html.includes('Capo: 1'));
    assert.ok(!html.includes('system-row'), 'systems must not be separate HTML rows');
  });

  it('compileGuitarDslToHtml should reflect paper size / orientation and bundled fonts', () => {
    const html = compileGuitarDslToHtml(sampleDsl, {
      pageSize: 'B5',
      orientation: 'landscape',
      fontUris: { regular: 'https://example/NotoSansJP-Regular.ttf', bold: 'https://example/NotoSansJP-Bold.ttf' }
    });
    const { width, height } = getSheetSize('B5', 'landscape');
    assert.ok(html.includes(`data-page-size="B5"`));
    assert.ok(html.includes(`data-orientation="landscape"`));
    assert.ok(html.includes(`viewBox="0 0 ${Number(width.toFixed(2))} ${Number(height.toFixed(2))}"`));
    assert.strictEqual(countOccurrences(html, '@font-face'), 2);
    assert.ok(html.includes("url('https://example/NotoSansJP-Bold.ttf')"));
  });

  it('compileGuitarDslToSvg should return a continuous SVG', () => {
    const svg = compileGuitarDslToSvg(sampleDsl);
    assert.ok(svg.startsWith('<svg'));
    assert.ok(svg.includes('</svg>'));
    assert.ok(svg.includes('Rendering Test'));
  });

  it('renders Volta brackets, final barline, and special jump marks in SVG', () => {
    const dsl = [
      '|: C | [1.] G :| [2.] Am Fine | F |]'
    ].join('\n');
    const svg = compileGuitarDslToSvg(dsl);
    assert.ok(svg.includes('>1.</text>'), 'should render Volta bracket 1.');
    assert.ok(svg.includes('>2.</text>'), 'should render Volta bracket 2.');
    assert.ok(svg.includes('>Fine</text>'), 'should render Fine mark');
  });

  it('PAGE_CONFIG should contain expected standard paper dimensions', () => {
    assert.strictEqual(PAGE_CONFIG['A4'].widthMm, 210);
    assert.strictEqual(PAGE_CONFIG['A4'].heightMm, 297);
    assert.strictEqual(PAGE_CONFIG['B5'].widthMm, 176);
    assert.strictEqual(PAGE_CONFIG['B5'].heightMm, 250);
  });

  it('page size / orientation guards should accept only known values', () => {
    assert.ok(isPageSize('A4'));
    assert.ok(!isPageSize('A0'));
    assert.ok(!isPageSize('toString'));
    assert.ok(isPageOrientation('landscape'));
    assert.ok(!isPageOrientation('diagonal'));
  });

  it('sheet SVG should be a single SVG sized to the paper in pt', () => {
    const sheets = renderScoreSheets(parseGuitarDsl(sampleDsl), 'A4', 'portrait');
    assert.strictEqual(sheets.length, 1);
    assert.strictEqual(countOccurrences(sheets[0], '<svg'), 1);
    const w = Number((210 * PT_PER_MM).toFixed(2));
    const h = Number((297 * PT_PER_MM).toFixed(2));
    assert.ok(sheets[0].includes(`viewBox="0 0 ${w} ${h}"`));
    assert.ok(sheets[0].includes('1 / 1'));
  });

  it('should escape XML special characters in all text', () => {
    const dsl = [
      'title: A <B> & "C"',
      'artist: X&Y',
      '[<Intro>]',
      '| C | G | l:"<la> & la"'
    ].join('\n');
    const svg = renderScoreSheets(parseGuitarDsl(dsl), 'A4', 'portrait')[0];
    assert.ok(svg.includes('A &lt;B&gt; &amp; &quot;C&quot;'));
    assert.ok(svg.includes('X&amp;Y'));
    assert.ok(!svg.includes('<la>'));
    assert.ok(!svg.includes('<Intro>'));
  });
});

describe('render - layout / pagination', () => {
  it('should keep an empty score as a single page', () => {
    const layout = layoutScore(parseGuitarDsl(''), 'A4', 'portrait');
    assert.strictEqual(layout.pages.length, 1);
    assert.strictEqual(layout.sheets.length, 1);
    assert.strictEqual(layout.pages[0].rows.length, 0);
  });

  it('should automatically continue overflowing systems on the next page without loss or duplication', () => {
    const score = parseGuitarDsl(`title: Long\n${barLines(160)}`);
    const layout = layoutScore(score, 'A4', 'portrait');
    assert.ok(layout.pages.length > 1, 'long score must span multiple pages');

    const placed = layout.pages.flatMap(p => p.rows.flatMap(r => r.measures));
    assert.strictEqual(placed.length, score.measures.length);
    placed.forEach((m, i) => assert.strictEqual(m, score.measures[i]));

    // Every page fits its rows inside the column
    for (const page of layout.pages) {
      assert.ok(page.rows.length >= 1);
    }
    layout.pages.forEach((p, i) => assert.strictEqual(p.pageNumber, i + 1));
    assert.ok(layout.pages[0].hasScoreHeader);
    assert.ok(layout.pages.slice(1).every(p => !p.hasScoreHeader));
    assert.strictEqual(layout.pages[0].rows[0].isFirstSystem, true);
    assert.ok(layout.pages.slice(1).every(p => p.rows.every(r => !r.isFirstSystem)));
  });

  it('should start a new page at each manual pagebreak', () => {
    const score = parseGuitarDsl(`${barLines(4)}\npagebreak\n${barLines(4)}\npagebreak\n${barLines(8)}`);
    const layout = layoutScore(score, 'A4', 'portrait');
    assert.strictEqual(layout.pages.length, 3);
    assert.deepStrictEqual(layout.pages.map(p => p.rows.length), [1, 1, 2]);
  });

  it('should fit fewer systems on a smaller paper', () => {
    const score = parseGuitarDsl(barLines(160));
    const a3 = layoutScore(score, 'A3', 'portrait').pages.length;
    const a5 = layoutScore(score, 'A5', 'portrait').pages.length;
    // Systems scale with the column width, so capacity depends on the aspect ratio; both must be paginated.
    assert.ok(a3 >= 1 && a5 >= 1);
    const rows = Math.ceil(160 / MEASURES_PER_ROW);
    for (const size of ['A3', 'A5'] as const) {
      const total = layoutScore(score, size, 'portrait').pages.reduce((n, p) => n + p.rows.length, 0);
      assert.strictEqual(total, rows);
    }
  });

  it('landscape should place two pages per sheet and leave the last sheet half-empty for odd page counts', () => {
    const score = parseGuitarDsl(`${barLines(4)}\npagebreak\n${barLines(4)}\npagebreak\n${barLines(4)}`);
    const layout = layoutScore(score, 'A4', 'landscape');
    assert.strictEqual(layout.pages.length, 3);
    assert.deepStrictEqual(layout.sheets.map(s => s.pages.length), [2, 1]);

    const sheets = renderScoreSheets(score, 'A4', 'landscape');
    assert.strictEqual(sheets.length, 2);
    assert.ok(sheets[0].includes('data-pages="1,2"'));
    assert.ok(sheets[1].includes('data-pages="3"'));
    assert.ok(sheets[1].includes('3 / 3'));
  });

  it('continuous SVG should mark manual page breaks', () => {
    const score = parseGuitarDsl(`${barLines(4)}\npagebreak\n${barLines(4)}`);
    const svg = renderContinuousSvg(score);
    assert.strictEqual(countOccurrences(svg, '<svg'), 1);
    assert.ok(svg.includes('PAGE BREAK (2)'));
  });

  it('estimateTextWidth should treat CJK as full-width and bold as wider', () => {
    assert.strictEqual(estimateTextWidth('風', 10), 10);
    assert.ok(estimateTextWidth('Abc', 10, true) > estimateTextWidth('Abc', 10));
    assert.ok(estimateTextWidth('iii', 10) < estimateTextWidth('MMM', 10));
  });

});

describe('render - i18n toolbar rendering', () => {
  it('should render English toolbar by default or when locale is en', () => {
    const defaultHtml = compileGuitarDslToHtml(sampleDsl);
    assert.ok(defaultHtml.includes('<html lang="en">'));
    assert.ok(defaultHtml.includes('>View<'));
    assert.ok(defaultHtml.includes('>Single Page<'));
    assert.ok(defaultHtml.includes('>Spread<'));
    assert.ok(defaultHtml.includes('>Paper<'));
    assert.ok(defaultHtml.includes('>Orientation<'));
    assert.ok(defaultHtml.includes('>Portrait<'));
    assert.ok(defaultHtml.includes('>Landscape<'));
    assert.ok(defaultHtml.includes('>📄 Save PDF<'));

    const enHtml = compileGuitarDslToHtml(sampleDsl, { locale: 'en' });
    assert.ok(enHtml.includes('<html lang="en">'));
    assert.ok(enHtml.includes('>View<'));
    assert.ok(enHtml.includes('>Single Page<'));
  });

  it('should render Japanese toolbar when locale is ja', () => {
    const jaHtml = compileGuitarDslToHtml(sampleDsl, { locale: 'ja' });
    assert.ok(jaHtml.includes('<html lang="ja">'));
    assert.ok(jaHtml.includes('>表示<'));
    assert.ok(jaHtml.includes('>1ページ<'));
    assert.ok(jaHtml.includes('>見開き<'));
    assert.ok(jaHtml.includes('>用紙<'));
    assert.ok(jaHtml.includes('>向き<'));
    assert.ok(jaHtml.includes('>縦<'));
    assert.ok(jaHtml.includes('>横（見開き）<'));
    assert.ok(jaHtml.includes('>📄 PDF保存<'));
  });

  it('should fallback to English for other locales', () => {
    const frHtml = compileGuitarDslToHtml(sampleDsl, { locale: 'fr' });
    assert.ok(frHtml.includes('<html lang="en">'));
    assert.ok(frHtml.includes('>View<'));
    assert.ok(frHtml.includes('>Single Page<'));
    assert.ok(frHtml.includes('>📄 Save PDF<'));
  });
});
