/** Shared, pure model of a six-string guitar fretboard. */

export type GuitarString = 1 | 2 | 3 | 4 | 5 | 6;
export type TuningPreset = 'Standard' | 'Drop D' | 'DADGAD' | 'Open G' | 'Open D';
export type OpenPitches = readonly [number, number, number, number, number, number];

export interface Tuning {
  readonly preset?: TuningPreset;
  /** MIDI semitone coordinates, ordered from the 6th string to the 1st. */
  readonly openMidi: OpenPitches;
}

export type TuningParseResult =
  | { readonly ok: true; readonly tuning: Tuning }
  | { readonly ok: false; readonly reason: 'unknownPreset' | 'stringCount' | 'invalidPitch'; readonly detail: string };

export interface FretPosition {
  readonly string: GuitarString;
  /** Fret distance from the capo; zero is the capo position. */
  readonly fret: number;
}

export interface InstrumentModel {
  readonly tuning: Tuning;
  readonly capo: number;
  openStringPitches(): readonly number[];
  pitchAt(string: GuitarString, fret: number): number;
  positionsForPitch(pitch: number): readonly FretPosition[];
}

export const STRING_COUNT = 6;
export const MAX_FRET = 24;
export const MAX_CAPO = 12;

function immutableTuning(preset: TuningPreset, notes: [number, number, number, number, number, number]): Tuning {
  return Object.freeze({ preset, openMidi: Object.freeze(notes) as OpenPitches });
}

export const STANDARD_TUNING: Tuning = immutableTuning('Standard', [40, 45, 50, 55, 59, 64]);

const PRESETS: Readonly<Record<TuningPreset, Tuning>> = Object.freeze({
  Standard: STANDARD_TUNING,
  'Drop D': immutableTuning('Drop D', [38, 45, 50, 55, 59, 64]),
  DADGAD: immutableTuning('DADGAD', [38, 45, 50, 55, 57, 62]),
  'Open G': immutableTuning('Open G', [38, 43, 50, 55, 59, 62]),
  'Open D': immutableTuning('Open D', [38, 45, 50, 54, 57, 62]),
});

const PRESET_BY_NORMALIZED_NAME = new Map<string, Tuning>();
for (const [name, tuning] of Object.entries(PRESETS)) {
  PRESET_BY_NORMALIZED_NAME.set(normalizePresetName(name), tuning);
}

function normalizePresetName(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US');
}

const NATURAL_PITCH_CLASS: Readonly<Record<string, number>> = Object.freeze({ C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 });
const SCIENTIFIC_PITCH_RE = /^([A-Ga-g])([#b]?)([0-9])$/;

/** Convert a scientific note letter, octave and accidental to C4=60 semitone coordinates. */
export function pitchToMidi(step: string, octave: number, alter = 0): number {
  const normalizedStep = step.toUpperCase();
  if (!(normalizedStep in NATURAL_PITCH_CLASS) || !Number.isInteger(octave) || octave < 0 || octave > 9 ||
      !Number.isInteger(alter) || alter < -1 || alter > 1) {
    throw new RangeError('pitch must have a letter A-G, octave 0-9, and at most one accidental');
  }
  return (octave + 1) * 12 + NATURAL_PITCH_CLASS[normalizedStep] + alter;
}

/** Pitch class of an uppercase chord-note spelling such as C#, or null for an invalid spelling. */
export function noteNameToPitchClass(note: string): number | null {
  const match = /^([A-G])([#b]?)$/.exec(note);
  if (!match) return null;
  const alter = match[2] === '#' ? 1 : match[2] === 'b' ? -1 : 0;
  return ((pitchToMidi(match[1], 4, alter) % 12) + 12) % 12;
}

function parseScientificPitch(token: string): number | null {
  const match = SCIENTIFIC_PITCH_RE.exec(token);
  if (!match) return null;
  const accidental = match[2] === '#' ? 1 : match[2] === 'b' ? -1 : 0;
  return pitchToMidi(match[1], Number(match[3]), accidental);
}

export function parseTuningValue(raw: string): TuningParseResult {
  // Match the header comment rule: a # starts a comment only after whitespace.
  const value = raw.replace(/\s+#.*$/, '').trim();
  const preset = PRESET_BY_NORMALIZED_NAME.get(normalizePresetName(value));
  if (preset) return { ok: true, tuning: preset };

  if (!/\d/.test(value)) {
    return { ok: false, reason: 'unknownPreset', detail: value };
  }

  const tokens = value ? value.split(/\s+/) : [];
  const parsed = tokens.map(parseScientificPitch);
  const invalid = tokens.find((_, index) => parsed[index] === null);
  if (invalid !== undefined) return { ok: false, reason: 'invalidPitch', detail: invalid };
  if (parsed.length !== STRING_COUNT) {
    return { ok: false, reason: 'stringCount', detail: String(parsed.length) };
  }

  const openMidi = parsed as number[];
  const tuning: Tuning = Object.freeze({ openMidi: Object.freeze([...openMidi]) as unknown as OpenPitches });
  return { ok: true, tuning };
}

function assertIntegerInRange(value: number, min: number, max: number, label: string): void {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < min || value > max) {
    throw new RangeError(`${label} must be an integer from ${min} through ${max}`);
  }
}

function copyTuning(tuning: Tuning): Tuning {
  if (!tuning || !Array.isArray(tuning.openMidi) || tuning.openMidi.length !== STRING_COUNT ||
      tuning.openMidi.some(pitch => !Number.isFinite(pitch) || !Number.isInteger(pitch))) {
    throw new RangeError('tuning must contain six integer open-string pitches');
  }
  return Object.freeze({
    ...(tuning.preset === undefined ? {} : { preset: tuning.preset }),
    openMidi: Object.freeze([...tuning.openMidi]) as unknown as OpenPitches,
  });
}

export function createInstrumentModel(tuning: Tuning = STANDARD_TUNING, capo = 0): InstrumentModel {
  assertIntegerInRange(capo, 0, MAX_CAPO, 'capo');
  const immutable = copyTuning(tuning);
  const openStringPitches = Object.freeze(immutable.openMidi.map(pitch => pitch + capo));

  function validateString(string: GuitarString): void {
    assertIntegerInRange(string, 1, STRING_COUNT, 'string');
  }

  function validateFret(fret: number): void {
    assertIntegerInRange(fret, 0, MAX_FRET - capo, 'fret');
  }

  return Object.freeze({
    tuning: immutable,
    capo,
    openStringPitches: () => openStringPitches,
    pitchAt(string: GuitarString, fret: number): number {
      validateString(string);
      validateFret(fret);
      return immutable.openMidi[STRING_COUNT - string] + capo + fret;
    },
    positionsForPitch(pitch: number): readonly FretPosition[] {
      if (!Number.isFinite(pitch) || !Number.isInteger(pitch)) {
        throw new RangeError('pitch must be a finite integer');
      }
      const positions: FretPosition[] = [];
      for (let string = STRING_COUNT; string >= 1; string--) {
        const fret = pitch - immutable.openMidi[STRING_COUNT - string] - capo;
        if (fret >= 0 && fret <= MAX_FRET - capo) {
          positions.push(Object.freeze({ string: string as GuitarString, fret }));
        }
      }
      return Object.freeze(positions);
    },
  });
}
