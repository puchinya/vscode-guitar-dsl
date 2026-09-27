import * as assert from 'assert';
import {
  AccompanimentPlanResult,
  AccompanimentRequest,
  EndingCandidate,
  TransitionCandidate,
  analyzeAccompaniment,
  formatRhythms,
  planAccompanimentTransform
} from '../../src/accompaniment';
import { parseGuitarDsl } from '../../src/compiler';

type Ok = Extract<AccompanimentPlanResult, { ok: true }>;

function ok(text: string, request: AccompanimentRequest): Ok {
  const r = planAccompanimentTransform(text, request);
  assert.ok(r.ok, JSON.stringify(r));
  return r as Ok;
}

const rhythmsOf = (text: string) => parseGuitarDsl(text).measures.map(m => formatRhythms(m.rhythms));
const Q4 = '4.d 4.d 4.d 4.d';

/** Verse (2 measures, the vocal ends on beat 3 of its last measure) -> Chorus. */
const BOUNDARY = [
  '[Verse]',
  `| C | ${Q4} |`,
  'mel: | c4/4 d4/4 e4/4 f4/4 |',
  'lyr: la la la la',
  `| G | ${Q4} |`,
  'mel: | g4/2 r/2 |',
  'lyr: la',
  '[Chorus]',
  `| F | ${Q4} |`,
  'mel: | a4/1 |',
  'lyr: la'
].join('\n');

const fillGrid = (attacks: number[]): TransitionCandidate => ({ intent: 'fill', targetMeasureOffset: -1, pattern: { source: 'grid', gridUnit: 'eighth', attacks } });

