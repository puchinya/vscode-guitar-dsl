import * as assert from 'assert';
import { parseGuitarDsl } from '../../src/compiler';
import { fadd, feq, frac, parseNoteValue, parseRhythmDuration, ZERO } from '../../src/duration';
import { MESSAGES_EN } from '../../src/i18n';
import { validateTranscribedSong } from '../../src/transcription/model';
import { AUDIO_MIR_SECTION_NAME, adaptAudioMirResult, convertAudioMirToGuitarDsl, strokeDirection } from '../../src/audioMir/adapter';
import { AudioMirController, AudioMirControllerDeps, AudioMirUi } from '../../src/audioMir/controller';
import { AudioMirMeasureV1, AudioMirResultV1 } from '../../src/audioMir/model';
import { validateAudioMirResult } from '../../src/audioMir/validate';
import {
  AudioMirJob,
  AudioMirJobOutcome,
  AudioMirWorkerLike,
  AudioMirWorkerSpec,
  inferenceWorkerCount,
  startAudioMirJob
} from '../../src/audioMir/workerClient';

function measure(index: number, overrides: Partial<AudioMirMeasureV1> = {}): AudioMirMeasureV1 {
  return {
    index,
    startSeconds: 1 + index * 2,
    endSeconds: 3 + index * 2,
    subdivision: 8,
    chords: [{ tick16: 0, name: 'Dmaj7', confidence: 0.8 }],
    attacks: [
      { slot: 0, strength: 1, accent: true },
      { slot: 2, strength: 0.5, accent: false },
      { slot: 3, strength: 0.4, accent: false }
    ],
    ...overrides
  };
}

function result(measures: AudioMirMeasureV1[] = [measure(0)]): AudioMirResultV1 {
  return {
    version: 1,
    source: { sampleRate: 44100, channels: 2, bitsPerSample: 16, durationSeconds: 20 },
    trim: { startSeconds: 1, endSeconds: 0.5 },
    tempo: { bpm: 119.6, confidence: 0.4 },
    key: { name: 'D', confidence: 0.7 },
    measures
  };
}

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

function chordBeats(durations: string[]) {
  return durations.reduce((acc, d) => fadd(acc, parseNoteValue(d)!.beats), ZERO);
}

function rhythmBeats(durations: string[]) {
  return durations.reduce((acc, d) => fadd(acc, parseRhythmDuration(d)!.beats), ZERO);
}

describe('audioMir validate', () => {
  it('accepts a valid result and returns a typed copy', () => {
    const v = validateAudioMirResult(clone(result()));
    assert.ok(v.valid);
    if (v.valid) {
      assert.deepStrictEqual(v.result, result());
    }
  });

  it('keeps the reported beat tracker', () => {
    for (const tracker of ['neural', 'classic'] as const) {
      const r = clone(result());
      r.tempo.tracker = tracker;
      const v = validateAudioMirResult(r);
      assert.ok(v.valid && v.result.tempo.tracker === tracker);
    }
  });

  const rejections: [string, (r: any) => void][] = [
    ['wrong version', r => { r.version = 2; }],
    ['empty measures', r => { r.measures = []; }],
    ['first chord not at tick 0', r => { r.measures[0].chords[0].tick16 = 4; }],
    ['non-increasing ticks', r => { r.measures[0].chords.push({ tick16: 0, name: 'D', confidence: 0.5 }); }],
    ['tick above 15', r => { r.measures[0].chords.push({ tick16: 16, name: 'D', confidence: 0.5 }); }],
    ['fractional tick', r => { r.measures[0].chords.push({ tick16: 7.5, name: 'D', confidence: 0.5 }); }],
    ['duplicate attack slot', r => { r.measures[0].attacks[2].slot = 2; }],
    ['attack slot outside the grid', r => { r.measures[0].attacks[2].slot = 8; }],
    ['non-finite confidence (null from NaN)', r => { r.measures[0].chords[0].confidence = null; }],
    ['non-finite bpm', r => { r.tempo.bpm = 'Infinity'; }],
    ['confidence above 1', r => { r.key.confidence = 1.5; }],
    ['negative strength', r => { r.measures[0].attacks[0].strength = -0.1; }],
    ['invalid chord name', r => { r.measures[0].chords[0].name = 'Dadd9'; }],
    ['non-canonical chord spelling', r => { r.measures[0].chords[0].name = 'Db'; }],
    ['invalid key', r => { r.key.name = 'H'; }],
    ['unsupported subdivision', r => { r.measures[0].subdivision = 6; }],
    ['non-increasing measure index', r => { r.measures.push({ ...r.measures[0] }); }],
    ['non-positive measure duration', r => { r.measures[0].endSeconds = r.measures[0].startSeconds; }],
    ['unsupported sample rate', r => { r.source.sampleRate = 22050; }],
    ['unknown beat tracker', r => { r.tempo.tracker = 'madmom'; }]
  ];
  for (const [name, mutate] of rejections) {
    it(`rejects ${name}`, () => {
      const r = clone(result()) as any;
      mutate(r);
      assert.strictEqual(validateAudioMirResult(r).valid, false);
    });
  }
});

