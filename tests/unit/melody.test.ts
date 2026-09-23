import * as assert from 'assert';
import { DiagnosticCode, parseGuitarDsl, parseKeySignature } from '../../src/compiler';
import { tokenizeLyrics } from '../../src/melody';

function codes(dsl: string): DiagnosticCode[] {
  return parseGuitarDsl(dsl).diagnostics.map(d => d.code);
}

describe('compiler - melody (mel:)', () => {
  it('parses notes with inherited octave and length', () => {
    const score = parseGuitarDsl([
      '| C | 4.d 4.d 4.d 4.d |',
      'mel: | e4/8 f# g a bb4/4. r/8 |'
    ].join('\n'));
    const mel = score.measures[0].melody!;
    assert.strictEqual(mel.length, 6);
    assert.deepStrictEqual(mel.map(n => n.pitch && `${n.pitch.step}${n.pitch.alter}${n.pitch.octave}`), ['e04', 'f14', 'g04', 'a04', 'b-14', undefined]);
    assert.deepStrictEqual(mel.map(n => n.beats.n / n.beats.d), [0.5, 0.5, 0.5, 0.5, 1.5, 0.5]);
    assert.strictEqual(mel[5].isRest, true);
    assert.deepStrictEqual(score.diagnostics, []);
  });

  it('accepts beat counts after ":" in quarter-beat steps', () => {
    const score = parseGuitarDsl(['| C | % |', 'mel: | c5:2.5 d:1.5 |'].join('\n'));
    assert.deepStrictEqual(score.measures[0].melody!.map(n => n.parts.map(p => p.base)), [[2, 8], [4]]);
    assert.deepStrictEqual(codes(['| C | % |', 'mel: | c5:0.3 d:3.7 |'].join('\n')), ['invalidLength', 'invalidLength']);
  });

  it('assigns cells to measures both per line and in blocks', () => {
    const perLine = parseGuitarDsl([
      '| C | % |', 'mel: | c5/1 |',
      '| G | % |', 'mel: | d5/1 |'
    ].join('\n'));
    assert.deepStrictEqual(perLine.measures.map(m => m.melody![0].pitch!.step), ['c', 'd']);

    const block = parseGuitarDsl([
      '| C | % |', '| G | % |', '| F | % |',
      'mel: | c5/1 | d5/1 |'
    ].join('\n'));
    assert.deepStrictEqual(block.measures.map(m => m.melody?.[0].pitch!.step), ['c', 'd', undefined]);
  });

  it('does not assign across section headers or page breaks', () => {
    const score = parseGuitarDsl([
      '[A]', '| C | % |',
      '[B]', '| G | % |',
      'mel: | d5/1 |'
    ].join('\n'));
    assert.strictEqual(score.measures[0].melody, undefined);
    assert.strictEqual(score.measures[1].melody![0].pitch!.step, 'd');

    assert.deepStrictEqual(codes(['| C | % |', '---', 'mel: | c5/1 |'].join('\n')), ['tooManyMelodyMeasures']);
  });

  it('reports too many cells with the cell position', () => {
    const score = parseGuitarDsl(['| C | % |', 'mel: | c5/1 | d5/1 |'].join('\n'));
    assert.strictEqual(score.diagnostics.length, 1);
    const d = score.diagnostics[0];
    assert.strictEqual(d.code, 'tooManyMelodyMeasures');
    assert.strictEqual(d.severity, 'error');
    assert.strictEqual(d.line, 1);
    assert.strictEqual('mel: | c5/1 | d5/1 |'.slice(d.startCol, d.endCol), 'd5/1');
  });

  it('copies the previous melody with %', () => {
    const score = parseGuitarDsl(['| C | % |', '| G | % |', 'mel: | c5/2 d | % |'].join('\n'));
    assert.deepStrictEqual(score.measures[1].melody!.map(n => n.pitch!.step), ['c', 'd']);
    assert.notStrictEqual(score.measures[1].melody![0], score.measures[0].melody![0]);
    assert.deepStrictEqual(codes(['| C | % |', 'mel: | % |'].join('\n')), ['melodyRepeatWithoutPrevious']);
  });

  it('reports note errors with token ranges', () => {
    const line = 'mel: | E4/4 c4/3 x4/4 d c/4 |';
    const score = parseGuitarDsl(['| C | % |', line].join('\n'));
    const found = score.diagnostics.map(d => [d.code, line.slice(d.startCol, d.endCol)]);
    assert.deepStrictEqual(found.slice(0, 3), [
      ['upperCaseNoteName', 'E4/4'],
      ['invalidLength', 'c4/3'],
      ['invalidMelodyNote', 'x4/4']
    ]);
    // The first valid note "d" lacks octave and length -> error; beat count check then warns.
    assert.strictEqual(found[3][0], 'missingInitialOctaveOrLength');
  });

  it('warns when the melody of a measure is not 4 beats', () => {
    const score = parseGuitarDsl(['| C | % |', 'mel: | c5/2 d/4 |'].join('\n'));
    assert.deepStrictEqual(score.diagnostics.map(d => [d.code, d.severity, d.args?.beats]), [['beatCountMismatch', 'warning', '3']]);
    assert.deepStrictEqual(codes(['| C | % |', 'mel: | c5/8t d e f/4 g/2 |'].join('\n')), []);
  });

  it('warns about l:"..." in a measure that has a melody', () => {
    assert.deepStrictEqual(codes(['| C | 1.d l:"あ" |', 'mel: | c5/1 |'].join('\n')), ['measureLyricWithMelody']);
  });

  it('marks tie continuations', () => {
    const score = parseGuitarDsl(['| C | % |', '| G | % |', 'mel: | g4/2~ g/4 r | c5/1 |'].join('\n'));
    const mel = score.measures[0].melody!;
    assert.strictEqual(mel[0].tieToNext, true);
    assert.strictEqual(mel[1].tiedFromPrev, true);
    assert.strictEqual(score.measures[1].melody![0].tiedFromPrev, false);
  });
});

