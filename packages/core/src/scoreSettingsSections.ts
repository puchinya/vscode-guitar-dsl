import { BarrePolicy, BeginnerModeOptions, inferBeginnerModeForDsl, isBarrePolicy, planBeginnerTransform, sourcePlayability } from './beginnerMode';
import { PlayabilityResult, inferCapoForDsl, isValidCapo, parseCapoValue, planCapoTransform } from './capo';
import { chordKey } from './chordDefinition';
import { parseGuitarDsl } from './compiler';
import type { Messages, ScoreSettingsEditorMessages } from './i18n';
import { CapoMode, MAX_SEMITONES, MIN_SEMITONES, isValidSemitones, planTransposeWithCapo, transposeKeyName } from './transpose';

export interface TransposeRequest {
  semitones: number;
  capoMode: CapoMode;
}

export interface ScoreSettingsSectionContext {
  readonly source: string;
  readonly messages: Messages;
  readonly editorMessages: ScoreSettingsEditorMessages;
  refresh(): void;
  status(text: string, error?: boolean): void;
}

/** One section of the editor. Models must be JSON-serializable; localized text is resolved here. */
export interface ScoreSettingsSection {
  readonly id: string;
  title(m: ScoreSettingsEditorMessages): string;
  buildModel(ctx: ScoreSettingsSectionContext): unknown;
  onMessage(ctx: ScoreSettingsSectionContext, msg: any): Promise<void>;
  /** Called when the session switches to another document. */
  reset(): void;
}

export interface CapoSectionModel {
  sourceCapo: number | null;
  selectedCapo: number;
  recommendedCapo?: number;
  candidates: {
    capo: number;
    supported: boolean;
    score?: number;
    levelLabel?: string;
    recommended: boolean;
    reason?: string;
  }[];
  currentVocabulary: string[];
  targetVocabulary: string[];
  mapping: [string, string][];
  unresolved: string[];
  warnings: string[];
  noChords: boolean;
  canApply: boolean;
  error?: string;
}

export class CapoSection implements ScoreSettingsSection {
  readonly id = 'capo';
  private selected: number | undefined;

  title(m: ScoreSettingsEditorMessages): string {
    return m.sectionCapo;
  }

  reset(): void {
    this.selected = undefined;
  }

  selectCapo(capo: number): boolean {
    if (!isValidCapo(capo)) return false;
    this.selected = capo;
    return true;
  }

  getSelectedCapo(sourceCapo: number): number {
    return this.selected ?? sourceCapo;
  }

  buildModel(ctx: ScoreSettingsSectionContext): CapoSectionModel {
    const m = ctx.messages;
    const text = ctx.source;
    const score = parseGuitarDsl(text);
    const sourceCapo = parseCapoValue(score.capo);
    const currentVocabulary = Array.from(new Set(score.measures.flatMap(ms => ms.chords.map(c => chordKey(c.name, c.label)))));
    const empty: CapoSectionModel = {
      sourceCapo,
      selectedCapo: sourceCapo ?? 0,
      candidates: [],
      currentVocabulary,
      targetVocabulary: [],
      mapping: [],
      unresolved: [],
      warnings: [],
      noChords: currentVocabulary.length === 0,
      canApply: false
    };
    const inference = sourceCapo === null ? null : inferCapoForDsl(text, score);
    if (sourceCapo === null || inference === null) {
      return { ...empty, error: m.capoFailures.invalidSourceCapo };
    }
    const selected = this.getSelectedCapo(sourceCapo);
    const candidate = inference.candidates[selected];
    const plan = planCapoTransform(text, selected);
    const map = plan.ok ? plan.chordMap : candidate.chordMap;
    const mapping = currentVocabulary.filter(k => map.has(k)).map(k => [k, map.get(k) as string] as [string, string]);
    const warnings = plan.ok && plan.unusedDefinitions.length > 0 ? [m.msgCapoUnusedDefinitions(plan.unusedDefinitions.join(', '))] : [];
    return {
      ...empty,
      selectedCapo: selected,
      recommendedCapo: inference.recommendedCapo,
      candidates: inference.candidates.map(c => ({
        capo: c.capo,
        supported: c.supported,
        score: c.playability?.score,
        levelLabel: c.playability ? m.playabilityLevels[c.playability.level] : undefined,
        recommended: c.capo === inference.recommendedCapo,
        reason: c.reason ? m.capoFailures[c.reason] : undefined
      })),
      targetVocabulary: Array.from(new Set(mapping.map(([, to]) => to))),
      mapping,
      unresolved: candidate.playability?.unresolvedChords ?? [],
      warnings,
      canApply: plan.ok && plan.text !== text,
      error: plan.ok ? undefined : m.capoFailures[plan.code]
    };
  }

