// Development-only benchmark of one complete Audio MIR job through the extension's real
// worker orchestration (analysis worker + parallel Beat This! inference workers, #56).
// Requires `npm run build:audio-mir` and `npm run compile`. Usage:
//
//   node scripts/benchmark-audio-mir-job.mjs [<file.wav>] [--seconds 300] [--workers N]
//
// Without a WAV it renders a generated drumless strumming piece (44.1 kHz stereo 16-bit,
// default 300 s) into the OS temp directory. Prints wall time, tempo, measures, the worker
// count and the process peak RSS (which includes every worker thread).
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { availableParallelism, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { encodeWav } from './audio-mir-fixture.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { inferenceWorkerCount, startAudioMirJob } = require(join(root, 'out', 'audioMir', 'workerClient.js'));

const args = process.argv.slice(2);
const opt = name => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const positional = args.filter((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'));

/** Drumless strumming: down-strums on beats, quieter up-strums on off-beats, 4-chord loop. */
function renderStrumming(seconds, sr = 44100, bpm = 104) {
  const n = Math.floor(seconds * sr);
  const left = new Float64Array(n);
  const right = new Float64Array(n);
  const beat = 60 / bpm;
  const chords = [[48, 55, 60, 64], [45, 52, 57, 60], [41, 48, 53, 57], [43, 50, 55, 59]];
  const hz = m => 440 * 2 ** ((m - 69) / 12);
  for (let k = 0; (k + 0.5) * beat < seconds - 1; k++) {
    const bar = Math.floor(k / 4);
    for (const [offset, amp, decay, octave] of [[0, 0.08, 0.25, 0], [0.5, 0.03, 0.15, 12]]) {
      const t0 = 0.4 + (k + offset) * beat;
      const s0 = Math.floor(t0 * sr);
      const len = Math.min(n - s0, Math.floor(beat * sr));
      for (const m of chords[bar % 4]) {
        const f = hz(m + octave);
        for (let i = 0; i < len; i++) {
          const t = i / sr;
          const env = Math.min(1, t / 0.005) * Math.exp(-t / decay);
          const v = amp * env * (Math.sin(2 * Math.PI * f * t) + 0.5 * Math.sin(4 * Math.PI * f * t));
          left[s0 + i] += v;
          right[s0 + i] += 0.9 * v;
        }
      }
    }
  }
  return [left, right];
}

let wavPath = positional[0];
let tempDir;
if (!wavPath) {
  const seconds = Number(opt('--seconds') ?? 300);
  tempDir = mkdtempSync(join(tmpdir(), 'audio-mir-bench-'));
  wavPath = join(tempDir, `strumming-${seconds}s.wav`);
  writeFileSync(wavPath, encodeWav(renderStrumming(seconds), 44100));
}
const workers = Number(opt('--workers') ?? inferenceWorkerCount(availableParallelism()));
const scripts = {
  analysis: join(root, 'out', 'audioMir', 'worker.js'),
  infer: join(root, 'out', 'audioMir', 'inferWorker.js')
};
const wasmModulePath = join(root, 'media', 'audio-mir-wasm', 'guitardsl_audio_mir.js');

const started = performance.now();
const job = startAudioMirJob(
  spec => new Worker(scripts[spec.kind], { workerData: spec.data }),
  { filePath: wavPath, wasmModulePath },
  { inferenceWorkers: workers }
);
const outcome = await job.promise;
const elapsed = (performance.now() - started) / 1000;
if (tempDir) {
  rmSync(tempDir, { recursive: true, force: true });
}
if (outcome.type !== 'success') {
  console.error(`job failed: ${JSON.stringify(outcome)}`);
  process.exit(1);
}
const result = JSON.parse(outcome.resultJson);
const peakMb = process.resourceUsage().maxRSS / 1024;
console.log(`duration ${result.source.durationSeconds.toFixed(1)} s, inference workers ${workers}`);
console.log(`wall time ${elapsed.toFixed(2)} s, peak RSS ${peakMb.toFixed(0)} MB`);
console.log(`tempo ${result.tempo.bpm.toFixed(2)} BPM (confidence ${result.tempo.confidence.toFixed(2)}), measures ${result.measures.length}`);
