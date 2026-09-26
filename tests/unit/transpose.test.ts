import * as assert from 'assert';
import { inferCapoForDsl } from '../../src/capo';
import { parseGuitarDsl } from '../../src/compiler';
import { writtenStaffPosition, staffPosition } from '../../src/render/notation';
import { planSoundingTranspose, planTransposeWithCapo, transposeKeyName, transposePitch } from '../../src/transpose';

function ok(plan: ReturnType<typeof planSoundingTranspose>) {
  assert.ok(plan.ok, plan.ok ? '' : `${plan.code} ${plan.detail ?? ''}`);
  return plan as Extract<typeof plan, { ok: true }>;
}

describe('transpose - pitch and key helpers', () => {
  it('spells keys and pitches canonically', () => {
    assert.strictEqual(transposeKeyName('B', 2), 'C#');
    assert.strictEqual(transposeKeyName('F#m', 1), 'Gm');
    assert.strictEqual(transposeKeyName('C', -1), 'B');
    assert.strictEqual(transposeKeyName('Db', 1), 'D');
    assert.strictEqual(transposeKeyName('C major', 1), null);
    assert.deepStrictEqual(transposePitch({ step: 'b', alter: 0, octave: 4 }, 1), { step: 'c', alter: 0, octave: 5 });
    assert.deepStrictEqual(transposePitch({ step: 'c', alter: 0, octave: 4 }, -1), { step: 'b', alter: 0, octave: 3 });
    assert.deepStrictEqual(transposePitch({ step: 'c', alter: 1, octave: 4 }, 2), { step: 'e', alter: -1, octave: 4 }, 'D# is spelled Eb');
  });
});

describe('transpose - planSoundingTranspose', () => {
  it('moves key, chords and melody with a fixed capo (T033)', () => {
    const src = 'capo: 2\nkey: B\n| A |\nmel: | b4/1 |';
    const plan = ok(planTransposeWithCapo(src, 2, { kind: 'keep' }));
    assert.strictEqual(plan.text, 'capo: 2\nkey: C#\n| B |\nmel: | c#5/1 |');
    assert.strictEqual(plan.targetCapo, 2);
    assert.strictEqual(plan.targetKey, 'C#');
  });

  it('composes with an explicit capo (T034)', () => {
    const src = 'capo: 0\nkey: C\n| C |\nmel: | c4/1 |';
    const plan = ok(planTransposeWithCapo(src, 2, { kind: 'explicit', capo: 2 }));
    assert.strictEqual(plan.text, 'capo: 2\nkey: D\n| C |\nmel: | d4/1 |');
    assert.deepStrictEqual(Array.from(plan.chordMap), [['C', 'C']]);
  });

  it('transposes a modulated score consistently (T035)', () => {
    const src = 'key: C\n| C G |\nmel: | c5/2 g4/2 |\n@key: E\n| E B7/D# |\nmel: | e5/1 |';
    const plan = ok(planSoundingTranspose(src, 2));
    assert.strictEqual(plan.text, 'key: D\n| D A |\nmel: | d5/2 a4/2 |\n@key: F#\n| F# C#7/F |\nmel: | f#5/1 |');
    const score = parseGuitarDsl(plan.text);
    assert.deepStrictEqual(score.measures.map(m => m.context.key), ['D', 'F#']);
  });

  it('crosses octave boundaries and rejects out-of-range pitches (T036)', () => {
    assert.strictEqual(ok(planSoundingTranspose('| C |\nmel: | b4/1 |', 1)).text, 'key: C#\n| C# |\nmel: | c5/1 |');
    const low = planSoundingTranspose('| C |\nmel: | c0/1 |', -1);
    assert.deepStrictEqual(low.ok ? null : [low.code], ['pitchOutOfRange']);
    // Inherited octaves stay correct: the second note needs an explicit octave after crossing.
    assert.strictEqual(ok(planSoundingTranspose('key: C\n| C |\nmel: | a4/4 b c5 d |', 2)).text, 'key: D\n| D |\nmel: | b4/4 c#5 d5 e |');
    assert.strictEqual(ok(planSoundingTranspose('key: C\n| C |\nmel: | g4/4 a b c5 |', 3)).text, 'key: Eb\n| Eb |\nmel: | bb4/4 c5 d eb5 |');
    // Inline notes start from the default octave 4.
    assert.strictEqual(ok(planSoundingTranspose('key: C\n| C | b4/8 c 4 4 4 |', 1)).text, 'key: C#\n| C# | c5/8 c#4 4 4 4 |');
  });

  it('preserves every byte outside the transformed spans (T037)', () => {
    const src = [
      'title: Song  # t',
      'key:   A   # original',
      'bpm: 120',
      'time: 6/8',
      'feel: swing',
      'style_chord_size: 16',
      '',
      '[Verse]  ',
      '|  A   E/G#  |  8.d  8.u   8.d 8.d 8.u 8.d  l:"A la"  |',
      'mel: |  a4/8{hammer}  b   c#5/4.~  |',
      'lyr: あ い う',
      '@key:  B   # up',
      '@dynamic: f',
      '| B:3 | 4. 4. |',
      'mel: | b4/4.{staccato} f#5/8{5:4}~ f#5/8{5:4} f# f# f# |'
    ].join('\r\n');
    const plan = ok(planSoundingTranspose(src, 2));
    const expected = src
      .replace('key:   A   #', 'key:   B   #')
      .replace('|  A   E/G#  |', '|  B   F#/Bb  |')
      .replace('a4/8{hammer}  b   c#5/4.~', 'b4/8{hammer}  c#5   d#5/4.~'.replace('d#5', 'eb5'))
      .replace('@key:  B   #', '@key:  C#   #')
      .replace('| B:3 |', '| C#:3 |')
      .replace('b4/4.{staccato} f#5/8{5:4}~ f#5/8{5:4} f# f# f#', 'c#5/4.{staccato} ab5/8{5:4}~ ab5/8{5:4} ab ab ab');
    assert.strictEqual(plan.text, expected);
    assert.ok(plan.text.includes('\r\n') && !/[^\r]\n/.test(plan.text), 'CRLF kept');
    assert.deepStrictEqual(parseGuitarDsl(plan.text).diagnostics.filter(d => d.severity === 'error'), []);
  });

  it('fails on a used labeled chord variant (T038)', () => {
    const plan = planSoundingTranspose('chord C@foo = x32010\n| C@foo |', 2);
    assert.deepStrictEqual(plan.ok ? null : [plan.code, plan.detail], ['labeledChordVariant', 'C@foo']);
    assert.ok(planSoundingTranspose('chord C@foo = x32010\n| C@foo |', 0).ok, '0 semitones is a no-op');
  });

  it('fails on a collision with an unrelated custom definition (T039)', () => {
    const plan = planSoundingTranspose('chord D = xx0232\n| C | D |', 2);
    assert.deepStrictEqual(plan.ok ? null : plan.code, 'customDefinitionCollision');
  });

  it('keeps unused definitions as a warning only', () => {
    const plan = ok(planSoundingTranspose('chord C = x32010\n| C |', 2));
    assert.deepStrictEqual(plan.unusedDefinitions, ['C']);
    assert.deepStrictEqual(plan.warnings, ['unusedChordDefinitions']);
    assert.ok(plan.text.startsWith('chord C = x32010'));
  });

  it('is a no-op for 0 semitones and rejects out-of-range shifts', () => {
    const src = 'key: G\n| G |\nmel: | g4/1 |';
    assert.strictEqual(ok(planSoundingTranspose(src, 0)).text, src);
    for (const n of [12, -12, 1.5]) {
      const plan = planSoundingTranspose(src, n);
      assert.deepStrictEqual(plan.ok ? null : plan.code, 'invalidSemitones', String(n));
    }
    const broken = planSoundingTranspose('| C |\nmel: | C4/1 |', 1);
    assert.deepStrictEqual(broken.ok ? null : broken.code, 'sourceParseError');
  });

  it('transposes sounding pitch under an ottava; only the written position differs (contract §5.10)', () => {
    const plan = ok(planSoundingTranspose('key: C\n@ottava: 8va\n| C |\nmel: | c5/1 |', 2));
    const score = parseGuitarDsl(plan.text);
    const note = score.measures[0].melody![0].pitch!;
    assert.deepStrictEqual(note, { step: 'd', alter: 0, octave: 5 });
    assert.strictEqual(writtenStaffPosition(note, score.measures[0].context.ottava), staffPosition({ step: 'd', alter: 0, octave: 4 }));
  });
});

