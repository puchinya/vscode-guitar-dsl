import { createHash } from 'crypto';
import * as vscode from 'vscode';
import { evaluatePreviewWebview, inspectWorkbenchLayout, resizeActiveEditorGroupToWidth, waitForPreviewDocument } from './screenshotCapture';
import { ensureWorkbenchTestHostWindowFocused, focusEditorGroup, recordFocusTrace } from './workbenchFocus';

type TabState = {
  key: string;
  group: vscode.ViewColumn;
  position: number;
  active: boolean;
  label: string;
  previewUri?: string;
};

export type WorkbenchSnapshot = {
  sidebarVisible: boolean;
  auxiliaryBarVisible: boolean;
  colorTheme: string;
  groupColumns: vscode.ViewColumn[];
  secondGroupWidth?: number;
  tabs: TabState[];
  visibleEditors: Array<{ uri: string; column: vscode.ViewColumn }>;
  activeGroup: vscode.ViewColumn;
  activeTabKey?: string;
  activeTextEditor?: { uri: string; column: vscode.ViewColumn };
  previewUri?: string;
  previewColumn?: vscode.ViewColumn;
  previewPracticeEnabled?: boolean;
};

type PreviewProbe = { currentDocumentUri?: string };
type WorkbenchLayout = {
  groups?: Array<{ width?: number }>;
  parts?: {
    sidebar?: { visible?: boolean };
    auxiliarybar?: { visible?: boolean };
  };
};

function getPreviewProbe(): PreviewProbe {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('../../previewCapo').previewLifecycleProbe as PreviewProbe;
}

async function readPreviewPracticeEnabled(): Promise<boolean> {
  const json = await evaluatePreviewWebview<string>(`JSON.stringify({
    pressed: document.getElementById('preview-mode-practice')?.getAttribute('aria-pressed'),
    enabled: document.body.classList.contains('has-practice-row')
  })`);
  const state = JSON.parse(json) as { pressed?: string | null; enabled?: boolean };
  if ((state.pressed !== 'true' && state.pressed !== 'false') || typeof state.enabled !== 'boolean') {
    throw new Error('Could not read the Preview Practice toggle state');
  }
  const pressed = state.pressed === 'true';
  if (state.enabled !== pressed) {
    throw new Error(`Preview Practice state is inconsistent: aria-pressed=${state.pressed}, row=${state.enabled}`);
  }
  return pressed;
}

async function restorePreviewPracticeState(expected: boolean): Promise<void> {
  await waitForPreviewDocument();
  if (await readPreviewPracticeEnabled() === expected) return;
  await vscode.commands.executeCommand('guitardsl.practice.toggle');
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await readPreviewPracticeEnabled() === expected) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error(`Preview Practice state did not restore to ${expected ? 'ON' : 'OFF'}`);
}

function tabInventory(tabs: TabState[]): string[] {
  return tabs.map(tab => `${tab.group}:${tab.position}:${tab.key}`);
}

function describeTab(tab: TabState): string {
  const identity = createHash('sha256').update(tab.key).digest('hex');
  return `column ${tab.group}, position ${tab.position}, identity sha256:${identity}`;
}

function describeTabInventory(tabs: TabState[]): string {
  return tabs.map(describeTab).join('; ');
}

function currentTabInventory(): TabState[] {
  const groups = [...vscode.window.tabGroups.all].sort((a, b) => a.viewColumn - b.viewColumn);
  return groups.flatMap(group => group.tabs.map((tab, position) => ({
    key: tabKey(tab, group),
    group: group.viewColumn,
    position,
    active: group.isActive && group.activeTab === tab,
    label: tab.label
  })));
}

