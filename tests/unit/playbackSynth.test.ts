import * as assert from 'assert';
import { frac } from '../../src/duration';
import { chordToMidiNotes, midiToFrequency, pitchToMidi, playbackEventMidiNotes } from '../../src/playbackSynth';
import type { PlaybackEvent } from '../../src/playbackTimeline';

describe('playbackSynth', () => {
  it('converts scientific pitches with C4 equal to MIDI 60', () => {
    assert.strictEqual(pitchToMidi({ step: 'c', octave: 4, alter: 0 }), 60);
    assert.strictEqual(pitchToMidi({ step: 'f', octave: 4, alter: 1 }), 66);
    assert.strictEqual(midiToFrequency(69), 440);
  });

  it('applies effective capo to symbolic chords while preserving chord-plus-capo pitch', () => {
    assert.deepStrictEqual(chordToMidiNotes('C', 3), chordToMidiNotes('D#', 0));
    assert.deepStrictEqual(chordToMidiNotes('C/E', 0), [40, 48, 52, 55]);
    const chord = chordToMidiNotes('C', 3)!;
    assert.ok(chord[0] >= 36 && chord[0] <= 47);
    assert.ok(chord.slice(1).every(note => note >= 48));
  });

  it('does not capo-shift sounding melody pitches and leaves unsupported chord qualities silent', () => {
    const melody: PlaybackEvent = {
      kind: 'pitched',
      source: 'melody',
      pitches: [{ step: 'c', octave: 4, alter: 0 }],
      occurrenceIndex: 0,
      measureIndex: 0,
      beatInMeasure: frac(0),
      absoluteBeat: frac(0),
      timeSeconds: 0,
      durationBeats: frac(1),
      durationSeconds: 0.5
    };
    assert.deepStrictEqual(playbackEventMidiNotes(melody, 7), [60]);

    const unsupported: PlaybackEvent = {
      kind: 'rhythmAttack',
      chord: { name: 'Cunknown' },
      occurrenceIndex: 0,
      measureIndex: 0,
      beatInMeasure: frac(0),
      absoluteBeat: frac(0),
      timeSeconds: 0,
      durationBeats: frac(1),
      durationSeconds: 0.5
    };
    assert.deepStrictEqual(playbackEventMidiNotes(unsupported, 0), []);
  });
});