describe('audioMir adapter', () => {
  it('produces one Analysis section with header metadata', () => {
    const song = adaptAudioMirResult(result([measure(0), measure(1)]), 'my song');
    assert.strictEqual(song.title, 'my song');
    assert.strictEqual(song.artist, undefined);
    assert.strictEqual(song.capo, 0);
    assert.strictEqual(song.key, 'D');
    assert.strictEqual(song.bpm, 120);
    assert.deepStrictEqual(song.timeSignature, { numerator: 4, denominator: 4 });
    assert.strictEqual(song.sections.length, 1);
    assert.strictEqual(song.sections[0].name, AUDIO_MIR_SECTION_NAME);
    assert.strictEqual(song.sections[0].measures.length, 2);
    assert.strictEqual(song.sections[0].measures[0].melody, undefined);
    assert.strictEqual(song.sections[0].measures[0].lyrics, undefined);
  });

  it('derives chord durations from tick16 boundaries and totals exactly 4 beats', () => {
    const tickSets = [[0], [0, 8], [0, 5], [0, 6, 10], [0, 1, 15], [0, 3, 7, 11]];
    for (const ticks of tickSets) {
      const m = measure(0, { chords: ticks.map(t => ({ tick16: t, name: 'C', confidence: 0.5 })) });
      const chords = adaptAudioMirResult(result([m]), 't').sections[0].measures[0].chords;
      assert.ok(feq(chordBeats(chords.map(c => c.duration)), frac(4)), `ticks ${ticks}`);
    }
    const half = adaptAudioMirResult(result([measure(0, {
      chords: [{ tick16: 0, name: 'F#sus4', confidence: 0.6 }, { tick16: 8, name: 'F#m', confidence: 0.6 }]
    })]), 't').sections[0].measures[0].chords;
    assert.deepStrictEqual(half, [{ name: 'F#sus4', duration: '2' }, { name: 'F#m', duration: '2' }]);
  });

  it('builds exact 4-beat rhythm for 8, 12 and 16 grids', () => {
    const grids: [8 | 12 | 16, number[]][] = [
      [8, [0, 2, 3, 5, 6, 7]],
      [8, [3]],
      [16, [0, 3, 4, 7, 8, 11, 12, 15]],
      [16, [1, 6, 13]],
      [12, [0, 1, 2, 3, 4, 5, 7, 8, 10]],
      [12, [2, 7]],
      [12, [0]]
    ];
    for (const [subdivision, slots] of grids) {
      const m = measure(0, { subdivision, attacks: slots.map(slot => ({ slot, strength: 0.5, accent: false })) });
      const rhythm = adaptAudioMirResult(result([m]), 't').sections[0].measures[0].rhythm;
      assert.ok(feq(rhythmBeats(rhythm.map(r => r.duration)), frac(4)), `grid ${subdivision} slots ${slots}`);
      const strokes = rhythm.filter(r => !r.duration.startsWith('r'));
      assert.strictEqual(strokes.length, slots.length);
    }
  });

  it('emits a leading rest, attack-to-next-attack spans and accents', () => {
    const m = measure(0, {
      subdivision: 8,
      attacks: [{ slot: 1, strength: 0.3, accent: false }, { slot: 4, strength: 1, accent: true }]
    });
    const rhythm = adaptAudioMirResult(result([m]), 't').sections[0].measures[0].rhythm;
    assert.deepStrictEqual(rhythm, [
      { duration: 'r8' },
      { duration: '4+8', direction: 'u' },
      { duration: '2', direction: 'd', accent: true }
    ]);
  });

  it('uses exactly r1 for a measure without attacks', () => {
    const m = measure(0, { attacks: [] });
    assert.deepStrictEqual(adaptAudioMirResult(result([m]), 't').sections[0].measures[0].rhythm, [{ duration: 'r1' }]);
  });

  it('uses triplet values for the 12-slot grid', () => {
    const m = measure(0, {
      subdivision: 12,
      attacks: [0, 1, 2, 5].map(slot => ({ slot, strength: 0.5, accent: false }))
    });
    const rhythm = adaptAudioMirResult(result([m]), 't').sections[0].measures[0].rhythm;
    assert.deepStrictEqual(rhythm.map(r => r.duration), ['8t', '8t', '4', '2+8t']);
    assert.deepStrictEqual(rhythm.map(r => r.direction), ['d', 'u', 'd', 'd']);
  });

  it('assigns stroke direction deterministically from the grid', () => {
    assert.deepStrictEqual([0, 1, 2, 3].map(s => strokeDirection(s, 8)), ['d', 'u', 'd', 'u']);
    assert.deepStrictEqual([0, 1, 2, 3].map(s => strokeDirection(s, 16)), ['d', 'u', 'd', 'u']);
    assert.deepStrictEqual([0, 1, 2, 3, 4, 5].map(s => strokeDirection(s, 12)), ['d', 'u', 'd', 'd', 'u', 'd']);
  });

  it('passes the strict validator unchanged (no auto-repair needed or used)', () => {
    const song = adaptAudioMirResult(result([
      measure(0),
      measure(1, { subdivision: 16, attacks: [3, 6, 11].map(slot => ({ slot, strength: 0.4, accent: false })) }),
      measure(2, { subdivision: 12, attacks: [] })
    ]), 'song');
    const strict = validateTranscribedSong(song);
    assert.ok(strict.valid, strict.valid ? '' : strict.error);
    if (strict.valid) {
      assert.deepStrictEqual(strict.song.sections, song.sections);
    }
  });

  it('serializes to GuitarDSL that reparses with zero errors, deterministically', () => {
    const r = result([
      measure(0),
      measure(1, {
        subdivision: 12,
        chords: [{ tick16: 0, name: 'F#sus4', confidence: 0.5 }, { tick16: 8, name: 'F#m', confidence: 0.6 }],
        attacks: [0, 2, 4, 7, 9].map(slot => ({ slot, strength: 0.5, accent: slot === 4 }))
      }),
      measure(2, { subdivision: 16, chords: [{ tick16: 0, name: 'C#m7', confidence: 0.7 }, { tick16: 5, name: 'Ebdim', confidence: 0.3 }] }),
      measure(3, { attacks: [] })
    ]);
    const a = convertAudioMirToGuitarDsl(r, 'song');
    const b = convertAudioMirToGuitarDsl(clone(r), 'song');
    assert.ok(a.ok, a.ok ? '' : a.error);
    if (a.ok && b.ok) {
      assert.strictEqual(a.content, b.content);
      assert.ok(a.content.includes('[Analysis]'));
      assert.ok(a.content.includes('F#sus4/2 F#m/2'));
      assert.ok(a.content.includes('C#m7/4+16 Ebdim/2+8.'));
      const errors = parseGuitarDsl(a.content).diagnostics.filter(d => d.severity === 'error');
      assert.deepStrictEqual(errors, []);
    }
  });
});

