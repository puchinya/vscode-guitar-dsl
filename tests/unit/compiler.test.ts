import * as assert from 'assert';
import {
  parseGuitarDsl,
  compileGuitarDslToHtml,
  compileGuitarDslToSvg,
  compileGuitarDslToPrintHtml,
  PAGE_CONFIG
} from '../../src/compiler';

describe('compiler - parseGuitarDsl', () => {
  describe('Metadata parsing', () => {
    it('should parse standard score headers', () => {
      const dsl = [
        'title: Stand By Me',
        'artist: Ben E. King',
        'capo: 2',
        'key: G',
        'bpm: 118',
        'memo: Acoustic Guitar Fingerpicking'
      ].join('\n');

      const parsed = parseGuitarDsl(dsl);
      assert.strictEqual(parsed.title, 'Stand By Me');
      assert.strictEqual(parsed.artist, 'Ben E. King');
      assert.strictEqual(parsed.capo, '2');
      assert.strictEqual(parsed.originalKey, 'G');
      assert.strictEqual(parsed.bpm, '118');
      assert.strictEqual(parsed.memo, 'Acoustic Guitar Fingerpicking');
    });

    it('should parse style overrides', () => {
      const dsl = [
        'chord_size: 16',
        'lyric_size: 12',
        'title_size: 24',
        'section_size: 18',
        'font_size: 14'
      ].join('\n');

      const parsed = parseGuitarDsl(dsl);
      assert.strictEqual(parsed.style.chordSize, 16);
      assert.strictEqual(parsed.style.lyricSize, 12);
      assert.strictEqual(parsed.style.titleSize, 24);
      assert.strictEqual(parsed.style.sectionSize, 18);
      assert.strictEqual(parsed.style.fontSize, 14);
    });

    it('should default metadata values when omitted', () => {
      const parsed = parseGuitarDsl('');
      assert.strictEqual(parsed.title, 'Guitar Rhythm Score');
      assert.strictEqual(parsed.capo, '0');
      assert.strictEqual(parsed.originalKey, 'C');
      assert.strictEqual(parsed.bpm, '90');
    });
  });

  describe('Sections and Measure parsing', () => {
    it('should associate section names with the initial measure of that section', () => {
      const dsl = [
        '[Intro]',
        '| C | G |',
        '[Verse 1]',
        '| Am | Em |'
      ].join('\n');

      const parsed = parseGuitarDsl(dsl);
      assert.strictEqual(parsed.measures.length, 4);
      assert.strictEqual(parsed.measures[0].sectionName, 'Intro');
      assert.strictEqual(parsed.measures[1].sectionName, '');
      assert.strictEqual(parsed.measures[2].sectionName, 'Verse 1');
      assert.strictEqual(parsed.measures[3].sectionName, '');
    });

    it('should parse multiple chords and calculate 0-based beats within a measure', () => {
      const dsl = '| C G | Am Em |';
      const parsed = parseGuitarDsl(dsl);

      assert.strictEqual(parsed.measures.length, 2);
      const m1 = parsed.measures[0];
      const m2 = parsed.measures[1];

      assert.strictEqual(m1.chords.length, 2);
      assert.strictEqual(m1.chords[0].name, 'C');
      assert.strictEqual(m1.chords[0].beat, 0);
      assert.strictEqual(m1.chords[1].name, 'G');
      assert.strictEqual(m1.chords[1].beat, 2);

      assert.strictEqual(m2.chords.length, 2);
      assert.strictEqual(m2.chords[0].name, 'Am');
      assert.strictEqual(m2.chords[1].name, 'Em');
    });

    it('should parse explicit chord duration (e.g. C:3 G:1)', () => {
      const dsl = '| C:3 G:1 |';
      const parsed = parseGuitarDsl(dsl);
      const m = parsed.measures[0];

      assert.strictEqual(m.chords.length, 2);
      assert.strictEqual(m.chords[0].name, 'C');
      assert.strictEqual(m.chords[0].beat, 0);
      assert.strictEqual(m.chords[1].name, 'G');
      assert.strictEqual(m.chords[1].beat, 3);
    });

    it('should parse measure repeat % symbol for subsequent bars', () => {
      const dsl = [
        '| C 4.d 4.d 4.d 4.d |',
        '| % |'
      ].join('\n');
      const parsed = parseGuitarDsl(dsl);

      assert.strictEqual(parsed.measures.length, 2);
      const m2 = parsed.measures[1];
      assert.strictEqual(m2.isMeasureRepeat, true);
      assert.strictEqual(m2.chord, 'C');
    });

    it('should parse repeat and double-bar barlines', () => {
      const dsl = '|: C | G :|';
      const parsed = parseGuitarDsl(dsl);
      const measures = parsed.measures;

      assert.strictEqual(measures[0].repeatStart, true);
      assert.strictEqual(measures[measures.length - 1].repeatEnd, true);
    });

    it('should parse lyrics on the corresponding measure', () => {
      const dsl = '| C G | Am Em l:"Hello beautiful world" |';
      const parsed = parseGuitarDsl(dsl);
      assert.strictEqual(parsed.measures.length, 2);
      const m2 = parsed.measures[1];

      assert.strictEqual(m2.lyric, 'Hello beautiful world');
    });
  });

  describe('Rhythm slash notation parsing', () => {
    it('should parse rhythm slash tokens with strokes and rests', () => {
      const dsl = '| 4.d 8.u 8.d rq 4.d |';
      const parsed = parseGuitarDsl(dsl);
      const m = parsed.measures[0];

      assert.strictEqual(m.rhythms.length, 5);
      assert.strictEqual(m.rhythms[0].duration, '4');
      assert.strictEqual(m.rhythms[0].down, true);
      assert.strictEqual(m.rhythms[0].up, false);

      assert.strictEqual(m.rhythms[1].duration, '8');
      assert.strictEqual(m.rhythms[1].up, true);

      assert.strictEqual(m.rhythms[3].isRest, true);
    });

    it('should parse ties, ghost notes, and accents', () => {
      const dsl = '| 4.d.t 8.u.g 8.d.a |';
      const parsed = parseGuitarDsl(dsl);
      const rhythms = parsed.measures[0].rhythms;

      assert.strictEqual(rhythms[0].tie, true);
      assert.strictEqual(rhythms[1].ghost, true);
      assert.strictEqual(rhythms[2].accent, true);
    });
  });

  describe('Multi-page score and page breaks', () => {
    it('should split score into multiple pages with pagebreak', () => {
      const dsl = [
        'title: Multi-page Song',
        '[Page 1 Section]',
        '| C | G |',
        'pagebreak',
        '[Page 2 Section]',
        '| Am | F |'
      ].join('\n');

      const parsed = parseGuitarDsl(dsl);
      assert.strictEqual(parsed.pages.length, 2);
      assert.strictEqual(parsed.pages[0].pageNumber, 1);
      assert.strictEqual(parsed.pages[1].pageNumber, 2);
      assert.strictEqual(parsed.pages[0].measures[0].sectionName, 'Page 1 Section');
      assert.strictEqual(parsed.pages[1].measures[0].sectionName, 'Page 2 Section');
    });
  });

  describe('Robustness and Error Handling', () => {
    it('should handle empty input without throwing', () => {
      const parsed = parseGuitarDsl('');
      assert.strictEqual(parsed.title, 'Guitar Rhythm Score');
      assert.strictEqual(parsed.measures.length, 0);
    });

    it('should ignore comment lines starting with #', () => {
      const dsl = [
        '# This is a comment',
        'title: Song Title',
        '# Another comment',
        '| C |'
      ].join('\n');

      const parsed = parseGuitarDsl(dsl);
      assert.strictEqual(parsed.title, 'Song Title');
      assert.strictEqual(parsed.measures.length, 1);
    });

    it('should gracefully handle malformed tokens', () => {
      const dsl = '| ??? !!! | ::: ||| |';
      const parsed = parseGuitarDsl(dsl);
      assert.ok(parsed);
      assert.ok(parsed.measures.length >= 1);
    });
  });
});

