import * as vscode from 'vscode';
import { computeCodeActionHints } from './analysis';
import { MusicCodeAction, planMusicCodeAction } from './planners';
import { SourceSelection, cursorSelectionForTokenKinds, musicNameSelectionAtCursor } from './sourceIndex';
import { parseGuitarDsl } from '../compiler';
import { getMessages, SupportedLocale } from '../i18n';

export const APPLY_MUSIC_CODE_ACTION_COMMAND = 'guitardsl.applyMusicCodeAction';

interface ApplyCodeActionArgs {
  uri: string;
  version: number;
  selection?: SourceSelection;
  kind: MusicCodeAction['kind'];
  line?: number;
}

function isGuitarDsl(document: vscode.TextDocument): boolean {
  return document.languageId === 'guitardsl' || /\.(guitardsl|gdsl)$/i.test(document.uri.path);
}

export function computeCodeActionDiagnostics(document: vscode.TextDocument, locale: SupportedLocale): vscode.Diagnostic[] {
  if (!isGuitarDsl(document)) return [];
  const source = document.getText();
  const score = parseGuitarDsl(source);
  const messages = getMessages(locale);
  return computeCodeActionHints(source, score).map(hint => {
    const range = new vscode.Range(new vscode.Position(hint.line, hint.startCol), new vscode.Position(hint.line, hint.endCol));
    const message = hint.kind === 'unusedChordDefinition'
      ? messages.hintUnusedChordDefinition(hint.text)
      : messages.hintRepeatedFragmentCandidate(hint.text.split(/\s+/).filter(Boolean).length);
    const diagnostic = new vscode.Diagnostic(range, message, vscode.DiagnosticSeverity.Hint);
    diagnostic.code = hint.kind === 'unusedChordDefinition' ? 'guitardsl.unusedChordDefinition' : 'guitardsl.repeatedFragmentCandidate';
    diagnostic.source = 'GuitarDSL';
    if (hint.kind === 'unusedChordDefinition') diagnostic.tags = [vscode.DiagnosticTag.Unnecessary];
    return diagnostic;
  });
}

class MusicCodeActionProvider implements vscode.CodeActionProvider {
  constructor(private readonly locale: SupportedLocale) {}

  provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range,
    context: vscode.CodeActionContext,
    token: vscode.CancellationToken
  ): vscode.CodeAction[] {
    if (!isGuitarDsl(document) || token.isCancellationRequested) return [];
    const source = document.getText();
    const score = parseGuitarDsl(source);
    if (score.diagnostics.some(diagnostic => diagnostic.severity === 'error')) return [];
    const messages = getMessages(this.locale);
    const selected = { start: document.offsetAt(range.start), end: document.offsetAt(range.end) };
    const only = context.only;
    const permits = (kind: vscode.CodeActionKind) => !only || only.contains(kind);
    const actions: vscode.CodeAction[] = [];
    const add = (title: string, kind: vscode.CodeActionKind, args: ApplyCodeActionArgs, diagnostic?: vscode.Diagnostic) => {
      if (!permits(kind) || token.isCancellationRequested) return;
      const action = new vscode.CodeAction(title, kind);
      action.command = { title, command: APPLY_MUSIC_CODE_ACTION_COMMAND, arguments: [args] };
      if (diagnostic) action.diagnostics = [diagnostic];
      actions.push(action);
    };

    const hasSelection = selected.start < selected.end;
    const inlineSelection = hasSelection ? selected : cursorSelectionForTokenKinds(source, score, selected.start, new Set(['letReference']));
    if (inlineSelection && permits(vscode.CodeActionKind.RefactorInline)) {
      const plan = planMusicCodeAction(source, score, { kind: 'inlineLet', selection: inlineSelection });
      if (plan.ok) add(messages.codeActionInlineLet, vscode.CodeActionKind.RefactorInline, {
        uri: document.uri.toString(), version: document.version, selection: inlineSelection, kind: 'inlineLet'
      });
    }

    const nameSelection = hasSelection ? selected : musicNameSelectionAtCursor(source, score, selected.start);
    if (nameSelection && permits(vscode.CodeActionKind.RefactorRewrite)) {
      const checks: { kind: 'enharmonic' | 'normalizePitchNames'; title: string }[] = [
        { kind: 'enharmonic', title: messages.codeActionEnharmonic },
        { kind: 'normalizePitchNames', title: messages.codeActionNormalizePitchNames }
      ];
      for (const candidate of checks) {
        const plan = planMusicCodeAction(source, score, { kind: candidate.kind, selection: nameSelection });
        if (plan.ok) add(candidate.title, vscode.CodeActionKind.RefactorRewrite, {
          uri: document.uri.toString(), version: document.version, selection: nameSelection, kind: candidate.kind
        });
      }
    }

    if (hasSelection && permits(vscode.CodeActionKind.RefactorExtract)) {
      const plan = planMusicCodeAction(source, score, { kind: 'extractLet', selection: selected });
      if (plan.ok) add(messages.codeActionExtractLet, vscode.CodeActionKind.RefactorExtract, {
        uri: document.uri.toString(), version: document.version, selection: selected, kind: 'extractLet'
      });
    }

    if (hasSelection && permits(vscode.CodeActionKind.RefactorRewrite)) {
      for (const candidate of [
        { kind: 'doubleDuration' as const, title: messages.codeActionDoubleDuration },
        { kind: 'halveDuration' as const, title: messages.codeActionHalveDuration }
      ]) {
        const plan = planMusicCodeAction(source, score, { kind: candidate.kind, selection: selected });
        if (plan.ok) add(candidate.title, vscode.CodeActionKind.RefactorRewrite, {
          uri: document.uri.toString(), version: document.version, selection: selected, kind: candidate.kind
        });
      }
      const semitones = Array.from({ length: 22 }, (_, index) => index < 11 ? index - 11 : index - 10);
      if (semitones.some(value => planMusicCodeAction(source, score, { kind: 'transpose', selection: selected, semitones: value }).ok)) {
        add(messages.codeActionTranspose, vscode.CodeActionKind.RefactorRewrite, { uri: document.uri.toString(), version: document.version, selection: selected, kind: 'transpose' });
      }
    }

    if (permits(vscode.CodeActionKind.RefactorExtract)) {
      for (const diagnostic of context.diagnostics) {
        if (diagnostic.code !== 'guitardsl.repeatedFragmentCandidate') continue;
        const hintSelection = { start: document.offsetAt(diagnostic.range.start), end: document.offsetAt(diagnostic.range.end) };
        const plan = planMusicCodeAction(source, score, { kind: 'extractLet', selection: hintSelection });
        if (plan.ok) add(messages.codeActionExtractLet, vscode.CodeActionKind.RefactorExtract, {
          uri: document.uri.toString(), version: document.version, selection: hintSelection, kind: 'extractLet'
        }, diagnostic);
      }
    }

    if (permits(vscode.CodeActionKind.QuickFix)) {
      for (const diagnostic of context.diagnostics) {
        if (diagnostic.code !== 'guitardsl.unusedChordDefinition') continue;
        const line = diagnostic.range.start.line;
        const plan = planMusicCodeAction(source, score, { kind: 'removeUnusedChordDefinition', line });
        if (plan.ok) add(messages.codeActionRemoveUnusedChord, vscode.CodeActionKind.QuickFix, { uri: document.uri.toString(), version: document.version, kind: 'removeUnusedChordDefinition', line }, diagnostic);
      }
    }
    return token.isCancellationRequested ? [] : actions;
  }
}

