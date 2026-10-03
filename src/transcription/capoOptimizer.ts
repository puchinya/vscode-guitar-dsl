// Local deterministic capo choice: sounding chords -> play-form chord names + capo.
// Pure module independent of VS Code APIs and Gemini SDK.

import { isValidChordName } from '../chordDefinition';
import { NOTE_NAMES, noteNameToPitchClass } from '../chordDetect';
import { getDefaultVoicing } from '../chordPresets';
import { TranscribedSong } from './model';

export const MAX_AUTO_CAPO = 7;
const CAPO_TIE_WEIGHT = 0.25;
const UNKNOWN_VOICING_SCORE = 10;

const CHORD_PARTS_RE = /^([A-G][b#]?)([^/]*)(?:\/([A-G][b#]?))?$/;

function transposeNote(note: string, semitones: number): string | null {
  const pc = noteNameToPitchClass(note);
  return pc === null ? null : NOTE_NAMES[(((pc + semitones) % 12) + 12) % 12];
}

/**
 * Transposes the root and slash bass by semitones, preserving the quality suffix as written.
 * Returns null when the input or the result is not a valid GuitarDSL chord name.
 */
export function transposeChordName(name: string, semitones: number): string | null {
  const m = name.match(CHORD_PARTS_RE);
  if (!m) return null;
  const root = transposeNote(m[1], semitones);
  if (!root) return null;
  let result = root + m[2];
  if (m[3]) {
    const bass = transposeNote(m[3], semitones);
    if (!bass) return null;
    result += `/${bass}`;
  }
  return isValidChordName(result) ? result : null;
}

/**
 * Playability of one chord occurrence from its default voicing (lower is easier). A slash chord
 * without its own voicing is scored by its upper chord.
 */
export function scoreChord(name: string): number {
  let voicing = getDefaultVoicing(name);
  if (!voicing) {
    const slash = name.indexOf('/');
    if (slash > 0) {
      voicing = getDefaultVoicing(name.slice(0, slash));
    }
  }
  if (!voicing) return UNKNOWN_VOICING_SCORE;

  const fretted = voicing.frets.filter((f): f is number => typeof f === 'number' && f > 0);
  const hasOpen = voicing.frets.some(f => f === 0);
  if (hasOpen) {
    return fretted.length === 0 || Math.max(...fretted) <= 4 ? 0 : 1;
  }
  return fretted.length > 0 && Math.min(...fretted) <= 5 ? 3 : 5;
}

function collectChordNames(song: TranscribedSong): string[] {
  return song.sections.flatMap(s => s.measures.flatMap(m => m.chords.map(c => c.name)));
}

/**
 * Manual capo is returned unchanged. Auto evaluates capo 0..7 over every sounding chord occurrence
 * (sum of scoreChord of the play form + 0.25 * capo) and picks the minimum, lower capo on ties.
 * A capo whose transposition leaves the supported syntax is skipped; if none is valid, 0 is used.
 */
export function chooseCapo(song: TranscribedSong, manualCapo?: number, score: (name: string) => number = scoreChord): number {
  if (manualCapo !== undefined) return manualCapo;

  const names = collectChordNames(song);
  let best: { capo: number; score: number } | undefined;
  for (let capo = 0; capo <= MAX_AUTO_CAPO; capo++) {
    let total = CAPO_TIE_WEIGHT * capo;
    let valid = true;
    for (const name of names) {
      const play = transposeChordName(name, -capo);
      if (!play) {
        valid = false;
        break;
      }
      total += score(play);
    }
    if (valid && (!best || total < best.score)) {
      best = { capo, score: total };
    }
  }
  return best ? best.capo : 0;
}

/** Returns a copy of the song with play-form chords for the capo. `key` stays the sounding key. */
export function applyCapo(song: TranscribedSong, capo: number): TranscribedSong {
  const sections = song.sections.map(section => ({
    ...section,
    measures: section.measures.map(measure => ({
      ...measure,
      chords: measure.chords.map(chord => {
        const play = transposeChordName(chord.name, -capo);
        if (!play) {
          throw new Error(`Chord '${chord.name}' cannot be transposed for capo ${capo}`);
        }
        return { ...chord, name: play };
      })
    }))
  }));
  const result: TranscribedSong = { ...song, sections };
  if (capo > 0) {
    result.capo = capo;
  } else {
    delete result.capo;
  }
  return result;
}
