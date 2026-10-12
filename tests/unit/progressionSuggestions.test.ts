import * as assert from 'assert';
import { parseGuitarDsl } from '../../src/compiler';
import { resolveProgressionTargetKey, suggestNextChords, suggestProgressions } from '../../src/progressionSuggestions';

describe('progression suggestions', () => {
  it('uses a pending @key for an authored empty target cell and only falls back at a true append', () => {
    const score = parseGuitarDsl('key: C\n| C | Dm | Em | F |\n@key: D\n|   |');
    assert.strictEqual(score.measures.length, 4, 'the parser does not invent a measure for the empty source cell');
    assert.strictEqual(resolveProgressionTargetKey(score, 4, true), 'D', 'an authored target cell uses the pending key event');
    assert.strictEqual(resolveProgressionTargetKey(score, 4, false), 'C', 'a true append falls back to the previous measure context');
  });

  it('returns five deterministic next-chord candidates and scores both opening rules', () => {
    const score = parseGuitarDsl('key: C\n| C | Am |');
    const first = suggestNextChords(score, { startMeasure: 2, previousChord: 'C' });
    const second = suggestNextChords(score, { startMeasure: 2, previousChord: 'C' });
    assert.ok(first.ok);
    assert.ok(second.ok);
    if (!first.ok || !second.ok) return;
    assert.strictEqual(first.candidates.length, 5);
    assert.deepStrictEqual(first.candidates.map(item => item.chords), second.candidates.map(item => item.chords));
    const tonic = first.candidates.find(item => item.chords[0] === 'C');
    assert.ok(tonic);
    assert.strictEqual(tonic.score.followsPreviousRoot, 4);
    assert.strictEqual(tonic.score.identicalOpeningChord, -1);
  });

  it('uses fixed four-bar patterns and repeats each pattern for eight and sixteen bars', () => {
    const score = parseGuitarDsl('key: C\n| C | Am |');
    const four = suggestProgressions(score, { startMeasure: 2, previousChord: 'Am' }, 4);
    const eight = suggestProgressions(score, { startMeasure: 2, previousChord: 'Am' }, 8);
    const sixteen = suggestProgressions(score, { startMeasure: 2, previousChord: 'Am' }, 16);
    assert.ok(four.ok && eight.ok && sixteen.ok);
    if (!four.ok || !eight.ok || !sixteen.ok) return;
    assert.strictEqual(four.candidates.length, 5);
    const eightMatch = eight.candidates.find(item => item.chords.slice(0, 4).join(',') === four.candidates[0].chords.join(','));
    const sixteenMatch = sixteen.candidates.find(item => item.chords.slice(0, 4).join(',') === four.candidates[0].chords.join(','));
    assert.ok(eightMatch);
    assert.ok(sixteenMatch);
    assert.deepStrictEqual(eightMatch.chords, [...four.candidates[0].chords, ...four.candidates[0].chords]);
    assert.deepStrictEqual(sixteenMatch.chords, Array.from({ length: 4 }, () => four.candidates[0].chords).flat());
  });

  it('writes sounding-key proposals as capo-adjusted authored shapes', () => {
    const score = parseGuitarDsl('capo: 2\nkey: D\n| C | Am |');
    const result = suggestProgressions(score, { startMeasure: 2, previousChord: 'Am' }, 4);
    assert.ok(result.ok);
    if (!result.ok) return;
    const tonicPattern = result.candidates.find(item => item.romanNumerals[0] === 'I' && item.romanNumerals.join('') === 'IVviIV');
    assert.ok(tonicPattern);
    if (tonicPattern) assert.deepStrictEqual(tonicPattern.chords, ['C', 'G', 'Am', 'F']);
  });

  it('scores a capo-adjusted authored tonic against the sounding tonic', () => {
    const score = parseGuitarDsl('capo: 2\nkey: D\n| C | Am |');
    const result = suggestProgressions(score, { startMeasure: 2, previousChord: 'Am' }, 4);
    assert.ok(result.ok);
    if (!result.ok) return;
    const endingOnWrittenC = result.candidates.find(item => item.chords[item.chords.length - 1] === 'C');
    assert.ok(endingOnWrittenC, 'a candidate ends on the C shape that sounds as D with capo 2');
    if (endingOnWrittenC) assert.strictEqual(endingOnWrittenC.score.tonicEnding, 2);
  });

  it('uses the mid-score @key at the target start', () => {
    const midScore = suggestNextChords(
      parseGuitarDsl('key: C\n| C |\n@key: Am\n| Am | F | G | C |'),
      { startMeasure: 1 }
    );
    assert.ok(midScore.ok);
    if (!midScore.ok) return;
    assert.ok(midScore.candidates.every(item => item.key === 'Am' && item.mode === 'minor'));
    assert.ok(midScore.candidates.some(item => item.romanNumerals[0] === 'i'));
  });

  it('rejects any internal @key event even when its key text repeats, and allows a range starting there', () => {
    const source = 'key: C\n| C |\n| F |\n@key: C\n| G |\n| Am |\n| F |\n| C |';
    const score = parseGuitarDsl(source);
    const crossing = suggestProgressions(score, { startMeasure: 0 }, 4);
    assert.ok(!crossing.ok && crossing.code === 'keyBoundary');

    const startsAtEvent = suggestProgressions(score, { startMeasure: 2 }, 4);
    assert.ok(startsAtEvent.ok, startsAtEvent.ok ? '' : startsAtEvent.code);
  });

  it('uses duration-weighted melody chord tones to change progression ranking', () => {
    const withoutMelody = suggestProgressions(parseGuitarDsl('key: C\n| C | Am | G | F |'), { startMeasure: 0 }, 4);
    const withMelody = suggestProgressions(parseGuitarDsl(
      'key: C\n| C | Am | G | F |\nmel: | c4/1 | e4/1 | a4/1 | d4/1 |'
    ), { startMeasure: 0 }, 4);
    assert.ok(withoutMelody.ok && withMelody.ok);
    if (!withoutMelody.ok || !withMelody.ok) return;
    assert.strictEqual(withoutMelody.candidates[0].id, 'major-5-4-0', 'tonic ending wins without melody');
    assert.strictEqual(withMelody.candidates[0].id, 'major-2-4-0', 'melody chord tones change ranking');
    assert.strictEqual(withMelody.candidates[0].score.melody, 32);
    assert.ok(withMelody.candidates[0].melodyEvaluated);
  });

  it('uses minor mode and rejects invalid key, capo, source errors, and a key boundary', () => {
    const minor = suggestProgressions(parseGuitarDsl('key: Am\n| Am | F |'), { startMeasure: 2 }, 4);
    assert.ok(minor.ok);
    if (minor.ok) assert.deepStrictEqual(minor.candidates[0].chords, ['Am', 'Dm', 'E', 'Am']);

    const invalidKey = suggestNextChords(parseGuitarDsl('key: H\n| C |'), { startMeasure: 1 });
    assert.ok(!invalidKey.ok && invalidKey.code === 'invalidKey');
    const missingKey = suggestNextChords(parseGuitarDsl('| C |'), { startMeasure: 1 });
    assert.ok(!missingKey.ok && missingKey.code === 'keyNotDeclared', 'an absent key never silently defaults to C major');
    const invalidCapo = suggestNextChords(parseGuitarDsl('capo: 13\nkey: C\n| C |'), { startMeasure: 1 });
    assert.ok(!invalidCapo.ok && invalidCapo.code === 'invalidCapo');
    const sourceErrors = suggestNextChords(parseGuitarDsl('key: C\n| C bogus |'), { startMeasure: 1 });
    assert.ok(!sourceErrors.ok && sourceErrors.code === 'sourceHasErrors');

    const boundaryScore = parseGuitarDsl('key: C\n| C |\n@key: D\n| D |');
    const boundary = suggestProgressions(boundaryScore, { startMeasure: 0 }, 4);
    assert.ok(!boundary.ok && boundary.code === 'keyBoundary');
  });

  it('rejects ambiguous thirdless harmony in the target range', () => {
    const result = suggestProgressions(parseGuitarDsl('key: C\n| Csus4 | Am | G | F |'), { startMeasure: 0 }, 4);
    assert.ok(!result.ok && result.code === 'ambiguousHarmony');
    if (!result.ok) assert.strictEqual(result.detail, 'Csus4');
  });
});
