import * as vscode from 'vscode';
import { parseGuitarDsl } from './compiler';
import { resolveLocale, getMessages, type SupportedLocale } from './i18n';
import { spliceSourceColumns } from './sourceEdits';
import { resolveProgressionTargetKey, suggestNextChords, type ProgressionCandidate, type ProgressionTarget } from './progressionSuggestions';

interface CompletionContext {
  target: ProgressionTarget;
  startCharacter: number;
  endCharacter: number;
  prefix: string;
}

function isDisallowedLine(line: string): boolean {
  const trimmed = line.trimStart();
  return !trimmed || trimmed.startsWith('#') || /^\[/.test(trimmed)
    || /^(?:mel|lyr|tab)(?:\[[^\]]+\])?\s*:/.test(trimmed)
    || /^chord\s/.test(trimmed)
    || /^(?:title|artist|capo|key|bpm|tempo|time|time_signature|meter|feel|pickup|tuning)\s*:/i.test(trimmed);
}

function currentCellRange(line: string, character: number): { start: number; end: number; empty: boolean } | undefined {
  const previousBar = line.lastIndexOf('|', Math.max(0, character - 1));
  const nextBar = line.indexOf('|', character);
  if (previousBar < 0 && nextBar < 0) return undefined;
  const start = previousBar + 1;
  const end = nextBar < 0 ? line.length : nextBar;
  const cell = line.slice(start, end);
  return { start, end, empty: cell.trim() === '' };
}

function measureBeforeCell(score: ReturnType<typeof parseGuitarDsl>, line: number, cellStart: number): number {
  return (score.measureSourceSpans ?? []).filter(span =>
    span.line < line || (span.line === line && span.endCol <= cellStart)
  ).length;
}

function findCompletionContext(document: vscode.TextDocument, position: vscode.Position, score: ReturnType<typeof parseGuitarDsl>): CompletionContext | undefined {
  const line = document.lineAt(position.line).text;
  if (isDisallowedLine(line)) return undefined;
  const comment = line.search(/\s#/);
  if (comment >= 0 && comment <= position.character) return undefined;
  const cell = currentCellRange(line, position.character);
  if (!cell) return undefined;

  const span = (score.chordTokens ?? []).find(item => item.line === position.line
    && position.character >= item.startCol && position.character <= item.endCol);
  if (span) {
    if (span.label !== undefined || position.character !== span.endCol) return undefined;
    const actionToken = (score.codeActionTokens ?? []).find(token => token.kind === 'chord'
      && token.line === span.line && token.startCol === span.startCol);
    if (!actionToken || actionToken.measureIndex === undefined || actionToken.text.includes('@') || actionToken.duration) return undefined;
    const measureIndex = actionToken.measureIndex;
    const prior = (score.codeActionTokens ?? [])
      .filter(token => token.kind === 'chord' && token.measureIndex !== undefined
        && (token.measureIndex < measureIndex
          || (token.measureIndex === measureIndex && token.startCol < span.startCol)))
      .sort((a, b) => (a.measureIndex ?? 0) - (b.measureIndex ?? 0) || a.startCol - b.startCol)
      .at(-1);
    const previousSpan = prior && score.chordTokens?.find(item => item.line === prior.line && item.startCol === prior.startCol);
    return {
      target: {
        startMeasure: measureIndex,
        ...(previousSpan ? { previousChord: previousSpan.name } : {})
      },
      startCharacter: span.startCol,
      endCharacter: position.character,
      prefix: line.slice(span.startCol, position.character)
    };
  }

  if (!cell.empty) return undefined;
  const measureIndex = measureBeforeCell(score, position.line, cell.start);
  const contextKey = resolveProgressionTargetKey(score, measureIndex, true);
  const prior = (score.codeActionTokens ?? [])
    .filter(token => token.kind === 'chord' && token.measureIndex !== undefined && token.measureIndex < measureIndex)
    .sort((a, b) => (a.measureIndex ?? 0) - (b.measureIndex ?? 0) || a.startCol - b.startCol)
    .at(-1);
  const previousSpan = prior && score.chordTokens?.find(item => item.line === prior.line && item.startCol === prior.startCol);
  return {
    target: {
      startMeasure: measureIndex,
      key: contextKey,
      ...(previousSpan ? { previousChord: previousSpan.name } : {})
    },
    startCharacter: position.character,
    endCharacter: position.character,
    prefix: ''
  };
}

function breakdown(candidate: ProgressionCandidate, locale: SupportedLocale, messages: ReturnType<typeof getMessages>): string {
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

export function registerProgressionCompletions(context: vscode.ExtensionContext, locale?: string): vscode.Disposable {
  const resolvedLocale = resolveLocale(locale ?? vscode.env.language);
  const messages = getMessages(resolvedLocale);
  const provider: vscode.CompletionItemProvider = {
    provideCompletionItems(document, position, token) {
      if (token.isCancellationRequested || document.languageId !== 'guitardsl') return undefined;
      const source = document.getText();
      const parsed = parseGuitarDsl(source);
      const targetContext = findCompletionContext(document, position, parsed);
      if (!targetContext) return undefined;

      const analysisSource = targetContext.prefix
        ? spliceSourceColumns(source, [{
            line: position.line,
            start: targetContext.startCharacter,
            end: targetContext.endCharacter,
            expected: targetContext.prefix,
            text: ''
          }])
        : { ok: true as const, text: source };
      if (!analysisSource.ok) return undefined;
      const analysisScore = parseGuitarDsl(analysisSource.text);
      if (analysisScore.diagnostics.some(diagnostic => diagnostic.severity === 'error')) return undefined;
      const suggestions = suggestNextChords(analysisScore, targetContext.target);
      if (!suggestions.ok || token.isCancellationRequested) return undefined;

      return suggestions.candidates.slice(0, 5).map((candidate, index) => {
        const item = new vscode.CompletionItem(candidate.chords[0], vscode.CompletionItemKind.Value);
        item.insertText = candidate.chords[0];
        item.range = new vscode.Range(position.line, targetContext.startCharacter, position.line, targetContext.endCharacter);
        item.sortText = String(index).padStart(2, '0');
        item.detail = messages.progressionCompletionDetail(candidate.score.total);
        item.documentation = new vscode.MarkdownString(`${candidate.key}\n\n${breakdown(candidate, resolvedLocale, messages)}`);
        return item;
      });
    }
  };
  const disposable = vscode.languages.registerCompletionItemProvider({ language: 'guitardsl' }, provider, '|');
  context.subscriptions.push(disposable);
  return disposable;
}
