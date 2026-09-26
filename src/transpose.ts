// Whole-song sounding transposition (docs/specs/guitardsl-syntax.md §4.5) and its composition with the
// capo-preserving transform (src/capo.ts). Pure module: no VS Code dependency. Source-preserving: only the
// changed value substrings (keys, chord names, pitches) are spliced; every other byte is kept.

import { chordKey, isValidChordName, splitChordKey } from './chordDefinition';
import { CapoTransformFailureCode, inferCapoForDsl, parseCapoValue, planCapoTransform, transposeChordName } from './capo';
import { ParsedScore, Pitch, parseGuitarDsl } from './compiler';
import { PitchStep } from './melody';

export const MIN_SEMITONES = -11;
export const MAX_SEMITONES = 11;

export type TransposeFailureCode =
  | 'sourceParseError'
  | 'invalidSemitones'
  | 'labeledChordVariant'
  | 'customDefinitionCollision'
  | 'untransposableChord'
  | 'untransposableKey'
  | 'pitchOutOfRange'
  | 'transformedParseError'
  | CapoTransformFailureCode;

/** Non-blocking notes. */
export type TransposeWarning = 'unusedChordDefinitions' | 'noCapoRecommendation';

export type CapoMode = { kind: 'keep' } | { kind: 'explicit'; capo: number } | { kind: 'recommended' };

export type TransposePlan =
  | {
      ok: true;
      semitones: number;
      text: string;
      /** Initial sounding key before / after (the `key:` value, `C` when absent). */
      sourceKey: string;
      targetKey: string;
      /** Source capo (null when invalid) and the capo after the plan. */
      sourceCapo: number | null;
      targetCapo: number | null;
      /** Written chord key in the source -> written chord key in the result. */
      chordMap: ReadonlyMap<string, string>;
      warnings: TransposeWarning[];
      /** Definition keys that are no longer used (never deleted). */
      unusedDefinitions: string[];
    }
  | { ok: false; code: TransposeFailureCode; detail?: string; stage?: 'transpose' | 'capo' };

const PITCH_NAMES = ['c', 'c#', 'd', 'eb', 'e', 'f', 'f#', 'g', 'ab', 'a', 'bb', 'b'];
const STEP_PC: Record<PitchStep, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };

export function isValidSemitones(n: number): boolean {
  return Number.isInteger(n) && n >= MIN_SEMITONES && n <= MAX_SEMITONES;
}

