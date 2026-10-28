import { isValidChordName } from '../chordDefinition';
import { parseGuitarDsl, rhythmItemBeats, type LetDefinitionSummary, type ParsedScore, type VisualSourceBinding } from '../compiler';
import { planMusicCodeAction } from '../codeActions/planners';
import { spliceSourceOffsets, type SourceOffsetEdit } from '../sourceEdits';
import { fnum } from '../duration';
import type { LetOperation, VisualEditFailure, VisualEditOperation, VisualEditResult } from './model';
import { validateCandidateSource } from './validation';

const VARIABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const MAX_VALUE_LENGTH = 2048;

function failure(code: VisualEditFailure['code']): VisualEditFailure {
  return { ok: false, code };
}

function lineStarts(source: string): number[] {
  const starts = [0];
  for (let i = 0; i < source.length; i++) if (source[i] === '\n') starts.push(i + 1);
  return starts;
}

function offsetAt(source: string, line: number, column: number): number | undefined {
  const starts = lineStarts(source);
  const start = starts[line];
  if (start === undefined || !Number.isSafeInteger(column) || column < 0) return undefined;
  const end = source.indexOf('\n', start);
  const lineEnd = end < 0 ? source.length : end - (end > start && source[end - 1] === '\r' ? 1 : 0);
  return start + column <= lineEnd ? start + column : undefined;
}

function spanEdit(source: string, line: number, startCol: number, endCol: number, text: string): SourceOffsetEdit | undefined {
  const start = offsetAt(source, line, startCol);
  const end = offsetAt(source, line, endCol);
  if (start === undefined || end === undefined || end < start) return undefined;
  return { start, end, expected: source.slice(start, end), text };
}

function definitionFor(score: ParsedScore, name: string): LetDefinitionSummary | undefined {
  return score.letDefinitions?.find(definition => definition.name === name && !definition.duplicate);
}

function finish(source: string, score: ParsedScore, edits: readonly SourceOffsetEdit[]): VisualEditResult {
  const spliced = spliceSourceOffsets(source, edits);
  if (!spliced.ok) return failure('staleSource');
  const validated = validateCandidateSource(source, spliced.text, score);
  if (!validated.ok) return failure(validated.code);
  return { ok: true, edits: [...edits], resultingSource: spliced.text, postcondition: 'no-new-errors' };
}

type EventCollection = NonNullable<VisualSourceBinding['eventRange']>['collection'];
interface EventSnapshot { readonly onset: number; readonly duration: number; readonly signature: string }

function eventSnapshots(score: ParsedScore, collection: EventCollection, measureIndex: number): EventSnapshot[] {
  const measure = score.measures[measureIndex];
  if (!measure) return [];
  const snapshots: EventSnapshot[] = [];
  let onset = 0;
  const append = (duration: number, signature: unknown) => {
    snapshots.push({ onset: Math.round(onset * 1e9) / 1e9, duration, signature: JSON.stringify(signature) });
    onset += duration;
  };
  if (collection === 'rhythm') {
    for (const event of measure.rhythms) {
      append(fnum(rhythmItemBeats(event)), {
        isRest: event.isRest, down: event.down, up: event.up, ghost: event.ghost,
        accent: event.accent, mute: event.mute, stringAttack: event.stringAttack,
        tie: event.tie, arpeggio: event.arpeggio, pitch: event.pitch, pitches: event.pitches,
        inlineLyric: event.inlineLyric, techniques: event.techniques
      });
    }
  } else if (collection === 'melody') {
    for (const event of measure.melody ?? []) {
      append(fnum(event.beats), {
        isRest: event.isRest, pitch: event.pitch, pitches: event.pitches, parts: event.parts,
        techniques: event.techniques, tieToNext: event.tieToNext, tiedFromPrev: event.tiedFromPrev,
        syllables: event.syllables
      });
    }
  } else {
    for (const event of measure.tabVoices?.find(voice => voice.voice === 1)?.beats ?? []) {
      append(fnum(event.duration.beats), {
        isRest: event.isRest, notes: event.notes, duration: event.duration,
        effects: event.effects, syllables: event.syllables
      });
    }
  }
  return snapshots;
}

