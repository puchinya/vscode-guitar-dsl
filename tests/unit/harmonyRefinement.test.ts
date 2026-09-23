import * as assert from 'assert';
import {
  HarmonyMeasure, chooseChords, findAmbiguousEvents, harmonyToChordEvents, validateHarmonyRefinement
} from '../../src/transcription/harmonyRefinement';

function measure(measureIndex: number, changes: [number, [string, number][]][]) {
  return {
    measureIndex,
    changes: changes.map(([tick16, cands]) => ({ tick16, candidates: cands.map(([name, confidence]) => ({ name, confidence })) }))
  };
}

function refinementOf(...sections: ReturnType<typeof measure>[][]) {
  return { sections: sections.map((measures, sectionIndex) => ({ sectionIndex, measures })) };
}

function valid(data: unknown, shape: number[]) {
  const res = validateHarmonyRefinement(data, shape);
  if (!res.valid) assert.fail(res.error);
  return res.refinement;
}

describe('transcription - harmony refinement', () => {
  describe('validation', () => {
    it('accepts a well-formed refinement and an optional sounding key', () => {
      const data = { soundingKey: 'Bb', ...refinementOf([measure(0, [[0, [['Bb', 0.9]]], [8, [['F', 0.9]]]])]) };
      const ref = valid(data, [1]);
      assert.strictEqual(ref.soundingKey, 'Bb');
    });

    it('ignores an unparsable sounding key without failing', () => {
      const ref = valid({ soundingKey: 'H', ...refinementOf([measure(0, [[0, [['C', 0.9]]]])]) }, [1]);
      assert.strictEqual(ref.soundingKey, undefined);
    });

    const invalidCases: [string, unknown][] = [
      ['missing tick 0', refinementOf([measure(0, [[4, [['C', 0.9]]]])])],
      ['duplicate tick', refinementOf([measure(0, [[0, [['C', 0.9]]], [0, [['G', 0.9]]]])])],
      ['descending tick', refinementOf([measure(0, [[0, [['C', 0.9]]], [8, [['G', 0.9]]], [4, [['F', 0.9]]]])])],
      ['tick out of range', refinementOf([measure(0, [[0, [['C', 0.9]]], [16, [['G', 0.9]]]])])],
      ['non-integer tick', refinementOf([measure(0, [[0, [['C', 0.9]]], [2.5, [['G', 0.9]]]])])],
      ['confidence above 1', refinementOf([measure(0, [[0, [['C', 1.2]]]])])],
      ['non-finite confidence', refinementOf([measure(0, [[0, [['C', NaN]]]])])],
      ['increasing confidence', refinementOf([measure(0, [[0, [['C', 0.4], ['Am', 0.6]]]])])],
      ['invalid chord name', refinementOf([measure(0, [[0, [['Cx!', 0.9]]]])])],
      ['no candidates', refinementOf([measure(0, [[0, []]])])],
      ['four candidates', refinementOf([measure(0, [[0, [['C', 0.9], ['Am', 0.5], ['F', 0.4], ['G', 0.3]]]])])],
      ['capo field', { capo: 3, ...refinementOf([measure(0, [[0, [['C', 0.9]]]])]) }],
      ['too few measures', refinementOf([measure(0, [[0, [['C', 0.9]]]])])],
    ];
    for (const [label, data] of invalidCases) {
      it(`rejects ${label}`, () => {
        const shape = label === 'too few measures' ? [2] : [1];
        assert.strictEqual(validateHarmonyRefinement(data, shape).valid, false);
      });
    }

    it('rejects a section count that differs from the baseline', () => {
      const data = refinementOf([measure(0, [[0, [['C', 0.9]]]])]);
      assert.strictEqual(validateHarmonyRefinement(data, [1, 1]).valid, false);
    });

    it('rejects out-of-order measure indexes', () => {
      const data = refinementOf([measure(1, [[0, [['C', 0.9]]]]), measure(0, [[0, [['G', 0.9]]]])]);
      assert.strictEqual(validateHarmonyRefinement(data, [2]).valid, false);
    });
  });

  describe('tick -> duration conversion', () => {
    const cases: [number[], string[]][] = [
      [[0], ['1']],
      [[0, 8], ['2', '2']],
      [[0, 4, 8, 12], ['4', '4', '4', '4']],
      [[0, 2, 4, 8], ['8', '8', '4', '2']],
      [[0, 1, 4], ['16', '8+16', '2+4']],
      [[0, 6], ['4+8', '2+8']],
      [[0, 14], ['2+4+8', '8']]
    ];
    for (const [ticks, expected] of cases) {
      it(`converts ticks ${ticks.join(',')} to ${expected.join(' ')}`, () => {
        const m: HarmonyMeasure = { measureIndex: 0, changes: ticks.map(t => ({ tick16: t, candidates: [{ name: 'C', confidence: 1 }] })) };
        const events = harmonyToChordEvents(m, ticks.map(() => 'C'));
        assert.deepStrictEqual(events.map(e => e.duration), expected);
      });
    }
  });

  describe('ambiguity and verification', () => {
    const ref = valid(refinementOf([
      measure(0, [[0, [['C', 0.95], ['Am', 0.3]]]]), // confident
      measure(1, [[0, [['F', 0.7]]]]),                  // low top confidence
      measure(2, [[0, [['G', 0.9], ['Em', 0.8]]]]),   // close margin
      measure(3, [[0, [['Am', 0.78], ['C', 0.6]]]])   // exactly at the threshold: not ambiguous
    ]), [4]);

    it('detects low-confidence and close-margin events only', () => {
      const events = findAmbiguousEvents(ref);
      assert.deepStrictEqual(events.map(e => e.measureIndex), [1, 2]);
    });

    it('finds nothing ambiguous in a confident refinement (verifier skipped)', () => {
      const confident = valid(refinementOf([measure(0, [[0, [['C', 0.95]]]])]), [1]);
      assert.strictEqual(findAmbiguousEvents(confident).length, 0);
    });

    it('applies decisions that name a supplied candidate', () => {
      const names = chooseChords(ref, { decisions: [{ sectionIndex: 0, measureIndex: 2, tick16: 0, selectedName: 'Em' }] });
      assert.deepStrictEqual(names[0].map(m => m[0]), ['C', 'F', 'Em', 'Am']);
    });

    it('rejects a decision outside the candidates and falls back to the top candidate', () => {
      const names = chooseChords(ref, { decisions: [{ sectionIndex: 0, measureIndex: 2, tick16: 0, selectedName: 'B7' }] });
      assert.strictEqual(names[0][2][0], 'G');
    });

    it('ignores decisions for events that were not ambiguous', () => {
      const names = chooseChords(ref, { decisions: [{ sectionIndex: 0, measureIndex: 0, tick16: 0, selectedName: 'Am' }] });
      assert.strictEqual(names[0][0][0], 'C');
    });

    it('falls back to the top candidates when verification is missing or malformed', () => {
      assert.deepStrictEqual(chooseChords(ref)[0].map(m => m[0]), ['C', 'F', 'G', 'Am']);
      assert.deepStrictEqual(chooseChords(ref, { decisions: 'oops' })[0].map(m => m[0]), ['C', 'F', 'G', 'Am']);
    });

    it('keeps sounding chord names untouched (no capo applied here)', () => {
      const bb = valid(refinementOf([measure(0, [[0, [['Bb', 0.9]]]])]), [1]);
      assert.strictEqual(chooseChords(bb)[0][0][0], 'Bb');
    });
  });
});
