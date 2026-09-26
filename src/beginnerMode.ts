// Beginner Mode (spec extension §4.5): an easy capo position combined with whitelisted chord
// simplifications, keeping the sounding harmony. Pure module: no VS Code, Webview, transcription or
// Audio MIR dependency. Every capo goes through planCapoTransform(); the playability formula is the
// one in capo.ts (chordCost / easeScore / levelForScore) and is not changed here.

import {
  CapoPreviewUiModel,
  CapoTransformFailureCode,
  CapoTransformWarning,
  MAX_CAPO,
  MIN_CAPO,
  PlayabilityResult,
  chordCost,
  easeScore,
  inferCapoForDsl,
  isValidCapo,
  levelForScore,
  parseCapoValue,
  planCapoTransform,
  replaceChordTokenNames
} from './capo';
import { ChordDefinition, ChordVoicing, chordKey, isValidChordName, splitChordKey } from './chordDefinition';
import { parseChordName } from './chordDetect';
import { getDefaultVoicing } from './chordPresets';
import { ParsedScore, parseGuitarDsl } from './compiler';

export type BarrePolicy = 'allow' | 'forbid';

export function isBarrePolicy(value: unknown): value is BarrePolicy {
  return value === 'allow' || value === 'forbid';
}

export interface BeginnerModeOptions {
  barrePolicy: BarrePolicy;
  /** Undefined = auto (the recommended capo of the current source). */
  targetCapo?: number;
}

export type BeginnerFailureCode =
  | CapoTransformFailureCode
  /** Some chord has no alternative whose drawn voicing satisfies the barre policy. */
  | 'noPlayableAlternative'
  /** Auto capo, but no capo is supported (or the song has no chords). */
  | 'noRecommendation';

/** Final chord for one distinct chord of the capo-transformed song. */
export interface BeginnerChordChoice {
  /** Written key after the capo change (`name` or `name@label`). */
  capoChord: string;
  /** Written key in the final DSL. */
  target: string;
  substituted: boolean;
  /** Harmonic penalty of the substitution (0 = unchanged). */
  penalty: number;
  /** chordCost() of the voicing the final score draws. */
  physicalCost: number;
  /** Measure-weighted occurrence count. */
  count: number;
}

/** Source written key -> capo-transformed key -> final key. */
export interface BeginnerChordMapping {
  source: string;
  capoChord: string;
  target: string;
  substituted: boolean;
  penalty: number;
}

export interface BeginnerCandidate {
  capo: number;
  supported: boolean;
  reason?: BeginnerFailureCode;
  detail?: string;
  /** One entry per distinct capo-transformed chord, in order of first appearance. */
  choices: BeginnerChordChoice[];
  mapping: BeginnerChordMapping[];
  /** Physical playability of the final chords (no harmonic penalty); undefined without chords. */
  playability?: PlayabilityResult;
  physicalSongCost?: number;
  /** physicalSongCost + weighted average substitution penalty; used only for the recommendation. */
  optimizationCost?: number;
  substitutedOccurrences: number;
  uniqueSubstitutions: number;
}

export interface BeginnerInferenceResult {
  /** Null when the source `capo:` value is invalid. */
  sourceCapo: number | null;
  barrePolicy: BarrePolicy;
  /** One candidate per capo MIN_CAPO..MAX_CAPO, in ascending order. */
  candidates: readonly BeginnerCandidate[];
  recommendedCapo?: number;
}

export type BeginnerTransformPlan =
  | {
      ok: true;
      sourceCapo: number;
      targetCapo: number;
      autoCapo: boolean;
      barrePolicy: BarrePolicy;
      text: string;
      candidate: BeginnerCandidate;
      recommendedCapo?: number;
      warnings: CapoTransformWarning[];
      /** Definition keys the source chords resolved to that no final chord resolves to (never deleted). */
      unusedDefinitions: string[];
    }
  | { ok: false; code: BeginnerFailureCode; detail?: string };

// ---------------------------------------------------------------------------
// Substitution rules (the only ones allowed; root and major/minor triad quality never change)
// ---------------------------------------------------------------------------

interface QualityRule {
  from: string;
  to: string;
  penalty: number;
}