  async onMessage(ctx: ScoreSettingsSectionContext, msg: any): Promise<void> {
    const capo = Number(msg.capo);
    if (!isValidCapo(capo)) return;
    if (msg.command === 'select') {
      if (!this.selectCapo(capo)) return;
      ctx.refresh();
    }
  }
}

export interface BeginnerSectionModel {
  sourceCapo: number | null;
  barrePolicy: BarrePolicy;
  /** Null = auto. */
  selectedCapo: number | null;
  targetCapo?: number;
  recommendedCapo?: number;
  currentPlayability?: { score: number; levelLabel: string };
  targetPlayability?: { score: number; levelLabel: string };
  candidates: {
    capo: number;
    supported: boolean;
    score?: number;
    levelLabel?: string;
    recommended: boolean;
    reason?: string;
  }[];
  mapping: { source: string; capoChord: string; target: string; substituted: boolean }[];
  warnings: string[];
  noChords: boolean;
  canApply: boolean;
  error?: string;
}

export class BeginnerSection implements ScoreSettingsSection {
  readonly id = 'beginner';
  private barrePolicy: BarrePolicy = 'forbid';
  /** Undefined = auto. */
  private selected: number | undefined;

  title(m: ScoreSettingsEditorMessages): string {
    return m.sectionBeginner;
  }

  reset(): void {
    this.barrePolicy = 'forbid';
    this.selected = undefined;
  }

  setBarrePolicy(policy: BarrePolicy): boolean {
    if (!isBarrePolicy(policy)) return false;
    if (this.barrePolicy !== policy) this.selected = undefined;
    this.barrePolicy = policy;
    return true;
  }

  selectCapo(capo: number | undefined): boolean {
    if (capo !== undefined && !isValidCapo(capo)) return false;
    this.selected = capo;
    return true;
  }

  getOptions(): BeginnerModeOptions {
    return { barrePolicy: this.barrePolicy, targetCapo: this.selected };
  }

  buildModel(ctx: ScoreSettingsSectionContext): BeginnerSectionModel {
    const m = ctx.messages;
    const text = ctx.source;
    const score = parseGuitarDsl(text);
    const playability = (p: PlayabilityResult | undefined) => (p ? { score: p.score, levelLabel: m.playabilityLevels[p.level] } : undefined);
    const options = this.getOptions();
    const inference = inferBeginnerModeForDsl(text, options.barrePolicy);
    const plan = planBeginnerTransform(text, options, inference);
    const candidate = plan.ok ? plan.candidate : undefined;
    return {
      sourceCapo: parseCapoValue(score.capo),
      barrePolicy: this.barrePolicy,
      selectedCapo: this.selected ?? null,
      targetCapo: plan.ok ? plan.targetCapo : this.selected,
      recommendedCapo: inference.recommendedCapo,
      currentPlayability: playability(sourcePlayability(text)),
      targetPlayability: playability(candidate?.playability),
      candidates: inference.candidates.map(c => ({
        capo: c.capo,
        supported: c.supported,
        score: c.playability?.score,
        levelLabel: c.playability ? m.playabilityLevels[c.playability.level] : undefined,
        recommended: c.capo === inference.recommendedCapo,
        reason: c.reason ? m.beginnerFailure(c.reason, c.detail) : undefined
      })),
      mapping: (candidate?.mapping ?? []).map(({ source, capoChord, target, substituted }) => ({ source, capoChord, target, substituted })),
      warnings: plan.ok && plan.unusedDefinitions.length > 0 ? [m.msgCapoUnusedDefinitions(plan.unusedDefinitions.join(', '))] : [],
      noChords: score.measures.every(ms => ms.chords.length === 0),
      canApply: plan.ok && plan.text !== text,
      error: plan.ok ? undefined : m.beginnerFailure(plan.code, plan.detail)
    };
  }

  async onMessage(ctx: ScoreSettingsSectionContext, msg: any): Promise<void> {
    if (msg.command === 'setPolicy') {
      if (!isBarrePolicy(msg.policy)) return;
      if (!this.setBarrePolicy(msg.policy)) return;
      ctx.refresh();
    } else if (msg.command === 'select') {
      if (msg.capo === 'auto') {
        this.selectCapo(undefined);
      } else if (isValidCapo(Number(msg.capo))) {
        this.selectCapo(Number(msg.capo));
      } else {
        return;
      }
      ctx.refresh();
    }
  }
}

