import * as assert from 'assert';
import {
  AccompanimentPlan,
  AccompanimentPlanResult,
  AccompanimentRequest,
  IntentPlan,
  accompanimentRequestProblem,
  accompanimentSections,
  analyzeAccompaniment,
  planAccompanimentTransform
} from '../../src/accompaniment';
import { parseGuitarDsl } from '../../src/compiler';
import { currentPatternShortcuts, formatRhythms } from '../../src/accompaniment';
import { getPresetById } from '../../src/strummingPatterns';
import { StrummingCodeLensProvider } from '../../src/strummingCodeLens';
import * as fs from 'fs';
import * as path from 'path';

type Ok = Extract<AccompanimentPlanResult, { ok: true }>;

const intent = (sectionIndex: number, patch: Partial<IntentPlan> = {}): IntentPlan => ({
  sectionIndex,
  mode: 'intent',
  style: 'strum',
  subdivision: 'auto',
  energy: 'medium',
  density: 'medium',
  syncopation: 'none',
  emphasis: 'none',
  operation: 'replace',
  ...patch
});

function run(text: string, request: AccompanimentRequest | AccompanimentPlan[], options?: { phraseVariation?: boolean }): AccompanimentPlanResult {
  return planAccompanimentTransform(text, Array.isArray(request) ? { plans: request } : request, options);
}

function ok(text: string, request: AccompanimentRequest | AccompanimentPlan[], options?: { phraseVariation?: boolean }): Ok {
  const r = run(text, request, options);
  assert.ok(r.ok, JSON.stringify(r));
  return r as Ok;
}

function failCode(text: string, request: AccompanimentRequest | AccompanimentPlan[]): string {
  const r = run(text, request);
  assert.ok(!r.ok, 'expected a failure');
  return (r as { code: string }).code;
}

/** Rhythm token strings of every measure after the edit. */
const rhythmsOf = (text: string) => parseGuitarDsl(text).measures.map(m => formatRhythms(m.rhythms));

const SONG = [
  'title: Song',
  '',
  '[Verse]',
  '| C | 4.d 4.d 4.d 4.d | G | 4.d 4.d 4.d 4.d |',
  '| Am | 4.d 4.d 4.d 4.d | F | 4.d 4.d 4.d 4.d |',
  '# keep this comment',
  '[Chorus]',
  '| F | 4.d 4.d 4.d 4.d | G | 4.d 4.d 4.d 4.d |',
  '| C | 4.d 4.d 4.d 4.d | C | 4.d 4.d 4.d 4.d |]'
].join('\n');

