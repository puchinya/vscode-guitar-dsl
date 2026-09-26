// Capo inference, playability scoring and capo-preserving source transformation (spec §4.1).
// Pure module: no VS Code, Webview, transcription or Audio MIR dependency. Other features may call
// inferCapo() with structured chord data; the GuitarDSL adapters below are thin wrappers over it.

import { NOTE_NAMES, parseChordName } from './chordDetect';
import { ChordVoicing, chordKey, isValidChordName, splitChordKey } from './chordDefinition';
import { getDefaultVoicing } from './chordPresets';
import { ParsedScore, parseGuitarDsl } from './compiler';

export const MIN_CAPO = 0;
export const MAX_CAPO = 12;

export type PlayabilityLevel = 'veryEasy' | 'easy' | 'moderate' | 'hard' | 'veryHard';

export interface PlayabilityResult {
  /** Ease score 0..100 (higher = easier). */
  score: number;
  level: PlayabilityLevel;
  /** Written target chords without a known voicing (scored as unknown). */
  unresolvedChords: string[];
}

export interface CapoChordOccurrence {
  /** Written chord name relative to the source capo; `name@label` marks a custom diagram variant. */
  name: string;
  /** Weight; defaults to 1. Non-positive counts are ignored. */
  count?: number;
}

export interface CapoInferenceInput {
  sourceCapo: number;
  chords: readonly CapoChordOccurrence[];
  /**
   * Actual voicings of the written chords (keyed by occurrence name), used only when scoring
   * the untransformed source capo. Other capo positions always use standard shapes.
   */
  currentVoicings?: ReadonlyMap<string, ChordVoicing>;
}

export type CapoUnsupportedReason = 'untransposableChord' | 'labeledChordVariant';

export interface CapoCandidate {
  capo: number;
  supported: boolean;
  /** Undefined when unsupported or when there are no chord occurrences. */
  playability?: PlayabilityResult;
  /** Source written name -> target written name (supported chords only). */
  chordMap: ReadonlyMap<string, string>;
  reason?: CapoUnsupportedReason;
}

export interface CapoInferenceResult {
  /** One candidate per capo MIN_CAPO..MAX_CAPO, in ascending order. */
  candidates: readonly CapoCandidate[];
  recommendedCapo?: number;
}

export function isValidCapo(capo: number): boolean {
  return Number.isInteger(capo) && capo >= MIN_CAPO && capo <= MAX_CAPO;
}

/** Parses a `capo:` header value; null when it is not an integer 0..12. */
export function parseCapoValue(raw: string): number | null {
  const text = raw.trim();
  if (!/^[0-9]+$/.test(text)) return null;
  const n = Number(text);
  return isValidCapo(n) ? n : null;
}

/**
 * Transposes a chord name by `semitones` (root and slash bass), spelled with NOTE_NAMES.
 * The quality suffix is kept as written. Null when the name cannot be parsed.
 */
export function transposeChordName(name: string, semitones: number): string | null {
  const parsed = parseChordName(name);
  if (!parsed) return null;
  if (parsed.bass !== undefined && parsed.bassPc === undefined) return null;
  const shift = ((Math.trunc(semitones) % 12) + 12) % 12;
  if (shift === 0) return name;
  const bassText = parsed.bass !== undefined ? `/${parsed.bass}` : '';
  const suffix = name.slice(parsed.root.length, name.length - bassText.length);
  const root = NOTE_NAMES[(parsed.rootPc + shift) % 12];
  const bass = parsed.bassPc !== undefined ? `/${NOTE_NAMES[(parsed.bassPc + shift) % 12]}` : '';
  return root + suffix + bass;
}

// ---------------------------------------------------------------------------
// Playability heuristic (the only copy of the formula)
// ---------------------------------------------------------------------------

export const UNKNOWN_CHORD_COST = 10;

