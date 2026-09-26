// Score settings editor panel (webview): a generic, section-based editor for score-wide settings.
// Each section computes its model from the document's current source and applies changes through
// one undoable WorkspaceEdit; the webview only reports intents. Sections: capo / playability, Beginner Mode.

import * as vscode from 'vscode';
import { BarrePolicy, BeginnerFailureCode, BeginnerModeOptions, inferBeginnerModeForDsl, isBarrePolicy, planBeginnerTransform, sourcePlayability } from './beginnerMode';
import { MAX_CAPO, MIN_CAPO, PlayabilityResult, inferCapoForDsl, isValidCapo, parseCapoValue, planCapoTransform } from './capo';
import { chordKey } from './chordDefinition';
import { parseGuitarDsl } from './compiler';
import { Messages, ScoreSettingsEditorMessages, SupportedLocale, getMessages, getScoreSettingsEditorMessages } from './i18n';
import { renderScoreSettingsEditorHtml } from './render/scoreSettingsEditorHtml';

export const EDIT_SCORE_SETTINGS_COMMAND = 'guitardsl.editScoreSettings';
export const EDIT_CAPO_COMMAND = 'guitardsl.editCapo';

export type CapoApplyResult =
  | { ok: true; changed: boolean; targetCapo: number; unusedDefinitions: string[] }
  | { ok: false; code: import('./capo').CapoTransformFailureCode | 'editRejected'; detail?: string };

/**
 * Applies a capo change to the document at `uri`: re-reads the current source, recomputes the
 * transform from it (never from webview-provided text) and applies one undoable WorkspaceEdit.
 */
export async function applyCapoTransform(uri: vscode.Uri, targetCapo: number): Promise<CapoApplyResult> {
  const doc = await vscode.workspace.openTextDocument(uri);
  const text = doc.getText();
  const plan = planCapoTransform(text, targetCapo);
  if (!plan.ok) return plan;
  if (plan.text === text) {
    return { ok: true, changed: false, targetCapo, unusedDefinitions: plan.unusedDefinitions };
  }
  const applied = await replaceDocumentText(doc, text, plan.text);
  return applied
    ? { ok: true, changed: true, targetCapo, unusedDefinitions: plan.unusedDefinitions }
    : { ok: false, code: 'editRejected' };
}

/** Replaces only the changed middle so cursors / folding elsewhere are kept; still one edit. */
async function replaceDocumentText(doc: vscode.TextDocument, text: string, next: string): Promise<boolean> {
  let start = 0;
  while (start < text.length && start < next.length && text[start] === next[start]) start++;
  let endOld = text.length;
  let endNew = next.length;
  while (endOld > start && endNew > start && text[endOld - 1] === next[endNew - 1]) {
    endOld--;
    endNew--;
  }
  const edit = new vscode.WorkspaceEdit();
  edit.replace(doc.uri, new vscode.Range(doc.positionAt(start), doc.positionAt(endOld)), next.slice(start, endNew));
  return vscode.workspace.applyEdit(edit);
}

export type BeginnerApplyResult =
  | { ok: true; changed: boolean; targetCapo: number; substitutions: number; unusedDefinitions: string[] }
  | { ok: false; code: BeginnerFailureCode | 'editRejected'; detail?: string };

/**
 * Applies the Beginner Mode transform to the document at `uri`: re-reads the current source,
 * recomputes the plan from it with `options` (never from webview-provided text) and applies one
 * undoable WorkspaceEdit (capo value and chord names together).
 */
export async function applyBeginnerTransform(uri: vscode.Uri, options: BeginnerModeOptions): Promise<BeginnerApplyResult> {
  const doc = await vscode.workspace.openTextDocument(uri);
  const text = doc.getText();
  const plan = planBeginnerTransform(text, options);
  if (!plan.ok) return plan;
  const done = { targetCapo: plan.targetCapo, substitutions: plan.candidate.uniqueSubstitutions, unusedDefinitions: plan.unusedDefinitions };
  if (plan.text === text) return { ok: true, changed: false, ...done };
  const applied = await replaceDocumentText(doc, text, plan.text);
  return applied ? { ok: true, changed: true, ...done } : { ok: false, code: 'editRejected' };
}

/** Context handed to a section: the document's current state plus panel callbacks. */
export interface ScoreSettingsSectionContext {
  readonly doc: vscode.TextDocument;
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
  /** Called when the panel switches to another document. */
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

