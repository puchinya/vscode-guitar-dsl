import * as assert from 'assert';

// The evaluator scripts are ESM (.mjs) and only run their CLI when invoked directly.
const load = async () => ({
  lab: await import('../../scripts/evaluate-audio-mir.mjs'),
  gs: await import('../../scripts/evaluate-audio-mir-guitarset.mjs')
});

describe('audioMir evaluators', () => {
  it('maps Harte and GuitarDSL labels onto the Audio MIR vocabulary', async () => {
    const { lab } = await load();
    const cases: [string, unknown][] = [
      ['D:maj7', { root: 2, quality: 'maj7', triad: 'maj' }],
      ['F#:min', { root: 6, quality: 'min', triad: 'min' }],
      ['Bb:7', { root: 10, quality: '7', triad: 'maj' }],
      ['C', { root: 0, quality: 'maj', triad: 'maj' }],
      ['C#m7', { root: 1, quality: 'min7', triad: 'min' }],
      ['A:hdim7', { root: 9, quality: null, triad: null }],
      ['G:9', { root: 7, quality: '7', triad: 'maj' }],
      ['D#:sus2(7)/1', { root: 3, quality: 'sus2', triad: null }],
      ['G#:maj6(*5)/1', { root: 8, quality: 'maj', triad: 'maj' }],
      ['E:min9(*1)/2', { root: 4, quality: 'min7', triad: 'min' }],
      ['B:dim7(11)/4', { root: 11, quality: 'dim', triad: null }],
      ['C:(1,5)/1', { root: 0, quality: null, triad: null }],
      ['F:minmaj7/1', { root: 5, quality: null, triad: 'min' }],
      ['C:maj11/1', { root: 0, quality: 'maj7', triad: 'maj' }],
      ['D:maj13(*5)/1', { root: 2, quality: 'maj7', triad: 'maj' }],
      ['G:min13/1', { root: 7, quality: 'min7', triad: 'min' }],
      ['E:sus4', { root: 4, quality: 'sus4', triad: null }],
      ['C:aug', { root: 0, quality: 'aug', triad: null }],
      ['Bdim', { root: 11, quality: 'dim', triad: null }],
      ['A:min/b3', { root: 9, quality: 'min', triad: 'min' }]
    ];
    for (const [label, expected] of cases) {
      assert.deepStrictEqual(lab.parseChord(label), expected, label);
    }
    assert.strictEqual(lab.parseChord('N'), null);
  });

  it('scores duration-weighted root, exact and maj/min recall', async () => {
    const { lab } = await load();
    const result = {
      measures: [{
        index: 0, startSeconds: 0, endSeconds: 2, subdivision: 8, attacks: [],
        chords: [{ tick16: 0, name: 'Dmaj7', confidence: 1 }, { tick16: 8, name: 'Bm7', confidence: 1 }]
      }]
    };
    const reference = [
      { start: 0, end: 1, label: 'D:maj' },
      { start: 1, end: 2, label: 'B:min7' }
    ];
    const m = lab.evaluate(result, reference);
    assert.strictEqual(m.rootRecall, 1);
    assert.strictEqual(m.exactSupportedRecall, 0.5);
    assert.strictEqual(m.majminRecall, 1);
    assert.deepStrictEqual(m.confusion, { maj: { maj7: 1 }, min7: { min7: 1 } });
  });

  it('reads the performed chord annotation and tempo from GuitarSet JAMS', async () => {
    const { gs } = await load();
    const jams = {
      annotations: [
        { namespace: 'chord', data: [{ time: 0, duration: 2, value: 'C:maj', confidence: 1 }] },
        { namespace: 'chord', data: [{ time: 0, duration: 1.5, value: 'C:maj7', confidence: 1 }, { time: 1.5, duration: 0.5, value: 'G:7', confidence: 1 }] },
        { namespace: 'tempo', data: [{ time: 0, duration: 2, value: 96, confidence: 1 }] }
      ]
    };
    assert.deepStrictEqual(gs.readJams(jams), {
      chords: [{ start: 0, end: 1.5, label: 'C:maj7' }, { start: 1.5, end: 2, label: 'G:7' }],
      bpm: 96
    });
  });

  it('reports tempo Acc1 and Acc2 with a 4% tolerance', async () => {
    const { lab } = await load();
    const acc = lab.createAccumulator();
    const metrics = lab.evaluate({ measures: [] }, []);
    acc.add(metrics, { estimate: 121, reference: 120 }); // Acc1
    acc.add(metrics, { estimate: 61, reference: 120 }); // half time: Acc2 only
    acc.add(metrics, { estimate: 130, reference: 120 }); // 8.3% off: neither
    acc.add(metrics, { estimate: 356, reference: 120 }); // 3x within 4%: Acc2 only
    const s = acc.summary();
    assert.strictEqual(s.tempoAcc1, 1 / 4);
    assert.strictEqual(s.tempoAcc2, 3 / 4);
    assert.strictEqual(s.bpmMedianAbsError, 59); // upper median of [1, 10, 59, 236]
    assert.strictEqual(lab.createAccumulator().summary().tempoAcc1, undefined);
  });
});
