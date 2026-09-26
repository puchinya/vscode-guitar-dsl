// Local quantitative evaluator for Audio MIR against a reference chord LAB file.
//
//   node scripts/evaluate-audio-mir.mjs <audio.wav> <reference.lab> [--bpm <reference-bpm>] [--json]
//
// LAB lines: "<start-seconds> <end-seconds> <chord>". Chords may be written as GuitarDSL-style
// names (Dmaj7, F#m, Bb7) or Harte syntax (D:maj7, F#:min, Bb:7); "N"/"X" mean no chord.
// Audio and LAB files are never committed unless demonstrably redistributable.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';

const TOLERANCE = 0.1;
const PITCH = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, Fb: 4, 'E#': 5, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11, Cb: 11, 'B#': 0 };
const SUFFIX_QUALITY = { '': 'maj', m: 'min', '7': '7', maj7: 'maj7', m7: 'min7', sus2: 'sus2', sus4: 'sus4', dim: 'dim', aug: 'aug' };
/**
 * Harte shorthand -> Audio MIR quality, MIREX-style reduction (approved evaluation rule,
 * Issue #52): extensions fold into the seventh level (9/11/13 -> 7, maj9/11/13 -> maj7,
 * min9/11/13 -> min7), sixths into the triad, dim7 into dim. hdim7, minmaj7 and interval
 * lists stay unsupported (root recall only). Keep in sync with examples/tune_harmony.rs.
 */
const HARTE_QUALITY = {
  maj: 'maj', maj6: 'maj', min: 'min', min6: 'min', '7': '7', '9': '7', '11': '7', '13': '7',
  maj7: 'maj7', maj9: 'maj7', maj11: 'maj7', maj13: 'maj7', min7: 'min7', min9: 'min7', min11: 'min7', min13: 'min7',
  sus2: 'sus2', sus4: 'sus4', dim: 'dim', dim7: 'dim', aug: 'aug'
};
/**
 * Major/minor class of a quality or Harte shorthand, following mir_eval `majmin`: only
 * labels that reduce to a major or minor triad count; dim, hdim7, aug, sus and power
 * chords are excluded (null). Approved evaluation rule, Issue #52.
 */
const TRIAD_CLASS = {
  maj: 'maj', maj6: 'maj', '6': 'maj', '7': 'maj', '9': 'maj', '11': 'maj', '13': 'maj',
  maj7: 'maj', maj9: 'maj', maj11: 'maj', maj13: 'maj',
  min: 'min', min6: 'min', min7: 'min', min9: 'min', min11: 'min', min13: 'min', minmaj7: 'min'
};

function usage() {
  console.error('usage: node scripts/evaluate-audio-mir.mjs <audio.wav> <reference.lab> [--bpm <n>] [--json]');
  process.exit(2);
}