class FakeWorker implements AudioMirWorkerLike {
  terminateCalls = 0;
  posted: unknown[] = [];
  postMessage(value: unknown) {
    this.posted.push(value);
  }
  private listeners: Record<string, ((v: any) => void)[]> = {};
  on(event: string, listener: (v: any) => void) {
    (this.listeners[event] ??= []).push(listener);
    return this;
  }
  emit(event: string, value?: unknown) {
    for (const l of this.listeners[event] ?? []) {
      l(value);
    }
  }
  terminate() {
    this.terminateCalls++;
    return Promise.resolve(0);
  }
}

describe('audioMir workerClient', () => {
  it('settles once and ignores late messages', async () => {
    const w = new FakeWorker();
    const job = startAudioMirJob(() => w, { filePath: 'a.wav', wasmModulePath: 'm.js' });
    job.terminate();
    w.emit('message', { type: 'success', resultJson: '{}' });
    assert.deepStrictEqual(await job.promise, { type: 'cancelled' });
    assert.strictEqual(w.terminateCalls, 1);
  });

  it('maps unknown error codes and early exit to ANALYSIS_FAILED', async () => {
    const w1 = new FakeWorker();
    const j1 = startAudioMirJob(() => w1, { filePath: 'a', wasmModulePath: 'm' });
    w1.emit('message', { type: 'error', code: 'Error: at stack trace /home/user' });
    assert.deepStrictEqual(await j1.promise, { type: 'error', code: 'ANALYSIS_FAILED' });

    const w2 = new FakeWorker();
    const j2 = startAudioMirJob(() => w2, { filePath: 'a', wasmModulePath: 'm' });
    w2.emit('exit', 1);
    assert.deepStrictEqual(await j2.promise, { type: 'error', code: 'ANALYSIS_FAILED' });

    const w3 = new FakeWorker();
    const j3 = startAudioMirJob(() => w3, { filePath: 'a', wasmModulePath: 'm' });
    w3.emit('message', { type: 'error', code: 'NO_STABLE_BEAT' });
    assert.deepStrictEqual(await j3.promise, { type: 'error', code: 'NO_STABLE_BEAT' });
  });
});

