import { isValidChordName } from '../chordDefinition';
import { parseGuitarDsl, type LetDefinitionSummary, type ParsedScore, type VisualSourceBinding } from '../compiler';
import { planMusicCodeAction } from '../codeActions/planners';
import { spliceSourceOffsets, type SourceOffsetEdit } from '../sourceEdits';
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
    replaceMelodyToken: ['melodyNote', 'melodyGroup', 'melodyRest', 'noteGroup', 'inlineNote'],
    transposeMelody: ['melodyNote'],
    changeDuration: ['melodyNote', 'melodyGroup', 'melodyRest', 'rhythm', 'noteGroup', 'inlineNote'],
    replaceRhythmToken: ['rhythm', 'noteGroup', 'inlineNote'],
    replaceTabToken: ['tab'],
    replaceLyric: ['lyric']
  };
  if (binding.kind === 'letReference' || !expectedKinds[operation.kind]?.includes(binding.kind)) return failure('unsupportedTarget');
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
    return { ok: true, edits: planned.edits, resultingSource: planned.text, postcondition: 'no-new-errors' };
  }
  const replacement = operation.kind === 'replaceChord' ? operation.name : operation.text;
  if (!replacement || replacement.length > 256 || /[\r\n\0]/.test(replacement)) return failure('invalidValue');
  if (operation.kind === 'replaceChord' && !isValidChordName(replacement)) return failure('invalidValue');
  if (operation.kind === 'replaceLyric' && /[\s|_*]/u.test(replacement)) return failure('invalidValue');
  const edit = spanEdit(source, binding.line, binding.startCol, binding.endCol, replacement);
  if (!edit || edit.expected !== binding.expected) return failure('staleSource');
  return finish(source, score, [edit]);
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
