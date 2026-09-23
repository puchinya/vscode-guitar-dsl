import * as assert from 'assert';
import { expandMeasureRepeat, parseGuitarDsl } from '../../src/compiler';
import { layoutScore } from '../../src/render/layout';
import { renderContinuousSvg, renderScoreSheets } from '../../src/render/svg';

describe('expandPageBreakRepeats (改ページ先頭%の自動展開)', () => {
  const dslWithPagebreak = `
title: Pagebreak Test
measures_per_row: 2
| C | 4.d 8.d 8.u 4.u 8.d 8.u |
| % |
pagebreak
| % |
| % |
`;

  it('defaults expandPageBreakRepeats to true', () => {
    const score = parseGuitarDsl(dslWithPagebreak);
    assert.strictEqual(score.expandPageBreakRepeats, true);
  });

  it('parses expand_page_break_repeats header options', () => {
    const scoreOff = parseGuitarDsl(`expand_page_break_repeats: off\n${dslWithPagebreak}`);
    assert.strictEqual(scoreOff.expandPageBreakRepeats, false);

    const scoreFalse = parseGuitarDsl(`expand_page_break_repeat: false\n${dslWithPagebreak}`);
    assert.strictEqual(scoreFalse.expandPageBreakRepeats, false);

    const scoreNo = parseGuitarDsl(`expand_page_repeat: no\n${dslWithPagebreak}`);
    assert.strictEqual(scoreNo.expandPageBreakRepeats, false);

    const scoreZero = parseGuitarDsl(`expand_page_repeats: 0\n${dslWithPagebreak}`);
    assert.strictEqual(scoreZero.expandPageBreakRepeats, false);

    const scoreOn = parseGuitarDsl(`expand_page_break_repeats: on\n${dslWithPagebreak}`);
    assert.strictEqual(scoreOn.expandPageBreakRepeats, true);
  });

  describe('expandMeasureRepeat helper', () => {
    it('expands % into preceding measure chords and rhythms', () => {
      const score = parseGuitarDsl(`
| G | 8.d 8.u 8.d 8.u 8.d 8.u 8.d 8.u |
| % |
`);
      assert.strictEqual(score.measures[1].isMeasureRepeat, true);
      assert.strictEqual(score.measures[1].rhythms.length, 0);

      const expanded = expandMeasureRepeat(score.measures[1], score.measures);
      assert.strictEqual(expanded.isMeasureRepeat, false);
      assert.strictEqual(expanded.expandedFromRepeat, true);
      assert.strictEqual(expanded.chord, 'G');
      assert.strictEqual(expanded.rhythms.length, 8);
      assert.strictEqual(expanded.rhythms[0].duration, '8');
      assert.strictEqual(expanded.rhythms[0].down, true);
    });

    it('traces back through chained % to find original source measure', () => {
      const score = parseGuitarDsl(`
| Am | 4.d 4.u 4.d 4.u |
| % |
| % |
| % |
`);
      const expanded = expandMeasureRepeat(score.measures[3], score.measures);
      assert.strictEqual(expanded.isMeasureRepeat, false);
      assert.strictEqual(expanded.chord, 'Am');
      assert.strictEqual(expanded.rhythms.length, 4);
    });

    it('preserves repeat barlines and brackets when expanding', () => {
      const score = parseGuitarDsl(`
| F | 4.d 4.u 4.d 4.u |
|: % [1.] :|
`);
      const expanded = expandMeasureRepeat(score.measures[1], score.measures);
      assert.strictEqual(expanded.isMeasureRepeat, false);
      assert.strictEqual(expanded.repeatStart, true);
      assert.strictEqual(expanded.repeatEnd, true);
      assert.strictEqual(expanded.bracket, '1.');
      assert.strictEqual(expanded.chord, 'F');
      assert.strictEqual(expanded.rhythms.length, 4);
    });
  });

  describe('layoutScore pagination expansion', () => {
    it('automatically expands % at start of page 2 by default', () => {
      const score = parseGuitarDsl(dslWithPagebreak);
      const layout = layoutScore(score, 'A4', 'portrait');

      assert.strictEqual(layout.pages.length, 2);

      // Page 1: measure 0 is C, measure 1 is %
      assert.strictEqual(layout.pages[0].rows[0].measures[0].isMeasureRepeat, false);
      assert.strictEqual(layout.pages[0].rows[0].measures[1].isMeasureRepeat, true);

      // Page 2: measure 0 was % in DSL, but expanded on layout
      const page2Measure0 = layout.pages[1].rows[0].measures[0];
      assert.strictEqual(page2Measure0.isMeasureRepeat, false);
      assert.strictEqual(page2Measure0.expandedFromRepeat, true);
      assert.strictEqual(page2Measure0.chord, 'C');
      assert.strictEqual(page2Measure0.rhythms.length, 6);

      // Page 2: measure 1 remains %
      const page2Measure1 = layout.pages[1].rows[0].measures[1];
      assert.strictEqual(page2Measure1.isMeasureRepeat, true);
    });

    it('does NOT expand % at start of page 2 when option is off', () => {
      const score = parseGuitarDsl(`expand_page_break_repeats: off\n${dslWithPagebreak}`);
      const layout = layoutScore(score, 'A4', 'portrait');

      assert.strictEqual(layout.pages.length, 2);
      // Page 2: measure 0 remains %
      assert.strictEqual(layout.pages[1].rows[0].measures[0].isMeasureRepeat, true);
    });

    it('does NOT expand % at start of row 2 on the same page', () => {
      const samePageDsl = `
measures_per_row: 2
| C | 4.d 4.u 4.d 4.u |
| % |
| % |
| % |
`;
      const score = parseGuitarDsl(samePageDsl);
      const layout = layoutScore(score, 'A4', 'portrait');

      assert.strictEqual(layout.pages.length, 1);
      assert.strictEqual(layout.pages[0].rows.length, 2);

      // Row 1: measure 0 (C, normal), measure 1 (%)
      assert.strictEqual(layout.pages[0].rows[0].measures[0].isMeasureRepeat, false);
      assert.strictEqual(layout.pages[0].rows[0].measures[1].isMeasureRepeat, true);

      // Row 2: measure 0 is still % (on the same page, so no pagebreak expansion)
      assert.strictEqual(layout.pages[0].rows[1].measures[0].isMeasureRepeat, true);
    });

    it('automatically expands % when row overflows to page 2 (auto-pagination)', () => {
      // Create enough rows to overflow a small paper (e.g. A5)
      const rows: string[] = [];
      rows.push('| C | 4.d 4.u 4.d 4.u |');
      for (let i = 0; i < 40; i++) {
        rows.push('| % |');
      }
      const score = parseGuitarDsl(rows.join('\n'));
      const layout = layoutScore(score, 'A5', 'portrait');

      assert.ok(layout.pages.length >= 2, 'Should paginate into at least 2 pages');
      // The first measure of page 2 must be expanded
      const page2FirstMeasure = layout.pages[1].rows[0].measures[0];
      assert.strictEqual(page2FirstMeasure.isMeasureRepeat, false);
      assert.strictEqual(page2FirstMeasure.expandedFromRepeat, true);
      assert.strictEqual(page2FirstMeasure.chord, 'C');
      assert.strictEqual(page2FirstMeasure.rhythms.length, 4);
    });
  });

  describe('SVG rendering', () => {
    it('renders expanded measure without simile mark at page 2 in sheets SVG', () => {
      const score = parseGuitarDsl(dslWithPagebreak);
      const sheets = renderScoreSheets(score, 'A4', 'portrait');
      assert.strictEqual(sheets.length, 2);

      // Sheet 2 contains page 2: the first measure is expanded, so it has rhythm slashes / stems
      assert.ok(sheets[1].includes('<polygon points=') || sheets[1].includes('<path d=') || sheets[1].includes('<line x1='));
    });

    it('renders continuous SVG with expanded measure after pagebreak separator', () => {
      const score = parseGuitarDsl(dslWithPagebreak);
      const svg = renderContinuousSvg(score, 'A4');
      assert.ok(svg.includes('continuous-svg'));
      assert.ok(svg.includes('PAGE BREAK (2)'));
    });
  });
});