function assertTabInventoryRestored(snapshot: WorkbenchSnapshot, actualTabs: TabState[]): void {
  const currentKeys = new Set(actualTabs.map(tab => tab.key));
  const missing = snapshot.tabs.filter(tab => !currentKeys.has(tab.key));
  if (missing.length > 0) {
    throw new Error(`P136 closed pre-existing tab(s): ${missing.map(describeTab).join('; ')}`);
  }
  const initialKeys = new Set(snapshot.tabs.map(tab => tab.key));
  const unexpected = actualTabs.filter(tab => !initialKeys.has(tab.key));
  if (unexpected.length > 0) {
    throw new Error(`P136 left unexpected tab(s) open: ${unexpected.map(describeTab).join('; ')}`);
  }
  const expected = tabInventory(snapshot.tabs);
  const actual = tabInventory(actualTabs);
  if (expected.length !== actual.length || expected.some((entry, index) => entry !== actual[index])) {
    throw new Error(`P136 changed pre-existing tab order or position: expected [${describeTabInventory(snapshot.tabs)}], actual [${describeTabInventory(actualTabs)}]`);
  }
}

function tabKey(tab: vscode.Tab, group: vscode.TabGroup): string {
  const input = tab.input;
  const prefix = `${group.viewColumn}:`;
  if (input instanceof vscode.TabInputText) return `${prefix}text:${input.uri.toString()}`;
  if (input instanceof vscode.TabInputTextDiff) return `${prefix}text-diff:${input.original.toString()}:${input.modified.toString()}`;
  if (input instanceof vscode.TabInputWebview) return `${prefix}webview:${input.viewType}:${tab.label}`;
  if (input instanceof vscode.TabInputCustom) return `${prefix}custom:${input.viewType}:${input.uri.toString()}`;
  if (input instanceof vscode.TabInputNotebook) return `${prefix}notebook:${input.notebookType}:${input.uri.toString()}`;
  if (input instanceof vscode.TabInputNotebookDiff) return `${prefix}notebook-diff:${input.original.toString()}:${input.modified.toString()}`;
  if (input instanceof vscode.TabInputTerminal) return `${prefix}terminal:${tab.label}`;
  return `${prefix}other:${tab.label}`;
}

function previewTab(group: vscode.TabGroup): vscode.Tab | undefined {
  return group.tabs.find(tab => tab.input instanceof vscode.TabInputWebview && tab.label.includes('GuitarDSL'));
}

function parseLayout(layout: string): WorkbenchLayout {
  return JSON.parse(layout) as WorkbenchLayout;
}

function widthsFromLayout(layout: string): number[] {
  const parsed = parseLayout(layout);
  if (!Array.isArray(parsed.groups) || parsed.groups.some(group => typeof group.width !== 'number')) {
    throw new Error('Could not snapshot editor group widths');
  }
  return parsed.groups.map(group => group.width!);
}

function visibilityFromLayout(layout: string): { sidebar: boolean; auxiliaryBar: boolean } {
  const parsed = parseLayout(layout);
  const sidebar = parsed.parts?.sidebar?.visible;
  const auxiliaryBar = parsed.parts?.auxiliarybar?.visible;
  if (typeof sidebar !== 'boolean' || typeof auxiliaryBar !== 'boolean') {
    throw new Error('Could not snapshot sidebar and auxiliary bar visibility');
  }
  return { sidebar, auxiliaryBar };
}

async function readWorkbenchVisibility(): Promise<{ sidebar: boolean; auxiliaryBar: boolean }> {
  return visibilityFromLayout(await inspectWorkbenchLayout());
}

