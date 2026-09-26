// Music IR v1 data models, JSON schema and semantic validation for transcription.
// Pure module independent of VS Code APIs and Gemini SDK.

import { Fraction, NoteValuePart, ZERO, decomposeBeats, fadd, fcmp, feq, fnum, frac, fsub, TRIPLET, parseNoteValue, parseRhythmDuration } from '../duration';
import { parseKeySignature } from '../compiler';
import { isValidChordName } from '../chordDefinition';

export interface TranscribedSong {
  title?: string;
  artist?: string;
  capo?: number;
  key: string;
  bpm: number;
  timeSignature: { numerator: number; denominator: number };
  sections: Section[];
}

export interface Section {
  name: string;
  measures: Measure[];
}

export interface Measure {
  chords: ChordEvent[];
  rhythm: RhythmEvent[];
  melody?: MelodyEvent[];
  lyrics?: string | string[];
}

export interface ChordEvent {
  name: string;
  duration: string;
}

export interface RhythmEvent {
  duration: string;
  direction?: 'd' | 'u';
  accent?: boolean;
  ghost?: boolean;
  tie?: boolean;
}

export interface MelodyEvent {
  pitch: string;
  duration: string;
  tieToNext?: boolean;
  lyric?: string;
}

export const MUSIC_IR_JSON_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string', description: 'Song title' },
    artist: { type: 'string', description: 'Artist name' },
    key: { type: 'string', description: 'Musical key of the song, e.g. C, Am, G, F#m, Bb' },
    capo: { type: 'integer', description: 'Recommended capo fret number (0..7) to play with easy open guitar chords, or 0 if no capo' },
    bpm: { type: 'integer', description: 'Tempo in BPM (30..300). For upbeat 8-beat rock/pop songs, use the true full-time tempo (e.g. 160-220, where snare hits on beats 2 and 4), not half-time.' },
    timeSignature: {
      type: 'object',
      properties: {
        numerator: { type: 'integer', enum: [4] },
        denominator: { type: 'integer', enum: [4] }
      },
      required: ['numerator', 'denominator']
    },
    sections: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Section name (e.g. Intro, Verse, Chorus)' },
          measures: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                lyrics: { type: 'string', description: 'Lyrics sung or spoken in this measure, if any' },
                chords: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      name: { type: 'string', description: 'Chord name (e.g. C, Am, G/B)' },
                      duration: {
                        type: 'string',
                        description: 'Note value duration: "1" = whole note (lasts full 4-beat measure), "2" = half note (2 beats), "4" = quarter note (1 beat). The sum of chord durations in a measure must equal 4 beats. If there is only 1 chord in the measure, its duration MUST be "1".'
                      }
                    },
                    required: ['name', 'duration']
                  }
                },
                rhythm: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      duration: { type: 'string', description: 'Rhythm duration (e.g. 4, 8, 16, 8t, 4+8, r4)' },
                      direction: { type: 'string', enum: ['d', 'u'] },
                      accent: { type: 'boolean' },
                      ghost: { type: 'boolean' },
                      tie: { type: 'boolean', description: 'True if tied to next stroke (syncopation)' }
                    },
                    required: ['duration']
                  }
                },
                melody: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      pitch: { type: 'string', description: 'Melody pitch in lowercase with octave, e.g. c4, d#4, eb4, or r for rest' },
                      duration: { type: 'string', description: 'Note value duration, e.g. 4, 8, 16, 8t, 4.' },
                      tieToNext: { type: 'boolean' },
                      lyric: { type: 'string', description: 'Syllable lyric sung on this note, e.g. あ, さ, の, Play, me' }
                    },
                    required: ['pitch', 'duration']
                  }
                }
              },
              required: ['chords', 'rhythm']
            }
          }
        },
        required: ['name', 'measures']
      }
    }
  },
  required: ['key', 'bpm', 'timeSignature', 'sections']
};

export type ValidationResult =
  | { valid: true; song: TranscribedSong }
  | { valid: false; error: string };

export interface ValidationOptions {
  autoRepair?: boolean;
}