/** Declaration order is the last tie-break. Suffixes are parseChordName()-normalized. */
export const BEGINNER_SUBSTITUTION_RULES: readonly QualityRule[] = [
  { from: 'maj7', to: '', penalty: 1 },
  { from: '7', to: '', penalty: 1 },
  { from: 'm7', to: 'm', penalty: 1 },
  { from: 'add9', to: '', penalty: 1 },
  { from: '6', to: '', penalty: 1 },
  { from: 'm6', to: 'm', penalty: 1 },
  { from: '9', to: '7', penalty: 1 },
  { from: '9', to: '', penalty: 2 },
  { from: 'm9', to: 'm7', penalty: 1 },
  { from: 'm9', to: 'm', penalty: 2 },
  { from: 'maj9', to: 'maj7', penalty: 1 },
  { from: 'maj9', to: '', penalty: 2 },
  { from: '7sus4', to: 'sus4', penalty: 1 },
  { from: 'dim7', to: 'dim', penalty: 1 }
];

/** Only with barrePolicy 'forbid' when the unchanged major / minor chord has no bar-free drawn voicing. */
export const BEGINNER_BARRE_FALLBACK_RULES: readonly QualityRule[] = [
  { from: '', to: 'maj7', penalty: 2 },
  { from: 'm', to: 'm7', penalty: 2 }
];

export const SLASH_BASS_DROP_PENALTY = 1;

const EPSILON = 1e-9;

/** The `chord` definition a key resolves to (renderer precedence); undefined when none applies. */
function definitionFor(name: string, label: string | undefined, definitions: readonly ChordDefinition[]): ChordDefinition | undefined {
  const find = (key: string) => definitions.find(d => chordKey(d.name, d.label) === key);
  return find(chordKey(name, label)) ?? (label !== undefined ? find(name) : undefined);
}

/** Keys of the definitions the written chords of a score actually resolve to. */
function usedDefinitionKeys(keys: readonly string[], definitions: readonly ChordDefinition[]): Set<string> {
  const used = new Set<string>();
  for (const key of new Set(keys)) {
    const { name, label } = splitChordKey(key);
    const d = definitionFor(name, label, definitions);
    if (d) used.add(chordKey(d.name, d.label));
  }
  return used;
}

/**
 * The voicing the final score draws for a key (same precedence as the renderer, docs/specs
 * guitardsl-syntax §7.3): the key's `chord` definition (a labeled key falls back to the unlabeled
 * definition), then the preset default; a slash chord without either uses its upper chord's default
 * (the capo playability semantics). Undefined when none is known.
 */
function drawnVoicing(name: string, label: string | undefined, definitions: readonly ChordDefinition[]): ChordVoicing | undefined {
  const own = definitionFor(name, label, definitions);
  if (own) return own;
  const direct = getDefaultVoicing(name);
  if (direct) return direct;
  const slash = name.indexOf('/');
  return slash > 0 ? getDefaultVoicing(name.slice(0, slash)) : undefined;
}

function allowedBy(voicing: ChordVoicing | undefined, policy: BarrePolicy): voicing is ChordVoicing {
  return voicing !== undefined && (policy === 'allow' || voicing.barres.length === 0);
}

interface Alternative {
  name: string;
  penalty: number;
  cost: number;
  order: number;
}