/** Spawns fake workers per spec and exposes them for the pool tests. */
function pool() {
  const analysis = new FakeWorker();
  const infer: FakeWorker[] = [];
  const factory = (spec: AudioMirWorkerSpec) => {
    if (spec.kind === 'analysis') {
      return analysis;
    }
    const w = new FakeWorker();
    infer.push(w);
    return w;
  };
  return { analysis, infer, factory };
}

const chunk = (value: number, frames = 2) => new Float32Array(frames * 128).fill(value);
const lastTask = (w: FakeWorker) => w.posted[w.posted.length - 1] as { type: string; index: number; chunk: Float32Array };

describe('audioMir inference pool', () => {
  it('bounds the pool size by cores and chunk count', () => {
    assert.strictEqual(inferenceWorkerCount(1), 1);
    assert.strictEqual(inferenceWorkerCount(2), 1);
    assert.strictEqual(inferenceWorkerCount(3), 2);
    assert.strictEqual(inferenceWorkerCount(16), 2);
    assert.strictEqual(inferenceWorkerCount(NaN), 1);

    const p = pool();
    startAudioMirJob(p.factory, { filePath: 'a', wasmModulePath: 'm' }, { inferenceWorkers: 4 });
    p.analysis.emit('message', { type: 'chunks', chunks: [chunk(1), chunk(2)] });
    assert.strictEqual(p.infer.length, 2);
  });

  it('aggregates logits by chunk index regardless of completion order', async () => {
    const p = pool();
    const job = startAudioMirJob(p.factory, { filePath: 'a', wasmModulePath: 'm' }, { inferenceWorkers: 2 });
    p.analysis.emit('message', { type: 'chunks', chunks: [0, 1, 2, 3, 4].map(v => chunk(v)) });
    assert.strictEqual(p.infer.length, 2);
    assert.deepStrictEqual(p.infer.map(w => lastTask(w).index), [0, 1]);
    assert.strictEqual(lastTask(p.infer[0]).chunk[0], 0);
    // Worker 1 finishes first and takes chunk 2; worker 0 then takes 3; worker 1 takes 4.
    const reply = (w: FakeWorker, index: number) =>
      w.emit('message', { type: 'logits', index, logits: new Float32Array([index * 10, index * 10 + 1]) });
    reply(p.infer[1], 1);
    assert.strictEqual(lastTask(p.infer[1]).index, 2);
    reply(p.infer[0], 0);
    assert.strictEqual(lastTask(p.infer[0]).index, 3);
    reply(p.infer[1], 2);
    assert.strictEqual(lastTask(p.infer[1]).index, 4);
    reply(p.infer[1], 4);
    assert.strictEqual(p.analysis.posted.length, 0);
    reply(p.infer[0], 3);
    const input = p.analysis.posted[0] as { type: string; logits: Float32Array };
    assert.strictEqual(input.type, 'logits');
    assert.deepStrictEqual(Array.from(input.logits), [0, 1, 10, 11, 20, 21, 30, 31, 40, 41]);
    // The pool is released once every chunk is done; its exits are expected.
    assert.deepStrictEqual(p.infer.map(w => w.terminateCalls), [1, 1]);
    p.infer[0].emit('exit', 1);
    p.analysis.emit('message', { type: 'success', resultJson: '{"ok":1}' });
    assert.deepStrictEqual(await job.promise, { type: 'success', resultJson: '{"ok":1}' });
    assert.strictEqual(p.analysis.terminateCalls, 1);
  });

  it('sends empty logits straight back when there are no chunks', () => {
    const p = pool();
    startAudioMirJob(p.factory, { filePath: 'a', wasmModulePath: 'm' }, { inferenceWorkers: 4 });
    p.analysis.emit('message', { type: 'chunks', chunks: [] });
    assert.strictEqual(p.infer.length, 0);
    assert.strictEqual((p.analysis.posted[0] as { logits: Float32Array }).logits.length, 0);
  });

  it('cancellation terminates the analysis worker and every inference worker', async () => {
    const p = pool();
    const job = startAudioMirJob(p.factory, { filePath: 'a', wasmModulePath: 'm' }, { inferenceWorkers: 3 });
    p.analysis.emit('message', { type: 'chunks', chunks: [chunk(0), chunk(1), chunk(2)] });
    job.terminate();
    assert.deepStrictEqual(await job.promise, { type: 'cancelled' });
    assert.strictEqual(p.analysis.terminateCalls, 1);
    assert.deepStrictEqual(p.infer.map(w => w.terminateCalls), [1, 1, 1]);
    p.infer[0].emit('message', { type: 'logits', index: 0, logits: new Float32Array(2) });
    assert.strictEqual(p.analysis.posted.length, 0);
  });

  for (const [name, fail] of [
    ['an inference error code', (w: FakeWorker) => w.emit('message', { type: 'error', code: 'ANALYSIS_FAILED' })],
    ['an inference worker crash', (w: FakeWorker) => w.emit('error', new Error('boom'))],
    ['an early inference worker exit', (w: FakeWorker) => w.emit('exit', 1)],
    ['a malformed inference message', (w: FakeWorker) => w.emit('message', { type: 'logits', index: 7, logits: new Float32Array(2) })],
    ['a duplicate chunk index', (w: FakeWorker) => {
      w.emit('message', { type: 'logits', index: 0, logits: new Float32Array(2) });
      w.emit('message', { type: 'logits', index: 0, logits: new Float32Array(2) });
    }]
  ] as const) {
    it(`fails once with ANALYSIS_FAILED on ${name} and stops every worker`, async () => {
      const p = pool();
      const job = startAudioMirJob(p.factory, { filePath: 'a', wasmModulePath: 'm' }, { inferenceWorkers: 2 });
      p.analysis.emit('message', { type: 'chunks', chunks: [chunk(0), chunk(1), chunk(2)] });
      fail(p.infer[0]);
      assert.deepStrictEqual(await job.promise, { type: 'error', code: 'ANALYSIS_FAILED' });
      assert.strictEqual(p.analysis.terminateCalls, 1);
      assert.deepStrictEqual(p.infer.map(w => w.terminateCalls), [1, 1]);
      assert.strictEqual(p.analysis.posted.length, 0);
    });
  }

  it('rejects a malformed chunks message', async () => {
    const p = pool();
    const job = startAudioMirJob(p.factory, { filePath: 'a', wasmModulePath: 'm' });
    p.analysis.emit('message', { type: 'chunks', chunks: [[1, 2, 3]] });
    assert.deepStrictEqual(await job.promise, { type: 'error', code: 'ANALYSIS_FAILED' });
    assert.strictEqual(p.infer.length, 0);
  });
});

