import { autocompletion, type Completion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap, isolateHistory } from '@codemirror/commands';
import { bracketMatching, defaultHighlightStyle, indentOnInput, syntaxHighlighting } from '@codemirror/language';
import { lintGutter, setDiagnostics, type Diagnostic as CodeMirrorDiagnostic } from '@codemirror/lint';
import { gotoLine, openSearchPanel, search, searchKeymap } from '@codemirror/search';
import { EditorState, Transaction, type Extension } from '@codemirror/state';
import { EditorView, Decoration, ViewPlugin, keymap, highlightActiveLine, lineNumbers, type DecorationSet } from '@codemirror/view';

export interface HighlightRange { from: number; to: number; kind: string }
interface EditorDocument { state: EditorState; source: string; scrollTop: number; scrollLeft: number }

const MEASURE_TOKEN = /(\|)|([$][A-Za-z_][A-Za-z0-9_]*)|(%\d*)|([A-G](?:#|b)?(?:(?:maj|min|m|M|dim|aug|sus|add|omit|no|ø|°)?\d*)?(?:[#b]\d+)*(?:\/[A-G](?:#|b)?)?)/giu;
const MELODY_TOKENS = /(\|)|([$][A-Za-z_][A-Za-z0-9_]*)|(r(?:\/\d+(?:\.[\d]+)?(?:\{\d+:\d+\})?)?|[a-g](?:#|b)?\d?(?:\/\d+(?:\.[\d]+)?(?:\{\d+:\d+\})?)?(?:\{[^{}]*\})?)/giu;
const TAB_TOKENS = /(\|)|([$][A-Za-z_][A-Za-z0-9_]*)|(%\d*)|([1-6](?:f\d+|x)~?)|(\{[A-Za-z][A-Za-z0-9-]*(?:\([^{}]*\))?\})|(\/\d+(?:\.[\d]+)?|:[\d.]+)/gu;

function addMatches(ranges: HighlightRange[], line: string, absolute: number, pattern: RegExp, kindForMatch: (match: RegExpMatchArray) => string | undefined): void {
  pattern.lastIndex = 0;
  for (const match of line.matchAll(pattern)) {
    const kind = kindForMatch(match);
    if (kind) ranges.push({ from: absolute + (match.index ?? 0), to: absolute + (match.index ?? 0) + match[0].length, kind });
  }
}

function addLineRanges(ranges: HighlightRange[], line: string, absolute: number): void {
  const comment = /^\s*#/u.test(line) ? line.search(/#/u) : (/(?<!\S)#/u.exec(line)?.index ?? -1);
  const content = comment >= 0 ? line.slice(0, comment) : line;
  if (comment >= 0) ranges.push({ from: absolute + comment, to: absolute + line.length, kind: 'comment' });
  const arrangement = /^(\s*)(arrangement)(\s*)(\{)(.*?)(\s*\})?\s*$/u.exec(content);
  if (arrangement) {
    const start = absolute + arrangement[1].length;
    ranges.push({ from: start, to: start + arrangement[2].length, kind: 'keyword' });
    const open = start + arrangement[2].length + arrangement[3].length;
    ranges.push({ from: open, to: open + 1, kind: 'punctuation' });
    addMatches(ranges, arrangement[5], open + 1, /\[[^\]]+\]|[\p{L}_][\p{L}\p{N}_-]*/gu, () => 'section-reference');
    if (arrangement[6]) ranges.push({ from: absolute + content.length - arrangement[6].length, to: absolute + content.length, kind: 'punctuation' });
    return;
  }
  const section = /^(\s*)(\[[^\]]+\])(.*)$/u.exec(content);
  if (section) {
    const from = absolute + section[1].length;
    ranges.push({ from, to: from + section[2].length, kind: 'section' });
    addMatches(ranges, section[3], from + section[2].length, /\bx\d+\b|\(lyr=\d+\)/gu, () => 'operator');
    return;
  }
  const directive = /^(\s*)(@[A-Za-z][A-Za-z0-9_-]*)(\s*)(:)(.*)$/u.exec(content);
  if (directive) {
    const from = absolute + directive[1].length;
    ranges.push({ from, to: from + directive[2].length, kind: 'directive' });
    ranges.push({ from: from + directive[2].length + directive[3].length, to: from + directive[2].length + directive[3].length + 1, kind: 'punctuation' });
    return;
  }
  const prefix = /^(\s*)(tab(?:\[[1-4]\])?|mel|lyr)(:)(.*)$/u.exec(content);
  if (prefix) {
    const from = absolute + prefix[1].length;
    ranges.push({ from, to: from + prefix[2].length, kind: 'keyword' }, { from: from + prefix[2].length, to: from + prefix[2].length + 1, kind: 'punctuation' });
    const bodyFrom = from + prefix[2].length + 1;
    if (prefix[2].startsWith('tab')) addMatches(ranges, prefix[4], bodyFrom, TAB_TOKENS, match => match[1] ? 'bar' : match[2] ? 'variable' : match[3] ? 'operator' : match[4] ? 'tab-note' : match[5] ? 'effect' : match[6] ? 'duration' : undefined);
    else if (prefix[2] === 'mel') addMatches(ranges, prefix[4], bodyFrom, MELODY_TOKENS, match => match[1] ? 'bar' : match[2] ? 'variable' : 'note');
    else addMatches(ranges, prefix[4], bodyFrom, /\|/gu, () => 'bar');
    return;
  }
  const definition = /^(\s*)(chord|let)\b(.*)$/u.exec(content);
  if (definition) {
    const from = absolute + definition[1].length;
    ranges.push({ from, to: from + definition[2].length, kind: 'keyword' });
    addMatches(ranges, definition[3], from + definition[2].length, /\b[A-G](?:#|b)?(?:m|maj\d*|m\d*|7|dim\d*|sus\d*)?(?:\/[A-G](?:#|b)?)?\b|\$[A-Za-z_][A-Za-z0-9_]*/gu, () => 'symbol');
    return;
  }
  if (/^\s*pagebreak\b/iu.test(content)) {
    addMatches(ranges, content, absolute, /\bpagebreak\b|\(\d+\)/giu, () => 'keyword');
    return;
  }
  const header = /^(\s*)([\p{L}_][\p{L}\p{N}_-]*)(\s*)(:)(.*)$/u.exec(content);
  if (header) {
    const from = absolute + header[1].length;
    ranges.push({ from, to: from + header[2].length, kind: 'key' }, { from: from + header[2].length + header[3].length, to: from + header[2].length + header[3].length + 1, kind: 'punctuation' }, { from: from + header[2].length + header[3].length + 1, to: absolute + content.length, kind: 'value' });
    return;
  }
  if (content.includes('|')) addMatches(ranges, content, absolute, MEASURE_TOKEN, match => match[1] ? 'bar' : match[2] ? 'variable' : match[3] ? 'operator' : 'chord');
}

/** Token ranges are presentation-only; CodeMirror and the compiler keep the source text authoritative. */
export function tokenizeGuitarDslRanges(source: string): HighlightRange[] {
  const ranges: HighlightRange[] = [];
  let offset = 0;
  for (const line of source.split('\n')) {
    addLineRanges(ranges, line, offset);
    offset += line.length + 1;
  }
  return ranges;
}

function createSyntaxDecorations(view: EditorView): DecorationSet {
  const decorations = tokenizeGuitarDslRanges(view.state.doc.toString())
    .filter(range => range.from < range.to && range.to <= view.state.doc.length)
    .map(range => Decoration.mark({ class: `gds-${range.kind}` }).range(range.from, range.to));
  return Decoration.set(decorations, true);
}

function completionOptions(context: CompletionContext): CompletionResult | null {
  const line = context.state.doc.lineAt(context.pos);
  const before = line.text.slice(0, context.pos - line.from);
  const word = /[$\w@-]*$/u.exec(before)?.[0] ?? '';
  const document = context.state.doc.toString();
  const variables = Array.from(document.matchAll(/^\s*let\s+([A-Za-z_][A-Za-z0-9_]*)/gmu), match => '$' + match[1]);
  const sections = Array.from(document.matchAll(/^\s*\[([^\]]+)\]/gmu), match => match[1]);
  const definedChords = Array.from(document.matchAll(/^\s*chord\s+([^\s:]+)/gmu), match => match[1]);
  const add = (label: string, detail: string, type = 'keyword'): Completion => ({ label, detail, type, apply: label });
  let options: Completion[];
  if (/\$[A-Za-z_0-9]*$/u.test(before)) options = variables.map(value => add(value, 'Variable', 'variable'));
  else if (/^\s*arrangement\s*\{[^}]*$/iu.test(before)) options = sections.map(value => add('[' + value + ']', 'Section', 'type'));
  else if (/^\s*(?:@key|key)\s*:\s*[^|]*$/iu.test(before)) options = ['C', 'G', 'D', 'A', 'E', 'F', 'Bb', 'Am', 'Em', 'Dm'].map(value => add(value, 'Key', 'constant'));
  else if (/^\s*(?:tempo|bpm)\s*:\s*\S*$/iu.test(before)) options = ['72', '84', '96', '108', '120', '132'].map(value => add(value, 'Tempo', 'constant'));
  else if (/^\s*(?:meter|time)\s*:\s*\S*$/iu.test(before)) options = ['4/4', '3/4', '6/8', '12/8'].map(value => add(value, 'Meter', 'constant'));
  else if (/^\s*\[[^\]]*$/u.test(before)) options = sections.map(value => add('[' + value + ']', 'Section', 'type'));
  else if (/\|\s*[^|]*$/u.test(before)) options = [...new Set([...definedChords, 'C', 'G', 'D', 'A', 'E', 'F', 'Am', 'Em', 'Dm', 'G7', '%', '/4', '/8', '/16'])].map(value => add(value, 'Chord or rhythm', 'constant'));
  else options = ['title:', 'artist:', 'key:', 'tempo:', 'meter:', 'feel:', 'tuning:', 'capo:', 'chord ', 'let ', 'arrangement {', '[Verse]', '[Chorus]', 'mel:', 'tab:', 'lyr:'].map(value => add(value, 'GuitarDSL'));
  const filtered = options.filter(option => !word || option.label.toLowerCase().startsWith(word.toLowerCase()));
  return filtered.length ? { from: context.pos - word.length, options: filtered, validFor: /^[$\w@-]*$/u } : null;
}

function completionExtension(): Extension { return autocompletion({ override: [completionOptions], activateOnTyping: true }); }

function createEditorState(source: string, onUpdate: (updateSource: string) => void, onSelectionChange: () => void): EditorState {
  const syntaxPlugin = ViewPlugin.fromClass(class {
    decorations: DecorationSet;
    constructor(private readonly view: EditorView) { this.decorations = createSyntaxDecorations(view); }
    update(update: { docChanged: boolean }): void { if (update.docChanged) this.decorations = createSyntaxDecorations(this.view); }
  }, { decorations: value => value.decorations });
  return EditorState.create({
    doc: source.replace(/\r\n?/gu, '\n'),
    extensions: [
      lineNumbers(), highlightActiveLine(), bracketMatching(), indentOnInput(), history(), search(), lintGutter(),
      syntaxPlugin, completionExtension(),
      EditorState.transactionExtender.of(transaction => {
        const userEvent = transaction.annotation(Transaction.userEvent);
        return userEvent && (userEvent.startsWith('input.complete') || userEvent.startsWith('input.replace'))
          ? { annotations: isolateHistory.of('full') } : null;
      }),
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      keymap.of([{ key: 'Mod-g', run: gotoLine }, { key: 'Mod-h', run: openSearchPanel }, ...defaultKeymap, ...historyKeymap, ...searchKeymap]),
      EditorView.lineWrapping,
      EditorView.theme({
        '&': { height: '100%', fontSize: '13px' }, '.cm-scroller': { overflow: 'auto', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', lineHeight: '1.7' },
        '.cm-content': { padding: '12px 0', caretColor: 'var(--editor-caret, #5364d9)' }, '.cm-gutters': { background: 'var(--editor-bg, #fff)', border: 'none', color: 'var(--editor-gutter, #89919d)' },
        '.cm-activeLine': { backgroundColor: 'var(--editor-active, #f5f6fa)' }, '.cm-activeLineGutter': { backgroundColor: 'var(--editor-active, #f5f6fa)' },
        '.cm-selectionBackground, ::selection': { backgroundColor: 'var(--editor-selection, #5364d940)' }, '.cm-matchingBracket': { outline: '1px solid #6978e8', backgroundColor: '#6978e833' },
        '.cm-tooltip': { zIndex: '20' }
      }),
      EditorView.updateListener.of(update => {
        if (update.docChanged) onUpdate(update.state.doc.toString());
        if (update.selectionSet) onSelectionChange();
      })
    ]
  });
}

export function createSourceEditorMarkup(): string {
  return '<div class="editor-surface" aria-label="GuitarDSL source editor"></div>';
}

export class SourceEditorSurface {
  private readonly view: EditorView;
  private activeKey = '';
  private readonly documents = new Map<string, EditorDocument>();
  private activeSource = '';
  private suppressUpdate = false;
  private compositionActive = false;
  private pendingComposition = false;
  private publishTimer = 0;
  private readonly onSelectionChange: () => void;

  constructor(readonly host: HTMLElement, private readonly onChange: (source: string) => void, onSelectionChange: () => void = () => {}) {
    this.onSelectionChange = onSelectionChange;
    this.view = new EditorView({ state: createEditorState('', source => this.onEditorUpdate(source), onSelectionChange), parent: host });
    this.view.dom.setAttribute('aria-label', 'GuitarDSL source editor');
    this.view.dom.addEventListener('compositionstart', () => { this.compositionActive = true; });
    this.view.dom.addEventListener('compositionend', () => {
      this.compositionActive = false;
      if (this.pendingComposition) this.schedulePublish();
    });
  }

  setDocument(key: string, source: string): void {
    if (this.activeKey === key) {
      if (this.activeSource !== source && this.view.state.doc.toString() !== source.replace(/\r\n?/gu, '\n')) {
        this.activeSource = source;
        this.suppressUpdate = true;
        this.view.setState(createEditorState(source, value => this.onEditorUpdate(value), this.onSelectionChange));
        this.suppressUpdate = false;
      } else this.activeSource = source;
      return;
    }
    if (this.activeKey) this.documents.set(this.activeKey, { state: this.view.state, source: this.activeSource, scrollTop: this.view.scrollDOM.scrollTop, scrollLeft: this.view.scrollDOM.scrollLeft });
    this.activeKey = key;
    let document = this.documents.get(key);
    if (!document) {
      document = { state: createEditorState(source, value => this.onEditorUpdate(value), this.onSelectionChange), source, scrollTop: 0, scrollLeft: 0 };
      this.documents.set(key, document);
    } else if (document.source !== source && document.state.doc.toString() !== source.replace(/\r\n?/gu, '\n')) {
      document = { ...document, state: createEditorState(source, value => this.onEditorUpdate(value), this.onSelectionChange), source };
      this.documents.set(key, document);
    } else document.source = source;
    this.activeSource = document.source;
    this.suppressUpdate = true;
    this.view.setState(document.state);
    this.suppressUpdate = false;
    this.onSelectionChange();
    requestAnimationFrame(() => { this.view.scrollDOM.scrollTop = document!.scrollTop; this.view.scrollDOM.scrollLeft = document!.scrollLeft; });
  }

  getSource(): string { return this.activeSource; }
  getText(): string { return this.view.state.doc.toString(); }
  setAccessibleName(label: string): void {
    this.host.setAttribute('aria-label', label);
    this.view.contentDOM.setAttribute('aria-label', label);
  }
  focus(): void { this.view.focus(); }
  selection(): { from: number; to: number; head: number } { const selection = this.view.state.selection.main; return { from: selection.from, to: selection.to, head: selection.head }; }
  setSelection(from: number, to = from): void {
    const anchor = Math.max(0, Math.min(from, this.view.state.doc.length));
    const head = Math.max(0, Math.min(to, this.view.state.doc.length));
    this.view.dispatch({ selection: { anchor, head }, effects: EditorView.scrollIntoView(anchor, { y: 'center' }) });
    this.view.focus();
    this.onSelectionChange();
  }
  setDiagnostics(items: readonly { message: string; line: number; startCol: number; endCol: number; severity: string }[]): void {
    const diagnostics: CodeMirrorDiagnostic[] = items.map(item => {
      const line = Math.max(1, Math.min(item.line + 1, this.view.state.doc.lines));
      const lineInfo = this.view.state.doc.line(line);
      return { from: Math.min(lineInfo.to, lineInfo.from + item.startCol), to: Math.max(Math.min(lineInfo.to, lineInfo.from + item.endCol), Math.min(lineInfo.to, lineInfo.from + item.startCol) + (lineInfo.to > lineInfo.from ? 1 : 0)), severity: item.severity === 'error' ? 'error' : 'warning', message: item.message };
    });
    this.view.dispatch(setDiagnostics(this.view.state, diagnostics));
  }
  replaceSource(source: string, userEvent = 'input.replace'): boolean {
    const previous = this.view.state.doc.toString();
    const next = source.replace(/\r\n?/gu, '\n');
    if (previous === next) return false;
    let prefix = 0;
    while (prefix < previous.length && prefix < next.length && previous[prefix] === next[prefix]) prefix++;
    let suffix = 0;
    while (suffix < previous.length - prefix && suffix < next.length - prefix && previous[previous.length - suffix - 1] === next[next.length - suffix - 1]) suffix++;
    this.view.dispatch({ changes: { from: prefix, to: previous.length - suffix, insert: next.slice(prefix, next.length - suffix) }, annotations: Transaction.userEvent.of(userEvent), effects: EditorView.scrollIntoView(prefix) });
    this.publish();
    return true;
  }
  forgetDocument(key: string): void { this.documents.delete(key); }
  destroy(): void { window.clearTimeout(this.publishTimer); this.view.destroy(); }

  private onEditorUpdate(normalized: string): void {
    if (!this.activeKey || this.suppressUpdate) return;
    const previous = this.previousText();
    this.activeSource = preserveLineEndings(this.activeSource, previous, normalized);
    if (this.compositionActive || this.view.composing) { this.pendingComposition = true; return; }
    this.pendingComposition = false;
    this.schedulePublish();
  }

  private previousText(): string { return this.activeSource.replace(/\r\n?/gu, '\n'); }
  private schedulePublish(): void {
    window.clearTimeout(this.publishTimer);
    this.publishTimer = window.setTimeout(() => {
      if (!this.activeKey || this.compositionActive || this.view.composing) { this.pendingComposition = true; return; }
      this.publish();
    }, 0);
  }
  private publish(): void {
    if (!this.activeKey) return;
    window.clearTimeout(this.publishTimer);
    this.documents.set(this.activeKey, { state: this.view.state, source: this.activeSource, scrollTop: this.view.scrollDOM.scrollTop, scrollLeft: this.view.scrollDOM.scrollLeft });
    this.onChange(this.activeSource);
  }
}

/** Preserve the document's original CRLF/CR/LF style around a single CodeMirror transaction. */
export function preserveLineEndings(originalSource: string, previousText: string, nextText: string): string {
  if (previousText === nextText) return originalSource;
  const normalized = originalSource.replace(/\r\n?/gu, '\n');
  if (normalized !== previousText) return nextText.replace(/\n/gu, preferredLineEnding(originalSource, originalSource.length, originalSource.length));
  let prefix = 0;
  while (prefix < previousText.length && prefix < nextText.length && previousText[prefix] === nextText[prefix]) prefix++;
  let suffix = 0;
  while (suffix < previousText.length - prefix && suffix < nextText.length - prefix && previousText[previousText.length - suffix - 1] === nextText[nextText.length - suffix - 1]) suffix++;
  const rawStart = rawOffset(originalSource, prefix);
  const rawEnd = rawOffset(originalSource, previousText.length - suffix);
  const inserted = nextText.slice(prefix, nextText.length - suffix).replace(/\n/gu, preferredLineEnding(originalSource, rawStart, rawEnd));
  return originalSource.slice(0, rawStart) + inserted + originalSource.slice(rawEnd);
}

function rawOffset(source: string, normalizedOffset: number): number {
  let raw = 0;
  let normalized = 0;
  while (raw < source.length && normalized < normalizedOffset) {
    if (source[raw] === '\r') { raw += source[raw + 1] === '\n' ? 2 : 1; normalized++; }
    else { raw++; normalized++; }
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
