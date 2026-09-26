// Deterministic multi-instrument evaluation set for Audio MIR (local only, never committed).
//
//   node scripts/generate-audio-mir-synth-set.mjs <out dir> [--count 72] [--seed 1] [--profile default|pulse]
//
// --count must be a multiple of BALANCE_UNIT (instruments x splits x band/no band) so that
// every instrument has exactly half of its songs with bass + drums in each split.
//
// `--profile pulse` (#56) generates drumless songs (no bass, no drums) in which every beat is
// struck (PULSE_PATTERNS), for tempo / beat evaluation where the quarter-note pulse must be
// present in the audio; --count must then be a multiple of PULSE_BALANCE_UNIT. The default
// profile's output does not depend on this option.
//
// Writes <out>/<id>.json (note events per part, rendered by
// scripts/render-audio-mir-synth-set.swift), <out>/<id>.lab (exact chord reference in
// GuitarDSL names) and <out>/meta.json (instrument, band flag and tune/report split).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const PITCH = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const QUALITY = {
  '': [0, 4, 7], m: [0, 3, 7], '7': [0, 4, 7, 10], maj7: [0, 4, 7, 11], m7: [0, 3, 7, 10],
  sus2: [0, 2, 7], sus4: [0, 5, 7], dim: [0, 3, 6], aug: [0, 4, 8]
};
/** GM programs for the chord part. */
export const INSTRUMENTS = [
  { name: 'piano', program: 0, sustained: false },
  { name: 'epiano', program: 4, sustained: false },
  { name: 'organ', program: 16, sustained: true },
  { name: 'strings', program: 48, sustained: true },
  { name: 'pad', program: 89, sustained: true },
  { name: 'guitar', program: 25, sustained: false }
];
/** Songs per balanced block: 6 instruments x 2 splits x 2 (with / without bass + drums). */
export const BALANCE_UNIT = INSTRUMENTS.length * 2 * 2;
/** Diatonic degrees `(semitones from tonic, qualities)` of a major key. */
const DEGREES = [
  [0, ['', 'maj7', 'sus2']], [2, ['m', 'm7']], [4, ['m', 'm7']], [5, ['', 'maj7']],
  [7, ['', '7', 'sus4']], [9, ['m', 'm7']], [11, ['dim']]
];
/** Comping patterns: hit positions in 16ths within one bar. */
const PATTERNS = {
  quarters: [0, 4, 8, 12],
  eighths: [0, 2, 4, 6, 8, 10, 12, 14],
  push: [0, 3, 6, 8, 11, 14],
  sixteenths: [0, 2, 3, 6, 8, 10, 11, 14],
  halves: [0, 8]
};
/** Pulse-profile patterns: every beat (16th positions 0, 4, 8, 12) is struck. */
const PULSE_PATTERNS = {
  quarters: [0, 4, 8, 12],
  eighths: [0, 2, 4, 6, 8, 10, 12, 14],
  strum: [0, 2, 4, 6, 8, 10, 11, 12, 14]
};
/** Songs per balanced pulse block: 6 instruments x 2 splits. */
export const PULSE_BALANCE_UNIT = INSTRUMENTS.length * 2;

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick(rand, list) {
  return list[Math.floor(rand() * list.length)];
}

function chordFor(rand, tonic) {
  if (rand() < 0.15) {
    // Chromatic chord with any quality, including aug.
    return { root: Math.floor(rand() * 12), quality: pick(rand, Object.keys(QUALITY)) };
  }
  const [offset, qualities] = pick(rand, DEGREES);
  return { root: (tonic + offset) % 12, quality: pick(rand, qualities) };
}

/** MIDI notes: inversion, optional open spread, optional low root doubling. */
function voicing(rand, root, quality) {
  // Close position within G3..F#4 (MIDI 55..66), then inverted / spread below.
  const notes = QUALITY[quality]
    .map(i => 48 + ((root + i) % 12))
    .map(n => (n < 55 ? n + 12 : n))
    .sort((a, b) => a - b);
  const inversion = Math.floor(rand() * 3);
  for (let i = 0; i < inversion; i++) {
    notes.push(notes.shift() + 12);
  }
  if (rand() < 0.3 && notes.length >= 3) {
    notes[1] += 12;
  }
  if (rand() < 0.4) {
    notes.unshift(48 + (root % 12));
  }
  return [...new Set(notes)].sort((a, b) => a - b);
}

