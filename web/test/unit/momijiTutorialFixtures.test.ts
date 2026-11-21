import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { expandMeasureRepeat, parseGuitarDsl } from '../../../packages/core/src/compiler';
import { fnum } from '../../../packages/core/src/duration';
import { takesSyllable } from '../../../packages/core/src/melody';

const readFixture = (name: string) => readFileSync(new URL(`../../../docs/tutorials/${name}`, import.meta.url), 'utf8');
const diagnosticCount = (score: ReturnType<typeof parseGuitarDsl>, severity: 'error' | 'warning') => score.diagnostics.filter(item => item.severity === severity).length;
const pitchText = (measure: NonNullable<ReturnType<typeof parseGuitarDsl>['measures'][number]['melody']>) => measure.map(note => {
  if (note.isRest) return 'r';
  const pitch = note.pitch!;
  return `${pitch.step}${pitch.alter === 1 ? '#' : pitch.alter === -1 ? 'b' : ''}${pitch.octave}`;
});

describe('紅葉 tutorial fixtures', () => {
  const chordOnly = parseGuitarDsl(readFixture('momiji-4-4-no-melody.guitardsl'));
  const withMelody = parseGuitarDsl(readFixture('momiji-4-4-with-melody.guitardsl'));

  it('keeps the 16-bar chord-only chart complete, explicit and warning-free', () => {
    const source = readFixture('momiji-4-4-no-melody.guitardsl');
    assert.equal(chordOnly.measures.length, 16);
    assert.equal(chordOnly.originalKey, 'C');
    assert.equal(chordOnly.measuresPerRow, 4);
    assert.equal(diagnosticCount(chordOnly, 'error'), 0);
    assert.equal(diagnosticCount(chordOnly, 'warning'), 0);
    assert.equal((source.match(/\bl:/g) ?? []).length, 16);
    assert.equal((source.match(/\bmel:/g) ?? []).length, 0);
    assert.equal((source.match(/\blyr:/g) ?? []).length, 0);
    assert.equal(chordOnly.measures.filter(measure => measure.rhythmOrigin === 'explicit').length, 8);
    assert.equal(chordOnly.measures.filter(measure => measure.rhythmOrigin === 'repeat').length, 8);
    assert.equal(chordOnly.measures.reduce((total, measure) => total + expandMeasureRepeat(measure, chordOnly.measures).rhythms.length, 0), 96);
    assert.equal(chordOnly.measures.filter(measure => measure.chords.length > 1).length, 14);
    assert.ok(chordOnly.measures.every(measure => !measure.melody));
  });

  it('keeps the same accompaniment and supplies the authentic 16-bar C-major melody', () => {
    const source = readFixture('momiji-4-4-with-melody.guitardsl');
    assert.equal(withMelody.measures.length, 16);
    assert.equal(withMelody.originalKey, 'C');
    assert.equal(diagnosticCount(withMelody, 'error'), 0);
    assert.equal(diagnosticCount(withMelody, 'warning'), 0);
    assert.equal((source.match(/\bl:/g) ?? []).length, 0);
    assert.equal((source.match(/\blyr:/g) ?? []).length, 4);
    assert.equal((source.match(/\bmel:/g) ?? []).length, 4);
    assert.deepEqual(withMelody.measures.map(measure => measure.chord), chordOnly.measures.map(measure => measure.chord));
    assert.deepEqual(withMelody.measures.map(measure => measure.rhythmOrigin), chordOnly.measures.map(measure => measure.rhythmOrigin));
    assert.deepEqual(withMelody.measures.map(measure => measure.rhythms.length), chordOnly.measures.map(measure => measure.rhythms.length));
    assert.ok(withMelody.measures.every(measure => measure.melody));
    assert.equal(withMelody.melodyGroups.length, 4);
    assert.ok(withMelody.melodyGroups.every(group => group.verseCount === 1));
    assert.deepEqual(withMelody.measures.map(measure => measure.melody!.reduce((beats, note) => beats + fnum(note.beats), 0)), Array(16).fill(4));
    assert.equal(withMelody.measures.flatMap(measure => measure.melody!).filter(takesSyllable).length, 60);
    assert.deepEqual(withMelody.measures.map(measure => pitchText(measure.melody!)), [
      ['e4', 'd4', 'c4', 'd4', 'e4'], ['c4', 'g3', 'r'], ['c4', 'b3', 'c4', 'd4', 'g4'], ['e4', 'd4', 'c4', 'd4', 'r'],
      ['e4', 'd4', 'c4', 'd4', 'e4'], ['c4', 'g3', 'r'], ['c4', 'b3', 'c4', 'd4', 'g4'], ['e4', 'd4', 'c4', 'r'],
      ['g4', 'e4', 'f4', 'g4', 'a4'], ['g4', 'e4', 'r'], ['g4', 'a4', 'g4', 'e4', 'd4', 'c4'], ['d4', 'e4', 'd4', 'r'],
      ['g4', 'a4', 'g4', 'e4', 'd4'], ['c4', 'g3', 'r'], ['c4', 'b3', 'c4', 'e4', 'd4'], ['c4', 'r']
    ]);
  });
});
