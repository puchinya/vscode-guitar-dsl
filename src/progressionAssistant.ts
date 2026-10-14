import * as vscode from 'vscode';
import { findGuitarDslInlineCommentStart, parseGuitarDsl } from './compiler';
import { isGuitarDslDocument } from './documentResolver';
import { resolveLocale, getMessages, type SupportedLocale } from './i18n';
import {
  type GuitarDslInspectorController,
  type InspectorProgressionBars,
  type InspectorProgressionAuditionMode,
  type InspectorProgressionContext,
  type InspectorProgressionMessage,
  type InspectorContext
} from './inspector/inspectorController';
import { planProgressionEdit, type ProgressionEditOperation, type ProgressionEditTarget } from './progressionSourceEdits';
import type { ProgressionAudioStartRequest } from './progressionAudioLease';
import {
  suggestProgressions,
  resolveProgressionTargetKey,
  type ProgressionBars,
  type ProgressionCandidate,
  type ProgressionSuggestionFailureCode,
  type ProgressionTarget
} from './progressionSuggestions';

export const SUGGEST_CHORD_PROGRESSION_COMMAND = 'guitardsl.suggestChordProgression';
export const CHOOSE_PROGRESSION_CANDIDATE_COMMAND = 'guitardsl.progression.chooseCandidate';
export const PLAY_PROGRESSION_AUDITION_COMMAND = 'guitardsl.progression.play';
export const STOP_PROGRESSION_AUDITION_COMMAND = 'guitardsl.progression.stop';
export const SHOW_PROGRESSION_A_COMMAND = 'guitardsl.progression.showOriginal';
export const SHOW_PROGRESSION_B_COMMAND = 'guitardsl.progression.showCandidate';
export const APPLY_PROGRESSION_CANDIDATE_COMMAND = 'guitardsl.progression.apply';
export const CLOSE_PROGRESSION_ASSISTANT_COMMAND = 'guitardsl.progression.close';

export type ProgressionAuditionMode = InspectorProgressionAuditionMode;

export interface ProgressionAssistantRenderOptions {
  openIfNeeded?: boolean;
}

export interface ProgressionAssistantSession {
  uri: string;
  version: number;
  sessionGeneration: number;
  source: string;
  originTarget: ProgressionTarget;
  target: ProgressionEditTarget;
  candidates: ProgressionCandidate[];
  activeCandidateId: string;
  proposalRevision: number;
  side: 'A' | 'B';
  auditionMode: ProgressionAuditionMode;
  auditionSpeed: 50 | 75 | 100 | 125 | 150;
}

export interface ProgressionAssistantSessionIdentity {
  uri: string;
  version: number;
  sessionGeneration: number;
}

export interface ProgressionAssistantPreviewController {
  render(session: ProgressionAssistantSession, options?: ProgressionAssistantRenderOptions): Promise<void> | void;
  playAudition(session: ProgressionAssistantSession, request: ProgressionAudioStartRequest): Promise<void> | void;
  stop(uri: string): void;
  restore(uri: string): Promise<void> | void;
}

interface ProgressionCodeLensTarget {
  uri: string;
  version: number;
  measureIndex: number;
  line: number;
  character: number;
}

interface ProgressionCandidateResult {
  target: ProgressionEditTarget;
  candidates: ProgressionCandidate[];
  error?: string;
}

let nextProgressionAssistantSessionGeneration = 0;

function chordBefore(score: ReturnType<typeof parseGuitarDsl>, measureIndex: number, line: number, character: number): string | undefined {
  const tokens = (score.codeActionTokens ?? [])
    .filter(token => token.kind === 'chord' && token.measureIndex !== undefined
      && (token.measureIndex < measureIndex || (token.measureIndex === measureIndex && (token.line < line || (token.line === line && token.startCol < character)))))
    .sort((a, b) => (a.measureIndex ?? 0) - (b.measureIndex ?? 0) || a.line - b.line || a.startCol - b.startCol);
  const token = tokens[tokens.length - 1];
  return token && score.chordTokens?.find(span => span.line === token.line && span.startCol === token.startCol)?.name;
}

