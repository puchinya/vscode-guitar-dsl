// Parent/worker protocol for one Audio MIR job. Pure module independent of VS Code APIs.
//
// One job uses an analysis worker and a pool of Beat This! inference workers (#56):
//   analysis worker: WAV pass -> posts { type: 'chunks', chunks } (transferred buffers)
//   inference pool:  { type: 'infer', index, chunk } -> { type: 'logits', index, logits }
//   parent -> analysis worker: { type: 'logits', logits } (all chunks concatenated in order)
//   analysis worker: posts the final { type: 'success', resultJson } or { type: 'error', code }
// The parent thread only routes messages; all DSP and inference run in workers.

import { isAudioMirErrorCode } from './model';

/** `workerData` passed to the analysis worker entry point. */
export interface AudioMirWorkerRequest {
  filePath: string;
  wasmModulePath: string;
}

/** `workerData` passed to an inference worker. */
export interface AudioMirInferRequest {
  wasmModulePath: string;
}

export type AudioMirWorkerSpec =
  | { kind: 'analysis'; data: AudioMirWorkerRequest }
  | { kind: 'infer'; data: AudioMirInferRequest };

/** Final messages posted by the analysis worker. Only machine codes cross the boundary on failure. */
export type AudioMirWorkerMessage =
  | { type: 'success'; resultJson: string }
  | { type: 'error'; code: string };

/** Intermediate message of the analysis worker: the model input chunks in order. */
export interface AudioMirChunksMessage {
  type: 'chunks';
  chunks: Float32Array[];
}

/** Parent -> analysis worker: every chunk's logits concatenated in chunk order. */
export interface AudioMirLogitsInput {
  type: 'logits';
  logits: Float32Array;
}

/** Parent -> inference worker. */
export interface AudioMirInferTask {
  type: 'infer';
  index: number;
  chunk: Float32Array;
}

/** Inference worker -> parent. */
export type AudioMirInferMessage =
  | { type: 'logits'; index: number; logits: Float32Array }
  | { type: 'error'; code: string };

export type AudioMirJobOutcome = AudioMirWorkerMessage | { type: 'cancelled' };

/** Minimal surface of `worker_threads.Worker` used here (mockable in tests). */
export interface AudioMirWorkerLike {
  on(event: 'message', listener: (value: unknown) => void): unknown;
  on(event: 'error', listener: (err: Error) => void): unknown;
  on(event: 'exit', listener: (code: number) => void): unknown;
  postMessage?(value: unknown, transferList?: readonly ArrayBuffer[]): void;
  terminate(): Promise<number> | void;
}

export type AudioMirWorkerFactory = (spec: AudioMirWorkerSpec) => AudioMirWorkerLike;

export interface AudioMirJobOptions {
  /** Inference workers to run in parallel (at most the number of chunks). */
  inferenceWorkers?: number;
}

export interface AudioMirJob {
  /** Settles exactly once; later worker messages are ignored. */
  readonly promise: Promise<AudioMirJobOutcome>;
  /** Terminates every worker immediately and settles as `cancelled` if still pending. */
  terminate(): void;
}

/**
 * Maximum parallel inference workers. Each one peaks at about 500 MB (the model's attention
 * matrices over a 1500-frame chunk), so memory, not cores, sets the limit (#56).
 */
export const AUDIO_MIR_MAX_INFERENCE_WORKERS = 2;

/** `clamp(availableParallelism - 1, 1, 2)`: leave one core for the extension host. */
export function inferenceWorkerCount(availableParallelism: number): number {
  const n = Math.floor(availableParallelism) - 1;
  return Math.min(AUDIO_MIR_MAX_INFERENCE_WORKERS, Math.max(1, Number.isFinite(n) ? n : 1));
}

const FAILED: AudioMirWorkerMessage = { type: 'error', code: 'ANALYSIS_FAILED' };

function toFinal(v: Record<string, unknown>): AudioMirWorkerMessage | undefined {
  if (v.type === 'success' && typeof v.resultJson === 'string') {
    return { type: 'success', resultJson: v.resultJson };
  }
  if (v.type === 'error') {
    return { type: 'error', code: isAudioMirErrorCode(v.code) ? v.code : 'ANALYSIS_FAILED' };
  }
  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
}

