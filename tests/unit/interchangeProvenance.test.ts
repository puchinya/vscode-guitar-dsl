import assert from 'assert';
import { parseGuitarDsl } from '../../src/compiler';

describe('interchange parser provenance', () => {
  const offsets = (source: string) => parseGuitarDsl(source).measures.map(measure => ({
    mode: measure.chordPlacementMode,
    origin: measure.rhythmOrigin,
    beats: measure.chordBeatOffsets.map(value => ({ n: value.n, d: value.d }))
  }));

  it('records exact offsets for equally spaced chords in 4/4', () => {
    const score = parseGuitarDsl('| C D E |');
    assert.strictEqual(score.diagnostics.some(diagnostic => diagnostic.severity === 'error'), false);
    assert.strictEqual(score.measures[0].chordPlacementMode, 'equalSplit');
    assert.strictEqual(score.measures[0].rhythmOrigin, 'implicit');
    assert.deepStrictEqual(score.measures[0].chordBeatOffsets, [
      { n: 0, d: 1 },
      { n: 4, d: 3 },
      { n: 8, d: 3 }
    ]);
    assert.deepStrictEqual(score.measures[0].chords.map(chord => chord.beat), [0, 4 / 3, 8 / 3]);
  });

  it('resolves equal splits after a 7/8 grouped meter is known', () => {
    const score = parseGuitarDsl('time: 7/8(2+2+3)\n| C D E |');
    assert.strictEqual(score.diagnostics.some(diagnostic => diagnostic.severity === 'error'), false);
    assert.deepStrictEqual(score.measures[0].chordBeatOffsets, [
      { n: 0, d: 1 },
      { n: 7, d: 6 },
      { n: 7, d: 3 }
    ]);
    assert.deepStrictEqual(score.measures[0].context.timeSignature.groups, [2, 2, 3]);
  });

  it('captures inline tuplet and explicit-duration positions as exact fractions', () => {
    const inline = parseGuitarDsl('| 8t.d C 8t.d D 8t.d E 4 4 4 |');
    assert.strictEqual(inline.diagnostics.some(diagnostic => diagnostic.severity === 'error'), false);
    assert.strictEqual(inline.measures[0].chordPlacementMode, 'inline');
    assert.deepStrictEqual(inline.measures[0].chordBeatOffsets, [
      { n: 1, d: 3 },
      { n: 2, d: 3 },
      { n: 1, d: 1 }
    ]);

    const explicit = parseGuitarDsl('| C:2 D:1 E:1 |');
    assert.strictEqual(explicit.diagnostics.some(diagnostic => diagnostic.severity === 'error'), false);
    assert.strictEqual(explicit.measures[0].chordPlacementMode, 'explicitDuration');
    assert.deepStrictEqual(explicit.measures[0].chordBeatOffsets, [
      { n: 0, d: 1 },
      { n: 2, d: 1 },
      { n: 3, d: 1 }
    ]);
  });

  it('distinguishes authored, implicit, and repeated rhythm and copies repeat onsets', () => {
    const score = parseGuitarDsl('time: 6/8\n| C D E |\n| % |');
    assert.strictEqual(score.diagnostics.some(diagnostic => diagnostic.severity === 'error'), false);
    assert.deepStrictEqual(offsets('time: 6/8\n| C D E |\n| % |'), [
      { mode: 'equalSplit', origin: 'implicit', beats: [{ n: 0, d: 1 }, { n: 1, d: 1 }, { n: 2, d: 1 }] },
      { mode: 'equalSplit', origin: 'repeat', beats: [{ n: 0, d: 1 }, { n: 1, d: 1 }, { n: 2, d: 1 }] }
    ]);

    const explicit = parseGuitarDsl('| C 4 D 4 4 4 |');
    assert.strictEqual(explicit.measures[0].rhythmOrigin, 'explicit');
    assert.strictEqual(explicit.measures[0].rhythmSource, undefined);
    assert.deepStrictEqual(explicit.measures[0].chordBeatOffsets, [{ n: 0, d: 1 }, { n: 1, d: 1 }]);
  });
});