const applying = new Set<string>();

async function applyMusicCodeAction(args: ApplyCodeActionArgs, locale: SupportedLocale): Promise<void> {
  const messages = getMessages(locale);
  const key = args.uri;
  if (applying.has(key)) return;
  applying.add(key);
  try {
    const uri = vscode.Uri.parse(args.uri);
    const document = vscode.workspace.textDocuments.find(candidate => candidate.uri.toString() === args.uri);
    if (!document || document.version !== args.version || !isGuitarDsl(document)) {
      await vscode.window.showWarningMessage(messages.msgCodeActionFailed);
      return;
    }
    let action: MusicCodeAction | undefined;
    if (args.kind === 'transpose') {
      const items = Array.from({ length: 22 }, (_, index) => index < 11 ? index - 11 : index - 10)
        .map(semitones => ({ label: messages.codeActionTransposePickItem(semitones), semitones }));
      const picked = await vscode.window.showQuickPick(items, { placeHolder: messages.codeActionTransposePickTitle, ignoreFocusOut: true });
      if (!picked) return;
      if (document.version !== args.version) {
        await vscode.window.showWarningMessage(messages.msgCodeActionFailed);
        return;
      }
      action = { kind: 'transpose', selection: args.selection!, semitones: picked.semitones };
    } else if (args.kind !== 'removeUnusedChordDefinition') {
      action = { kind: args.kind, selection: args.selection! } as MusicCodeAction;
    }
    const source = document.getText();
    const score = parseGuitarDsl(source);
    const plan = args.kind === 'removeUnusedChordDefinition'
      ? planMusicCodeAction(source, score, { kind: 'removeUnusedChordDefinition', line: args.line! })
      : planMusicCodeAction(source, score, action!);
    if (!plan.ok) {
      await vscode.window.showWarningMessage(messages.msgCodeActionFailed);
      return;
    }
    if (document.version !== args.version) {
      await vscode.window.showWarningMessage(messages.msgCodeActionFailed);
      return;
    }
    const workspaceEdit = new vscode.WorkspaceEdit();
    for (const edit of plan.edits) {
      workspaceEdit.replace(uri, new vscode.Range(document.positionAt(edit.start), document.positionAt(edit.end)), edit.text);
    }
    const applied = await vscode.workspace.applyEdit(workspaceEdit);
    if (!applied) await vscode.window.showWarningMessage(messages.msgCodeActionFailed);
  } finally {
    applying.delete(key);
  }
}

export function registerMusicCodeActions(context: vscode.ExtensionContext, locale: SupportedLocale): void {
  const provider = new MusicCodeActionProvider(locale);
  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider({ language: 'guitardsl' }, provider, {
      providedCodeActionKinds: [
        vscode.CodeActionKind.QuickFix,
        vscode.CodeActionKind.RefactorRewrite,
        vscode.CodeActionKind.RefactorExtract,
        vscode.CodeActionKind.RefactorInline
      ]
    }),
    vscode.commands.registerCommand(APPLY_MUSIC_CODE_ACTION_COMMAND, (args: ApplyCodeActionArgs) => applyMusicCodeAction(args, locale))
  );
}