/** Ensures a source-token edit cannot silently change another event through inherited state. */
function eventsUnchangedOutsideTarget(before: ParsedScore, after: ParsedScore, collection: EventCollection,
  measureIndex: number, oldRange: { start: number; end: number }, newRange: { start: number; end: number },
  allowOnsetShift: boolean): boolean {
  const oldEvents = eventSnapshots(before, collection, measureIndex);
  const newEvents = eventSnapshots(after, collection, measureIndex);
  if (oldRange.start < 0 || oldRange.end < oldRange.start || oldRange.end > oldEvents.length
    || newRange.start < 0 || newRange.end < newRange.start || newRange.end > newEvents.length
    || oldRange.start !== newRange.start) return false;
  const oldPrefix = oldEvents.slice(0, oldRange.start);
  const newPrefix = newEvents.slice(0, newRange.start);
  const oldSuffix = oldEvents.slice(oldRange.end);
  const newSuffix = newEvents.slice(newRange.end);
  if (oldPrefix.length !== newPrefix.length || oldSuffix.length !== newSuffix.length) return false;
  for (let i = 0; i < oldPrefix.length; i++) {
    if (oldPrefix[i].signature !== newPrefix[i].signature || oldPrefix[i].duration !== newPrefix[i].duration
      || oldPrefix[i].onset !== newPrefix[i].onset) return false;
  }
  const oldTargetDuration = oldEvents.slice(oldRange.start, oldRange.end).reduce((sum, event) => sum + event.duration, 0);
  const newTargetDuration = newEvents.slice(newRange.start, newRange.end).reduce((sum, event) => sum + event.duration, 0);
  const onsetShift = Math.round((newTargetDuration - oldTargetDuration) * 1e9) / 1e9;
  if (!allowOnsetShift && oldSuffix.length > 0 && onsetShift !== 0) return false;
  const expectedOnsetShift = allowOnsetShift ? onsetShift : 0;
  for (let i = 0; i < oldSuffix.length; i++) {
    if (oldSuffix[i].signature !== newSuffix[i].signature
      || oldSuffix[i].duration !== newSuffix[i].duration
      || Math.abs(newSuffix[i].onset - oldSuffix[i].onset - expectedOnsetShift) > 1e-9) return false;
  }

  // Melody octave/length state and TAB inherited duration continue across authored measure cells.
  // Compare every later measure so a safe-looking edit at the end of one cell cannot change the next.
  for (let index = measureIndex + 1; index < Math.max(before.measures.length, after.measures.length); index++) {
    const previous = eventSnapshots(before, collection, index);
    const next = eventSnapshots(after, collection, index);
    if (previous.length !== next.length) return false;
    for (let eventIndex = 0; eventIndex < previous.length; eventIndex++) {
      if (previous[eventIndex].signature !== next[eventIndex].signature
        || previous[eventIndex].duration !== next[eventIndex].duration
        || previous[eventIndex].onset !== next[eventIndex].onset) return false;
    }
  }
  return true;
}

type LyricMutation = { kind: 'insert'; insertedBinding: VisualSourceBinding }
  | { kind: 'delete' }
  | { kind: 'replace' };

function lyricGroupKey(binding: VisualSourceBinding): string {
  return `${binding.cellId}\u0000${binding.visualVerse ?? ''}`;
}

function lyricGroups(score: ParsedScore): Map<string, VisualSourceBinding[]> {
  const groups = new Map<string, VisualSourceBinding[]>();
  for (const binding of score.visualSourceBindings ?? []) {
    if (binding.kind !== 'lyric') continue;
    const key = lyricGroupKey(binding);
    const group = groups.get(key) ?? [];
    group.push(binding);
    groups.set(key, group);
  }
  for (const group of groups.values()) group.sort((a, b) => a.startCol - b.startCol);
  return groups;
}

function sameLyricAssignment(before: VisualSourceBinding, after: VisualSourceBinding, compareText = true): boolean {
  return (!compareText || before.expected === after.expected)
    && before.measureIndex === after.measureIndex
    && before.eventRange?.collection === after.eventRange?.collection
    && before.eventRange?.start === after.eventRange?.start
    && before.eventRange?.end === after.eventRange?.end
    && before.visualVerse === after.visualVerse;
}

