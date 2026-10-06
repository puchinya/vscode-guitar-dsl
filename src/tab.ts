import { Fraction, NoteValue, frac, parseNoteValueDetailed } from './duration';
import { GuitarString } from './instrumentModel';

export type TabVoiceNumber = 1 | 2 | 3 | 4;

export interface TabEffectCall {
  readonly name: string;
  readonly args: Readonly<Record<string, TabEffectValue>>;
}

export type TabEffectValue = string | number | Fraction | readonly TabEffectValue[];

export interface TabNote {
  readonly string: GuitarString;
  readonly fret?: number;
  readonly dead: boolean;
  readonly soundingPitch?: number;
  readonly tieToNext: boolean;
  readonly effects: readonly TabEffectCall[];
}

export interface TabBeat {
  readonly isRest: boolean;
  readonly notes: readonly TabNote[];
  readonly duration: NoteValue;
  readonly effects: readonly TabEffectCall[];
  readonly syllables: readonly string[];
}

export interface TabVoiceMeasure {
  readonly voice: TabVoiceNumber;
  readonly beats: readonly TabBeat[];
}

export type TabDiagnosticCode =
  | 'invalidTabToken'
  | 'unsupportedTabVoice'
  | 'invalidTabString'
  | 'invalidTabFret'
  | 'duplicateTabString'
  | 'tabRepeatWithoutPrevious'
  | 'invalidTabEffect'
  | 'invalidTabEffectScope'
  | 'invalidTabConnection'
  | 'danglingTabConnection'
  | 'invalidTabTie'
  | 'tooManyTabMeasures';

export interface TabSyntaxIssue {
  readonly code: TabDiagnosticCode | 'missingInitialOctaveOrLength';
  readonly startCol: number;
  readonly endCol: number;
  readonly args?: Readonly<Record<string, string | number>>;
}

export interface TabLinePrefix {
  readonly voice: number;
  readonly bodyStart: number;
}

export interface TabCellSpan {
  readonly text: string;
  readonly startCol: number;
  readonly endCol: number;
}

export interface ParsedTabNote {
  readonly string: number;
  readonly fret?: number;
  readonly dead: boolean;
  readonly tieToNext: boolean;
  readonly effects: readonly TabEffectCall[];
  readonly startCol: number;
  readonly endCol: number;
}

export interface ParsedTabBeat {
  readonly isRest: boolean;
  readonly notes: readonly ParsedTabNote[];
  readonly duration?: NoteValue;
  readonly effects: readonly TabEffectCall[];
  readonly startCol: number;
  readonly endCol: number;
}

export interface ParsedTabCell {
  readonly isRepeat: boolean;
  readonly beats: readonly ParsedTabBeat[];
  readonly issues: readonly TabSyntaxIssue[];
}

export interface ResolvedTabBeats {
  readonly beats: readonly TabBeat[];
  readonly lastDuration?: NoteValue;
  readonly issues: readonly TabSyntaxIssue[];
}

const NOTE_EFFECTS = new Set(['hammer', 'pull', 'slide', 'gliss', 'bend', 'vibrato', 'pm', 'let-ring']);
const BEAT_EFFECTS = new Set(['pm', 'let-ring']);
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_-]*$/;

export function scoreHasTab(score: { readonly measures: readonly { readonly tabVoices?: readonly TabVoiceMeasure[] }[] }): boolean {
  return score.measures.some(measure => (measure.tabVoices?.length ?? 0) > 0);
}

/** Parse the line prefix so tab[n]: is classified before generic header/measure syntax. */
export function parseTabLinePrefix(rawLine: string): TabLinePrefix | null {
  const match = rawLine.match(/^(\s*tab(?:\[([0-9]+)\])?:)/i);
  if (!match) return null;
  return { voice: match[2] === undefined ? 1 : Number(match[2]), bodyStart: match[1].length };
}