function targetAt(score: ReturnType<typeof parseGuitarDsl>, editor: vscode.TextEditor): ProgressionTarget | undefined {
  const position = editor.selection.active;
  const token = (score.codeActionTokens ?? []).find(item => item.kind === 'chord' && item.line === position.line
    && item.startCol <= position.character && position.character <= item.endCol && item.measureIndex !== undefined);
  if (token?.measureIndex !== undefined) {
    return {
      startMeasure: token.measureIndex,
      key: resolveProgressionTargetKey(score, token.measureIndex, true),
      ...(chordBefore(score, token.measureIndex, token.line, token.startCol) ? { previousChord: chordBefore(score, token.measureIndex, token.line, token.startCol) } : {})
    };
  }
  const line = editor.document.lineAt(position.line).text;
  const commentStart = findGuitarDslInlineCommentStart(line);
  if (!line.trimStart().startsWith('|') || (commentStart >= 0 && position.character >= commentStart)) return undefined;
  const bar = line.lastIndexOf('|', Math.max(0, position.character - 1));
  const cellStart = bar + 1;
  const measureIndex = (score.measureSourceSpans ?? []).filter(span => span.line < position.line
    || (span.line === position.line && span.endCol <= cellStart)).length;
  const key = resolveProgressionTargetKey(score, measureIndex, true);
  return {
    startMeasure: measureIndex,
    key,
    ...(chordBefore(score, measureIndex, position.line, position.character) ? { previousChord: chordBefore(score, measureIndex, position.line, position.character) } : {})
  };
}

function targetForMeasure(score: ReturnType<typeof parseGuitarDsl>, measureIndex: number, includePendingKeyChange = true): ProgressionTarget {
  const previousChord = chordBefore(score, measureIndex, -1, -1);
  const key = resolveProgressionTargetKey(score, measureIndex, includePendingKeyChange);
  return {
    startMeasure: measureIndex,
    key,
    ...(previousChord ? { previousChord } : {})
  };
}

function formatBreakdown(candidate: ProgressionCandidate, locale: SupportedLocale, messages: ReturnType<typeof getMessages>): string {
  const melody = candidate.melodyEvaluated
    ? `${candidate.score.melody >= 0 ? '+' : ''}${candidate.score.melody}`
    : locale === 'ja' ? '評価なし' : 'not evaluated';
  return messages.progressionScoreBreakdown(
    candidate.score.followsPreviousRoot,
    candidate.score.identicalOpeningChord,
    candidate.score.tonicEnding,
    melody
  );
}

function suggestionFailureMessage(code: ProgressionSuggestionFailureCode, messages: ReturnType<typeof getMessages>): string {
  switch (code) {
    case 'sourceHasErrors': return messages.progressionSourceErrors;
    case 'keyNotDeclared': return messages.progressionKeyRequired;
    case 'invalidKey': return messages.progressionInvalidKey;
    case 'invalidCapo': return messages.progressionInvalidCapo;
    case 'unsupportedQuality': return messages.progressionUnsupportedQuality;
    case 'ambiguousHarmony': return messages.progressionAmbiguousHarmony;
    case 'keyBoundary': return messages.progressionKeyBoundary;
    case 'invalidTarget': return messages.progressionInvalidTarget;
  }
}

export class ProgressionAssistantController implements vscode.Disposable {
  private session: ProgressionAssistantSession | undefined;
  private readonly applyingUris = new Set<string>();
  private readonly locale: SupportedLocale;
  private readonly messages: ReturnType<typeof getMessages>;
  private lastResolvedTargetForTest: ProgressionTarget | undefined;
  private readonly codeLensChanges = new vscode.EventEmitter<void>();
  private readonly targetDecoration = vscode.window.createTextEditorDecorationType({
    backgroundColor: new vscode.ThemeColor('editor.findMatchHighlightBackground'),
    border: '1px solid var(--vscode-editorInfo-foreground)',
    overviewRulerColor: new vscode.ThemeColor('editorInfo.foreground'),
    overviewRulerLane: vscode.OverviewRulerLane.Right
  });
  private readonly proposalDecoration = vscode.window.createTextEditorDecorationType({
    after: { color: new vscode.ThemeColor('editorCodeLens.foreground'), fontStyle: 'italic' }
  });

  constructor(
    private readonly preview: ProgressionAssistantPreviewController,
    locale?: string,
    private readonly inspector?: GuitarDslInspectorController
  ) {
    this.locale = resolveLocale(locale ?? vscode.env.language);
    this.messages = getMessages(this.locale);
  }