/** Key root moved by `semitones` in the canonical spelling, keeping the minor `m`; null when unparseable. */
export function transposeKeyName(key: string, semitones: number): string | null {
  const m = key.trim().match(/^([A-G][b#]?)(m?)$/);
  if (!m) return null;
  const root = transposeChordName(m[1], semitones);
  return root === null ? null : root + m[2];
}

/** Pitch moved by `semitones` (octave included), spelled with c c# d eb e f f# g ab a bb b; null outside octave 0..9. */
export function transposePitch(p: Pitch, semitones: number): Pitch | null {
  const abs = p.octave * 12 + STEP_PC[p.step] + p.alter + semitones;
  const octave = Math.floor(abs / 12);
  if (octave < 0 || octave > 9) return null;
  const name = PITCH_NAMES[((abs % 12) + 12) % 12];
  return { step: name[0] as PitchStep, alter: name[1] === '#' ? 1 : name[1] === 'b' ? -1 : 0, octave };
}

/** Key value without a trailing ` # comment` (header comments are not stripped by the parser yet, Issue #64). */
function keyValue(key: string): string {
  const comment = key.search(/\s+#/);
  return (comment >= 0 ? key.slice(0, comment) : key).trim();
}

function pitchName(p: Pitch): string {
  return p.step + (p.alter === 1 ? '#' : p.alter === -1 ? 'b' : '');
}

interface Edit {
  line: number;
  start: number;
  end: number;
  expected: string;
  text: string;
}

/** Applies column edits right to left per line, keeping every other byte (including CR/LF). */
function spliceEdits(text: string, edits: Edit[]): { ok: true; text: string } | { ok: false; detail: string } {
  const parts = text.split(/(\r?\n)/);
  const byLine = new Map<number, Edit[]>();
  for (const e of edits) {
    const line = parts[e.line * 2];
    if (line === undefined || line.slice(e.start, e.end) !== e.expected) {
      return { ok: false, detail: `line ${e.line + 1}: ${e.expected} not found` };
    }
    const list = byLine.get(e.line) ?? [];
    list.push(e);
    byLine.set(e.line, list);
  }
  for (const [line, list] of byLine) {
    let s = parts[line * 2];
    for (const e of [...list].sort((a, b) => b.start - a.start)) s = s.slice(0, e.start) + e.text + s.slice(e.end);
    parts[line * 2] = s;
  }
  return { ok: true, text: parts.join('') };
}

const KEY_INSERT_BEFORE = new Set(['bpm', 'tempo', 'time', 'time_signature', 'meter', 'feel', 'pickup']);

/** Inserts a header line before the first tempo/meter header, else before the body, else at the end. */
function insertHeaderLine(text: string, header: string, score: ParsedScore): string {
  const parts = text.split(/(\r?\n)/);
  const eol = parts[1] ?? '\n';
  const lines: string[] = [];
  const eols: string[] = [];
  for (let i = 0; i < parts.length; i += 2) {
    lines.push(parts[i]);
    eols.push(parts[i + 1] ?? '');
  }
  const anchor = (score.headerLines ?? []).find(h => KEY_INSERT_BEFORE.has(h.key))?.line ?? score.firstBodyLine;
  if (anchor !== undefined) {
    lines.splice(anchor, 0, header);
    eols.splice(anchor, 0, eol);
  } else if (lines.length === 1 && lines[0] === '') {
    lines[0] = header;
  } else {
    eols[lines.length - 1] = eol;
    lines.push(header);
    eols.push('');
  }
  return lines.map((l, i) => l + eols[i]).join('');
}

function writtenChordSequence(score: ParsedScore): string[] {
  return score.measures.flatMap(m => m.chords.map(c => chordKey(c.name, c.label)));
}

/** Sounding pitches in score order (melody notes, then each measure's inline notes). */
function pitchSequence(score: ParsedScore): Pitch[] {
  return score.measures.flatMap(m => [
    ...(m.melody ?? []).flatMap(n => (n.pitch ? [n.pitch] : [])),
    ...(m.isMeasureRepeat ? [] : m.rhythms).flatMap(r => (r.pitch ? [r.pitch] : []))
  ]);
}

function samePitch(a: Pitch, b: Pitch): boolean {
  return a.step === b.step && a.alter === b.alter && a.octave === b.octave;
}

/** Definitions whose name was used before and is no longer used after the change. */
function becameUnused(before: ParsedScore, after: ParsedScore): string[] {
  const used = (s: ParsedScore) => new Set(writtenChordSequence(s).map(k => splitChordKey(k).name));
  const was = used(before);
  const now = used(after);
  return before.chordDefinitions.filter(d => was.has(d.name) && !now.has(d.name)).map(d => chordKey(d.name, d.label));
}

/**
 * Plans a whole-song sounding transposition: initial `key:` values, every `@key`, written chord roots / slash
 * basses, `mel:` pitches and inline pitches move by `semitones`; nothing else changes (spec §4.5).
 * Never mutates anything; callers apply `text`.
 */
export function planSoundingTranspose(text: string, semitones: number): TransposePlan {
  const score = parseGuitarDsl(text);
  const sourceError = score.diagnostics.find(d => d.severity === 'error');
  if (sourceError) {
    return { ok: false, code: 'sourceParseError', detail: `line ${sourceError.line + 1}: ${sourceError.code}`, stage: 'transpose' };
  }
  if (!isValidSemitones(semitones)) return { ok: false, code: 'invalidSemitones', detail: String(semitones), stage: 'transpose' };
  const sourceCapo = parseCapoValue(score.capo);
  const identity = new Map(writtenChordSequence(score).map(k => [k, k] as [string, string]));
  if (semitones === 0) {
    return { ok: true, semitones, text, sourceKey: score.originalKey, targetKey: score.originalKey, sourceCapo, targetCapo: sourceCapo, chordMap: identity, warnings: [], unusedDefinitions: [] };
  }

  const lines = text.split(/\r?\n/);
  const edits: Edit[] = [];

  // Keys: every key / original_key header value and every @key value.
  let targetKey = score.originalKey;
  for (const h of score.headerLines ?? []) {
    if (h.key !== 'key' && h.key !== 'original_key') continue;
    const value = lines[h.line].slice(h.valueStart, h.valueEnd);
    const trimmed = value.trim();
    if (!trimmed) continue;
    const next = transposeKeyName(trimmed, semitones);
    if (next === null) return { ok: false, code: 'untransposableKey', detail: trimmed, stage: 'transpose' };
    const start = h.valueStart + (value.length - value.trimStart().length);
    edits.push({ line: h.line, start, end: start + trimmed.length, expected: trimmed, text: next });
    if (trimmed === keyValue(score.originalKey)) targetKey = next;
  }
  for (const ev of score.events) {
    if (ev.kind !== 'keyChange') continue;
    const next = transposeKeyName(ev.key, semitones);
    if (next === null) return { ok: false, code: 'untransposableKey', detail: ev.key, stage: 'transpose' };
    edits.push({ line: ev.line, start: ev.valueStart, end: ev.valueEnd, expected: ev.key, text: next });
  }

  // Chords: same safety rules as the capo transform (labeled variants, custom-definition collisions).
  const nameMap = new Map<string, string>();
  for (const tok of score.chordTokens ?? []) {
    if (tok.label !== undefined) return { ok: false, code: 'labeledChordVariant', detail: chordKey(tok.name, tok.label), stage: 'transpose' };
    if (!nameMap.has(tok.name)) {
      const target = transposeChordName(tok.name, semitones);
      if (target === null || !isValidChordName(target)) return { ok: false, code: 'untransposableChord', detail: tok.name, stage: 'transpose' };
      nameMap.set(tok.name, target);
    }
    const target = nameMap.get(tok.name)!;
    if (target !== tok.name) edits.push({ line: tok.line, start: tok.startCol, end: tok.endCol, expected: tok.name, text: target });
  }
  const unlabeledDefinitions = new Set(score.chordDefinitions.filter(d => d.label === undefined).map(d => d.name));
  for (const [from, to] of nameMap) {
    if (from !== to && unlabeledDefinitions.has(to)) {
      return { ok: false, code: 'customDefinitionCollision', detail: `${from} -> ${to}`, stage: 'transpose' };
    }
  }

  // Pitches: octave digits follow the inheritance of each sequence (mel: line / measure-line bar).
  const inherited = new Map<number, number>();
  for (const tok of score.pitchTokens ?? []) {
    const next = transposePitch(tok.pitch, semitones);
    if (next === null) return { ok: false, code: 'pitchOutOfRange', detail: `line ${tok.line + 1}`, stage: 'transpose' };
    // Inline notes start from the default octave 4; a mel: line always starts with a written octave.
    const prevOctave = inherited.get(tok.sequence) ?? (tok.kind === 'inline' ? 4 : undefined);
    const writeOctave = tok.explicitOctave || prevOctave !== next.octave;
    inherited.set(tok.sequence, next.octave);
    edits.push({
      line: tok.line,
      start: tok.startCol,
      end: tok.endCol,
      expected: lines[tok.line].slice(tok.startCol, tok.endCol),
      text: pitchName(next) + (writeOctave ? String(next.octave) : '')
    });
  }

  const spliced = spliceEdits(text, edits);
  if (!spliced.ok) return { ok: false, code: 'transformedParseError', detail: spliced.detail, stage: 'transpose' };
  let out = spliced.text;
  // Without a key header the sounding key is the default C: write the transposed key explicitly.
  if (!(score.headerLines ?? []).some(h => h.key === 'key' || h.key === 'original_key')) {
    targetKey = transposeKeyName(keyValue(score.originalKey), semitones) ?? score.originalKey;
    out = insertHeaderLine(out, `key: ${targetKey}`, score);
  }

  // Reparse: no errors, the mapped chord sequence, the transposed pitches and keys.
  const result = parseGuitarDsl(out);
  const newError = result.diagnostics.find(d => d.severity === 'error');
  if (newError) return { ok: false, code: 'transformedParseError', detail: `line ${newError.line + 1}: ${newError.code}`, stage: 'transpose' };
  const mapKey = (key: string) => {
    const { name, label } = splitChordKey(key);
    return chordKey(nameMap.get(name) ?? name, label);
  };
  const expectedChords = writtenChordSequence(score).map(mapKey);
  const actualChords = writtenChordSequence(result);
  if (expectedChords.length !== actualChords.length || expectedChords.some((k, i) => k !== actualChords[i])) {
    return { ok: false, code: 'transformedParseError', detail: 'chord sequence changed', stage: 'transpose' };
  }
  const expectedPitches = pitchSequence(score).map(p => transposePitch(p, semitones)!);
  const actualPitches = pitchSequence(result);
  if (expectedPitches.length !== actualPitches.length || expectedPitches.some((p, i) => !samePitch(p, actualPitches[i]))) {
    return { ok: false, code: 'transformedParseError', detail: 'pitch sequence changed', stage: 'transpose' };
  }
  const expectedKeys = score.measures.map(m => keyValue(m.context.key)).map(k => transposeKeyName(k, semitones) ?? k);
  if (result.measures.some((m, i) => keyValue(m.context.key) !== expectedKeys[i])) {
    return { ok: false, code: 'transformedParseError', detail: 'key changed unexpectedly', stage: 'transpose' };
  }

  const chordMap = new Map<string, string>();
  for (const key of new Set(writtenChordSequence(score))) chordMap.set(key, mapKey(key));
  const unusedDefinitions = becameUnused(score, result);
  return {
    ok: true,
    semitones,
    text: out,
    sourceKey: score.originalKey,
    targetKey,
    sourceCapo,
    targetCapo: sourceCapo,
    chordMap,
    warnings: unusedDefinitions.length > 0 ? ['unusedChordDefinitions'] : [],
    unusedDefinitions
  };
}

/**
 * Sounding transposition followed by a capo choice on the transposed source (keep / explicit / recommended),
 * applied with the existing capo-preserving planCapoTransform. The capo scoring is not duplicated here.
 */
export function planTransposeWithCapo(text: string, semitones: number, capoMode: CapoMode): TransposePlan {
  const transposed = planSoundingTranspose(text, semitones);
  if (!transposed.ok || capoMode.kind === 'keep') return transposed;

  let targetCapo: number;
  const warnings: TransposeWarning[] = [...transposed.warnings];
  if (capoMode.kind === 'explicit') {
    targetCapo = capoMode.capo;
  } else {
    const inference = inferCapoForDsl(transposed.text);
    if (inference === null) return { ok: false, code: 'invalidSourceCapo', detail: String(transposed.sourceCapo), stage: 'capo' };
    if (inference.recommendedCapo === undefined) {
      return { ...transposed, warnings: [...warnings, 'noCapoRecommendation'] };
    }
    targetCapo = inference.recommendedCapo;
  }

  const sourceCapo = parseCapoValue(parseGuitarDsl(transposed.text).capo);
  if (sourceCapo !== null && sourceCapo === targetCapo) return transposed;
  const capo = planCapoTransform(transposed.text, targetCapo);
  if (!capo.ok) return { ok: false, code: capo.code, detail: capo.detail, stage: 'capo' };

  const chordMap = new Map<string, string>();
  for (const [from, mid] of transposed.chordMap) chordMap.set(from, capo.chordMap.get(mid) ?? mid);
  const unusedDefinitions = Array.from(new Set([...transposed.unusedDefinitions, ...becameUnused(parseGuitarDsl(text), parseGuitarDsl(capo.text))]));
  if (unusedDefinitions.length > 0 && !warnings.includes('unusedChordDefinitions')) warnings.push('unusedChordDefinitions');
  return { ...transposed, text: capo.text, targetCapo, chordMap, warnings, unusedDefinitions };
}
