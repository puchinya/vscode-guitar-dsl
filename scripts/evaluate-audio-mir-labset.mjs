// Audio MIR evaluation on a local LAB set, e.g. the synthetic multi-instrument set from
// scripts/generate-audio-mir-synth-set.mjs + render-audio-mir-synth-set.swift.
//
//   node scripts/evaluate-audio-mir-labset.mjs <set dir> [--split tune|report|all]
//        [--wasm <guitardsl_audio_mir.js>] [--json]
//
// Expects <dir>/meta.json ({ songs: [{ id, instrument, bpm, split }] }) and, per song,
// <id>.wav and <id>.lab. Prints overall metrics and a per-instrument breakdown.
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeInWorker, createAccumulator, evaluate, formatSummary, parseLab } from './evaluate-audio-mir.mjs';

async function main() {
  const args = process.argv.slice(2);
  const opt = name => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const dir = args.find((a, i) => !a.startsWith('--') && !['--split', '--wasm'].includes(args[i - 1]));
  if (!dir) {
    console.error('usage: node scripts/evaluate-audio-mir-labset.mjs <set dir> [--split tune|report|all] [--wasm <module.js>] [--json]');
    process.exit(2);
  }
  const split = opt('--split') ?? 'report';
  const wasm = opt('--wasm') ? resolve(opt('--wasm')) : undefined;
  const meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf-8'));
  const songs = meta.songs.filter(s => split === 'all' || s.split === split);

  const overall = createAccumulator();
  const perInstrument = {};
  for (const song of songs) {
    const reference = parseLab(readFileSync(join(dir, `${song.id}.lab`), 'utf-8'));
    const group = (perInstrument[song.instrument] ??= createAccumulator());
    const outcome = await analyzeInWorker(join(dir, `${song.id}.wav`), wasm);
    if (!outcome.ok) {
      overall.addFailure(outcome.code, reference);
      group.addFailure(outcome.code, reference);
      continue;
    }
    const result = JSON.parse(outcome.json);
    const metrics = evaluate(result, reference);
    const bpmError = song.bpm !== undefined ? Math.abs(result.tempo.bpm - song.bpm) : undefined;
    overall.add(metrics, bpmError);
    group.add(metrics, bpmError);
  }

  const report = {
    split,
    overall: overall.summary(),
    instruments: Object.fromEntries(Object.entries(perInstrument).sort().map(([k, a]) => [k, a.summary()]))
  };
  if (args.includes('--json')) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  const pct = v => `${(v * 100).toFixed(1)}%`;
  console.log(`songs ${report.overall.excerpts} (${split}), failures ${JSON.stringify(report.overall.failures)}`);
  console.log(formatSummary(report.overall));
  console.log('per instrument:            root    exact   maj/min  change-F1  failures');
  for (const [name, s] of Object.entries(report.instruments)) {
    console.log(`  ${name.padEnd(22)}  ${pct(s.rootRecall).padStart(6)}  ${pct(s.exactSupportedRecall).padStart(6)}  ${pct(s.majminRecall).padStart(6)}   ${pct(s.change.f1).padStart(6)}    ${JSON.stringify(s.failures)}`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(e => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  });
}