function lyricEventSlots(score: ParsedScore, collection: 'melody' | 'tab'): Map<string, readonly unknown[]> {
  const slots = new Map<string, readonly unknown[]>();
  score.measures.forEach((measure, measureIndex) => {
    const events = collection === 'melody'
      ? measure.melody ?? []
      : measure.tabVoices?.find(voice => voice.voice === 1)?.beats ?? [];
    events.forEach((event, eventIndex) => slots.set(`${measureIndex}:${eventIndex}`, event.syllables ?? []));
  });
  return slots;
}

/** Preserve all rendered lyric slots, including melisma/skip markers without their own source binding. */
function lyricEventSlotsUnchanged(before: ParsedScore, after: ParsedScore, target: VisualSourceBinding,
  mutation: LyricMutation, nextBinding?: VisualSourceBinding): boolean {
  const targetBinding = mutation.kind === 'insert' ? mutation.insertedBinding
    : mutation.kind === 'replace' ? nextBinding ?? target : target;
  const range = targetBinding.eventRange;
  const verse = target.visualVerse;
  if (!range || (range.collection !== 'melody' && range.collection !== 'tab')
    || range.end !== range.start + 1 || verse === undefined) return false;
  const targetKey = `${targetBinding.measureIndex}:${range.start}`;
  let targetChanged = false;

  for (const collection of ['melody', 'tab'] as const) {
    const oldSlots = lyricEventSlots(before, collection);
    const newSlots = lyricEventSlots(after, collection);
    const keys = new Set([...oldSlots.keys(), ...newSlots.keys()]);
    for (const key of keys) {
      const oldValues = oldSlots.get(key) ?? [];
      const newValues = newSlots.get(key) ?? [];
      const maxVerse = Math.max(oldValues.length, newValues.length);
      if (collection === range.collection && key === targetKey) {
        for (let index = 0; index < maxVerse; index++) {
          if (index === verse) continue;
          if (JSON.stringify(oldValues[index]) !== JSON.stringify(newValues[index])) return false;
        }
        targetChanged = JSON.stringify(oldValues[verse]) !== JSON.stringify(newValues[verse]);
      } else if (JSON.stringify(oldValues) !== JSON.stringify(newValues)) return false;
    }
  }
  return mutation.kind === 'replace' || targetChanged;
}

/** Existing syllables may not move to a different note or verse as a side effect of a lyric edit. */
function lyricAssignmentsUnchanged(before: ParsedScore, after: ParsedScore, target: VisualSourceBinding,
  mutation: LyricMutation, nextBinding?: VisualSourceBinding): boolean {
  const beforeGroups = lyricGroups(before);
  const afterGroups = lyricGroups(after);
  const targetKey = lyricGroupKey(target);
  const oldTargetGroup = beforeGroups.get(targetKey) ?? [];
  const newTargetGroup = afterGroups.get(targetKey) ?? [];
  const targetIndex = oldTargetGroup.findIndex(binding => binding.id === target.id);
  if (targetIndex < 0) return false;

  const keys = new Set([...beforeGroups.keys(), ...afterGroups.keys()]);
  for (const key of keys) {
    const oldGroup = beforeGroups.get(key) ?? [];
    const newGroup = afterGroups.get(key) ?? [];
    if (key !== targetKey) {
      if (oldGroup.length !== newGroup.length
        || oldGroup.some((binding, index) => !sameLyricAssignment(binding, newGroup[index]))) return false;
      continue;
    }

    if (mutation.kind === 'insert') {
      if (!nextBinding || newGroup.length !== oldGroup.length + 1) return false;
      const insertedIndex = newGroup.findIndex(binding => binding.id === mutation.insertedBinding.id);
      if (insertedIndex < 0 || newGroup[insertedIndex].expected !== mutation.insertedBinding.expected
        || newGroup[insertedIndex].startCol !== target.endCol + 1) return false;
      for (let oldIndex = 0; oldIndex < oldGroup.length; oldIndex++) {
        const newIndex = oldIndex < insertedIndex ? oldIndex : oldIndex + 1;
        if (!sameLyricAssignment(oldGroup[oldIndex], newGroup[newIndex])) return false;
      }
    } else if (mutation.kind === 'delete') {
      if (newGroup.length !== oldGroup.length - 1) return false;
      for (let oldIndex = 0; oldIndex < oldGroup.length; oldIndex++) {
        if (oldIndex === targetIndex) continue;
        const newIndex = oldIndex < targetIndex ? oldIndex : oldIndex - 1;
        if (!sameLyricAssignment(oldGroup[oldIndex], newGroup[newIndex])) return false;
      }
    } else {
      if (!nextBinding || newGroup.length !== oldGroup.length) return false;
      const replacementIndex = newGroup.findIndex(binding => binding.id === nextBinding.id);
      if (replacementIndex !== targetIndex) return false;
      for (let index = 0; index < oldGroup.length; index++) {
        if (!sameLyricAssignment(oldGroup[index], newGroup[index], index !== targetIndex)) return false;
      }
    }
  }
  return lyricEventSlotsUnchanged(before, after, target, mutation, nextBinding);
}

