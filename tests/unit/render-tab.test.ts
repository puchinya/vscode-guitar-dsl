import * as assert from 'assert';
import { parseGuitarDsl } from '../../src/compiler';
import { getSystemGeometry, splitIntoRows } from '../../src/render/layout';
import { renderContinuousSvg, renderScoreSheets } from '../../src/render/svg';

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
    assert.ok(svg.includes('class="tab-label tab-clef"'));
    assert.ok(svg.includes('font-size="20" font-weight="bold"'));
    for (const fret of ['3', '2', '0']) assert.ok(svg.includes(`>${fret}</text>`));
    assert.ok(svg.includes('font-size="12" font-weight="bold"'));
    assert.ok(svg.includes('data-string="1"'));
    assert.ok(svg.includes('data-string="6"'));
  });

  it('keeps TAB visible when slash rhythm is hidden and suppresses an implicit rhythm staff', () => {
    const score = parseGuitarDsl('show_rhythm: false\n| C |\ntab: | 6f0/1 |');
    const geometry = getSystemGeometry(score.measures, score);
    assert.strictEqual(geometry.containsTab, true);
    assert.strictEqual(geometry.tabStaffHeight, 60);
    assert.strictEqual(geometry.rhythmRendered, false);
    const svg = renderContinuousSvg(score);
    assert.ok(svg.includes('class="tab-staff"'));
    assert.strictEqual((svg.match(/class="tab-string-line"/g) ?? []).length, 6);
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
    assert.ok(svg.includes('class="tab-effect-range tab-effect-pm"'));
    assert.ok(svg.includes('class="tab-effect-range tab-effect-let-ring"'));
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
