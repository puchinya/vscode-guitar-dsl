import * as assert from 'assert';
import { decomposeBeats, fadd, feq, fnum, frac, parseBeats, parseNoteValue, parseRhythmDuration, ZERO } from '../../src/duration';
import { parseDurationToBeats } from '../../src/compiler';

describe('duration - note value notation', () => {
  it('parses plain, dotted, triplet and added note values', () => {
    const cases: [string, number][] = [
      ['1', 4], ['2', 2], ['4', 1], ['8', 0.5], ['16', 0.25],
      ['2.', 3], ['4.', 1.5], ['8.', 0.75],
      ['2+8', 2.5], ['4+8+16', 1.75]
    ];
    for (const [str, beats] of cases) {
      const v = parseNoteValue(str);
      assert.ok(v, str);
      assert.strictEqual(fnum(v.beats), beats, str);
    }
  });

  it('keeps triplets exact: three 8t make exactly one beat', () => {
    const t = parseNoteValue('8t')!;
    assert.deepStrictEqual(t.beats, frac(1, 3));
    const sum = fadd(fadd(fadd(ZERO, t.beats), t.beats), t.beats);
    assert.ok(feq(sum, frac(1)));
    assert.deepStrictEqual(parseNoteValue('4t')!.beats, frac(2, 3));
  });

  it('rejects invalid note values', () => {
    for (const str of ['3', '2.5', '8..', '', '32', '4t.', '+4', '4+', 'q']) {
      assert.strictEqual(parseNoteValue(str), null, str);
    }
  });

  it('does not accept a dot in rhythm durations (the dot separates modifiers)', () => {
    assert.strictEqual(parseNoteValue('4.', false), null);
    assert.strictEqual(fnum(parseRhythmDuration('4+8')!.beats), 1.5);
    assert.strictEqual(fnum(parseRhythmDuration('r8t')!.beats), 1 / 3);
    assert.strictEqual(fnum(parseRhythmDuration('q')!.beats), 1);
  });

  it('parses legacy beat counts', () => {
    assert.deepStrictEqual(parseBeats('2.5'), frac(5, 2));
    assert.deepStrictEqual(parseBeats('3'), frac(3));
    assert.deepStrictEqual(parseBeats('0.5'), frac(1, 2));
    assert.strictEqual(parseBeats('0'), null);
    assert.strictEqual(parseBeats('1/2'), null);
  });

  it('decomposes beat counts in quarter-beat steps into tied note values', () => {
    assert.deepStrictEqual(decomposeBeats(frac(5, 2))!.map(p => [p.base, p.dotted]), [[2, false], [8, false]]);
    assert.deepStrictEqual(decomposeBeats(frac(3, 2))!.map(p => [p.base, p.dotted]), [[4, true]]);
    assert.strictEqual(decomposeBeats(frac(1, 3)), null);
    assert.strictEqual(decomposeBeats(frac(1, 8)), null);
  });

  it('keeps parseDurationToBeats compatible', () => {
    assert.strictEqual(parseDurationToBeats('w'), 4);
    assert.strictEqual(parseDurationToBeats('h'), 2);
    assert.strictEqual(parseDurationToBeats('r16'), 0.25);
    assert.strictEqual(parseDurationToBeats('bogus'), 1);
  });
});
