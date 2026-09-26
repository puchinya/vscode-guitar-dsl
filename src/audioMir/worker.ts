// worker_threads entry point of the analysis worker: reads the WAV, loads the Node-target
// WASM module, computes the Beat This! input and hands its chunks to the parent, runs the
// full feature pass while inference workers process the chunks, then decodes the result
// from the chunk logits the parent returns (#56). All DSP runs here or in inference
// workers, never on the extension-host thread.

import * as fs from 'fs';
import { parentPort, workerData } from 'worker_threads';
import { AUDIO_MIR_MAX_FILE_BYTES, AUDIO_MIR_RUNTIME_MISSING, isAudioMirErrorCode } from './model';
import type { AudioMirChunksMessage, AudioMirWorkerMessage, AudioMirWorkerRequest } from './workerClient';

interface AudioMirAnalysis {
  chunkCount(): number;
  chunk(index: number): Float32Array;
  releaseInput(): void;
  extract(bytes: Uint8Array): void;
  finish(logits: Float32Array): string;
  free(): void;
}

interface AudioMirWasmModule {
  Analysis: new (bytes: Uint8Array) => AudioMirAnalysis;
}

function post(message: AudioMirWorkerMessage | AudioMirChunksMessage, transfer: ArrayBuffer[] = []): void {
  parentPort?.postMessage(message, transfer);
}

function errorCode(e: unknown): string {
  // wasm-bindgen rethrows the Rust error code string; panics surface as RuntimeError.
  return isAudioMirErrorCode(e) ? e : 'ANALYSIS_FAILED';
}

function start(request: AudioMirWorkerRequest): { analysis: AudioMirAnalysis; bytes: Buffer } | AudioMirWorkerMessage {
  let wasm: AudioMirWasmModule;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    wasm = require(request.wasmModulePath) as AudioMirWasmModule;
  } catch {
    return { type: 'error', code: AUDIO_MIR_RUNTIME_MISSING };
  }
  let bytes: Buffer;
  try {
    if (fs.statSync(request.filePath).size > AUDIO_MIR_MAX_FILE_BYTES) {
      return { type: 'error', code: 'AUDIO_TOO_LONG' };
    }
    bytes = fs.readFileSync(request.filePath);
  } catch {
    return { type: 'error', code: 'INVALID_WAV' };
  }
  try {
    return { analysis: new wasm.Analysis(bytes), bytes };
  } catch (e) {
    return { type: 'error', code: errorCode(e) };
  }
}

const started = start(workerData as AudioMirWorkerRequest);
if ('type' in started) {
  post(started);
} else {
  const { analysis, bytes } = started;
  let extracted = false;
  try {
    const chunks: Float32Array[] = [];
    for (let i = 0; i < analysis.chunkCount(); i++) {
      chunks.push(analysis.chunk(i));
    }
    analysis.releaseInput();
    // Delivered only after the synchronous feature pass below has finished.
    parentPort?.once('message', (value: unknown) => {
      const v = value as { type?: unknown; logits?: unknown };
      try {
        if (!extracted || v?.type !== 'logits' || !(v.logits instanceof Float32Array)) {
          post({ type: 'error', code: 'ANALYSIS_FAILED' });
          return;
        }
        post({ type: 'success', resultJson: analysis.finish(v.logits) });
      } catch (e) {
        post({ type: 'error', code: errorCode(e) });
      } finally {
        analysis.free();
      }
    });
    post({ type: 'chunks', chunks }, chunks.map(c => c.buffer as ArrayBuffer));
    analysis.extract(bytes);
    extracted = true;
  } catch (e) {
    analysis.free();
    post({ type: 'error', code: errorCode(e) });
  }
}