export function startAudioMirJob(
  factory: AudioMirWorkerFactory,
  request: AudioMirWorkerRequest,
  options: AudioMirJobOptions = {}
): AudioMirJob {
  let settled = false;
  let resolveOutcome!: (outcome: AudioMirJobOutcome) => void;
  const promise = new Promise<AudioMirJobOutcome>(resolve => {
    resolveOutcome = resolve;
  });
  const alive = new Set<AudioMirWorkerLike>();
  const stop = (w: AudioMirWorkerLike) => {
    if (alive.delete(w)) {
      void Promise.resolve(w.terminate()).catch(() => undefined);
    }
  };
  const settle = (outcome: AudioMirJobOutcome) => {
    if (settled) {
      return;
    }
    settled = true;
    for (const w of [...alive]) {
      stop(w);
    }
    resolveOutcome(outcome);
  };
  const spawn = (spec: AudioMirWorkerSpec): AudioMirWorkerLike | undefined => {
    try {
      const w = factory(spec);
      alive.add(w);
      return w;
    } catch {
      settle(FAILED);
      return undefined;
    }
  };

  const analysis = spawn({ kind: 'analysis', data: request });
  if (!analysis) {
    return { promise, terminate: () => settle({ type: 'cancelled' }) };
  }
  let chunksSeen = false;

  const runInference = (chunks: Float32Array[]) => {
    const logits: (Float32Array | undefined)[] = new Array(chunks.length).fill(undefined);
    let done = 0;
    let next = 0;
    const pool: AudioMirWorkerLike[] = [];
    const deliver = () => {
      const total = logits.reduce((n, l) => n + (l?.length ?? 0), 0);
      const all = new Float32Array(total);
      let offset = 0;
      for (const l of logits) {
        all.set(l!, offset);
        offset += l!.length;
      }
      for (const w of pool) {
        stop(w);
      }
      analysis.postMessage?.({ type: 'logits', logits: all } satisfies AudioMirLogitsInput, [all.buffer as ArrayBuffer]);
    };
    const feed = (w: AudioMirWorkerLike) => {
      if (next < chunks.length) {
        const index = next++;
        const chunk = chunks[index];
        w.postMessage?.({ type: 'infer', index, chunk } satisfies AudioMirInferTask, [chunk.buffer as ArrayBuffer]);
      }
    };
    if (chunks.length === 0) {
      deliver();
      return;
    }
    const count = Math.max(1, Math.min(options.inferenceWorkers ?? 1, chunks.length));
    for (let i = 0; i < count && !settled; i++) {
      const w = spawn({ kind: 'infer', data: { wasmModulePath: request.wasmModulePath } });
      if (!w) {
        return;
      }
      pool.push(w);
      w.on('message', value => {
        if (settled || !alive.has(w)) {
          return;
        }
        const v = asRecord(value);
        if (v?.type === 'logits' && Number.isInteger(v.index) && v.logits instanceof Float32Array) {
          const index = v.index as number;
          if (index < 0 || index >= chunks.length || logits[index] !== undefined) {
            settle(FAILED);
            return;
          }
          logits[index] = v.logits;
          done++;
          if (done === chunks.length) {
            deliver();
          } else {
            feed(w);
          }
          return;
        }
        settle(v?.type === 'error' ? (toFinal(v) ?? FAILED) : FAILED);
      });
      w.on('error', () => settle(FAILED));
      w.on('exit', () => {
        // Exits after `stop` (all chunks done) are expected.
        if (alive.has(w)) {
          settle(FAILED);
        }
      });
      feed(w);
    }
  };

  analysis.on('message', value => {
    if (settled) {
      return;
    }
    const v = asRecord(value);
    if (v?.type === 'chunks' && !chunksSeen && Array.isArray(v.chunks) && v.chunks.every(c => c instanceof Float32Array)) {
      chunksSeen = true;
      runInference(v.chunks as Float32Array[]);
      return;
    }
    settle((v && toFinal(v)) ?? FAILED);
  });
  analysis.on('error', () => settle(FAILED));
  analysis.on('exit', () => settle(FAILED));
  return {
    promise,
    terminate: () => settle({ type: 'cancelled' })
  };
}