export async function captureWorkbenchSnapshot(): Promise<WorkbenchSnapshot> {
  const groups = [...vscode.window.tabGroups.all].sort((a, b) => a.viewColumn - b.viewColumn);
  const layout = await inspectWorkbenchLayout();
  const layoutWidths = widthsFromLayout(layout);
  const visibility = visibilityFromLayout(layout);
  const tabs: TabState[] = [];
  let initialPreviewColumn: vscode.ViewColumn | undefined;
  let initialPreviewUri: string | undefined;
  for (const group of groups) {
    for (const [position, tab] of group.tabs.entries()) {
      const isActive = group.isActive && group.activeTab === tab;
      const isPreview = tab.input instanceof vscode.TabInputWebview && tab.label.includes('GuitarDSL');
      const previewUri = isPreview ? getPreviewProbe().currentDocumentUri : undefined;
      if (isPreview) {
        initialPreviewColumn = group.viewColumn;
        initialPreviewUri = previewUri;
        if (!previewUri) throw new Error('Could not snapshot the source document for the open GuitarDSL Preview');
      }
      tabs.push({
        key: tabKey(tab, group),
        group: group.viewColumn,
        position,
        active: isActive,
        label: tab.label,
        ...(isPreview ? { previewUri } : {})
      });
    }
  }
  let previewPracticeEnabled: boolean | undefined;
  if (initialPreviewUri) {
    await waitForPreviewDocument();
    previewPracticeEnabled = await readPreviewPracticeEnabled();
  }
  const activeEditor = vscode.window.activeTextEditor;
  const activeGroup = vscode.window.tabGroups.activeTabGroup;
  const activeTab = activeGroup.activeTab;
  const secondGroupIndex = groups.findIndex(group => group.viewColumn === vscode.ViewColumn.Two);
  return {
    sidebarVisible: visibility.sidebar,
    auxiliaryBarVisible: visibility.auxiliaryBar,
    colorTheme: vscode.workspace.getConfiguration('workbench').get<string>('colorTheme') ?? '',
    groupColumns: groups.map(group => group.viewColumn),
    secondGroupWidth: secondGroupIndex >= 0 ? layoutWidths[secondGroupIndex] : undefined,
    tabs,
    visibleEditors: vscode.window.visibleTextEditors.map(editor => ({
      uri: editor.document.uri.toString(),
      column: editor.viewColumn ?? activeGroup.viewColumn
    })),
    activeGroup: activeGroup.viewColumn,
    activeTabKey: activeTab ? tabKey(activeTab, activeGroup) : undefined,
    activeTextEditor: activeEditor ? {
      uri: activeEditor.document.uri.toString(),
      column: activeEditor.viewColumn ?? activeGroup.viewColumn
    } : undefined,
    previewUri: initialPreviewUri,
    previewColumn: initialPreviewColumn,
    previewPracticeEnabled
  };
}

async function closeAddedTabs(snapshot: WorkbenchSnapshot): Promise<void> {
  const initialTabs = new Set(snapshot.tabs.map(tab => tab.key));
  for (const group of [...vscode.window.tabGroups.all]) {
    const added = group.tabs.filter(tab => !initialTabs.has(tabKey(tab, group)));
    if (added.length > 0) {
      const closed = await vscode.window.tabGroups.close(added, true);
      if (!closed) throw new Error('Could not close tabs created during P136');
    }
  }
}

async function closeAddedEmptyGroups(snapshot: WorkbenchSnapshot): Promise<void> {
  const initialColumns = new Set(snapshot.groupColumns);
  for (const group of [...vscode.window.tabGroups.all]) {
    if (!initialColumns.has(group.viewColumn) && group.tabs.length === 0) {
      const closed = await vscode.window.tabGroups.close(group, true);
      if (!closed) throw new Error('Could not close an empty editor group created during P136');
    }
  }
}

async function restoreVisibility(snapshot: WorkbenchSnapshot): Promise<void> {
  let visibility = await readWorkbenchVisibility();
  if (visibility.sidebar !== snapshot.sidebarVisible) {
    await vscode.commands.executeCommand('workbench.action.toggleSidebarVisibility');
  }
  visibility = await readWorkbenchVisibility();
  if (visibility.auxiliaryBar !== snapshot.auxiliaryBarVisible) {
    await vscode.commands.executeCommand('workbench.action.toggleAuxiliaryBar');
  }
}

async function restoreColorTheme(snapshot: WorkbenchSnapshot): Promise<void> {
  const config = vscode.workspace.getConfiguration('workbench');
  if (config.get<string>('colorTheme') !== snapshot.colorTheme) {
    await config.update('colorTheme', snapshot.colorTheme, vscode.ConfigurationTarget.Global);
  }
}

async function restorePreview(snapshot: WorkbenchSnapshot): Promise<void> {
  if (!snapshot.previewUri) return;
  const probe = getPreviewProbe();
  if (probe.currentDocumentUri !== snapshot.previewUri) {
    await vscode.commands.executeCommand('guitardsl.showPreview', vscode.Uri.parse(snapshot.previewUri));
  }
}

