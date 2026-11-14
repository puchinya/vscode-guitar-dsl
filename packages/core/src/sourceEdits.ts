/** A source edit addressed by its absolute UTF-16 offsets, matching VS Code and JavaScript strings. */
export interface SourceOffsetEdit {
  start: number;
  end: number;
  expected: string;
  text: string;
}

/** A source edit addressed by zero-based line and UTF-16 columns. */
export interface SourceColumnEdit {
  line: number;
  start: number;
  end: number;
  expected: string;
  text: string;
}

export type SourceEditResult = { ok: true; text: string } | { ok: false; detail: string };

/** Applies validated, non-overlapping edits from right to left, preserving every untouched source byte. */
export function spliceSourceOffsets(source: string, edits: readonly SourceOffsetEdit[]): SourceEditResult {
  const ordered = [...edits].sort((a, b) => a.start - b.start || a.end - b.end);
  let previousEnd = -1;
  for (const [index, edit] of ordered.entries()) {
    if (!Number.isInteger(edit.start) || !Number.isInteger(edit.end) || edit.start < 0 || edit.end < edit.start || edit.end > source.length) {
      return { ok: false, detail: 'source edit is outside the document' };
    }
    if (edit.start < previousEnd || (index > 0 && edit.start === ordered[index - 1].start)) {
      return { ok: false, detail: 'source edits overlap' };
    }
    if (source.slice(edit.start, edit.end) !== edit.expected) {
      return { ok: false, detail: `source span does not match ${edit.expected}` };
    }
    previousEnd = edit.end;
  }
  let result = source;
  for (const edit of [...ordered].reverse()) {
    result = result.slice(0, edit.start) + edit.text + result.slice(edit.end);
  }
  return { ok: true, text: result };
}

/** Converts checked line/column edits to offsets, without assuming LF or CRLF. */
export function spliceSourceColumns(source: string, edits: readonly SourceColumnEdit[]): SourceEditResult {
  const lineStarts = [0];
  for (let i = 0; i < source.length; i++) {
    if (source[i] === '\n') lineStarts.push(i + 1);
  }
  const offsets: SourceOffsetEdit[] = [];
  for (const edit of edits) {
    const lineStart = lineStarts[edit.line];
    if (lineStart === undefined || edit.start < 0 || edit.end < edit.start) {
      return { ok: false, detail: `line ${edit.line + 1}: invalid source span` };
    }
    offsets.push({
      start: lineStart + edit.start,
      end: lineStart + edit.end,
      expected: edit.expected,
      text: edit.text
    });
  }
  const result = spliceSourceOffsets(source, offsets);
  if (!result.ok && result.detail.startsWith('source span does not match')) {
    return { ok: false, detail: `source span does not match an expected token` };
  }
  return result;
}
