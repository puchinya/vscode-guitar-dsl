import * as vscode from 'vscode';
import { findGuitarDslInlineCommentStart, parseGuitarDsl } from './compiler';
import { isGuitarDslDocument } from './documentResolver';
import { resolveLocale, getMessages, type SupportedLocale } from './i18n';
import { planProgressionEdit, type ProgressionEditOperation, type ProgressionEditTarget } from './progressionSourceEdits';
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

export type ProgressionAuditionMode = 'chord' | 'bars' | 'melody' | 'song';

export interface ProgressionAssistantRenderOptions {
  openIfNeeded?: boolean;
  startPlayback?: ProgressionAuditionMode;
}

export interface ProgressionAssistantSession {
  uri: string;
  version: number;
  sessionGeneration: number;
  source: string;
  target: ProgressionEditTarget;
  candidates: ProgressionCandidate[];
  activeCandidateId: string;
  side: 'A' | 'B';
  auditionSpeed: 50 | 75 | 100 | 125 | 150;
}

export interface ProgressionAssistantPreviewController {
  render(session: ProgressionAssistantSession, options?: ProgressionAssistantRenderOptions): Promise<void> | void;
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

interface CandidatePickItem extends vscode.QuickPickItem {
  candidate: ProgressionCandidate;
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
  private provisionalSession: ProgressionAssistantSession | undefined;
  private candidatePicker: vscode.QuickPick<CandidatePickItem> | undefined;
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

