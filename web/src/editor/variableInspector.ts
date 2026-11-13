import type { LetDefinitionSummary, ParsedScore } from '@guitardsl/core/compiler';
import { planLetOperation } from '@guitardsl/core/visualEditing/planners';
import type { LetOperation } from '@guitardsl/core/visualEditing/model';
import { getMessages, type SupportedLocale } from '@guitardsl/core/i18n';
import { renderVariableEditorBody } from '@guitardsl/ui/variableEditor';

export interface VariablesEditorOptions {
  root: HTMLElement;
  source: string;
  score: ParsedScore;
  locale: SupportedLocale;
  selectedName?: string;
  onSelect(name: string): void;
  /** Reject an application if the active source or document identity changed. */
  onApply(nextSource: string, expectedSource: string): boolean;
  onJump(line: number, startCol: number, endCol: number): void;
}

function locations(definition: LetDefinitionSummary): Array<{ line: number; startCol: number; endCol: number; kind: string }> {
  const seen = new Set<string>();
  const result: Array<{ line: number; startCol: number; endCol: number; kind: string }> = [];
  for (const reference of [...definition.directReferences, ...definition.usageLocations]) {
    const key = `${reference.line}:${reference.startCol}:${reference.endCol}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(reference);
  }
  return result;
}

/** Existing VS Code variable controls, wired to the one shared source-preserving planner. */
export function renderVariablesEditor(options: VariablesEditorOptions): void {
  const m = getMessages(options.locale);
  const root = options.root;
  root.innerHTML = renderVariableEditorBody({
    title: m.inspectorVariablesTitle, description: m.inspectorVariablesDescription,
    name: m.inspectorVariableName, value: m.inspectorVariableValue,
    reference: m.inspectorVariableReference, usage: m.inspectorVariableUsage,
    choose: m.inspectorVariableChoose, add: m.inspectorVariableAdd,
    editGlobal: m.inspectorVariableEditGlobal, rename: m.inspectorVariableRename,
    clone: m.inspectorVariableClone, deleteUnused: m.inspectorVariableDelete,
    detachLocal: m.inspectorVariableDetach, jump: m.inspectorVariableJump,
    apply: m.inspectorVariableApply, cancel: m.inspectorVariableCancel
  });
  const query = <T extends HTMLElement>(selector: string): T => root.querySelector<T>(selector)!;
  const list = query<HTMLUListElement>('#variables-list');
  const usages = query<HTMLUListElement>('#variables-usages');
  const meta = query<HTMLElement>('#variables-meta');
  const nameInput = query<HTMLInputElement>('#variables-name');
  const valueInput = query<HTMLTextAreaElement>('#variables-value');
  const referenceInput = query<HTMLSelectElement>('#variables-reference');
  const operationInput = query<HTMLSelectElement>('#variables-operation');
  const errorNode = query<HTMLElement>('#variables-error');
  const applyButton = query<HTMLButtonElement>('#variables-apply');
  const jumpButton = query<HTMLButtonElement>('#variables-jump');

  const definitions = options.score.letDefinitions ?? [];
  const selected = definitions.find(item => item.name === options.selectedName) ?? definitions[0];
  const references = selected ? locations(selected) : [];

  for (const def of definitions) {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = `${def.valid ? '' : '⚠ '}${def.name}`;
    button.setAttribute('aria-pressed', String(selected === def));
    button.addEventListener('click', () => options.onSelect(def.name));
    item.append(button);
    list.append(item);
  }

  if (selected) {
    nameInput.value = selected.name;
    valueInput.value = selected.value;
    meta.textContent = `${selected.allowedContexts.join(', ')} · ${selected.usageLocations.length} ${m.inspectorVariableUsage}`;
    references.forEach((reference, index) => {
      const option = document.createElement('option');
      option.value = String(index);
      option.textContent = `L${reference.line + 1}:${reference.startCol + 1} · ${reference.kind}`;
      referenceInput.append(option);
      const listItem = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = option.textContent;
      button.addEventListener('click', () => options.onJump(reference.line, reference.startCol, reference.endCol));
      listItem.append(button);
      usages.append(listItem);
    });
  } else {
    meta.textContent = options.locale === 'ja' ? '変数定義はありません。' : 'No variable definitions.';
    operationInput.value = 'add';
  }

  const selectedReference = () => references[Number(referenceInput.value)];
  function resetForm(): void {
    nameInput.value = selected?.name ?? '';
    valueInput.value = selected?.value ?? '';
    operationInput.value = selected ? 'editGlobal' : 'add';
    errorNode.hidden = true;
    syncForm();
  }
  function syncForm(): void {
    const kind = operationInput.value;
    const hasDefinition = Boolean(selected?.valid) && !selected?.duplicate;
    const canOperate = kind === 'add' || hasDefinition;
    applyButton.disabled = !canOperate
      || kind === 'detachLocal' && !selectedReference()
      || kind === 'chooseReference';
    jumpButton.disabled = !selected;
    nameInput.disabled = !['add', 'rename', 'clone'].includes(kind);
    valueInput.disabled = !['add', 'editGlobal', 'detachLocal'].includes(kind);
    referenceInput.disabled = kind !== 'detachLocal' && kind !== 'chooseReference';
  }
  operationInput.addEventListener('change', () => {
    errorNode.hidden = true;
    if (operationInput.value === 'add') { nameInput.value = ''; valueInput.value = ''; }
    else if (operationInput.value === 'rename' || operationInput.value === 'clone') nameInput.value = selected?.name ?? '';
    else { nameInput.value = selected?.name ?? ''; valueInput.value = selected?.value ?? ''; }
    syncForm();
  });
  referenceInput.addEventListener('change', syncForm);
  jumpButton.addEventListener('click', () => {
    const ref = selectedReference();
    if (ref) options.onJump(ref.line, ref.startCol, ref.endCol);
    else if (selected) options.onJump(selected.line, selected.nameStartCol, selected.nameEndCol);
  });
  query<HTMLButtonElement>('#variables-cancel').addEventListener('click', resetForm);
  applyButton.addEventListener('click', () => {
    if (applyButton.disabled) return;
    const kind = operationInput.value;
    let operation: LetOperation;
    if (kind === 'add') operation = { kind: 'add', name: nameInput.value, value: valueInput.value };
    else if (!selected) return;
    else if (kind === 'editGlobal') operation = { kind: 'editGlobal', name: selected.name, value: valueInput.value };
    else if (kind === 'rename') operation = { kind: 'rename', name: selected.name, newName: nameInput.value };
    else if (kind === 'clone') operation = { kind: 'clone', name: selected.name, newName: nameInput.value };
    else if (kind === 'deleteUnused') operation = { kind: 'deleteUnused', name: selected.name };
    else if (kind === 'detachLocal') {
      const ref = selectedReference();
      if (!ref) return;
      operation = { kind: 'detachLocal', name: selected.name, line: ref.line,
        startCol: ref.startCol, endCol: ref.endCol, value: valueInput.value };
    } else return;

    const result = planLetOperation(options.source, options.score, operation);
    if (!result.ok) {
      errorNode.textContent = `${m.inspectorVariableError}: ${result.code}`;
      errorNode.hidden = false;
      return;
    }
    if (!options.onApply(result.resultingSource, options.source)) {
      errorNode.textContent = options.locale === 'ja'
        ? '編集中に文書が変更されました。再度開いてください。'
        : 'Source changed while editing. Reopen the variable editor.';
      errorNode.hidden = false;
    }
  });
  syncForm();
}