interface Harness {
  controller: AudioMirController;
  spawned: FakeWorker[];
  docs: string[];
  errors: string[];
  warnings: string[];
  logs: string[];
  cancel(): void;
  logDisposed(): boolean;
  pick: { scheme: string; fsPath: string } | undefined;
}

function harness(): Harness {
  const h: Partial<Harness> = { spawned: [], docs: [], errors: [], warnings: [], logs: [] };
  let cancelListener: (() => void) | undefined;
  let logDisposed = false;
  h.pick = { scheme: 'file', fsPath: '/Users/someone/Music/take one.wav' };
  const ui: AudioMirUi = {
    pickWav: async () => h.pick,
    withProgress: task => task({
      onCancellationRequested: listener => {
        cancelListener = listener;
        return { dispose: () => { cancelListener = undefined; } };
      }
    }),
    showWarning: m => h.warnings!.push(m),
    showError: m => h.errors!.push(m),
    openUntitledDocument: async content => { h.docs!.push(content); }
  };
  const deps: AudioMirControllerDeps = {
    ui,
    messages: MESSAGES_EN,
    log: line => h.logs!.push(line),
    disposeLog: () => { logDisposed = true; },
    fileSize: async () => 1000,
    startJob: (): AudioMirJob => {
      const w = new FakeWorker();
      h.spawned!.push(w);
      return startAudioMirJob(() => w, { filePath: 'x', wasmModulePath: 'y' });
    },
    now: () => 0
  };
  h.controller = new AudioMirController(deps);
  h.cancel = () => cancelListener?.();
  h.logDisposed = () => logDisposed;
  return h as Harness;
}