/** Candidate final chords for one capo-transformed key, best first; empty when none is playable. */
function alternativesFor(key: string, definitions: readonly ChordDefinition[], policy: BarrePolicy): Alternative[] {
  const { name, label } = splitChordKey(key);
  const isSlash = (n: string) => parseChordName(n)?.bass !== undefined;
  const exactVoicing = drawnVoicing(name, label, definitions);
  const out: Alternative[] = [];
  if (allowedBy(exactVoicing, policy)) {
    out.push({ name, penalty: 0, cost: chordCost(exactVoicing, isSlash(name)), order: 0 });
  }
  const parsed = parseChordName(name);
  if (label === undefined && parsed) {
    const unlabeledDefinitions = new Set(definitions.filter(d => d.label === undefined).map(d => d.name));
    const upper = parsed.bass !== undefined ? name.slice(0, name.lastIndexOf('/')) : name;
    const qualities: { upper: string; penalty: number }[] = [{ upper, penalty: 0 }];
    for (const rule of BEGINNER_SUBSTITUTION_RULES) {
      if (rule.from === parsed.suffix) qualities.push({ upper: parsed.root + rule.to, penalty: rule.penalty });
    }
    if (policy === 'forbid' && !allowedBy(exactVoicing, policy)) {
      for (const rule of BEGINNER_BARRE_FALLBACK_RULES) {
        if (rule.from === parsed.suffix) qualities.push({ upper: parsed.root + rule.to, penalty: rule.penalty });
      }
    }
    const basses = parsed.bass !== undefined
      ? [{ suffix: `/${parsed.bass}`, penalty: 0 }, { suffix: '', penalty: SLASH_BASS_DROP_PENALTY }]
      : [{ suffix: '', penalty: 0 }];
    let order = 0;
    for (const q of qualities) {
      for (const b of basses) {
        order++;
        const target = q.upper + b.suffix;
        if (target === name) continue;
        if (!isValidChordName(target) || unlabeledDefinitions.has(target)) continue;
        const voicing = drawnVoicing(target, undefined, definitions);
        if (!allowedBy(voicing, policy)) continue;
        out.push({ name: target, penalty: q.penalty + b.penalty, cost: chordCost(voicing, b.suffix !== ''), order });
      }
    }
  }
  return out.sort((a, b) => {
    const choice = (a.cost + a.penalty) - (b.cost + b.penalty);
    if (Math.abs(choice) > EPSILON) return choice;
    return a.penalty - b.penalty || a.order - b.order;
  });
}

function writtenChordSequence(score: ParsedScore): string[] {
  return score.measures.flatMap(m => m.chords.map(c => chordKey(c.name, c.label)));
}

interface CapoEvaluation {
  candidate: BeginnerCandidate;
  /** Capo-transformed DSL and its parse (supported candidates only). */
  intermediate?: { text: string; score: ParsedScore; finalKey: Map<string, string> };
}

function unsupported(capo: number, reason: BeginnerFailureCode, detail?: string): CapoEvaluation {
  return {
    candidate: { capo, supported: false, reason, detail, choices: [], mapping: [], substitutedOccurrences: 0, uniqueSubstitutions: 0 }
  };
}

function evaluateCapo(sourceDsl: string, sourceCapo: number | null, capo: number, policy: BarrePolicy): CapoEvaluation {
  const plan = planCapoTransform(sourceDsl, capo);
  if (!plan.ok) return unsupported(capo, plan.code, plan.detail);
  // The source capo keeps the source text (like resolveEffectiveDsl): no `capo:` line is inserted.
  const text = capo === sourceCapo ? sourceDsl : plan.text;
  const score = parseGuitarDsl(text);

  const counts = new Map<string, number>();
  for (const key of writtenChordSequence(score)) counts.set(key, (counts.get(key) ?? 0) + 1);
  const choices: BeginnerChordChoice[] = [];
  const finalKey = new Map<string, string>();
  for (const [key, count] of counts) {
    const best = alternativesFor(key, score.chordDefinitions, policy)[0];
    if (!best) return unsupported(capo, 'noPlayableAlternative', key);
    const target = chordKey(best.name, splitChordKey(key).label);
    finalKey.set(key, target);
    choices.push({ capoChord: key, target, substituted: target !== key, penalty: best.penalty, physicalCost: best.cost, count });
  }
  const mapping: BeginnerChordMapping[] = [];
  for (const [source, capoChord] of plan.chordMap) {
    const choice = choices.find(c => c.capoChord === capoChord);
    if (choice) mapping.push({ source, capoChord, target: choice.target, substituted: choice.substituted, penalty: choice.penalty });
  }

  const candidate: BeginnerCandidate = {
    capo,
    supported: true,
    choices,
    mapping,
    substitutedOccurrences: choices.filter(c => c.substituted).reduce((sum, c) => sum + c.count, 0),
    uniqueSubstitutions: choices.filter(c => c.substituted).length
  };
  const totalWeight = choices.reduce((sum, c) => sum + c.count, 0);
  if (totalWeight > 0) {
    const physicalAverage = choices.reduce((sum, c) => sum + c.count * c.physicalCost, 0) / totalWeight;
    const penaltyAverage = choices.reduce((sum, c) => sum + c.count * c.penalty, 0) / totalWeight;
    const uniqueFinal = new Set(choices.map(c => c.target)).size;
    const physicalSongCost = physicalAverage + 0.25 * Math.max(0, uniqueFinal - 4) + 0.15 * capo;
    const score100 = easeScore(physicalSongCost);
    candidate.physicalSongCost = physicalSongCost;
    candidate.optimizationCost = physicalSongCost + penaltyAverage;
    candidate.playability = { score: score100, level: levelForScore(score100), unresolvedChords: [] };
  }
  return { candidate, intermediate: { text, score, finalKey } };
}