  constructor(private readonly preview: ProgressionAssistantPreviewController, locale?: string) {
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
    context.subscriptions.push(vscode.commands.registerCommand(SUGGEST_CHORD_PROGRESSION_COMMAND, target => this.runCommand(target)));
    context.subscriptions.push(vscode.commands.registerCommand(CHOOSE_PROGRESSION_CANDIDATE_COMMAND, target => this.chooseFromSession(target)));
    context.subscriptions.push(vscode.commands.registerCommand(PLAY_PROGRESSION_AUDITION_COMMAND, () => this.play()));
    context.subscriptions.push(vscode.commands.registerCommand(STOP_PROGRESSION_AUDITION_COMMAND, () => this.stop()));
    context.subscriptions.push(vscode.commands.registerCommand(SHOW_PROGRESSION_A_COMMAND, () => this.setSide('A')));
    context.subscriptions.push(vscode.commands.registerCommand(SHOW_PROGRESSION_B_COMMAND, () => this.setSide('B')));
    context.subscriptions.push(vscode.commands.registerCommand(APPLY_PROGRESSION_CANDIDATE_COMMAND, () => this.applyCandidate(this.session?.activeCandidateId)));
    context.subscriptions.push(vscode.commands.registerCommand(CLOSE_PROGRESSION_ASSISTANT_COMMAND, () => this.closeSession()));
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

  private async runCommand(targetRef?: unknown): Promise<void> {
    const resolved = this.resolveCommandTarget(targetRef);
    if (!resolved) {
      vscode.window.showWarningMessage(this.messages.progressionNoDocument);
      return;
    }
    const { editor, score, source, version, target: cursorTarget } = resolved;
    const length = await vscode.window.showQuickPick([
      { label: this.messages.progressionLengthFour, bars: 4 as const },
      { label: this.messages.progressionLengthEight, bars: 8 as const },
      { label: this.messages.progressionLengthSixteen, bars: 16 as const }
    ], { placeHolder: this.messages.progressionLengthPrompt, ignoreFocusOut: true });
    if (!length) return;
    if (editor.document.version !== version
      || editor.document.getText() !== source) {
      vscode.window.showWarningMessage(this.messages.progressionApplyFailed);
      return;
    }

    const replaceTarget = { ...cursorTarget, bars: length.bars, operation: 'replace' as const };
    const appendTarget = {
      ...cursorTarget,
      ...targetForMeasure(score, score.measures.length),
      bars: length.bars,
      operation: 'append' as const
    };
    const operations: { label: string; operation: ProgressionEditOperation; target: ProgressionEditTarget }[] = [];
    if (cursorTarget.startMeasure + length.bars <= score.measures.length) operations.push({ label: this.messages.progressionReplace, operation: 'replace', target: replaceTarget });
    operations.push({ label: this.messages.progressionAppend, operation: 'append', target: appendTarget });
    const operationChoice = await vscode.window.showQuickPick(operations.map(item => ({ label: item.label, description: item.operation })), {
      placeHolder: this.messages.progressionOperationPrompt,
      ignoreFocusOut: true
    });
    if (!operationChoice) return;
    if (editor.document.version !== version || editor.document.getText() !== source) {
      vscode.window.showWarningMessage(this.messages.progressionApplyFailed);
      return;
    }
    const selectedOperation = operations.find(item => item.label === operationChoice.label);
    if (!selectedOperation) return;

    const target: ProgressionTarget = selectedOperation.target;
    const suggestions = suggestProgressions(score, target, length.bars as ProgressionBars);
    if (!suggestions.ok) {
      vscode.window.showWarningMessage(suggestionFailureMessage(suggestions.code, this.messages));
      return;
    }
    const candidates = suggestions.candidates.filter(candidate =>
      planProgressionEdit(source, score, selectedOperation.target, candidate).ok
    );
    if (candidates.length === 0) {
      vscode.window.showWarningMessage(this.messages.progressionNoSafeCandidates);
      return;
    }
    const priorSession = this.session;
    const candidateSession: ProgressionAssistantSession = {
      uri: editor.document.uri.toString(), version, source,
      sessionGeneration: ++nextProgressionAssistantSessionGeneration,
      target: selectedOperation.target,
      candidates,
      activeCandidateId: candidates[0].id,
      side: 'B',
      auditionSpeed: priorSession?.uri === editor.document.uri.toString() ? priorSession.auditionSpeed : 100
    };
    const pick = await this.chooseCandidate(candidateSession);
    if (!pick) return;
    if (!this.isSessionFresh(candidateSession)) {
      vscode.window.showWarningMessage(this.messages.progressionApplyFailed);
      return;
    }
    candidateSession.activeCandidateId = pick.id;
    this.provisionalSession = undefined;
    this.session = candidateSession;
    void vscode.commands.executeCommand('setContext', 'guitardsl.progressionAssistantActive', true);
    this.codeLensChanges.fire();
    this.updateDecorations();
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

  private chooseCandidate(session: ProgressionAssistantSession): Promise<ProgressionCandidate | undefined> {
    const quickPick = vscode.window.createQuickPick<CandidatePickItem>();
    this.candidatePicker = quickPick;
    quickPick.title = this.messages.progressionCandidatePrompt;
    quickPick.placeholder = this.messages.progressionCandidatePrompt;
    quickPick.ignoreFocusOut = true;
    quickPick.canSelectMany = false;
    quickPick.matchOnDescription = true;
    quickPick.matchOnDetail = true;
    const items: CandidatePickItem[] = session.candidates.slice(0, 5).map(candidate => ({
      label: candidate.chords.join('  →  '),
      description: this.messages.progressionCompletionDetail(candidate.score.total),
      detail: candidate.key + ' ' + candidate.mode + ' · ' + candidate.romanNumerals.join('–') + '\n'
        + formatBreakdown(candidate, this.locale, this.messages),
      candidate
    }));
    quickPick.items = items;
    const currentItem = items.find(item => item.candidate.id === session.activeCandidateId) ?? items[0];
    if (currentItem) quickPick.activeItems = [currentItem];
    let accepted: ProgressionCandidate | undefined;
    return new Promise(resolve => {
      quickPick.onDidChangeActive(active => {
        const item = active[0];
        if (!item) return;
        this.provisionalSession = { ...session, activeCandidateId: item.candidate.id };
        this.updateDecorations();
      });
      quickPick.onDidAccept(() => {
        const item = quickPick.selectedItems[0] ?? quickPick.activeItems[0];
        if (!item || !this.isSessionFresh(session)) {
          if (item) vscode.window.showWarningMessage(this.messages.progressionApplyFailed);
          quickPick.hide();
          return;
        }
        accepted = item.candidate;
        quickPick.hide();
      });
      quickPick.onDidHide(() => {
        this.candidatePicker = undefined;
        this.provisionalSession = undefined;
        if (!accepted) this.updateDecorations();
        quickPick.dispose();
        resolve(accepted);
      });
      const selected = items.find(item => item.candidate.id === session.activeCandidateId) ?? items[0];
      if (selected) {
        this.provisionalSession = { ...session, activeCandidateId: selected.candidate.id };
        this.updateDecorations();
      }
      quickPick.show();
    });
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
    const picked = await this.chooseCandidate(session);
    if (!picked || !this.isSessionFresh(session)) return;
    session.activeCandidateId = picked.id;
    session.side = 'B';
    this.updateDecorations();
    this.codeLensChanges.fire();
    await this.preview.render(session);
  }

  private async play(): Promise<void> {
    const session = await this.currentSession();
    if (!session) return;
    await this.preview.render(session, { openIfNeeded: true, startPlayback: 'melody' });
  }

  private async stop(): Promise<void> {
    const session = await this.currentSession();
    if (session) this.preview.stop(session.uri);
  }

  private async setSide(side: 'A' | 'B'): Promise<void> {
    const session = await this.currentSession();
    if (!session || session.side === side) return;
    session.side = side;
    this.updateDecorations();
    await this.preview.render(session);
  }

  private async closeSession(): Promise<void> {
    const session = await this.currentSession();
    if (session) this.clear(session.uri, true);
  }

  private messageMatchesSession(message: Record<string, unknown>): boolean {
    return !!this.session && message.sessionUri === this.session.uri
      && Number(message.sessionVersion) === this.session.version
      && message.sessionGeneration === this.session.sessionGeneration;
  }

  private updateDecorations(): void {
    const editors = vscode.window.visibleTextEditors;
    for (const editor of editors) {
      editor.setDecorations(this.targetDecoration, []);
      editor.setDecorations(this.proposalDecoration, []);
    }
    const session = this.provisionalSession ?? this.session;
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

  async handlePreviewMessage(message: Record<string, unknown>): Promise<boolean> {
    if (message.command === 'progressionDismiss') {
      if (this.messageMatchesSession(message) && this.session) this.clear(this.session.uri, true);
      return true;
    }
    if (message.command === 'progressionCandidateChanged') {
      if (!this.messageMatchesSession(message) || !this.session || typeof message.candidateId !== 'string' || !this.isSessionFresh(this.session)) return true;
      const candidate = this.session.candidates.find(item => item.id === message.candidateId);
      if (!candidate) return true;
      this.session.activeCandidateId = candidate.id;
      this.session.side = 'B';
      this.updateDecorations();
      this.codeLensChanges.fire();
      await this.preview.render(this.session);
      return true;
    }
    if (message.command === 'progressionSideChanged') {
      if (!this.messageMatchesSession(message) || !this.session || (message.side !== 'A' && message.side !== 'B') || !this.isSessionFresh(this.session)) return true;
      if (this.session.side === message.side) return true;
      this.session.side = message.side;
      this.updateDecorations();
      await this.preview.render(this.session);
      return true;
    }
    if (message.command === 'progressionSpeedChanged') {
      if (!this.messageMatchesSession(message) || !this.session || !this.isSessionFresh(this.session)) return true;
      if ([50, 75, 100, 125, 150].includes(Number(message.speed))) {
        this.session.auditionSpeed = Number(message.speed) as ProgressionAssistantSession['auditionSpeed'];
      }
      return true;
    }
    if (message.command === 'progressionApply') {
      if (this.messageMatchesSession(message)) await this.applyCandidate(message.candidateId);
      return true;
    }
    return false;
  }

  invalidate(uri: string): void {
    if (this.session?.uri === uri || this.provisionalSession?.uri === uri) this.clear(uri, false);
  }

  invalidateActive(restore = false): void {
    const uri = this.session?.uri ?? this.provisionalSession?.uri;
    if (uri) this.clear(uri, restore);
  }

  invalidateIfDifferent(uri: string, restore = false): void {
    const activeUri = this.session?.uri ?? this.provisionalSession?.uri;
    if (activeUri && activeUri !== uri) this.clear(activeUri, restore);
  }

  hasActiveSession(uri: string): boolean {
    return this.session?.uri === uri;
  }

  isCurrentSession(session: ProgressionAssistantSession): boolean {
    return this.session === session
      && this.session.sessionGeneration === session.sessionGeneration
      && this.session.uri === session.uri
      && this.session.version === session.version;
  }

  getActiveSessionForTest(): ProgressionAssistantSession | undefined {
    return this.session;
  }

  getProvisionalCandidateIdForTest(): string | undefined {
    return this.provisionalSession?.activeCandidateId;
  }

  getLastResolvedTargetForTest(): ProgressionTarget | undefined {
    return this.lastResolvedTargetForTest;
  }

  private async applyCandidate(candidateId: unknown): Promise<void> {
    const session = this.session;
    if (!session || typeof candidateId !== 'string' || candidateId !== session.activeCandidateId) return;
    const candidate = session.candidates.find(item => item.id === candidateId);
    if (!candidate) return;
    const confirm = await vscode.window.showWarningMessage(
      this.messages.progressionApplyConfirm,
      { modal: true },
      this.messages.uiProgressionApply
    );
    if (confirm !== this.messages.uiProgressionApply) return;
    if (this.applyingUris.has(session.uri)) return;
    this.applyingUris.add(session.uri);
    try {
      const uri = vscode.Uri.parse(session.uri);
      const document = vscode.workspace.textDocuments.find(item => item.uri.toString() === session.uri)
        ?? await vscode.workspace.openTextDocument(uri);
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
    if (this.session?.uri !== uri && this.provisionalSession?.uri !== uri) return;
    this.preview.stop(uri);
    if (this.candidatePicker) this.candidatePicker.hide();
    if (this.session?.uri === uri) this.session = undefined;
    if (this.provisionalSession?.uri === uri) this.provisionalSession = undefined;
    void vscode.commands.executeCommand('setContext', 'guitardsl.progressionAssistantActive', false);
    this.codeLensChanges.fire();
    this.updateDecorations();
    if (restore) void this.preview.restore(uri);
  }

  dispose(): void {
    const uri = this.session?.uri ?? this.provisionalSession?.uri;
    this.session = undefined;
    this.provisionalSession = undefined;
    if (this.candidatePicker) this.candidatePicker.hide();
    if (uri) {
      this.preview.stop(uri);
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
} = {};

export function registerProgressionAssistant(
  context: vscode.ExtensionContext,
  locale: string | undefined,
  preview: ProgressionAssistantPreviewController
): ProgressionAssistantController {
  const controller = new ProgressionAssistantController(preview, locale);
  progressionAssistantProbe.controller = controller;
  progressionAssistantProbe.getSession = () => controller.getActiveSessionForTest();
  progressionAssistantProbe.getProvisionalCandidateId = () => controller.getProvisionalCandidateIdForTest();
  progressionAssistantProbe.getLastResolvedTarget = () => controller.getLastResolvedTargetForTest();
  controller.register(context);
  return controller;
}
