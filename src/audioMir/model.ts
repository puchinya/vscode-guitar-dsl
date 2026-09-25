// AudioMirResultV1: TypeScript mirror of the JSON returned by the Rust/WASM Audio MIR core.
// Pure module independent of VS Code APIs.

export type AudioMirSubdivision = 8 | 12 | 16;

export interface AudioMirChordV1 {
  /** 16th-note position in the measure (0..15); the first chord is at 0. */
  tick16: number;
  name: string;
  confidence: number;
}

export interface AudioMirAttackV1 {
  /** Grid slot (0..subdivision-1). */
  slot: number;
  strength: number;
  accent: boolean;
}

export interface AudioMirMeasureV1 {
  index: number;
  startSeconds: number;
  endSeconds: number;
  subdivision: AudioMirSubdivision;
  chords: AudioMirChordV1[];
  attacks: AudioMirAttackV1[];
}

export interface AudioMirResultV1 {
  version: 1;
  source: {
    sampleRate: 44100 | 48000;
    channels: 1 | 2;
    bitsPerSample: 16 | 24;
    durationSeconds: number;
  };
  trim: {
    startSeconds: number;
    endSeconds: number;
  };
  tempo: {
    bpm: number;
    confidence: number;
  };
  key: {
    name: string;
    confidence: number;
  };
  measures: AudioMirMeasureV1[];
}

/** Stable machine codes thrown by the Rust core. */
export const AUDIO_MIR_RUST_ERROR_CODES = [
  'INVALID_WAV',
  'UNSUPPORTED_FORMAT',
  'UNSUPPORTED_SAMPLE_RATE',
  'UNSUPPORTED_CHANNELS',
  'UNSUPPORTED_BIT_DEPTH',
  'AUDIO_TOO_LONG',
  'NO_STABLE_BEAT',
  'NO_COMPLETE_MEASURE',
  'ANALYSIS_FAILED'
] as const;

/** Extension-side code: the packaged WASM runtime could not be loaded. */
export const AUDIO_MIR_RUNTIME_MISSING = 'AUDIO_MIR_RUNTIME_MISSING';

export type AudioMirErrorCode = typeof AUDIO_MIR_RUST_ERROR_CODES[number] | typeof AUDIO_MIR_RUNTIME_MISSING;

export function isAudioMirErrorCode(value: unknown): value is AudioMirErrorCode {
  return value === AUDIO_MIR_RUNTIME_MISSING
    || (typeof value === 'string' && (AUDIO_MIR_RUST_ERROR_CODES as readonly string[]).includes(value));
}

/** Input limits shared by the controller (pre-check) and the worker. */
export const AUDIO_MIR_MAX_FILE_BYTES = 128 * 1024 * 1024;

/** Canonical pitch-class spellings used by Audio MIR chord and key names. */
export const AUDIO_MIR_PITCH_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'] as const;
export const AUDIO_MIR_CHORD_SUFFIXES = ['', 'm', '7', 'maj7', 'm7', 'sus2', 'sus4', 'dim', 'aug'] as const;