function finishVisual(source: string, score: ParsedScore, edits: readonly SourceOffsetEdit[], binding: VisualSourceBinding,
  nextBinding?: VisualSourceBinding, allowOnsetShift = false, deleted = false,
  oldRangeOverride?: { collection: EventCollection; start: number; end: number },
  lyricMutation?: LyricMutation): VisualEditResult {
  const spliced = spliceSourceOffsets(source, edits);
  if (!spliced.ok) return failure('staleSource');
  const validated = validateCandidateSource(source, spliced.text, score);
  if (!validated.ok) return failure(validated.code);
  if (binding.kind === 'lyric' && lyricMutation
    && !lyricAssignmentsUnchanged(score, validated.score, binding, lyricMutation,
      lyricMutation.kind === 'insert' ? lyricMutation.insertedBinding : nextBinding)) return failure('diagnosticRegression');
  const oldRange = binding.kind === 'lyric' ? undefined : oldRangeOverride ?? binding.eventRange;
  if (oldRange) {
    const nextRange = deleted
      ? { collection: oldRange.collection, start: oldRange.start, end: oldRange.start }
      : nextBinding?.eventRange;
    if (!nextRange || nextRange.collection !== oldRange.collection
      || !eventsUnchangedOutsideTarget(score, validated.score, oldRange.collection, binding.measureIndex ?? -1,
        { start: oldRange.start, end: oldRange.end }, { start: nextRange.start, end: nextRange.end }, allowOnsetShift)) {
      return failure('diagnosticRegression');
    }
  }
  return { ok: true, edits: [...edits], resultingSource: spliced.text, postcondition: 'no-new-errors' };
}

function tokenFamily(kind: VisualSourceBinding['kind']): string {
  if (kind === 'chord') return 'chord';
  if (kind === 'tab') return 'tab';
  if (kind === 'lyric') return 'lyric';
  if (kind === 'melodyNote' || kind === 'melodyGroup' || kind === 'melodyRest') return 'melody';
  if (kind === 'rhythm' || kind === 'noteGroup' || kind === 'inlineNote') return 'measure-rhythm';
  return 'readonly';
}

function bindingAt(score: ParsedScore, binding: VisualSourceBinding, startCol: number): VisualSourceBinding | undefined {
  const family = tokenFamily(binding.kind);
  return score.visualSourceBindings?.find(candidate => candidate.line === binding.line && candidate.startCol === startCol
    && candidate.cellId === binding.cellId && tokenFamily(candidate.kind) === family);
}

function validateSingleToken(text: string): boolean {
  return text.length > 0 && text.length <= 256 && text.trim() === text && !/[\s\0]/u.test(text);
}

function deleteTokenEdit(source: string, binding: VisualSourceBinding): SourceOffsetEdit | undefined {
  const start = offsetAt(source, binding.line, binding.startCol);
  const end = offsetAt(source, binding.line, binding.endCol);
  if (start === undefined || end === undefined || source.slice(start, end) !== binding.expected) return undefined;
  let deleteStart = start;
  let deleteEnd = end;
  if (source[deleteEnd] === ' ' || source[deleteEnd] === '\t') deleteEnd++;
  else if (source[deleteStart - 1] === ' ' || source[deleteStart - 1] === '\t') deleteStart--;
  return { start: deleteStart, end: deleteEnd, expected: source.slice(deleteStart, deleteEnd), text: '' };
}

