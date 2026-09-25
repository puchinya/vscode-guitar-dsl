// worker_threads entry point: reads the WAV, loads the Node-target WASM module and runs
// `analyze_wav`. All DSP runs here, never on the extension-host thread.

import * as fs from 'fs';
import { parentPort, workerData } from 'worker_threads';
import { AUDIO_MIR_MAX_FILE_BYTES, AUDIO_MIR_RUNTIME_MISSING, isAudioMirErrorCode } from './model';
import type { AudioMirWorkerMessage, AudioMirWorkerRequest } from './workerClient';

interface AudioMirWasmModule {
  analyze_wav(bytes: Uint8Array): string;
}

function post(message: AudioMirWorkerMessage): void {
  parentPort?.postMessage(message);
}

function run(request: AudioMirWorkerRequest): AudioMirWorkerMessage {
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
    return { type: 'success', resultJson: wasm.analyze_wav(bytes) };
  } catch (e) {
    // wasm-bindgen rethrows the Rust error code string; panics surface as RuntimeError.
    return { type: 'error', code: isAudioMirErrorCode(e) ? e : 'ANALYSIS_FAILED' };
  }
}

post(run(workerData as AudioMirWorkerRequest));
