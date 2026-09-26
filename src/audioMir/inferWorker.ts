// worker_threads entry point of a Beat This! inference worker (#56): loads the WASM module
// once and infers the chunks the parent sends, one message per chunk. Several of these run
// in parallel for one job; the model is optimized once per chunk length.

import { parentPort, workerData } from 'worker_threads';
import { AUDIO_MIR_RUNTIME_MISSING, isAudioMirErrorCode } from './model';
import type { AudioMirInferMessage, AudioMirInferRequest } from './workerClient';

/** Log-mel bands per model frame. */
const N_MELS = 128;

interface AudioMirBeatModel {
  infer(chunk: Float32Array): Float32Array;
}

interface AudioMirWasmModule {
  BeatModel: new (frames: number) => AudioMirBeatModel;
}

function post(message: AudioMirInferMessage, transfer: ArrayBuffer[] = []): void {
  parentPort?.postMessage(message, transfer);
}

let wasm: AudioMirWasmModule | undefined;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  wasm = require((workerData as AudioMirInferRequest).wasmModulePath) as AudioMirWasmModule;
} catch {
  post({ type: 'error', code: AUDIO_MIR_RUNTIME_MISSING });
}

const models = new Map<number, AudioMirBeatModel>();

parentPort?.on('message', (value: unknown) => {
  const v = value as { type?: unknown; index?: unknown; chunk?: unknown };
  if (!wasm || v?.type !== 'infer' || !Number.isInteger(v.index) || !(v.chunk instanceof Float32Array)) {
    post({ type: 'error', code: 'ANALYSIS_FAILED' });
    return;
  }
  try {
    const frames = v.chunk.length / N_MELS;
    let model = models.get(frames);
    if (!model) {
      model = new wasm.BeatModel(frames);
      models.set(frames, model);
    }
    const logits = model.infer(v.chunk);
    post({ type: 'logits', index: v.index as number, logits }, [logits.buffer as ArrayBuffer]);
  } catch (e) {
    post({ type: 'error', code: isAudioMirErrorCode(e) ? e : 'ANALYSIS_FAILED' });
  }
});
