// Runtime structural validation of untrusted AudioMirResultV1 JSON coming out of WASM.
// Pure module independent of VS Code APIs.

import { AUDIO_MIR_CHORD_SUFFIXES, AUDIO_MIR_PITCH_NAMES, AudioMirResultV1 } from './model';

export type AudioMirValidation =
  | { valid: true; result: AudioMirResultV1 }
  | { valid: false; error: string };

const CHORD_NAMES = new Set<string>(
  AUDIO_MIR_PITCH_NAMES.flatMap(root => AUDIO_MIR_CHORD_SUFFIXES.map(suffix => `${root}${suffix}`))
);
const KEY_NAMES = new Set<string>(AUDIO_MIR_PITCH_NAMES.flatMap(root => [root, `${root}m`]));

class ValidationError extends Error {}

function fail(message: string): never {
  throw new ValidationError(message);
}

function obj(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(`${path} must be an object`);
  }
  return value as Record<string, unknown>;
}

function finite(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail(`${path} must be a finite number`);
  }
  return value;
}

function unit(value: unknown, path: string): number {
  const v = finite(value, path);
  if (v < 0 || v > 1) {
    fail(`${path} must be within [0, 1]`);
  }
  return v;
}

function int(value: unknown, path: string, min: number, max: number): number {
  const v = finite(value, path);
  if (!Number.isInteger(v) || v < min || v > max) {
    fail(`${path} must be an integer in ${min}..${max}`);
  }
  return v;
}

function oneOf<T>(value: unknown, allowed: readonly T[], path: string): T {
  if (!allowed.includes(value as T)) {
    fail(`${path} must be one of ${allowed.join(', ')}`);
  }
  return value as T;
}

function arr(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) {
    fail(`${path} must be an array`);
  }
  return value;
}

/**
 * Validates every AudioMirResultV1 boundary invariant and returns a fresh, typed copy
 * containing only the known fields.
 */
export function validateAudioMirResult(data: unknown): AudioMirValidation {
  try {
    const root = obj(data, 'result');
    if (root.version !== 1) {
      fail('version must be 1');
    }
    const source = obj(root.source, 'source');
    const trim = obj(root.trim, 'trim');
    const tempo = obj(root.tempo, 'tempo');
    const key = obj(root.key, 'key');

    const durationSeconds = finite(source.durationSeconds, 'source.durationSeconds');
    if (durationSeconds <= 0) {
      fail('source.durationSeconds must be positive');
    }
    const bpm = finite(tempo.bpm, 'tempo.bpm');
    if (bpm <= 0) {
      fail('tempo.bpm must be positive');
    }
    if (typeof key.name !== 'string' || !KEY_NAMES.has(key.name)) {
      fail(`key.name '${String(key.name)}' is not a supported key`);
    }
    const startTrim = finite(trim.startSeconds, 'trim.startSeconds');
    const endTrim = finite(trim.endSeconds, 'trim.endSeconds');
    if (startTrim < 0 || endTrim < 0) {
      fail('trim values must be non-negative');
    }

    const rawMeasures = arr(root.measures, 'measures');
    if (rawMeasures.length === 0) {
      fail('measures must not be empty');
    }

    let prevIndex = -1;
    const measures = rawMeasures.map((raw, i) => {
      const path = `measures[${i}]`;
      const m = obj(raw, path);
      const index = int(m.index, `${path}.index`, 0, Number.MAX_SAFE_INTEGER);
      if (index <= prevIndex) {
        fail(`${path}.index must be strictly increasing`);
      }
      prevIndex = index;
      const startSeconds = finite(m.startSeconds, `${path}.startSeconds`);
      const endSeconds = finite(m.endSeconds, `${path}.endSeconds`);
      if (!(endSeconds > startSeconds)) {
        fail(`${path} must have a positive duration`);
      }
      const subdivision = oneOf(m.subdivision, [8, 12, 16] as const, `${path}.subdivision`);

      const rawChords = arr(m.chords, `${path}.chords`);
      if (rawChords.length === 0) {
        fail(`${path}.chords must not be empty`);
      }
      let prevTick = -1;
      const chords = rawChords.map((rc, j) => {
        const cp = `${path}.chords[${j}]`;
        const c = obj(rc, cp);
        const tick16 = int(c.tick16, `${cp}.tick16`, 0, 15);
        if (j === 0 && tick16 !== 0) {
          fail(`${cp}.tick16 must be 0 for the first chord`);
        }
        if (tick16 <= prevTick) {
          fail(`${cp}.tick16 must be strictly increasing`);
        }
        prevTick = tick16;
        if (typeof c.name !== 'string' || !CHORD_NAMES.has(c.name)) {
          fail(`${cp}.name '${String(c.name)}' is not a supported chord`);
        }
        return { tick16, name: c.name, confidence: unit(c.confidence, `${cp}.confidence`) };
      });

      let prevSlot = -1;
      const attacks = arr(m.attacks, `${path}.attacks`).map((ra, j) => {
        const ap = `${path}.attacks[${j}]`;
        const a = obj(ra, ap);
        const slot = int(a.slot, `${ap}.slot`, 0, subdivision - 1);
        if (slot <= prevSlot) {
          fail(`${ap}.slot must be sorted and unique`);
        }
        prevSlot = slot;
        const strength = finite(a.strength, `${ap}.strength`);
        if (strength < 0) {
          fail(`${ap}.strength must be non-negative`);
        }
        if (typeof a.accent !== 'boolean') {
          fail(`${ap}.accent must be a boolean`);
        }
        return { slot, strength, accent: a.accent };
      });

      return { index, startSeconds, endSeconds, subdivision, chords, attacks };
    });

    const result: AudioMirResultV1 = {
      version: 1,
      source: {
        sampleRate: oneOf(source.sampleRate, [44100, 48000] as const, 'source.sampleRate'),
        channels: oneOf(source.channels, [1, 2] as const, 'source.channels'),
        bitsPerSample: oneOf(source.bitsPerSample, [16, 24] as const, 'source.bitsPerSample'),
        durationSeconds
      },
      trim: { startSeconds: startTrim, endSeconds: endTrim },
      tempo: { bpm, confidence: unit(tempo.confidence, 'tempo.confidence') },
      key: { name: key.name as string, confidence: unit(key.confidence, 'key.confidence') },
      measures
    };
    return { valid: true, result };
  } catch (e) {
    if (e instanceof ValidationError) {
      return { valid: false, error: e.message };
    }
    throw e;
  }
}
