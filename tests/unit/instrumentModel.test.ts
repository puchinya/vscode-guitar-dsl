import * as assert from 'assert';
import {
  createInstrumentModel,
  MAX_FRET,
  parseTuningValue,
  pitchToMidi,
  STANDARD_TUNING,
  TuningPreset
} from '../../src/instrumentModel';

describe('instrumentModel', () => {
  it('parses all supported presets with pitches ordered from string 6 to string 1', () => {
    const expected: Record<TuningPreset, number[]> = {
      Standard: [40, 45, 50, 55, 59, 64],
      'Drop D': [38, 45, 50, 55, 59, 64],
      DADGAD: [38, 45, 50, 55, 57, 62],
      'Open G': [38, 43, 50, 55, 59, 62],
      'Open D': [38, 45, 50, 54, 57, 62]
    };
    for (const [preset, pitches] of Object.entries(expected)) {
      const parsed = parseTuningValue(preset);
      assert.ok(parsed.ok, preset);
      assert.strictEqual(parsed.tuning.preset, preset);
      assert.deepStrictEqual(parsed.tuning.openMidi, pitches);
    }
    const normalized = parseTuningValue('  dRoP   d  ');
    assert.ok(normalized.ok);
    assert.deepStrictEqual(normalized.tuning.openMidi, expected['Drop D']);
    assert.deepStrictEqual(STANDARD_TUNING.openMidi, expected.Standard);
  });

  it('parses six explicit scientific pitches, comments and enharmonic equivalents', () => {
    const explicit = parseTuningValue('D2 A2 D3 G3 Bb3 D4  # Open G-style tuning');
    assert.ok(explicit.ok);
    assert.strictEqual(explicit.tuning.preset, undefined);
    assert.deepStrictEqual(explicit.tuning.openMidi, [38, 45, 50, 55, 58, 62]);
    const sharp = parseTuningValue('E2 A2 D3 G3 A#3 E4');
    const flat = parseTuningValue('E2 A2 D3 G3 Bb3 E4');
    assert.ok(sharp.ok && flat.ok);
    assert.strictEqual(sharp.tuning.openMidi[4], flat.tuning.openMidi[4]);
    assert.strictEqual(pitchToMidi('c', 4, 0), 60);
    assert.strictEqual(pitchToMidi('F', 3, 1), 54);
    assert.strictEqual(pitchToMidi('B', 9, 1), 132, 'do not clip scientific pitches to MIDI 0..127');
  });

  it('distinguishes unknown presets, invalid pitches and a valid but wrong string count', () => {
    assert.deepStrictEqual(parseTuningValue('Baritone'), { ok: false, reason: 'unknownPreset', detail: 'Baritone' });
    assert.deepStrictEqual(parseTuningValue('E2 A2 H3 G3 B3 E4'), { ok: false, reason: 'invalidPitch', detail: 'H3' });
    assert.deepStrictEqual(parseTuningValue('E2 A2 D3 G3 B3 F##4'), { ok: false, reason: 'invalidPitch', detail: 'F##4' });
    assert.deepStrictEqual(parseTuningValue('E2 A2 D3 G3 B3'), { ok: false, reason: 'stringCount', detail: '5' });
    assert.deepStrictEqual(parseTuningValue('E2 A2 D3 G3 B3 E4 A4'), { ok: false, reason: 'stringCount', detail: '7' });
    assert.deepStrictEqual(parseTuningValue('E2,A2,D3,G3,B3,E4'), { ok: false, reason: 'invalidPitch', detail: 'E2,A2,D3,G3,B3,E4' });
  });

  it('calculates capo-relative frets and the complete reverse mapping in stable string order', () => {
    const dropD = parseTuningValue('Drop D');
    assert.ok(dropD.ok);
    const model = createInstrumentModel(dropD.tuning, 2);
    assert.strictEqual(model.pitchAt(6, 0), 40);
    assert.strictEqual(model.pitchAt(6, 2), 42);
    assert.deepStrictEqual(model.openStringPitches(), [40, 47, 52, 57, 61, 66]);
    const standard = createInstrumentModel(STANDARD_TUNING);
    const positions = standard.positionsForPitch(64);
    assert.deepStrictEqual(positions.map(p => p.string), [6, 5, 4, 3, 2, 1]);
    assert.deepStrictEqual(positions.map(p => p.fret), [24, 19, 14, 9, 5, 0]);
    for (const position of positions) assert.strictEqual(standard.pitchAt(position.string, position.fret), 64);
    assert.deepStrictEqual(standard.positionsForPitch(139), []);
    for (const invalidPitch of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 64.5]) {
      assert.throws(() => standard.positionsForPitch(invalidPitch), RangeError);
    }
  });

  it('accepts physical fret 24 and rejects positions beyond the physical fretboard', () => {
    const highCapo = createInstrumentModel(STANDARD_TUNING, 12);
    assert.strictEqual(highCapo.pitchAt(6, 12), STANDARD_TUNING.openMidi[0] + MAX_FRET);
    assert.throws(() => highCapo.pitchAt(6, 13), RangeError);
    for (const invalidCapo of [-1, 13, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.throws(() => createInstrumentModel(STANDARD_TUNING, invalidCapo), RangeError);
    }
    const model = createInstrumentModel();
    for (const invalidString of [0, 7, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.throws(() => model.pitchAt(invalidString as 1, 0), RangeError);
    }
    for (const invalidFret of [-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, 25]) {
      assert.throws(() => model.pitchAt(1, invalidFret), RangeError);
    }
    assert.throws(() => model.positionsForPitch(Number.NaN), RangeError);
  });

  it('copies and freezes tuning data and returns immutable independent results', () => {
    const input = [40, 45, 50, 55, 59, 64] as [number, number, number, number, number, number];
    const model = createInstrumentModel({ openMidi: input });
    input[0] = 99;
    assert.strictEqual(model.pitchAt(6, 0), 40);
    assert.ok(Object.isFrozen(model));
    assert.ok(Object.isFrozen(model.tuning));
    assert.ok(Object.isFrozen(model.tuning.openMidi));
    assert.ok(Object.isFrozen(model.openStringPitches()));
    const first = model.positionsForPitch(64);
    const second = model.positionsForPitch(64);
    assert.notStrictEqual(first, second);
    assert.ok(Object.isFrozen(first));
    assert.ok(first.every(position => Object.isFrozen(position)));
  });
});
