import * as assert from 'assert';
import { parseGuitarDsl } from '../../src/compiler';
import { getSystemGeometry, splitIntoRows } from '../../src/render/layout';
import { renderContinuousSvg, renderScoreSheets } from '../../src/render/svg';
import { getRenderContext, renderTimeSignature, systemPrefix } from '../../src/render/notation';

function tabRestGlyph(svg: string, base: number): string {
  const marker = `<g class="tab-rest-glyph" data-base="${base}">`;
  const start = svg.indexOf(marker);
  assert.ok(start >= 0, `missing TAB rest glyph for base ${base}`);
  const groupTag = /<\/?g\b[^>]*>/g;
  groupTag.lastIndex = start;
  let depth = 0;
  for (let match = groupTag.exec(svg); match; match = groupTag.exec(svg)) {
    depth += match[0].startsWith('</') ? -1 : 1;
    if (depth === 0) return svg.slice(start, groupTag.lastIndex);
  }
  assert.fail(`unterminated TAB rest glyph for base ${base}`);
}

describe('TAB rendering and layout', () => {
  it('renders six string lines and authored fret values through the continuous SVG path', () => {
    const score = parseGuitarDsl('| C |\ntab: | [6f3,5f2,4f0,3f0,2f0,1f3]/1 |');
    const svg = renderContinuousSvg(score);
    assert.strictEqual((svg.match(/class="tab-string-line"/g) ?? []).length, 6);
    assert.strictEqual((svg.match(/class="tab-clef-letter"/g) ?? []).length, 3);
    assert.ok(svg.includes('>T</text>'));
    assert.ok(svg.includes('>A</text>'));
    assert.ok(svg.includes('>B</text>'));
    for (const fret of ['3', '2', '0']) assert.ok(svg.includes(`>${fret}</text>`));
    assert.ok(svg.includes('font-size="10" font-weight="600"'));
    assert.ok(svg.includes('data-string="1"'));
    assert.ok(svg.includes('data-string="6"'));
  });

  it('keeps TAB visible when slash rhythm is hidden and suppresses an implicit rhythm staff', () => {
    const score = parseGuitarDsl('show_rhythm: false\n| C |\ntab: | 6f0/1 |');
    const geometry = getSystemGeometry(score.measures, score);
    assert.strictEqual(geometry.containsTab, true);
    assert.strictEqual(geometry.tabStaffHeight, 50);
    assert.strictEqual(geometry.rhythmRendered, false);
    const svg = renderContinuousSvg(score);
    assert.ok(svg.includes('class="tab-staff"'));
    assert.strictEqual((svg.match(/class="tab-string-line"/g) ?? []).length, 6);
  });

  it('uses local coordinates, a 50-unit equal-weight staff, and lines through the prefix', () => {
    const score = parseGuitarDsl('| C |\ntab: | 6f0/1 |');
    const geometry = getSystemGeometry(score.measures, score);
    const svg = renderContinuousSvg(score);
    const lines = [...svg.matchAll(/<line class="tab-string-line"[^>]*>/g)].map(match => match[0]);
    assert.strictEqual(lines.length, 6);
    assert.deepStrictEqual(lines.map(line => Number(line.match(/y1="([^"]+)/)?.[1])), [0, 10, 20, 30, 40, 50]);
    assert.ok(lines.every(line => line.includes('x1="25"') && line.includes('stroke-width="0.9"')));
    assert.ok(getRenderContext(score).startX > 25, 'measure content retains its existing left edge');
    assert.ok(svg.includes(`translate(0, ${geometry.tabOffset})`));
    assert.strictEqual(svg.split(`translate(0, ${geometry.tabOffset})`).length - 1, 1);
    assert.ok(svg.includes(`x1="${geometry.tabOffset}"`) === false, 'staff-local coordinates must not repeat the system offset');
    assert.strictEqual(geometry.tabLyricBaseline, geometry.tabOffset + 50 + 22);
  });

  it('centers TAB time signatures while keeping standard-staff output byte-equivalent', () => {
    for (const source of ['| C |', 'time: 12/8\n| C |']) {
      const score = parseGuitarDsl(`${source}\ntab: | 6f0/1 |`);
      const ctx = getRenderContext(score);
      const prefix = systemPrefix(ctx, score.measures[0], true);
      const standard = renderTimeSignature(prefix, 0);
      const tab = renderTimeSignature(prefix, 0, 10);
      assert.strictEqual(renderTimeSignature(prefix, 0, 8), standard);
      assert.ok(standard.includes('y="14"') && standard.includes('y="30"'));
      assert.ok(tab.includes('y="17.5"') && tab.includes('y="37.5"'));
    }
  });

  it('draws line-break masks and places stems beyond measured multi-digit fret marks', () => {
    const score = parseGuitarDsl('| C |\ntab: | 1f9/4 1f10/4 1f12/4 1f24/4 |');
    const svg = renderContinuousSvg(score);
    assert.strictEqual((svg.match(/class="tab-fret-mask"/g) ?? []).length, 4);
    assert.ok(!/class="tab-fret"[^>]*paint-order="stroke"/.test(svg));
    const marks = [...svg.matchAll(/<text class="tab-fret"[^>]*>(\d+)<\/text>/g)];
    const stems = [...svg.matchAll(/<line class="tab-stem"[^>]*x1="([^"]+)"[^>]*data-mark-right="([^"]+)"/g)];
    assert.deepStrictEqual(marks.map(match => match[1]), ['9', '10', '12', '24']);
    assert.strictEqual(stems.length, 4);
    assert.ok(stems.every(match => Number(match[1]) >= Number(match[2]) + 2));
  });

  it('gives whole, half, quarter, eighth and sixteenth notes distinct rhythm marks', () => {
    const score = parseGuitarDsl('| C | D | E | F | G |\ntab: | 1f0/1 | 1f1/2 | 1f2/4 | 1f3/8 1f4/8 | 1f5/16 1f6/16 1f7/16 1f8/16 |');
    const svg = renderContinuousSvg(score);
    assert.strictEqual((svg.match(/class="tab-stem-short"/g) ?? []).length, 1);
    assert.strictEqual((svg.match(/class="tab-stem-full"/g) ?? []).length, 7);
    assert.strictEqual((svg.match(/class="tab-beam-secondary"/g) ?? []).length, 1);
    assert.strictEqual((svg.match(/class="tab-stem-short"/g) ?? []).length, 1, 'whole notes have no stem');
  });

  it('keeps a dotted whole-note augmentation dot visible', () => {
    const score = parseGuitarDsl('| C |\ntab: | 1f0/1. |');
    assert.strictEqual((renderContinuousSvg(score).match(/class="tab-duration-dot"/g) ?? []).length, 1);
  });

  it('renders ascending and descending slides with opposite diagonal slopes', () => {
    const up = renderContinuousSvg(parseGuitarDsl('| C |\ntab: | 3f5{slide}/2 3f7/2 |'));
    const down = renderContinuousSvg(parseGuitarDsl('| C |\ntab: | 3f7{slide}/2 3f5/2 |'));
    const read = (svg: string) => svg.match(/<line class="technique-slide"[^>]*x1="([^"]+)" y1="([^"]+)" x2="([^"]+)" y2="([^"]+)"/);
    const ascending = read(up);
    const descending = read(down);
    assert.ok(ascending && descending);
    assert.ok(Number(ascending[4]) < Number(ascending[2]));
    assert.ok(Number(descending[4]) > Number(descending[2]));
  });

  it('keeps ties, H/P arcs and slides outside multi-digit fret marks', () => {
    const linked = renderContinuousSvg(parseGuitarDsl('| C |\ntab: | 3f10{hammer}~/2 3f10/2 |'));
    const sliding = renderContinuousSvg(parseGuitarDsl('| C |\ntab: | 3f10{slide}/2 3f12/2 |'));
    const marks = [...linked.matchAll(/<rect class="tab-fret-mask" data-string="3" data-mark-width="([\d.]+)"[^>]*width="[\d.]+"[^>]*\/>/g)];
    const centers = [...linked.matchAll(/<text class="tab-fret" data-string="3" x="([\d.]+)"/g)].map(match => Number(match[1]));
    assert.strictEqual(marks.length, 2);
    assert.strictEqual(centers.length, 2);
    const halfWidths = marks.map(match => Number(match[1]) / 2);
    const left = centers[0] + halfWidths[0] + 4;
    const right = centers[1] - halfWidths[1] - 4;
    for (const className of ['tab-tie', 'technique-hammer']) {
      const block = linked.match(new RegExp(`<g class="${className}"[^>]*>([\\s\\S]*?)<\\/g>`))?.[1];
      const path = block?.match(/<path\b[^>]*d="([^"]+)"/)?.[1];
      assert.ok(path, `missing ${className} path`);
      const endpoints = path.match(/^M ([\d.]+),[-\d.]+ Q [-\d.]+,[-\d.]+ ([\d.]+),/);
      assert.ok(endpoints);
      assert.ok(Math.abs(Number(endpoints[1]) - left) < 0.02);
      assert.ok(Math.abs(Number(endpoints[2]) - right) < 0.02);
    }
    const slide = sliding.match(/<line class="technique-slide"[^>]*x1="([\d.]+)"[^>]*x2="([\d.]+)"/);
    assert.ok(slide);
    assert.ok(Number(slide[1]) > centers[0] + halfWidths[0]);
    assert.ok(Number(slide[2]) < centers[1] - halfWidths[1]);
  });

  it('merges contiguous beat-scope P.M. and let-ring effects into spans', () => {
    const score = parseGuitarDsl('| C |\ntab: | 6f0/8!{pm} 6f0!{pm} 6f0!{pm} 6f0!{pm} 6f3/2!{let-ring} |');
    const svg = renderContinuousSvg(score);
    assert.strictEqual((svg.match(/class="tab-effect-span tab-effect-pm"/g) ?? []).length, 1);
    assert.strictEqual((svg.match(/class="tab-effect-span tab-effect-let-ring"/g) ?? []).length, 1);
    assert.strictEqual((svg.match(/P\.M\./g) ?? []).length, 1);
  });

  it('continues a beat-effect run across system boundaries', () => {
    const score = parseGuitarDsl('measures_per_row: 1\n| C | D |\ntab: | 6f0/1!{pm} | 6f0/1!{pm} |');
    const svg = renderContinuousSvg(score);
    assert.strictEqual((svg.match(/class="tab-effect-span tab-effect-pm"/g) ?? []).length, 2);
    assert.ok(svg.includes('>(P.M.)</text>'));
    assert.strictEqual((svg.match(/P\.M\./g) ?? []).length, 2);
  });

  it('merges a beat-effect run across a measure boundary and stops it at a rest', () => {
    const continuous = renderContinuousSvg(parseGuitarDsl('measures_per_row: 2\n| C | D |\ntab: | 6f0/1!{pm} | 6f0/1!{pm} |'));
    const splitAtRest = renderContinuousSvg(parseGuitarDsl('| C |\ntab: | 6f0/4!{pm} r/4 6f0/4!{pm} r/4 |'));
    assert.strictEqual((continuous.match(/class="tab-effect-span tab-effect-pm"/g) ?? []).length, 1);
    assert.strictEqual((splitAtRest.match(/class="tab-effect-span tab-effect-pm"/g) ?? []).length, 2);
  });

  it('keeps TAB staff, effects, lyrics and the optional rhythm staff inside each system block', () => {
    const score = parseGuitarDsl([
      'measures_per_row: 1',
      '| C 4 4 4 4 | D 4 4 4 4 | E 4 4 4 4 |',
      'mel: | c4/1 | d4/1 | e4/1 |',
      'lyr: | ひ | と | り |',
      'tab: | 1f10{bend(amount=2)}/1!{pm} | 1f12/1 | 1f24/1 |',
      'lyr: | あ | い | う |'
    ].join('\n'));
    const rows = splitIntoRows(score).flat();
    assert.strictEqual(rows.length, 3);
    for (const row of rows) {
      const geometry = row.geometry;
      assert.ok(geometry.tabOffset - 27 > geometry.lyricBaseline, 'TAB technique marks clear the melody block');
      assert.ok(geometry.tabOffset + geometry.tabStaffHeight < geometry.tabLyricBaseline);
      assert.ok(geometry.finalRhythmOffset + 70 >= geometry.tabLyricBaseline + 8);
      assert.ok(geometry.unitHeight >= geometry.finalRhythmOffset + 120);
    }
  });

  it('uses distinct conventional TAB repeat, double and final barlines', () => {
    const repeat = renderContinuousSvg(parseGuitarDsl('|: C | D :|\ntab: | 6f0/1 | 6f1/1 |'));
    const normal = renderContinuousSvg(parseGuitarDsl('| C |\ntab: | 6f0/1 |'));
    const double = renderContinuousSvg(parseGuitarDsl('| C ||\ntab: | 6f0/1 |'));
    const final = renderContinuousSvg(parseGuitarDsl('| C |]\ntab: | 6f0/1 |'));
    assert.ok(repeat.includes('class="tab-repeat-start-thick"'));
    assert.ok(repeat.includes('class="tab-repeat-end-thick"'));
    assert.strictEqual((repeat.match(/class="tab-repeat-dot"/g) ?? []).length, 4);
    assert.ok(normal.includes('class="tab-barline"'));
    assert.strictEqual((double.match(/class="tab-double-end"/g) ?? []).length, 2);
    assert.ok(final.includes('class="tab-final-end-thick"'));
  });

  it('renders explicitly authored rhythm below the TAB staff only when enabled', () => {
    const shown = parseGuitarDsl('show_rhythm: true\n| C 4 4 4 4 |\ntab: | 6f0/1 |');
    const hidden = parseGuitarDsl('show_rhythm: false\n| C 4 4 4 4 |\ntab: | 6f0/1 |');
    assert.strictEqual(getSystemGeometry(shown.measures, shown).rhythmRendered, true);
    assert.strictEqual(getSystemGeometry(hidden.measures, hidden).rhythmRendered, false);
    assert.ok(renderContinuousSvg(shown).includes('stroke-width="1"'));
    assert.strictEqual((renderContinuousSvg(hidden).match(/class="tab-string-line"/g) ?? []).length, 6);
  });

  it('renders compound TAB durations exactly when no single rhythmic value represents them', () => {
    const score = parseGuitarDsl('| C |\ntab: | 2f5/4+8+16 2f7/4+8 2f8/8+16 |');
    const svg = renderContinuousSvg(score);
    assert.ok(svg.includes('class="tab-composite-duration"'));
    assert.ok(svg.includes('>4+8+16</text>'));
    assert.strictEqual((svg.match(/class="tab-duration-dot"/g) ?? []).length, 2);
    assert.strictEqual((svg.match(/class="tab-stem"/g) ?? []).length, 3);
  });

  it('places melody, TAB and TAB lyrics in distinct vertical blocks', () => {
    const score = parseGuitarDsl([
      '| C |',
      'mel: | c4/2 d |',
      'lyr: | ひ と |',
      'tab: | 2f1/2 2f3 |',
      'lyr: | あ さ |'
    ].join('\n'));
    const row = splitIntoRows(score)[0][0];
    assert.strictEqual(row.geometry.containsTab, true);
    assert.ok(row.geometry.tabOffset > row.geometry.lyricBaseline);
    assert.ok(row.geometry.tabLyricBaseline > row.geometry.tabOffset + row.geometry.tabStaffHeight);
    const svg = renderContinuousSvg(score);
    assert.ok(svg.includes('class="tab-lyric"'));
    assert.ok(svg.includes('class="tab-lyric" x="') && svg.includes('y="72"'));
    assert.ok(svg.includes('>あ</text>'));
  });

  it('emits page SVGs through the same TAB renderer', () => {
    const score = parseGuitarDsl('| C |\ntab: | 3f5/1 |');
    const pages = renderScoreSheets(score, 'A4', 'portrait');
    assert.strictEqual(pages.length, 1);
    assert.ok(pages[0].includes('class="tab-staff"'));
    assert.strictEqual((pages[0].match(/class="tab-string-line"/g) ?? []).length, 6);
  });

  it('renders the supported TAB effects and same-string rhythmic connections', () => {
    const score = parseGuitarDsl([
      '| C |',
      'tab: | 3f5{hammer}/8 3f7{pull} 3f5{slide} 3f7{gliss} 3f5{bend(amount=1)} 3f7{vibrato} 3f5{pm} 3f7/8!{let-ring} |'
    ].join('\n'));
    const svg = renderContinuousSvg(score);
    assert.ok(svg.includes('class="tab-stem"'));
    assert.ok(svg.includes('class="tab-beam"'));
    assert.ok(svg.includes('class="tab-note-effect"'));
    assert.ok(svg.includes('class="tab-effect-span tab-effect-let-ring"'));
    assert.ok(svg.includes('class="technique-hammer"'));
    assert.ok(svg.includes('class="technique-pull"'));
    assert.ok(svg.includes('class="technique-slide"'));
    assert.ok(svg.includes('class="technique-gliss"'));
    assert.ok(svg.includes('class="technique-bend"'));
    assert.ok(svg.includes('class="technique-vibrato"'));
  });

  it('does not render invalid tie arcs and draws valid per-string ties', () => {
    const valid = parseGuitarDsl('| C |\ntab: | [6f3~,5f2]/2 [6f3,5f3]/2 |');
    const invalid = parseGuitarDsl('| C |\ntab: | 6f3~/1 6f4/1 |');
    const validSvg = renderContinuousSvg(valid);
    const invalidSvg = renderContinuousSvg(invalid);
    assert.ok(validSvg.includes('class="tab-tie" data-string="6"'));
    assert.ok(!invalidSvg.includes('class="tab-tie"'));
  });

  it('continues TAB ties and connections across system boundaries', () => {
    const score = parseGuitarDsl([
      'measures_per_row: 1',
      '| C | D |',
      'tab: | 6f3{hammer}~/1 | 6f3/1 |'
    ].join('\n'));
    const svg = renderContinuousSvg(score);
    assert.strictEqual((svg.match(/class="tab-tie"/g) ?? []).length, 2);
    assert.strictEqual((svg.match(/class="technique-hammer"/g) ?? []).length, 2);
  });

  it('does not draw an invalid tie across an intervening sounding beat', () => {
    const score = parseGuitarDsl('| C |\ntab: | 3f5~/4 2f0/4 3f5/2 |');
    assert.ok(score.diagnostics.some(d => d.code === 'invalidTabTie'));
    assert.ok(!renderContinuousSvg(score).includes('class="tab-tie"'));
  });

  it('renders TAB lyric hyphens and melismas while skipping null slots', () => {
    const score = parseGuitarDsl([
      '| C |',
      'tab: | 2f1/4 2f3 1f0 1f1 |',
      'lyr: | sun- rise _ * |'
    ].join('\n'));
    const svg = renderContinuousSvg(score);
    assert.ok(svg.includes('class="tab-lyric"'));
    assert.ok(svg.includes('>sun</text>'));
    assert.ok(svg.includes('>rise</text>'));
    assert.strictEqual((svg.match(/class="tab-lyric-hyphen"/g) ?? []).length, 1);
    assert.strictEqual((svg.match(/class="tab-lyric-extension"/g) ?? []).length, 1);
    assert.strictEqual((svg.match(/class="tab-lyric"/g) ?? []).length, 2);
  });

  it('renders a valid same-string connection expanded from a TAB fragment', () => {
    const score = parseGuitarDsl([
      'let lick = 3f5{hammer}/4 2f0/4 3f7/2',
      '| C |',
      'tab: | $lick |'
    ].join('\n'));
    const svg = renderContinuousSvg(score);
    assert.ok(!score.diagnostics.some(d => d.code === 'invalidVariableValue' || d.code === 'invalidTabConnection' || d.code === 'danglingTabConnection'));
    assert.ok(svg.includes('class="technique-hammer"'));
    assert.ok(svg.includes('>H</text>'));
  });

  it('renders duration-specific TAB rests with the shared glyphs and dots', () => {
    const cases = [
      { base: 1, count: 1 },
      { base: 2, count: 2 },
      { base: 4, count: 4 },
      { base: 8, count: 8 },
      { base: 16, count: 16 }
    ];
    const glyphs = cases.map(({ base, count }) => {
      const rests = Array.from({ length: count }, () => `r/${base}`).join(' ');
      const score = parseGuitarDsl(`| C |\ntab: | ${rests} |`);
      const svg = renderContinuousSvg(score);
      assert.ok(!svg.includes('class="tab-stem"'));
      assert.ok(!svg.includes('class="tab-beam"'));
      return tabRestGlyph(svg, base);
    });
    for (let i = 1; i < glyphs.length; i++) assert.notStrictEqual(glyphs[i], glyphs[i - 1]);
    const wholeRect = glyphs[0].match(/<rect[^>]*>/)?.[0];
    const halfRect = glyphs[1].match(/<rect[^>]*>/)?.[0];
    assert.ok(wholeRect && halfRect && wholeRect !== halfRect);
    assert.strictEqual((glyphs[2].match(/<path\b/g) ?? []).length, 1);
    assert.strictEqual((glyphs[3].match(/<circle\b/g) ?? []).length, 1);
    assert.strictEqual((glyphs[4].match(/<circle\b/g) ?? []).length, 2);

    const dotted = parseGuitarDsl('| C |\ntab: | r/4. |');
    const dottedSvg = renderContinuousSvg(dotted);
    assert.strictEqual((dottedSvg.match(/class="tab-rest-dot"/g) ?? []).length, 1);
    assert.ok(!dottedSvg.includes('class="tab-stem"'));
  });
});