/** Cost of one resolved voicing; undefined voicing = UNKNOWN_CHORD_COST. */
export function chordCost(voicing: ChordVoicing | undefined, isSlashChord: boolean): number {
  if (!voicing) return UNKNOWN_CHORD_COST;
  const numeric = voicing.frets.filter((f): f is number => f !== 'x');
  const positive = numeric.filter(f => f > 0);
  const frettedStrings = positive.length;
  const openStrings = numeric.filter(f => f === 0).length;
  const span = positive.length > 0 ? Math.max(...positive) - Math.min(...positive) : 0;
  const minFret = positive.length > 0 ? Math.min(...positive) : 0;
  const barreCount = voicing.barres.length;
  return 0.5 * frettedStrings
    + 2.5 * barreCount
    + 0.75 * Math.max(0, span - 2)
    + 0.25 * Math.max(0, minFret - 3)
    + (openStrings === 0 ? 1.5 : 0)
    + (isSlashChord ? 1 : 0);
}

export function levelForScore(score: number): PlayabilityLevel {
  if (score >= 85) return 'veryEasy';
  if (score >= 70) return 'easy';
  if (score >= 50) return 'moderate';
  if (score >= 30) return 'hard';
  return 'veryHard';
}

/** Ease score from the song difficulty cost. */
export function easeScore(difficultyCost: number): number {
  return Math.round(Math.min(100, Math.max(0, 100 - 10 * difficultyCost)));
}

/** Standard voicing: preset for the name, else the upper chord of a slash chord. */
function standardVoicing(name: string): ChordVoicing | undefined {
  const direct = getDefaultVoicing(name);
  if (direct) return direct;
  const slash = name.indexOf('/');
  return slash > 0 ? getDefaultVoicing(name.slice(0, slash)) : undefined;
}

function isSlashName(name: string): boolean {
  return parseChordName(name)?.bass !== undefined;
}

function assertValidCapo(capo: number, what: string): void {
  if (!isValidCapo(capo)) {
    throw new RangeError(`${what} must be an integer ${MIN_CAPO}..${MAX_CAPO}: ${capo}`);
  }
}

interface WeightedChord {
  name: string;
  weight: number;
}

function weightedChords(input: CapoInferenceInput): WeightedChord[] {
  const out: WeightedChord[] = [];
  for (const c of input.chords) {
    const weight = c.count ?? 1;
    if (Number.isFinite(weight) && weight > 0) out.push({ name: c.name, weight });
  }
  return out;
}

function evaluateCandidate(input: CapoInferenceInput, targetCapo: number): CapoCandidate {
  const delta = targetCapo - input.sourceCapo;
  const chords = weightedChords(input);
  const chordMap = new Map<string, string>();
  for (const { name } of chords) {
    if (chordMap.has(name)) continue;
    const { name: base, label } = splitChordKey(name);
    if (label !== undefined && delta !== 0) {
      return { capo: targetCapo, supported: false, chordMap: new Map(), reason: 'labeledChordVariant' };
    }
    const target = transposeChordName(base, -delta);
    if (target === null || !isValidChordName(target)) {
      return { capo: targetCapo, supported: false, chordMap: new Map(), reason: 'untransposableChord' };
    }
    chordMap.set(name, chordKey(target, label));
  }
  if (chords.length === 0) {
    return { capo: targetCapo, supported: true, chordMap };
  }

  let totalCost = 0;
  let totalWeight = 0;
  const unresolved = new Set<string>();
  for (const { name, weight } of chords) {
    const target = chordMap.get(name) as string;
    const targetName = splitChordKey(target).name;
    const voicing = (delta === 0 ? input.currentVoicings?.get(name) : undefined) ?? standardVoicing(targetName);
    if (!voicing) unresolved.add(target);
    totalCost += weight * chordCost(voicing, isSlashName(targetName));
    totalWeight += weight;
  }
  const uniqueWritten = new Set(chordMap.values()).size;
  const difficultyCost = totalCost / totalWeight
    + 0.25 * Math.max(0, uniqueWritten - 4)
    + 0.15 * targetCapo;
  const score = easeScore(difficultyCost);
  return {
    capo: targetCapo,
    supported: true,
    chordMap,
    playability: { score, level: levelForScore(score), unresolvedChords: Array.from(unresolved) }
  };
}

