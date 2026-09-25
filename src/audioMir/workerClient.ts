// Parent/worker protocol for one Audio MIR job. Pure module independent of VS Code APIs.

import { isAudioMirErrorCode } from './model';

/** `workerData` passed to the worker entry point. */
export interface AudioMirWorkerRequest {
  filePath: string;
  wasmModulePath: string;
}

/** Messages posted by the worker. Only machine codes cross the boundary on failure. */
export type AudioMirWorkerMessage =
  | { type: 'success'; resultJson: string }
  | { type: 'error'; code: string };

export type AudioMirJobOutcome = AudioMirWorkerMessage | { type: 'cancelled' };

/** Minimal surface of `worker_threads.Worker` used here (mockable in tests). */
export interface AudioMirWorkerLike {
  on(event: 'message', listener: (value: unknown) => void): unknown;
  on(event: 'error', listener: (err: Error) => void): unknown;
  on(event: 'exit', listener: (code: number) => void): unknown;
  terminate(): Promise<number> | void;
}

export type AudioMirWorkerFactory = (request: AudioMirWorkerRequest) => AudioMirWorkerLike;

export interface AudioMirJob {
  /** Settles exactly once; later worker messages are ignored. */
  readonly promise: Promise<AudioMirJobOutcome>;
  /** Terminates the worker immediately and settles as `cancelled` if still pending. */
  terminate(): void;
}

function toMessage(value: unknown): AudioMirWorkerMessage {
  if (value && typeof value === 'object') {
    const v = value as Record<string, unknown>;
    if (v.type === 'success' && typeof v.resultJson === 'string') {
      return { type: 'success', resultJson: v.resultJson };
    }
    if (v.type === 'error') {
      return { type: 'error', code: isAudioMirErrorCode(v.code) ? v.code : 'ANALYSIS_FAILED' };
    }
  }
  return { type: 'error', code: 'ANALYSIS_FAILED' };
}

export function startAudioMirJob(factory: AudioMirWorkerFactory, request: AudioMirWorkerRequest): AudioMirJob {
  let settled = false;
  let resolveOutcome!: (outcome: AudioMirJobOutcome) => void;
  const promise = new Promise<AudioMirJobOutcome>(resolve => {
    resolveOutcome = resolve;
  });
  const worker = factory(request);
  let terminated = false;
  const stop = () => {
    if (!terminated) {
      terminated = true;
      void Promise.resolve(worker.terminate()).catch(() => undefined);
    }
  };
  const settle = (outcome: AudioMirJobOutcome) => {
    if (settled) {
      return;
    }
    settled = true;
    stop();
    resolveOutcome(outcome);
  };
  worker.on('message', value => settle(toMessage(value)));
  worker.on('error', () => settle({ type: 'error', code: 'ANALYSIS_FAILED' }));
  worker.on('exit', () => settle({ type: 'error', code: 'ANALYSIS_FAILED' }));
  return {
    promise,
    terminate: () => settle({ type: 'cancelled' })
  };
}
