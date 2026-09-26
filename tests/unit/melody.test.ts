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
  it('splits lyrics by whitespace, preserving syllables like small kana and ー / っ in each token', () => {
    const texts = tokenizeLyrics('しゃ ぼ ん だ ま  きょ う  がっ こー').map(i => (i.kind === 'syllable' ? i.text : i.kind));
    assert.deepStrictEqual(texts, ['しゃ', 'ぼ', 'ん', 'だ', 'ま', 'きょ', 'う', 'がっ', 'こー']);
  });

  it('handles groups, melisma, skip, English hyphens and bars', () => {
    const items = tokenizeLyrics('(ひか) り _ * | sun- shine');
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
      'lyr: | あ い |',
      'lyr: | か さ |'
    ].join('\n'));
    const mel = score.measures[0].melody!;
    assert.deepStrictEqual(mel.map(n => n.syllables.map(s => s?.text)), [[], ['あ', 'か'], [], ['い', 'さ']]);
    assert.deepStrictEqual(score.diagnostics, []);
  });

  it('warns on syllable count and bar mismatches, errors without mel:', () => {
    assert.deepStrictEqual(codes(['| C | % |', 'mel: | c5/2 d |', 'lyr: あ い う'].join('\n')), ['syllableCountMismatch']);
    assert.deepStrictEqual(codes(['| C | % |', '| G | % |', 'mel: | c5/2 d | e5/2 f |', 'lyr: | あ | い う え |'].join('\n')), ['lyricBarMismatch']);
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

describe('melody - techniques and grace notes', () => {
  const mel = (cells: string, header = '') => parseGuitarDsl(`${header}| C |\nmel: | ${cells} |`);

  it('parses every technique into a structured model (T024)', () => {
    const score = mel('c5/8{hammer} d{pull} e{slide} f{gliss} g/8{vibrato,staccato} a{tenuto,fermata} b{breath} c6{bend:1.5}');
    assert.deepStrictEqual(score.diagnostics, []);
    const t = score.measures[0].melody!.map(n => n.techniques);
    assert.deepStrictEqual(t, [
      { connection: 'hammer' }, { connection: 'pull' }, { connection: 'slide' }, { connection: 'gliss' },
      { vibrato: true, staccato: true }, { tenuto: true, fermata: true }, { breath: true }, { bend: 1.5 }
    ]);
    const more = mel('c5/16{grace} d5/4{slur-start,pm} e{let-ring} f{slur-end} g');
    assert.deepStrictEqual(more.diagnostics, []);
    assert.deepStrictEqual(more.measures[0].melody!.map(n => n.techniques), [
      { grace: true }, { slurStart: true, palmMute: true }, { letRing: true }, { slurEnd: true }, undefined
    ]);
    // Tuplet ratio and technique block together, then a tie.
    const both = mel('c5/8{5:4}{staccato} d e f g~ g/2');
    assert.deepStrictEqual(both.diagnostics, []);
    const first = both.measures[0].melody![0];
    assert.deepStrictEqual(first.parts[0].tuplet, { actual: 5, normal: 4 });
    assert.deepStrictEqual(first.techniques, { staccato: true });
    assert.strictEqual(both.measures[0].melody![4].tieToNext, true);
  });

  it('rejects unknown, duplicated and incompatible techniques', () => {
    for (const bad of ['c5/1{tapping}', 'c5/1{hammer,hammer}', 'c5/1{hammer,pull}', 'c5/1{slur-start,slur-end}', 'c5/1{bend:5}', 'c5/1{bend:0.7}']) {
      assert.deepStrictEqual(codes(`| C |\nmel: | ${bad} |`), ['invalidTechnique'], bad);
    }
    assert.deepStrictEqual(codes('| C |\nmel: | c5/1{} |'), ['invalidLength']);
    assert.deepStrictEqual(codes('| C |\nmel: | c5/8{9:9} d e f g h |').slice(0, 1), ['invalidTuplet']);
  });

  it('allows only fermata / breath on rests and pitch techniques on pitched notes (T025)', () => {
    assert.deepStrictEqual(codes('| C |\nmel: | c5/2 r/2{bend:2} |'), ['techniqueRequiresPitch', 'beatCountMismatch']);
    assert.deepStrictEqual(codes('| C |\nmel: | c5/2 r/4{fermata} r/4{breath} |'), []);
    assert.deepStrictEqual(codes('| C | 4.d.bend 4 4 4 |'), ['techniqueRequiresPitch']);
    assert.deepStrictEqual(codes('| C | 4.hammer 4 4 4 |'), ['techniqueRequiresPitch']);
    assert.deepStrictEqual(codes('| C | r4.pm 4 4 4 |'), ['techniqueRequiresPitch']);
    assert.deepStrictEqual(codes('| C | r4.fermata 4 4 4.breath |'), []);
    const slashes = parseGuitarDsl('| C | 4.d.pm 4.lr 4.stacc.ten 4.fermata.vib.breath |').measures[0].rhythms.map(r => r.techniques);
    assert.deepStrictEqual(slashes, [{ palmMute: true }, { letRing: true }, { staccato: true, tenuto: true }, { fermata: true, vibrato: true, breath: true }]);
  });

  it('gives grace notes zero beats and no syllable (T026)', () => {
    const score = parseGuitarDsl('| C |\nmel: | c5/16{grace} d5/4 e f g |\nlyr: あ い う え');
    assert.deepStrictEqual(score.diagnostics, []);
    const notes = score.measures[0].melody!;
    assert.strictEqual(notes[0].beats.n, 0);
    assert.strictEqual(notes[0].parts[0].base, 16);
    assert.deepStrictEqual(notes[0].syllables, []);
    assert.strictEqual(notes[1].syllables[0]?.text, 'あ');
    // A grace note does not change the inherited length.
    assert.strictEqual(parseGuitarDsl('| C |\nmel: | c5/4 d/16{grace} e f g |').diagnostics.length, 0);
    assert.deepStrictEqual(codes('| C |\nmel: | c5/1 d5/8{grace} |'), ['danglingGrace']);
    assert.deepStrictEqual(codes('| C | c4/8{grace} 4 4 4 4 |'), []);
    assert.deepStrictEqual(codes('| C | 4 4 4 4 c4/8{grace} |'), ['danglingGrace']);
  });

  it('connects to the next sounding non-grace note and warns without a target (T027)', () => {
    assert.deepStrictEqual(codes('| C |\nmel: | c5/4{hammer} r/4 d5/16{grace} e5/2 |'), []);
    assert.deepStrictEqual(codes('| C |\nmel: | c5/2 d5/2{pull} |'), ['danglingTechnique']);
    assert.deepStrictEqual(codes('| C |\nmel: | c5/2 d5/2{slide} |\n| C |\nmel: | e5/1 |'), []);
    // Inline notes: an unpitched slash is not a target.
    assert.deepStrictEqual(codes('| C | c4/4{hammer} 4 4 4 |'), ['danglingTechnique']);
    assert.deepStrictEqual(codes('| C | c4/4{hammer} d4/4 4 4 |'), []);
  });

  it('validates slurs (T030)', () => {
    assert.deepStrictEqual(codes('| C |\nmel: | c5/4{slur-start} d e f{slur-end} |'), []);
    assert.deepStrictEqual(codes('| C |\nmel: | c5/4 d e f{slur-end} |'), ['unmatchedSlurEnd']);
    assert.deepStrictEqual(codes('| C |\nmel: | c5/4{slur-start} d{slur-start} e f{slur-end} |'), ['nestedSlur']);
    assert.deepStrictEqual(codes('| C |\nmel: | c5/4{slur-start} d e f |'), ['unclosedSlur']);
  });
});
