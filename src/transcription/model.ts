// Music IR v1 data models, JSON schema and semantic validation for transcription.
// Pure module independent of VS Code APIs and Gemini SDK.

import { Fraction, NoteValuePart, ZERO, decomposeBeats, fadd, fcmp, feq, fnum, frac, fsub, isDyadic, parseNoteValue, parseRhythmDuration } from '../duration';
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
  arpeggio?: boolean;
}

export interface MelodyEvent {
  pitch: string;
  duration: string;
  tieToNext?: boolean;
  lyric?: string;
}

/** Schema of the baseline pass. Chords and rhythm are context only: the refinement passes replace them. */
export const MUSIC_IR_JSON_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string', description: 'Song title' },
    artist: { type: 'string', description: 'Artist name' },
    key: { type: 'string', description: 'Sounding (concert) key of the song, e.g. C, Am, G, F#m, Bb' },
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
                      name: { type: 'string', description: 'Sounding chord name (e.g. C, Am, G/B)' },
                      duration: { type: 'string', description: 'Note value duration, e.g. 1, 2, 4' }
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
                      direction: { type: 'string', enum: ['d', 'u'] }
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
              }
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

const FOUR_BEATS = frac(4, 1);
const MELODY_PITCH_RE = /^(?:r|[a-g][b#]?[0-9])$/;
export const MAX_CAPO = 12;

function durationPartToString(p: NoteValuePart): string {
  if (p.triplet) return `${p.base}t`;
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
    while (remN >= 4) { res.push({ base: 2, dotted: false, triplet: true }); remN -= 4; }
    while (remN >= 2) { res.push({ base: 4, dotted: false, triplet: true }); remN -= 2; }
    while (remN >= 1) { res.push({ base: 8, dotted: false, triplet: true }); remN -= 1; }
    return res;
  }
  return null;
}

/**
 * Converts a positive beat count into a GuitarDSL note value without dots, joined with '+'
 * (e.g. 1.5 -> "4+8", 4 -> "1"). A triplet remainder of 1/3 or 2/3 beat is appended as "8t" / "4t".
 * Valid both as a chord duration and as a rhythm duration. Returns null when not representable.
 */
export function beatsToDurationString(beats: Fraction): string | null {
  if (beats.n <= 0) return null;
  let dyadic = beats;
  let tripletTerm: string | undefined;
  if (!isDyadic(beats)) {
    const whole = frac(Math.floor(beats.n / beats.d));
    const rem = fsub(beats, whole);
    if (feq(rem, frac(1, 3))) tripletTerm = '8t';
    else if (feq(rem, frac(2, 3))) tripletTerm = '4t';
    else return null;
    dyadic = whole;
  }
  const terms: string[] = [];
  if (dyadic.n > 0) {
    const parts = decomposeBeats(dyadic);
    if (!parts) return null;
    for (const p of parts) {
      if (p.dotted) {
        terms.push(`${p.base}`, `${p.base * 2}`);
      } else {
        terms.push(`${p.base}`);
      }
    }
  }
  if (tripletTerm) terms.push(tripletTerm);
  return terms.join('+');
}

/**
 * Melody-only timing repair: pads a short measure with rests or trims a slight excess so that the
 * melody sums to exactly 4 beats. Chords and rhythm are never repaired.
 */
export function repairMelodyTiming(melody: MelodyEvent[]): MelodyEvent[] {
  const repaired = melody.map(m => ({ ...m }));
  let beats = ZERO;
  for (const m of repaired) {
    const v = parseNoteValue(m.duration);
    if (!v) return repaired;
    beats = fadd(beats, v.beats);
  }
  if (fcmp(beats, FOUR_BEATS) < 0) {
    const parts = decomposeToBeatsOrTriplets(fsub(FOUR_BEATS, beats));
    if (parts) {
      for (const p of parts) {
        repaired.push({ pitch: 'r', duration: durationPartToString(p) });
      }
    }
  } else if (fcmp(beats, FOUR_BEATS) > 0) {
    let excess = fsub(beats, FOUR_BEATS);
    while (fcmp(excess, ZERO) > 0 && repaired.length > 0) {
      const last = repaired[repaired.length - 1];
      const lastVal = parseNoteValue(last.duration);
      if (!lastVal) break;
      if (fcmp(lastVal.beats, excess) <= 0) {
        repaired.pop();
        excess = fsub(excess, lastVal.beats);
      } else {
        const parts = decomposeToBeatsOrTriplets(fsub(lastVal.beats, excess));
        if (parts && parts.length > 0) {
          last.duration = durationPartToString(parts[0]);
          for (let i = 1; i < parts.length; i++) {
            repaired.push({ pitch: last.pitch, duration: durationPartToString(parts[i]), tieToNext: last.tieToNext });
          }
        }
        break;
      }
    }
  }
  return repaired;
}

type Mode = 'strict' | 'baseline';

/**
 * Validates a parsed JSON payload into a semantically valid TranscribedSong.
 * Rejects invalid meters (non-4/4), out-of-range BPM, invalid chord names/durations,
 * and measures whose chord, rhythm or melody durations do not sum to exactly 4 beats.
 * Nothing is repaired: impossible data is rejected.
 */
export function validateTranscribedSong(data: unknown): ValidationResult {
  return validateSong(data, 'strict');
}

/**
 * Validates the baseline pass. Metadata, section/measure structure, melody and lyrics are checked;
 * melody timing is repaired with repairMelodyTiming. Baseline chords and rhythm are context only
 * (the refinement passes replace them), so they are dropped and every measure gets empty arrays.
 */
export function validateBaselineSong(data: unknown): ValidationResult {
  return validateSong(data, 'baseline');
}

function validateSong(data: unknown, mode: Mode): ValidationResult {
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

    const name = typeof secObj.name === 'string' && secObj.name.trim() ? secObj.name.trim() : `Section ${sIdx + 1}`;

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

      let normalizedChords: ChordEvent[] = [];
      let normalizedRhythm: RhythmEvent[] = [];
      if (mode === 'strict') {
        const chords = validateChords(measObj.chords, name, mIdx);
        if (typeof chords === 'string') return { valid: false, error: chords };
        normalizedChords = chords;
        const rhythm = validateRhythm(measObj.rhythm, name, mIdx);
        if (typeof rhythm === 'string') return { valid: false, error: rhythm };
        normalizedRhythm = rhythm;
      }

      // Melody: optional
      let normalizedMelody: MelodyEvent[] | undefined = undefined;
      if (Array.isArray(measObj.melody) && measObj.melody.length > 0) {
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
          if (!parseNoteValue(durStr)) {
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
          normalizedMelody.push(melEvent);
        }

        if (mode === 'baseline') {
          normalizedMelody = repairMelodyTiming(normalizedMelody);
        }

        let melodyBeats = ZERO;
        for (const m of normalizedMelody) {
          melodyBeats = fadd(melodyBeats, parseNoteValue(m.duration)!.beats);
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

  if (mode === 'strict' && typeof raw.capo === 'number' && Number.isInteger(raw.capo) && raw.capo >= 0 && raw.capo <= MAX_CAPO) {
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

function validateChords(value: unknown, section: string, mIdx: number): ChordEvent[] | string {
  if (!Array.isArray(value) || value.length === 0) {
    return `Measure ${mIdx + 1} in section '${section}' has no chords`;
  }
  let beats = ZERO;
  const chords: ChordEvent[] = [];
  for (let cIdx = 0; cIdx < value.length; cIdx++) {
    const rawChord = value[cIdx];
    if (!rawChord || typeof rawChord !== 'object') {
      return `Chord at index ${cIdx} in section '${section}', measure ${mIdx + 1} is invalid`;
    }
    const chordObj = rawChord as Record<string, unknown>;
    const chordName = typeof chordObj.name === 'string' ? chordObj.name.trim() : '';
    const chordDur = typeof chordObj.duration === 'string' ? chordObj.duration.trim() : '';
    if (!isValidChordName(chordName)) {
      return `Invalid chord name '${chordName}' in section '${section}', measure ${mIdx + 1}`;
    }
    const noteVal = parseNoteValue(chordDur);
    if (!noteVal) {
      return `Invalid chord duration '${chordDur}' for chord '${chordName}' in section '${section}', measure ${mIdx + 1}`;
    }
    beats = fadd(beats, noteVal.beats);
    chords.push({ name: chordName, duration: chordDur });
  }
  if (!feq(beats, FOUR_BEATS)) {
    return `Chord durations in section '${section}', measure ${mIdx + 1} total ${fnum(beats)} beats (expected 4)`;
  }
  return chords;
}

function validateRhythm(value: unknown, section: string, mIdx: number): RhythmEvent[] | string {
  if (!Array.isArray(value) || value.length === 0) {
    return `Measure ${mIdx + 1} in section '${section}' has no rhythm events`;
  }
  let beats = ZERO;
  const rhythm: RhythmEvent[] = [];
  for (let rIdx = 0; rIdx < value.length; rIdx++) {
    const rawRhythm = value[rIdx];
    if (!rawRhythm || typeof rawRhythm !== 'object') {
      return `Rhythm event at index ${rIdx} in section '${section}', measure ${mIdx + 1} is invalid`;
    }
    const rhythmObj = rawRhythm as Record<string, unknown>;
    const durStr = typeof rhythmObj.duration === 'string' ? rhythmObj.duration.trim() : '';
    const noteVal = parseRhythmDuration(durStr);
    if (!noteVal) {
      return `Invalid rhythm duration '${durStr}' in section '${section}', measure ${mIdx + 1}`;
    }
    beats = fadd(beats, noteVal.beats);

    const event: RhythmEvent = { duration: durStr };
    if (rhythmObj.direction === 'd' || rhythmObj.direction === 'u') {
      event.direction = rhythmObj.direction;
    }
    if (rhythmObj.accent === true) event.accent = true;
    if (rhythmObj.ghost === true) event.ghost = true;
    if (rhythmObj.tie === true) event.tie = true;
    if (rhythmObj.arpeggio === true) event.arpeggio = true;
    rhythm.push(event);
  }
  if (!feq(beats, FOUR_BEATS)) {
    return `Rhythm durations in section '${section}', measure ${mIdx + 1} total ${fnum(beats)} beats (expected 4)`;
  }
  return rhythm;
}