  register(context: vscode.ExtensionContext): void {
    const codeLensProvider: vscode.CodeLensProvider = {
      onDidChangeCodeLenses: this.codeLensChanges.event,
      provideCodeLenses: document => this.provideCodeLenses(document)
    };
    context.subscriptions.push(vscode.languages.registerCodeLensProvider({ language: 'guitardsl' }, codeLensProvider));
    context.subscriptions.push(this.codeLensChanges, this.targetDecoration, this.proposalDecoration);
    context.subscriptions.push(vscode.window.onDidChangeVisibleTextEditors(() => this.updateDecorations()));
    context.subscriptions.push(vscode.commands.registerCommand(SUGGEST_CHORD_PROGRESSION_COMMAND,
      target => this.withExplicitIntent(() => this.runCommand(target))));
    context.subscriptions.push(vscode.commands.registerCommand(CHOOSE_PROGRESSION_CANDIDATE_COMMAND,
      target => this.withExplicitIntent(() => this.chooseFromSession(target))));
    context.subscriptions.push(vscode.commands.registerCommand(PLAY_PROGRESSION_AUDITION_COMMAND,
      () => this.withExplicitIntent(() => this.play())));
    context.subscriptions.push(vscode.commands.registerCommand(STOP_PROGRESSION_AUDITION_COMMAND,
      () => this.withExplicitIntent(() => this.stop())));
    context.subscriptions.push(vscode.commands.registerCommand(SHOW_PROGRESSION_A_COMMAND,
      () => this.withExplicitIntent(() => this.setSide('A'))));
    context.subscriptions.push(vscode.commands.registerCommand(SHOW_PROGRESSION_B_COMMAND,
      () => this.withExplicitIntent(() => this.setSide('B'))));
    context.subscriptions.push(vscode.commands.registerCommand(APPLY_PROGRESSION_CANDIDATE_COMMAND,
      () => this.withExplicitIntent(() => this.applyCandidate(this.session?.activeCandidateId))));
    context.subscriptions.push(vscode.commands.registerCommand(CLOSE_PROGRESSION_ASSISTANT_COMMAND,
      () => this.withExplicitIntent(() => this.closeSession())));
    this.inspector?.setProgressionMessageHandler(message => this.handleInspectorMessage(message));
    void vscode.commands.executeCommand('setContext', 'guitardsl.progressionAssistantActive', false);
    context.subscriptions.push(this);
  }