describe('transpose - capo composition', () => {
  it('transposes first, then applies the recommended capo of the transposed source (T040)', () => {
    const src = 'capo: 0\nkey: A\n| A | D | E | A |';
    const plan = ok(planTransposeWithCapo(src, 1, { kind: 'recommended' }));
    const transposed = ok(planSoundingTranspose(src, 1));
    const expectedCapo = inferCapoForDsl(transposed.text)!.recommendedCapo!;
    assert.strictEqual(plan.targetCapo, expectedCapo);
    const final = parseGuitarDsl(plan.text);
    assert.strictEqual(final.capo, String(expectedCapo));
    assert.strictEqual(final.originalKey, 'Bb');
    // Sounding harmony: written chords raised by the capo equal the transposed chords.
    const sounding = final.measures.map(m => m.chords[0].name);
    assert.strictEqual(sounding.length, 4);
    for (const [from, to] of plan.chordMap) {
      const byCapo = require('../../src/capo').transposeChordName(to, expectedCapo);
      assert.strictEqual(byCapo, require('../../src/capo').transposeChordName(from, 1));
    }
  });

  it('keeps the capo with a warning when there is no chord to recommend from (T041)', () => {
    const plan = ok(planTransposeWithCapo('capo: 3\nkey: C\n| r1 |\nmel: | c4/1 |', 2, { kind: 'recommended' }));
    assert.strictEqual(plan.targetCapo, 3);
    assert.ok(plan.warnings.includes('noCapoRecommendation'));
  });

  it('reports capo-stage failures without returning partial text', () => {
    const plan = planTransposeWithCapo('capo: 0\nkey: C\n| C |', 2, { kind: 'explicit', capo: 13 });
    assert.deepStrictEqual(plan.ok ? null : [plan.code, plan.stage], ['invalidTargetCapo', 'capo']);
    assert.ok(!('text' in plan));
  });
});