export function generateSong(index, seed, profile = 'default') {
  const pulse = profile === 'pulse';
  const rand = mulberry32(seed * 100003 + index);
  const instrument = INSTRUMENTS[index % INSTRUMENTS.length];
  // Instruments cycle per song and splits alternate per cycle (see meta.split); bass + drums
  // go to exactly half of every instrument in every split: cycles {0,1} band, {2,3} no band, ...
  const cycle = Math.floor(index / INSTRUMENTS.length);
  const band = !pulse && Math.floor(cycle / 2) % 2 === 0;
  const bpm = Math.round(70 + rand() * 90);
  const beat = 60 / bpm;
  const bar = 4 * beat;
  const tonic = Math.floor(rand() * 12);
  const patterns = pulse ? PULSE_PATTERNS : PATTERNS;
  const pattern = pulse ? pick(rand, Object.keys(PULSE_PATTERNS)) : instrument.sustained ? 'halves' : pick(rand, Object.keys(PATTERNS));
  const bars = 16;
  const lead = bar; // one bar of drums (or silence) before the first chord
  const chords = [];
  for (let b = 0; b < bars; b++) {
    if (rand() < 0.3) {
      chords.push({ ...chordFor(rand, tonic), start: b * 16, len: 8 });
      chords.push({ ...chordFor(rand, tonic), start: b * 16 + 8, len: 8 });
    } else {
      chords.push({ ...chordFor(rand, tonic), start: b * 16, len: 16 });
    }
  }
  // Merge adjacent identical chords so the LAB has real changes only.
  const merged = [];
  for (const c of chords) {
    const last = merged[merged.length - 1];
    if (last && last.root === c.root && last.quality === c.quality) {
      last.len += c.len;
    } else {
      merged.push({ ...c });
    }
  }

  const s16 = beat / 4;
  const chordEvents = [];
  const bassEvents = [];
  const drumEvents = [];
  const lab = [];
  for (const c of merged) {
    const t0 = lead + c.start * s16;
    const t1 = t0 + c.len * s16;
    lab.push(`${t0.toFixed(4)} ${t1.toFixed(4)} ${PITCH[c.root]}${c.quality}`);
    const notes = voicing(rand, c.root, c.quality);
    const hits = [];
    for (let pos = c.start; pos < c.start + c.len; pos++) {
      if (patterns[pattern].includes(pos % 16)) {
        hits.push(pos);
      }
    }
    if (!hits.includes(c.start)) {
      hits.unshift(c.start);
    }
    hits.forEach((pos, i) => {
      const on = lead + pos * s16;
      const end = lead + (i + 1 < hits.length ? hits[i + 1] : c.start + c.len) * s16;
      const vel = 70 + Math.floor(rand() * 30);
      for (const n of notes) {
        chordEvents.push([on, 1, n, vel], [on + (end - on) * 0.92, 0, n, 0]);
      }
    });
    if (band) {
      const bassNote = 36 + (c.root % 12);
      for (let pos = c.start; pos < c.start + c.len; pos += 8) {
        const on = lead + pos * s16;
        bassEvents.push([on, 1, bassNote, 95], [on + 8 * s16 * 0.9, 0, bassNote, 0]);
      }
    }
  }
  if (band) {
    const total = (bars + 1) * 16;
    for (let pos = 0; pos < total; pos += 2) {
      const t = pos * s16;
      const inBar = pos % 16;
      const events = [[42, 60]];
      if (inBar === 0 || inBar === 8) events.push([36, 110]);
      if (inBar === 4 || inBar === 12) events.push([38, 100]);
      for (const [note, vel] of events) {
        drumEvents.push([t, 1, note, vel], [t + s16, 0, note, 0]);
      }
    }
  }
  const byTime = (a, b) => a[0] - b[0] || a[1] - b[1];
  const parts = [{ role: 'chords', bank: 'melodic', program: instrument.program, events: chordEvents.sort(byTime) }];
  if (band) {
    parts.push({ role: 'bass', bank: 'melodic', program: 33, events: bassEvents.sort(byTime) });
    parts.push({ role: 'drums', bank: 'percussion', program: 0, events: drumEvents.sort(byTime) });
  }
  const id = `s${String(index).padStart(3, '0')}`;
  return {
    spec: { id, bpm, seconds: lead + bars * bar + 1.5, parts },
    lab: lab.join('\n') + '\n',
    // Instruments cycle per song; alternate the split per cycle so every instrument is in both.
    meta: {
      id, instrument: instrument.name, band, bpm, pattern, ...(pulse ? { profile } : {}),
      split: Math.floor(index / INSTRUMENTS.length) % 2 === 0 ? 'tune' : 'report'
    }
  };
}

function main() {
  const args = process.argv.slice(2);
  const out = args.find((a, i) => !a.startsWith('--') && !['--count', '--seed', '--profile'].includes(args[i - 1]));
  if (!out) {
    console.error('usage: node scripts/generate-audio-mir-synth-set.mjs <out dir> [--count 72] [--seed 1] [--profile default|pulse]');
    process.exit(2);
  }
  const profileAt = args.indexOf('--profile');
  const profile = profileAt >= 0 ? args[profileAt + 1] : 'default';
  if (!['default', 'pulse'].includes(profile)) {
    console.error(`--profile must be default or pulse (got ${profile})`);
    process.exit(2);
  }
  const unit = profile === 'pulse' ? PULSE_BALANCE_UNIT : BALANCE_UNIT;
  const opt = name => {
    const i = args.indexOf(name);
    return i >= 0 ? Number(args[i + 1]) : undefined;
  };
  const count = opt('--count') ?? 72;
  if (!Number.isInteger(count) || count <= 0 || count % unit !== 0) {
    console.error(`--count must be a positive multiple of ${unit} (got ${count}) so every instrument is balanced across splits${profile === 'pulse' ? '' : ' and bass + drums go to exactly half of each instrument in each split'}`);
    process.exit(2);
  }
  const seed = opt('--seed') ?? 1;
  mkdirSync(out, { recursive: true });
  const meta = [];
  for (let i = 0; i < count; i++) {
    const song = generateSong(i, seed, profile);
    writeFileSync(join(out, `${song.spec.id}.json`), JSON.stringify(song.spec));
    writeFileSync(join(out, `${song.spec.id}.lab`), song.lab);
    meta.push(song.meta);
  }
  writeFileSync(join(out, 'meta.json'), JSON.stringify({ seed, count, ...(profile === 'pulse' ? { profile } : {}), songs: meta }, null, 2));
  console.log(`wrote ${count} songs to ${out}`);
}

if (process.argv[1] && process.argv[1].endsWith('generate-audio-mir-synth-set.mjs')) {
  main();
}