describe('compiler - syllable lyrics (lyr:)', () => {
  it('splits Japanese per character, joining small kana and keeping っ / ー', () => {
    const texts = tokenizeLyrics('しゃぼんだま きょう がっこー').map(i => (i.kind === 'syllable' ? i.text : i.kind));
    assert.deepStrictEqual(texts, ['しゃ', 'ぼ', 'ん', 'だ', 'ま', 'きょ', 'う', 'が', 'っ', 'こ', 'ー']);
  });

  it('handles groups, melisma, skip, English hyphens and bars', () => {
    const items = tokenizeLyrics('(ひか)り _ * | sun- shine');
    assert.deepStrictEqual(items, [
      { kind: 'syllable', text: 'ひか', hyphenToNext: false },
      { kind: 'syllable', text: 'り', hyphenToNext: false },
      { kind: 'extend' },
      { kind: 'skip' },
      { kind: 'bar' },
      { kind: 'syllable', text: 'sun', hyphenToNext: true },
      { kind: 'syllable', text: 'shine', hyphenToNext: false }
    ]);
  });

  it('assigns syllables to sung notes only (skips rests and tie continuations), per verse', () => {
    const score = parseGuitarDsl([
      '| C | % |',
      'mel: | r/4 c5/4~ c d |',
      'lyr: | あい |',
      'lyr: | かさ |'
    ].join('\n'));
    const mel = score.measures[0].melody!;
    assert.deepStrictEqual(mel.map(n => n.syllables.map(s => s?.text)), [[], ['あ', 'か'], [], ['い', 'さ']]);
    assert.deepStrictEqual(score.diagnostics, []);
  });

  it('warns on syllable count and bar mismatches, errors without mel:', () => {
    assert.deepStrictEqual(codes(['| C | % |', 'mel: | c5/2 d |', 'lyr: あいう'].join('\n')), ['syllableCountMismatch']);
    assert.deepStrictEqual(codes(['| C | % |', '| G | % |', 'mel: | c5/2 d | e5/1 |', 'lyr: | あ | いう |'].join('\n')), ['lyricBarMismatch']);
    assert.deepStrictEqual(codes(['| C | % |', 'lyr: あ'].join('\n')), ['lyricsWithoutMelody']);
  });
});