function tabNoteTextValid(text: string): boolean {
  return /^[1-6](?:f[0-9]+|x)(?:~)?$/u.test(text);
}

function existingNames(score: ParsedScore): Set<string> {
  return new Set((score.sourceDefinitions ?? []).filter(item => item.kind === 'let').map(item => item.name));
}

function validValue(value: string): boolean {
  return value.length > 0 && value.length <= MAX_VALUE_LENGTH && !/[\r\n\0]/.test(value) && value.trim().length > 0;
}

function insertion(source: string, score: ParsedScore): { offset: number; eol: string; prefix: string } {
  const starts = lineStarts(source);
  const eol = source.includes('\r\n') ? '\r\n' : '\n';
  if (score.firstBodyLine !== undefined) return { offset: starts[score.firstBodyLine] ?? source.length, eol, prefix: '' };
  return { offset: source.length, eol, prefix: source.length > 0 && !source.endsWith('\n') ? eol : '' };
}

function planLocalDetach(source: string, score: ParsedScore, operation: Extract<LetOperation, { kind: 'detachLocal' }>): VisualEditResult {
  const definition = definitionFor(score, operation.name);
  if (!definition) return failure('definitionNotFound');
  if (!definition.valid) return failure('definitionInvalid');
  const reference = (score.codeActionTokens ?? []).filter(token => token.kind === 'letReference'
    && token.text === `$${operation.name}` && token.line === operation.line
    && token.startCol === operation.startCol && token.endCol === operation.endCol);
  if (reference.length !== 1) return failure('ambiguousReference');
  const token = reference[0];
  if (token.measureIndex !== undefined && score.measures[token.measureIndex]?.isMeasureRepeat) return failure('unsafeExpansion');
  const start = offsetAt(source, token.line, token.startCol);
  const end = offsetAt(source, token.line, token.endCol);
  if (start === undefined || end === undefined || source.slice(start, end) !== token.text) return failure('staleSource');
  const operationText = operation.value;
  if (operationText !== undefined) {
    if (!validValue(operationText)) return failure('invalidValue');
    return finish(source, score, [{ start, end, expected: token.text, text: operationText }]);
  }
  const plan = planMusicCodeAction(source, score, { kind: 'inlineLet', selection: { start, end } });
  if (!plan.ok) return failure(plan.code === 'staleSource' ? 'staleSource' : 'unsafeExpansion');
  const checked = validateCandidateSource(source, plan.text, score);
  if (!checked.ok) return failure(checked.code);
  return { ok: true, edits: plan.edits, resultingSource: plan.text, postcondition: 'no-new-errors' };
}

