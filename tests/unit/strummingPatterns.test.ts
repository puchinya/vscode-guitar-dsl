import * as assert from 'assert';
import { STRUMMING_PATTERN_PRESETS, getPresetById, replaceMeasureLineRhythm, replaceRhythmInDsl } from '../../src/strummingPatterns';
import { parseGuitarDsl } from '../../src/compiler';
import { compileGuitarDslToSvg } from '../../src/render/svg';

describe('strummingPatterns - presets & arpeggio', () => {
  it('every preset should have exactly 4 beats and compile without errors in a 4/4 measure', () => {
    assert.ok(STRUMMING_PATTERN_PRESETS.length > 15);

    for (const preset of STRUMMING_PATTERN_PRESETS) {
      const dsl = `
key: C
bpm: 120
[Test]
| C | ${preset.pattern} |
`;
      const parsed = parseGuitarDsl(dsl);
      const errors = parsed.diagnostics.filter(d => d.severity === 'error');
      const beatWarnings = parsed.diagnostics.filter(d => d.code === 'beatCountMismatch');

      assert.strictEqual(errors.length, 0, `Preset "${preset.id}" generated compiler errors: ${errors.map(e => e.code).join(', ')}`);
      assert.strictEqual(beatWarnings.length, 0, `Preset "${preset.id}" pattern "${preset.pattern}" does not sum to 4 beats`);
    }
  });

  it('getPresetById should return matching preset or undefined', () => {
    const std = getPresetById('8beat_standard');
    assert.ok(std);
    assert.ok(std.nameJa.includes('王道8ビート'));
    assert.ok(getPresetById('arpeggio_8beat'));
    assert.strictEqual(getPresetById('unknown_id'), undefined);
  });

  describe('replaceMeasureLineRhythm', () => {
    it('replaces rhythm in standard two-cell measure', () => {
      const line = '| C | 4.d 4.d 4.d 4.d |';
      const result = replaceMeasureLineRhythm(line, '8.d 8.u 8.d 8.u 8.d 8.u 8.d 8.u');
      assert.strictEqual(result, '| C | 8.d 8.u 8.d 8.u 8.d 8.u 8.d 8.u |');
    });

    it('preserves lyrics in measure line', () => {
      const line = '| C | 4.d 4.d 4.d 4.d l:"あさの ひかり" |';
      const result = replaceMeasureLineRhythm(line, '1.d');
      assert.strictEqual(result, '| C | 1.d l:"あさの ひかり" |');
    });

    it('preserves repeat barlines and brackets', () => {
      const line = '|: [1.] C/2 G/2 | 4.d 4.d 4.d 4.d :|';
      const result = replaceMeasureLineRhythm(line, '2.d 2.d');
      assert.strictEqual(result, '|: [1.] C/2 G/2 | 2.d 2.d :|');
    });

    it('replaces repeat % cell with new rhythm pattern', () => {
      const line = '| C | % |';
      const result = replaceMeasureLineRhythm(line, '4.d 8.d 8.u 8.d 8.u 4.d');
      assert.strictEqual(result, '| C | 4.d 8.d 8.u 8.d 8.u 4.d |');
    });

    it('replaces single-cell % measure', () => {
      const line = '| % |';
      const result = replaceMeasureLineRhythm(line, '1.d');
      assert.strictEqual(result, '| % | 1.d |');
    });
  });

  describe('replaceRhythmInDsl', () => {
    const sampleDsl = `title: Test Song
key: C
bpm: 120

[Verse]
| C | 4.d 4.d 4.d 4.d |
| G | 4.d 4.d 4.d 4.d |

[Chorus]
| F | 4.d 4.d 4.d 4.d |
| G | 4.d 4.d 4.d 4.d |
`;

    it('replaces rhythm across entire score when no section is specified', () => {
      const updated = replaceRhythmInDsl(sampleDsl, '1.d');
      assert.ok(updated.includes('| C | 1.d |'));
      assert.ok(updated.includes('| G | 1.d |'));
      assert.ok(updated.includes('| F | 1.d |'));
      assert.ok(!updated.includes('4.d 4.d 4.d 4.d'));
    });

    it('replaces rhythm only in the target section', () => {
      const updated = replaceRhythmInDsl(sampleDsl, '8 8 8 8 8 8 8 8', { sectionName: 'Verse' });
      // Verse should be replaced
      assert.ok(updated.includes('| C | 8 8 8 8 8 8 8 8 |'));
      assert.ok(updated.includes('| G | 8 8 8 8 8 8 8 8 |'));
      // Chorus should remain 4.d
      assert.ok(updated.includes('| F | 4.d 4.d 4.d 4.d |'));
    });
  });

  describe('inline pitch notes and arpeggio rendering', () => {
    it('parses inline melody/arpeggio notes in measure line with zero errors', () => {
      const dsl = `
key: C
bpm: 120
[Intro]
| C | c3/8 e3/8 g3/8 c4/8 4.d 4.d |
| Am | c3/8 e3/8 a3/8 c4/8 e3/8 a3/8 c4/8 e4/8 |
`;
      const parsed = parseGuitarDsl(dsl);
      const errors = parsed.diagnostics.filter(d => d.severity === 'error');
      assert.strictEqual(errors.length, 0);

      const bar1 = parsed.measures[0];
      assert.strictEqual(bar1.rhythms.length, 6);
      assert.deepStrictEqual(bar1.rhythms[0].pitch, { step: 'c', alter: 0, octave: 3 });
      assert.deepStrictEqual(bar1.rhythms[1].pitch, { step: 'e', alter: 0, octave: 3 });
      assert.strictEqual(bar1.rhythms[4].pitch, undefined); // 4.d slash

      const bar2 = parsed.measures[1];
      assert.strictEqual(bar2.rhythms.length, 8);
      assert.deepStrictEqual(bar2.rhythms[7].pitch, { step: 'e', alter: 0, octave: 4 });
    });

    it('parses arpeggiato wavy sign modifier (.arp)', () => {
      const dsl = `
key: C
bpm: 120
[Outro]
| C | 1.arp |
| G | 2.arp 2.arp |
`;
      const parsed = parseGuitarDsl(dsl);
      const errors = parsed.diagnostics.filter(d => d.severity === 'error');
      assert.strictEqual(errors.length, 0);

      assert.strictEqual(parsed.measures[0].rhythms[0].arpeggio, true);
      assert.strictEqual(parsed.measures[1].rhythms[0].arpeggio, true);
      assert.strictEqual(parsed.measures[1].rhythms[1].arpeggio, true);
    });

    it('renders inline notes and arpeggio signs into valid SVG output', () => {
      const dsl = `
title: Arpeggio Test
key: C
bpm: 120
[Intro]
| C | c3/8 e3/8 g3/8 c4/8 4.d 4.d |
| G | 1.arp |
`;
      const svg = compileGuitarDslToSvg(dsl);
      assert.ok(svg.includes('<svg'));
      assert.ok(svg.includes('class="notehead"')); // notehead for c3/8
      assert.ok(svg.includes('fill="none" stroke="#000" stroke-width="1.3"')); // arpeggio wavy sign
    });
  });
});
