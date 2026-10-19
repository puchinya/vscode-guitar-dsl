import * as assert from 'assert';
import { parseGuitarDsl } from '../../src/compiler';
import { frac } from '../../src/duration';
import { automaticPracticeGuideGrid, practiceGuideContinuationOffsets, practiceGuideRhythmLabel, practiceGuideTabEvents, practiceGuideValueContinuationOffsets } from '../../src/practiceGuide';

describe('practice guide grid', () => {
  it('uses the densest explicit rhythm subdivision across the written song', () => {
    assert.strictEqual(automaticPracticeGuideGrid(parseGuitarDsl('| C | 4 4 4 4 |\n| G | 8 8 4 8 8 |')), 8);
    assert.strictEqual(automaticPracticeGuideGrid(parseGuitarDsl('| C | 4 4 4 4 |\n| G | 16 16 16 16 16 16 16 16 |')), 16);
  });

  it('excludes implicit rhythm, melody and unused let definitions', () => {
    const score = parseGuitarDsl([
      'let unused = 16 16 16 16 16 16 16 16',
      '| C |',
      'mel: | c4/16 c d e f g a b c |'
    ].join('\n'));
    assert.strictEqual(automaticPracticeGuideGrid(score), 4);
  });

  it('uses TAB-only note values and does not double count TAB beside explicit rhythm', () => {
    const tabOnly = parseGuitarDsl('| C |\ntab: | 6f0/16 6f1/16 6f2/16 6f3/16 6f4/16 6f5/16 6f6/16 6f7/16 |');
    assert.strictEqual(automaticPracticeGuideGrid(tabOnly), 16);

    const explicitWins = parseGuitarDsl('| C | 4 4 4 4 |\ntab: | 6f0/16 6f1/16 6f2/16 6f3/16 6f4/16 6f5/16 6f6/16 6f7/16 |');
    assert.strictEqual(automaticPracticeGuideGrid(explicitWins), 4);
  });

  it('places exact continuation marks and keeps ties, rests, mutes and percussive notes distinct', () => {
    const score = parseGuitarDsl([
      '| C | 4.d 4.d.b 4.m r4 |',
      '| G | 8.d.t 8 4 4 4 |',
      '| Am | 4.d.stacc 4 4 4 |'
    ].join('\n'));
    const [quarterAttack, brush, mute, rest] = score.measures[0].rhythms;

    assert.deepStrictEqual(practiceGuideContinuationOffsets(quarterAttack, 16), [
      { n: 1, d: 4 }, { n: 1, d: 2 }, { n: 3, d: 4 }
    ]);
    assert.deepStrictEqual(practiceGuideContinuationOffsets(brush, 16), []);
    assert.deepStrictEqual(practiceGuideContinuationOffsets(mute, 16), []);
    assert.deepStrictEqual(practiceGuideContinuationOffsets(rest, 16), []);
    assert.strictEqual(practiceGuideRhythmLabel(quarterAttack), '↓');
    assert.strictEqual(practiceGuideRhythmLabel(brush), '×↓');
    assert.strictEqual(practiceGuideRhythmLabel(mute), '・');
    assert.strictEqual(practiceGuideRhythmLabel(rest), 'r4');

    const [tieStart, tieContinuation] = score.measures[1].rhythms;
    assert.strictEqual(tieStart.tie, true);
    assert.strictEqual(tieContinuation.tiedFromPrev, true);
    assert.strictEqual(practiceGuideRhythmLabel(tieContinuation), '〜');
    assert.deepStrictEqual(practiceGuideContinuationOffsets(tieStart, 16), [{ n: 1, d: 4 }]);
    assert.deepStrictEqual(practiceGuideContinuationOffsets(tieContinuation, 16), [{ n: 1, d: 4 }]);

    const staccato = score.measures[2].rhythms[0];
    assert.strictEqual(practiceGuideContinuationOffsets(staccato, 16).length, 0);
  });

  it('scales local tuplet slots with exact fractional duration', () => {
    const score = parseGuitarDsl('| C | 8t.d 8t.u 8t.d 8t.u 8t.d 8t.u 8t.d 8t.u 8t.d 8t.u 8t.d 8t.u |');
    assert.deepStrictEqual(practiceGuideContinuationOffsets(score.measures[0].rhythms[0], 16), [{ n: 1, d: 6 }]);
    assert.deepStrictEqual(practiceGuideContinuationOffsets(score.measures[0].rhythms[0], 8), []);
  });

  it('uses a neutral attack mark when a written stroke has no direction', () => {
    const score = parseGuitarDsl('| C | 4 4 4 4 |');
    assert.strictEqual(practiceGuideRhythmLabel(score.measures[0].rhythms[0]), '●');
  });

  it('projects TAB-only note attacks at their written Fraction times', () => {
    const score = parseGuitarDsl('| C |\ntab: | 6f0/8 6f1/8 6f2/8 6f3/8 6f4/8 6f5/8 6f6/8 6f7/8 |');
    const events = practiceGuideTabEvents(score.measures[0].tabVoices ?? []);
    assert.strictEqual(events.length, 8);
    assert.deepStrictEqual(events.map(event => event.label), Array(8).fill('s6'));
    assert.deepStrictEqual(events.map(event => event.at), Array.from({ length: 8 }, (_, index) => frac(index, 2)));
    assert.deepStrictEqual(practiceGuideValueContinuationOffsets(events[0].duration, 16), [{ n: 1, d: 4 }]);
  });
});