describe('compiler - chord lengths', () => {
  it('supports legacy beats (:) and note values (/) with the same placement', () => {
    const beats = parseGuitarDsl('| C:2.5 G:1.5 | 4.d 4.d 4.d 4.d |').measures[0].chords;
    const values = parseGuitarDsl('| C/2+8 G/4. | 4.d 4.d 4.d 4.d |').measures[0].chords;
    assert.deepStrictEqual(beats, [{ name: 'C', beat: 0 }, { name: 'G', beat: 2.5 }]);
    assert.deepStrictEqual(values, beats);
  });

  it('distinguishes slash-chord bass notes from note values', () => {
    const score = parseGuitarDsl('| G/B/2 D/F#:2 | 4.d 4.d 4.d 4.d |');
    assert.deepStrictEqual(score.measures[0].chords, [{ name: 'G/B', beat: 0 }, { name: 'D/F#', beat: 2 }]);
    assert.deepStrictEqual(score.usedChords, ['G/B', 'D/F#']);
    assert.deepStrictEqual(score.diagnostics, []);
  });

  it('reports invalid lengths and falls back to even placement', () => {
    const score = parseGuitarDsl('| C/3 G/4 | 4.d 4.d 4.d 4.d |');
    assert.deepStrictEqual(score.diagnostics.map(d => d.code), ['invalidLength']);
    assert.deepStrictEqual(score.measures[0].chords, [{ name: 'C', beat: 0 }, { name: 'G', beat: 2 }]);
  });

  it('warns when rhythm tokens do not add up to 4 beats and accepts 8t / 4+8', () => {
    assert.deepStrictEqual(codes('| C | 4.d 4.d 4.d |'), ['beatCountMismatch']);
    assert.deepStrictEqual(codes('| C | 8t.d 8t.u 8t.d 4.d |'), ['beatCountMismatch']);
    assert.deepStrictEqual(codes('| C | 8t.d 8t.u 8t.d 4+8.d 8.u 4.d |'), []);
  });
});

describe('compiler - key signature and display headers', () => {
  it('derives key signatures', () => {
    const table: [string, number | null][] = [
      ['C', 0], ['G', 1], ['D', 2], ['F#', 6], ['F', -1], ['Bb', -2], ['Cb', -7],
      ['Am', 0], ['Em', 1], ['Dm', -1], ['F#m', 3], ['H', null], ['C (capo 2)', null]
    ];
    for (const [key, expected] of table) {
      assert.strictEqual(parseKeySignature(key), expected, key);
    }
    assert.strictEqual(parseGuitarDsl('key: D').keySignature, 2);
  });

  it('parses show_rhythm and measures_per_row', () => {
    const score = parseGuitarDsl(['show_rhythm: false', 'measures_per_row: 2'].join('\n'));
    assert.strictEqual(score.showRhythm, false);
    assert.strictEqual(score.measuresPerRow, 2);
    assert.strictEqual(parseGuitarDsl('rhythm: off').showRhythm, false);
    assert.strictEqual(parseGuitarDsl('').showRhythm, true);

    const invalid = parseGuitarDsl('measures_per_row: 9');
    assert.strictEqual(invalid.measuresPerRow, 4);
    assert.deepStrictEqual(invalid.diagnostics.map(d => [d.code, d.severity]), [['invalidMeasuresPerRow', 'warning']]);
  });

  it('produces no diagnostics for the bundled samples', () => {
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');
    const dir = path.join(__dirname, '..', '..', 'samples');
    for (const f of fs.readdirSync(dir).filter(n => n.endsWith('.guitardsl'))) {
      const score = parseGuitarDsl(fs.readFileSync(path.join(dir, f), 'utf8'));
      assert.deepStrictEqual(score.diagnostics, [], f);
    }
  });
});
