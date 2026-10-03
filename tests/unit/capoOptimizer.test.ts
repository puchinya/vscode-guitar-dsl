import * as assert from 'assert';
import { applyCapo, chooseCapo, scoreChord, transposeChordName } from '../../src/transcription/capoOptimizer';
import { TranscribedSong } from '../../src/transcription/model';

function songWithChords(key: string, names: string[]): TranscribedSong {
  return {
    key,
    bpm: 120,
    timeSignature: { numerator: 4, denominator: 4 },
    sections: [{
      name: 'Verse',
      measures: names.map(name => ({ chords: [{ name, duration: '1' }], rhythm: [{ duration: '1', direction: 'd' as const }] }))
    }]
  };
}

describe('transcription - capo optimizer', () => {
  it('transposes root and slash bass, preserving the quality suffix', () => {
    assert.strictEqual(transposeChordName('Bbmaj7', -3), 'Gmaj7');
    assert.strictEqual(transposeChordName('D/F#', -2), 'C/E');
    assert.strictEqual(transposeChordName('Ebm7/Bb', -3), 'Cm7/G');
    assert.strictEqual(transposeChordName('C', -1), 'B');
    assert.strictEqual(transposeChordName('C', 0), 'C');
    assert.strictEqual(transposeChordName('H7', -1), null);
  });

  it('scores open shapes lower than barre shapes and unknown chords highest', () => {
    assert.strictEqual(scoreChord('G'), 0);
    assert.strictEqual(scoreChord('F'), 3);
    assert.strictEqual(scoreChord('Xyz'), 10);
  });

  it('scores a slash chord without its own voicing by its upper chord', () => {
    assert.strictEqual(scoreChord('A/C#'), scoreChord('A'));
    assert.strictEqual(scoreChord('G/B'), 0);
  });

  it('uses a manual capo exactly', () => {
    const song = songWithChords('Bb', ['Bb', 'Eb', 'F', 'Gm']);
    assert.strictEqual(chooseCapo(song, 5), 5);
    assert.strictEqual(chooseCapo(song, 0), 0);
    assert.strictEqual(chooseCapo(song, 12), 12);
  });

  it('auto capo chooses the easier open-shape progression', () => {
    // Capo 3 turns Bb Eb F Gm into G C D Em (all open shapes).
    const song = songWithChords('Bb', ['Bb', 'Eb', 'F', 'Gm']);
    assert.strictEqual(chooseCapo(song), 3);
  });

  it('keeps the sounding key while emitting play-form chords', () => {
    const song = songWithChords('Bb', ['Bb', 'Eb', 'F/A', 'Gm']);
    const played = applyCapo(song, 3);
    assert.strictEqual(played.key, 'Bb');
    assert.strictEqual(played.capo, 3);
    assert.deepStrictEqual(played.sections[0].measures.map(m => m.chords[0].name), ['G', 'C', 'D/F#', 'Em']);
    // the input is not mutated
    assert.strictEqual(song.sections[0].measures[0].chords[0].name, 'Bb');
  });

  it('prefers the lower capo on an exact score tie', () => {
    // C at capo 0 scores 1; its capo-4 play form Ab scores 0 + 0.25 * 4 = 1; everything else is 10.
    const song = songWithChords('C', ['C']);
    const scorer = (name: string) => (name === 'C' ? 1 : name === 'Ab' ? 0 : 10);
    assert.strictEqual(chooseCapo(song, undefined, scorer), 0);
  });

  it('omits capo when the capo is 0', () => {
    const played = applyCapo({ ...songWithChords('G', ['G']), capo: 2 }, 0);
    assert.strictEqual(played.capo, undefined);
  });
});