async function restoreActiveEditor(snapshot: WorkbenchSnapshot): Promise<void> {
  recordFocusTrace('workbench-snapshot-active-editor-restore-started');
  await ensureWorkbenchTestHostWindowFocused();
  recordFocusTrace('workbench-snapshot-active-editor-restore-host-focused');
  if (snapshot.activeTextEditor) {
    const uri = vscode.Uri.parse(snapshot.activeTextEditor.uri);
    const document = vscode.workspace.textDocuments.find(item => item.uri.toString() === snapshot.activeTextEditor!.uri)
      ?? await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(document, {
      viewColumn: snapshot.activeTextEditor.column,
      preview: false,
      preserveFocus: false
    });
    await focusEditorGroup(snapshot.activeTextEditor.column);
    return;
  }
  if (snapshot.previewUri && snapshot.tabs.some(tab => tab.active && tab.previewUri === snapshot.previewUri)) {
    await restorePreview(snapshot);
    if (snapshot.previewColumn !== undefined) await focusEditorGroup(snapshot.previewColumn);
    return;
  }
  const activeGroup = vscode.window.tabGroups.all.find(group => group.viewColumn === snapshot.activeGroup);
  if (activeGroup) await focusEditorGroup(snapshot.activeGroup);
  const activeNow = vscode.window.tabGroups.activeTabGroup.activeTab;
  if ((activeNow ? tabKey(activeNow, vscode.window.tabGroups.activeTabGroup) : undefined) !== snapshot.activeTabKey) {
    throw new Error('Could not restore the initially active non-text workbench tab');
  }
}

async function restoreSecondGroupWidth(snapshot: WorkbenchSnapshot): Promise<void> {
  if (snapshot.secondGroupWidth === undefined || snapshot.secondGroupWidth < 320) return;
  const widths = widthsFromLayout(await inspectWorkbenchLayout());
  const groups = [...vscode.window.tabGroups.all].sort((a, b) => a.viewColumn - b.viewColumn);
  const secondGroupIndex = groups.findIndex(group => group.viewColumn === vscode.ViewColumn.Two);
  const currentWidth = secondGroupIndex < 0 ? undefined : widths[secondGroupIndex];
  if (currentWidth !== undefined && Math.abs(currentWidth - snapshot.secondGroupWidth) > 1) {
    await focusEditorGroup(vscode.ViewColumn.Two);
    await resizeActiveEditorGroupToWidth(snapshot.secondGroupWidth);
  }
}

async function currentSecondGroupWidth(): Promise<number | undefined> {
  const groups = [...vscode.window.tabGroups.all].sort((a, b) => a.viewColumn - b.viewColumn);
  const secondGroupIndex = groups.findIndex(group => group.viewColumn === vscode.ViewColumn.Two);
  if (secondGroupIndex < 0) return undefined;
  return widthsFromLayout(await inspectWorkbenchLayout())[secondGroupIndex];
}