describe('AI-planned transitions and endings (Issue #101)', () => {
  describe('transition context (§11A.1)', () => {
    it('T027H exact vocal timing from mel: + lyr:; the last sung end is relative to the last measure', () => {
      const a = analyzeAccompaniment(BOUNDARY, {});
      assert.ok(a.ok);
      if (!a.ok) return;
      assert.deepStrictEqual(a.transitionContexts, [
        {
          afterSectionIndex: 0,
          currentMeter: '4/4',
          currentFeel: 'straight',
          nextMeter: '4/4',
          nextFeel: 'straight',
          vocal: { continuesByTie: false, continuesByHyphen: false, continuesByMelisma: false, confidence: 'exact', currentLastSungEnd: 2, currentTrailingSpaceBeats: 2, nextFirstSungOnset: 0 }
        }
      ]);
    });

    it('T027H several verses: the latest end of the current section wins', () => {
      const text = ['[A]', `| C | ${Q4} |`, 'mel: | c4/4 d4/4 e4/4 r/4 |', 'lyr: la', 'lyr: la la la', '[B]', `| G | ${Q4} |`].join('\n');
      const a = analyzeAccompaniment(text, {});
      assert.ok(a.ok && a.transitionContexts?.[0].vocal.currentLastSungEnd === 3, JSON.stringify(a));
    });

    it('T027H measure lyrics are measureOnly; no lyrics is none', () => {
      const measureOnly = analyzeAccompaniment(['[A]', `| C | ${Q4} l:"la la" |`, '[B]', `| G | ${Q4} |`].join('\n'), {});
      const none = analyzeAccompaniment(['[A]', `| C | ${Q4} |`, '[B]', `| G | ${Q4} |`].join('\n'), {});
      assert.ok(measureOnly.ok && none.ok);
      if (!measureOnly.ok || !none.ok) return;
      assert.strictEqual(measureOnly.transitionContexts?.[0].vocal.confidence, 'measureOnly');
      assert.strictEqual(none.transitionContexts?.[0].vocal.confidence, 'none');
    });
  });

  describe('transition candidates (§11A.2 – §11A.4)', () => {
    it('T027I / T027J the first legal candidate wins; fills may only add strokes after the vocal', () => {
      const r = ok(BOUNDARY, {
        plans: [],
        transitions: [
          {
            afterSectionIndex: 0,
            candidates: [
              fillGrid([0, 1, 2, 3, 4, 5, 6, 7]), // changes beats 1-2 under the vocal -> rejected
              fillGrid([0, 2, 4, 5, 6, 7]) // same as the base until beat 3, then eighths -> legal
            ]
          }
        ]
      });
      const [t] = r.transitionResults ?? [];
      assert.deepStrictEqual([t.afterSectionIndex, t.applied, t.candidateIndex, t.intent], [0, true, 1, 'fill']);
      assert.match(t.rationale ?? '', /^candidate #2 \(fill\) is legal; rejected #1 fill: transitionConflictsWithVocal/);
      assert.deepStrictEqual(rhythmsOf(r.text), [Q4, '4.d 4.d 8.d 8.u 8.d 8.u', Q4]);
      // The next section's source is untouched.
      assert.deepStrictEqual(r.text.split('\n').slice(7), BOUNDARY.split('\n').slice(7));
    });

    it('T027I all candidates illegal -> no change, with reasons', () => {
      const r = ok(BOUNDARY, { plans: [], transitions: [{ afterSectionIndex: 0, candidates: [fillGrid([0, 1, 2, 3, 4, 5, 6, 7])] }] });
      assert.strictEqual(r.changed, false);
      assert.strictEqual(r.transitionResults?.[0].applied, false);
      assert.match(r.transitionResults?.[0].rationale ?? '', /transitionConflictsWithVocal/);
    });

    it('T027J a tie into the next section blocks fills; the sung measure keeps its accompaniment', () => {
      const tied = BOUNDARY.replace('mel: | g4/2 r/2 |\nlyr: la', 'mel: | g4/1~ |\nlyr: la').replace('mel: | a4/1 |', 'mel: | g4/2 a4/2 |');
      const a = analyzeAccompaniment(tied, {});
      assert.ok(a.ok && a.transitionContexts?.[0].vocal.continuesByTie === true);
      const r = ok(tied, {
        plans: [],
        transitions: [
          {
            afterSectionIndex: 0,
            candidates: [
              fillGrid([0, 2, 4, 5, 6, 7]),
              { intent: 'space', targetMeasureOffset: -1, pattern: { source: 'grid', gridUnit: 'quarter', attacks: [0, 2] } },
              { intent: 'hold', targetMeasureOffset: -1, pattern: { source: 'hold' } }
            ]
          }
        ]
      });
      assert.strictEqual(r.transitionResults?.[0].candidateIndex, 2);
      assert.match(r.transitionResults?.[0].rationale ?? '', /#1 fill: transitionConflictsWithVocal/);
      assert.strictEqual(r.changed, false, 'holding from the end of the sung whole note keeps the measure');
    });

    it('T027J chord onsets are respected; partial measures accept only an exact grid', () => {
      const twoChords = BOUNDARY.replace(`| G | ${Q4} |`, `| G/2 D/2 | ${Q4} |`);
      const r = ok(twoChords, {
        plans: [],
        transitions: [{ afterSectionIndex: 0, candidates: [{ intent: 'hold', targetMeasureOffset: -1, pattern: { source: 'hold' } }, { intent: 'space', targetMeasureOffset: -1, pattern: { source: 'grid', gridUnit: 'quarter', attacks: [0, 2] } }] }]
      });
      // Holding from beat 3 would be legal here (D starts on beat 3); holding covers no chord change.
      assert.strictEqual(r.transitionResults?.[0].applied, true);
      const early = ok(twoChords, {
        plans: [],
        transitions: [{ afterSectionIndex: 0, candidates: [{ intent: 'space', targetMeasureOffset: -1, pattern: { source: 'grid', gridUnit: 'quarter', attacks: [0] } }] }]
      });
      assert.strictEqual(early.transitionResults?.[0].applied, false);
      assert.match(early.transitionResults?.[0].rationale ?? '', /transitionConflictsWithChordChange/);
    });

    it('T027J without exact timing fills and lifts are never adopted', () => {
      const text = ['[A]', `| C | ${Q4} l:"la" |`, '[B]', `| G | ${Q4} |`].join('\n');
      const r = ok(text, { plans: [], transitions: [{ afterSectionIndex: 0, candidates: [fillGrid([0, 2, 4, 5, 6, 7]), { intent: 'hold', targetMeasureOffset: -1, pattern: { source: 'hold' } }] }] });
      assert.strictEqual(r.transitionResults?.[0].candidateIndex, 1);
      assert.deepStrictEqual(r.warnings, [{ code: 'vocalTimingUnknown', sectionIndex: 0 }]);
      assert.deepStrictEqual(rhythmsOf(r.text)[0], '1.d');
    });

    it('the final section takes an ending, not a transition', () => {
      const r = planAccompanimentTransform(BOUNDARY, { plans: [], transitions: [{ afterSectionIndex: 1, candidates: [fillGrid([0])] }] });
      assert.deepStrictEqual(r, { ok: false, code: 'invalidInput', detail: 'the final section takes an ending, not a transition' });
    });
  });

  describe('endings (§11B)', () => {
    const song = (mel: string, lastMeasure = `| C | ${Q4} |]`) =>
      ['[Outro]', `| G | ${Q4} |`, 'mel: | g4/1 |', 'lyr: la', lastMeasure, `mel: | ${mel} |`, 'lyr: la'].join('\n');
    const end = (...candidates: EndingCandidate[]): AccompanimentRequest => ({ plans: [], ending: { candidates } });
    const grid = (relativeMeasure: -1 | -2, gridUnit: 'quarter' | 'eighth', attacks: number[]) => ({ relativeMeasure, pattern: { source: 'grid' as const, gridUnit, attacks } });

    it('T027L exact ending context from mel: + lyr:', () => {
      const a = analyzeAccompaniment(song('c4/4 r/4 r/2'), {});
      assert.ok(a.ok);
      if (!a.ok) return;
      assert.deepStrictEqual(a.endingContext?.vocalEnding, {
        lastSungOnset: 0,
        lastSungEnd: 1,
        trailingSpaceBeats: 3,
        continuesByTie: false,
        continuesByHyphen: false,
        continuesByMelisma: false,
        confidence: 'exact'
      });
      assert.deepStrictEqual([a.endingContext?.finalChordOnsets, a.endingContext?.hasFinalBarline, a.endingContext?.finalMeasureBeats], [[0], true, 4]);
    });

    it('T027N a vocal sustained to the end forbids fills; hold is chosen', () => {
      const r = ok(song('c4/1'), end({ kind: 'fillToHold', measures: [grid(-1, 'eighth', [0, 2, 3, 4, 5, 6])] }, { kind: 'hold', measures: [{ relativeMeasure: -1, pattern: { source: 'hold' } }] }));
      assert.deepStrictEqual([r.endingResult?.applied, r.endingResult?.kind], [true, 'hold']);
      assert.match(r.endingResult?.rationale ?? '', /candidate #2/);
    });

    it('T027N with trailing space a fill is allowed only after the vocal', () => {
      const r = ok(song('c4/4 r/4 r/2'), end({ kind: 'fillToHold', measures: [grid(-1, 'eighth', [0, 2, 3, 4, 5, 6])] }));
      assert.strictEqual(r.endingResult?.kind, 'fillToHold');
      assert.deepStrictEqual(rhythmsOf(r.text)[1], '4.d 8.d 8.u 8.d 8.u 4.d');
      const underVocal = ok(song('c4/2 r/2'), end({ kind: 'fillToHold', measures: [grid(-1, 'eighth', [0, 1, 2, 3, 4, 5, 6])] }));
      assert.strictEqual(underVocal.endingResult?.applied, false);
      assert.strictEqual(underVocal.changed, false);
    });

    it('T027N a tie / hyphen continuation forbids fills', () => {
      const text = song('c4/2~ c4/4 r/4');
      // The tie ends inside the song, so its end (beat 4) is the last sung end: one beat is left for a fill.
      const r = ok(text, end({ kind: 'fillToHold', measures: [grid(-1, 'eighth', [0, 2, 4, 6, 7])] }));
      assert.strictEqual(r.endingResult?.applied, true, JSON.stringify(r.endingResult));
      assert.deepStrictEqual(rhythmsOf(r.text)[1], '4.d 4.d 4.d 8.d 8.u');
      assert.strictEqual(ok(text, end({ kind: 'fillToHold', measures: [grid(-1, 'eighth', [0, 2, 4, 5, 6, 7])] })).endingResult?.applied, false);
      const hyphen = ['[Outro]', `| C | ${Q4} |]`, 'mel: | c4/4 d4/4 r/2 |', 'lyr: sun- shine'].join('\n');
      assert.strictEqual(ok(hyphen, end({ kind: 'breakThenHit', measures: [grid(-1, 'quarter', [0, 3])] })).endingResult?.applied, false);
    });

    it('T027O / T027P finalHit, breakThenHit, rolledFinal and fermata keep meter, chords and the final barline', () => {
      const finalHit = ok(song('c4/4 r/4 r/2'), end({ kind: 'finalHit', measures: [grid(-1, 'quarter', [0])], fermataFinal: true }));
      assert.deepStrictEqual([finalHit.endingResult?.kind, finalHit.endingResult?.usedFermata, rhythmsOf(finalHit.text)[1]], ['finalHit', true, '1.d.fermata']);
      assert.ok(finalHit.text.trimEnd().includes('|]'));
      const rolled = ok(song('c4/1'), end({ kind: 'rolledFinal', measures: [{ relativeMeasure: -1, pattern: { source: 'preset', presetId: 'roll_4_4_whole' } }] }));
      assert.deepStrictEqual(rhythmsOf(rolled.text)[1], '1.arp');
      // Final chord on beat 3 with trailing space: a break right before the hit.
      const twoChords = song('c4/4 r/4 r/2', `| F/2 C/2 | ${Q4} |]`);
      const bth = ok(twoChords, end({ kind: 'breakThenHit', measures: [grid(-1, 'quarter', [0, 1, 2])] }));
      assert.strictEqual(bth.endingResult?.applied, false, 'the slot before the hit is struck, so there is no room for a break');
      assert.deepStrictEqual(rhythmsOf(ok(twoChords, end({ kind: 'breakThenHit', measures: [grid(-1, 'quarter', [0, 2])] })).text)[1], '4.d r4 2.d');
      const bth2 = ok(twoChords, end({ kind: 'breakThenHit', measures: [grid(-1, 'eighth', [0, 4])] }));
      assert.deepStrictEqual(rhythmsOf(bth2.text)[1], '4+8.d r8 2.d');
      // A hit that misses the final chord onset is rejected.
      const missed = ok(twoChords, end({ kind: 'finalHit', measures: [grid(-1, 'quarter', [0])] }));
      assert.strictEqual(missed.endingResult?.applied, false);
      assert.match(missed.endingResult?.rationale ?? '', /endingConflictsWithChordChange/);
    });

    it('T027P a downbeat hit takes its break at the end of the -2 measure', () => {
      const text = ['[Outro]', `| G | ${Q4} |`, 'mel: | g4/2 r/2 |', 'lyr: la', `| C | ${Q4} |]`].join('\n');
      const r = ok(text, end({ kind: 'breakThenHit', measures: [grid(-2, 'eighth', [0, 2, 4]), grid(-1, 'quarter', [0])] }));
      assert.strictEqual(r.endingResult?.kind, 'breakThenHit');
      assert.deepStrictEqual(rhythmsOf(r.text), ['4.d 4.d 4+8.d r8', '1.d']);
    });

    it('T027M / T027R unknown vocal timing allows only conservative endings', () => {
      const text = ['[Outro]', `| C | ${Q4} l:"la" |]`].join('\n');
      const r = ok(text, end({ kind: 'fillToHold', measures: [grid(-1, 'eighth', [0, 2, 3, 4, 5, 6])] }, { kind: 'finalHit', measures: [grid(-1, 'quarter', [0])] }));
      assert.deepStrictEqual([r.endingResult?.kind, r.warnings], ['finalHit', [{ code: 'vocalTimingUnknown', sectionIndex: 0 }]]);
    });

    it('T027K / T027Q precedence: base -> phrase variation -> ending; only the window changes; no @tempo', () => {
      const text = ['[Outro]', ...Array.from({ length: 4 }, () => `| C | ${Q4} |`), `| C | ${Q4} |]`].join('\n');
      const r = ok(text, {
        plans: [{ sectionIndex: 0, mode: 'preset', presetId: 'rock_4_4_eighth_full', phraseLength: 2 }],
        ending: { candidates: [{ kind: 'finalHit', measures: [grid(-1, 'quarter', [0])] }] }
      });
      const full = '8.d 8.u 8.d 8.u 8.d 8.u 8.d 8.u';
      const push = '8.d 8.u 8.d 4.u 8.u 8.d 8.u';
      assert.deepStrictEqual(rhythmsOf(r.text), [full, push, full, push, '1.d']);
      assert.strictEqual(r.endingResult?.windowMeasures, 1);
      assert.ok(!r.text.includes('@tempo'));
    });
  });
});