describe('accompaniment engine (Issue #101)', () => {
  describe('sections', () => {
    it('T027H sections are 0-based in source order; a leading unnamed section is 0; repeated names are separate', () => {
      const text = ['| C | 4.d 4.d 4.d 4.d |', '[Chorus]', '| F |', '[Verse]', '| G |', '[Chorus]', '| C |'].join('\n');
      const sections = accompanimentSections(parseGuitarDsl(text), text);
      assert.deepStrictEqual(sections.map(s => [s.sectionIndex, s.name, s.labelLine, s.measures.length]), [
        [0, null, null, 1],
        [1, 'Chorus', 1, 1],
        [2, 'Verse', 3, 1],
        [3, 'Chorus', 5, 1]
      ]);
    });
  });

  describe('CodeLens section indexes', () => {
    it('the cheap CodeLens line scan yields exactly the engine section indexes and names', () => {
      const docOf = (text: string) => {
        const lines = text.split(/\r?\n/);
        return { lineCount: lines.length, lineAt: (i: number) => ({ text: lines[i] }), uri: 'doc' } as never;
      };
      const samples = path.join(__dirname, '../../samples');
      const texts = fs.readdirSync(samples).filter(f => f.endsWith('.guitardsl')).map(f => fs.readFileSync(path.join(samples, f), 'utf8'));
      texts.push(['| C |', '[A]', '[B]', '| G |', 'mel: | c4/1 |', '   | d4/1 |', '[C]', '| F |', '# c', '[A]', '| C | % |'].join('\n'));
      for (const text of texts) {
        const want = accompanimentSections(parseGuitarDsl(text), text).filter(s => s.labelLine !== null).map(s => [s.labelLine, s.sectionIndex, s.name]);
        const got = new StrummingCodeLensProvider('en').provideCodeLenses(docOf(text)).map(l => {
          // The unit vscode mock keeps Range(line, ...) as a plain number.
          const start = l.range.start as unknown as number | { line: number };
          return [typeof start === 'number' ? start : start.line, l.command?.arguments?.[1], l.command?.arguments?.[2]];
        });
        assert.deepStrictEqual(got, want);
      }
    });
  });

  describe('input validation', () => {
    it('rejects malformed plans before reading the score', () => {
      assert.match(accompanimentRequestProblem({ plans: [{ sectionIndex: -1, mode: 'preset', presetId: 'x' }] }) ?? '', /sectionIndex/);
      assert.match(accompanimentRequestProblem({ plans: [{ sectionIndex: 0, mode: 'preset', presetId: 'rock_4_4_eighth_full', operation: 'adapt' }] }) ?? '', /only in intent mode/);
      assert.match(accompanimentRequestProblem({ plans: [{ sectionIndex: 0, mode: 'grid', style: 'strum', gridUnit: 'eighth', attacks: [2, 1] }] }) ?? '', /ascending/);
      assert.match(accompanimentRequestProblem({ plans: [intent(0, { operation: undefined as never })] }) ?? '', /operation/);
      assert.match(
        accompanimentRequestProblem({ plans: [], transitions: [{ afterSectionIndex: 0, candidates: [{ intent: 'fill', targetMeasureOffset: -1, pattern: { source: 'dsl', pattern: '8.d' } }] }] }) ?? '',
        /raw down\/up/
      );
      assert.match(accompanimentRequestProblem({ plans: [], ending: { candidates: [1, 2, 3, 4] } }) ?? '', /1 to 3/);
      assert.strictEqual(failCode(SONG, [intent(0), intent(0)]), 'duplicateSectionPlan');
      assert.strictEqual(failCode(SONG, [intent(9)]), 'sectionNotFound');
    });
  });

  describe('intent selection (§8)', () => {
    it('T020 hard filters, fixed weights and deterministic ties choose the same preset every time', () => {
      const a = ok(SONG, [intent(0, { energy: 'high', density: 'dense', emphasis: 'backbeat' })]);
      const b = ok(SONG, [intent(0, { energy: 'high', density: 'dense', emphasis: 'backbeat' })]);
      assert.strictEqual(a.appliedSections[0].selectedPresetId, 'rock_4_4_eighth_backbeat');
      assert.strictEqual(a.text, b.text);
      // Ties go to catalog order: medium / medium / none / none is matched first by pop_4_4_eighth_orthodox.
      assert.strictEqual(ok(SONG, [intent(0)]).appliedSections[0].selectedPresetId, 'pop_4_4_eighth_orthodox');
      // subdivision / family / style are hard filters.
      assert.strictEqual(ok(SONG, [intent(0, { subdivision: 'sixteenth', energy: 'high', density: 'dense' })]).appliedSections[0].selectedPresetId, 'popfunk_4_4_sixteenth_full');
      assert.strictEqual(ok(SONG, [intent(0, { family: 'shuffle' })]).appliedSections[0].selectedPresetId, 'blues_4_4_shuffle_basic');
      assert.strictEqual(ok(SONG, [intent(0, { style: 'arpeggio', energy: 'low', density: 'sparse' })]).appliedSections[0].selectedPresetId, 'arp_4_4_quarter');
    });

    it('T020 preferredPresetId gets the -20 bonus only when it passes the hard filters', () => {
      assert.strictEqual(ok(SONG, [intent(0, { preferredPresetId: 'folk_4_4_eighth_classic' })]).appliedSections[0].selectedPresetId, 'folk_4_4_eighth_classic');
      // A 3/4 preferred preset cannot be used in 4/4.
      assert.strictEqual(ok(SONG, [intent(0, { preferredPresetId: 'waltz_3_4_eighth_flow' })]).appliedSections[0].selectedPresetId, 'pop_4_4_eighth_orthodox');
    });

    it('T007 intent never auto-selects an authored all-down preset', () => {
      const r = ok(SONG, [intent(0, { energy: 'high', density: 'dense', family: 'eighth' })]);
      assert.notStrictEqual(r.appliedSections[0].selectedPresetId, 'rock_4_4_eighth_all_down');
      for (let seed = 0; seed < 3; seed++) {
        for (const sub of ['eighth', 'sixteenth', 'triplet'] as const) {
          const res = run(SONG, [intent(0, { energy: 'high', density: 'dense', subdivision: sub })]);
          if (res.ok) assert.ok(!res.appliedSections[0].selectedPresetId?.endsWith('_all_down'));
        }
      }
    });

    it('T027D difficulty is a hard ceiling independent of energy / density', () => {
      // No beginner sixteenth exists -> the section fails rather than picking an advanced one.
      const res = run(SONG, [intent(0, { energy: 'high', density: 'dense', subdivision: 'sixteenth', difficulty: 'beginner' })]);
      assert.ok(!res.ok);
      const beginner = ok(SONG, [intent(0, { energy: 'high', density: 'dense', difficulty: 'beginner' })]);
      const id = beginner.appliedSections[0].selectedPresetId as string;
      assert.ok(['strum_4_4_quarter_basic', 'pop_4_4_eighth_orthodox', 'pop_4_4_eighth_halfbar', 'folk_4_4_eighth_classic', 'strum_4_4_quarter_backbeat'].includes(id), id);
      const intermediate = ok(SONG, [intent(0, { energy: 'high', density: 'dense', subdivision: 'sixteenth', difficulty: 'intermediate' })]);
      assert.notStrictEqual(intermediate.appliedSections[0].selectedPresetId, 'popfunk_4_4_sixteenth_full');
    });

    it('T027G the rationale is compact: matched traits and at most 3 rejected candidates', () => {
      const r = ok(SONG, [intent(0, { energy: 'high', density: 'dense', subdivision: 'sixteenth', difficulty: 'intermediate' })]);
      const rationale = r.appliedSections[0].selectionRationale;
      assert.ok(rationale.matchedTraits.includes('4/4'));
      assert.ok(rationale.matchedTraits.includes('chord changes articulated'));
      assert.ok((rationale.rejectedCandidates ?? []).length <= 3);
      assert.ok((rationale.rejectedCandidates ?? []).some(c => c.reason === 'difficulty'));
      assert.ok(!JSON.stringify(r).includes('"cost"'));
    });
  });

  describe('chord-interval articulation (D3)', () => {
    const TWO_CHORDS = '| C 4.d 4.d G 4.d 4.d |';
    const HALF = '| C/2 G/2 | 4.d 4.d 4.d 4.d |';

    it('T027B a chord interval without a harmonic attack is rejected in preset / grid / dsl modes alike', () => {
      // jpop_4_4_eighth_old_faithful strikes 2.5 inside [2, 4): legal under D3.
      ok(HALF, [{ sectionIndex: 0, mode: 'preset', presetId: 'jpop_4_4_eighth_old_faithful' }]);
      // A whole-note sustain leaves G (beat 2) without an attack.
      assert.strictEqual(failCode(HALF, [{ sectionIndex: 0, mode: 'preset', presetId: 'sustain_4_4_whole' }]), 'patternMissesChordChange');
      assert.strictEqual(failCode(HALF, [{ sectionIndex: 0, mode: 'grid', style: 'strum', gridUnit: 'quarter', attacks: [0, 1] }]), 'patternMissesChordChange');
      assert.strictEqual(failCode(HALF, [{ sectionIndex: 0, mode: 'dsl', style: 'strum', pattern: '4.d 4+2.d' }]), 'patternMissesChordChange');
      ok(HALF, [{ sectionIndex: 0, mode: 'grid', style: 'strum', gridUnit: 'quarter', attacks: [0, 2] }]);
      // Interleaved chords are not replaceable (their span holds chords).
      assert.strictEqual(failCode(TWO_CHORDS, [{ sectionIndex: 0, mode: 'preset', presetId: 'rock_4_4_eighth_full' }]), 'editRejected');
    });

    it('D3 ghosts are not harmonic attacks; reggae offbeat strokes are legal after a rest', () => {
      ok(HALF, [{ sectionIndex: 0, mode: 'preset', presetId: 'reggae_4_4_skank' }]);
      ok(HALF, [{ sectionIndex: 0, mode: 'preset', presetId: 'reggae_4_4_sixteenth_scratch' }]);
      // Only ghosts in [2, 4) -> G is never presented.
      assert.strictEqual(
        failCode(HALF, [{ sectionIndex: 0, mode: 'grid', style: 'strum', gridUnit: 'eighth', attacks: [0, 4, 6], ghosts: [4, 6] }]),
        'patternMissesChordChange'
      );
    });

    it('D3 soft preference: onsetPreferred presets that delay a chord onset cost more than those that do not', () => {
      // Chord change on beat 2 (offset 1): old faithful strikes offset 1 (onset kept) while the push variant is also fine;
      // the halfbar pattern strikes offset 1 too. Prefer presets that strike the onset.
      const text = '| C/1 G/3 | 4.d 4.d 4.d 4.d |';
      const r = ok(text, [intent(0, { energy: 'high', density: 'dense' })]);
      assert.strictEqual(r.appliedSections[0].selectedPresetId, 'rock_4_4_eighth_full');
    });
  });

  describe('grid mode (§7.3, §9.2)', () => {
    it('the engine decides D/U with the coarsest pendulum and the durations', () => {
      const r = ok('| C |', [{ sectionIndex: 0, mode: 'grid', style: 'strum', gridUnit: 'sixteenth', attacks: [0, 2, 6, 8, 10, 14] }]);
      // All attacks are on eighth positions -> eighth pendulum; 0.5 + 1 + 0.5 + ... durations.
      assert.deepStrictEqual(rhythmsOf(r.text), ['8.d 4.u 8.u 8.d 4.u 8.u']);
    });

    it('beat-crossing offbeat attacks get composite durations (8+16, 4+8)', () => {
      const r = ok('| C |', [{ sectionIndex: 0, mode: 'grid', style: 'strum', gridUnit: 'sixteenth', attacks: [0, 2, 3, 6, 7, 8, 10, 11, 14, 15] }]);
      assert.deepStrictEqual(rhythmsOf(r.text), ['8.d 16.d 8+16.u 16.d 16.u 8.d 16.d 8+16.u 16.d 16.u']);
      const q = ok('| C |', [{ sectionIndex: 0, mode: 'grid', style: 'strum', gridUnit: 'eighth', attacks: [0, 2, 3, 6] }]);
      assert.deepStrictEqual(rhythmsOf(q.text), ['4.d 8.d 4+8.u 4.d']);
    });

    it('slot counts follow the meter; triplet grids reset per beat; arpeggio grids carry no direction', () => {
      assert.strictEqual(failCode('| C |', [{ sectionIndex: 0, mode: 'grid', style: 'strum', gridUnit: 'eighth', attacks: [8] }]), 'invalidGridAttack');
      const six = ok('time: 6/8\n| C |', [{ sectionIndex: 0, mode: 'grid', style: 'strum', gridUnit: 'eighth', attacks: [0, 1, 2, 3, 4, 5] }]);
      assert.deepStrictEqual(rhythmsOf(six.text), ['8.d 8.u 8.d 8.d 8.u 8.d']);
      const trip = ok('| C |', [{ sectionIndex: 0, mode: 'grid', style: 'strum', gridUnit: 'tripletEighth', attacks: [0, 2, 3, 5, 6, 8, 9, 11] }]);
      assert.deepStrictEqual(rhythmsOf(trip.text), ['4t.d 8t.u 4t.d 8t.u 4t.d 8t.u 4t.d 8t.u']);
      const arp = ok('| C |', [{ sectionIndex: 0, mode: 'grid', style: 'arpeggio', gridUnit: 'eighth', attacks: [0, 1, 2, 3, 4, 5, 6, 7], accents: [0] }]);
      assert.deepStrictEqual(rhythmsOf(arp.text), ['8.a 8 8 8 8 8 8 8']);
      assert.strictEqual(failCode('time: 6/8\n| C |', [{ sectionIndex: 0, mode: 'grid', style: 'strum', gridUnit: 'quarter', attacks: [0] }]), 'invalidGridAttack');
      assert.strictEqual(failCode('| C |', [{ sectionIndex: 0, mode: 'grid', style: 'strum', gridUnit: 'eighth', attacks: [0, 1], ghosts: [3] }]), 'invalidGridAttack');
    });

    it('T007 grids never produce all-downs', () => {
      const r = ok('| C |', [{ sectionIndex: 0, mode: 'grid', style: 'strum', gridUnit: 'eighth', attacks: [0, 1, 2, 3, 4, 5, 6, 7] }]);
      assert.deepStrictEqual(rhythmsOf(r.text), ['8.d 8.u 8.d 8.u 8.d 8.u 8.d 8.u']);
    });
  });

  describe('dsl mode (§7.4)', () => {
    it('T018 physical: wrong phases are rejected, mixed durations are judged by metric onset', () => {
      assert.strictEqual(failCode('| C |', [{ sectionIndex: 0, mode: 'dsl', style: 'strum', pattern: '8.d 8.d 8.u 8.u 8.d 8.u 8.d 8.u' }]), 'unnaturalStrokeDirection');
      ok('| C |', [{ sectionIndex: 0, mode: 'dsl', style: 'strum', pattern: '4.d 8.d 4.u 8.u 8.d 8.u' }]);
      assert.strictEqual(failCode('| C |', [{ sectionIndex: 0, mode: 'dsl', style: 'strum', pattern: '4.d 4.d 4.d' }]), 'rhythmBeatCountMismatch');
      assert.strictEqual(failCode('| C |', [{ sectionIndex: 0, mode: 'dsl', style: 'strum', pattern: '4.d 4.d zz 4.d' }]), 'invalidRhythmPattern');
      assert.strictEqual(failCode('| C |', [{ sectionIndex: 0, mode: 'dsl', style: 'arpeggio', pattern: '8.d 8 8 8 8 8 8 8' }]), 'invalidRhythmPattern');
    });

    it('T019 literal keeps user-specified directions after meter validation', () => {
      const r = ok('| C |', [{ sectionIndex: 0, mode: 'dsl', style: 'strum', pattern: '8.d 8.d 8.u 8.u 8.d 8.d 8.u 8.u', directionPolicy: 'literal' }]);
      assert.deepStrictEqual(rhythmsOf(r.text), ['8.d 8.d 8.u 8.u 8.d 8.d 8.u 8.u']);
      assert.strictEqual(failCode('| C |', [{ sectionIndex: 0, mode: 'dsl', style: 'strum', pattern: '8.d 8.d', directionPolicy: 'literal' }]), 'rhythmBeatCountMismatch');
    });

    it('a tie across the barline is unsupported cross-bar syncopation', () => {
      assert.strictEqual(failCode('| C | G |', [{ sectionIndex: 0, mode: 'dsl', style: 'strum', pattern: '4.d 4.d 4.d 4.u.t' }]), 'unsupportedCrossBarSyncopation');
    });
  });

  describe('source-preserving transform (§5.2 – §5.4)', () => {
    it('T021 different intents per section; everything outside the target is byte-identical', () => {
      const r = ok(SONG, [intent(0, { energy: 'low', density: 'sparse', style: 'sustain' }), intent(1, { energy: 'high', density: 'dense' })], { phraseVariation: false });
      const before = SONG.split('\n');
      const after = r.text.split('\n');
      assert.strictEqual(after.length, before.length);
      for (const i of [0, 1, 2, 5, 6]) assert.strictEqual(after[i], before[i]);
      assert.deepStrictEqual(rhythmsOf(r.text), ['1.d', '1.d', '1.d', '1.d', '8.d 8.u 8.d 8.u 8.d 8.u 8.d 8.u', '8.d 8.u 8.d 8.u 8.d 8.u 8.d 8.u', '8.d 8.u 8.d 8.u 8.d 8.u 8.d 8.u', '8.d 8.u 8.d 8.u 8.d 8.u 8.d 8.u']);
      const onlyVerse = ok(SONG, [{ sectionIndex: 0, mode: 'preset', presetId: 'arp_4_4_eighth' }], { phraseVariation: false });
      assert.deepStrictEqual(onlyVerse.text.split('\n').slice(5), before.slice(5));
    });

    it('T022 several measures on one line are edited individually; chords, lyrics, repeats, brackets and comments stay', () => {
      const text = [
        '|: C | 4.d 4.d 4.d 4.d l:"one" | [1.] G 4 4 4 4 :| [2.] Am 2.d 2.d l:"two" ||',
        '# comment'
      ].join('\n');
      const r = ok(text, [{ sectionIndex: 0, mode: 'preset', presetId: 'rock_4_4_eighth_full' }], { phraseVariation: false });
      assert.strictEqual(
        r.text,
        [
          '|: C | 8.d 8.u 8.d 8.u 8.d 8.u 8.d 8.u l:"one" | [1.] G 8.d 8.u 8.d 8.u 8.d 8.u 8.d 8.u :| [2.] Am 8.d 8.u 8.d 8.u 8.d 8.u 8.d 8.u l:"two" ||',
          '# comment'
        ].join('\n')
      );
      const before = parseGuitarDsl(text).measures;
      const after = parseGuitarDsl(r.text).measures;
      assert.deepStrictEqual(after.map(m => [m.chords, m.lyric, m.bracket, m.repeatStart, m.repeatEnd, m.doubleEnd]), before.map(m => [m.chords, m.lyric, m.bracket, m.repeatStart, m.repeatEnd, m.doubleEnd]));
    });

    it('T023 implicit rhythm: the pattern is inserted after the chord; CRLF sources keep their line endings', () => {
      const r = ok('| C | G l:"la" |\r\n| Am |', [{ sectionIndex: 0, mode: 'preset', presetId: 'pop_4_4_eighth_orthodox' }], { phraseVariation: false });
      assert.strictEqual(r.text, '| C 4.d 8.d 8.u 8.d 8.u 8.d 8.u | G 4.d 8.d 8.u 8.d 8.u 8.d 8.u l:"la" |\r\n| Am 4.d 8.d 8.u 8.d 8.u 8.d 8.u |');
      assert.deepStrictEqual(parseGuitarDsl(r.text).diagnostics, []);
    });

    it('T024 a % measure that inherits the same pattern is kept; a change of meaning fails before editing', () => {
      const text = ['[A]', '| C | 4.d 4.d 4.d 4.d |', '| % |', '[B]', '| % |'].join('\n');
      assert.strictEqual(failCode(text, [{ sectionIndex: 0, mode: 'preset', presetId: 'rock_4_4_eighth_full' }]), 'repeatWouldChangeMeaning');
      const both = ok(text, [
        { sectionIndex: 0, mode: 'preset', presetId: 'rock_4_4_eighth_full' },
        { sectionIndex: 1, mode: 'preset', presetId: 'rock_4_4_eighth_full' }
      ], { phraseVariation: false });
      assert.strictEqual(both.text, ['[A]', '| C | 8.d 8.u 8.d 8.u 8.d 8.u 8.d 8.u |', '| % |', '[B]', '| % |'].join('\n'));
      // Section B alone would need its % to differ from A.
      assert.strictEqual(failCode(text, [{ sectionIndex: 1, mode: 'preset', presetId: 'arp_4_4_eighth' }]), 'repeatWouldChangeMeaning');
    });

    it('T025 an inline pitched measure in the target fails the whole request without edits', () => {
      const text = ['[A]', '| C | c4/8 e4/8 g4/8 c5/8 4.d 4.d |', '[B]', '| G | 4.d 4.d 4.d 4.d |'].join('\n');
      assert.strictEqual(failCode(text, [{ sectionIndex: 1, mode: 'preset', presetId: 'rock_4_4_eighth_full' }, { sectionIndex: 0, mode: 'preset', presetId: 'rock_4_4_eighth_full' }]), 'measureContainsInlinePitch');
      // mel: lines are independent and stay untouched.
      const withMelody = ['| C | 4.d 4.d 4.d 4.d |', 'mel: | c4/2 e4/2 |', 'lyr: la la'].join('\n');
      const r = ok(withMelody, [{ sectionIndex: 0, mode: 'preset', presetId: 'arp_4_4_eighth' }], { phraseVariation: false });
      assert.deepStrictEqual(r.text.split('\n').slice(1), withMelody.split('\n').slice(1));
    });

    it('T026 mixed meters in one section fail; no truncation', () => {
      const text = ['| C | 4.d 4.d 4.d 4.d |', '@time: 3/4', '| G | 4.d 4.d 4.d |'].join('\n');
      assert.strictEqual(failCode(text, [intent(0)]), 'mixedMeterSection');
      assert.strictEqual(failCode(text, [{ sectionIndex: 0, mode: 'preset', presetId: 'rock_4_4_eighth_full' }]), 'mixedMeterSection');
    });

    it('T009 a 3/4 section never receives a 4/4 preset', () => {
      const text = 'time: 3/4\n| C | 4.d 4.d 4.d |';
      assert.strictEqual(failCode(text, [{ sectionIndex: 0, mode: 'preset', presetId: 'rock_4_4_eighth_full' }]), 'invalidPresetForContext');
      const r = ok(text, [intent(0, { energy: 'high', density: 'dense' })]);
      assert.strictEqual(r.appliedSections[0].selectedPresetId, 'waltz_3_4_eighth_full');
    });

    it('T027R pickups and final complements are preserved with a warning; full presets are never cropped', () => {
      const text = ['pickup: 4', '| C | 4.d |', '| G | 4.d 4.d 4.d 4.d |'].join('\n');
      const r = ok(text, [{ sectionIndex: 0, mode: 'preset', presetId: 'rock_4_4_eighth_full' }], { phraseVariation: false });
      assert.deepStrictEqual(rhythmsOf(r.text), ['4.d', '8.d 8.u 8.d 8.u 8.d 8.u 8.d 8.u']);
      assert.deepStrictEqual(r.warnings, [{ code: 'partialMeasurePreserved', sectionIndex: 0, measureNumber: 1 }]);
    });

    it('T027S feel compatibility must hold for every effective feel; grid / dsl never edit feel directives', () => {
      const straight = '| C | 4.d 4.d 4.d 4.d |';
      assert.strictEqual(failCode(straight, [{ sectionIndex: 0, mode: 'preset', presetId: 'swing_4_4_sixteenth_halftime' }]), 'invalidPresetForContext');
      ok('feel: swing\n' + straight, [{ sectionIndex: 0, mode: 'preset', presetId: 'swing_4_4_sixteenth_halftime' }]);
      const mixed = ['feel: swing', '| C | 4.d 4.d 4.d 4.d |', '@feel: straight', '| G | 4.d 4.d 4.d 4.d |'].join('\n');
      assert.strictEqual(failCode(mixed, [{ sectionIndex: 0, mode: 'preset', presetId: 'swing_4_4_sixteenth_halftime' }]), 'mixedFeelSection');
      assert.strictEqual(failCode(mixed, [intent(0, { family: 'swing', subdivision: 'sixteenth', density: 'dense' })]), 'mixedFeelSection');
      const g = ok(mixed, [{ sectionIndex: 0, mode: 'grid', style: 'strum', gridUnit: 'eighth', attacks: [0, 2, 4, 6] }]);
      assert.ok(g.text.includes('feel: swing') && g.text.includes('@feel: straight'));
      assert.strictEqual(g.appliedSections[0].scoreFeel, 'mixed');
    });

    it('unchanged plans report changed: false and leave the text as is', () => {
      const text = '| C | 8.d 8.u 8.d 8.u 8.d 8.u 8.d 8.u |';
      const r = ok(text, [{ sectionIndex: 0, mode: 'preset', presetId: 'rock_4_4_eighth_full' }]);
      assert.strictEqual(r.changed, false);
      assert.strictEqual(r.text, text);
    });
  });

  describe('arrangement (§5A)', () => {
    const EIGHT = ['[Verse]', ...Array.from({ length: 8 }, () => '| C | 4.d 4.d 4.d 4.d |'), '[Chorus]', '| F | 4.d 4.d 4.d 4.d |'].join('\n');

    it('T027C phrase ends take canonical variations only; phrase middles keep the base; no randomness', () => {
      const r = ok(EIGHT, [{ sectionIndex: 0, mode: 'preset', presetId: 'rock_4_4_eighth_full', phraseLength: 4 }]);
      const rows = rhythmsOf(r.text).slice(0, 8);
      const full = '8.d 8.u 8.d 8.u 8.d 8.u 8.d 8.u';
      const push = '8.d 8.u 8.d 4.u 8.u 8.d 8.u';
      assert.deepStrictEqual(rows, [full, full, full, push, full, full, full, push]);
      assert.deepStrictEqual(r.appliedSections[0].variationPresetsUsed, ['rock_4_4_eighth_push']);
      assert.strictEqual(ok(EIGHT, [{ sectionIndex: 0, mode: 'preset', presetId: 'rock_4_4_eighth_full', phraseLength: 4 }]).text, r.text);
      // No relation -> base everywhere.
      const folk = ok(EIGHT, [{ sectionIndex: 0, mode: 'preset', presetId: 'folk_4_4_eighth_classic' }]);
      assert.deepStrictEqual(folk.appliedSections[0].variationPresetsUsed, []);
      // The manual path applies exactly.
      assert.deepStrictEqual(rhythmsOf(ok(EIGHT, [{ sectionIndex: 0, mode: 'preset', presetId: 'rock_4_4_eighth_full', phraseLength: 4 }], { phraseVariation: false }).text).slice(0, 8), Array(8).fill(full));
    });

    it('T027C the last measure lifts into a louder next section and breaks down into a quieter one', () => {
      const lift = ok(EIGHT, [intent(0, { energy: 'high', density: 'dense', family: 'eighth' }), intent(1, { energy: 'high', density: 'dense', family: 'eighth' })]);
      assert.strictEqual(lift.appliedSections[0].selectedPresetId, 'rock_4_4_eighth_full');
      const down = ok(EIGHT, [intent(0, { energy: 'high', density: 'dense', family: 'eighth' }), intent(1, { energy: 'low', density: 'sparse', style: 'sustain' })]);
      assert.strictEqual(rhythmsOf(down.text)[7], '8.d.pm 8.u.pm 8.d.pm 8.u.pm 8.d.pm 8.u.pm 8.d.pm 8.u.pm');
      const up = ok(EIGHT, [intent(0, { energy: 'medium', density: 'medium' }), intent(1, { energy: 'high', density: 'dense' })]);
      assert.strictEqual(up.appliedSections[0].selectedPresetId, 'pop_4_4_eighth_orthodox');
      assert.strictEqual(rhythmsOf(up.text)[7], '4.d 8.d 4.u 8.u 8.d 8.u');
    });

    it('T027E arrangement groups keep the family; finale lifts within it; an explicit style change wins', () => {
      const text = ['[Chorus]', '| C |', '[Verse]', '| G |', '[Chorus]', '| C |', '[Chorus]', '| C |'].join('\n');
      const r = ok(text, [
        intent(0, { energy: 'medium', density: 'medium', arrangementGroup: 'chorus', arrangementRole: 'base' }),
        intent(2, { energy: 'medium', density: 'medium', emphasis: 'backbeat', arrangementGroup: 'chorus', arrangementRole: 'base' }),
        intent(3, { energy: 'high', density: 'dense', arrangementGroup: 'chorus', arrangementRole: 'finale' })
      ], { phraseVariation: false });
      const ids = r.appliedSections.map(s => s.selectedPresetId);
      const families = ids.map(id => id?.split('_')[3]);
      assert.deepStrictEqual(families, ['eighth', 'eighth', 'eighth']);
      assert.strictEqual(ids[2], 'rock_4_4_eighth_full');
      assert.strictEqual(failCode(text, [
        { sectionIndex: 0, mode: 'preset', presetId: 'pop_4_4_eighth_orthodox', arrangementGroup: 'chorus' },
        { sectionIndex: 2, mode: 'preset', presetId: 'arp_4_4_eighth', arrangementGroup: 'chorus', arrangementRole: 'variation' }
      ]), 'invalidVariationRelationship');
      const override = ok(text, [
        { sectionIndex: 0, mode: 'preset', presetId: 'pop_4_4_eighth_orthodox', arrangementGroup: 'chorus' },
        intent(2, { style: 'arpeggio', arrangementGroup: 'chorus', arrangementRole: 'variation' })
      ]);
      assert.strictEqual(override.appliedSections[1].selectedPresetId, 'arp_4_4_eighth');
    });

    it('T027E a repeated base of the same group keeps the family; explicit style / family override; preset violation fails', () => {
      const text = ['[Chorus]', '| C |', '[Verse]', '| G |', '[Chorus]', '| C |'].join('\n');
      const loud = { energy: 'high' as const, density: 'medium' as const, syncopation: 'strong' as const, syncopationKinds: ['anticipation' as const] };
      // Alone, these parameters pick a sixteenth preset.
      assert.strictEqual(ok(text, [intent(2, loud)], { phraseVariation: false }).appliedSections[0].selectedPresetId, 'jpop_4_4_sixteenth_anticipation');
      const grouped = ok(text, [intent(0, { arrangementGroup: 'chorus', arrangementRole: 'base' }), intent(2, { ...loud, arrangementGroup: 'chorus', arrangementRole: 'base' })], { phraseVariation: false });
      const [first, second] = grouped.appliedSections.map(s => getPresetById(s.selectedPresetId as string)!);
      assert.strictEqual(first.id, 'pop_4_4_eighth_orthodox');
      assert.deepStrictEqual([second.family, second.style, second.subdivision], [first.family, first.style, first.subdivision], second.id);
      const noRole = ok(text, [intent(0, { arrangementGroup: 'chorus' }), intent(2, { ...loud, arrangementGroup: 'chorus' })], { phraseVariation: false });
      assert.strictEqual(getPresetById(noRole.appliedSections[1].selectedPresetId as string)!.family, 'eighth');
      const family = ok(text, [intent(0, { arrangementGroup: 'chorus' }), intent(2, { ...loud, family: 'sixteenth', arrangementGroup: 'chorus' })], { phraseVariation: false });
      assert.strictEqual(family.appliedSections[1].selectedPresetId, 'jpop_4_4_sixteenth_anticipation', 'an explicit family releases the constraint');
      const style = ok(text, [intent(0, { arrangementGroup: 'chorus' }), intent(2, { style: 'arpeggio', arrangementGroup: 'chorus', arrangementRole: 'base' })], { phraseVariation: false });
      assert.strictEqual(getPresetById(style.appliedSections[1].selectedPresetId as string)!.style, 'arpeggio');
      assert.strictEqual(
        failCode(text, [
          { sectionIndex: 0, mode: 'preset', presetId: 'pop_4_4_eighth_orthodox', arrangementGroup: 'chorus', arrangementRole: 'base' },
          { sectionIndex: 2, mode: 'preset', presetId: 'popfunk_4_4_sixteenth_full', arrangementGroup: 'chorus', arrangementRole: 'base' }
        ]),
        'invalidVariationRelationship'
      );
    });

    it('C-review presets sharing a pattern resolve by score feel only; otherwise no current preset is guessed', () => {
      const shared = '4t.d 8t.u 4t.d 8t.u 4t.d 8t.u 4t.d 8t.u';
      const swing = analyzeAccompaniment(`feel: swing\n| C | ${shared} |\n| G | ${shared} |`, {});
      const plain = analyzeAccompaniment(`| C | ${shared} |\n| G | ${shared} |`, {});
      assert.ok(swing.ok && plain.ok);
      if (!swing.ok || !plain.ok) return;
      assert.deepStrictEqual(swing.sections[0].currentPresetMatches, ['blues_4_4_shuffle_basic', 'swing_4_4_comping']);
      assert.deepStrictEqual(plain.sections[0].currentPresetMatches, ['blues_4_4_shuffle_basic', 'swing_4_4_comping']);
      // With feel: swing the current preset is the swing one: adapt stays in the swing family (no triplet swing
      // alternative exists, so it reports that instead of drifting to the shuffle family).
      assert.ok(swing.sections[0].adaptationCandidates.every(id => getPresetById(id)!.family === 'swing'));
      const swingAdapt = run(`feel: swing\n| C | ${shared} |`, [intent(0, { operation: 'adapt', energy: 'high', emphasis: 'backbeat' })]);
      assert.ok(!swingAdapt.ok && /no swing preset/.test(swingAdapt.detail ?? ''), JSON.stringify(swingAdapt));
      // Straight feel cannot tell them apart: no shortcut / adaptation candidates.
      assert.deepStrictEqual(plain.sections[0].adaptationCandidates, []);
      const section = accompanimentSections(parseGuitarDsl(`| C | ${shared} |`), `| C | ${shared} |`)[0];
      assert.deepStrictEqual(currentPatternShortcuts(section, section.measures), []);
      assert.strictEqual(failCode(`| C | ${shared} |`, [intent(0, { operation: 'adapt', energy: 'high' })]), 'noCompatibleAdaptation');
      // feel: shuffle resolves to the shuffle preset, so adapt stays in the shuffle family.
      const shuffled = ok(`feel: shuffle\n| C | ${shared} |`, [intent(0, { operation: 'adapt', energy: 'high', emphasis: 'backbeat' })], { phraseVariation: false });
      assert.strictEqual(getPresetById(shuffled.appliedSections[0].selectedPresetId as string)!.family, 'shuffle');
    });

    it('T027F adapt keeps the current family, moves toward the request and never replaces silently', () => {
      const eighths = ['| C | 4.d 8.d 8.u 8.d 8.u 8.d 8.u |', '| G | 4.d 8.d 8.u 8.d 8.u 8.d 8.u |'].join('\n');
      const r = ok(eighths, [intent(0, { operation: 'adapt', energy: 'high', density: 'dense' })], { phraseVariation: false });
      assert.strictEqual(r.appliedSections[0].operation, 'adapt');
      const id = r.appliedSections[0].selectedPresetId as string;
      assert.ok(id.includes('_eighth_'), id);
      assert.notStrictEqual(id, 'pop_4_4_eighth_orthodox');
      // Nothing moves closer (the current preset already matches) -> noCompatibleAdaptation.
      assert.strictEqual(failCode(eighths, [intent(0, { operation: 'adapt' })]), 'noCompatibleAdaptation');
      // A family change is not an adaptation.
      assert.strictEqual(failCode(eighths, [intent(0, { operation: 'adapt', family: 'sixteenth' })]), 'noCompatibleAdaptation');
      assert.strictEqual(failCode(eighths, [intent(0, { operation: 'adapt', style: 'arpeggio' })]), 'noCompatibleAdaptation');
    });
  });

  describe('analysis (§6.1, §14)', () => {
    it('T027A structure query lists families; section + family lists only that family; no catalog dump or recommendation', () => {
      const all = analyzeAccompaniment(SONG, {});
      assert.ok(all.ok);
      if (!all.ok) return;
      assert.deepStrictEqual(all.sections.map(s => [s.sectionIndex, s.name, s.meters, s.feels]), [[0, 'Verse', ['4/4'], ['straight']], [1, 'Chorus', ['4/4'], ['straight']]]);
      assert.deepStrictEqual(all.sections[0].currentPresetMatches, ['strum_4_4_quarter_basic']);
      assert.ok(all.sections[0].adaptationCandidates.length <= 5);
      assert.ok(all.sections[0].availableFamilies.includes('shuffle'));
      assert.strictEqual(all.selectedSection, undefined);
      assert.ok(!JSON.stringify(all).includes('recommended'));
      assert.ok(!JSON.stringify(all).includes('"pattern"'));
      const fam = analyzeAccompaniment(SONG, { sectionIndex: 1, family: 'sixteenth' });
      assert.ok(fam.ok);
      if (!fam.ok) return;
      const presets = fam.selectedSection?.availablePresets ?? [];
      assert.ok(presets.length > 0 && presets.every(p => p.family === 'sixteenth'));
      assert.ok(presets.length < 58);
      assert.ok(!JSON.stringify(fam).includes('16.d 16.u'), 'no full patterns');
      const waltz = analyzeAccompaniment('time: 3/4\n| C |', { sectionIndex: 0, family: 'eighth' });
      assert.ok(waltz.ok && waltz.selectedSection?.availablePresets?.every(p => p.id.includes('_3_4_')));
      assert.deepStrictEqual(analyzeAccompaniment(SONG, { sectionIndex: 5 }), { ok: false, code: 'sectionNotFound', detail: 'sectionIndex 5 (0-based) does not exist; the score has 2 section(s)' });
    });
  });
});
