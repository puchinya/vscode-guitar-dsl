import * as assert from 'assert';
import { decomposeBeats, fadd, feq, fnum, formatNoteValuePart, frac, parseBeats, parseNoteValue, parseNoteValueDetailed, parseRhythmDuration, tupletGroups, ZERO } from '../../src/duration';
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

describe('duration - generic tuplets', () => {
  it('keeps `t` as a 3:2 tuplet with the legacy duration and grouping (T021)', () => {
    const v = parseNoteValue('8t')!;
    assert.deepStrictEqual(v.parts, [{ base: 8, dotted: false, tuplet: { actual: 3, normal: 2 } }]);
    assert.deepStrictEqual(v.beats, frac(1, 3));
    const heads = [0, 1, 2].map(() => ({ part: v.parts[0] }));
    const groups = tupletGroups(heads);
    assert.strictEqual(groups.length, 1);
    assert.strictEqual(groups[0].complete, true);
    assert.strictEqual(groups[0].items.length, 3);
    // Mixed bases close like the legacy "dyadic total" rule: 4t + 8t = 1 beat.
    const mixed = tupletGroups([{ part: parseNoteValue('4t')!.parts[0] }, { part: v.parts[0] }]);
    assert.deepStrictEqual(mixed.map(g => [g.items.length, g.complete]), [[2, true]]);
  });

  it('parses explicit ratios with exact arithmetic (T022)', () => {
    const five = parseNoteValue('8{5:4}')!;
    assert.deepStrictEqual(five.parts[0].tuplet, { actual: 5, normal: 4 });
    let sum = ZERO;
    for (let i = 0; i < 5; i++) sum = fadd(sum, five.beats);
    assert.ok(feq(sum, frac(2)), 'five 8{5:4} = four eighths');
    assert.deepStrictEqual(parseNoteValue('8{6:4}')!.beats, frac(1, 3));
    assert.deepStrictEqual(parseNoteValue('16{7:4}')!.beats, frac(1, 7));
    assert.deepStrictEqual(parseRhythmDuration('8{5:4}')!.beats, frac(2, 5));
    const groups = tupletGroups(Array.from({ length: 5 }, () => ({ part: five.parts[0] })));
    assert.deepStrictEqual(groups.map(g => [g.items.length, g.complete]), [[5, true]]);
    const six = tupletGroups(Array.from({ length: 6 }, () => ({ part: parseNoteValue('8{6:4}')!.parts[0] })));
    assert.deepStrictEqual(six.map(g => [g.items.length, g.complete]), [[6, true]]);
    assert.strictEqual(formatNoteValuePart(five.parts[0]), '8{5:4}');
    assert.strictEqual(formatNoteValuePart(parseNoteValue('8t')!.parts[0]), '8t');
  });

  it('rejects invalid ratios and flags incomplete groups (T023)', () => {
    for (const s of ['8{1:1}', '8{0:4}', '8{17:16}', '8{4:4}', '8{5:1}']) {
      assert.strictEqual(parseNoteValueDetailed(s), 'invalidTuplet', s);
    }
    assert.strictEqual(parseNoteValueDetailed('8{a:4}'), 'invalid');
    const five = parseNoteValue('8{5:4}')!.parts[0];
    const partial = tupletGroups([{ part: five }, { part: five }, { part: { base: 8, dotted: false } }]);
    assert.deepStrictEqual(partial.map(g => [g.items.length, g.complete]), [[2, false]]);
    const other = tupletGroups([{ part: five }, { part: parseNoteValue('8t')!.parts[0] }]);
    assert.deepStrictEqual(other.map(g => g.complete), [false, false]);
  });
});
