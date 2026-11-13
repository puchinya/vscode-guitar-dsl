const MEASURE_TOKEN = /(\|)|(\$[A-Za-z_][A-Za-z0-9_]*)|(%\d*)|([A-G](?:#|b)?(?:(?:maj|min|m|M|dim|aug|sus|add|omit|no|ø|°)?\d*)?(?:[#b]\d+)*(?:\/[A-G](?:#|b)?)?)/giu;
const MELODY_TOKENS = /(\|)|(\$[A-Za-z_][A-Za-z0-9_]*)|(r(?:\/\d+(?:\.[\d]+)?(?:\{\d+:\d+\})?)?|[a-g](?:#|b)?\d?(?:\/\d+(?:\.[\d]+)?(?:\{\d+:\d+\})?)?(?:\{[^{}]*\})?)/giu;
const TAB_TOKENS = /(\|)|(\$[A-Za-z_][A-Za-z0-9_]*)|(%\d*)|([1-6](?:f\d+|x)~?)|(\{[A-Za-z][A-Za-z0-9-]*(?:\([^{}]*\))?\})|(\/\d+(?:\.[\d]+)?|:[\d.]+)/gu;

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
}

function token(kind: string, text: string): string {
  return `<span class="gds-${kind}">${escapeHtml(text)}</span>`;
}

function markMatches(value: string, pattern: RegExp, kind: string): string {
  let output = '';
  let offset = 0;
  pattern.lastIndex = 0;
  for (const match of value.matchAll(pattern)) {
    const start = match.index ?? 0;
    output += escapeHtml(value.slice(offset, start)) + token(kind, match[0]);
    offset = start + match[0].length;
  }
  return output + escapeHtml(value.slice(offset));
}

function commentIndex(line: string): number {
  if (/^\s*#/u.test(line)) return line.search(/#/u);
  const match = /\s+#/u.exec(line);
  return match ? match.index + match[0].length - 1 : -1;
}

function markTokenized(value: string, pattern: RegExp, kindForMatch: (match: RegExpMatchArray) => string | undefined): string {
  let output = '';
  let offset = 0;
  pattern.lastIndex = 0;
  for (const match of value.matchAll(pattern)) {
    const start = match.index ?? 0;
    output += escapeHtml(value.slice(offset, start));
    const kind = kindForMatch(match);
    output += kind ? token(kind, match[0]) : escapeHtml(match[0]);
    offset = start + match[0].length;
  }
  return output + escapeHtml(value.slice(offset));
}

function highlightBody(line: string): string {
  const arrangement = /^(\s*)(arrangement)(\s*)(\{)(.*?)(\s*\})?\s*$/u.exec(line);
  if (arrangement) {
    return escapeHtml(arrangement[1]) + token('keyword', arrangement[2]) + escapeHtml(arrangement[3])
      + token('punctuation', arrangement[4]) + markMatches(arrangement[5], /\[[^\]]+\]|[\p{L}_][\p{L}\p{N}_-]*/gu, 'section-reference')
      + (arrangement[6] ? token('punctuation', arrangement[6]) : '');
  }

  const section = /^(\s*)(\[[^\]]+\])(.*)$/u.exec(line);
  if (section) return escapeHtml(section[1]) + token('section', section[2]) + markMatches(section[3], /\bx\d+\b|\(lyr=\d+\)/gu, 'operator');

  const directive = /^(\s*)(@[A-Za-z][A-Za-z0-9_-]*)(\s*)(:)(.*)$/u.exec(line);
  if (directive) return escapeHtml(directive[1]) + token('directive', directive[2]) + escapeHtml(directive[3])
    + token('punctuation', directive[4]) + token('value', directive[5]);

  const prefix = /^(\s*)(tab(?:\[[1-4]\])?|mel|lyr)(:)(.*)$/u.exec(line);
  if (prefix) {
    const body = prefix[2] === 'tab'
      ? markTokenized(prefix[4], TAB_TOKENS, match => match[1] ? 'bar' : match[2] ? 'variable' : match[3] ? 'operator' : match[4] ? 'tab-note' : match[5] ? 'effect' : match[6] ? 'duration' : undefined)
      : prefix[2] === 'mel'
        ? markTokenized(prefix[4], MELODY_TOKENS, match => match[1] ? 'bar' : match[2] ? 'variable' : 'note')
        : markMatches(prefix[4], /\|/gu, 'bar');
    return escapeHtml(prefix[1]) + token('keyword', prefix[2]) + token('punctuation', prefix[3]) + body;
  }

  const header = /^(\s*)([\p{L}_][\p{L}\p{N}_-]*)(\s*)(:)(.*)$/u.exec(line);
  if (header) return escapeHtml(header[1]) + token('key', header[2]) + escapeHtml(header[3])
    + token('punctuation', header[4]) + token('value', header[5]);

  const definition = /^(\s*)(chord|let)\b(.*)$/u.exec(line);
  if (definition) return escapeHtml(definition[1]) + token('keyword', definition[2])
    + markMatches(definition[3], /\b[A-G](?:#|b)?(?:m|maj\d*|m\d*|7|dim\d*|sus\d*)?(?:\/[A-G](?:#|b)?)?\b|\$[A-Za-z_][A-Za-z0-9_]*/gu, 'symbol');

  if (/^\s*pagebreak\b/iu.test(line)) return markMatches(line, /\bpagebreak\b|\(\d+\)/giu, 'keyword');
  if (line.includes('|')) return markTokenized(line, MEASURE_TOKEN,
    match => match[1] ? 'bar' : match[2] ? 'variable' : match[3] ? 'operator' : 'chord');
  return escapeHtml(line);
}

function highlightLine(line: string): string {
  const comment = commentIndex(line);
  if (comment === 0 || /^\s*#/.test(line)) return token('comment', line);
  if (comment < 0) return highlightBody(line);
  const contentEnd = Math.max(0, comment - 1);
  return highlightBody(line.slice(0, contentEnd)) + escapeHtml(line.slice(contentEnd, comment)) + token('comment', line.slice(comment));
}

/** Tokenizes only for visual presentation; the editable textarea remains the source buffer. */
export function renderGuitarDslHighlight(source: string): string {
  return source.split('\n').map(highlightLine).join('\n');
}

/** Reapply the source's original line endings around a single native textarea edit. */
export function preserveLineEndings(originalSource: string, previousText: string, nextText: string): string {
  if (previousText === nextText) return originalSource;
  const normalized = originalSource.replace(/\r\n?/gu, '\n');
  if (normalized !== previousText) return nextText.replace(/\n/gu, preferredLineEnding(originalSource, originalSource.length, originalSource.length));

  let prefix = 0;
  while (prefix < previousText.length && prefix < nextText.length && previousText[prefix] === nextText[prefix]) prefix += 1;
  let suffix = 0;
  while (suffix < previousText.length - prefix && suffix < nextText.length - prefix
    && previousText[previousText.length - suffix - 1] === nextText[nextText.length - suffix - 1]) suffix += 1;

  const oldEnd = previousText.length - suffix;
  const newEnd = nextText.length - suffix;
  const rawStart = rawOffset(originalSource, prefix);
  const rawEnd = rawOffset(originalSource, oldEnd);
  const inserted = nextText.slice(prefix, newEnd).replace(/\n/gu, preferredLineEnding(originalSource, rawStart, rawEnd));
  return originalSource.slice(0, rawStart) + inserted + originalSource.slice(rawEnd);
}

function rawOffset(source: string, normalizedOffset: number): number {
  let raw = 0;
  let normalized = 0;
  while (raw < source.length && normalized < normalizedOffset) {
    if (source[raw] === '\r') {
      raw += source[raw + 1] === '\n' ? 2 : 1;
      normalized += 1;
    } else {
      raw += 1;
      normalized += 1;
    }
  }
  return raw;
}

function preferredLineEnding(source: string, start: number, end: number): string {
  const before = /(?:\r\n|\r|\n)$/u.exec(source.slice(0, start))?.[0];
  if (before) return before;
  const after = /^(?:\r\n|\r|\n)/u.exec(source.slice(end))?.[0];
  if (after) return after;
  return /\r\n/u.test(source) ? '\r\n' : /\r/u.test(source) ? '\r' : '\n';
}

export function createSourceEditorMarkup(): string {
  return `<div class="editor-surface"><pre class="editor-highlight" aria-hidden="true"></pre><textarea spellcheck="false" aria-label="GuitarDSL source editor" placeholder="title: My song&#10;&#10;[Verse]&#10;C | G | Am | F |"></textarea></div>`;
}

export class SourceEditorSurface {
  private source = '';
  private text = '';

  constructor(readonly input: HTMLTextAreaElement, private readonly highlight: HTMLElement) {
    input.addEventListener('scroll', () => this.syncScroll(), { passive: true });
  }

  setSource(source: string): void {
    this.source = source;
    this.input.value = source;
    this.text = this.input.value;
    this.render();
  }

  acceptInput(): string {
    const nextText = this.input.value;
    this.source = preserveLineEndings(this.source, this.text, nextText);
    this.text = nextText;
    this.render();
    return this.source;
  }

  render(): void {
    this.highlight.innerHTML = renderGuitarDslHighlight(this.input.value);
    this.syncScroll();
  }

  private syncScroll(): void {
    this.highlight.scrollTop = this.input.scrollTop;
    this.highlight.scrollLeft = this.input.scrollLeft;
  }
}