export interface TransposeSectionModel {
  semitones: number;
  semitoneRange: [number, number];
  sourceKey: string;
  /** Null when the transposed key cannot be computed (unparseable `key:`). */
  targetKey: string | null;
  /** Target-key choices synchronized with the shift; null when the initial key cannot be parsed. */
  keyOptions: { semitones: number; key: string }[] | null;
  sourceCapo: number | null;
  capoMode: CapoMode['kind'];
  explicitCapo: number;
  targetCapo: number | null;
  mapping: [string, string][];
  warnings: string[];
  canApply: boolean;
  error?: string;
}

export class TransposeSection implements ScoreSettingsSection {
  readonly id = 'transpose';
  private semitones = 0;
  private capoMode: CapoMode['kind'] = 'keep';
  private explicitCapo: number | undefined;

  title(m: ScoreSettingsEditorMessages): string {
    return m.sectionTranspose;
  }

  reset(): void {
    this.semitones = 0;
    this.capoMode = 'keep';
    this.explicitCapo = undefined;
  }

  request(sourceCapo: number | null): TransposeRequest {
    const capoMode: CapoMode = this.capoMode === 'explicit'
      ? { kind: 'explicit', capo: this.explicitCapo ?? sourceCapo ?? 0 }
      : { kind: this.capoMode };
    return { semitones: this.semitones, capoMode };
  }

  setSemitones(semitones: number): boolean {
    if (!isValidSemitones(semitones)) return false;
    this.semitones = semitones;
    return true;
  }

  setCapoMode(mode: CapoMode['kind'], capo?: number): boolean {
    if (mode === 'keep' || mode === 'recommended') {
      this.capoMode = mode;
      return true;
    }
    if (mode !== 'explicit' || capo === undefined || !isValidCapo(capo)) return false;
    this.capoMode = mode;
    this.explicitCapo = capo;
    return true;
  }

  buildModel(ctx: ScoreSettingsSectionContext): TransposeSectionModel {
    const m = ctx.messages;
    const text = ctx.source;
    const score = parseGuitarDsl(text);
    const sourceCapo = parseCapoValue(score.capo);
    const sourceKey = score.originalKey;
    const parseable = transposeKeyName(sourceKey, 0) !== null;
    const keyOptions = parseable
      ? Array.from({ length: MAX_SEMITONES - MIN_SEMITONES + 1 }, (_, i) => MIN_SEMITONES + i)
          .map(n => ({ semitones: n, key: transposeKeyName(sourceKey, n) as string }))
      : null;
    const plan = planTransposeWithCapo(text, this.semitones, this.request(sourceCapo).capoMode);
    const vocabulary = Array.from(new Set(score.measures.flatMap(ms => ms.chords.map(c => chordKey(c.name, c.label)))));
    const warnings: string[] = [];
    if (plan.ok) {
      if (plan.unusedDefinitions.length > 0) warnings.push(m.msgCapoUnusedDefinitions(plan.unusedDefinitions.join(', ')));
      if (plan.warnings.includes('noCapoRecommendation')) warnings.push(m.msgNoCapoRecommendation);
    }
    return {
      semitones: this.semitones,
      semitoneRange: [MIN_SEMITONES, MAX_SEMITONES],
      sourceKey,
      targetKey: plan.ok ? plan.targetKey : transposeKeyName(sourceKey, this.semitones),
      keyOptions,
      sourceCapo,
      capoMode: this.capoMode,
      explicitCapo: this.explicitCapo ?? sourceCapo ?? 0,
      targetCapo: plan.ok ? plan.targetCapo : null,
      mapping: plan.ok ? vocabulary.filter(k => plan.chordMap.has(k)).map(k => [k, plan.chordMap.get(k) as string] as [string, string]) : [],
      warnings,
      canApply: plan.ok && plan.text !== text,
      error: plan.ok ? undefined : m.transposeFailure(plan.code, plan.detail)
    };
  }

  async onMessage(ctx: ScoreSettingsSectionContext, msg: any): Promise<void> {
    if (msg.command === 'setSemitones') {
      const n = Number(msg.semitones);
      if (!isValidSemitones(n)) return;
      if (!this.setSemitones(n)) return;
      ctx.refresh();
    } else if (msg.command === 'setCapoMode') {
      if (msg.mode === 'keep' || msg.mode === 'recommended') {
        this.setCapoMode(msg.mode);
      } else if (msg.mode === 'explicit' && isValidCapo(Number(msg.capo))) {
        this.setCapoMode('explicit', Number(msg.capo));
      } else {
        return;
      }
      ctx.refresh();
    }
  }
}