/**
 * Playability of the song played with `targetCapo` (chords re-spelled to keep the sounding harmony).
 * Null when there are no chord occurrences or a chord cannot be transposed.
 * Throws RangeError for a source or target capo outside 0..12.
 */
export function evaluatePlayability(input: CapoInferenceInput, targetCapo: number): PlayabilityResult | null {
  assertValidCapo(input.sourceCapo, 'sourceCapo');
  assertValidCapo(targetCapo, 'targetCapo');
  return evaluateCandidate(input, targetCapo).playability ?? null;
}

/**
 * Evaluates every capo 0..12 and recommends the highest ease score among supported candidates
 * (lower capo on a tie). Recommends only; never applies. Throws RangeError for an invalid source capo.
 */
export function inferCapo(input: CapoInferenceInput): CapoInferenceResult {
  assertValidCapo(input.sourceCapo, 'sourceCapo');
  const candidates: CapoCandidate[] = [];
  let recommendedCapo: number | undefined;
  let best = -1;
  for (let capo = MIN_CAPO; capo <= MAX_CAPO; capo++) {
    const candidate = evaluateCandidate(input, capo);
    candidates.push(candidate);
    const score = candidate.playability?.score;
    if (candidate.supported && score !== undefined && score > best) {
      best = score;
      recommendedCapo = capo;
    }
  }
  return { candidates, recommendedCapo };
}

// ---------------------------------------------------------------------------
// GuitarDSL adapters
// ---------------------------------------------------------------------------

/**
 * Inference input from a parsed score: chord occurrences (`name` or `name@label`) weighted by the
 * measures they appear in, plus the file's custom voicings for the current capo.
 * Throws RangeError when the score's capo is not an integer 0..12.
 */