export async function restoreWorkbenchSnapshot(snapshot: WorkbenchSnapshot): Promise<void> {
  await closeAddedTabs(snapshot);
  await closeAddedEmptyGroups(snapshot);
  await restoreVisibility(snapshot);
  await restoreColorTheme(snapshot);
  await restorePreview(snapshot);
  if (snapshot.previewPracticeEnabled !== undefined) {
    await restorePreviewPracticeState(snapshot.previewPracticeEnabled);
  }
  await restoreSecondGroupWidth(snapshot);
  await restoreActiveEditor(snapshot);

  const actualGroups = [...vscode.window.tabGroups.all].map(group => group.viewColumn).sort((a, b) => a - b);
  const expectedGroups = [...snapshot.groupColumns].sort((a, b) => a - b);
  if (actualGroups.length !== expectedGroups.length || actualGroups.some((column, index) => column !== expectedGroups[index])) {
    throw new Error('Editor group layout differs from its initial state after P136');
  }
  const visibility = await readWorkbenchVisibility();
  if (visibility.sidebar !== snapshot.sidebarVisible
    || visibility.auxiliaryBar !== snapshot.auxiliaryBarVisible) {
    throw new Error('Sidebar visibility differs from its initial state after P136');
  }
  if (vscode.workspace.getConfiguration('workbench').get<string>('colorTheme') !== snapshot.colorTheme) {
    throw new Error('Color theme differs from its initial state after P136');
  }
  if (snapshot.secondGroupWidth !== undefined) {
    const width = await currentSecondGroupWidth();
    if (width === undefined || Math.abs(width - snapshot.secondGroupWidth) > 1) {
      throw new Error('Second editor group width differs from its initial state after P136');
    }
  }
  if (snapshot.previewUri && getPreviewProbe().currentDocumentUri !== snapshot.previewUri) {
    throw new Error('GuitarDSL Preview source differs from its initial state after P136');
  }
  if (snapshot.previewPracticeEnabled !== undefined
    && await readPreviewPracticeEnabled() !== snapshot.previewPracticeEnabled) {
    throw new Error(`Preview Practice state differs from its initial state after P136 (expected ${snapshot.previewPracticeEnabled ? 'ON' : 'OFF'})`);
  }
  assertTabInventoryRestored(snapshot, currentTabInventory());
  const visible = vscode.window.visibleTextEditors.map(editor => `${editor.viewColumn}:${editor.document.uri.toString()}`).sort();
  const expectedVisible = snapshot.visibleEditors.map(editor => `${editor.column}:${editor.uri}`).sort();
  if (visible.length !== expectedVisible.length || visible.some((item, index) => item !== expectedVisible[index])) {
    throw new Error('Visible text editors differ from their initial state after P136');
  }
  const activeGroup = vscode.window.tabGroups.activeTabGroup;
  const activeTabKey = activeGroup.activeTab ? tabKey(activeGroup.activeTab, activeGroup) : undefined;
  const activeTextEditor = vscode.window.activeTextEditor;
  if (activeGroup.viewColumn !== snapshot.activeGroup
    || activeTabKey !== snapshot.activeTabKey
    || (activeTextEditor?.document.uri.toString() !== snapshot.activeTextEditor?.uri)
    || (activeTextEditor?.viewColumn !== snapshot.activeTextEditor?.column)) {
    throw new Error('Active editor state differs from its initial state after P136');
  }
}

export async function withWorkbenchSnapshotRestored<T>(operation: () => Promise<T>): Promise<T> {
  const snapshot = await captureWorkbenchSnapshot();
  let operationFailed = false;
  let operationError: unknown;
  try {
    return await operation();
  } catch (error) {
    operationFailed = true;
    operationError = error;
    throw error;
  } finally {
    try {
      await restoreWorkbenchSnapshot(snapshot);
    } catch (restoreError) {
      recordFocusTrace('workbench-state-restore-failed');
      if (operationFailed) {
        const operationMessage = operationError instanceof Error ? operationError.message : String(operationError);
        const restorationMessage = restoreError instanceof Error ? restoreError.message : String(restoreError);
        const combined = new Error(`P136 operation failed: ${operationMessage}; state restoration failed: ${restorationMessage}`);
        Object.assign(combined, { cause: operationError, restorationError: restoreError });
        throw combined;
      }
      throw restoreError;
    }
  }
}

export async function matchesWorkbenchSnapshot(snapshot: WorkbenchSnapshot): Promise<boolean> {
  const current = await captureWorkbenchSnapshot();
  return current.sidebarVisible === snapshot.sidebarVisible
    && current.auxiliaryBarVisible === snapshot.auxiliaryBarVisible
    && current.groupColumns.join(',') === snapshot.groupColumns.join(',')
    && current.activeGroup === snapshot.activeGroup
    && current.activeTabKey === snapshot.activeTabKey
    && current.activeTextEditor?.uri === snapshot.activeTextEditor?.uri
    && current.activeTextEditor?.column === snapshot.activeTextEditor?.column
    && current.visibleEditors.map(editor => `${editor.column}:${editor.uri}`).sort().join('|')
      === snapshot.visibleEditors.map(editor => `${editor.column}:${editor.uri}`).sort().join('|')
    && (current.secondGroupWidth === undefined && snapshot.secondGroupWidth === undefined
      || current.secondGroupWidth !== undefined && snapshot.secondGroupWidth !== undefined
        && Math.abs(current.secondGroupWidth - snapshot.secondGroupWidth) <= 1)
    && current.colorTheme === snapshot.colorTheme
    && current.previewUri === snapshot.previewUri
    && current.previewPracticeEnabled === snapshot.previewPracticeEnabled
    && tabInventory(current.tabs).join('\n') === tabInventory(snapshot.tabs).join('\n');
}
