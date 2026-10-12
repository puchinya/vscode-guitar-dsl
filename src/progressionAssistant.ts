import * as vscode from 'vscode';
import { parseGuitarDsl } from './compiler';
import { isGuitarDslDocument } from './documentResolver';
import { resolveLocale, getMessages, type SupportedLocale } from './i18n';
import { planProgressionEdit, type ProgressionEditOperation, type ProgressionEditTarget } from './progressionSourceEdits';
import {
  suggestNextChords,
  suggestProgressions,
  type ProgressionBars,
  type ProgressionCandidate,
  type ProgressionSuggestionFailureCode,
  type ProgressionTarget
} from './progressionSuggestions';

export const SUGGEST_CHORD_PROGRESSION_COMMAND = 'guitardsl.suggestChordProgression';

export interface ProgressionAssistantSession {
  uri: string;
  version: number;
  source: string;
  target: ProgressionEditTarget;
  candidates: ProgressionCandidate[];
  activeCandidateId: string;
}

export interface ProgressionAssistantPreviewController {
  render(session: ProgressionAssistantSession): Promise<void> | void;
  restore(uri: string): Promise<void> | void;
}

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
      ...(chordBefore(score, token.measureIndex, token.line, token.startCol) ? { previousChord: chordBefore(score, token.measureIndex, token.line, token.startCol) } : {})
    };
  }
  const line = editor.document.lineAt(position.line).text;
  const commentStart = line.indexOf('#');
  if (!line.trimStart().startsWith('|') || (commentStart >= 0 && position.character >= commentStart)) return undefined;
  const bar = line.lastIndexOf('|', Math.max(0, position.character - 1));
  const cellStart = bar + 1;
  const measureIndex = (score.measureSourceSpans ?? []).filter(span => span.line < position.line
    || (span.line === position.line && span.endCol <= cellStart)).length;
  const key = score.measures[Math.max(0, measureIndex - 1)]?.context.key
    ?? score.measures[measureIndex]?.context.key
    ?? score.originalKey;
  return {
    startMeasure: measureIndex,
    key,
    ...(chordBefore(score, measureIndex, position.line, position.character) ? { previousChord: chordBefore(score, measureIndex, position.line, position.character) } : {})
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
    case 'keyBoundary': return messages.progressionKeyBoundary;
    case 'invalidTarget': return messages.progressionInvalidTarget;
  }
}

export class ProgressionAssistantController implements vscode.Disposable {
  private session: ProgressionAssistantSession | undefined;
  private readonly applyingUris = new Set<string>();
  private readonly locale: SupportedLocale;
  private readonly messages: ReturnType<typeof getMessages>;

  constructor(private readonly preview: ProgressionAssistantPreviewController, locale?: string) {
    this.locale = resolveLocale(locale ?? vscode.env.language);
    this.messages = getMessages(this.locale);
  }

  register(context: vscode.ExtensionContext): void {
    context.subscriptions.push(vscode.commands.registerCommand(SUGGEST_CHORD_PROGRESSION_COMMAND, () => this.runCommand()));
    context.subscriptions.push(this);
  }

  private async runCommand(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || !isGuitarDslDocument(editor.document)) {
      vscode.window.showWarningMessage(this.messages.progressionNoDocument);
      return;
    }
    const source = editor.document.getText();
    const version = editor.document.version;
    const score = parseGuitarDsl(source);
    if (score.diagnostics.some(diagnostic => diagnostic.severity === 'error')) {
      vscode.window.showWarningMessage(this.messages.progressionSourceErrors);
      return;
    }
    const cursorTarget = targetAt(score, editor);
    if (!cursorTarget) {
      vscode.window.showWarningMessage(this.messages.progressionInvalidTarget);
      return;
    }

    const length = await vscode.window.showQuickPick([
      { label: this.messages.progressionLengthNext, bars: 1 as const },
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
      startMeasure: score.measures.length,
      key: score.measures[score.measures.length - 1]?.context.key ?? score.originalKey,
      previousChord: chordBefore(score, score.measures.length, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER),
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
    const suggestions = length.bars === 1
      ? suggestNextChords(score, target)
      : suggestProgressions(score, target, length.bars as ProgressionBars);
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
    const picks = candidates.map(candidate => ({
      label: candidate.chords.join('  →  '),
      description: this.messages.progressionCompletionDetail(candidate.score.total),
      detail: formatBreakdown(candidate, this.locale, this.messages),
      candidate
    }));
    const pick = await vscode.window.showQuickPick(picks, { placeHolder: this.messages.progressionCandidatePrompt, ignoreFocusOut: true, matchOnDescription: true });
    if (!pick) return;
    if (editor.document.version !== version || editor.document.getText() !== source) {
      vscode.window.showWarningMessage(this.messages.progressionApplyFailed);
      return;
    }

    this.session = {
      uri: editor.document.uri.toString(),
      version,
      source,
      target: selectedOperation.target,
      candidates,
      activeCandidateId: pick.candidate.id
    };
    await this.preview.render(this.session);
  }

  async handlePreviewMessage(message: Record<string, unknown>): Promise<boolean> {
    if (message.command === 'progressionDismiss') {
      if (this.session) this.clear(this.session.uri, true);
      return true;
    }
    if (message.command === 'progressionCandidateChanged') {
      if (!this.session || typeof message.candidateId !== 'string') return true;
      const candidate = this.session.candidates.find(item => item.id === message.candidateId);
      if (!candidate) return true;
      this.session.activeCandidateId = candidate.id;
      await this.preview.render(this.session);
      return true;
    }
    if (message.command === 'progressionApply') {
      await this.applyCandidate(message.candidateId);
      return true;
    }
    return false;
  }

  invalidate(uri: string): void {
    if (this.session?.uri === uri) this.clear(uri, false);
  }

  invalidateActive(restore = false): void {
    if (this.session) this.clear(this.session.uri, restore);
  }

  invalidateIfDifferent(uri: string, restore = false): void {
    if (this.session && this.session.uri !== uri) this.clear(this.session.uri, restore);
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
    if (this.session?.uri !== uri) return;
    this.session = undefined;
    if (restore) void this.preview.restore(uri);
  }

  dispose(): void {
    const uri = this.session?.uri;
    this.session = undefined;
    if (uri) void this.preview.restore(uri);
  }
}

/** Internal E2E seam for exercising the same message handler used by the Preview webview. */
export const progressionAssistantProbe: { controller?: ProgressionAssistantController } = {};

export function registerProgressionAssistant(
  context: vscode.ExtensionContext,
  locale: string | undefined,
  preview: ProgressionAssistantPreviewController
): ProgressionAssistantController {
  const controller = new ProgressionAssistantController(preview, locale);
  progressionAssistantProbe.controller = controller;
  controller.register(context);
  return controller;
}
