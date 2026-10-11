/** Bounded, parser-backed editor hint analysis. */
import { ParsedScore } from '../compiler';
import { chordKey } from '../chordDefinition';
import { SelectedToken, lineStarts, tokenOffset } from './sourceIndex';
import { duplicateChordDefinitionKeys, hasTab, hasUnsupportedMeasureBoundary, parseFailed } from './semantics';

export interface CodeActionHint {
  kind: 'unusedChordDefinition' | 'repeatedFragmentCandidate';
  line: number;
  startCol: number;
  endCol: number;
  text: string;
}

export const MAX_REPEATED_FRAGMENT_TOKENS = 3000;
const MAX_REPEATED_FRAGMENT_LENGTH = 16;
const MAX_REPEATED_FRAGMENT_HINTS = 40;

interface WindowOccurrence {
  start: number;
  end: number;
  line: number;
  startCol: number;
  endCol: number;
}

interface WindowIndexEntry {
  key: string;
  text: string;
  length: number;
  occurrences: WindowOccurrence[];
}

function firstNonOverlappingOccurrence(occurrences: readonly WindowOccurrence[], firstEnd: number): WindowOccurrence | undefined {
  let low = 0;
  let high = occurrences.length;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    if (occurrences[middle].start < firstEnd) low = middle + 1;
    else high = middle;
  }
  return occurrences[low];
}

export function analyzeRepeatedFragmentTokens(
  source: string,
  input: readonly SelectedToken[],
  maxTokens = MAX_REPEATED_FRAGMENT_TOKENS
): CodeActionHint[] {
  const tokens = input.slice(0, Math.max(0, maxTokens));
  const cells = new Map<string, SelectedToken[]>();
  for (const item of tokens) {
    const cell = cells.get(item.token.cellId) ?? [];
    cell.push(item);
    cells.set(item.token.cellId, cell);
  }

  const index = new Map<string, WindowIndexEntry>();
  for (const cell of cells.values()) {
    const sorted = [...cell].sort((a, b) => a.span.start - b.span.start);
    for (let length = 4; length <= Math.min(MAX_REPEATED_FRAGMENT_LENGTH, sorted.length); length++) {
      for (let startIndex = 0; startIndex + length <= sorted.length; startIndex++) {
        const first = sorted[startIndex];
        const last = sorted[startIndex + length - 1];
        let contiguous = true;
        for (let i = startIndex + 1; i < startIndex + length; i++) {
          if (source.slice(sorted[i - 1].span.end, sorted[i].span.start).trim()) {
            contiguous = false;
            break;
          }
        }
        if (!contiguous) continue;
        const parts = sorted.slice(startIndex, startIndex + length).map(item => item.token.text);
        const key = JSON.stringify(parts);
        let entry = index.get(key);
        if (!entry) {
          entry = { key, text: parts.join(' '), length, occurrences: [] };
          index.set(key, entry);
        }
        entry.occurrences.push({
          start: first.span.start, end: last.span.end, line: first.token.line,
          startCol: first.token.startCol, endCol: last.token.endCol
        });
      }
    }
  }

  const candidates: { entry: WindowIndexEntry; first: WindowOccurrence }[] = [];
  for (const entry of index.values()) {
    entry.occurrences.sort((a, b) => a.start - b.start || a.end - b.end);
    const first = entry.occurrences[0];
    if (!first || !firstNonOverlappingOccurrence(entry.occurrences, first.end)) continue;
    candidates.push({ entry, first });
  }
  candidates.sort((a, b) => b.entry.length - a.entry.length
    || a.first.start - b.first.start
    || (a.entry.key < b.entry.key ? -1 : a.entry.key > b.entry.key ? 1 : 0));
  return candidates.slice(0, MAX_REPEATED_FRAGMENT_HINTS).map(({ entry, first }) => ({
    kind: 'repeatedFragmentCandidate',
    line: first.line,
    startCol: first.startCol,
    endCol: first.endCol,
    text: entry.text
  }));
}

export function computeCodeActionHints(source: string, score: ParsedScore): CodeActionHint[] {
  if (parseFailed(score)) return [];
  const starts = lineStarts(source);
  const hints: CodeActionHint[] = [];
  const definitions = score.sourceDefinitions ?? [];
  const duplicateKeys = duplicateChordDefinitionKeys(score);
  for (const definition of definitions) {
    if (definition.kind !== 'chord') continue;
    const key = chordKey(definition.name, definition.label);
    if (duplicateKeys.has(key) || score.usedChords.includes(key)) continue;
    hints.push({ kind: 'unusedChordDefinition', line: definition.line, startCol: definition.startCol, endCol: definition.endCol, text: definition.name });
  }

  if (!hasTab(score)) {
    const eligible: SelectedToken[] = [];
    let authoredRhythmTokens = 0;
    for (const token of score.codeActionTokens ?? []) {
      if (token.kind !== 'rhythm') continue;
      authoredRhythmTokens++;
      if (authoredRhythmTokens > MAX_REPEATED_FRAGMENT_TOKENS) break;
      if (token.measureIndex === undefined || hasUnsupportedMeasureBoundary(score, token)) continue;
      const span = tokenOffset(token, starts);
      if (!span) continue;
      eligible.push({ token, span });
    }
    hints.push(...analyzeRepeatedFragmentTokens(source, eligible));
  }
  return hints.slice(0, MAX_REPEATED_FRAGMENT_HINTS);
}
