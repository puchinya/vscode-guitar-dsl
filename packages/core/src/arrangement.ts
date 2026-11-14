import { MAX_PLAY_ORDER_OCCURRENCES } from './playOrder';
import type { PlayOrderMeasure } from './playOrder';

export interface SourceSpan {
  line: number;
  startCol: number;
  endCol: number;
}

export interface ArrangementEntry {
  name: string;
  count: number;
  lyricVerse?: number;
  span: SourceSpan;
  nameSpan: SourceSpan;
  lyricVerseSpan?: SourceSpan;
}

export interface ArrangementSection {
  name: string;
  start: number;
  end: number;
  labelSpan: SourceSpan;
  /** Minimum lyric verse count across sung melody groups, or zero when the section has no sung lyrics. */
  lyricVerseCount: number;
}

export type ArrangementDiagnosticCode =
  | 'arrangementInvalidSyntax'
  | 'arrangementDuplicateBlock'
  | 'arrangementUnterminatedBlock'
  | 'arrangementUnexpectedEnd'
  | 'arrangementOutsideHeader'
  | 'arrangementEmpty'
  | 'arrangementDuplicateSection'
  | 'arrangementEmptySection'
  | 'arrangementUnassignedMeasures'
  | 'arrangementUnknownReference'
  | 'arrangementAmbiguousReference'
  | 'arrangementNavigationConflict'
  | 'arrangementLyricVerseUnavailable'
  | 'playOrderLimitExceeded';

export interface ArrangementDiagnostic {
  code: ArrangementDiagnosticCode;
  span: SourceSpan;
  args?: Record<string, string | number>;
}

export interface ArrangementScanResult {
  /** True for an arrangement opener, malformed arrangement directive, or unmatched closing brace. */
  present: boolean;
  entries: ArrangementEntry[];
  maskedLines: boolean[];
  diagnostics: ArrangementDiagnostic[];
}

export interface ArrangementLoweringResult {
  valid: boolean;
  measures: PlayOrderMeasure[];
  diagnostics: ArrangementDiagnostic[];
}