/** Builds one source-preserving edit from a parser-issued authored token id. */
export function planVisualEdit(source: string, score: ParsedScore, operation: VisualEditOperation): VisualEditResult {
  const binding = (score.visualSourceBindings ?? []).find(item => item.id === operation.bindingId);
  if (!binding) return failure('targetNotFound');
  const expectedKinds: Record<VisualEditOperation['kind'], readonly VisualSourceBinding['kind'][]> = {
    replaceChord: ['chord'],
    insertToken: ['chord', 'melodyNote', 'melodyGroup', 'melodyRest', 'rhythm', 'noteGroup', 'inlineNote', 'tab', 'lyric'],
    deleteToken: ['chord', 'melodyNote', 'melodyGroup', 'melodyRest', 'rhythm', 'noteGroup', 'inlineNote', 'tab', 'lyric'],
    replaceMelodyToken: ['melodyNote', 'melodyGroup', 'melodyRest', 'noteGroup', 'inlineNote'],
    transposeMelody: ['melodyNote'],
    changeDuration: ['melodyNote', 'melodyGroup', 'melodyRest', 'rhythm', 'noteGroup', 'inlineNote'],
    replaceRhythmToken: ['rhythm', 'noteGroup', 'inlineNote'],
    replaceTabToken: ['tab'],
    addTabChordNote: ['tab'],
    deleteTabChordNote: ['tab'],
    replaceLyric: ['lyric']
  };
  if (binding.kind === 'letReference' || !expectedKinds[operation.kind]?.includes(binding.kind)) return failure('unsupportedTarget');

  if (operation.kind === 'deleteToken') {
    const edit = deleteTokenEdit(source, binding);
    if (!edit) return failure('staleSource');
    const candidate = spliceSourceOffsets(source, [edit]);
    if (!candidate.ok) return failure('staleSource');
    const validated = validateCandidateSource(source, candidate.text, score);
    if (!validated.ok) return failure(validated.code);
    const family = tokenFamily(binding.kind);
    const beforeCount = (score.visualSourceBindings ?? []).filter(item => item.cellId === binding.cellId && tokenFamily(item.kind) === family).length;
    const afterCount = (validated.score.visualSourceBindings ?? []).filter(item => item.cellId === binding.cellId && tokenFamily(item.kind) === family).length;
    if (afterCount !== beforeCount - 1) return failure('unsupportedTarget');
    return finishVisual(source, score, [edit], binding, undefined, true, true, undefined,
      binding.kind === 'lyric' ? { kind: 'delete' } : undefined);
  }

  if (operation.kind === 'insertToken') {
    if (!validateSingleToken(operation.text)) return failure('invalidValue');
    const start = offsetAt(source, binding.line, binding.endCol);
    if (start === undefined) return failure('staleSource');
    const edit: SourceOffsetEdit = { start, end: start, expected: '', text: ` ${operation.text}` };
    const candidate = spliceSourceOffsets(source, [edit]);
    if (!candidate.ok) return failure('staleSource');
    const validated = validateCandidateSource(source, candidate.text, score);
    if (!validated.ok) return failure(validated.code);
    const nextBinding = bindingAt(validated.score, binding, binding.endCol + 1);
    if (!nextBinding) return failure('unsupportedTarget');
    const family = tokenFamily(binding.kind);
    const beforeCount = (score.visualSourceBindings ?? []).filter(item => item.cellId === binding.cellId && tokenFamily(item.kind) === family).length;
    const afterCount = (validated.score.visualSourceBindings ?? []).filter(item => item.cellId === binding.cellId && tokenFamily(item.kind) === family).length;
    if (afterCount !== beforeCount + 1) return failure('unsupportedTarget');
    const insertionRange = binding.eventRange
      ? { collection: binding.eventRange.collection, start: binding.eventRange.end, end: binding.eventRange.end }
      : undefined;
    return finishVisual(source, score, [edit], binding, nextBinding, true, false, insertionRange,
      binding.kind === 'lyric' ? { kind: 'insert', insertedBinding: nextBinding } : undefined);
  }

  if (operation.kind === 'addTabChordNote' || operation.kind === 'deleteTabChordNote') {
    if (!binding.subTokens || binding.subTokens.length < 2) return failure('unsupportedTarget');
    const tokenStart = offsetAt(source, binding.line, binding.startCol);
    const tokenEnd = offsetAt(source, binding.line, binding.endCol);
    if (tokenStart === undefined || tokenEnd === undefined || source.slice(tokenStart, tokenEnd) !== binding.expected) return failure('staleSource');
    let edit: SourceOffsetEdit | undefined;
    if (operation.kind === 'addTabChordNote') {
      if (!tabNoteTextValid(operation.note) || binding.subTokens.some(note => note.text.match(/^[1-6]/)?.[0] === operation.note.match(/^[1-6]/)?.[0])) {
        return failure('invalidValue');
      }
      const close = source.indexOf(']', tokenStart);
      if (close < tokenStart || close >= tokenEnd) return failure('unsupportedTarget');
      edit = { start: close, end: close, expected: '', text: `,${operation.note}` };
    } else {
      const noteIndex = binding.subTokens.findIndex(note => note.text === operation.note);
      if (noteIndex < 0) return failure('targetNotFound');
      const closingBracket = source.indexOf(']', tokenStart);
      if (closingBracket < tokenStart || closingBracket >= tokenEnd) return failure('unsupportedTarget');
      if (binding.subTokens.length === 2) {
        const remaining = binding.subTokens[1 - noteIndex];
        const suffixStart = closingBracket + 1;
        edit = { start: tokenStart, end: suffixStart, expected: source.slice(tokenStart, suffixStart), text: remaining.text };
      } else if (noteIndex < binding.subTokens.length - 1) {
        const note = binding.subTokens[noteIndex];
        const next = binding.subTokens[noteIndex + 1];
        const start = offsetAt(source, binding.line, note.startCol);
        const end = offsetAt(source, binding.line, next.startCol);
        if (start === undefined || end === undefined || end < start) return failure('staleSource');
        const expected = source.slice(start, end);
        if (!expected.startsWith(note.text) || !/^,[ \t]*$/u.test(expected.slice(note.text.length))) return failure('staleSource');
        edit = { start, end, expected, text: '' };
      } else {
        const previous = binding.subTokens[noteIndex - 1];
        const note = binding.subTokens[noteIndex];
        const start = offsetAt(source, binding.line, previous.endCol);
        const end = offsetAt(source, binding.line, note.endCol);
        if (start === undefined || end === undefined || end < start) return failure('staleSource');
        const expected = source.slice(start, end);
        const separatorLength = expected.length - note.text.length;
        if (separatorLength < 0 || expected.slice(0, separatorLength) === ''
          || !/^,[ \t]*$/u.test(expected.slice(0, separatorLength))
          || expected.slice(separatorLength) !== note.text) return failure('staleSource');
        edit = { start, end, expected, text: '' };
      }
    }
    if (!edit) return failure('staleSource');
    const candidate = spliceSourceOffsets(source, [edit]);
    if (!candidate.ok) return failure('staleSource');
    const validated = validateCandidateSource(source, candidate.text, score);
    if (!validated.ok) return failure(validated.code);
    const nextBinding = bindingAt(validated.score, binding, binding.startCol);
    if (!nextBinding) return failure('unsupportedTarget');
    return finishVisual(source, score, [edit], binding, nextBinding);
  }

  if (operation.kind === 'transposeMelody' || operation.kind === 'changeDuration') {
    if (operation.kind === 'transposeMelody'
      && (!Number.isSafeInteger(operation.semitones) || operation.semitones === 0 || Math.abs(operation.semitones) > 11)) {
      return failure('invalidOperation');
    }
    const start = offsetAt(source, binding.line, binding.startCol);
    const end = offsetAt(source, binding.line, binding.endCol);
    if (start === undefined || end === undefined || source.slice(start, end) !== binding.expected) return failure('staleSource');
    const action = operation.kind === 'transposeMelody'
      ? { kind: 'transpose' as const, selection: { start, end }, semitones: operation.semitones }
      : { kind: operation.direction === 'longer' ? 'doubleDuration' as const : 'halveDuration' as const, selection: { start, end } };
    const planned = planMusicCodeAction(source, score, action);
    if (!planned.ok) return failure(planned.code === 'staleSource' ? 'staleSource' : 'unsupportedTarget');
    const validated = validateCandidateSource(source, planned.text, score);
    if (!validated.ok) return failure(validated.code);
    const nextBinding = bindingAt(validated.score, binding, binding.startCol);
    if (!nextBinding) return failure('unsupportedTarget');
    return finishVisual(source, score, planned.edits, binding, nextBinding);
  }
  const replacement = operation.kind === 'replaceChord' ? operation.name : operation.text;
  if (!replacement || replacement.length > 256 || /[\r\n\0]/.test(replacement)) return failure('invalidValue');
  if ((operation.kind === 'replaceMelodyToken' || operation.kind === 'replaceRhythmToken' || operation.kind === 'replaceTabToken')
    && !validateSingleToken(replacement)) return failure('invalidValue');
  if (operation.kind === 'replaceChord' && !isValidChordName(replacement)) return failure('invalidValue');
  if (operation.kind === 'replaceLyric' && /[\s|_*]/u.test(replacement)) return failure('invalidValue');
  const targetSpan = operation.kind === 'replaceChord' ? binding.nameSpan : undefined;
  const edit = spanEdit(source, binding.line, targetSpan?.startCol ?? binding.startCol,
    targetSpan?.endCol ?? binding.endCol, replacement);
  if (!edit || edit.expected !== (targetSpan?.text ?? binding.expected)) return failure('staleSource');
  const candidate = spliceSourceOffsets(source, [edit]);
  if (!candidate.ok) return failure('staleSource');
  const validated = validateCandidateSource(source, candidate.text, score);
  if (!validated.ok) return failure(validated.code);
  const nextBinding = bindingAt(validated.score, binding, binding.startCol);
  if (!nextBinding) return failure('unsupportedTarget');
  return finishVisual(source, score, [edit], binding, nextBinding, false, false, undefined,
    binding.kind === 'lyric' && operation.kind === 'replaceLyric' ? { kind: 'replace' } : undefined);
}