export function buildCapoInferenceInputFromScore(score: ParsedScore): CapoInferenceInput {
  const sourceCapo = parseCapoValue(score.capo);
  if (sourceCapo === null) {
    throw new RangeError(`capo must be an integer ${MIN_CAPO}..${MAX_CAPO}: ${score.capo}`);
  }
  const counts = new Map<string, number>();
  for (const measure of score.measures) {
    for (const c of measure.chords) {
      const key = chordKey(c.name, c.label);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  const currentVoicings = new Map<string, ChordVoicing>();
  for (const key of counts.keys()) {
    const { name } = splitChordKey(key);
    const own = score.chordDefinitions.find(d => chordKey(d.name, d.label) === key)
      ?? score.chordDefinitions.find(d => d.label === undefined && d.name === name);
    if (own) currentVoicings.set(key, own);
  }
  return {
    sourceCapo,
    chords: Array.from(counts, ([name, count]) => ({ name, count })),
    currentVoicings
  };
}

/** inferCapo() for GuitarDSL text. Throws RangeError when the `capo:` value is invalid. */
export function inferCapoFromDsl(dslText: string): CapoInferenceResult {
  return inferCapo(buildCapoInferenceInputFromScore(parseGuitarDsl(dslText)));
}

// ---------------------------------------------------------------------------
// Source-to-source capo transformation
// ---------------------------------------------------------------------------

export type CapoTransformFailureCode =
  | 'sourceParseError'
  | 'invalidSourceCapo'
  | 'invalidTargetCapo'
  | 'untransposableChord'
  | 'labeledChordVariant'
  | 'customDefinitionCollision'
  | 'transformedParseError';

/** Non-blocking notes; `unusedChordDefinitions` lists custom definitions no longer referenced. */
export type CapoTransformWarning = 'unusedChordDefinitions';

export type CapoTransformPlan =
  | {
      ok: true;
      sourceCapo: number;
      targetCapo: number;
      text: string;
      playability?: PlayabilityResult;
      warnings: CapoTransformWarning[];
      /** Definition keys that may become unused (never deleted). */
      unusedDefinitions: string[];
      /** Written chord mapping (source -> target) for the chords in the file. */
      chordMap: ReadonlyMap<string, string>;
    }
  | {
      ok: false;
      code: CapoTransformFailureCode;
      detail?: string;
    };

interface SourceLines {
  lines: string[];
  eols: string[];
  eol: string;
}

function splitSourceLines(text: string): SourceLines {
  const parts = text.split(/(\r?\n)/);
  const lines: string[] = [];
  const eols: string[] = [];
  for (let i = 0; i < parts.length; i += 2) {
    lines.push(parts[i]);
    eols.push(parts[i + 1] ?? '');
  }
  return { lines, eols, eol: eols.find(e => e !== '') ?? '\n' };
}

function joinSourceLines(src: SourceLines): string {
  return src.lines.map((line, i) => line + src.eols[i]).join('');
}

const CAPO_INSERT_BEFORE = new Set(['key', 'original_key', 'bpm', 'tempo']);

function writtenChordSequence(score: ParsedScore): string[] {
  return score.measures.flatMap(m => m.chords.map(c => chordKey(c.name, c.label)));
}

/**
 * Plans a capo change that keeps the sounding harmony: only the `capo:` value and the chord-name
 * part of measure chord tokens change; every other byte (comments, spacing, line endings, lengths,
 * melody, lyrics, key) is preserved. Never mutates anything; callers apply `text`.
 */
export function planCapoTransform(dslText: string, targetCapo: number): CapoTransformPlan {
  const score = parseGuitarDsl(dslText);
  const sourceError = score.diagnostics.find(d => d.severity === 'error');
  if (sourceError) {
    return { ok: false, code: 'sourceParseError', detail: `line ${sourceError.line + 1}: ${sourceError.code}` };
  }
  const sourceCapo = parseCapoValue(score.capo);
  if (sourceCapo === null) {
    return { ok: false, code: 'invalidSourceCapo', detail: score.capo };
  }
  if (!isValidCapo(targetCapo)) {
    return { ok: false, code: 'invalidTargetCapo', detail: String(targetCapo) };
  }
  const delta = targetCapo - sourceCapo;
  const tokens = score.chordTokens ?? [];

  // Chord mapping and safety checks.
  const nameMap = new Map<string, string>();
  for (const tok of tokens) {
    if (delta !== 0 && tok.label !== undefined) {
      return { ok: false, code: 'labeledChordVariant', detail: chordKey(tok.name, tok.label) };
    }
    if (nameMap.has(tok.name)) continue;
    const target = transposeChordName(tok.name, -delta);
    if (target === null || !isValidChordName(target)) {
      return { ok: false, code: 'untransposableChord', detail: tok.name };
    }
    nameMap.set(tok.name, target);
  }
  const unlabeledDefinitions = new Set(score.chordDefinitions.filter(d => d.label === undefined).map(d => d.name));
  for (const [from, to] of nameMap) {
    if (from !== to && unlabeledDefinitions.has(to)) {
      return { ok: false, code: 'customDefinitionCollision', detail: `${from} -> ${to}` };
    }
  }

  // Splice chord names (right to left within a line) and the capo value.
  const src = splitSourceLines(dslText);
  const byLine = new Map<number, typeof tokens>();
  for (const tok of tokens) {
    const target = nameMap.get(tok.name) as string;
    if (target === tok.name) continue;
    if (src.lines[tok.line]?.slice(tok.startCol, tok.endCol) !== tok.name) {
      return { ok: false, code: 'transformedParseError', detail: `line ${tok.line + 1}: chord ${tok.name} not found` };
    }
    const list = byLine.get(tok.line) ?? [];
    list.push(tok);
    byLine.set(tok.line, list);
  }
  for (const [line, list] of byLine) {
    let text = src.lines[line];
    for (const tok of [...list].sort((a, b) => b.startCol - a.startCol)) {
      text = text.slice(0, tok.startCol) + nameMap.get(tok.name) + text.slice(tok.endCol);
    }
    src.lines[line] = text;
  }

  const capoHeaders = (score.headerLines ?? []).filter(h => h.key === 'capo');
  if (capoHeaders.length > 0) {
    for (const h of capoHeaders) {
      const line = src.lines[h.line];
      const value = h.valueStart === h.valueEnd && !/\s$/.test(line.slice(0, h.valueStart)) ? ` ${targetCapo}` : String(targetCapo);
      src.lines[h.line] = line.slice(0, h.valueStart) + value + line.slice(h.valueEnd);
    }
  } else {
    const anchor = (score.headerLines ?? []).find(h => CAPO_INSERT_BEFORE.has(h.key))?.line ?? score.firstBodyLine;
    const capoLine = `capo: ${targetCapo}`;
    if (anchor !== undefined) {
      src.lines.splice(anchor, 0, capoLine);
      src.eols.splice(anchor, 0, src.eol);
    } else if (src.lines.length === 1 && src.lines[0] === '') {
      src.lines[0] = capoLine;
    } else {
      const last = src.lines.length - 1;
      if (src.lines[last] === '') {
        src.lines.splice(last, 0, capoLine);
        src.eols.splice(last, 0, src.eol);
      } else {
        src.eols[last] = src.eol;
        src.lines.push(capoLine);
        src.eols.push('');
      }
    }
  }
  const text = joinSourceLines(src);

  // Reparse: no errors, the requested capo, and exactly the mapped chord sequence.
  const transformed = parseGuitarDsl(text);
  const newError = transformed.diagnostics.find(d => d.severity === 'error');
  if (newError) {
    return { ok: false, code: 'transformedParseError', detail: `line ${newError.line + 1}: ${newError.code}` };
  }
  if (parseCapoValue(transformed.capo) !== targetCapo) {
    return { ok: false, code: 'transformedParseError', detail: `capo ${transformed.capo}` };
  }
  const mapKey = (key: string) => {
    const { name, label } = splitChordKey(key);
    return chordKey(nameMap.get(name) ?? name, label);
  };
  const expected = writtenChordSequence(score).map(mapKey);
  const actual = writtenChordSequence(transformed);
  if (expected.length !== actual.length || expected.some((k, i) => k !== actual[i])) {
    return { ok: false, code: 'transformedParseError', detail: 'chord sequence changed' };
  }

  const input = buildCapoInferenceInputFromScore(score);
  const playability = evaluatePlayability(input, targetCapo) ?? undefined;
  const chordMap = new Map<string, string>();
  for (const key of new Set(writtenChordSequence(score))) chordMap.set(key, mapKey(key));
  const targetNames = new Set(writtenChordSequence(transformed).map(k => splitChordKey(k).name));
  const unusedDefinitions = delta === 0
    ? []
    : score.chordDefinitions
        .filter(d => !targetNames.has(d.name))
        .map(d => chordKey(d.name, d.label));
  return {
    ok: true,
    sourceCapo,
    targetCapo,
    text,
    playability,
    warnings: unusedDefinitions.length > 0 ? ['unusedChordDefinitions'] : [],
    unusedDefinitions,
    chordMap
  };
}

export type EffectiveDslResult =
  | { ok: true; text: string; transformed: boolean }
  | { ok: false; code: CapoTransformFailureCode; detail?: string };

/**
 * The single effective DSL used by Preview and PDF export: the source itself without an override
 * (or when the override equals the source capo), otherwise the transform computed from `sourceDsl`.
 */
export function resolveEffectiveDsl(sourceDsl: string, targetCapo: number | undefined): EffectiveDslResult {
  if (targetCapo === undefined) return { ok: true, text: sourceDsl, transformed: false };
  const sourceCapo = parseCapoValue(parseGuitarDsl(sourceDsl).capo);
  if (sourceCapo !== null && sourceCapo === targetCapo) return { ok: true, text: sourceDsl, transformed: false };
  const plan = planCapoTransform(sourceDsl, targetCapo);
  return plan.ok ? { ok: true, text: plan.text, transformed: true } : { ok: false, code: plan.code, detail: plan.detail };
}

// ---------------------------------------------------------------------------
// DSL-backed candidates (generic inference + per-capo transform check)
// ---------------------------------------------------------------------------

export interface DslCapoCandidate {
  capo: number;
  /** True only when the capo can actually be applied to this source (the source capo always can). */
  supported: boolean;
  playability?: PlayabilityResult;
  chordMap: ReadonlyMap<string, string>;
  reason?: CapoTransformFailureCode;
}

export interface DslCapoInferenceResult {
  sourceCapo: number;
  candidates: readonly DslCapoCandidate[];
  /** Highest score among supported candidates, lower capo on a tie. */
  recommendedCapo?: number;
}

/**
 * Candidates for a GuitarDSL source whose supported flag also reflects planCapoTransform()
 * (labeled variants, custom-definition collisions, parse errors), so UIs never offer a capo
 * that cannot be applied. Null when the source `capo:` value is invalid.
 */
export function inferCapoForDsl(dslText: string, score: ParsedScore = parseGuitarDsl(dslText)): DslCapoInferenceResult | null {
  const sourceCapo = parseCapoValue(score.capo);
  if (sourceCapo === null) return null;
  const inference = inferCapo(buildCapoInferenceInputFromScore(score));
  let recommendedCapo: number | undefined;
  let best = -1;
  const candidates = inference.candidates.map(c => {
    let supported = c.supported;
    let reason: CapoTransformFailureCode | undefined = c.reason;
    if (supported && c.capo !== sourceCapo) {
      const plan = planCapoTransform(dslText, c.capo);
      if (!plan.ok) {
        supported = false;
        reason = plan.code;
      }
    }
    const score = c.playability?.score;
    if (supported && score !== undefined && score > best) {
      best = score;
      recommendedCapo = c.capo;
    }
    return { capo: c.capo, supported, playability: c.playability, chordMap: c.chordMap, reason };
  });
  return { sourceCapo, candidates, recommendedCapo };
}

// ---------------------------------------------------------------------------
// Preview UI model (precomputed here; the preview HTML renders it without any inference)
// ---------------------------------------------------------------------------

export interface CapoPreviewUiModel {
  /** Null when the source `capo:` value is invalid (the control is then disabled). */
  sourceCapo: number | null;
  targetCapo: number;
  candidates: Array<{
    capo: number;
    supported: boolean;
    score?: number;
    level?: PlayabilityLevel;
    recommended: boolean;
  }>;
  currentPlayability?: PlayabilityResult;
  /** True while a transient override differs from the source capo. */
  overridden: boolean;
  canApply: boolean;
  /** Localized notice supplied by the host (e.g. the override was cleared). */
  warning?: string;
}

/**
 * UI model for the source DSL shown with `targetCapo` (undefined = no override).
 * The caller must pass a target that resolveEffectiveDsl() accepted.
 */
export function buildCapoPreviewUiModel(sourceDsl: string, targetCapo: number | undefined, warning?: string): CapoPreviewUiModel {
  const inference = inferCapoForDsl(sourceDsl);
  if (inference === null) {
    return { sourceCapo: null, targetCapo: 0, candidates: [], overridden: false, canApply: false, warning };
  }
  const sourceCapo = inference.sourceCapo;
  const target = targetCapo ?? sourceCapo;
  const candidates = inference.candidates.map(c => ({
    capo: c.capo,
    supported: c.supported,
    score: c.playability?.score,
    level: c.playability?.level,
    recommended: c.capo === inference.recommendedCapo
  }));
  const overridden = target !== sourceCapo;
  return {
    sourceCapo,
    targetCapo: target,
    candidates,
    currentPlayability: inference.candidates[target]?.playability,
    overridden,
    canApply: overridden,
    warning
  };
}