const tick = () => new Promise(resolve => setImmediate(resolve));

describe('audioMir controller', () => {
  it('opens exactly one unsaved document on success and logs no full path', async () => {
    const h = harness();
    const run = h.controller.run();
    await tick();
    assert.strictEqual(h.spawned.length, 1);
    h.spawned[0].emit('message', { type: 'success', resultJson: JSON.stringify(result()) });
    await run;
    assert.strictEqual(h.docs.length, 1);
    assert.ok(h.docs[0].startsWith('title: take one'));
    assert.strictEqual(h.errors.length, 0);
    assert.strictEqual(h.controller.isBusy, false);
    assert.ok(h.logs.some(l => l.includes('[take one.wav]') && l.includes('44100 Hz')));
    assert.ok(h.logs.every(l => !l.includes('/Users/someone')));
  });

  it('does not spawn a second worker while running', async () => {
    const h = harness();
    const first = h.controller.run();
    await tick();
    await h.controller.run();
    assert.strictEqual(h.spawned.length, 1);
    assert.deepStrictEqual(h.warnings, [MESSAGES_EN.audioMirBusy]);
    h.spawned[0].emit('message', { type: 'error', code: 'NO_STABLE_BEAT' });
    await first;
  });

  it('cancellation terminates once, ignores late success and allows a new run', async () => {
    const h = harness();
    const run = h.controller.run();
    await tick();
    h.cancel();
    h.spawned[0].emit('message', { type: 'success', resultJson: JSON.stringify(result()) });
    await run;
    assert.strictEqual(h.spawned[0].terminateCalls, 1);
    assert.strictEqual(h.docs.length, 0);
    assert.strictEqual(h.errors.length, 0);
    assert.strictEqual(h.controller.isBusy, false);

    const again = h.controller.run();
    await tick();
    assert.strictEqual(h.spawned.length, 2);
    h.spawned[1].emit('message', { type: 'success', resultJson: JSON.stringify(result()) });
    await again;
    assert.strictEqual(h.docs.length, 1);
  });

  it('worker failure reports one localized error, clears busy state and a next run works', async () => {
    const h = harness();
    const run = h.controller.run();
    await tick();
    h.spawned[0].emit('message', { type: 'error', code: 'UNSUPPORTED_SAMPLE_RATE' });
    await run;
    assert.deepStrictEqual(h.errors, [MESSAGES_EN.audioMirErrors.UNSUPPORTED_SAMPLE_RATE]);
    assert.strictEqual(h.docs.length, 0);
    assert.ok(h.logs.some(l => l.includes('failure: UNSUPPORTED_SAMPLE_RATE')));
    assert.strictEqual(h.controller.isBusy, false);

    const next = h.controller.run();
    await tick();
    h.spawned[1].emit('message', { type: 'success', resultJson: JSON.stringify(result()) });
    await next;
    assert.strictEqual(h.docs.length, 1);
  });

  it('creates no document on missing WASM runtime, crash or invalid result', async () => {
    const outcomes: unknown[] = [
      { type: 'error', code: 'AUDIO_MIR_RUNTIME_MISSING' },
      { type: 'success', resultJson: 'not json' },
      { type: 'success', resultJson: JSON.stringify({ ...result(), version: 2 }) }
    ];
    for (const outcome of outcomes) {
      const h = harness();
      const run = h.controller.run();
      await tick();
      h.spawned[0].emit('message', outcome);
      await run;
      assert.strictEqual(h.docs.length, 0);
      assert.strictEqual(h.errors.length, 1);
    }
    const h = harness();
    const run = h.controller.run();
    await tick();
    h.spawned[0].emit('error', new Error('boom'));
    await run;
    assert.strictEqual(h.docs.length, 0);
    assert.deepStrictEqual(h.errors, [MESSAGES_EN.audioMirErrors.ANALYSIS_FAILED]);
  });

  it('rejects non-file URIs before spawning a worker', async () => {
    const h = harness();
    h.pick = { scheme: 'vscode-remote', fsPath: '/remote/a.wav' };
    await h.controller.run();
    assert.strictEqual(h.spawned.length, 0);
    assert.deepStrictEqual(h.errors, [MESSAGES_EN.audioMirUnsupportedEnvironment]);
  });

  it('dispose terminates the active worker, closes the log and opens nothing', async () => {
    const h = harness();
    const run = h.controller.run();
    await tick();
    h.controller.dispose();
    h.spawned[0].emit('message', { type: 'success', resultJson: JSON.stringify(result()) });
    await run;
    assert.strictEqual(h.spawned[0].terminateCalls, 1);
    assert.ok(h.logDisposed());
    assert.strictEqual(h.docs.length, 0);
    await h.controller.run();
    assert.strictEqual(h.spawned.length, 1);
  });
});

describe('audioMir job outcome typing', () => {
  it('distinguishes cancelled from worker messages', () => {
    const o: AudioMirJobOutcome = { type: 'cancelled' };
    assert.strictEqual(o.type, 'cancelled');
  });
});