/** True when `a` is a better recommendation than `b` (both supported with a cost). */
function betterRecommendation(a: BeginnerCandidate, b: BeginnerCandidate): boolean {
  const cost = (a.optimizationCost as number) - (b.optimizationCost as number);
  if (Math.abs(cost) > EPSILON) return cost < 0;
  if (a.substitutedOccurrences !== b.substitutedOccurrences) return a.substitutedOccurrences < b.substitutedOccurrences;
  if (a.uniqueSubstitutions !== b.uniqueSubstitutions) return a.uniqueSubstitutions < b.uniqueSubstitutions;
  return a.capo < b.capo;
}

function recommend(candidates: readonly BeginnerCandidate[]): number | undefined {
  let best: BeginnerCandidate | undefined;
  for (const c of candidates) {
    if (!c.supported || c.optimizationCost === undefined) continue;
    if (!best || betterRecommendation(c, best)) best = c;
  }
  return best?.capo;
}

/**
 * Evaluates Beginner Mode for every capo 0..12 of a GuitarDSL source and recommends one
 * (lowest optimization cost; ties: fewer substituted occurrences, fewer unique substitutions,
 * lower capo). Recommends only; never applies.
 */
export function inferBeginnerModeForDsl(dslText: string, barrePolicy: BarrePolicy): BeginnerInferenceResult {
  const sourceCapo = parseCapoValue(parseGuitarDsl(dslText).capo);
  const candidates: BeginnerCandidate[] = [];
  for (let capo = MIN_CAPO; capo <= MAX_CAPO; capo++) {
    candidates.push(evaluateCapo(dslText, sourceCapo, capo, barrePolicy).candidate);
  }
  return { sourceCapo, barrePolicy, candidates, recommendedCapo: recommend(candidates) };
}

/**
 * Plans the Beginner Mode transform of `dslText` (always the original / current source, never a
 * previous result): the capo change of planCapoTransform(), then only the chord-name spans are
 * replaced by the chosen chords. The result is reparsed and must have no error diagnostics, the
 * target capo, the expected chord sequence and (with 'forbid') no drawn barre voicing.
 * `inference` may pass a precomputed inferBeginnerModeForDsl() result for the same text and policy.
 */
