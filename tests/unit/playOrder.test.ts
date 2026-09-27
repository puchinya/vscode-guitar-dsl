import * as assert from 'assert';
import {
  MAX_PLAY_ORDER_OCCURRENCES,
  PlayOrderMeasure,
  PlayOrderResult,
  resolvePlayOrder
} from '../../src/playOrder';

function measure(measureIndex: number, values: Partial<PlayOrderMeasure> = {}): PlayOrderMeasure {
  return {
    measureIndex,
    repeatStart: false,
    repeatEnd: false,
    ...values
  };
}

function sequence(result: PlayOrderResult): number[] {
  return result.occurrences.map(occurrence => occurrence.measureIndex);
}

describe('playOrder - deterministic written-measure execution order', () => {
  it('T01 returns an empty valid result for empty input', () => {
    assert.deepStrictEqual(resolvePlayOrder([]), { valid: true, occurrences: [], diagnostics: [] });
  });

  it('T02 resolves a linear score with contiguous occurrence indices', () => {
    const result = resolvePlayOrder([measure(0), measure(1), measure(2)]);
    assert.deepStrictEqual(sequence(result), [0, 1, 2]);
    assert.deepStrictEqual(result.occurrences.map(item => item.occurrenceIndex), [0, 1, 2]);
  });

  it('T03 plays an explicit repeat twice', () => {
    const result = resolvePlayOrder([
      measure(0, { repeatStart: true }),
      measure(1, { repeatEnd: true }),
      measure(2)
    ]);
    assert.deepStrictEqual(sequence(result), [0, 1, 0, 1, 2]);
  });

  it('T04 selects first and second endings and processes the skipped first ending repeat end', () => {
    const result = resolvePlayOrder([
      measure(0, { repeatStart: true }),
      measure(1, { bracket: '1.', repeatEnd: true }),
      measure(2, { bracket: '2.' }),
      measure(3)
    ]);
    assert.deepStrictEqual(sequence(result), [0, 1, 0, 2, 3]);
  });

  it('T05 expands a repeat to three passes for a third ending', () => {
    const result = resolvePlayOrder([
      measure(0, { repeatStart: true }),
      measure(1, { bracket: '1,2.', repeatEnd: true }),
      measure(2, { bracket: '3.' })
    ]);
    assert.deepStrictEqual(sequence(result), [0, 1, 0, 1, 0, 2]);
  });

  it('routes a skipped ending to the later volta matching the current pass', () => {
    const result = resolvePlayOrder([
      measure(0, { repeatStart: true }),
      measure(1, { bracket: '1.', repeatEnd: true }),
      measure(2, { bracket: '2.', repeatEnd: true }),
      measure(3, { bracket: '3.' })
    ]);
    assert.deepStrictEqual(sequence(result), [0, 1, 0, 2, 0, 3]);

    const passGap = resolvePlayOrder([
      measure(0, { repeatStart: true }),
      measure(1, { bracket: '1.', repeatEnd: true }),
      measure(2, { bracket: '3.' })
    ]);
    assert.deepStrictEqual(sequence(passGap), [0, 1, 0, 0, 2]);
  });

  it('T06 accepts volta lists, punctuation variants, ranges, and mixed ranges/lists', () => {
    for (const bracket of ['1,2.', '1.,2.', '1-2.']) {
      const result = resolvePlayOrder([
        measure(0, { repeatStart: true }),
        measure(1, { bracket, repeatEnd: true }),
        measure(2, { bracket: '3.' })
      ]);
      assert.strictEqual(result.valid, true, `accepted ${bracket}`);
      assert.deepStrictEqual(sequence(result), [0, 1, 0, 1, 0, 2], `normalized ${bracket}`);
    }

    const mixed = resolvePlayOrder([
      measure(0, { repeatStart: true }),
      measure(1, { bracket: '1,3-4.' }),
      measure(2, { repeatEnd: true })
    ]);
    assert.strictEqual(mixed.valid, true);
    assert.deepStrictEqual(sequence(mixed), [0, 1, 2, 0, 2, 0, 1, 2, 0, 1, 2]);
  });

  it('T07 rejects malformed, unsafe, nonpositive, empty, and descending volta values without partial output', () => {
    for (const bracket of ['0.', '-1.', '3-1.', '1,,2.', '1-a.', '9007199254740992.']) {
      const result = resolvePlayOrder([
        measure(0, { repeatStart: true }),
        measure(1, { bracket, repeatEnd: true })
      ]);
      assert.strictEqual(result.valid, false, `rejects ${bracket}`);
      assert.deepStrictEqual(sequence(result), [], `no partial output for ${bracket}`);
      assert.ok(result.diagnostics.some(item => item.code === 'playOrderInvalidVolta'), `typed error for ${bracket}`);
    }
  });

  it('T08 rejects a volta that has no repeat owner', () => {
    const result = resolvePlayOrder([measure(0, { bracket: '1.' })]);
    assert.strictEqual(result.valid, false);
    assert.deepStrictEqual(sequence(result), []);
    assert.deepStrictEqual(result.diagnostics.map(item => item.code), ['playOrderVoltaWithoutRepeat']);
  });

  it('T09 rejects an unclosed explicit repeat start', () => {
    const result = resolvePlayOrder([measure(0, { repeatStart: true }), measure(1)]);
    assert.strictEqual(result.valid, false);
    assert.deepStrictEqual(sequence(result), []);
    assert.ok(result.diagnostics.some(item => item.code === 'playOrderUnclosedRepeat'));
  });

  it('T10 uses the nearest named section as an implicit right-repeat start', () => {
    const result = resolvePlayOrder([
      measure(0, { sectionName: 'Outro' }),
      measure(1, { repeatEnd: true })
    ]);
    assert.deepStrictEqual(sequence(result), [0, 1, 0, 1]);
  });

  it('T11 uses score position zero when an implicit right repeat has no section', () => {
    const result = resolvePlayOrder([measure(0), measure(1, { repeatEnd: true })]);
    assert.deepStrictEqual(sequence(result), [0, 1, 0, 1]);
  });

  it('T12 resets a nested repeat when its outer repeat re-enters it', () => {
    const result = resolvePlayOrder([
      measure(0, { repeatStart: true }),
      measure(1, { repeatStart: true, repeatEnd: true }),
      measure(2, { repeatEnd: true }),
      measure(3)
    ]);
    assert.deepStrictEqual(sequence(result), [0, 1, 1, 2, 0, 1, 1, 2, 3]);
  });

  it('keeps consecutive inner volta repeat ends owned by the inner block while the outer block is open', () => {
    const result = resolvePlayOrder([
      measure(0, { repeatStart: true }),
      measure(1, { repeatStart: true }),
      measure(2, { bracket: '1.', repeatEnd: true }),
      measure(3, { bracket: '2.', repeatEnd: true }),
      measure(4, { repeatEnd: true }),
      measure(5)
    ]);
    assert.deepStrictEqual(sequence(result), [0, 1, 2, 1, 3, 4, 0, 1, 2, 1, 3, 4, 5]);
  });

  it('T13 ignores Fine before a D.C. and stops after Fine following the jump', () => {
    const result = resolvePlayOrder([
      measure(0),
      measure(1, { specialMark: 'fine' }),
      measure(2),
      measure(3, { specialMark: 'dc' })
    ]);
    assert.deepStrictEqual(sequence(result), [0, 1, 2, 3, 0, 1]);
  });

  it('T14 jumps to the unique Segno once for D.S.', () => {
    const result = resolvePlayOrder([
      measure(0),
      measure(1, { specialMark: 'segno' }),
      measure(2),
      measure(3, { specialMark: 'ds' }),
      measure(4)
    ]);
    assert.deepStrictEqual(sequence(result), [0, 1, 2, 3, 1, 2, 3, 4]);
  });

  it('T15 rejects missing and ambiguous Segno destinations', () => {
    const missing = resolvePlayOrder([measure(0, { specialMark: 'ds' })]);
    assert.strictEqual(missing.valid, false);
    assert.deepStrictEqual(sequence(missing), []);
    assert.ok(missing.diagnostics.some(item => item.code === 'playOrderMissingDestination' && item.args?.destination === 'Segno'));

    const ambiguous = resolvePlayOrder([
      measure(0, { specialMark: 'segno' }),
      measure(1, { specialMark: 'segno' }),
      measure(2, { specialMark: 'ds' })
    ]);
    assert.strictEqual(ambiguous.valid, false);
    assert.deepStrictEqual(sequence(ambiguous), []);
    assert.ok(ambiguous.diagnostics.some(item => item.code === 'playOrderAmbiguousDestination' && item.args?.destination === 'Segno'));
  });

  it('T16 jumps to the unique Coda after the first active to-Coda measure', () => {
    const result = resolvePlayOrder([
      measure(0, { specialMark: 'segno' }),
      measure(1, { specialMark: 'to_coda' }),
      measure(2),
      measure(3, { specialMark: 'ds' }),
      measure(4, { specialMark: 'coda' }),
      measure(5)
    ]);
    assert.deepStrictEqual(sequence(result), [0, 1, 2, 3, 0, 1, 4, 5]);
  });

  it('T17 rejects active to-Coda flow with missing or ambiguous Coda destinations', () => {
    const missing = resolvePlayOrder([
      measure(0, { specialMark: 'to_coda' }),
      measure(1, { specialMark: 'dc' })
    ]);
    assert.strictEqual(missing.valid, false);
    assert.deepStrictEqual(sequence(missing), []);
    assert.ok(missing.diagnostics.some(item => item.code === 'playOrderMissingDestination' && item.args?.destination === 'Coda'));

    const ambiguous = resolvePlayOrder([
      measure(0, { specialMark: 'to_coda' }),
      measure(1, { specialMark: 'coda' }),
      measure(2, { specialMark: 'coda' }),
      measure(3, { specialMark: 'dc' })
    ]);
    assert.strictEqual(ambiguous.valid, false);
    assert.deepStrictEqual(sequence(ambiguous), []);
    assert.ok(ambiguous.diagnostics.some(item => item.code === 'playOrderAmbiguousDestination' && item.args?.destination === 'Coda'));
  });

  it('T18 keeps navigation marks render-only without a primary jump', () => {
    const result = resolvePlayOrder([
      measure(0, { specialMark: 'segno' }),
      measure(1, { specialMark: 'to_coda' }),
      measure(2, { specialMark: 'coda' }),
      measure(3, { specialMark: 'fine' })
    ]);
    assert.strictEqual(result.valid, true);
    assert.deepStrictEqual(sequence(result), [0, 1, 2, 3]);
  });

  it('T19 rejects multiple D.C. or D.S. primary jumps without selecting one', () => {
    const result = resolvePlayOrder([
      measure(0, { specialMark: 'dc' }),
      measure(1, { specialMark: 'ds' })
    ]);
    assert.strictEqual(result.valid, false);
    assert.deepStrictEqual(sequence(result), []);
    assert.strictEqual(result.diagnostics.filter(item => item.code === 'playOrderMultipleNavigationJumps').length, 2);
  });

  it('T20 does not repeat backward after D.C. and selects the terminal volta', () => {
    const result = resolvePlayOrder([
      measure(0, { repeatStart: true }),
      measure(1, { bracket: '1.', repeatEnd: true }),
      measure(2, { bracket: '2.', specialMark: 'fine' }),
      measure(3, { specialMark: 'dc' })
    ]);
    assert.deepStrictEqual(sequence(result), [0, 1, 0, 2, 3, 0, 2]);
  });

  it('T21 keeps the written identity of a repeated-measure occurrence', () => {
    const result = resolvePlayOrder([
      measure(7, { repeatStart: true }),
      measure(12, { repeatEnd: true })
    ]);
    assert.deepStrictEqual(sequence(result), [7, 12, 7, 12]);
  });

  it('T22 preserves input identities and contiguous occurrence indices', () => {
    const input = [measure(14, { repeatStart: true }), measure(29, { repeatEnd: true })];
    const result = resolvePlayOrder(input);
    assert.deepStrictEqual(result.occurrences.map(item => item.measureIndex), [14, 29, 14, 29]);
    assert.deepStrictEqual(result.occurrences.map(item => item.occurrenceIndex), [0, 1, 2, 3]);
  });

  it('T23 is deterministic, reentrant, and does not mutate input', () => {
    const input = Object.freeze([
      Object.freeze(measure(5, { repeatStart: true })),
      Object.freeze(measure(9, { bracket: '1.', repeatEnd: true })),
      Object.freeze(measure(12, { bracket: '2.' }))
    ]);
    const before = JSON.stringify(input);
    const first = resolvePlayOrder(input);
    const second = resolvePlayOrder(input);
    assert.deepStrictEqual(second, first);
    assert.strictEqual(JSON.stringify(input), before);
  });

  it('T24 terminates a very large repeat through the typed occurrence guard', () => {
    const result = resolvePlayOrder([
      measure(0, { repeatStart: true }),
      measure(1, { bracket: '1-1000000.', repeatEnd: true })
    ]);
    assert.strictEqual(result.valid, false);
    assert.deepStrictEqual(sequence(result), []);
    assert.ok(result.diagnostics.some(item => item.code === 'playOrderLimitExceeded'));

    const sparse = resolvePlayOrder([
      measure(0, { repeatStart: true, bracket: '1000000000000.' }),
      measure(1, { repeatEnd: true, bracket: '1000000000000.' })
    ]);
    assert.strictEqual(sparse.valid, true, 'empty pass ranges are skipped without changing emitted occurrences');
    assert.deepStrictEqual(sequence(sparse), [0, 1]);
  });

  it('T25 rejects the first occurrence beyond the hard cap and discards partial output', () => {
    const input = Array.from({ length: MAX_PLAY_ORDER_OCCURRENCES + 1 }, (_, index) => measure(index));
    const result = resolvePlayOrder(input);
    assert.strictEqual(result.valid, false);
    assert.deepStrictEqual(sequence(result), []);
    assert.deepStrictEqual(result.diagnostics.map(item => item.code), ['playOrderLimitExceeded']);
    assert.strictEqual(result.diagnostics[0].args?.limit, MAX_PLAY_ORDER_OCCURRENCES);
  });

  it('T31 keeps skipped navigation marks inert while still evaluating skipped repeat ends', () => {
    const fine = resolvePlayOrder([
      measure(0, { repeatStart: true }),
      measure(1, { bracket: '1.', repeatEnd: true, specialMark: 'fine' }),
      measure(2, { bracket: '2.' }),
      measure(3, { specialMark: 'dc' })
    ]);
    assert.deepStrictEqual(sequence(fine), [0, 1, 0, 2, 3, 0, 2, 3]);

    const toCoda = resolvePlayOrder([
      measure(0, { repeatStart: true }),
      measure(1, { bracket: '1.', repeatEnd: true, specialMark: 'to_coda' }),
      measure(2, { bracket: '2.' }),
      measure(3, { specialMark: 'dc' }),
      measure(4, { specialMark: 'coda' })
    ]);
    assert.deepStrictEqual(sequence(toCoda), [0, 1, 0, 2, 3, 0, 2, 3, 4]);

    const ds = resolvePlayOrder([
      measure(0, { repeatStart: true, specialMark: 'segno' }),
      measure(1, { bracket: '1.', repeatEnd: true, specialMark: 'ds' }),
      measure(2, { bracket: '2.' })
    ]);
    assert.deepStrictEqual(sequence(ds), [0, 1, 0, 2]);

    const dc = resolvePlayOrder([
      measure(0, { repeatStart: true }),
      measure(1, { bracket: '1.', repeatEnd: true, specialMark: 'dc' }),
      measure(2, { bracket: '2.' })
    ]);
    assert.deepStrictEqual(sequence(dc), [0, 1, 0, 2]);
  });
});