/** Split a TAB row into its bar-delimited cells without splitting nested effect arrays or quoted values. */
export function splitTabCells(rawLine: string, bodyStart: number): TabCellSpan[] {
  const lineEnd = tabCommentEnd(rawLine, bodyStart);
  const cells: TabCellSpan[] = [];
  let depthSquare = 0;
  let depthBrace = 0;
  let depthParen = 0;
  let quote = '';
  let escaped = false;
  let cellStart = bodyStart;
  for (let i = bodyStart; i < lineEnd; i++) {
    const ch = rawLine[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (ch === '[') depthSquare++;
    else if (ch === ']') depthSquare = Math.max(0, depthSquare - 1);
    else if (ch === '{') depthBrace++;
    else if (ch === '}') depthBrace = Math.max(0, depthBrace - 1);
    else if (ch === '(') depthParen++;
    else if (ch === ')') depthParen = Math.max(0, depthParen - 1);
    else if (ch === '|' && depthSquare === 0 && depthBrace === 0 && depthParen === 0) {
      pushCell(rawLine, cellStart, i, cells);
      cellStart = i + 1;
    }
  }
  pushCell(rawLine, cellStart, lineEnd, cells);
  return cells;
}

/** Split whitespace-delimited beats while keeping chords, effects, tuples and argument arrays intact. */
export function tokenizeTabItems(source: string): { readonly text: string; readonly start: number; readonly end: number }[] {
  const result: { text: string; start: number; end: number }[] = [];
  let square = 0;
  let brace = 0;
  let paren = 0;
  let quote = '';
  let escaped = false;
  let start = -1;
  for (let i = 0; i <= source.length; i++) {
    const ch = source[i] ?? ' ';
    if (start < 0 && !/\s/.test(ch)) start = i;
    if (i === source.length) {
      if (start >= 0) result.push({ text: source.slice(start, i), start, end: i });
      break;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (ch === '[') square++;
    else if (ch === ']') square = Math.max(0, square - 1);
    else if (ch === '{') brace++;
    else if (ch === '}') brace = Math.max(0, brace - 1);
    else if (ch === '(') paren++;
    else if (ch === ')') paren = Math.max(0, paren - 1);
    if (/\s/.test(ch) && square === 0 && brace === 0 && paren === 0 && start >= 0) {
      result.push({ text: source.slice(start, i), start, end: i });
      start = -1;
    }
  }
  return result;
}

export function parseTabCell(cell: TabCellSpan): ParsedTabCell {
  const text = cell.text.trim().replace(/^:+|:+$/g, '').trim();
  const leading = cell.text.indexOf(text);
  const start = cell.startCol + Math.max(0, leading);
  if (text === '%') return { isRepeat: true, beats: [], issues: [] };
  const issues: TabSyntaxIssue[] = [];
  if (!text) return { isRepeat: false, beats: [], issues };
  const items = tokenizeTabItems(text);
  const beats: ParsedTabBeat[] = [];
  for (const item of items) {
    const itemStart = start + item.start;
    if (item.text === '%') {
      issues.push(issue('invalidTabToken', itemStart, itemStart + 1, { token: item.text }));
      continue;
    }
    const parsed = parseTabBeatToken(item.text, itemStart);
    beats.push(parsed.beat);
    issues.push(...parsed.issues);
  }
  return { isRepeat: false, beats, issues };
}

export function resolveTabBeatDurations(beats: readonly ParsedTabBeat[], initialDuration?: NoteValue): ResolvedTabBeats {
  const resolved: TabBeat[] = [];
  const issues: TabSyntaxIssue[] = [];
  let previous = initialDuration;
  for (const beat of beats) {
    const duration = beat.duration ?? previous;
    if (!duration) {
      issues.push(issue('missingInitialOctaveOrLength', beat.startCol, beat.endCol, { token: '' }) as TabSyntaxIssue);
      continue;
    }
    const stringCounts = new Map<number, number>();
    for (const note of beat.notes) stringCounts.set(note.string, (stringCounts.get(note.string) ?? 0) + 1);
    resolved.push({
      isRest: beat.isRest,
      notes: beat.notes.filter(note => note.string >= 1 && note.string <= 6 && stringCounts.get(note.string) === 1).map(note => ({
        string: note.string as GuitarString,
        ...(note.fret === undefined ? {} : { fret: note.fret }),
        dead: note.dead,
        tieToNext: note.tieToNext,
        effects: note.effects
      })),
      duration,
      effects: beat.effects,
      syllables: []
    });
    previous = duration;
  }
  return { beats: resolved, lastDuration: previous, issues };
}

export function parseTabEffectCalls(source: string, startCol: number): { readonly calls: readonly TabEffectCall[]; readonly issues: readonly TabSyntaxIssue[] } {
  const issues: TabSyntaxIssue[] = [];
  const calls: TabEffectCall[] = [];
  for (const part of splitTopLevel(source, ',')) {
    const raw = part.text.trim();
    if (!raw) {
      issues.push(issue('invalidTabEffect', startCol + part.start, startCol + part.end, { token: raw }));
      continue;
    }
    const open = raw.indexOf('(');
    const name = (open < 0 ? raw : raw.slice(0, open)).trim();
    if (!IDENTIFIER.test(name)) {
      issues.push(issue('invalidTabEffect', startCol + part.start, startCol + part.end, { token: raw }));
      continue;
    }
    const args: Record<string, TabEffectValue> = {};
    if (open >= 0) {
      if (!raw.endsWith(')') || matchingClose(raw, open, '(', ')') !== raw.length - 1) {
        issues.push(issue('invalidTabEffect', startCol + part.start, startCol + part.end, { token: raw }));
        continue;
      }
      const argText = raw.slice(open + 1, -1);
      if (argText.trim()) {
        let valid = true;
        for (const arg of splitTopLevel(argText, ',')) {
          const equals = topLevelIndex(arg.text, '=');
          const key = equals < 0 ? '' : arg.text.slice(0, equals).trim();
          const valueText = equals < 0 ? '' : arg.text.slice(equals + 1).trim();
          const value = valueText ? parseEffectValue(valueText) : null;
          if (!IDENTIFIER.test(key) || value === null || Object.prototype.hasOwnProperty.call(args, key)) {
            valid = false;
            break;
          }
          args[key] = value;
        }
        if (!valid) {
          issues.push(issue('invalidTabEffect', startCol + part.start, startCol + part.end, { token: raw }));
          continue;
        }
      }
    }
    calls.push({ name, args });
  }
  return { calls, issues };
}

function parseTabBeatToken(token: string, startCol: number): { beat: ParsedTabBeat; issues: TabSyntaxIssue[] } {
  const issues: TabSyntaxIssue[] = [];
  let mainEnd = token.length;
  let beatEffects: TabEffectCall[] = [];
  const bang = topLevelIndex(token, '!');
  if (bang >= 0) {
    const effectText = token.slice(bang + 1);
    if (!effectText.startsWith('{') || matchingClose(effectText, 0, '{', '}') !== effectText.length - 1) {
      issues.push(issue('invalidTabEffect', startCol + bang, startCol + token.length, { token: effectText }));
    } else {
      const parsed = parseTabEffectCalls(effectText.slice(1, -1), startCol + bang + 2);
      beatEffects = [...parsed.calls];
      issues.push(...parsed.issues);
      for (const call of beatEffects) {
        if (!BEAT_EFFECTS.has(call.name) || Object.keys(call.args).length > 0) {
          issues.push(issue(NOTE_EFFECTS.has(call.name) ? 'invalidTabEffectScope' : 'invalidTabEffect', startCol + bang, startCol + token.length, { effect: call.name }));
          beatEffects = beatEffects.filter(effect => effect !== call);
        }
      }
    }
    mainEnd = bang;
  }
  const main = token.slice(0, mainEnd);
  const slash = topLevelIndex(main, '/');
  const itemText = slash < 0 ? main : main.slice(0, slash);
  let duration: NoteValue | undefined;
  if (slash >= 0) {
    const durationText = main.slice(slash + 1).trim();
    const parsedDuration = parseNoteValueDetailed(durationText);
    if (typeof parsedDuration === 'string') {
      issues.push(issue('invalidTabToken', startCol + slash, startCol + main.length, { token: main.slice(slash) }));
    } else duration = parsedDuration;
  }

  let isRest = false;
  let notes: ParsedTabNote[] = [];
  const itemStart = startCol;
  const item = itemText.trim();
  if (item === 'r') {
    isRest = true;
  } else if (item.startsWith('[')) {
    const close = matchingClose(item, 0, '[', ']');
    if (close < 0 || close !== item.length - 1) {
      issues.push(issue('invalidTabToken', itemStart, startCol + itemText.length, { token: item }));
    } else {
      const members = splitTopLevel(item.slice(1, -1), ',');
      if (members.length < 2) issues.push(issue('invalidTabToken', itemStart, startCol + itemText.length, { token: item }));
      for (const member of members) {
        const memberStart = itemStart + 1 + member.start;
        const parsed = parseTabNote(member.text.trim(), memberStart + member.text.indexOf(member.text.trim()));
        notes.push(parsed.note);
        issues.push(...parsed.issues);
      }
    }
  } else {
    const parsed = parseTabNote(item, itemStart);
    notes = [parsed.note];
    issues.push(...parsed.issues);
  }
  const seen = new Set<number>();
  for (const note of notes) {
    if (seen.has(note.string)) issues.push(issue('duplicateTabString', note.startCol, note.endCol, { string: note.string }));
    seen.add(note.string);
  }
  if (!isRest && notes.length === 0) issues.push(issue('invalidTabToken', itemStart, startCol + itemText.length, { token: item }));
  return {
    beat: { isRest, notes, duration, effects: beatEffects, startCol, endCol: startCol + token.length },
    issues
  };
}

function parseTabNote(source: string, startCol: number): { note: ParsedTabNote; issues: TabSyntaxIssue[] } {
  const issues: TabSyntaxIssue[] = [];
  const match = source.match(/^([0-9]+)(f([0-9]+)|x)/);
  if (!match) {
    issues.push(issue('invalidTabToken', startCol, startCol + Math.max(1, source.length), { token: source }));
    return { note: { string: 0, dead: false, tieToNext: false, effects: [], startCol, endCol: startCol + source.length }, issues };
  }
  const string = Number(match[1]);
  const dead = match[2] === 'x';
  const fret = dead ? undefined : Number(match[3]);
  if (!Number.isInteger(string) || string < 1 || string > 6) issues.push(issue('invalidTabString', startCol, startCol + match[1].length, { string }));
  if (fret !== undefined && (!Number.isInteger(fret) || fret < 0)) issues.push(issue('invalidTabFret', startCol + match[1].length + 1, startCol + match[0].length, { fret: match[3] }));
  let offset = match[0].length;
  let effects: TabEffectCall[] = [];
  if (source[offset] === '{') {
    const close = matchingClose(source, offset, '{', '}');
    if (close < 0) {
      issues.push(issue('invalidTabEffect', startCol + offset, startCol + source.length, { token: source.slice(offset) }));
      offset = source.length;
    } else {
      const parsed = parseTabEffectCalls(source.slice(offset + 1, close), startCol + offset + 1);
      effects = [...parsed.calls];
      issues.push(...parsed.issues);
      for (const call of effects) {
        if (!NOTE_EFFECTS.has(call.name) || (call.name === 'bend' ? Object.keys(call.args).length !== 1 || typeof call.args.amount !== 'number' : Object.keys(call.args).length !== 0)) {
          issues.push(issue(BEAT_EFFECTS.has(call.name) ? 'invalidTabEffectScope' : 'invalidTabEffect', startCol + offset, startCol + close + 1, { effect: call.name }));
          effects = effects.filter(effect => effect !== call);
        }
      }
      offset = close + 1;
    }
  }
  let tieToNext = false;
  if (source[offset] === '~') { tieToNext = true; offset++; }
  if (offset !== source.length) issues.push(issue('invalidTabToken', startCol + offset, startCol + source.length, { token: source.slice(offset) }));
  return { note: { string, ...(fret === undefined ? {} : { fret }), dead, tieToNext, effects, startCol, endCol: startCol + source.length }, issues };
}

function parseEffectValue(source: string): TabEffectValue | null {
  const text = source.trim();
  if (!text) return null;
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) return text.slice(1, -1);
  if (/^-?(?:[0-9]+(?:\.[0-9]+)?|\.[0-9]+)$/.test(text)) {
    const value = Number(text);
    return Number.isFinite(value) ? value : null;
  }
  const fractionMatch = text.match(/^(-?[0-9]+)\/([0-9]+)$/);
  if (fractionMatch && Number(fractionMatch[2]) !== 0) return frac(Number(fractionMatch[1]), Number(fractionMatch[2]));
  if (text.startsWith('[') && text.endsWith(']') && matchingClose(text, 0, '[', ']') === text.length - 1) {
    const entries = text.slice(1, -1).trim() ? splitTopLevel(text.slice(1, -1), ',') : [];
    const values = entries.map(entry => parseEffectValue(entry.text));
    return values.every(value => value !== null) ? values as TabEffectValue[] : null;
  }
  return IDENTIFIER.test(text) ? text : null;
}

function splitTopLevel(source: string, delimiter: string): { readonly text: string; readonly start: number; readonly end: number }[] {
  const result: { text: string; start: number; end: number }[] = [];
  let square = 0;
  let brace = 0;
  let paren = 0;
  let quote = '';
  let escaped = false;
  let start = 0;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (ch === '[') square++;
    else if (ch === ']') square = Math.max(0, square - 1);
    else if (ch === '{') brace++;
    else if (ch === '}') brace = Math.max(0, brace - 1);
    else if (ch === '(') paren++;
    else if (ch === ')') paren = Math.max(0, paren - 1);
    else if (ch === delimiter && square === 0 && brace === 0 && paren === 0) {
      result.push({ text: source.slice(start, i), start, end: i });
      start = i + 1;
    }
  }
  result.push({ text: source.slice(start), start, end: source.length });
  return result;
}

