import { parseChordName } from './chordDetect';
import { chordKey, ChordDefinition } from './chordDefinition';
import { resolveChordVoicing } from './chordVoicingResolver';
import { createInstrumentModel, GuitarString, pitchToMidi as instrumentPitchToMidi, STANDARD_TUNING, Tuning } from './instrumentModel';
import type { Pitch } from './melody';
import type { PlaybackEvent } from './playbackTimeline';

/** Converts a scientific-pitch GuitarDSL pitch to MIDI (C4 = 60). */
export function pitchToMidi(pitch: Pitch): number {
  return instrumentPitchToMidi(pitch.step, pitch.octave, pitch.alter);
}

/** Converts a MIDI note number to frequency for the Web Audio oscillator. */
export function midiToFrequency(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

function soundingPitchClass(pitchClass: number, capoSemitones: number): number {
  return ((pitchClass + capoSemitones) % 12 + 12) % 12;
}

/**
 * Produces a generic close-position chord independent of guitar fingering. Unsupported chord qualities
 * return null so the timeline rhythm attack can remain silent.
 */
export function chordToMidiNotes(name: string, capoSemitones: number): number[] | null {
  const parsed = parseChordName(name);
  if (!parsed?.quality) return null;
  const capo = Number.isFinite(capoSemitones) ? Math.trunc(capoSemitones) : 0;
  const bassPitchClass = soundingPitchClass(parsed.bassPc ?? parsed.rootPc, capo);
  const rootPitchClass = soundingPitchClass(parsed.rootPc, capo);
  const bassMidi = 36 + bassPitchClass;
  const upperRootMidi = 48 + rootPitchClass;
  const upperNotes = parsed.quality.intervals.map(interval => upperRootMidi + interval);
  return [...new Set([bassMidi, ...upperNotes])];
}

/** Symbolic oscillator pitches for one timeline event; empty means this event has no pitched voice. */
export function playbackEventMidiNotes(
  event: PlaybackEvent,
  effectiveCapo: number,
  chordDefinitions: readonly ChordDefinition[] = [],
  tuning: Tuning = STANDARD_TUNING
): number[] {
  if (event.kind === 'pitched') return event.pitches.map(pitchToMidi);
  if (event.kind === 'rhythmAttack' && event.chord) {
    if (event.stringAttack !== undefined) {
      const instrument = createInstrumentModel(tuning, effectiveCapo);
      const resolved = resolveChordVoicing(chordKey(event.chord.name, event.chord.label), chordDefinitions, instrument);
      const fret = resolved?.voicing.frets[6 - event.stringAttack];
      if (typeof fret !== 'number' || !Number.isInteger(fret)) return [];
      try {
        return [instrument.pitchAt(event.stringAttack as GuitarString, fret)];
      } catch (_) {
        return [];
      }
    }
    return chordToMidiNotes(event.chord.name, effectiveCapo) ?? [];
  }
  return [];
}
