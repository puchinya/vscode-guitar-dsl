import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { parseGuitarDsl } from '../../src/compiler';
import { SYSTEM_UNIT_HEIGHT, getSystemGeometry, layoutScore, splitIntoRows } from '../../src/render/layout';
import { renderContinuousSvg, renderScoreSheets } from '../../src/render/svg';

// Unique fragments of the vector accidental glyphs (src/render/notation.ts).
const SHARP = 'x1="-1.6" y1="-7"';
const FLAT = 'x1="-2.2" y1="-10"';
const NATURAL = 'x1="-2" y1="-8"';

function count(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

function svgOf(dsl: string): string {
  return renderContinuousSvg(parseGuitarDsl(dsl));
}

describe('render - melody systems', () => {
  it('keeps rhythm-only systems at the original height', () => {
    const score = parseGuitarDsl('| C | 4.d 4.d 4.d 4.d |');
    assert.strictEqual(getSystemGeometry(score.measures, score).unitHeight, SYSTEM_UNIT_HEIGHT);
    assert.strictEqual(getSystemGeometry(score.measures, score).kind, 'rhythm');
  });

  it('grows melody systems with the number of verses', () => {
    const one = parseGuitarDsl(['| C | % |', 'mel: | c5/1 |', 'lyr: あ'].join('\n'));
    const two = parseGuitarDsl(['| C | % |', 'mel: | c5/1 |', 'lyr: あ', 'lyr: い'].join('\n'));
    const g1 = getSystemGeometry(one.measures, one);
    const g2 = getSystemGeometry(two.measures, two);
    assert.strictEqual(g1.kind, 'melody');
    assert.ok(g1.unitHeight > SYSTEM_UNIT_HEIGHT);
    assert.strictEqual(g2.unitHeight - g1.unitHeight, g1.lyricLineHeight);
    assert.strictEqual(g2.rhythmOffset - g1.rhythmOffset, g1.lyricLineHeight);
  });

  it('draws one notehead per melody head and the syllables', () => {
    const svg = svgOf(['| C | % |', 'mel: | c5/4 d e/2 |', 'lyr: ドレミ'].join('\n'));
    assert.strictEqual(count(svg, '<ellipse'), 3);
    for (const syl of ['ド', 'レ', 'ミ']) {
      assert.ok(svg.includes(`>${syl}</text>`), syl);
    }
  });

  it('splits added note values into tied heads', () => {
    const svg = svgOf(['| C | % |', 'mel: | c5/2+8 r/8 d/4 |'].join('\n'));
    assert.strictEqual(count(svg, '<ellipse'), 3);
  });

  it('draws key signatures and only the accidentals that differ from the key', () => {
    // D major: f# and c# need no accidental, f natural does.
    const svg = svgOf(['key: D', '| D | % |', 'mel: | f#4/4 c#5 f4 a |'].join('\n'));
    assert.strictEqual(count(svg, SHARP), 2, 'two sharps of the key signature only');
    assert.strictEqual(count(svg, NATURAL), 1);
  });

  it('keeps accidentals for the rest of the measure and resets at the barline', () => {
    const svg = svgOf(['| C | % |', '| C | % |', 'mel: | f#4/4 f# f f# | f#4/1 |'].join('\n'));
    // m1: sharp, (held), natural, sharp again; m2: sharp again after the barline.
    assert.strictEqual(count(svg, SHARP), 3);
    assert.strictEqual(count(svg, NATURAL), 1);
  });

  it('handles flat keys, minor keys and tied notes', () => {
    // F major: bb needs no accidental, b natural does.
    const f = svgOf(['key: F', '| F | % |', 'mel: | bb4/2 b4/2 |'].join('\n'));
    assert.strictEqual(count(f, FLAT), 1, 'only the key signature flat');
    assert.strictEqual(count(f, NATURAL), 1);
    // D minor has one flat as well.
    assert.strictEqual(count(svgOf(['key: Dm', '| Dm | % |', 'mel: | d4/1 |'].join('\n')), FLAT), 1);
    // A tied f# carried into the next measure is not marked again.
    const tie = svgOf(['| C | % |', '| C | % |', 'mel: | c5/2. f#4/4~ | f#4/1 |'].join('\n'));
    assert.strictEqual(count(tie, SHARP), 1);
  });

  it('draws a bracket for unbeamed triplets', () => {
    const svg = svgOf(['| C | % |', 'mel: | c5/4t d e f/2 |'].join('\n'));
    assert.strictEqual(count(svg, '>3</text>'), 1);
    assert.ok(svg.includes('stroke-width="0.8"/><text'), 'bracket path precedes the number');
  });

  it('draws beat slashes for melody-less measures in a lead-sheet system', () => {
    const mixed = renderContinuousSvg(parseGuitarDsl([
      'show_rhythm: false',
      'measures_per_row: 2',
      '[A]',
      '| C | 4.d 4.d 4.d 4.d l:"らら" |',
      '[B]',
      '| G | 4.d 4.d 4.d 4.d |',
      'mel: | c5/1 |'
    ].join('\n')));
    // 4 beat slashes (no stems, no stroke marks) for the melody-less measure, plus its l:"..." lyric.
    assert.strictEqual(count(mixed, 'stroke-linejoin="round" opacity="1.0"/>'), 0);
    assert.strictEqual(count(mixed, '<polygon'), 4);
    assert.ok(mixed.includes('らら'));
  });

  it('draws flats with vector paths', () => {
    const svg = svgOf(['| C | % |', 'mel: | bb4/1 |'].join('\n'));
    assert.strictEqual(count(svg, FLAT), 1);
  });

  it('marks triplets on the melody and the rhythm staff', () => {
    const svg = svgOf(['| C | 8t.d 8t.u 8t.d 4.d 2.d |', 'mel: | b4/8t a g f/4 e/2 |'].join('\n'));
    assert.strictEqual(count(svg, 'font-style="italic" text-anchor="middle" fill="#000">3</text>'), 2);
  });

  it('suppresses l:"..." in measures that have a melody', () => {
    const svg = svgOf(['| C | 1.d l:"MEASURELYRIC" |', '| G | 1.d l:"KEPT" |', 'mel: | c5/1 |'].join('\n'));
    assert.ok(!svg.includes('MEASURELYRIC'));
    assert.ok(svg.includes('KEPT'));
  });

  it('omits the rhythm staff in lead-sheet mode but falls back for systems without melody', () => {
    const score = parseGuitarDsl([
      'show_rhythm: false',
      'measures_per_row: 1',
      '| C | 4.d 4.d 4.d 4.d |',
      'mel: | c5/1 |',
      '| G | 4.d 4.d 4.d 4.d |'
    ].join('\n'));
    const rows = splitIntoRows(score)[0];
    assert.deepStrictEqual(rows.map(r => r.geometry.kind), ['leadSheet', 'rhythm']);
    assert.ok(rows[0].geometry.unitHeight < SYSTEM_UNIT_HEIGHT + rows[0].geometry.rhythmOffset + 1);
    const svg = renderContinuousSvg(score);
    // Stroke marks (down-stroke path) only come from the rhythm staff of the second system.
    assert.strictEqual(count(svg, 'stroke-linejoin="round" opacity="1.0"/>'), 4);
  });

  it('applies measures_per_row and paginates variable-height systems', () => {
    const lines = ['measures_per_row: 2'];
    for (let i = 0; i < 40; i++) {
      lines.push('| C | % |', 'mel: | c5/2 d |', 'lyr: あい', 'lyr: うえ');
    }
    const score = parseGuitarDsl(lines.join('\n'));
    assert.strictEqual(splitIntoRows(score)[0].length, 20);
    const layout = layoutScore(score, 'A4', 'portrait');
    const rows = layout.pages.reduce((acc, p) => acc + p.rows.length, 0);
    assert.strictEqual(rows, 20);
    for (const page of layout.pages) {
      const used = page.rows.reduce((acc, r) => acc + r.geometry.unitHeight * layout.systemScale + layout.systemGap, 0);
      assert.ok(page.rows.length === 1 || used <= layout.columnHeight, `page ${page.pageNumber} overflows`);
    }
    assert.ok(layout.pages.length > 1);
  });

  it('renders the bundled melody samples as sheets', () => {
    for (const name of ['sample_melody.guitardsl', 'sample_leadsheet.guitardsl']) {
      const dsl = fs.readFileSync(path.join(__dirname, '..', '..', 'samples', name), 'utf8');
      const sheets = renderScoreSheets(parseGuitarDsl(dsl), 'A4', 'portrait');
      assert.ok(sheets.length >= 1, name);
      assert.ok(sheets.every(s => s.includes('<ellipse')), name);
    }
  });
});
