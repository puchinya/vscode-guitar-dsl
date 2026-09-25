// Node smoke test of the packaged Node-target WASM boundary (media/audio-mir-wasm).
// Run after `npm run build:audio-mir`:  npm run test:audio-mir-wasm
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BARS, BPM, FIRST_BAR, encodeWav, renderSong } from './audio-mir-fixture.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const modulePath = join(root, 'media', 'audio-mir-wasm', 'guitardsl_audio_mir.js');
if (!existsSync(modulePath)) {
  console.error(`missing ${modulePath}; run "npm run build:audio-mir" first`);
  process.exit(1);
}
const require = createRequire(import.meta.url);
const wasm = require(modulePath);
// TypeScript mirror of AudioMirResultV1 and the adapter, loaded through tsx.
const { validateAudioMirResult } = await import('../src/audioMir/validate.ts');
const { convertAudioMirToGuitarDsl } = await import('../src/audioMir/adapter.ts');

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log(`ok - ${name}`);
}

const bytes = encodeWav([renderSong(44100)], 44100);
const started = performance.now();
const json = wasm.analyze_wav(bytes);
const elapsed = Math.round(performance.now() - started);
const result = JSON.parse(json);

check('result conforms to the TypeScript AudioMirResultV1 mirror', () => {
  const v = validateAudioMirResult(result);
  assert.ok(v.valid, v.valid ? '' : v.error);
});

check('source and tempo', () => {
  assert.equal(result.version, 1);
  assert.deepEqual(
    [result.source.sampleRate, result.source.channels, result.source.bitsPerSample],
    [44100, 1, 16]
  );
  assert.ok(Math.abs(result.tempo.bpm - BPM) <= 2, `bpm ${result.tempo.bpm}`);
  assert.ok(Math.abs(result.measures[0].startSeconds - FIRST_BAR) < 0.06, 'pickup beats are trimmed');
});

check('chords, half-bar change, subdivisions and attack slots', () => {
  const expectedChords = [['0:Dmaj7'], ['0:C#m7'], ['0:F#sus4', '8:F#m']];
  assert.ok(result.measures.length >= 5, `measures ${result.measures.length}`);
  result.measures.slice(0, 6).forEach((m, i) => {
    assert.deepEqual(m.chords.map(c => `${c.tick16}:${c.name}`), expectedChords[i % 3], `measure ${i}`);
    assert.equal(m.subdivision, BARS[i % 3].grid, `measure ${i} grid`);
    assert.deepEqual(m.attacks.map(a => a.slot), BARS[i % 3].slots, `measure ${i} slots`);
  });
});

check('adapter produces GuitarDSL without errors', () => {
  const conv = convertAudioMirToGuitarDsl(result, 'fixture');
  assert.ok(conv.ok, conv.ok ? '' : conv.error);
  assert.match(conv.content, /F#sus4\/2 F#m\/2/);
});

check('deterministic across calls', () => {
  assert.equal(wasm.analyze_wav(bytes), json);
});

check('stable machine error codes are thrown', () => {
  const code = input => {
    try {
      wasm.analyze_wav(input);
    } catch (e) {
      return e;
    }
    return 'no error';
  };
  assert.equal(code(Buffer.from('not a wav file')), 'INVALID_WAV');
  assert.equal(code(encodeWav([new Float64Array(22050)], 22050)), 'UNSUPPORTED_SAMPLE_RATE');
  assert.equal(code(encodeWav([new Float64Array(100), new Float64Array(100), new Float64Array(100)], 44100)), 'UNSUPPORTED_CHANNELS');
  assert.equal(code(encodeWav([new Float64Array(44100 * 6)], 44100)), 'NO_STABLE_BEAT');
});

console.log(`${passed} checks passed; analysis of ${(bytes.length / 88200).toFixed(1)} s audio took ${elapsed} ms`);