/** Plans one lyric syllable edit without allowing the Webview to submit source offsets unchecked. */
/** Plans a let-definition operation; all ranges come from parser-owned definitions/references. */
export function planLetOperation(source: string, score: ParsedScore, operation: LetOperation): VisualEditResult {
  const names = existingNames(score);
  if (operation.kind === 'add') {
    if (!VARIABLE_NAME.test(operation.name) || names.has(operation.name)) return failure(names.has(operation.name) ? 'duplicateName' : 'invalidValue');
    if (!validValue(operation.value)) return failure('invalidValue');
    const at = insertion(source, score);
    const edit: SourceOffsetEdit = {
      start: at.offset, end: at.offset, expected: '',
      text: `${at.prefix}let ${operation.name} = ${operation.value}${at.eol}`
    };
    return finish(source, score, [edit]);
  }

  if (operation.kind === 'detachLocal') return planLocalDetach(source, score, operation);

  const definition = definitionFor(score, operation.name);
  if (!definition) return failure('definitionNotFound');
  if (!definition.valid) return failure('definitionInvalid');
  const sourceDefinition = (score.sourceDefinitions ?? []).find(item => item.kind === 'let' && item.name === operation.name && !item.duplicate);
  if (!sourceDefinition || sourceDefinition.valueStartCol === undefined || sourceDefinition.valueEndCol === undefined) return failure('definitionNotFound');

  if (operation.kind === 'editGlobal') {
    if (!validValue(operation.value)) return failure('invalidValue');
    const edit = spanEdit(source, definition.line, sourceDefinition.valueStartCol, sourceDefinition.valueEndCol, operation.value);
    if (!edit) return failure('staleSource');
    return finish(source, score, [edit]);
  }

  if (operation.kind === 'rename') {
    if (!VARIABLE_NAME.test(operation.newName)) return failure('invalidValue');
    if (names.has(operation.newName)) return failure('duplicateName');
    const edits: SourceOffsetEdit[] = [];
    const definitionNameEdit = spanEdit(source, definition.line, definition.nameStartCol, definition.nameEndCol, operation.newName);
    if (!definitionNameEdit || definitionNameEdit.expected !== operation.name) return failure('staleSource');
    edits.push(definitionNameEdit);
    for (const reference of definition.directReferences) {
      const edit = spanEdit(source, reference.line, reference.startCol, reference.endCol, `$${operation.newName}`);
      if (!edit || edit.expected !== `$${operation.name}`) return failure('staleSource');
      edits.push(edit);
    }
    return finish(source, score, edits);
  }

  if (operation.kind === 'clone') {
    if (!VARIABLE_NAME.test(operation.newName)) return failure('invalidValue');
    if (names.has(operation.newName)) return failure('duplicateName');
    const valueStart = offsetAt(source, definition.line, sourceDefinition.valueStartCol);
    const valueEnd = offsetAt(source, definition.line, sourceDefinition.valueEndCol);
    if (valueStart === undefined || valueEnd === undefined || valueEnd < valueStart) return failure('staleSource');
    const value = source.slice(valueStart, valueEnd);
    if (!validValue(value)) return failure('staleSource');
    const at = insertion(source, score);
    return finish(source, score, [{ start: at.offset, end: at.offset, expected: '', text: `${at.prefix}let ${operation.newName} = ${value}${at.eol}` }]);
  }

  if (operation.kind === 'deleteUnused') {
    if (definition.directReferences.length > 0 || definition.usageLocations.length > 0) return failure('definitionInUse');
    if (sourceDefinition.trailingComment) return failure('unsafeExpansion');
    const starts = lineStarts(source);
    const start = starts[definition.line];
    if (start === undefined) return failure('staleSource');
    const next = starts[definition.line + 1];
    const end = next === undefined ? source.length : next - (source.slice(next - 2, next) === '\r\n' ? 2 : 1);
    return finish(source, score, [{ start, end, expected: source.slice(start, end), text: '' }]);
  }
  return failure('invalidOperation');
}