const OPEN_LINE = /^arrangement\s*\{\s*(?:#.*)?$/;
const OPEN_BRACE_PREFIX = /^arrangement\s*\{/i;
const LEGACY_OPEN_LINE = /^arrangement\s*:\s*(?:#.*)?$/i;
const LEGACY_CLOSE_LINE = /^end_arrangement\s*(?:#.*)?$/i;
const CLOSE_LINE = /^\}\s*(?:#.*)?$/;
const ARRANGEMENT_DIRECTIVE_PREFIX = /^arrangement(?:\s|:|$)/i;
const SIMPLE_NAME = /^[\p{L}_][\p{L}\p{N}_-]*$/u;
const HEADER_LINE = /^(?:title|artist|capo|key|original_key|tempo|bpm|memo|show_rhythm|rhythm|measures_per_row|bars_per_row|time|time_signature|meter|feel|pickup|expand_page_break_repeats?|expand_page_repeats?|(?:style_)?(?:chord_size|lyric_size|title_size|section_size|font_size))\s*:/i;

const spanOf = (line: number, startCol: number, endCol: number): SourceSpan => ({
  line,
  startCol,
  endCol: Math.max(startCol + 1, endCol)
});

const lineSpan = (raw: string, line: number): SourceSpan => {
  const startCol = raw.length - raw.trimStart().length;
  return spanOf(line, startCol, raw.trimEnd().length);
};

function isScoreBodyLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#') || /^let\s/.test(trimmed)) return false;
  if (/^\[[^\]]+\]$/.test(trimmed) || /^---+$/.test(trimmed) || /^pagebreak$/i.test(trimmed)) return true;
  if (/^\s*@/.test(line) || /^\s*(?:mel|lyr):/i.test(line)) return true;
  if (HEADER_LINE.test(trimmed) || /^chord\s/i.test(trimmed)) return false;
  return trimmed.includes('|');
}

function trailingCommentStart(content: string): number {
  let inBracketedName = false;
  for (let i = 0; i < content.length; i++) {
    if (content[i] === '[' && !inBracketedName) inBracketedName = true;
    else if (content[i] === ']' && inBracketedName) inBracketedName = false;
    else if (content[i] === '#' && !inBracketedName && i > 0 && /[ \t]/.test(content[i - 1])) {
      let start = i - 1;
      while (start > 0 && /[ \t]/.test(content[start - 1])) start--;
      return start;
    }
  }
  return -1;
}

function parseEntry(raw: string, line: number): { entry?: ArrangementEntry; diagnostic?: ArrangementDiagnostic } {
  const leading = raw.length - raw.trimStart().length;
  const content = raw.slice(leading);
  if (!content || content.startsWith('#')) return {};

  const commentAt = trailingCommentStart(content);
  const withoutComment = (commentAt >= 0 ? content.slice(0, commentAt) : content).trimEnd();
  const match = withoutComment.match(/^(\[[^\]]+\]|[^\s()[\]#]+)(?:\(lyr=([^()]*)\))?(?: x([^\s#]+))?$/u);
  if (!match) {
    return { diagnostic: { code: 'arrangementInvalidSyntax', span: spanOf(line, leading, leading + withoutComment.length), args: { token: withoutComment } } };
  }

  const rawName = match[1];
  const name = rawName.startsWith('[') ? rawName.slice(1, -1) : rawName;
  const nameSpan = spanOf(line, leading, leading + rawName.length);
  if (!name || (!rawName.startsWith('[') && !SIMPLE_NAME.test(name))) {
    return { diagnostic: { code: 'arrangementInvalidSyntax', span: nameSpan, args: { token: rawName } } };
  }

  let lyricVerse: number | undefined;
  let lyricVerseSpan: SourceSpan | undefined;
  if (match[2] !== undefined) {
    const rawVerse = match[2];
    const valueStart = leading + rawName.length + '(lyr='.length;
    lyricVerseSpan = spanOf(line, valueStart, valueStart + rawVerse.length);
    if (!/^\d+$/.test(rawVerse)) {
      return { diagnostic: { code: 'arrangementInvalidSyntax', span: lyricVerseSpan, args: { value: rawVerse } } };
    }
    lyricVerse = Number(rawVerse);
    if (!Number.isSafeInteger(lyricVerse) || lyricVerse < 1) {
      return { diagnostic: { code: 'arrangementInvalidSyntax', span: lyricVerseSpan, args: { value: rawVerse } } };
    }
  }

  let count = 1;
  if (match[3] !== undefined) {
    const rawCount = match[3];
    const countStart = leading + withoutComment.lastIndexOf(`x${rawCount}`) + 1;
    if (!/^\d+$/.test(rawCount)) {
      return { diagnostic: { code: 'arrangementInvalidSyntax', span: spanOf(line, countStart, countStart + rawCount.length), args: { value: rawCount } } };
    }
    count = Number(rawCount);
    if (!Number.isSafeInteger(count) || count < 1) {
      return { diagnostic: { code: 'arrangementInvalidSyntax', span: spanOf(line, countStart, countStart + rawCount.length), args: { value: rawCount } } };
    }
  }

  return {
    entry: {
      name,
      count,
      ...(lyricVerse === undefined ? {} : { lyricVerse }),
      span: spanOf(line, leading, leading + withoutComment.length),
      nameSpan,
      ...(lyricVerseSpan ? { lyricVerseSpan } : {})
    }
  };
}

/** Finds and masks arrangement block lines before the ordinary score-line classifier runs. */
export function scanArrangementBlockLines(lines: readonly string[]): ArrangementScanResult {
  const entries: ArrangementEntry[] = [];
  const maskedLines = Array.from({ length: lines.length }, () => false);
  const diagnostics: ArrangementDiagnostic[] = [];
  let present = false;
  let bodyStarted = false;
  let openLine: number | undefined;
  let openSpan: SourceSpan | undefined;
  let openMode: 'valid' | 'malformedBrace' | 'legacy' = 'valid';
  let braceDepth = 0;
  let blockCount = 0;
  let blockEntries = 0;

  for (let line = 0; line < lines.length; line++) {
    const raw = lines[line];
    const trimmed = raw.trim();
    const span = lineSpan(raw, line);

    if (openLine !== undefined) {
      maskedLines[line] = true;
      if (openMode === 'legacy' && LEGACY_CLOSE_LINE.test(trimmed)) {
        openLine = undefined;
        openSpan = undefined;
        openMode = 'valid';
        braceDepth = 0;
        continue;
      }
      if (CLOSE_LINE.test(trimmed)) {
        if (openMode !== 'legacy' && braceDepth > 1) {
          braceDepth--;
          continue;
        }
        if (openMode === 'legacy') diagnostics.push({ code: 'arrangementUnexpectedEnd', span });
        else if (openMode === 'valid' && blockEntries === 0) diagnostics.push({ code: 'arrangementEmpty', span: openSpan! });
        openLine = undefined;
        openSpan = undefined;
        openMode = 'valid';
        braceDepth = 0;
        continue;
      }
      if (openMode !== 'valid') {
        if (openMode === 'malformedBrace' && OPEN_BRACE_PREFIX.test(trimmed)) braceDepth++;
        continue;
      }
      if (!trimmed || trimmed.startsWith('#')) continue;
      if (OPEN_BRACE_PREFIX.test(trimmed)) {
        diagnostics.push({ code: 'arrangementDuplicateBlock', span });
        if (!OPEN_LINE.test(trimmed)) diagnostics.push({ code: 'arrangementInvalidSyntax', span, args: { token: trimmed } });
        braceDepth++;
        continue;
      }
      if (LEGACY_OPEN_LINE.test(trimmed)) {
        diagnostics.push({ code: 'arrangementDuplicateBlock', span });
        diagnostics.push({ code: 'arrangementInvalidSyntax', span, args: { token: trimmed } });
        continue;
      }
      blockEntries++;
      const parsed = parseEntry(raw, line);
      if (parsed.entry) entries.push(parsed.entry);
      if (parsed.diagnostic) diagnostics.push(parsed.diagnostic);
      continue;
    }

    if (CLOSE_LINE.test(trimmed)) {
      present = true;
      maskedLines[line] = true;
      diagnostics.push({ code: 'arrangementUnexpectedEnd', span });
      continue;
    }

    if (LEGACY_CLOSE_LINE.test(trimmed)) {
      present = true;
      maskedLines[line] = true;
      diagnostics.push({ code: 'arrangementInvalidSyntax', span, args: { token: trimmed } });
      continue;
    }

    if (ARRANGEMENT_DIRECTIVE_PREFIX.test(trimmed)) {
      present = true;
      maskedLines[line] = true;
      const validOpen = OPEN_LINE.test(trimmed);
      const legacyOpen = LEGACY_OPEN_LINE.test(trimmed);
      if (!validOpen) {
        diagnostics.push({ code: 'arrangementInvalidSyntax', span, args: { token: trimmed } });
        if (legacyOpen || OPEN_BRACE_PREFIX.test(trimmed)) {
          blockCount++;
          blockEntries = 1;
          openLine = line;
          openSpan = span;
          openMode = legacyOpen ? 'legacy' : 'malformedBrace';
          braceDepth = legacyOpen ? 0 : 1;
          if (blockCount > 1) diagnostics.push({ code: 'arrangementDuplicateBlock', span });
          if (bodyStarted) diagnostics.push({ code: 'arrangementOutsideHeader', span });
        }
        continue;
      }
      blockCount++;
      blockEntries = 0;
      openLine = line;
      openSpan = span;
      openMode = 'valid';
      braceDepth = 1;
      if (blockCount > 1) diagnostics.push({ code: 'arrangementDuplicateBlock', span });
      if (bodyStarted) diagnostics.push({ code: 'arrangementOutsideHeader', span });
      continue;
    }

    if (isScoreBodyLine(raw)) bodyStarted = true;
  }

  if (openLine !== undefined && openSpan) diagnostics.push({ code: 'arrangementUnterminatedBlock', span: openSpan });

  return { present, entries, maskedLines, diagnostics };
}

/** Validates references and expands them to virtual linear input without copying written score data. */
export function lowerArrangement(
  entries: readonly ArrangementEntry[],
  sections: readonly ArrangementSection[],
  measures: readonly PlayOrderMeasure[],
  unassignedMeasuresSpan?: SourceSpan
): ArrangementLoweringResult {
  const diagnostics: ArrangementDiagnostic[] = [];
  const byName = new Map<string, ArrangementSection[]>();
  for (const section of sections) {
    const matches = byName.get(section.name) ?? [];
    matches.push(section);
    byName.set(section.name, matches);
    if (section.start >= section.end) diagnostics.push({ code: 'arrangementEmptySection', span: section.labelSpan, args: { section: section.name } });
    if (matches.length > 1) diagnostics.push({ code: 'arrangementDuplicateSection', span: section.labelSpan, args: { section: section.name } });
  }
  if (unassignedMeasuresSpan) diagnostics.push({ code: 'arrangementUnassignedMeasures', span: unassignedMeasuresSpan });

  const resolved: { entry: ArrangementEntry; section: ArrangementSection }[] = [];
  for (const entry of entries) {
    const matches = byName.get(entry.name) ?? [];
    if (matches.length === 0) {
      diagnostics.push({ code: 'arrangementUnknownReference', span: entry.nameSpan, args: { section: entry.name } });
      continue;
    }
    if (matches.length > 1) {
      diagnostics.push({ code: 'arrangementAmbiguousReference', span: entry.nameSpan, args: { section: entry.name, count: matches.length } });
      continue;
    }
    const section = matches[0];
    if (entry.lyricVerse !== undefined && entry.lyricVerse > section.lyricVerseCount) {
      diagnostics.push({
        code: 'arrangementLyricVerseUnavailable',
        span: entry.lyricVerseSpan ?? entry.span,
        args: { section: entry.name, verse: entry.lyricVerse, count: section.lyricVerseCount }
      });
    }
    resolved.push({ entry, section });
  }

  let total = 0;
  for (const { entry, section } of resolved) {
    const sectionLength = section.end - section.start;
    const expansionLength = sectionLength * entry.count;
    if (!Number.isSafeInteger(expansionLength) || expansionLength > MAX_PLAY_ORDER_OCCURRENCES || total > MAX_PLAY_ORDER_OCCURRENCES - expansionLength) {
      diagnostics.push({ code: 'playOrderLimitExceeded', span: entry.span, args: { limit: MAX_PLAY_ORDER_OCCURRENCES } });
      continue;
    }
    total += expansionLength;
  }

  if (diagnostics.length > 0) return { valid: false, measures: [], diagnostics };

  const lowered: PlayOrderMeasure[] = [];
  const appearanceBySection = new Map<string, number>();
  for (const { entry, section } of resolved) {
    let appearance = appearanceBySection.get(section.name) ?? 0;
    for (let repetition = 0; repetition < entry.count; repetition++) {
      appearance++;
      const lyricVerse = entry.lyricVerse ?? (section.lyricVerseCount > 0 ? ((appearance - 1) % section.lyricVerseCount) + 1 : undefined);
      for (let index = section.start; index < section.end; index++) {
        const sourceMeasure = measures[index];
        lowered.push({
          measureIndex: sourceMeasure.measureIndex,
          repeatStart: false,
          repeatEnd: false,
          ...(lyricVerse === undefined ? {} : { lyricVerse })
        });
      }
    }
    appearanceBySection.set(section.name, appearance);
  }
  return { valid: true, measures: lowered, diagnostics: [] };
}