export function planBeginnerTransform(
  dslText: string,
  options: BeginnerModeOptions,
  inference?: BeginnerInferenceResult
): BeginnerTransformPlan {
  const source = parseGuitarDsl(dslText);
  const sourceError = source.diagnostics.find(d => d.severity === 'error');
  if (sourceError) {
    return { ok: false, code: 'sourceParseError', detail: `line ${sourceError.line + 1}: ${sourceError.code}` };
  }
  const sourceCapo = parseCapoValue(source.capo);
  if (sourceCapo === null) return { ok: false, code: 'invalidSourceCapo', detail: source.capo };
  const policy = options.barrePolicy;
  const autoCapo = options.targetCapo === undefined;
  let recommendedCapo: number | undefined;
  if (autoCapo || inference) {
    const inf = inference && inference.barrePolicy === policy ? inference : inferBeginnerModeForDsl(dslText, policy);
    recommendedCapo = inf.recommendedCapo;
  }
  const targetCapo = options.targetCapo ?? recommendedCapo;
  if (targetCapo === undefined) return { ok: false, code: 'noRecommendation' };
  if (!isValidCapo(targetCapo)) return { ok: false, code: 'invalidTargetCapo', detail: String(targetCapo) };

  const evaluation = evaluateCapo(dslText, sourceCapo, targetCapo, policy);
  const { candidate, intermediate } = evaluation;
  if (!candidate.supported || !intermediate) {
    return { ok: false, code: candidate.reason ?? 'transformedParseError', detail: candidate.detail };
  }

  const finalName = (name: string, label?: string) => splitChordKey(intermediate.finalKey.get(chordKey(name, label)) ?? chordKey(name, label)).name;
  const spliced = replaceChordTokenNames(intermediate.text, intermediate.score.chordTokens ?? [], tok => finalName(tok.name, tok.label));
  if (!spliced.ok) return { ok: false, code: 'transformedParseError', detail: spliced.detail };
  const text = spliced.text;

  const final = parseGuitarDsl(text);
  const finalError = final.diagnostics.find(d => d.severity === 'error');
  if (finalError) {
    return { ok: false, code: 'transformedParseError', detail: `line ${finalError.line + 1}: ${finalError.code}` };
  }
  if (parseCapoValue(final.capo) !== targetCapo) {
    return { ok: false, code: 'transformedParseError', detail: `capo ${final.capo}` };
  }
  const expected = writtenChordSequence(intermediate.score).map(k => intermediate.finalKey.get(k) ?? k);
  const actual = writtenChordSequence(final);
  if (expected.length !== actual.length || expected.some((k, i) => k !== actual[i])) {
    return { ok: false, code: 'transformedParseError', detail: 'chord sequence changed' };
  }
  if (policy === 'forbid') {
    for (const key of new Set(actual)) {
      const { name, label } = splitChordKey(key);
      if (!allowedBy(drawnVoicing(name, label, final.chordDefinitions), policy)) {
        return { ok: false, code: 'transformedParseError', detail: `barre voicing: ${key}` };
      }
    }
  }

  // Only definitions the source chords actually used and the final chords no longer use.
  const sourceUsed = usedDefinitionKeys(writtenChordSequence(source), source.chordDefinitions);
  const finalUsed = usedDefinitionKeys(actual, final.chordDefinitions);
  const unusedDefinitions = Array.from(sourceUsed).filter(k => !finalUsed.has(k));
  return {
    ok: true,
    sourceCapo,
    targetCapo,
    autoCapo,
    barrePolicy: policy,
    text,
    candidate,
    recommendedCapo,
    warnings: unusedDefinitions.length > 0 ? ['unusedChordDefinitions'] : [],
    unusedDefinitions
  };
}

// ---------------------------------------------------------------------------
// Preview UI model (precomputed here; the preview HTML renders it without any inference)
// ---------------------------------------------------------------------------

export interface BeginnerPreviewUiModel {
  active: boolean;
  barrePolicy: BarrePolicy;
  autoCapo: boolean;
  /** Capo-transformed chord -> substituted chord (substituted chords only), e.g. ['F', 'Fmaj7']. */
  substitutions: [string, string][];
}

export const INACTIVE_BEGINNER_UI: BeginnerPreviewUiModel = { active: false, barrePolicy: 'forbid', autoCapo: true, substitutions: [] };

/**
 * Capo bar models while Beginner Mode is active: candidate scores and the current playability are
 * the Beginner (physical) evaluation. `plan` must be a successful plan for `sourceDsl`.
 */
export function buildBeginnerPreviewUiModel(
  sourceDsl: string,
  plan: Extract<BeginnerTransformPlan, { ok: true }>,
  inference: BeginnerInferenceResult,
  warning?: string
): { capo: CapoPreviewUiModel; beginner: BeginnerPreviewUiModel } {
  return {
    capo: {
      sourceCapo: plan.sourceCapo,
      targetCapo: plan.targetCapo,
      candidates: inference.candidates.map(c => ({
        capo: c.capo,
        supported: c.supported,
        score: c.playability?.score,
        level: c.playability?.level,
        recommended: c.capo === inference.recommendedCapo
      })),
      currentPlayability: plan.candidate.playability,
      overridden: plan.text !== sourceDsl,
      canApply: plan.text !== sourceDsl,
      warning
    },
    beginner: {
      active: true,
      barrePolicy: plan.barrePolicy,
      autoCapo: plan.autoCapo,
      substitutions: plan.candidate.choices.filter(c => c.substituted).map(c => [c.capoChord, c.target] as [string, string])
    }
  };
}

/** Playability of the unchanged source (the normal capo evaluation), for "current" displays. */
export function sourcePlayability(dslText: string): PlayabilityResult | undefined {
  const inference = inferCapoForDsl(dslText);
  return inference ? inference.candidates[inference.sourceCapo]?.playability : undefined;
}