  private provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    if (!isGuitarDslDocument(document)) return [];
    const source = document.getText();
    const score = parseGuitarDsl(source);
    if (score.diagnostics.some(diagnostic => diagnostic.severity === 'error')) return [];
    const lenses: vscode.CodeLens[] = [];
    for (const span of score.measureSourceSpans ?? []) {
      const sourceLine = document.lineAt(span.line).text;
      if (!sourceLine.trimStart().startsWith('|')) continue;
      const ref: ProgressionCodeLensTarget = {
        uri: document.uri.toString(), version: document.version,
        measureIndex: span.measureIndex, line: span.line, character: span.startCol
      };
      const range = new vscode.Range(span.line, span.startCol, span.line, span.startCol);
      lenses.push(new vscode.CodeLens(range, {
        title: this.messages.progressionSuggestLabel,
        command: SUGGEST_CHORD_PROGRESSION_COMMAND,
        arguments: [ref]
      }));
      if (this.session?.uri === ref.uri && this.session.version === ref.version
        && this.session.target.startMeasure === ref.measureIndex) {
        lenses.push(new vscode.CodeLens(range, {
          title: this.messages.progressionChooseCandidate,
          command: CHOOSE_PROGRESSION_CANDIDATE_COMMAND,
          arguments: [ref]
        }));
      }
    }
    if (this.session?.uri === document.uri.toString() && this.session.version === document.version
      && this.session.target.operation === 'append') {
      const lastLine = Math.max(0, document.lineCount - 1);
      const lastCharacter = document.lineAt(lastLine).text.length;
      lenses.push(new vscode.CodeLens(new vscode.Range(lastLine, lastCharacter, lastLine, lastCharacter), {
        title: this.messages.progressionChooseCandidate,
        command: CHOOSE_PROGRESSION_CANDIDATE_COMMAND,
        arguments: [{ uri: document.uri.toString(), version: document.version, measureIndex: this.session.target.startMeasure, line: lastLine, character: lastCharacter } satisfies ProgressionCodeLensTarget]
      }));
    }
    return lenses;
  }

  private withExplicitIntent<T>(action: () => T): T {
    this.inspector?.beginExplicitIntent();
    return action();
  }

  private async runCommand(targetRef?: unknown): Promise<void> {
    const resolved = this.resolveCommandTarget(targetRef);
    if (!resolved) {
      vscode.window.showWarningMessage(this.messages.progressionNoDocument);
      return;
    }
    const { editor, score, source, version, target: cursorTarget } = resolved;
    const priorSession = this.session;
    const replace = this.candidateResult(source, score, cursorTarget, 4, 'replace');
    const append = this.candidateResult(source, score, cursorTarget, 4, 'append');
    const initial = replace.candidates.length > 0 ? replace : append;
    if (!initial.target) return;
    const candidateSession: ProgressionAssistantSession = {
      uri: editor.document.uri.toString(), version, source,
      sessionGeneration: ++nextProgressionAssistantSessionGeneration,
      originTarget: cursorTarget,
      target: initial.target,
      candidates: initial.candidates,
      activeCandidateId: initial.candidates[0]?.id ?? '',
      proposalRevision: 0,
      side: 'B',
      auditionMode: 'melody',
      auditionSpeed: priorSession?.uri === editor.document.uri.toString() ? priorSession.auditionSpeed : 100
    };
    if (!this.isSessionFresh(candidateSession)) {
      vscode.window.showWarningMessage(this.messages.progressionApplyFailed);
      return;
    }
    if (priorSession) this.clear(priorSession.uri, false);
    this.session = candidateSession;
    void vscode.commands.executeCommand('setContext', 'guitardsl.progressionAssistantActive', true);
    this.codeLensChanges.fire();
    this.updateDecorations();
    this.syncInspector(true);
    await this.preview.render(this.session);
  }

  private resolveCommandTarget(ref: unknown): { editor: vscode.TextEditor; score: ReturnType<typeof parseGuitarDsl>; source: string; version: number; target: ProgressionTarget } | undefined {
    let editor: vscode.TextEditor | undefined;
    let measureIndex: number | undefined;
    if (ref && typeof ref === 'object' && 'uri' in ref && 'version' in ref && 'measureIndex' in ref) {
      const targetRef = ref as ProgressionCodeLensTarget;
      if (typeof targetRef.uri !== 'string' || !Number.isInteger(targetRef.version) || !Number.isInteger(targetRef.measureIndex)) return undefined;
      const document = vscode.workspace.textDocuments.find(item => item.uri.toString() === targetRef.uri);
      editor = vscode.window.visibleTextEditors.find(item => item.document.uri.toString() === targetRef.uri)
        ?? (vscode.window.activeTextEditor?.document.uri.toString() === targetRef.uri ? vscode.window.activeTextEditor : undefined);
      if (!document || !editor || document.version !== targetRef.version) {
        vscode.window.showWarningMessage(this.messages.progressionApplyFailed);
        return undefined;
      }
      measureIndex = targetRef.measureIndex;
    } else {
      editor = vscode.window.activeTextEditor;
    }
    if (!editor || !isGuitarDslDocument(editor.document)) return undefined;
    const source = editor.document.getText();
    const version = editor.document.version;
    const score = parseGuitarDsl(source);
    if (score.diagnostics.some(diagnostic => diagnostic.severity === 'error')) {
      vscode.window.showWarningMessage(this.messages.progressionSourceErrors);
      return undefined;
    }
    const target = measureIndex === undefined ? targetAt(score, editor) : targetForMeasure(score, measureIndex);
    if (!target || measureIndex !== undefined && !score.measureSourceSpans?.some(span => span.measureIndex === measureIndex)) {
      vscode.window.showWarningMessage(this.messages.progressionInvalidTarget);
      return undefined;
    }
    this.lastResolvedTargetForTest = target;
    return { editor, source, version, score, target };
  }

  private candidateResult(
    source: string,
    score: ReturnType<typeof parseGuitarDsl>,
    originTarget: ProgressionTarget,
    bars: ProgressionBars,
    operation: ProgressionEditOperation
  ): ProgressionCandidateResult {
    const baseTarget = operation === 'replace' ? originTarget : targetForMeasure(score, score.measures.length);
    const target: ProgressionEditTarget = { ...baseTarget, bars, operation };
    const suggestions = suggestProgressions(score, target, bars);
    if (!suggestions.ok) return { target, candidates: [], error: suggestionFailureMessage(suggestions.code, this.messages) };
    const candidates = suggestions.candidates.filter(candidate =>
      planProgressionEdit(source, score, target, candidate).ok
    ).slice(0, 5);
    return candidates.length > 0
      ? { target, candidates }
      : { target, candidates, error: this.messages.progressionNoSafeCandidates };
  }

  private inspectorContext(session: ProgressionAssistantSession): InspectorProgressionContext {
    const score = parseGuitarDsl(session.source);
    const operations: ProgressionEditOperation[] = ['replace', 'append'];
    const barsOptions: ProgressionBars[] = [4, 8, 16];
    const availableBars = barsOptions.filter(bars => operations.some(operation =>
      this.candidateResult(session.source, score, session.originTarget, bars, operation).candidates.length > 0
    ));
    const availableOperations = operations.filter(operation =>
      this.candidateResult(session.source, score, session.originTarget, session.target.bars as ProgressionBars, operation).candidates.length > 0
    );
    const current = this.candidateResult(session.source, score, session.originTarget, session.target.bars as ProgressionBars, session.target.operation);
    const selectedCandidateId = session.candidates.some(candidate => candidate.id === session.activeCandidateId)
      ? session.activeCandidateId
      : '';
    return {
      kind: 'progression',
      uri: session.uri,
      version: session.version,
      sessionGeneration: session.sessionGeneration,
      target: {
        startMeasure: session.target.startMeasure,
        bars: session.target.bars as InspectorProgressionBars,
        operation: session.target.operation
      },
      availableBars,
      availableOperations,
      candidates: session.candidates.slice(0, 5).map(candidate => ({
        id: candidate.id,
        chords: candidate.chords,
        score: candidate.score.total,
        scoreText: this.messages.progressionCompletionDetail(candidate.score.total),
        rationale: `${candidate.key} ${candidate.mode} · ${candidate.romanNumerals.join('–')}\n${formatBreakdown(candidate, this.locale, this.messages)}`
      })),
      selectedCandidateId,
      side: session.side,
      auditionMode: session.auditionMode,
      auditionSpeed: session.auditionSpeed,
      loading: false,
      ...(session.candidates.length === 0 ? { error: current.error ?? this.messages.progressionNoSafeCandidates } : {})
    };
  }

  private syncInspector(reveal = false): void {
    if (!this.inspector || !this.session) return;
    const context = this.inspectorContext(this.session);
    if (reveal) void this.inspector.showProgression(context);
    else this.inspector.updateProgression(context);
  }

  private async updateControls(bars: ProgressionBars, operation: ProgressionEditOperation): Promise<void> {
    const session = this.session;
    if (!session || !this.isSessionFresh(session)) return;
    const score = parseGuitarDsl(session.source);
    const result = this.candidateResult(session.source, score, session.originTarget, bars, operation);
    const selected = result.candidates.find(candidate => candidate.id === session.activeCandidateId) ?? result.candidates[0];
    session.target = result.target;
    session.candidates = result.candidates;
    session.activeCandidateId = selected?.id ?? '';
    session.proposalRevision++;
    this.preview.stop(session.uri);
    this.updateDecorations();
    this.codeLensChanges.fire();
    this.syncInspector();
    await this.preview.render(session);
  }

  private async handleInspectorMessage(message: InspectorProgressionMessage): Promise<void> {
    const session = this.session;
    if (!session) return;
    if (message.sessionUri !== session.uri || message.sessionVersion !== session.version
      || message.sessionGeneration !== session.sessionGeneration || !this.isSessionFresh(session)) return;
    if (message.command === 'progressionCandidateChanged') {
      if (typeof message.candidateId !== 'string' || message.selectedCandidateId !== message.candidateId) return;
      const candidate = session.candidates.find(item => item.id === message.candidateId);
      if (!candidate) return;
      if (session.activeCandidateId !== candidate.id) session.proposalRevision++;
      session.activeCandidateId = candidate.id;
      session.side = 'B';
      this.preview.stop(session.uri);
      this.updateDecorations();
      this.codeLensChanges.fire();
      this.syncInspector();
      await this.preview.render(session);
      return;
    }
    if (message.selectedCandidateId !== session.activeCandidateId) return;
    if (message.command === 'progressionSetBars') {
      const bars = Number(message.bars);
      if ((bars === 4 || bars === 8 || bars === 16) && this.inspectorContext(session).availableBars.includes(bars)) {
        const nextContext = this.inspectorContext({ ...session, target: { ...session.target, bars }, candidates: [] });
        const nextOperation = nextContext.availableOperations.includes(session.target.operation)
          ? session.target.operation
          : nextContext.availableOperations[0];
        if (nextOperation) await this.updateControls(bars as ProgressionBars, nextOperation);
      }
      return;
    }
    if (message.command === 'progressionSetOperation') {
      const operation = message.operation;
      if ((operation === 'replace' || operation === 'append')
        && this.inspectorContext(session).availableOperations.includes(operation)) {
        await this.updateControls(session.target.bars as ProgressionBars, operation);
      }
      return;
    }
    if (message.command === 'progressionPlay') {
      if (!session.activeCandidateId) return;
      if (message.userGesture !== true || typeof message.requestId !== 'string' || !message.requestId) {
        if (typeof message.requestId === 'string') this.inspector?.postProgressionAudioMessage({
          command: 'progressionAudioError', requestId: message.requestId, message: this.messages.uiProgressionAudioUnavailable
        });
        return;
      }
      if (message.audioReady !== true) {
        await this.inspector?.postProgressionAudioMessage({
          command: 'progressionAudioError', requestId: message.requestId, message: this.messages.uiProgressionAudioUnavailable
        });
        return;
      }
      await this.preview.playAudition(session, {
        requestId: message.requestId,
        generation: message.generation,
        sessionUri: session.uri,
        sessionVersion: session.version,
        sessionGeneration: session.sessionGeneration,
        candidateId: session.activeCandidateId,
        side: session.side,
        mode: session.auditionMode,
        speed: session.auditionSpeed
      });
      return;
    }
    if (message.command === 'progressionAuditionModeChanged') {
      if (isProgressionAuditionMode(message.mode) && session.auditionMode !== message.mode) {
        session.auditionMode = message.mode;
        this.preview.stop(session.uri);
        this.syncInspector();
      }
      return;
    }
    if (message.command === 'progressionStop') {
      this.preview.stop(session.uri);
      return;
    }
    if (message.command === 'progressionSideChanged') {
      if ((message.side === 'A' || message.side === 'B') && session.side !== message.side) {
        this.preview.stop(session.uri);
        session.side = message.side;
        this.updateDecorations();
        this.syncInspector();
        await this.preview.render(session);
      }
      return;
    }
    if (message.command === 'progressionSpeedChanged') {
      const speed = Number(message.speed);
      if ([50, 75, 100, 125, 150].includes(speed)) {
        session.auditionSpeed = speed as ProgressionAssistantSession['auditionSpeed'];
        this.preview.stop(session.uri);
        this.syncInspector();
        await this.preview.render(session);
      }
      return;
    }
    if (message.command === 'progressionApply') {
      if (session.activeCandidateId) await this.applyCandidate(session.activeCandidateId);
      return;
    }
    if (message.command === 'progressionDismiss') this.clear(session.uri, true);
  }

  private isSessionFresh(session: ProgressionAssistantSession): boolean {
    const document = vscode.workspace.textDocuments.find(item => item.uri.toString() === session.uri);
    return !!document && document.version === session.version && document.getText() === session.source;
  }

  private async currentSession(): Promise<ProgressionAssistantSession | undefined> {
    const session = this.session;
    if (!session) {
      vscode.window.showWarningMessage(this.messages.progressionNoDocument);
      return undefined;
    }
    if (!this.isSessionFresh(session)) {
      vscode.window.showWarningMessage(this.messages.progressionApplyFailed);
      this.clear(session.uri, true);
      return undefined;
    }
    return session;
  }

  private async chooseFromSession(ref?: unknown): Promise<void> {
    const session = await this.currentSession();
    if (!session) return;
    if (ref && typeof ref === 'object' && 'uri' in ref) {
      const targetRef = ref as ProgressionCodeLensTarget;
      if (targetRef.uri !== session.uri || targetRef.version !== session.version
        || targetRef.measureIndex !== session.target.startMeasure && session.target.operation !== 'append') return;
    }
    this.syncInspector(true);
  }

  private async play(): Promise<void> {
    const session = await this.currentSession();
    if (!session) return;
    await this.preview.render(session, { openIfNeeded: true });
  }

  private async stop(): Promise<void> {
    const session = await this.currentSession();
    if (session) this.preview.stop(session.uri);
  }

  private async setSide(side: 'A' | 'B'): Promise<void> {
    const session = await this.currentSession();
    if (!session || session.side === side) return;
    this.preview.stop(session.uri);
    session.side = side;
    this.updateDecorations();
    this.syncInspector();
    await this.preview.render(session);
  }

  private async closeSession(): Promise<void> {
    const session = await this.currentSession();
    if (session) this.clear(session.uri, true);
  }

  private updateDecorations(): void {
    const editors = vscode.window.visibleTextEditors;
    for (const editor of editors) {
      editor.setDecorations(this.targetDecoration, []);
      editor.setDecorations(this.proposalDecoration, []);
    }
    const session = this.session;
    if (!session) return;
    const editor = editors.find(item => item.document.uri.toString() === session.uri);
    if (!editor || editor.document.version !== session.version || editor.document.getText() !== session.source) return;
    const candidate = session.candidates.find(item => item.id === session.activeCandidateId);
    if (!candidate) return;
    const score = parseGuitarDsl(session.source);
    const plan = planProgressionEdit(session.source, score, session.target, candidate);
    if (!plan.ok) return;
    const targetRanges: vscode.Range[] = [];
    if (session.target.operation === 'replace') {
      for (const measureIndex of Array.from({ length: session.target.bars }, (_, index) => session.target.startMeasure + index)) {
        const span = score.measureSourceSpans?.find(item => item.measureIndex === measureIndex);
        if (span) targetRanges.push(new vscode.Range(span.line, span.startCol, span.line, span.endCol));
      }
    }
    const proposalRanges: vscode.DecorationOptions[] = [];
    if (session.side === 'B') {
      for (const edit of plan.edits) {
        const range = new vscode.Range(editor.document.positionAt(edit.start), editor.document.positionAt(edit.end));
        if (edit.start === edit.end) {
          const text = this.messages.progressionAppendPreview(candidate.chords.join('  →  '));
          proposalRanges.push({ range, renderOptions: { after: { contentText: text } } });
        } else {
          proposalRanges.push({ range, renderOptions: { after: { contentText: '  → ' + edit.text } } });
        }
      }
    }
    editor.setDecorations(this.targetDecoration, targetRanges);
    editor.setDecorations(this.proposalDecoration, proposalRanges);
  }

  invalidate(uri: string): void {
    if (this.session?.uri === uri) this.clear(uri, false);
  }

  invalidateActive(restore = false): void {
    const uri = this.session?.uri;
    if (uri) this.clear(uri, restore);
  }

  invalidateIfDifferent(uri: string, restore = false): void {
    const activeUri = this.session?.uri;
    if (activeUri && activeUri !== uri) this.clear(activeUri, restore);
  }

  /** Restores the Preview only after a caller has stopped and released any active audio lease. */
  async restoreAfterExternalStop(uri: string): Promise<void> {
    if (this.session) return;
    await this.preview.restore(uri);
  }

  hasActiveSession(uri: string): boolean {
    return this.session?.uri === uri;
  }

  isCurrentSession(session: ProgressionAssistantSession): boolean {
    return this.session === session && this.isCurrentSessionIdentity(session);
  }

  isCurrentSessionIdentity(identity: ProgressionAssistantSessionIdentity): boolean {
    return !!this.session
      && this.session.sessionGeneration === identity.sessionGeneration
      && this.session.uri === identity.uri
      && this.session.version === identity.version;
  }

  getActiveSessionIdentity(): ProgressionAssistantSessionIdentity | undefined {
    const session = this.session;
    return session ? { uri: session.uri, version: session.version, sessionGeneration: session.sessionGeneration } : undefined;
  }

  getActiveSessionForTest(): ProgressionAssistantSession | undefined {
    return this.session;
  }

  getProvisionalCandidateIdForTest(): string | undefined {
    return undefined;
  }

  getLastResolvedTargetForTest(): ProgressionTarget | undefined {
    return this.lastResolvedTargetForTest;
  }

  private async applyCandidate(candidateId: unknown): Promise<void> {
    const session = this.session;
    if (!session || typeof candidateId !== 'string' || candidateId !== session.activeCandidateId) return;
    const candidate = session.candidates.find(item => item.id === candidateId);
    if (!candidate) return;
    const proposalRevision = session.proposalRevision;
    const isAuthorizedProposal = () => this.isCurrentSession(session)
      && session.proposalRevision === proposalRevision
      && session.activeCandidateId === candidateId
      && session.candidates.includes(candidate);
    const confirm = await vscode.window.showWarningMessage(
      this.messages.progressionApplyConfirm,
      { modal: true },
      this.messages.uiProgressionApply
    );
    if (confirm !== this.messages.uiProgressionApply) return;
    if (!isAuthorizedProposal()) return;
    if (this.applyingUris.has(session.uri)) return;
    this.applyingUris.add(session.uri);
    try {
      const uri = vscode.Uri.parse(session.uri);
      const document = vscode.workspace.textDocuments.find(item => item.uri.toString() === session.uri)
        ?? await vscode.workspace.openTextDocument(uri);
      if (!isAuthorizedProposal()) return;
      if (document.version !== session.version || document.getText() !== session.source) {
        vscode.window.showWarningMessage(this.messages.progressionApplyFailed);
        this.clear(session.uri, true);
        return;
      }
      const freshScore = parseGuitarDsl(document.getText());
      const plan = planProgressionEdit(document.getText(), freshScore, session.target, candidate);
      if (!plan.ok) {
        vscode.window.showWarningMessage(this.messages.progressionApplyFailed);
        this.clear(session.uri, true);
        return;
      }
      const edit = new vscode.WorkspaceEdit();
      for (const item of plan.edits) {
        edit.replace(document.uri, new vscode.Range(document.positionAt(item.start), document.positionAt(item.end)), item.text);
      }
      if (!isAuthorizedProposal()) return;
      if (document.version !== session.version || document.getText() !== session.source) {
        vscode.window.showWarningMessage(this.messages.progressionApplyFailed);
        this.clear(session.uri, true);
        return;
      }
      const applied = await vscode.workspace.applyEdit(edit);
      if (!applied) {
        vscode.window.showWarningMessage(this.messages.progressionApplyFailed);
        return;
      }
      this.clear(session.uri, false);
    } finally {
      this.applyingUris.delete(session.uri);
    }
  }

  private clear(uri: string, restore: boolean): void {
    if (this.session?.uri !== uri) return;
    this.preview.stop(uri);
    this.session = undefined;
    void vscode.commands.executeCommand('setContext', 'guitardsl.progressionAssistantActive', false);
    this.codeLensChanges.fire();
    this.updateDecorations();
    this.inspector?.restoreDocumentAfterProgression(uri);
    if (restore) void this.preview.restore(uri);
  }

  dispose(): void {
    const uri = this.session?.uri;
    this.session = undefined;
    this.inspector?.setProgressionMessageHandler(undefined);
    if (uri) {
      this.preview.stop(uri);
      this.inspector?.restoreDocumentAfterProgression(uri);
      void this.preview.restore(uri);
    }
    this.updateDecorations();
    this.codeLensChanges.dispose();
    this.targetDecoration.dispose();
    this.proposalDecoration.dispose();
  }
}