function topLevelIndex(source: string, target: string): number {
  const parts = splitTopLevel(source, target);
  return parts.length > 1 ? parts[0].end : -1;
}

function matchingClose(source: string, openAt: number, open: string, close: string): number {
  let depth = 0;
  let quote = '';
  let escaped = false;
  for (let i = openAt; i < source.length; i++) {
    const ch = source[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (ch === open) depth++;
    else if (ch === close && --depth === 0) return i;
  }
  return -1;
}

function tabCommentEnd(source: string, start: number): number {
  let square = 0;
  let brace = 0;
  let paren = 0;
  let quote = '';
  let escaped = false;
  for (let i = start; i < source.length; i++) {
    const ch = source[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (ch === '[') square++;
    else if (ch === ']') square = Math.max(0, square - 1);
    else if (ch === '{') brace++;
    else if (ch === '}') brace = Math.max(0, brace - 1);
    else if (ch === '(') paren++;
    else if (ch === ')') paren = Math.max(0, paren - 1);
    else if (ch === '#' && i > start && /\s/.test(source[i - 1]) && square === 0 && brace === 0 && paren === 0) return i;
  }
  return source.length;
}

function pushCell(rawLine: string, rawStart: number, rawEnd: number, cells: TabCellSpan[]): void {
  const raw = rawLine.slice(rawStart, rawEnd);
  const text = raw.trim();
  if (!text || text === ':' || text === ':]') return;
  const leading = raw.indexOf(text);
  cells.push({ text, startCol: rawStart + leading, endCol: rawStart + leading + text.length });
}

function issue(code: TabSyntaxIssue['code'], startCol: number, endCol: number, args?: Readonly<Record<string, string | number>>): TabSyntaxIssue {
  return { code, startCol, endCol: Math.max(startCol + 1, endCol), args };
}
