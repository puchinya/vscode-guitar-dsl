export interface WorkspaceScoreCacheEntry<T> {
  readonly score: T | undefined;
  readonly lineOffsets: readonly number[];
  offsetFor(line: number, column: number): number;
}

export function createWorkspaceScoreCache<T>(
  parse: (source: string, expandPageBreakRepeats: boolean) => T,
  buildLineOffsets: (source: string) => readonly number[] = sourceLineOffsets
) {
  const entries = new Map<string, {
    revision: number;
    source: string;
    locale: string;
    expandPageBreakRepeats: boolean;
    value: WorkspaceScoreCacheEntry<T>;
  }>();

  return {
    get(identity: string, revision: number, source: string, locale: string, expandPageBreakRepeats: boolean): WorkspaceScoreCacheEntry<T> {
      const current = entries.get(identity);
      if (current && current.revision === revision && current.source === source
        && current.locale === locale && current.expandPageBreakRepeats === expandPageBreakRepeats) return current.value;

      let score: T | undefined;
      try { score = parse(source, expandPageBreakRepeats); } catch { score = undefined; }
      const lineOffsets = buildLineOffsets(source);
      const value: WorkspaceScoreCacheEntry<T> = Object.freeze({
        score,
        lineOffsets,
        offsetFor(line: number, column: number) {
          return (lineOffsets[Math.max(0, Math.min(line, lineOffsets.length - 1))] ?? source.length) + column;
        }
      });
      entries.set(identity, { revision, source, locale, expandPageBreakRepeats, value });
      return value;
    },
    clear(identity?: string) {
      if (identity === undefined) entries.clear();
      else entries.delete(identity);
    }
  };
}

function sourceLineOffsets(source: string): number[] {
  const offsets = [0];
  for (let index = 0; index < source.length; index += 1) {
    if (source.charCodeAt(index) === 10) offsets.push(index + 1);
  }
  return offsets;
}