const FOUR_BEATS = frac(4, 1);
const MELODY_PITCH_RE = /^(?:r|[a-g][b#]?[0-9])$/;

function durationPartToString(p: NoteValuePart): string {
  if (p.tuplet) return `${p.base}t`;
  if (p.dotted) return `${p.base}.`;
  return `${p.base}`;
}

function decomposeToBeatsOrTriplets(beats: Fraction): NoteValuePart[] | null {
  const parts = decomposeBeats(beats);
  if (parts && parts.length > 0) {
    return parts;
  }
  if (beats.d === 3 && beats.n > 0) {
    const res: NoteValuePart[] = [];
    let remN = beats.n;
    while (remN >= 4) { res.push({ base: 2, dotted: false, tuplet: TRIPLET }); remN -= 4; }
    while (remN >= 2) { res.push({ base: 4, dotted: false, tuplet: TRIPLET }); remN -= 2; }
    while (remN >= 1) { res.push({ base: 8, dotted: false, tuplet: TRIPLET }); remN -= 1; }
    return res;
  }
  return null;
}

/**
 * Validates a parsed JSON payload into a semantically valid TranscribedSong.
 * Rejects invalid meters (non-4/4), out-of-range BPM, invalid chord names/durations,
 * and measures whose durations do not sum to exactly 4 beats.
 * When options.autoRepair is true, automatically pads short melody/rhythm measures with rests
 * or trims slight excesses to ensure exact 4-beat alignment.
 */
export function validateTranscribedSong(data: unknown, options?: ValidationOptions): ValidationResult {
  if (!data || typeof data !== 'object') {
    return { valid: false, error: 'Transcription data must be an object' };
  }

  const raw = data as Record<string, unknown>;

  // Time signature: v1 supports only 4/4
  if (!raw.timeSignature || typeof raw.timeSignature !== 'object') {
    return { valid: false, error: 'Missing timeSignature in transcription data' };
  }
  const ts = raw.timeSignature as Record<string, unknown>;
  if (ts.numerator !== 4 || ts.denominator !== 4) {
    return { valid: false, error: `Unsupported time signature ${ts.numerator}/${ts.denominator}: only 4/4 is supported` };
  }

  // BPM: integer 30..300
  if (typeof raw.bpm !== 'number' || !Number.isInteger(raw.bpm) || raw.bpm < 30 || raw.bpm > 300) {
    return { valid: false, error: `BPM must be an integer between 30 and 300 (received ${raw.bpm})` };
  }

  // Key: must be accepted by GuitarDSL
  if (typeof raw.key !== 'string' || parseKeySignature(raw.key) === null) {
    return { valid: false, error: `Invalid musical key: '${raw.key}'` };
  }

  // Sections: non-empty array
  if (!Array.isArray(raw.sections) || raw.sections.length === 0) {
    return { valid: false, error: 'Song must contain at least one section' };
  }

  const normalizedSections: Section[] = [];

  for (let sIdx = 0; sIdx < raw.sections.length; sIdx++) {
    const rawSection = raw.sections[sIdx];
    if (!rawSection || typeof rawSection !== 'object') {
      return { valid: false, error: `Section at index ${sIdx} is invalid` };
    }
    const secObj = rawSection as Record<string, unknown>;

    let name = typeof secObj.name === 'string' && secObj.name.trim() ? secObj.name.trim() : `Section ${sIdx + 1}`;

    if (!Array.isArray(secObj.measures) || secObj.measures.length === 0) {
      return { valid: false, error: `Section '${name}' must contain at least one measure` };
    }

    const normalizedMeasures: Measure[] = [];

    for (let mIdx = 0; mIdx < secObj.measures.length; mIdx++) {
      const rawMeasure = secObj.measures[mIdx];
      if (!rawMeasure || typeof rawMeasure !== 'object') {
        return { valid: false, error: `Measure ${mIdx + 1} in section '${name}' is invalid` };
      }
      const measObj = rawMeasure as Record<string, unknown>;

      // Chords: non-empty array
      if (!Array.isArray(measObj.chords) || measObj.chords.length === 0) {
        return { valid: false, error: `Measure ${mIdx + 1} in section '${name}' has no chords` };
      }

      let chordBeats = ZERO;
      const normalizedChords: ChordEvent[] = [];

      for (let cIdx = 0; cIdx < measObj.chords.length; cIdx++) {
        const rawChord = measObj.chords[cIdx];
        if (!rawChord || typeof rawChord !== 'object') {
          return { valid: false, error: `Chord at index ${cIdx} in section '${name}', measure ${mIdx + 1} is invalid` };
        }
        const chordObj = rawChord as Record<string, unknown>;
        const chordName = typeof chordObj.name === 'string' ? chordObj.name.trim() : '';
        let chordDur = typeof chordObj.duration === 'string' ? chordObj.duration.trim() : '';

        // If a measure has only 1 chord and the model specified duration "4" (meaning 4 beats),
        // normalize to note value "1" (whole note = 4 beats) so it is mathematically 4 beats.
        if (measObj.chords.length === 1 && chordDur === '4') {
          chordDur = '1';
        }

        if (!isValidChordName(chordName)) {
          return { valid: false, error: `Invalid chord name '${chordName}' in section '${name}', measure ${mIdx + 1}` };
        }

        const noteVal = parseNoteValue(chordDur);
        if (!noteVal) {
          return { valid: false, error: `Invalid chord duration '${chordDur}' for chord '${chordName}' in section '${name}', measure ${mIdx + 1}` };
        }

        chordBeats = fadd(chordBeats, noteVal.beats);
        normalizedChords.push({ name: chordName, duration: chordDur });
      }

      if (!feq(chordBeats, FOUR_BEATS) && options?.autoRepair) {
        if (normalizedChords.length === 1) {
          normalizedChords[0].duration = '1';
          chordBeats = FOUR_BEATS;
        } else if (fcmp(chordBeats, FOUR_BEATS) < 0) {
          const deficit = fsub(FOUR_BEATS, chordBeats);
          const lastChord = normalizedChords[normalizedChords.length - 1];
          const lastVal = parseNoteValue(lastChord.duration);
          if (lastVal) {
            const newBeats = fadd(lastVal.beats, deficit);
            const parts = decomposeToBeatsOrTriplets(newBeats);
            if (parts && parts.length > 0) {
              lastChord.duration = durationPartToString(parts[0]);
              chordBeats = FOUR_BEATS;
            }
          }
        }
      }

      if (!feq(chordBeats, FOUR_BEATS)) {
        return {
          valid: false,
          error: `Chord durations in section '${name}', measure ${mIdx + 1} total ${fnum(chordBeats)} beats (expected 4)`
        };
      }

      // Rhythm: non-empty array
      if (!Array.isArray(measObj.rhythm) || measObj.rhythm.length === 0) {
        return { valid: false, error: `Measure ${mIdx + 1} in section '${name}' has no rhythm events` };
      }

      let rhythmBeats = ZERO;
      const normalizedRhythm: RhythmEvent[] = [];

      for (let rIdx = 0; rIdx < measObj.rhythm.length; rIdx++) {
        const rawRhythm = measObj.rhythm[rIdx];
        if (!rawRhythm || typeof rawRhythm !== 'object') {
          return { valid: false, error: `Rhythm event at index ${rIdx} in section '${name}', measure ${mIdx + 1} is invalid` };
        }
        const rhythmObj = rawRhythm as Record<string, unknown>;
        const durStr = typeof rhythmObj.duration === 'string' ? rhythmObj.duration.trim() : '';

        const noteVal = parseRhythmDuration(durStr);
        if (!noteVal) {
          return { valid: false, error: `Invalid rhythm duration '${durStr}' in section '${name}', measure ${mIdx + 1}` };
        }

        rhythmBeats = fadd(rhythmBeats, noteVal.beats);

        const event: RhythmEvent = { duration: durStr };
        if (rhythmObj.direction === 'd' || rhythmObj.direction === 'u') {
          event.direction = rhythmObj.direction;
        }
        if (rhythmObj.accent === true) {
          event.accent = true;
        }
        if (rhythmObj.ghost === true) {
          event.ghost = true;
        }
        if (rhythmObj.tie === true) {
          event.tie = true;
        }
        normalizedRhythm.push(event);
      }

      if (!feq(rhythmBeats, FOUR_BEATS) && options?.autoRepair) {
        if (fcmp(rhythmBeats, FOUR_BEATS) < 0) {
          const deficit = fsub(FOUR_BEATS, rhythmBeats);
          const parts = decomposeToBeatsOrTriplets(deficit);
          if (parts && parts.length > 0) {
            for (const p of parts) {
              normalizedRhythm.push({
                duration: durationPartToString(p),
                direction: 'd'
              });
            }
            rhythmBeats = FOUR_BEATS;
          }
        } else {
          let excess = fsub(rhythmBeats, FOUR_BEATS);
          while (fcmp(excess, ZERO) > 0 && normalizedRhythm.length > 0) {
            const last = normalizedRhythm[normalizedRhythm.length - 1];
            const lastVal = parseRhythmDuration(last.duration);
            if (!lastVal) break;
            if (fcmp(lastVal.beats, excess) <= 0) {
              normalizedRhythm.pop();
              excess = fsub(excess, lastVal.beats);
            } else {
              const newBeats = fsub(lastVal.beats, excess);
              const parts = decomposeToBeatsOrTriplets(newBeats);
              if (parts && parts.length > 0) {
                last.duration = durationPartToString(parts[0]);
                excess = ZERO;
              }
              break;
            }
          }
          if (feq(excess, ZERO)) {
            rhythmBeats = FOUR_BEATS;
          }
        }
      }

      if (!feq(rhythmBeats, FOUR_BEATS)) {
        return {
          valid: false,
          error: `Rhythm durations in section '${name}', measure ${mIdx + 1} total ${fnum(rhythmBeats)} beats (expected 4)`
        };
      }

      // Melody: optional
      let normalizedMelody: MelodyEvent[] | undefined = undefined;
      if (Array.isArray(measObj.melody) && measObj.melody.length > 0) {
        let melodyBeats = ZERO;
        normalizedMelody = [];

        for (let melIdx = 0; melIdx < measObj.melody.length; melIdx++) {
          const rawMel = measObj.melody[melIdx];
          if (!rawMel || typeof rawMel !== 'object') {
            return { valid: false, error: `Melody note at index ${melIdx} in section '${name}', measure ${mIdx + 1} is invalid` };
          }
          const melObj = rawMel as Record<string, unknown>;
          const pitch = typeof melObj.pitch === 'string' ? melObj.pitch.trim() : '';
          const durStr = typeof melObj.duration === 'string' ? melObj.duration.trim() : '';

          if (!MELODY_PITCH_RE.test(pitch)) {
            return { valid: false, error: `Invalid melody pitch '${pitch}' in section '${name}', measure ${mIdx + 1}` };
          }

          const noteVal = parseNoteValue(durStr);
          if (!noteVal) {
            return { valid: false, error: `Invalid melody duration '${durStr}' in section '${name}', measure ${mIdx + 1}` };
          }
          const melEvent: MelodyEvent = {
            pitch,
            duration: durStr,
            tieToNext: melObj.tieToNext === true
          };
          if (typeof melObj.lyric === 'string' && melObj.lyric.trim().length > 0) {
            melEvent.lyric = melObj.lyric.trim();
          }

          melodyBeats = fadd(melodyBeats, noteVal.beats);
          normalizedMelody.push(melEvent);
        }

        if (!feq(melodyBeats, FOUR_BEATS) && options?.autoRepair) {
          if (fcmp(melodyBeats, FOUR_BEATS) < 0) {
            const deficit = fsub(FOUR_BEATS, melodyBeats);
            const parts = decomposeToBeatsOrTriplets(deficit);
            if (parts && parts.length > 0) {
              for (const p of parts) {
                normalizedMelody.push({
                  pitch: 'r',
                  duration: durationPartToString(p)
                });
              }
              melodyBeats = FOUR_BEATS;
            }
          } else {
            let excess = fsub(melodyBeats, FOUR_BEATS);
            while (fcmp(excess, ZERO) > 0 && normalizedMelody.length > 0) {
              const last = normalizedMelody[normalizedMelody.length - 1];
              const lastVal = parseNoteValue(last.duration);
              if (!lastVal) break;
              if (fcmp(lastVal.beats, excess) <= 0) {
                normalizedMelody.pop();
                excess = fsub(excess, lastVal.beats);
              } else {
                const newBeats = fsub(lastVal.beats, excess);
                const parts = decomposeToBeatsOrTriplets(newBeats);
                if (parts && parts.length > 0) {
                  last.duration = durationPartToString(parts[0]);
                  for (let i = 1; i < parts.length; i++) {
                    normalizedMelody.push({
                      pitch: last.pitch,
                      duration: durationPartToString(parts[i]),
                      tieToNext: last.tieToNext
                    });
                  }
                  excess = ZERO;
                }
                break;
              }
            }
            if (feq(excess, ZERO)) {
              melodyBeats = FOUR_BEATS;
            }
          }
        }

        if (!feq(melodyBeats, FOUR_BEATS)) {
          return {
            valid: false,
            error: `Melody durations in section '${name}', measure ${mIdx + 1} total ${fnum(melodyBeats)} beats (expected 4)`
          };
        }
      }

      const measure: Measure = {
        chords: normalizedChords,
        rhythm: normalizedRhythm
      };
      if (normalizedMelody) {
        measure.melody = normalizedMelody;
      }
      if (typeof measObj.lyrics === 'string' && measObj.lyrics.trim().length > 0) {
        measure.lyrics = measObj.lyrics.trim();
      }
      normalizedMeasures.push(measure);
    }

    normalizedSections.push({
      name,
      measures: normalizedMeasures
    });
  }

  const song: TranscribedSong = {
    key: (raw.key as string).trim(),
    bpm: raw.bpm as number,
    timeSignature: { numerator: 4, denominator: 4 },
    sections: normalizedSections
  };

  if (typeof raw.capo === 'number' && Number.isInteger(raw.capo) && raw.capo >= 0 && raw.capo <= 11) {
    song.capo = raw.capo;
  }
  if (typeof raw.title === 'string' && raw.title.trim()) {
    song.title = raw.title.trim();
  }
  if (typeof raw.artist === 'string' && raw.artist.trim()) {
    song.artist = raw.artist.trim();
  }

  return { valid: true, song };
}