describe('compiler - HTML and SVG Rendering', () => {
  const sampleDsl = [
    'title: Rendering Test',
    'artist: Test Artist',
    'capo: 1',
    '[Verse]',
    '| C G | Am Em | l:"テスト歌詞"',
    '| 4.d 4.d 4.d 4.d |'
  ].join('\n');

  it('compileGuitarDslToHtml should return full valid HTML with svg', () => {
    const html = compileGuitarDslToHtml(sampleDsl);
    assert.ok(html.includes('<!DOCTYPE html>'));
    assert.ok(html.includes('<title>Rendering Test</title>'));
    assert.ok(html.includes('<svg'));
    assert.ok(html.includes('Rendering Test'));
    assert.ok(html.includes('Test Artist'));
    assert.ok(html.includes('Capo: 1'));
  });

  it('compileGuitarDslToSvg should return SVG element string', () => {
    const svg = compileGuitarDslToSvg(sampleDsl);
    assert.ok(svg.startsWith('<svg') || svg.includes('<svg'));
    assert.ok(svg.includes('</svg>'));
    assert.ok(svg.includes('Rendering Test'));
  });

  it('compileGuitarDslToPrintHtml should generate print-ready HTML with @page CSS', () => {
    const printHtml = compileGuitarDslToPrintHtml(sampleDsl, 'A4', 'portrait');
    assert.ok(printHtml.includes('@page'));
    assert.ok(printHtml.includes('size: A4 portrait;'));
    assert.ok(printHtml.includes('<div class="sheet-page"'));
  });

  it('PAGE_CONFIG should contain expected standard paper dimensions', () => {
    assert.strictEqual(PAGE_CONFIG['A4'].widthMm, 210);
    assert.strictEqual(PAGE_CONFIG['A4'].heightMm, 297);
    assert.strictEqual(PAGE_CONFIG['B5'].widthMm, 176);
    assert.strictEqual(PAGE_CONFIG['B5'].heightMm, 250);
  });
});