  buildModel(ctx: ScoreSettingsSectionContext): CapoSectionModel {
    const m = ctx.messages;
    const text = ctx.doc.getText();
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
    const selected = this.selected ?? sourceCapo;
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
      this.selected = capo;
      ctx.refresh();
    } else if (msg.command === 'apply') {
      const result = await applyCapoTransform(ctx.doc.uri, capo);
      if (result.ok) {
        this.selected = undefined;
        ctx.status(ctx.messages.msgCapoApplied(capo));
      } else {
        const reason = result.code === 'editRejected' ? ctx.messages.msgCapoEditRejected : ctx.messages.capoFailures[result.code];
        ctx.status(ctx.messages.msgCapoApplyFailed(reason), true);
      }
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

  buildModel(ctx: ScoreSettingsSectionContext): BeginnerSectionModel {
    const m = ctx.messages;
    const text = ctx.doc.getText();
    const score = parseGuitarDsl(text);
    const playability = (p: PlayabilityResult | undefined) => (p ? { score: p.score, levelLabel: m.playabilityLevels[p.level] } : undefined);
    const inference = inferBeginnerModeForDsl(text, this.barrePolicy);
    const plan = planBeginnerTransform(text, { barrePolicy: this.barrePolicy, targetCapo: this.selected }, inference);
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
      this.barrePolicy = msg.policy;
      this.selected = undefined;
      ctx.refresh();
    } else if (msg.command === 'select') {
      if (msg.capo === 'auto') {
        this.selected = undefined;
      } else if (isValidCapo(Number(msg.capo))) {
        this.selected = Number(msg.capo);
      } else {
        return;
      }
      ctx.refresh();
    } else if (msg.command === 'apply') {
      const result = await applyBeginnerTransform(ctx.doc.uri, { barrePolicy: this.barrePolicy, targetCapo: this.selected });
      if (result.ok) {
        this.selected = undefined;
        ctx.status(ctx.messages.msgBeginnerApplied(result.targetCapo, result.substitutions));
      } else {
        const reason = result.code === 'editRejected' ? ctx.messages.msgCapoEditRejected : ctx.messages.beginnerFailure(result.code, result.detail);
        ctx.status(ctx.messages.msgBeginnerApplyFailed(reason), true);
      }
      ctx.refresh();
    }
  }
}

export class ScoreSettingsEditorPanel {
  private static current: ScoreSettingsEditorPanel | undefined;

  private readonly panel: vscode.WebviewPanel;
  private readonly m: ScoreSettingsEditorMessages;
  private readonly messages: Messages;
  private readonly sections: ScoreSettingsSection[] = [new CapoSection(), new BeginnerSection()];
  private readonly disposables: vscode.Disposable[] = [];
  private doc!: vscode.TextDocument;
  private activeSection = 'capo';
  private ready = false;

  static show(extensionUri: vscode.Uri, doc: vscode.TextDocument, locale: SupportedLocale, sectionId = 'capo'): void {
    if (!ScoreSettingsEditorPanel.current) {
      ScoreSettingsEditorPanel.current = new ScoreSettingsEditorPanel(extensionUri, locale);
    }
    ScoreSettingsEditorPanel.current.load(doc, sectionId);
  }

  static isOpen(): boolean {
    return ScoreSettingsEditorPanel.current !== undefined;
  }

  private constructor(extensionUri: vscode.Uri, locale: SupportedLocale) {
    this.m = getScoreSettingsEditorMessages(locale);
    this.messages = getMessages(locale);
    const mediaRoot = vscode.Uri.joinPath(extensionUri, 'media');
    this.panel = vscode.window.createWebviewPanel('guitardslScoreSettings', this.m.panelTitle, vscode.ViewColumn.Active, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [mediaRoot]
    });
    const scriptUri = this.panel.webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, 'scoreSettingsEditor.js')).toString();
    this.panel.webview.html = renderScoreSettingsEditorHtml(this.m, scriptUri, locale);
    this.panel.webview.onDidReceiveMessage(msg => this.onMessage(msg), undefined, this.disposables);
    vscode.workspace.onDidChangeTextDocument(e => {
      if (this.doc && e.document.uri.toString() === this.doc.uri.toString()) {
        this.doc = e.document;
        this.postModel();
      }
    }, undefined, this.disposables);
    this.panel.onDidDispose(() => {
      ScoreSettingsEditorPanel.current = undefined;
      this.disposables.forEach(d => d.dispose());
    });
  }

  private load(doc: vscode.TextDocument, sectionId: string): void {
    if (!this.doc || this.doc.uri.toString() !== doc.uri.toString()) {
      this.sections.forEach(s => s.reset());
    }
    this.doc = doc;
    if (this.sections.some(s => s.id === sectionId)) this.activeSection = sectionId;
    const name = doc.uri.path.split('/').pop() ?? '';
    this.panel.title = name ? `${this.m.panelTitle}: ${name}` : this.m.panelTitle;
    this.panel.reveal();
    if (this.ready) this.postModel();
  }

  private context(): ScoreSettingsSectionContext {
    return {
      doc: this.doc,
      messages: this.messages,
      editorMessages: this.m,
      refresh: () => this.postModel(),
      status: (text, error) => {
        void this.panel.webview.postMessage({ type: 'status', text, error: error === true });
      }
    };
  }

  private postModel(): void {
    if (!this.ready || !this.doc) return;
    const ctx = this.context();
    const section = this.sections.find(s => s.id === this.activeSection) ?? this.sections[0];
    void this.panel.webview.postMessage({
      type: 'load',
      sections: this.sections.map(s => ({ id: s.id, title: s.title(this.m) })),
      active: section.id,
      model: section.buildModel(ctx),
      capoRange: [MIN_CAPO, MAX_CAPO]
    });
  }

  private async onMessage(msg: any): Promise<void> {
    if (!msg || typeof msg.command !== 'string') return;
    if (msg.command === 'ready') {
      this.ready = true;
      this.postModel();
    } else if (msg.command === 'close') {
      this.panel.dispose();
    } else if (msg.command === 'showSection') {
      if (this.sections.some(s => s.id === msg.section)) {
        this.activeSection = msg.section;
        this.postModel();
      }
    } else {
      const section = this.sections.find(s => s.id === msg.section);
      if (section && this.doc) await section.onMessage(this.context(), msg);
    }
  }
}
