import * as assert from 'assert';
import { analyzeHarmony } from '../../src/harmonicAnalysis';
import { parseGuitarDsl } from '../../src/compiler';

function scoreWithChordName(name: string) {
  const score = parseGuitarDsl('key: C\n| C/E |');
  score.measures[0].chords[0].name = name;
  score.measures[0].chord = name;
  return score;
}

describe('analyzeHarmony', () => {
  it('assigns diatonic Roman numerals and Nashville numbers in a major key', () => {
    const result = analyzeHarmony(parseGuitarDsl([
      'key: C', '| C |', '| Dm |', '| Em |', '| F |', '| G7 |', '| Am |'
    ].join('\n')));

    assert.deepStrictEqual(result.chords.map(chord => [
      chord.status, chord.kind, chord.roman, chord.nashville?.degree,
      chord.nashville?.accidental, chord.nashville?.suffix
    ]), [
      ['recognized', 'diatonic', 'I', 1, 0, ''],
      ['recognized', 'diatonic', 'ii', 2, 0, 'm'],
      ['recognized', 'diatonic', 'iii', 3, 0, 'm'],
      ['recognized', 'diatonic', 'IV', 4, 0, ''],
      ['recognized', 'diatonic', 'V7', 5, 0, '7'],
      ['recognized', 'diatonic', 'vi', 6, 0, 'm']
    ]);
  });

  it('uses the minor tonic as Nashville 1 and distinguishes natural and harmonic minor fits', () => {
    const result = analyzeHarmony(parseGuitarDsl([
      'key: Am', '| Am |', '| G#dim |', '| E7 |'
    ].join('\n')));

    assert.deepStrictEqual(result.chords.map(chord => [
      chord.roman, chord.nashville?.degree, chord.nashville?.accidental,
      chord.kind, chord.minorScaleFit
    ]), [
      ['i', 1, 0, 'diatonic', 'both'],
      ['vii°', 7, 0, 'diatonic', 'harmonic'],
      ['V7', 5, 0, 'diatonic', 'harmonic']
    ]);
  });

  it('identifies a secondary dominant and records its target degree', () => {
    const result = analyzeHarmony(parseGuitarDsl('key: C\n| D7 |'));
    const chord = result.chords[0];

    assert.strictEqual(chord.status, 'recognized');
    assert.strictEqual(chord.kind, 'secondaryDominant');
    assert.strictEqual(chord.roman, 'V7/V');
    assert.deepStrictEqual(chord.secondaryTarget, {
      degree: 5, accidental: 0, soundingRootPc: 7, scale: 'major'
    });
  });

  it('limits secondary-dominant inference to major, 7 and 9 qualities', () => {
    const results = ['D', 'D7', 'D9'].map(name => analyzeHarmony(scoreWithChordName(name)).chords[0]);
    assert.deepStrictEqual(results.map(chord => chord.kind), [
      'secondaryDominant', 'secondaryDominant', 'secondaryDominant'
    ]);
    assert.deepStrictEqual(results.map(chord => chord.roman), ['V/V', 'V7/V', 'V9/V']);

    const primary = analyzeHarmony(parseGuitarDsl('key: C\n| G7 |')).chords[0];
    assert.strictEqual(primary.kind, 'diatonic');
  });

  it('classifies chords from the parallel natural minor as borrowed in a major key', () => {
    const result = analyzeHarmony(parseGuitarDsl('key: C\n| Fm |\n| Ab |'));
    assert.deepStrictEqual(result.chords.map(chord => [chord.kind, chord.status]), [
      ['borrowed', 'recognized'], ['borrowed', 'recognized']
    ]);
  });

  it('uses each measure context key after a key change', () => {
    const result = analyzeHarmony(parseGuitarDsl('key: C\n| C |\n@key: G\n| D |\n| G |'));
    assert.deepStrictEqual(result.chords.map(chord => [chord.key, chord.roman, chord.nashville?.degree]), [
      ['C', 'I', 1], ['G', 'V', 5], ['G', 'I', 1]
    ]);
  });

  it('transposes written roots and slash basses by capo while retaining their spelling', () => {
    const score = parseGuitarDsl('key: D\ncapo: 2\n| C/E |');
    const chord = analyzeHarmony(score).chords[0];

    assert.strictEqual(chord.writtenName, 'C/E');
    assert.strictEqual(chord.soundingRootPc, 2);
    assert.strictEqual(chord.roman, 'I');
    assert.deepStrictEqual(chord.slashBass, {
      written: 'E', writtenPc: 4, soundingPc: 6, intervalFromRoot: 4, isChordTone: true
    });
  });

  it('preserves Nashville data for ambiguous thirdless chords without assigning Roman case', () => {
    const result = analyzeHarmony(parseGuitarDsl('key: C\n| Csus4 |'));
    const chord = result.chords[0];

    assert.strictEqual(chord.status, 'ambiguous');
    assert.strictEqual(chord.kind, undefined);
    assert.strictEqual(chord.roman, undefined);
    assert.deepStrictEqual(chord.nashville, { degree: 1, accidental: 0, suffix: 'sus4' });
  });

  it('marks every contracted thirdless quality as ambiguous', () => {
    const results = ['Csus2', 'Csus4', 'C7sus4', 'C5'].map(name =>
      analyzeHarmony(scoreWithChordName(name)).chords[0]
    );
    assert.ok(results.every(chord => chord.status === 'ambiguous'));
    assert.ok(results.every(chord => chord.roman === undefined));
    assert.ok(results.every(chord => chord.nashville !== undefined));
  });

  it('returns unknown with unsupportedQuality for valid syntax outside CHORD_QUALITIES', () => {
    const result = analyzeHarmony(scoreWithChordName('C13'));
    const chord = result.chords[0];

    assert.strictEqual(chord.status, 'unknown');
    assert.strictEqual(chord.reason, 'unsupportedQuality');
    assert.strictEqual(chord.roman, undefined);
    assert.deepStrictEqual(chord.nashville, { degree: 1, accidental: 0, suffix: '13' });
    assert.deepStrictEqual(result.diagnostics, [{
      code: 'unsupportedQuality', value: '13', measureIndex: 0, chordIndex: 0
    }]);
  });

  it('returns unknown for invalid chord syntax without aborting other chords', () => {
    const score = parseGuitarDsl('key: C\n| C |\n| Dm |');
    score.measures[0].chords[0].name = 'H7';
    score.measures[0].chord = 'H7';
    const result = analyzeHarmony(score);

    assert.deepStrictEqual(result.chords.map(chord => [chord.status, chord.reason]), [
      ['unknown', 'invalidChord'], ['recognized', undefined]
    ]);
  });

  it('returns diagnostics for invalid capo and key instead of throwing', () => {
    const invalidCapo = parseGuitarDsl('key: C\n| C/E |');
    invalidCapo.capo = '13';
    const capoResult = analyzeHarmony(invalidCapo);
    assert.strictEqual(capoResult.chords[0].status, 'unknown');
    assert.strictEqual(capoResult.chords[0].reason, 'invalidCapo');
    assert.strictEqual(capoResult.chords[0].soundingRootPc, null);
    assert.strictEqual(capoResult.chords[0].slashBass?.soundingPc, null);
    assert.deepStrictEqual(capoResult.diagnostics, [{ code: 'invalidCapo', value: '13' }]);

    const invalidKey = parseGuitarDsl('key: C\n| C/E |');
    invalidKey.measures[0].context.key = 'H';
    const keyResult = analyzeHarmony(invalidKey);
    assert.strictEqual(keyResult.chords[0].status, 'unknown');
    assert.strictEqual(keyResult.chords[0].reason, 'invalidKey');
    assert.strictEqual(keyResult.chords[0].soundingRootPc, 0);
    assert.strictEqual(keyResult.chords[0].slashBass?.isChordTone, true);
    assert.deepStrictEqual(keyResult.diagnostics, [{ code: 'invalidKey', value: 'H', measureIndex: 0 }]);
  });

  it('uses the compiler repeat expansion for percent measures in written order', () => {
    const score = parseGuitarDsl('key: C\n| C |\n| % |');
    assert.strictEqual(score.measures[1].isMeasureRepeat, true);
    const result = analyzeHarmony(score);

    assert.deepStrictEqual(result.chords.map(chord => [chord.measureIndex, chord.chordIndex, chord.writtenName]), [
      [0, 0, 'C'], [1, 0, 'C']
    ]);
  });

  it('detects only authentic, plagal, deceptive and terminal half cadences', () => {
    const cadenceKind = (dsl: string) => analyzeHarmony(parseGuitarDsl(`key: C\n${dsl}`)).cadences.map(c => c.kind);
    assert.deepStrictEqual(cadenceKind('| Dm |\n| G7 |\n| C |'), ['authentic']);
    assert.deepStrictEqual(cadenceKind('| F |\n| C |'), ['plagal']);
    assert.deepStrictEqual(cadenceKind('| C |\n| G |'), ['half']);
    assert.deepStrictEqual(cadenceKind('| G |\n| Am |'), ['deceptive']);
  });

  it('checks a section boundary but does not call an interior V a half cadence', () => {
    const boundaryScore = parseGuitarDsl('key: C\n| Dm |\n| G |\n| C |');
    boundaryScore.measures[0].sectionName = 'Verse';
    boundaryScore.measures[2].sectionName = 'Chorus';
    const boundaryResult = analyzeHarmony(boundaryScore);
    assert.deepStrictEqual(boundaryResult.cadences.map(cadence => [cadence.kind, cadence.sectionName]), [
      ['half', 'Verse']
    ]);

    const interiorResult = analyzeHarmony(parseGuitarDsl('key: C\n| Dm |\n| G |\n| C |\n| F |'));
    assert.deepStrictEqual(interiorResult.cadences, []);
  });

  it('skips cadence candidates whose terminal recognized chords use different keys', () => {
    const result = analyzeHarmony(parseGuitarDsl('key: C\n| G |\n@key: G\n| D |'));
    assert.deepStrictEqual(result.cadences, []);
  });

  it('returns empty chord and cadence arrays for an empty score', () => {
    const result = analyzeHarmony(parseGuitarDsl(''));
    assert.deepStrictEqual(result.chords, []);
    assert.deepStrictEqual(result.cadences, []);
  });

  it('is deterministic and does not mutate the parsed score', () => {
    const score = parseGuitarDsl('key: C\ncapo: 2\n| C/E |\n| % |');
    const before = structuredClone(score);
    const first = analyzeHarmony(score);
    const second = analyzeHarmony(score);

    assert.deepStrictEqual(first, second);
    assert.deepStrictEqual(score, before);
  });
});
