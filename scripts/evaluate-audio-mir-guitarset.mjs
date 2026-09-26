// Timestamped Audio MIR evaluation on a local copy of GuitarSet (never committed).
//
//   node scripts/evaluate-audio-mir-guitarset.mjs <GuitarSet dir>
//        [--subset comp|solo|all] [--players 03,04,05] [--wasm <guitardsl_audio_mir.js>]
//        [--limit <n>] [--json]
//
// Expects <dir>/annotation/*.jams and <dir>/audio_mono-mic/<id>_mic.wav (Zenodo 3371780).
// The reference is the JAMS "performed" chord annotation (the second `chord` annotation;
// the first is the lead sheet) and the `tempo` annotation. `--wasm` lets the same script
// measure another build, e.g. the #50 baseline, for before/after comparison.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeInWorker, createAccumulator, evaluate, formatSummary } from './evaluate-audio-mir.mjs';

function usage() {
  console.error('usage: node scripts/evaluate-audio-mir-guitarset.mjs <GuitarSet dir> [--subset comp|solo|all] [--players 03,04,05] [--wasm <module.js>] [--limit <n>] [--json]');
  process.exit(2);
}

function option(args, name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

/** `{ chords: [{start,end,label}], bpm }` from a GuitarSet JAMS document. */
export function readJams(jams) {
  const chordAnnotations = jams.annotations.filter(a => a.namespace === 'chord');
  if (chordAnnotations.length === 0) {
    throw new Error('no chord annotation');
  }
  const performed = chordAnnotations[chordAnnotations.length > 1 ? 1 : 0];
  const chords = performed.data
    .map(o => ({ start: Number(o.time), end: Number(o.time) + Number(o.duration), label: String(o.value) }))
    .filter(c => Number.isFinite(c.start) && c.end > c.start);
  const tempo = jams.annotations.find(a => a.namespace === 'tempo');
  const bpm = tempo && tempo.data.length ? Number(tempo.data[0].value) : undefined;
  return { chords, bpm: Number.isFinite(bpm) ? bpm : undefined };
}

/** Lists GuitarSet excerpts: `{ id, player, kind, jamsPath, wavPath }`. */
export function listExcerpts(dir) {
  const annDir = join(dir, 'annotation');
  return readdirSync(annDir)
    .filter(f => f.endsWith('.jams'))
    .sort()
    .map(f => {
      const id = basename(f, '.jams');
      return {
        id,
        player: id.slice(0, 2),
        kind: id.endsWith('_comp') ? 'comp' : id.endsWith('_solo') ? 'solo' : 'other',
        jamsPath: join(annDir, f),
        wavPath: join(dir, 'audio_mono-mic', `${id}_mic.wav`)
      };
    });
}

async function main() {
  const args = process.argv.slice(2);
  const dir = args.find((a, i) => !a.startsWith('--') && !['--subset', '--players', '--wasm', '--limit'].includes(args[i - 1]));
  if (!dir || !existsSync(join(dir, 'annotation'))) {
    usage();
  }
  const subset = option(args, '--subset') ?? 'comp';
  const players = option(args, '--players')?.split(',').map(p => p.padStart(2, '0'));
  const wasm = option(args, '--wasm') ? resolve(option(args, '--wasm')) : undefined;
  const limit = Number(option(args, '--limit') ?? Infinity);
  const asJson = args.includes('--json');

  const excerpts = listExcerpts(dir)
    .filter(e => subset === 'all' || e.kind === subset)
    .filter(e => !players || players.includes(e.player))
    .slice(0, limit);

  const acc = createAccumulator();
  let analysisMs = 0;
  let audioSeconds = 0;
  for (const e of excerpts) {
    const ref = readJams(JSON.parse(readFileSync(e.jamsPath, 'utf-8')));
    const outcome = await analyzeInWorker(e.wavPath, wasm);
    analysisMs += outcome.elapsedMs;
    if (!outcome.ok) {
      acc.addFailure(outcome.code, ref.chords);
      continue;
    }
    const result = JSON.parse(outcome.json);
    audioSeconds += result.source.durationSeconds;
    acc.add(evaluate(result, ref.chords), ref.bpm !== undefined ? Math.abs(result.tempo.bpm - ref.bpm) : undefined);
  }
  const report = { subset, players: players ?? 'all', audioSeconds: Math.round(audioSeconds), analysisMs: Math.round(analysisMs), ...acc.summary() };
  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log(`excerpts                  ${report.excerpts} (${subset}, players ${Array.isArray(report.players) ? report.players.join(',') : 'all'}), failures ${JSON.stringify(report.failures)}`);
  console.log(`audio / analysis          ${report.audioSeconds} s / ${report.analysisMs} ms`);
  console.log(formatSummary(report));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(e => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  });
}