/** Internal E2E seam for exercising the same message handler used by the Preview webview. */
export const progressionAssistantProbe: {
  controller?: ProgressionAssistantController;
  getSession?: () => ProgressionAssistantSession | undefined;
  getProvisionalCandidateId?: () => string | undefined;
  getLastResolvedTarget?: () => ProgressionTarget | undefined;
  getInspectorContext?: () => InspectorContext | undefined;
  dispatchInspectorMessage?: (message: Record<string, unknown>) => Promise<boolean>;
} = {};

function isProgressionAuditionMode(value: unknown): value is ProgressionAuditionMode {
  return value === 'chord' || value === 'bars' || value === 'melody' || value === 'song';
}

export function registerProgressionAssistant(
  context: vscode.ExtensionContext,
  locale: string | undefined,
  preview: ProgressionAssistantPreviewController,
  inspector?: GuitarDslInspectorController
): ProgressionAssistantController {
  const controller = new ProgressionAssistantController(preview, locale, inspector);
  progressionAssistantProbe.controller = controller;
  progressionAssistantProbe.getSession = () => controller.getActiveSessionForTest();
  progressionAssistantProbe.getProvisionalCandidateId = () => controller.getProvisionalCandidateIdForTest();
  progressionAssistantProbe.getLastResolvedTarget = () => controller.getLastResolvedTargetForTest();
  progressionAssistantProbe.getInspectorContext = () => inspector?.currentContext;
  progressionAssistantProbe.dispatchInspectorMessage = message => {
    if (!inspector || inspector.currentContext.kind !== 'progression') return Promise.resolve(false);
    const current = inspector.currentContext;
    return inspector.handleWebviewMessage({
      generation: inspector.currentGeneration,
      sessionUri: current.uri,
      sessionVersion: current.version,
      sessionGeneration: current.sessionGeneration,
      selectedCandidateId: current.selectedCandidateId,
      ...message
    });
  };
  controller.register(context);
  return controller;
}
