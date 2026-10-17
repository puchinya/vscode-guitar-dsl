import * as vscode from 'vscode';

const MAX_FOCUS_TRACE_ENTRIES = 128;

type FocusRequest = {
  document: string;
  column: string;
};

type FocusTraceState = {
  testName: string;
  startedAt: number;
  entries: Array<Record<string, unknown>>;
  uriIds: Map<string, string>;
  nextUriId: number;
  request?: FocusRequest;
  disposables: vscode.Disposable[];
};

let currentTrace: FocusTraceState | undefined;

function columnName(column: vscode.ViewColumn | undefined): string | undefined {
  if (column === undefined) return undefined;
  const known = new Map<number, string>([
    [vscode.ViewColumn.Active, 'active'],
    [vscode.ViewColumn.Beside, 'beside'],
    [vscode.ViewColumn.One, 'one'],
    [vscode.ViewColumn.Two, 'two'],
    [vscode.ViewColumn.Three, 'three'],
    [vscode.ViewColumn.Four, 'four'],
    [vscode.ViewColumn.Five, 'five'],
    [vscode.ViewColumn.Six, 'six'],
    [vscode.ViewColumn.Seven, 'seven'],
    [vscode.ViewColumn.Eight, 'eight'],
    [vscode.ViewColumn.Nine, 'nine']
  ]);
  return known.get(column) ?? String(column);
}

function uriLabel(uri: vscode.Uri): string {
  const trace = currentTrace;
  if (!trace) return uri.scheme;
  const key = uri.toString();
  let label = trace.uriIds.get(key);
  if (!label) {
    label = `${uri.scheme}#${++trace.nextUriId}`;
    trace.uriIds.set(key, label);
  }
  return label;
}

function tabInputLabel(tab: vscode.Tab | undefined): string | undefined {
  if (!tab) return undefined;
  const input = tab.input;
  if (input instanceof vscode.TabInputText) return `text:${uriLabel(input.uri)}`;
  if (input instanceof vscode.TabInputTextDiff) return 'text-diff';
  if (input instanceof vscode.TabInputWebview) return `webview:${input.viewType}`;
  if (input instanceof vscode.TabInputCustom) return `custom:${input.viewType}`;
  if (input instanceof vscode.TabInputNotebook) return `notebook:${uriLabel(input.uri)}`;
  if (input instanceof vscode.TabInputNotebookDiff) return 'notebook-diff';
  if (input instanceof vscode.TabInputTerminal) return 'terminal';
  return 'other';
}

function snapshot(trigger: string): Record<string, unknown> {
  const trace = currentTrace;
  if (!trace) return {};
  const activeEditor = vscode.window.activeTextEditor;
  const activeGroup = vscode.window.tabGroups.activeTabGroup;
  const entry = {
    elapsedMs: Date.now() - trace.startedAt,
    trigger,
    request: trace.request,
    activeTextEditor: activeEditor ? {
      document: uriLabel(activeEditor.document.uri),
      column: columnName(activeEditor.viewColumn)
    } : undefined,
    activeTabGroup: {
      column: columnName(activeGroup.viewColumn),
      active: activeGroup.isActive,
      tab: tabInputLabel(activeGroup.activeTab)
    },
    groups: vscode.window.tabGroups.all.map(group => ({
      column: columnName(group.viewColumn),
      active: group.isActive,
      tab: tabInputLabel(group.activeTab)
    })),
    visibleEditors: vscode.window.visibleTextEditors.map(editor => ({
      document: uriLabel(editor.document.uri),
      column: columnName(editor.viewColumn)
    })),
    windowFocused: vscode.window.state.focused
  };
  trace.entries.push(entry);
  if (trace.entries.length > MAX_FOCUS_TRACE_ENTRIES) trace.entries.shift();
  return entry;
}

export function beginWorkbenchFocusTrace(testName: string): void {
  endWorkbenchFocusTrace();
  currentTrace = {
    testName,
    startedAt: Date.now(),
    entries: [],
    uriIds: new Map(),
    nextUriId: 0,
    disposables: []
  };
  currentTrace.disposables.push(
    vscode.window.onDidChangeActiveTextEditor(() => snapshot('active-text-editor-changed')),
    vscode.window.onDidChangeVisibleTextEditors(() => snapshot('visible-editors-changed')),
    vscode.window.onDidChangeWindowState(() => snapshot('window-state-changed')),
    vscode.window.tabGroups.onDidChangeTabGroups(() => snapshot('tab-groups-changed')),
    vscode.window.tabGroups.onDidChangeTabs(() => snapshot('tabs-changed'))
  );
  snapshot('test-start');
}

export function setFocusTraceTarget(doc: vscode.TextDocument, column: vscode.ViewColumn): void {
  if (!currentTrace) return;
  currentTrace.request = {
    document: uriLabel(doc.uri),
    column: columnName(column) ?? String(column)
  };
  snapshot('show-text-document-requested');
}

