import * as assert from 'assert';
import {
  GrooveMeasure, observedEvents, observedPenalty, optimizeGroove, optimizeSection, pendulumDirection,
  presetLocalCost, presetMask, validateGrooveRefinement
} from '../../src/transcription/grooveOptimizer';
import { getPresetById } from '../../src/strummingPatterns';

function gm(partial: Partial<GrooveMeasure> & Pick<GrooveMeasure, 'attacks'>): GrooveMeasure {
  return { measureIndex: 0, grid: 8, style: 'strum', confidence: 1, ...partial };
}

const ALL_EIGHTHS = [0, 1, 2, 3, 4, 5, 6, 7];

describe('transcription - groove optimizer', () => {
  describe('validation', () => {
    const ok = { sections: [{ sectionIndex: 0, measures: [{ measureIndex: 0, grid: 8, style: 'strum', attacks: [0, 2, 3], accents: [2], confidence: 0.9 }] }] };

    it('accepts a well-formed refinement', () => {
      assert.strictEqual(validateGrooveRefinement(ok, [1]).valid, true);
    });

    it('accepts omitted accents and records sustainFromPrevious', () => {
      const data = { sections: [{ sectionIndex: 0, measures: [{ measureIndex: 0, grid: 16, style: 'strum', attacks: [4], sustainFromPrevious: true, confidence: 0.5 }] }] };
      const res = validateGrooveRefinement(data, [1]);
      assert.ok(res.valid);
      if (res.valid) {
        assert.strictEqual(res.refinement.sections[0].measures[0].accents, undefined);
        assert.strictEqual(res.refinement.sections[0].measures[0].sustainFromPrevious, true);
      }
    });

    const bad = (patch: Record<string, unknown>) => ({ sections: [{ sectionIndex: 0, measures: [{ ...ok.sections[0].measures[0], ...patch }] }] });
    const invalidCases: [string, unknown][] = [
      ['unsorted attacks', bad({ attacks: [2, 0] })],
      ['duplicate attacks', bad({ attacks: [0, 0] })],
      ['attack out of range', bad({ attacks: [0, 8] })],
      ['accent not in attacks', bad({ accents: [1] })],
      ['invalid grid', bad({ grid: 6 })],
      ['invalid style', bad({ style: 'tapping' })],
      ['confidence out of range', bad({ confidence: 1.5 })],
      ['wrong measure index', bad({ measureIndex: 1 })]
    ];
    for (const [label, data] of invalidCases) {
      it(`rejects ${label}`, () => assert.strictEqual(validateGrooveRefinement(data, [1]).valid, false));
    }

    it('rejects a shape that differs from the baseline', () => {
      assert.strictEqual(validateGrooveRefinement(ok, [2]).valid, false);
      assert.strictEqual(validateGrooveRefinement(ok, [1, 1]).valid, false);
    });

    it('enforces the grid required by the beat type', () => {
      assert.strictEqual(validateGrooveRefinement(ok, [1], '8beat').valid, true);
      assert.strictEqual(validateGrooveRefinement(ok, [1], '16beat').valid, false);
    });
  });

  describe('preset normalization', () => {
    it('normalizes presets to attack/accent masks on the grid', () => {
      assert.deepStrictEqual(presetMask(getPresetById('8beat_standard')!, 8), { attacks: [0, 2, 3, 4, 5, 6], accents: [] });
      assert.deepStrictEqual(presetMask(getPresetById('8beat_standard')!, 16), { attacks: [0, 4, 6, 8, 10, 12], accents: [] });
      assert.deepStrictEqual(presetMask(getPresetById('8beat_accent')!, 8), { attacks: ALL_EIGHTHS, accents: [2, 6] });
      assert.deepStrictEqual(presetMask(getPresetById('16beat_standard')!, 16), { attacks: [0, 4, 6, 7, 8, 10, 12, 14], accents: [] });
      assert.deepStrictEqual(presetMask(getPresetById('triplet_slow_rock')!, 12), { attacks: [0, 2, 3, 5, 6, 8, 9, 11], accents: [] });
      assert.deepStrictEqual(presetMask(getPresetById('ballad_whole')!, 8), { attacks: [0], accents: [] });
    });

    it('marks presets that cannot land exactly on the grid as incompatible', () => {
      assert.strictEqual(presetMask(getPresetById('16beat_standard')!, 8), null);
      assert.strictEqual(presetMask(getPresetById('triplet_slow_rock')!, 16), null);
      assert.strictEqual(presetMask(getPresetById('8beat_standard')!, 12), null);
    });

    it('counts accent differences only when accents were reported', () => {
      const mask = presetMask(getPresetById('8beat_accent')!, 8)!;
      assert.strictEqual(presetLocalCost(mask, gm({ attacks: ALL_EIGHTHS })), 0);
      assert.strictEqual(presetLocalCost(mask, gm({ attacks: ALL_EIGHTHS, accents: [] })), 6);
      assert.strictEqual(presetLocalCost(mask, gm({ attacks: [0, 2, 4, 6] })), 40);
    });
  });

  describe('observed candidate', () => {
    it('uses an 8th pendulum when every attack is on an eighth: the off-beat is an upstroke even on grid 16', () => {
      const m = gm({ grid: 16, attacks: [0, 4, 6, 8, 12] });
      assert.deepStrictEqual(m.attacks.map(a => pendulumDirection(a, m)), ['d', 'd', 'u', 'd', 'd']);
    });

    it('uses a 16th pendulum when a 16th attack is present', () => {
      const m = gm({ grid: 16, attacks: [0, 4, 6, 7] });
      assert.deepStrictEqual(m.attacks.map(a => pendulumDirection(a, m)), ['d', 'd', 'd', 'u']);
    });

    it('uses even down / odd up on grid 8', () => {
      const m = gm({ attacks: [0, 1, 2, 3] });
      assert.deepStrictEqual(m.attacks.map(a => pendulumDirection(a, m)), ['d', 'u', 'd', 'u']);
    });

    it('uses d, u, d within each triplet beat', () => {
      const m = gm({ grid: 12, attacks: [0, 1, 2, 3, 4, 5] });
      assert.deepStrictEqual(m.attacks.map(a => pendulumDirection(a, m)), ['d', 'u', 'd', 'd', 'u', 'd']);
    });

    it('builds durations from slot distances with a leading rest and syncopation', () => {
      const events = observedEvents(gm({ attacks: [2, 3, 6], accents: [3] }));
      assert.deepStrictEqual(events, [
        { duration: 'r4' },
        { duration: '8', direction: 'd' },
        { duration: '4+8', direction: 'u', accent: true },
        { duration: '4', direction: 'd' }
      ]);
    });

    it('builds long triplet durations additively', () => {
      const events = observedEvents(gm({ grid: 12, attacks: [0, 5] }));
      assert.deepStrictEqual(events.map(e => e.duration), ['4+4t', '2+8t']);
    });

    it('omits stroke directions for arpeggio style', () => {
      const events = observedEvents(gm({ style: 'arpeggio', attacks: [0, 2, 4, 6] }));
      assert.ok(events.every(e => e.direction === undefined));
    });

    it('penalizes low confidence only below 0.85', () => {
      assert.strictEqual(observedPenalty(0.9), 0);
      assert.ok(Math.abs(observedPenalty(0.35) - 20) < 1e-9);
    });
  });

  describe('section optimizer', () => {
    it('lets an exact high-confidence unusual observation beat every preset', () => {
      const [choice] = optimizeSection([gm({ attacks: [0, 3, 6], confidence: 1 })]);
      assert.ok(choice.id.startsWith('observed:'));
      assert.deepStrictEqual(choice.events.map(e => e.duration), ['4+8', '4+8', '4']);
    });

    it('snaps a low-confidence noisy observation to the closest stable preset (declaration order on ties)', () => {
      const [choice] = optimizeSection([gm({ attacks: [0, 2, 3, 4, 6], confidence: 0.3 })]);
      assert.strictEqual(choice.id, '8beat_standard');
      assert.deepStrictEqual(choice.events, [
        { duration: '4', direction: 'd' }, { duration: '8', direction: 'd' }, { duration: '8', direction: 'u' },
        { duration: '8', direction: 'd' }, { duration: '8', direction: 'u' }, { duration: '4', direction: 'd' }
      ]);
    });

    it('keeps the same preset across a section when the local difference is smaller than the transition cost', () => {
      // Alone, the middle measure would pick its exact observed candidate (cost 0 < preset cost 3).
      const middle = gm({ measureIndex: 1, attacks: ALL_EIGHTHS, accents: [2], confidence: 0.85 });
      assert.ok(optimizeSection([middle])[0].id.startsWith('observed:'));
      const ids = optimizeSection([
        gm({ attacks: ALL_EIGHTHS, accents: [] }),
        middle,
        gm({ measureIndex: 2, attacks: ALL_EIGHTHS, accents: [] })
      ]).map(c => c.id);
      assert.deepStrictEqual(ids, ['8beat_alternate', '8beat_alternate', '8beat_alternate']);
    });

    it('chooses arpeggio presets for arpeggio observations', () => {
      const [choice] = optimizeSection([gm({ style: 'arpeggio', attacks: ALL_EIGHTHS, confidence: 0.5 })]);
      assert.strictEqual(choice.id, 'arpeggio_8beat');
    });

    it('does not carry DP state across a section boundary', () => {
      const lone = gm({ attacks: ALL_EIGHTHS, accents: [2], confidence: 0.8 });
      const result = optimizeGroove({
        sections: [
          { sectionIndex: 0, measures: [gm({ attacks: ALL_EIGHTHS, accents: [] })] },
          { sectionIndex: 1, measures: [lone] }
        ]
      });
      // With carried state the second section would stay on 8beat_alternate (3 < 2 + 2).
      assert.deepStrictEqual(result[1][0], observedEvents(lone));
    });

    it('ties a held stroke across the barline instead of a leading rest', () => {
      const choices = optimizeSection([
        gm({ attacks: [0, 2, 4, 6, 7] }),
        gm({ measureIndex: 1, attacks: [2, 4, 6], sustainFromPrevious: true })
      ]);
      const prev = choices[0].events;
      assert.strictEqual(prev[prev.length - 1].tie, true);
      assert.deepStrictEqual(choices[1].events[0], { duration: '4' });
    });

    it('never ties into the first measure of a section', () => {
      const [choice] = optimizeSection([gm({ attacks: [2, 4, 6], sustainFromPrevious: true })]);
      assert.deepStrictEqual(choice.events[0], { duration: 'r4' });
    });
  });
});
