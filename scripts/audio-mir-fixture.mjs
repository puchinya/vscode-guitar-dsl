// Deterministic synthetic audio for Audio MIR smoke tests (no recorded audio).
// Mirrors the Rust end-to-end fixture: 120 BPM, 4/4, two pickup beats, then
// | Dmaj7 | C#m7 | F#sus4 F#m | twice, with clicks (accented + kick on beat 1).

const PITCH = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
export const BPM = 120;
const BEAT = 60 / BPM;
const BAR = 4 * BEAT;
const PICKUP_START = 0.5;
export const FIRST_BAR = PICKUP_START + 2 * BEAT;

export const BARS = [
  { segments: [['D', [0, 4, 7, 11], 0, 16]], grid: 8, slots: [0, 2, 3, 4, 6, 7] },
  { segments: [['C#', [0, 3, 7, 10], 0, 16]], grid: 16, slots: [0, 3, 4, 7, 8, 11, 12, 15] },
  { segments: [['F#', [0, 5, 7], 0, 8], ['F#', [0, 3, 7], 8, 16]], grid: 8, slots: [0, 2, 4, 5, 6] }
];

const midiHz = m => 440 * Math.pow(2, (m - 69) / 12);

function spreadVoicing(root, tones) {
  const out = [];
  for (const t of tones) {
    let m = 72 + ((root + t) % 12);
    if (out.length) {
      while (m < out[out.length - 1] + 3) {
        m += 12;
      }
    }
    out.push(m);
  }
  return out;
}

function ramp(dt) {
  return Math.min(1, Math.max(0, dt / 0.005));
}

function renderVoice(out, sr, v) {
  const first = Math.max(0, Math.floor(v.start * sr));
  const last = Math.min(out.length, Math.floor(v.end * sr));
  let next = 0;
  let lastAttack = null;
  let prevLevel = 0;
  for (let i = first; i < last; i++) {
    const t = i / sr;
    while (next < v.attacks.length && v.attacks[next] <= t) {
      prevLevel = lastAttack === null ? 0 : Math.exp(-(v.attacks[next] - lastAttack) / v.decay);
      lastAttack = v.attacks[next];
      next++;
    }
    let env = ramp(t - v.start) * ramp(v.end - t);
    if (v.attacks.length) {
      if (lastAttack === null) {
        continue;
      }
      const target = Math.exp(-(t - lastAttack) / v.decay);
      env *= prevLevel + (target - prevLevel) * ramp(t - lastAttack);
    }
    let s = 0;
    for (let h = 1; h <= v.harmonics; h++) {
      s += Math.sin(2 * Math.PI * v.freq * h * t) / h;
    }
    out[i] += v.amp * env * s;
  }
}

function addClicks(out, sr, count) {
  let seed = 0x12345678;
  for (let i = 0; i < count; i++) {
    const downbeat = (i + 2) % 4 === 0;
    const amp = downbeat ? 0.9 : 0.45;
    const start = Math.floor((PICKUP_START + i * BEAT) * sr);
    const noiseLen = Math.floor(0.012 * sr);
    const kickLen = Math.floor(0.09 * sr);
    for (let j = 0; j < Math.max(noiseLen, kickLen) && start + j < out.length; j++) {
      const t = j / sr;
      if (j < noiseLen) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        const noise = (seed >>> 8) / (1 << 24) * 2 - 1;
        out[start + j] += amp * noise * Math.exp(-t / 0.003);
      }
      if (downbeat) {
        out[start + j] += amp * 1.2 * Math.sin(2 * Math.PI * 55 * t) * Math.exp(-t / 0.015);
      }
    }
  }
}

/** Mono float samples of the fixture song. */
export function renderSong(sr = 44100) {
  const bars = [...BARS, ...BARS];
  const seconds = FIRST_BAR + bars.length * BAR + 1.2;
  const out = new Float64Array(Math.floor(seconds * sr));
  bars.forEach((bar, b) => {
    const barStart = FIRST_BAR + b * BAR;
    const attacks = bar.slots.map(s => barStart + (s * BAR) / bar.grid);
    for (const [rootName, tones, s16, e16] of bar.segments) {
      const s = barStart + (s16 * BAR) / 16;
      const e = barStart + (e16 * BAR) / 16;
      const segAttacks = attacks.filter(a => a >= s && a < e);
      const root = PITCH.indexOf(rootName);
      for (const m of spreadVoicing(root, tones)) {
        renderVoice(out, sr, { freq: midiHz(m), amp: 0.12, harmonics: 1, start: s, end: e, attacks: segAttacks, decay: 0.35 });
      }
      renderVoice(out, sr, { freq: midiHz(48 + root), amp: 0.04, harmonics: 2, start: s, end: e, attacks: [], decay: 1 });
    }
  });
  addClicks(out, sr, Math.floor((seconds - PICKUP_START - 0.3) / BEAT));
  return out;
}

/** 16-bit PCM RIFF/WAVE bytes. `channels` is an array of Float arrays. */
export function encodeWav(channels, sampleRate, bits = 16) {
  const n = Math.max(...channels.map(c => c.length));
  const bytesPerSample = bits / 8;
  const dataLen = n * channels.length * bytesPerSample;
  const buf = Buffer.alloc(44 + dataLen);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataLen, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(channels.length, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * channels.length * bytesPerSample, 28);
  buf.writeUInt16LE(channels.length * bytesPerSample, 32);
  buf.writeUInt16LE(bits, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(dataLen, 40);
  const max = 2 ** (bits - 1) - 1;
  let o = 44;
  for (let i = 0; i < n; i++) {
    for (const c of channels) {
      const v = Math.round(Math.max(-1, Math.min(1, c[i] ?? 0)) * max);
      buf.writeIntLE(v, o, bytesPerSample);
      o += bytesPerSample;
    }
  }
  return buf;
}