export function recordFocusTrace(trigger: string): void {
  snapshot(trigger);
}

export function getWorkbenchFocusTrace(): readonly Record<string, unknown>[] {
  return currentTrace?.entries.slice() ?? [];
}

function waitForFocusSignalOrTick(timeoutMs: number): Promise<void> {
  return new Promise(resolve => {
    let finished = false;
    const disposables: vscode.Disposable[] = [];
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      for (const disposable of disposables) disposable.dispose();
      resolve();
    };
    const timer = setTimeout(finish, timeoutMs);
    disposables.push(
      vscode.window.onDidChangeActiveTextEditor(finish),
      vscode.window.onDidChangeVisibleTextEditors(finish),
      vscode.window.onDidChangeWindowState(finish),
      vscode.window.tabGroups.onDidChangeTabGroups(finish),
      vscode.window.tabGroups.onDidChangeTabs(finish)
    );
  });
}

function matchesRequestedEditor(doc: vscode.TextDocument, column: vscode.ViewColumn): boolean {
  const activeEditor = vscode.window.activeTextEditor;
  const activeGroup = vscode.window.tabGroups.activeTabGroup;
  const activeTab = activeGroup.activeTab;
  return activeEditor?.document === doc
    && activeEditor.viewColumn === column
    && activeGroup.viewColumn === column
    && activeTab?.input instanceof vscode.TabInputText
    && activeTab.input.uri.toString() === doc.uri.toString()
    && vscode.window.visibleTextEditors.some(editor => editor.document === doc && editor.viewColumn === column);
}

export function isDocumentActiveInColumn(doc: vscode.TextDocument, column: vscode.ViewColumn): boolean {
  return matchesRequestedEditor(doc, column);
}

export async function focusEditorGroup(column: vscode.ViewColumn): Promise<void> {
  const columnIndex = Number(column);
  const groupExists = vscode.window.tabGroups.all.some(group => group.viewColumn === column);
  if (!Number.isInteger(columnIndex) || columnIndex < 1 || columnIndex > 9 || !groupExists) {
    recordFocusTrace('target-editor-group-unavailable');
    throw new Error(`Requested editor group column ${String(column)} is not available`);
  }
  const ordinals = ['First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth', 'Ninth'];
  await vscode.commands.executeCommand(`workbench.action.focus${ordinals[columnIndex - 1]}EditorGroup`);
  recordFocusTrace('target-editor-group-activated');
}

export async function showAndFocusDocument(
  doc: vscode.TextDocument,
  requestedColumn: vscode.ViewColumn = vscode.ViewColumn.One
): Promise<vscode.TextEditor> {
  const timeoutMs = 2000;
  const stableMs = 80;
  setFocusTraceTarget(doc, requestedColumn);
  const editor = await vscode.window.showTextDocument(doc, {
    viewColumn: requestedColumn,
    preview: false,
    preserveFocus: false
  });
  const column = requestedColumn;
  if (editor.viewColumn !== requestedColumn) recordFocusTrace('show-text-document-resolved-in-unrequested-column');
  recordFocusTrace('show-text-document-resolved');

  const startedAt = Date.now();
  const firstDeadline = startedAt + Math.floor(timeoutMs * 0.75);
  const finalDeadline = startedAt + timeoutMs;
  const waitForStableTarget = async (deadline: number): Promise<boolean> => {
    let stableSince: number | undefined;
    while (Date.now() < deadline) {
      const isTargetActive = matchesRequestedEditor(doc, column);
      recordFocusTrace(isTargetActive ? 'focus-condition-matched' : 'focus-condition-not-matched');
      if (isTargetActive) {
        stableSince ??= Date.now();
        if (Date.now() - stableSince >= stableMs) {
          recordFocusTrace('requested-editor-stable');
          return true;
        }
      } else {
        stableSince = undefined;
      }
      await waitForFocusSignalOrTick(Math.min(25, Math.max(1, deadline - Date.now())));
    }
    return false;
  };

  if (await waitForStableTarget(firstDeadline)) return vscode.window.activeTextEditor!;
  recordFocusTrace('focus-recovery-started');
  await focusEditorGroup(column);
  if (await waitForStableTarget(finalDeadline)) return vscode.window.activeTextEditor!;
  recordFocusTrace('focus-recovery-failed');
  throw new Error(`Target document did not become the stable active tab in column ${columnName(column) ?? String(column)} within ${timeoutMs}ms`);
}

export function endWorkbenchFocusTrace(failedTest?: string): void {
  const trace = currentTrace;
  if (!trace) return;
  if (failedTest) {
    snapshot('test-failed-final-state');
    console.error(`[E2E focus trace] ${JSON.stringify({ test: failedTest, events: trace.entries })}`);
  }
  for (const disposable of trace.disposables) disposable.dispose();
  currentTrace = undefined;
}
