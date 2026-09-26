// Pure AudioMirResultV1 -> TranscribedSong -> GuitarDSL conversion.
// Every measure is built to exactly 4 beats here; the existing validator is then run
// strictly (no autoRepair), followed by the existing serializer and parser.

import { parseGuitarDsl } from '../compiler';
import { NoteValuePart, decomposeBeats, frac } from '../duration';
import { ChordEvent, Measure, RhythmEvent, TranscribedSong, validateTranscribedSong } from '../transcription/model';
import { serializeSongToGuitarDsl } from '../transcription/serializer';
import { AudioMirMeasureV1, AudioMirResultV1, AudioMirSubdivision } from './model';

export const AUDIO_MIR_SECTION_NAME = 'Analysis';

function partToString(p: NoteValuePart): string {
  return `${p.base}${p.dotted ? '.' : ''}${p.tuplet ? 't' : ''}`;
}

/** Note value (dots allowed) for `sixteenths` 16th notes, e.g. 6 -> `4.`, 5 -> `4+16`. */
function chordDuration(sixteenths: number): string {
  const parts = decomposeBeats(frac(sixteenths, 4));
  if (!parts) {
    throw new Error(`Unrepresentable chord span of ${sixteenths} sixteenths`);
  }
  return parts.map(partToString).join('+');
}

/**
 * Rhythm note value parts for `span` slots of an 8/12/16 grid. Rhythm tokens use '.'
 * as the modifier separator, so dotted values are written additively (`4.` -> `4+8`).
 */
function rhythmParts(span: number, subdivision: AudioMirSubdivision): string[] {
  if (subdivision === 12) {
    // One slot is one 8th-note triplet (1/3 beat); largest exact values first.
    const table: [number, string][] = [[12, '1'], [6, '2'], [3, '4'], [2, '4t'], [1, '8t']];
    const out: string[] = [];
    let rest = span;
    for (const [slots, token] of table) {
      while (rest >= slots) {
        out.push(token);
        rest -= slots;
      }
    }
    return out;
  }
  const parts = decomposeBeats(frac(span * 4, subdivision));
  if (!parts) {
    throw new Error(`Unrepresentable rhythm span of ${span}/${subdivision}`);
  }
  return parts.flatMap(p => (p.dotted ? [`${p.base}`, `${p.base * 2}`] : [partToString(p)]));
}

/** Deterministic stroke direction from the grid position (not acoustically inferred). */
export function strokeDirection(slot: number, subdivision: AudioMirSubdivision): 'd' | 'u' {
  if (subdivision === 12) {
    return slot % 3 === 1 ? 'u' : 'd';
  }
  return slot % 2 === 0 ? 'd' : 'u';
}

function adaptChords(m: AudioMirMeasureV1): ChordEvent[] {
  return m.chords.map((c, i) => {
    const end = i + 1 < m.chords.length ? m.chords[i + 1].tick16 : 16;
    return { name: c.name, duration: chordDuration(end - c.tick16) };
  });
}

function adaptRhythm(m: AudioMirMeasureV1): RhythmEvent[] {
  const grid = m.subdivision;
  if (m.attacks.length === 0) {
    return [{ duration: 'r1' }];
  }
  const events: RhythmEvent[] = [];
  const first = m.attacks[0].slot;
  if (first > 0) {
    for (const p of rhythmParts(first, grid)) {
      events.push({ duration: `r${p}` });
    }
  }
  m.attacks.forEach((a, i) => {
    const end = i + 1 < m.attacks.length ? m.attacks[i + 1].slot : grid;
    const event: RhythmEvent = {
      duration: rhythmParts(end - a.slot, grid).join('+'),
      direction: strokeDirection(a.slot, grid)
    };
    if (a.accent) {
      event.accent = true;
    }
    events.push(event);
  });
  return events;
}

/** Pure conversion into the existing transcription IR (one "Analysis" section). */
export function adaptAudioMirResult(result: AudioMirResultV1, title: string): TranscribedSong {
  const measures: Measure[] = result.measures.map(m => ({
    chords: adaptChords(m),
    rhythm: adaptRhythm(m)
  }));
  const song: TranscribedSong = {
    capo: 0,
    key: result.key.name,
    bpm: Math.round(result.tempo.bpm),
    timeSignature: { numerator: 4, denominator: 4 },
    sections: [{ name: AUDIO_MIR_SECTION_NAME, measures }]
  };
  if (title) {
    song.title = title;
  }
  return song;
}

export type AudioMirConversion =
  | { ok: true; song: TranscribedSong; content: string }
  | { ok: false; error: string };

/**
 * Adapter -> strict validateTranscribedSong -> serializeSongToGuitarDsl -> parseGuitarDsl
 * (zero error diagnostics required).
 */
export function convertAudioMirToGuitarDsl(result: AudioMirResultV1, title: string): AudioMirConversion {
  let candidate: TranscribedSong;
  try {
    candidate = adaptAudioMirResult(result, title);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'adapter failed' };
  }
  const validation = validateTranscribedSong(candidate);
  if (!validation.valid) {
    return { ok: false, error: validation.error };
  }
  let content: string;
  try {
    content = serializeSongToGuitarDsl(validation.song);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'serializer failed' };
  }
  const errors = parseGuitarDsl(content).diagnostics.filter(d => d.severity === 'error');
  if (errors.length > 0) {
    return { ok: false, error: `generated GuitarDSL has ${errors.length} error diagnostic(s)` };
  }
  return { ok: true, song: validation.song, content };
}
