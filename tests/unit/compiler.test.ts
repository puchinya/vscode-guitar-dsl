import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { parseGuitarDsl } from '../../src/compiler';

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

    it('should parse doubleEnd, finalEnd and Volta brackets [1.] and [2.]', () => {
      const dsl = '|: C G | [1.] Am Em :| [2.] F G ||';
      const parsed = parseGuitarDsl(dsl);
      assert.strictEqual(parsed.measures.length, 3);
      assert.strictEqual(parsed.measures[0].repeatStart, true);
      assert.strictEqual(parsed.measures[1].bracket, '1.');
      assert.strictEqual(parsed.measures[1].repeatEnd, true);
      assert.strictEqual(parsed.measures[2].bracket, '2.');
      assert.strictEqual(parsed.measures[2].doubleEnd, true);

      const dslFinal = '| C | G |]';
      const parsedFinal = parseGuitarDsl(dslFinal);
      assert.strictEqual(parsedFinal.measures[1].finalEnd, true);
    });

    it('should parse special jump marks (Fine, D.C., D.S., Coda, Segno)', () => {
      const dsl = '| C Segno | G to Coda | Am Fine | F D.S. |';
      const parsed = parseGuitarDsl(dsl);
      assert.strictEqual(parsed.measures[0].specialMark, 'segno');
      assert.strictEqual(parsed.measures[1].specialMark, 'to_coda');
      assert.strictEqual(parsed.measures[2].specialMark, 'fine');
      assert.strictEqual(parsed.measures[3].specialMark, 'ds');
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

describe('compiler - module boundary', () => {
  it('should only expose parsing (no SVG/HTML rendering)', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const compiler = require('../../src/compiler');
    const exported = Object.keys(compiler);
    assert.ok(exported.includes('parseGuitarDsl'));
    for (const name of exported) {
      assert.ok(!/html|svg|render/i.test(name), `unexpected rendering export: ${name}`);
    }
  });
});

describe('compiler - invalid structures an AI may generate (Issue #101 D4)', () => {
  const codes = (text: string) => parseGuitarDsl(text).diagnostics.map(d => `${d.severity}:${d.code}:${d.line + 1}`);

  it('indented | lines after mel: / lyr: are continuation errors and never become measures', () => {
    const text = [
      '| Am | 4.d 4.d 4.d 4.d | F | 4.d 4.d 4.d 4.d |',
      'mel: | a4/2 b4/2 |',
      '      | c5/2 b4/2 |',
      'lyr: | ら ら |',
      '      | ら ら |',
      '',
      '  | C | 4.d 4.d 4.d 4.d |'
    ].join('\n');
    const score = parseGuitarDsl(text);
    assert.deepStrictEqual(score.measures.map(m => m.chord), ['Am', 'F', 'C'], 'an indented measure line after a blank line is still a measure');
    assert.deepStrictEqual(codes(text).filter(c => c.includes('unsupportedContinuationLine')), ['error:unsupportedContinuationLine:3', 'error:unsupportedContinuationLine:5']);
  });

  it('chained and lyr:-only continuation lines never become measures', () => {
    const chained = ['| C | 4.d 4.d 4.d 4.d |', 'mel: | c4/1 |', '  | d4/1 |', '  | e4/1 |', '  | f4/1 |', '| G | 4.d 4.d 4.d 4.d |'].join('\n');
    assert.deepStrictEqual(parseGuitarDsl(chained).measures.map(m => m.chord), ['C', 'G']);
    assert.deepStrictEqual(codes(chained).filter(c => c.includes('unsupportedContinuationLine')), [3, 4, 5].map(l => `error:unsupportedContinuationLine:${l}`));
    const lyr = ['| C | 4.d 4.d 4.d 4.d |', 'mel: | c4/2 d4/2 |', 'lyr: ら ら', '    | ら ら |'].join('\n');
    assert.strictEqual(parseGuitarDsl(lyr).measures.length, 1);
    assert.deepStrictEqual(codes(lyr).filter(c => c.includes('Continuation')), ['error:unsupportedContinuationLine:4']);
  });

  it('unrecognized measure tokens are errors instead of being dropped silently', () => {
    assert.deepStrictEqual(codes('| C | き の う 4.d 4.d 4.d 4.d |').filter(c => c.includes('unknownMeasureToken')), [
      'error:unknownMeasureToken:1',
      'error:unknownMeasureToken:1',
      'error:unknownMeasureToken:1'
    ]);
    const d = parseGuitarDsl('| N.C. | 4.d 4.d 4.d 4.d |').diagnostics[0];
    assert.deepStrictEqual([d.code, d.args], ['unknownMeasureToken', { token: 'N.C.' }]);
    for (const valid of ['|: [1.] C 4.d 4.d 4.d 4.d :| [2.] G To Coda |', '| C Fine | D.S. |', '| C | % |', '| C | c4/4 [c4,e4]/4 2.d |']) {
      assert.deepStrictEqual(codes(valid).filter(c => c.includes('unknownMeasureToken')), [], valid);
    }
  });

  it(':| without a |: since the start or the previous :| is a warning; volta endings share their start', () => {
    assert.deepStrictEqual(codes('|: C | G :|\n| F | C :|'), ['warning:repeatEndWithoutStart:2']);
    assert.deepStrictEqual(codes('| C | G :|'), ['warning:repeatEndWithoutStart:1']);
    assert.deepStrictEqual(codes('|: C | G :|\n|: F | C :|'), []);
    assert.deepStrictEqual(codes('|: C | [1.] G :| [2.] F :| [3.] Am ||'), []);
    // D5: only consecutive volta endings share the start.
    assert.deepStrictEqual(codes('|: C | [1.] G :|\n| [2.] F :|'), []);
    assert.deepStrictEqual(codes('|: C | [1.] G :|\n| [2.] F :|\n| [3.] Am ||'), []);
    const multiMeasureEndings = '|: C | [1.] G | D :|\n| [2.] F | G :|\n| [3.] Am ||';
    const parsedMultiMeasureEndings = parseGuitarDsl(multiMeasureEndings);
    assert.deepStrictEqual(codes(multiMeasureEndings), [], 'multi-measure endings stay one sequence');
    assert.deepStrictEqual(parsedMultiMeasureEndings.playOrder.occurrences.map(item => item.measureIndex), [0, 1, 2, 0, 3, 4, 0, 5]);
    assert.deepStrictEqual(codes('|: C | [1.] G :|\n| Am |\n| [2.] F :|'), ['warning:repeatEndWithoutStart:3']);
    assert.deepStrictEqual(codes('|: C | [1.] G :|\n| Am |\n| Dm |\n| [2.] F :|'), ['warning:repeatEndWithoutStart:4']);
    assert.deepStrictEqual(codes('|: C | [1.] G :|\n|: Am | Dm :|'), [], 'a new independent repeat');
    assert.deepStrictEqual(codes('|: C | [1.] G :|\n|: Am | Dm :|\n| [2.] F :|'), ['warning:repeatEndWithoutStart:3'], 'no stale sharing leaks past an independent repeat');
    assert.deepStrictEqual(codes('|: C | [1.] G :|\n[Next]\n| [2.] F :|'), ['warning:repeatEndWithoutStart:3'], 'a section boundary ends the sequence');
    assert.deepStrictEqual(codes('|: C | [1.] G :|\n---\n| [2.] F :|'), ['warning:repeatEndWithoutStart:3'], 'a page break ends the sequence');
    assert.deepStrictEqual(codes('|: C :|'), []);
  });

  it('exposes resolved play order and maps resolver errors to an internal measure source range', () => {
    const text = '| C | D D.S. |';
    const parsed = parseGuitarDsl(text);
    assert.strictEqual(parsed.playOrder.valid, false);
    assert.deepStrictEqual(parsed.playOrder.occurrences, []);
    assert.deepStrictEqual(parsed.measures.map(measure => measure.measureIndex), [0, 1]);
    assert.deepStrictEqual(parsed.pages.flatMap(page => page.measures.map(measure => measure.measureIndex)), [0, 1]);

    const diagnostic = parsed.diagnostics.find(item => item.code === 'playOrderMissingDestination');
    assert.ok(diagnostic);
    assert.strictEqual(diagnostic.severity, 'error');
    assert.strictEqual(diagnostic.line, 0);
    assert.ok(diagnostic.startCol >= 0 && diagnostic.endCol > diagnostic.startCol);
    assert.ok(diagnostic.endCol <= text.length);
  });

  it('keeps page breaks out of play-order resolution while preserving the separate parser warning', () => {
    const continuous = parseGuitarDsl('|: C | [1.] G :| [2.] F :|');
    const paged = parseGuitarDsl('|: C | [1.] G :|\n---\n| [2.] F :|');
    assert.strictEqual(continuous.playOrder.valid, true);
    assert.strictEqual(paged.playOrder.valid, true);
    assert.deepStrictEqual(paged.playOrder, continuous.playOrder);
    assert.ok(paged.diagnostics.some(item => item.code === 'repeatEndWithoutStart' && item.severity === 'warning'));
  });

  it('ends consecutive-volta sharing at a section heading and applies the implicit section start', () => {
    const parsed = parseGuitarDsl('|: C | [1.] G :|\n[Next]\n| C | [2.] F :|');
    assert.strictEqual(parsed.playOrder.valid, true);
    assert.deepStrictEqual(parsed.playOrder.occurrences.map(item => item.measureIndex), [0, 1, 0, 2, 2, 3]);
    assert.ok(parsed.diagnostics.some(item => item.code === 'repeatEndWithoutStart' && item.severity === 'warning'));
  });

  it('T30 keeps bundled Outro right repeats executable without rewriting sample sources', () => {
    for (const sampleName of ['sample.guitardsl', 'sample_16beat.guitardsl', 'sample_8beat.guitardsl']) {
      const source = fs.readFileSync(path.join(__dirname, '../../samples', sampleName), 'utf8');
      const parsed = parseGuitarDsl(source);
      assert.strictEqual(parsed.playOrder.valid, true, sampleName);
      assert.ok(parsed.playOrder.occurrences.length > parsed.measures.length, `${sampleName} uses implicit repeat execution`);
      assert.ok(!parsed.playOrder.diagnostics.length, sampleName);
    }
  });
});