/** `{ root, quality }`; quality is null when outside the Audio MIR vocabulary; null for no-chord. */
export function parseChord(label) {
  const clean = label.trim();
  if (clean === 'N' || clean === 'X' || clean === '') {
    return null;
  }
  const harte = clean.match(/^([A-G](?:#|b)?):?([^/]*)(?:\/.*)?$/);
  if (!harte) {
    return { root: null, quality: null };
  }
  const root = PITCH[harte[1]];
  const rest = harte[2];
  // Harte: drop added/omitted degrees "(...)"; a bare interval list "(1,5)" has no shorthand.
  const shorthand = clean.includes(':') ? (rest === '' ? 'maj' : rest.replace(/\(.*\)$/, '')) : null;
  const quality = shorthand !== null ? (HARTE_QUALITY[shorthand] ?? null) : (SUFFIX_QUALITY[rest] ?? null);
  const triad = TRIAD_CLASS[shorthand ?? quality] ?? null;
  return { root: root ?? null, quality, triad };
}

export function parseLab(text) {
  return text
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#'))
    .map(l => {
      const [s, e, ...label] = l.split(/\s+/);
      return { start: Number(s), end: Number(e), label: label.join(' ') };
    })
    .filter(seg => Number.isFinite(seg.start) && Number.isFinite(seg.end) && seg.end > seg.start);
}

/** Chord segments in seconds; ticks are placed linearly within each measure. */
function predictionSegments(result) {
  const segs = [];
  for (const m of result.measures) {
    const dur = m.endSeconds - m.startSeconds;
    m.chords.forEach((c, i) => {
      const endTick = i + 1 < m.chords.length ? m.chords[i + 1].tick16 : 16;
      segs.push({ start: m.startSeconds + (c.tick16 / 16) * dur, end: m.startSeconds + (endTick / 16) * dur, label: c.name });
    });
  }
  return segs;
}

function overlap(a, b) {
  return Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));
}

function changeTimes(segs) {
  const out = [];
  for (let i = 1; i < segs.length; i++) {
    const prev = parseChord(segs[i - 1].label);
    const cur = parseChord(segs[i].label);
    const same = prev && cur ? prev.root === cur.root && prev.quality === cur.quality : prev === cur;
    if (!same || Math.abs(segs[i].start - segs[i - 1].end) > 1e-6) {
      out.push(segs[i].start);
    }
  }
  return out;
}

function matchCount(ref, est) {
  const used = new Array(est.length).fill(false);
  let hits = 0;
  for (const r of ref) {
    let best = -1;
    for (let j = 0; j < est.length; j++) {
      if (!used[j] && Math.abs(est[j] - r) <= TOLERANCE && (best < 0 || Math.abs(est[j] - r) < Math.abs(est[best] - r))) {
        best = j;
      }
    }
    if (best >= 0) {
      used[best] = true;
      hits++;
    }
  }
  return hits;
}

export function evaluate(result, reference) {
  const pred = predictionSegments(result);
  let rootTotal = 0;
  let rootHit = 0;
  let exactTotal = 0;
  let exactHit = 0;
  let majminTotal = 0;
  let majminHit = 0;
  /** Reference quality -> estimated quality -> seconds (root-matched overlaps only). */
  const confusion = {};
  for (const ref of reference) {
    const r = parseChord(ref.label);
    if (!r || r.root === null) {
      continue;
    }
    const len = ref.end - ref.start;
    rootTotal += len;
    if (r.quality) {
      exactTotal += len;
    }
    if (r.triad) {
      majminTotal += len;
    }
    for (const p of pred) {
      const ov = overlap(ref, p);
      if (ov <= 0) {
        continue;
      }
      const e = parseChord(p.label);
      if (e && e.root === r.root) {
        rootHit += ov;
        if (r.quality && e.quality === r.quality) {
          exactHit += ov;
        }
        if (r.triad && e.triad === r.triad) {
          majminHit += ov;
        }
        const refQ = r.quality ?? 'other';
        confusion[refQ] ??= {};
        confusion[refQ][e.quality] = (confusion[refQ][e.quality] ?? 0) + ov;
      }
    }
  }
  const refChanges = changeTimes(reference);
  const estChanges = changeTimes(pred);
  const hits = matchCount(refChanges, estChanges);
  const precision = estChanges.length ? hits / estChanges.length : 0;
  const recall = refChanges.length ? hits / refChanges.length : 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
  return {
    rootRecall: rootTotal ? rootHit / rootTotal : 0,
    exactSupportedRecall: exactTotal ? exactHit / exactTotal : 0,
    majminRecall: majminTotal ? majminHit / majminTotal : 0,
    totals: { rootTotal, rootHit, exactTotal, exactHit, majminTotal, majminHit },
    confusion,
    change: { precision, recall, f1, reference: refChanges.length, estimated: estChanges.length, matched: hits }
  };
}

/** Relative tempo tolerance of Acc1 / Acc2 (Acc2 also accepts x1/3, x1/2, x2, x3). */
export const TEMPO_TOLERANCE = 0.04;

/** Aggregates `evaluate()` results over many excerpts (duration-weighted). */
export function createAccumulator() {
  const totals = { rootTotal: 0, rootHit: 0, exactTotal: 0, exactHit: 0, majminTotal: 0, majminHit: 0 };
  const change = { reference: 0, estimated: 0, matched: 0 };
  const confusion = {};
  const failures = {};
  const bpmErrors = [];
  const tempoHits = { acc1: 0, acc2: 0 };
  let excerpts = 0;
  return {
    /** `tempo` is `{ estimate, reference }` (BPM) when the reference tempo is known. */
    add(metrics, tempo) {
      excerpts++;
      for (const k of Object.keys(totals)) {
        totals[k] += metrics.totals[k];
      }
      change.reference += metrics.change.reference;
      change.estimated += metrics.change.estimated;
      change.matched += metrics.change.matched;
      for (const [ref, row] of Object.entries(metrics.confusion)) {
        confusion[ref] ??= {};
        for (const [est, sec] of Object.entries(row)) {
          confusion[ref][est] = (confusion[ref][est] ?? 0) + sec;
        }
      }
      if (tempo !== undefined) {
        const within = m => Math.abs(tempo.estimate / (tempo.reference * m) - 1) <= TEMPO_TOLERANCE;
        bpmErrors.push(Math.abs(tempo.estimate - tempo.reference));
        tempoHits.acc1 += within(1) ? 1 : 0;
        tempoHits.acc2 += [1 / 3, 1 / 2, 1, 2, 3].some(within) ? 1 : 0;
      }
    },
    /** A failed excerpt still counts: its whole reference duration is missed. */
    addFailure(code, reference) {
      excerpts++;
      failures[code] = (failures[code] ?? 0) + 1;
      const empty = evaluate({ measures: [] }, reference);
      for (const k of Object.keys(totals)) {
        totals[k] += empty.totals[k];
      }
      change.reference += empty.change.reference;
    },
    summary() {
      const ratio = (a, b) => (b ? a / b : 0);
      const precision = ratio(change.matched, change.estimated);
      const recall = ratio(change.matched, change.reference);
      const sorted = [...bpmErrors].sort((a, b) => a - b);
      return {
        excerpts,
        failures,
        rootRecall: ratio(totals.rootHit, totals.rootTotal),
        exactSupportedRecall: ratio(totals.exactHit, totals.exactTotal),
        majminRecall: ratio(totals.majminHit, totals.majminTotal),
        change: { precision, recall, f1: precision + recall ? (2 * precision * recall) / (precision + recall) : 0 },
        bpmMedianAbsError: sorted.length ? sorted[sorted.length >> 1] : undefined,
        tempoAcc1: sorted.length ? tempoHits.acc1 / sorted.length : undefined,
        tempoAcc2: sorted.length ? tempoHits.acc2 / sorted.length : undefined,
        confusion
      };
    }
  };
}

/** Human-readable summary lines shared by the set evaluators. */
export function formatSummary(summary, { confusion = true } = {}) {
  const pct = v => `${(v * 100).toFixed(1)}%`;
  const lines = [
    `chord root recall         ${pct(summary.rootRecall)}`,
    `exact chord recall        ${pct(summary.exactSupportedRecall)} (supported qualities)`,
    `maj/min recall            ${pct(summary.majminRecall)}`,
    `chord change (+-100 ms)   P ${pct(summary.change.precision)} R ${pct(summary.change.recall)} F1 ${pct(summary.change.f1)}`
  ];
  if (summary.bpmMedianAbsError !== undefined) {
    lines.push(`tempo median abs error    ${summary.bpmMedianAbsError.toFixed(2)} BPM`);
    lines.push(`tempo Acc1 / Acc2 (4%)    ${pct(summary.tempoAcc1)} / ${pct(summary.tempoAcc2)}`);
  }
  if (confusion) {
    lines.push('quality confusion (reference -> estimate, seconds, root-matched):');
    for (const [refQ, row] of Object.entries(summary.confusion).sort()) {
      const cells = Object.entries(row).sort((a, b) => b[1] - a[1]).map(([q, sec]) => `${q} ${sec.toFixed(0)}`).join(', ');
      lines.push(`  ${refQ.padEnd(6)} -> ${cells}`);
    }
  }
  return lines.join('\n');
}

export function analyzeInWorker(wavPath, modulePathOverride) {
  const modulePath = modulePathOverride ?? join(dirname(fileURLToPath(import.meta.url)), '..', 'media', 'audio-mir-wasm', 'guitardsl_audio_mir.js');
  const source = `
    const { parentPort, workerData } = require('node:worker_threads');
    const fs = require('node:fs');
    const wasm = require(workerData.modulePath);
    const bytes = fs.readFileSync(workerData.wavPath);
    const t0 = performance.now();
    try {
      const json = wasm.analyze_wav(bytes);
      parentPort.postMessage({ ok: true, json, elapsedMs: performance.now() - t0 });
    } catch (e) {
      parentPort.postMessage({ ok: false, code: typeof e === 'string' ? e : 'ANALYSIS_FAILED', elapsedMs: performance.now() - t0 });
    }`;
  return new Promise((resolve, reject) => {
    const w = new Worker(source, { eval: true, workerData: { wavPath, modulePath } });
    w.once('message', msg => {
      void w.terminate();
      resolve(msg);
    });
    w.once('error', reject);
  });
}

async function main() {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  const bpmIdx = args.indexOf('--bpm');
  const refBpm = bpmIdx >= 0 ? Number(args[bpmIdx + 1]) : undefined;
  const positional = args.filter((a, i) => !a.startsWith('--') && (bpmIdx < 0 || i !== bpmIdx + 1));
  if (positional.length !== 2) {
    usage();
  }
  const [wavPath, labPath] = positional;
  const reference = parseLab(readFileSync(labPath, 'utf-8'));
  const outcome = await analyzeInWorker(wavPath);
  const peakRssMiB = process.resourceUsage().maxRSS / 1024;
  if (!outcome.ok) {
    console.error(`analysis failed: ${outcome.code}`);
    process.exit(1);
  }
  const result = JSON.parse(outcome.json);
  const metrics = evaluate(result, reference);
  const report = {
    audioSeconds: result.source.durationSeconds,
    analysisMs: Math.round(outcome.elapsedMs),
    peakProcessRssMiB: Math.round(peakRssMiB),
    bpm: result.tempo.bpm,
    bpmAbsError: refBpm !== undefined && Number.isFinite(refBpm) ? Math.abs(result.tempo.bpm - refBpm) : undefined,
    key: result.key.name,
    measures: result.measures.length,
    ...metrics
  };
  if (json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  const pct = v => `${(v * 100).toFixed(1)}%`;
  console.log(`audio                     ${report.audioSeconds.toFixed(1)} s, analysis ${report.analysisMs} ms, peak process RSS ${report.peakProcessRssMiB} MiB`);
  console.log(`tempo                     ${report.bpm.toFixed(2)} BPM${report.bpmAbsError !== undefined ? ` (abs error ${report.bpmAbsError.toFixed(2)})` : ''}`);
  console.log(`key / measures            ${report.key} / ${report.measures}`);
  console.log(`chord root recall         ${pct(metrics.rootRecall)} (duration-weighted)`);
  console.log(`exact chord recall        ${pct(metrics.exactSupportedRecall)} (supported qualities, duration-weighted)`);
  console.log(`maj/min recall            ${pct(metrics.majminRecall)} (duration-weighted)`);
  console.log(`chord change (+-100 ms)   P ${pct(metrics.change.precision)} R ${pct(metrics.change.recall)} F1 ${pct(metrics.change.f1)} (${metrics.change.matched}/${metrics.change.reference} ref, ${metrics.change.estimated} est)`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(e => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  });
}
