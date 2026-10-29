import { randomBytes } from 'node:crypto';
import * as path from 'path';
import * as vscode from 'vscode';
import { buildProgressionAuditionPlaybackData, compileGuitarDslToHtml, isPreviewFocusControl, isPreviewLayoutFocusControl, type PreviewFocusControl } from './render/previewHtml';
import { PageSize, PageOrientation, isPageSize, isPageOrientation } from './render/layout';
import { GuitarDslDocumentSymbolProvider } from './symbols';
import { resolveLocale, getMessages, formatDiagnostic, SupportedLocale, getChordEditorMessages } from './i18n';
import { ChordDefinitionCodeLensProvider, ChordEditorPanel, EDIT_CHORD_COMMAND, isValidChordKey, pickChordKey } from './chordEditor';
import { parseGuitarDsl } from './compiler';
import { planLetOperation } from './visualEditing/planners';
import { applyAfterStopAcknowledgement, VisualEditingHostController, waitForStopAcknowledgement,
  type VisualEditingSessionIdentity } from './visualEditing/hostController';
import type { LetOperation, VisualEditOperation } from './visualEditing/model';
import { planVisualEdit } from './visualEditing/planners';
import { StrummingCodeLensProvider, StrummingCodeLensTarget, promptAndApplyStrummingPattern, APPLY_STRUMMING_PATTERN_COMMAND } from './strummingCodeLens';
import { OPEN_HELP_COMMAND, openGuitarDslHelp } from './help';
import { NEW_FROM_TEMPLATE_COMMAND, OPEN_SAMPLE_COMMAND, newDocumentFromTemplate, openSample } from './onboarding';
import { registerGuitarDslSidebar } from './sidebar';
import { registerGuitarDslSidebarNavigation } from './sidebarNavigation';
import { registerGuitarDslInspector } from './inspector/inspectorController';
import { PreviewCapoController, effectiveDslProbe, previewLifecycleProbe, setPreviewCapoController } from './previewCapo';
import { PreviewBeginnerController, resolvePreviewEffectiveDsl, setPreviewBeginnerController } from './previewBeginner';
import { EDIT_CAPO_COMMAND, EDIT_SCORE_SETTINGS_COMMAND, applyBeginnerTransform, applyCapoTransform } from './scoreSettingsEditor';
import { dispatchPreviewLegacyMessage, isCurrentPreviewMessageIdentity, parsePreviewOpenSettingsIntent, parsePreviewTemporarySettingsIntent } from './previewLegacyCommands';
import { ScoreSettingsInspectorController } from './scoreSettingsInspectorController';
import { isGuitarDslDocument, resolveGuitarDslDocument } from './documentResolver';
import { registerGuitarDslAiTools } from './ai/tools';
import { registerGp78Commands } from './gp78Commands';
import { computeCodeActionDiagnostics, registerMusicCodeActions } from './codeActionProvider';
import { registerProgressionCompletions } from './progressionCompletionProvider';
import { registerProgressionAssistant, type ProgressionAssistantController, type ProgressionAssistantRenderOptions, type ProgressionAssistantSessionIdentity } from './progressionAssistant';
import { planProgressionEdit } from './progressionSourceEdits';
import { ProgressionAudioLeaseCoordinator } from './progressionAudioLease';

export const GEMINI_API_KEY_SECRET = 'guitardsl.geminiApiKey';
export const progressionAudioLeaseProbe: { coordinator?: ProgressionAudioLeaseCoordinator } = {};

export interface ExportPdfOptions {
  /** Effective DSL to render instead of `doc.getText()` (Preview Beginner Mode / capo override, spec extension §4.4, §4.5). */
  dslContentOverride?: string;
  /** Output file; when given, the save dialog is skipped. */
  targetUri?: vscode.Uri;
}

function parseLetOperation(value: unknown): LetOperation | undefined {
  if (typeof value !== 'object' || value === null || !('kind' in value)) return undefined;
  const operation = value as Record<string, unknown>;
  const name = operation.name;
  if (typeof name !== 'string' || name.length === 0) return undefined;
  switch (operation.kind) {
    case 'add':
      return typeof operation.value === 'string' ? { kind: 'add', name, value: operation.value } : undefined;
    case 'editGlobal':
      return typeof operation.value === 'string' ? { kind: 'editGlobal', name, value: operation.value } : undefined;
    case 'rename':
      return typeof operation.newName === 'string' ? { kind: 'rename', name, newName: operation.newName } : undefined;
    case 'clone':
      return typeof operation.newName === 'string' ? { kind: 'clone', name, newName: operation.newName } : undefined;
    case 'deleteUnused':
      return { kind: 'deleteUnused', name };
    case 'detachLocal':
      return Number.isSafeInteger(operation.line) && Number.isSafeInteger(operation.startCol)
        && Number.isSafeInteger(operation.endCol) && (operation.value === undefined || typeof operation.value === 'string')
        ? { kind: 'detachLocal', name, line: operation.line as number, startCol: operation.startCol as number,
          endCol: operation.endCol as number, ...(typeof operation.value === 'string' ? { value: operation.value } : {}) }
        : undefined;
    default:
      return undefined;
  }
}

export async function exportScoreToPdf(
  doc: vscode.TextDocument,
  extensionRoot: string,
  pageSize: PageSize = 'A4',
  orientation: PageOrientation = 'portrait',
  locale?: string,
  options?: ExportPdfOptions
): Promise<void> {
  const currentLocale = resolveLocale(locale ?? vscode.env.language);
  const msgs = getMessages(currentLocale);

  const defaultFileName = doc.fileName.replace(/\.(guitardsl|gdsl)$/i, '') + '.pdf';
  const targetUri = options?.targetUri ?? await vscode.window.showSaveDialog({
    defaultUri: vscode.Uri.file(defaultFileName),
    filters: {
      'PDF Documents': ['pdf']
    },
    title: msgs.dialogSavePdfTitle
  });

  if (!targetUri) {
    return;
  }

  try {
    const { getBundledFontFiles, writeScorePdf } = await import('./pdf');
    const config = vscode.workspace.getConfiguration('guitardsl');
    const expandPageBreakRepeats = config.get<boolean>('expandPageBreakRepeats', true);
    const dslContent = options?.dslContentOverride ?? doc.getText();
    effectiveDslProbe.pdfInput = dslContent;
    await writeScorePdf(targetUri.fsPath, dslContent, pageSize, orientation, getBundledFontFiles(extensionRoot), {
      expandPageBreakRepeats
    });

    void vscode.window.showInformationMessage(
      msgs.msgPdfSaved(path.basename(targetUri.fsPath)),
      msgs.msgOpenFile
    ).then(action => {
      if (action === msgs.msgOpenFile) {
        vscode.env.openExternal(targetUri);
      }
    });
  } catch (err: any) {
    vscode.window.showErrorMessage(msgs.msgPdfFailed(err.message || err));
  }
}

/** Converts compiler diagnostics of a GuitarDSL document into VS Code diagnostics (spec extension.md §5A). */
export function computeDocumentDiagnostics(doc: vscode.TextDocument, locale: SupportedLocale): vscode.Diagnostic[] {
  return parseGuitarDsl(doc.getText()).diagnostics.map(d => {
    const lineLength = d.line < doc.lineCount ? doc.lineAt(d.line).text.length : 0;
    const range = new vscode.Range(d.line, Math.min(d.startCol, lineLength), d.line, Math.min(d.endCol, lineLength));
    const diagnostic = new vscode.Diagnostic(
      range,
      formatDiagnostic(d.code, d.args, locale),
      d.severity === 'error' ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning
    );
    diagnostic.source = 'guitardsl';
    diagnostic.code = d.code;
    return diagnostic;
  });
}

export function activate(context: vscode.ExtensionContext) {
  let currentPanel: vscode.WebviewPanel | undefined = undefined;
  let lastActiveGuitarDslDoc: vscode.TextDocument | undefined = undefined;
  let progressionAssistantController: ProgressionAssistantController | undefined;
  let settingsController: ScoreSettingsInspectorController | undefined;
  let progressionRenderGeneration = 0;
  const currentLocale = resolveLocale(vscode.env.language);
  const msgs = getMessages(currentLocale);
  const inspector = registerGuitarDslInspector(context, currentLocale);
  const visualEditingHost = new VisualEditingHostController();
  let variableSelectionName: string | undefined;
  type PreviewUiMode = 'normal' | 'edit' | 'practice';
  type PreviewModeIdentity = { documentUri: string; documentVersion: number; previewGeneration: number };
  let previewUiMode: PreviewUiMode = 'normal';
  let previewUiModeUri: string | undefined;
  let variableDraftRevision = 0;
  let variableDraftState = { name: '', value: '', operation: 'add', reference: '' };
  let variableDraftSessionGeneration = 0;
  const pendingPreviewEditStops = new Map<string, {
    identity: { documentUri: string; documentVersion: number; previewGeneration: number };
    resolve: (stopped: boolean) => void;
  }>();
  const pendingPreviewModeDraftChecks = new Map<string, {
    identity: PreviewModeIdentity;
    resolve: (hasDraft: boolean | undefined) => void;
  }>();
  const previewUiModeForUri = (uri: string): PreviewUiMode => previewUiModeUri === uri ? previewUiMode : 'normal';
  context.subscriptions.push({ dispose: () => visualEditingHost.dispose() });
  const audioLeaseCoordinator = new ProgressionAudioLeaseCoordinator({
    hasPreview: () => !!currentPanel,
    lockPreview: async leaseId => currentPanel ? await currentPanel.webview.postMessage({ command: 'progressionAudioLock', leaseId }) : false,
    unlockPreview: leaseId => { void currentPanel?.webview.postMessage({ command: 'progressionAudioUnlock', leaseId }); },
    startInspector: message => inspector.postProgressionAudioMessage(message),
    stopInspector: (leaseId, requestId) => inspector.postProgressionAudioMessage({
      command: 'progressionAudioStop', leaseId, requestId
    }),
    reportStartError: (requestId, message) => {
      void inspector.postProgressionAudioMessage({ command: 'progressionAudioError', requestId, message });
    }
  }, 2500, () => randomBytes(16).toString('hex'));
  progressionAudioLeaseProbe.coordinator = audioLeaseCoordinator;
  inspector.setProgressionAudioAcknowledgementHandler(message => audioLeaseCoordinator.acknowledge(message));
  context.subscriptions.push({ dispose: () => {
    audioLeaseCoordinator.dispose();
    if (progressionAudioLeaseProbe.coordinator === audioLeaseCoordinator) progressionAudioLeaseProbe.coordinator = undefined;
  } });
  const setVariablesContext = async (document: vscode.TextDocument, explicit: boolean, error?: string,
    referenceChoice?: { name: string; line: number; startCol: number; endCol: number }): Promise<void> => {
    const uri = document.uri.toString();
    let identity = visualEditingHost.current('variables');
    const sameDocument = identity?.uri === uri;
    if (!identity || identity.uri !== uri || identity.documentVersion !== document.version) {
      visualEditingHost.cancel('variables');
      identity = visualEditingHost.begin('variables', uri, document.version, 0);
      if (!sameDocument) variableSelectionName = undefined;
      variableDraftRevision = 0;
      variableDraftState = { name: '', value: '', operation: 'add', reference: '' };
      variableDraftSessionGeneration = identity?.sessionGeneration ?? 0;
    }
    if (!identity) return;
    if (explicit) {
      variableDraftRevision = 0;
      variableDraftState = referenceChoice
        ? { name: referenceChoice.name, value: '', operation: 'chooseReference',
          reference: [referenceChoice.line, referenceChoice.startCol, referenceChoice.endCol].join(':') }
        : { name: '', value: '', operation: 'add', reference: '' };
      variableDraftSessionGeneration = identity.sessionGeneration;
    }
    if (referenceChoice) variableSelectionName = referenceChoice.name;
    const score = parseGuitarDsl(document.getText());
    const selectedName = score.letDefinitions?.some(definition => definition.name === variableSelectionName)
      ? variableSelectionName : undefined;
    const variablesContext = {
      kind: 'variables' as const,
      uri,
      version: document.version,
      sessionGeneration: identity.sessionGeneration,
      revision: identity.revision,
      draftRevision: variableDraftRevision,
      definitions: score.letDefinitions ?? [],
      ...(selectedName ? { selectedName } : {}),
      ...(referenceChoice ? {
        requiresReferenceChoice: true,
        referenceSelection: [referenceChoice.line, referenceChoice.startCol, referenceChoice.endCol].join(':')
      } : {}),
      ...(error ? { error } : {})
    };
    if (explicit) await inspector.showVariables(variablesContext, true);
    else if (inspector.currentContext.kind === 'variables') inspector.updateVariables(variablesContext);
    else await inspector.showVariables(variablesContext);
  };
  const stopAudioForEdit = async (uri: string): Promise<boolean> => {
    if (!await audioLeaseCoordinator.stopForSession(uri)) return false;
    if (!currentPanel || previewLifecycleProbe.currentDocumentUri !== uri) return true;
    const activeDocument = lastActiveGuitarDslDoc;
    if (!activeDocument || activeDocument.uri.toString() !== uri) return false;
    const identity = {
      documentUri: uri,
      documentVersion: activeDocument.version,
      previewGeneration: previewLifecycleProbe.generation
    };
    const requestId = randomBytes(12).toString('hex');
    let resolveStop: (stopped: boolean) => void = () => {};
    const acknowledgement = new Promise<boolean>(resolve => { resolveStop = resolve; });
    pendingPreviewEditStops.set(requestId, { identity, resolve: resolveStop });
    let posted = false;
    try { posted = await currentPanel.webview.postMessage({ command: 'previewEditStopRequest', requestId, ...identity }); }
    catch { posted = false; }
    if (!posted) {
      pendingPreviewEditStops.delete(requestId);
      return false;
    }
    const stopped = await waitForStopAcknowledgement(acknowledgement, 2000);
    pendingPreviewEditStops.delete(requestId);
    return stopped;
  };
  inspector.setVariablesMessageHandler(async message => {
    const identity = visualEditingHost.current('variables');
    if (!identity || identity.uri !== message.sessionUri || identity.documentVersion !== message.sessionVersion
      || identity.sessionGeneration !== message.sessionGeneration || identity.revision !== message.revision) return;
    const document = vscode.workspace.textDocuments.find(item => item.uri.toString() === identity.uri);
    if (!document || document.version !== identity.documentVersion) return;
    if (message.command === 'variablesCancel') {
      visualEditingHost.cancel('variables');
      variableSelectionName = undefined;
      variableDraftRevision = 0;
      variableDraftState = { name: '', value: '', operation: 'add', reference: '' };
      inspector.showDocument(document.uri.toString(), document.version);
      return;
    }
    if (message.command === 'variablesJump') {
      const name = typeof message.name === 'string' ? message.name : undefined;
      const score = parseGuitarDsl(document.getText());
      const definition = score.letDefinitions?.find(item => item.name === name);
      if (!definition) return;
      let line = definition.line;
      let startCol = definition.nameStartCol;
      let endCol = definition.nameEndCol;
      if (message.line !== undefined || message.startCol !== undefined || message.endCol !== undefined) {
        if (!Number.isSafeInteger(message.line) || !Number.isSafeInteger(message.startCol) || !Number.isSafeInteger(message.endCol)) return;
        const reference = definition.usageLocations.find(item => item.line === message.line
          && item.startCol === message.startCol && item.endCol === message.endCol);
        if (!reference) return;
        line = reference.line;
        startCol = reference.startCol;
        endCol = reference.endCol;
      }
      const editor = await vscode.window.showTextDocument(document, { preserveFocus: true });
      const start = new vscode.Position(line, startCol);
      const end = new vscode.Position(line, endCol);
      editor.selection = new vscode.Selection(start, end);
      editor.revealRange(new vscode.Range(start, end), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
      return;
    }
    if (message.command === 'variablesSelect') {
      const name = typeof message.name === 'string' ? message.name : undefined;
      const selected = parseGuitarDsl(document.getText()).letDefinitions?.find(item => item.name === name);
      if (!selected) return;
      variableSelectionName = name;
      variableDraftRevision = 0;
      variableDraftState = { name: selected.name, value: selected.value, operation: 'editGlobal', reference: '' };
      variableDraftSessionGeneration = identity.sessionGeneration;
      const next = visualEditingHost.advanceRevision(identity);
      if (next) setVariablesContext(document, false);
      return;
    }
    if (message.command === 'variablesDraft') {
      if (message.sessionGeneration !== variableDraftSessionGeneration
        || !Number.isSafeInteger(message.draftRevision) || message.draftRevision !== variableDraftRevision + 1
        || typeof message.draft !== 'object' || message.draft === null) return;
      const draft = message.draft as Record<string, unknown>;
      const allowedOperations = ['add', 'editGlobal', 'rename', 'clone', 'deleteUnused', 'detachLocal', 'chooseReference'];
      if (typeof draft.name !== 'string' || draft.name.length > 64
        || typeof draft.value !== 'string' || draft.value.length > 2048
        || typeof draft.reference !== 'string' || draft.reference.length > 64
        || typeof draft.operation !== 'string' || !allowedOperations.includes(draft.operation)) return;
      variableDraftRevision = message.draftRevision as number;
      variableDraftState = { name: draft.name, value: draft.value, operation: draft.operation, reference: draft.reference };
      return;
    }
    if (message.command !== 'variablesApply' || message.draftRevision !== variableDraftRevision) return;
    const submittedDraftRevision = variableDraftRevision;
    const submittedDraftState = variableDraftState;
    const selectedName = variableSelectionName;
    let operation: LetOperation | undefined;
    switch (submittedDraftState.operation) {
      case 'add': operation = { kind: 'add', name: submittedDraftState.name, value: submittedDraftState.value }; break;
      case 'editGlobal': operation = selectedName ? { kind: 'editGlobal', name: selectedName, value: submittedDraftState.value } : undefined; break;
      case 'rename': operation = selectedName ? { kind: 'rename', name: selectedName, newName: submittedDraftState.name } : undefined; break;
      case 'clone': operation = selectedName ? { kind: 'clone', name: selectedName, newName: submittedDraftState.name } : undefined; break;
      case 'deleteUnused': operation = selectedName ? { kind: 'deleteUnused', name: selectedName } : undefined; break;
      case 'detachLocal': {
        const reference = submittedDraftState.reference.split(':').map(Number);
        operation = selectedName && reference.length === 3 && reference.every(Number.isSafeInteger)
          ? { kind: 'detachLocal', name: selectedName, line: reference[0], startCol: reference[1], endCol: reference[2], value: submittedDraftState.value }
          : undefined;
        break;
      }
      default: operation = undefined;
    }
    if (!operation) return;
    const isSubmittedDraftCurrent = () => {
      const current = visualEditingHost.current('variables');
      return variableDraftRevision === submittedDraftRevision && variableDraftState === submittedDraftState
        && variableSelectionName === selectedName && !!current
        && current.uri === identity.uri && current.documentVersion === identity.documentVersion
        && current.sessionGeneration === identity.sessionGeneration && current.revision === identity.revision;
    };
    const guarded = await applyAfterStopAcknowledgement(() => stopAudioForEdit(identity.uri), isSubmittedDraftCurrent,
      () => visualEditingHost.applyOnce(identity, () => {
        const current = vscode.workspace.textDocuments.find(item => item.uri.toString() === identity.uri);
        return current ? { uri: current.uri.toString(), documentVersion: current.version, renderGeneration: 0 } : undefined;
      }, async () => {
        if (!isSubmittedDraftCurrent()) return false;
        const current = vscode.workspace.textDocuments.find(item => item.uri.toString() === identity.uri);
        if (!current || current.version !== identity.documentVersion) return false;
        const source = current.getText();
        const score = parseGuitarDsl(source);
        const plan = planLetOperation(source, score, operation!);
        if (!plan.ok || !isSubmittedDraftCurrent()) return false;
        const edit = new vscode.WorkspaceEdit();
        for (const item of plan.edits) {
          edit.replace(current.uri, new vscode.Range(current.positionAt(item.start), current.positionAt(item.end)), item.text);
        }
        return vscode.workspace.applyEdit(edit);
      }));
    if (!guarded.ok) {
      const next = visualEditingHost.advanceRevision(identity);
      if (next) setVariablesContext(document, false, msgs.inspectorVariableError);
      return;
    }
    const result = guarded.value;
    if (!result.ok || !result.value) {
      const next = visualEditingHost.advanceRevision(identity);
      if (next) setVariablesContext(document, false, msgs.inspectorVariableError);
      return;
    }
    const updated = vscode.workspace.textDocuments.find(item => item.uri.toString() === identity.uri);
    if (updated) setVariablesContext(updated, false);
  });
  const refreshInspectorContext = (document?: vscode.TextDocument) => {
    settingsController?.invalidateIfDifferent(isGuitarDslDocument(document) ? document.uri.toString() : undefined);
    if (isGuitarDslDocument(document)) {
      if (inspector.currentContext.kind === 'variables' && inspector.currentContext.uri === document.uri.toString()) {
        if (inspector.currentContext.version !== document.version) setVariablesContext(document, false);
      } else inspector.showDocument(document.uri.toString(), document.version);
    } else if (inspector.currentContext.kind === 'document') {
      inspector.invalidate(inspector.currentContext.uri);
    } else if (inspector.currentContext.kind === 'variables') {
      const previewOwnsCurrentDocument = currentPanel?.active === true
        && previewLifecycleProbe.currentDocumentUri === inspector.currentContext.uri;
      if (!previewOwnsCurrentDocument) {
        visualEditingHost.cancel('variables');
        inspector.invalidate(inspector.currentContext.uri);
      }
    }
  };
  refreshInspectorContext(vscode.window.activeTextEditor?.document);
  vscode.window.onDidChangeActiveTextEditor(editor => refreshInspectorContext(editor?.document), null, context.subscriptions);
  vscode.workspace.onDidChangeTextDocument(event => {
    const changedUri = event.document.uri.toString();
    settingsController?.invalidate(changedUri);
    const inspectorTracksChangedDocument = inspector.currentContext.kind === 'variables'
      && inspector.currentContext.uri === changedUri;
    if (inspectorTracksChangedDocument
      || vscode.window.activeTextEditor?.document.uri.toString() === changedUri) {
      refreshInspectorContext(event.document);
    }
  }, null, context.subscriptions);
  vscode.workspace.onDidCloseTextDocument(document => {
    settingsController?.invalidate(document.uri.toString());
    visualEditingHost.invalidateUri(document.uri.toString());
    inspector.invalidate(document.uri.toString());
  }, null, context.subscriptions);
  context.subscriptions.push(vscode.commands.registerCommand('guitardsl.showVariables', () => {
    const document = vscode.window.activeTextEditor?.document;
    if (!isGuitarDslDocument(document)) {
      vscode.window.showWarningMessage(msgs.msgOpenGuitarDslFile);
      return;
    }
    variableSelectionName = undefined;
    setVariablesContext(document, true);
  }));
  registerGp78Commands(context, { locale: currentLocale, getLastActiveDocument: () => lastActiveGuitarDslDoc });

  const diagnosticCollection = vscode.languages.createDiagnosticCollection('guitardsl');
  context.subscriptions.push(diagnosticCollection);
  registerMusicCodeActions(context, currentLocale);
  registerProgressionCompletions(context, currentLocale);
  const refreshDiagnostics = (doc: vscode.TextDocument) => {
    if (isGuitarDslDocument(doc)) {
      diagnosticCollection.set(doc.uri, [
        ...computeDocumentDiagnostics(doc, currentLocale),
        ...computeCodeActionDiagnostics(doc, currentLocale)
      ]);
    }
  };
  vscode.workspace.textDocuments.forEach(refreshDiagnostics);
  vscode.workspace.onDidOpenTextDocument(refreshDiagnostics, null, context.subscriptions);
  vscode.workspace.onDidChangeTextDocument(e => refreshDiagnostics(e.document), null, context.subscriptions);
  vscode.workspace.onDidCloseTextDocument(doc => diagnosticCollection.delete(doc.uri), null, context.subscriptions);

  const fontsRoot = vscode.Uri.joinPath(context.extensionUri, 'media', 'fonts');
  // One-shot focus target for a Preview control that initiated a valid host render.
  let previewPageSize: PageSize = 'A4';
  let previewOrientation: PageOrientation = 'portrait';
  let pendingPreviewFocusRestore: { uri: string; version: number; control: PreviewFocusControl } | undefined;
  let pendingPreviewEditRestore: {
    uri: string;
    sourceVersion: number;
    previewGeneration: number;
    visualElementId: string;
    scrollTop: number;
    focusControlId?: string;
  } | undefined;
  // Transient Preview capo override; its effective DSL feeds both the Preview and PDF export.
  const previewCapo = new PreviewCapoController(() => msgs);
  setPreviewCapoController(previewCapo);
  context.subscriptions.push({ dispose: () => setPreviewCapoController(undefined) });
  // Transient Preview Beginner Mode; while active it takes precedence over the capo override.
  const previewBeginner = new PreviewBeginnerController(() => msgs, previewCapo);
  setPreviewBeginnerController(previewBeginner);
  context.subscriptions.push({ dispose: () => setPreviewBeginnerController(undefined) });
  settingsController = new ScoreSettingsInspectorController(
    inspector,
    previewCapo,
    previewBeginner,
    currentLocale,
    uri => !!currentPanel && previewLifecycleProbe.currentDocumentUri === uri
  );
  context.subscriptions.push(settingsController);
  const effectiveText = (doc: vscode.TextDocument) => resolvePreviewEffectiveDsl(doc, previewBeginner, previewCapo).text;

  const updateWebview = (doc: vscode.TextDocument) => {
    if (currentPanel && isGuitarDslDocument(doc)) {
      previewCapo.switchDocument(doc);
      previewBeginner.switchDocument(doc);
      lastActiveGuitarDslDoc = doc;
      const webview = currentPanel.webview;
      const config = vscode.workspace.getConfiguration('guitardsl');
      const expandPageBreakRepeats = config.get<boolean>('expandPageBreakRepeats', true);
      const effective = resolvePreviewEffectiveDsl(doc, previewBeginner, previewCapo);
      const previewEditAvailable = effective.text === doc.getText();
      const documentPreviewUiMode = previewUiModeForUri(doc.uri.toString());
      const previewEditMode = documentPreviewUiMode === 'edit';
      const visualBindings = previewEditAvailable
        ? (parseGuitarDsl(doc.getText(), { expandPageBreakRepeats }).visualSourceBindings ?? [])
        : [];
      const editRestoreCandidate = pendingPreviewEditRestore;
      const editRestore = editRestoreCandidate
        && editRestoreCandidate.uri === doc.uri.toString()
        && doc.version > editRestoreCandidate.sourceVersion
        && previewLifecycleProbe.currentDocumentUri === editRestoreCandidate.uri
        && previewLifecycleProbe.generation === editRestoreCandidate.previewGeneration
        && visualBindings.some(binding => binding.id === editRestoreCandidate.visualElementId)
        ? editRestoreCandidate : undefined;
      if (editRestoreCandidate) pendingPreviewEditRestore = undefined;
      effectiveDslProbe.previewInput = effective.text;
      const focusRestore = pendingPreviewFocusRestore
        && pendingPreviewFocusRestore.uri === doc.uri.toString()
        && pendingPreviewFocusRestore.version === doc.version
        ? pendingPreviewFocusRestore
        : undefined;
      pendingPreviewFocusRestore = undefined;
      const htmlContent = compileGuitarDslToHtml(effective.text, {
        locale: currentLocale,
        cspSource: webview.cspSource,
        nonce: randomBytes(16).toString('base64'),
        pageSize: previewPageSize,
        orientation: previewOrientation,
        documentUri: doc.uri.toString(),
        documentVersion: doc.version,
        previewGeneration: previewLifecycleProbe.generation + 1,
        previewEditMode,
        previewUiMode: documentPreviewUiMode,
        previewEditAvailable,
        visualBindings,
        ...(editRestore ? {
          restoreScoreScrollTop: editRestore.scrollTop,
          restoreVisualElementId: editRestore.visualElementId,
          ...(editRestore.focusControlId ? { restoreVisualEditFocusId: editRestore.focusControlId } : {})
        } : {}),
        ...(focusRestore ? { restoreFocusControl: focusRestore.control } : {}),
        expandPageBreakRepeats,
        capo: effective.capo,
        beginner: effective.beginner,
        ...(audioLeaseCoordinator.activeLeaseId ? { progressionAudioLeaseId: audioLeaseCoordinator.activeLeaseId } : {}),
        fontUris: {
          regular: webview.asWebviewUri(vscode.Uri.joinPath(fontsRoot, 'NotoSansJP-Regular.ttf')).toString(),
          bold: webview.asWebviewUri(vscode.Uri.joinPath(fontsRoot, 'NotoSansJP-Bold.ttf')).toString()
        }
      });
      webview.html = htmlContent;
      previewLifecycleProbe.generation++;
      previewLifecycleProbe.currentDocumentUri = doc.uri.toString();
      if (previewEditMode && previewEditAvailable) {
        visualEditingHost.begin('preview', doc.uri.toString(), doc.version, previewLifecycleProbe.generation);
      } else visualEditingHost.cancel('preview');
    }
  };

  let previewModeTransition: { mode: PreviewUiMode; identity: PreviewModeIdentity; promise: Promise<boolean> } | undefined;
  const currentPreviewModeIdentity = (document: vscode.TextDocument): PreviewModeIdentity | undefined => {
    const uri = document.uri.toString();
    if (!currentPanel || lastActiveGuitarDslDoc?.uri.toString() !== uri
      || previewLifecycleProbe.currentDocumentUri !== uri) return undefined;
    return { documentUri: uri, documentVersion: document.version, previewGeneration: previewLifecycleProbe.generation };
  };
  const previewModeIdentityIsCurrent = (identity: PreviewModeIdentity, document: vscode.TextDocument): boolean => {
    const current = currentPreviewModeIdentity(document);
    return !!current && current.documentUri === identity.documentUri
      && current.documentVersion === identity.documentVersion && current.previewGeneration === identity.previewGeneration;
  };
  const askToDiscardInspectorDraft = async (): Promise<boolean> => {
    const choice = await vscode.window.showWarningMessage(
      msgs.inspectorDiscardDraftPrompt,
      { modal: true },
      msgs.inspectorDiscardDraft,
      msgs.inspectorKeepDraft
    );
    return choice === msgs.inspectorDiscardDraft;
  };
  const askToDiscardPreviewEditDraft = async (): Promise<boolean> => {
    const choice = await vscode.window.showWarningMessage(
      msgs.previewEditDiscardDraftPrompt,
      { modal: true },
      msgs.previewEditDiscardDraft,
      msgs.previewEditKeepDraft
    );
    return choice === msgs.previewEditDiscardDraft;
  };
  const readPreviewEditDraft = async (identity: PreviewModeIdentity): Promise<boolean | undefined> => {
    if (!currentPanel) return undefined;
    const requestId = randomBytes(12).toString('hex');
    let resolveDraft: (hasDraft: boolean | undefined) => void = () => {};
    const result = new Promise<boolean | undefined>(resolve => { resolveDraft = resolve; });
    const timeout = setTimeout(() => {
      pendingPreviewModeDraftChecks.delete(requestId);
      resolveDraft(undefined);
    }, 2000);
    pendingPreviewModeDraftChecks.set(requestId, { identity, resolve: resolveDraft });
    let posted = false;
    try {
      posted = await currentPanel.webview.postMessage({ command: 'previewModeDraftCheck', requestId, ...identity });
    } catch { posted = false; }
    if (!posted) {
      clearTimeout(timeout);
      pendingPreviewModeDraftChecks.delete(requestId);
      return undefined;
    }
    const hasDraft = await result;
    clearTimeout(timeout);
    return hasDraft;
  };
  const postPreviewModeResult = (mode: PreviewUiMode, success: boolean, reason: string | undefined, identity: PreviewModeIdentity): void => {
    void currentPanel?.webview.postMessage({ command: 'previewUiModeResult', mode, success, ...(reason ? { reason } : {}), ...identity });
  };
  const performPreviewModeTransition = async (mode: PreviewUiMode, identity: PreviewModeIdentity,
    focusControl?: PreviewFocusControl): Promise<boolean> => {
    const document = lastActiveGuitarDslDoc;
    if (!document || !previewModeIdentityIsCurrent(identity, document)) return false;
    const uri = identity.documentUri;
    const previousMode = previewUiModeForUri(uri);
    if (previousMode === mode) return true;
    if (mode === 'edit') {
      const effective = resolvePreviewEffectiveDsl(document, previewBeginner, previewCapo);
      if (effective.text !== document.getText()) {
        postPreviewModeResult(previousMode, false, 'temporaryTransform', identity);
        vscode.window.showWarningMessage(msgs.uiPreviewEditDisabled);
        return false;
      }
    }

    if (previousMode === 'edit') {
      const hasPreviewDraft = await readPreviewEditDraft(identity);
      if (hasPreviewDraft === undefined) {
        postPreviewModeResult(previousMode, false, 'staleContext', identity);
        return false;
      }
      if (hasPreviewDraft && !await askToDiscardPreviewEditDraft()) {
        postPreviewModeResult(previousMode, false, 'cancelled', identity);
        return false;
      }
    }

    const previousContext = inspector.currentContext;
    const previousInspectorGeneration = inspector.currentGeneration;
    const previousIntentGeneration = inspector.currentExplicitIntentGeneration;
    const previousVariableDraftRevision = variableDraftRevision;
    const hasInspectorDraft = mode === 'edit' && (previousContext.kind === 'variables'
      ? variableDraftRevision > 0
      : previousContext.kind === 'settings'
        ? settingsController?.hasPendingDraft(previousContext.uri, previousContext.version) === true
        : false);
    if (hasInspectorDraft && !await askToDiscardInspectorDraft()) {
      postPreviewModeResult(previousMode, false, 'cancelled', identity);
      return false;
    }
    if (!previewModeIdentityIsCurrent(identity, document)
      || inspector.currentContext !== previousContext
      || inspector.currentGeneration !== previousInspectorGeneration
      || inspector.currentExplicitIntentGeneration !== previousIntentGeneration
      || variableDraftRevision !== previousVariableDraftRevision) return false;

    if (previousMode === 'practice' || mode === 'edit' || audioLeaseCoordinator.activeLeaseId) {
      if (!await stopAudioForEdit(uri)) {
        postPreviewModeResult(previousMode, false, 'stopFailed', identity);
        vscode.window.showWarningMessage(msgs.inspectorProgressionStopFailed);
        return false;
      }
    }
    if (!previewModeIdentityIsCurrent(identity, document)
      || inspector.currentContext !== previousContext
      || inspector.currentGeneration !== previousInspectorGeneration
      || inspector.currentExplicitIntentGeneration !== previousIntentGeneration
      || variableDraftRevision !== previousVariableDraftRevision) return false;

    if (hasInspectorDraft && previousContext.kind === 'settings') {
      if (!settingsController?.cancelForTabSwitch(previousContext.uri, previousContext.version)) return false;
    } else if (hasInspectorDraft && previousContext.kind === 'variables') {
      await inspector.handleWebviewMessage({
        command: 'variablesCancel',
        generation: previousInspectorGeneration,
        sessionUri: previousContext.uri,
        sessionVersion: previousContext.version,
        sessionGeneration: previousContext.sessionGeneration,
        revision: previousContext.revision
      });
    }
    const currentDocument = lastActiveGuitarDslDoc;
    if (!currentDocument || currentDocument.uri.toString() !== uri || currentDocument.version !== identity.documentVersion
      || !currentPanel || previewLifecycleProbe.currentDocumentUri !== uri) return false;
    previewUiMode = mode;
    previewUiModeUri = uri;
    if (previousMode === 'edit' && mode !== 'edit') {
      pendingPreviewEditRestore = undefined;
      visualEditingHost.cancel('preview');
    }
    pendingPreviewFocusRestore = focusControl
      ? { uri, version: currentDocument.version, control: focusControl }
      : undefined;
    updateWebview(currentDocument);
    if (mode === 'edit') {
      variableSelectionName = undefined;
      await setVariablesContext(currentDocument, true);
    }
    return true;
  };
  const transitionPreviewUiMode = (mode: PreviewUiMode, requestedIdentity?: PreviewModeIdentity,
    focusControl?: PreviewFocusControl): Promise<boolean> => {
    const document = lastActiveGuitarDslDoc;
    if (!document || !currentPanel) return Promise.resolve(false);
    const identity = requestedIdentity ?? currentPreviewModeIdentity(document);
    if (!identity || !previewModeIdentityIsCurrent(identity, document)) return Promise.resolve(false);
    if (previewModeTransition) {
      const pending = previewModeTransition;
      const sameIdentity = pending.identity.documentUri === identity.documentUri
        && pending.identity.documentVersion === identity.documentVersion
        && pending.identity.previewGeneration === identity.previewGeneration;
      if (!sameIdentity) return Promise.resolve(false);
      if (pending.mode === mode) return pending.promise;
      const continueLatestModeRequest = () => {
        const currentDocument = lastActiveGuitarDslDoc;
        if (!currentDocument || !previewModeIdentityIsCurrent(identity, currentDocument)) return false;
        return transitionPreviewUiMode(mode, identity, focusControl);
      };
      return pending.promise.then(continueLatestModeRequest, continueLatestModeRequest);
    }
    const promise = Promise.resolve().then(() => performPreviewModeTransition(mode, identity, focusControl));
    const pending = { mode, identity, promise };
    previewModeTransition = pending;
    void promise.then(
      () => { if (previewModeTransition === pending) previewModeTransition = undefined; },
      () => { if (previewModeTransition === pending) previewModeTransition = undefined; }
    );
    return promise;
  };

  inspector.setTopTabHandler(async (request, initialContext) => {
    const currentKind = initialContext.kind === 'empty' ? 'document' : initialContext.kind;
    if (request.tab === currentKind) return;
    const document = vscode.workspace.textDocuments.find(item => item.uri.toString() === request.documentUri);
    if (!document || document.version !== request.documentVersion) return;
    const hasProgressionSession = () => {
      const identity = progressionAssistantController?.getActiveSessionIdentity();
      return identity?.uri === request.documentUri && identity.version === request.documentVersion;
    };
    if (request.tab === 'progression' && !hasProgressionSession()) return;
    const intentGeneration = inspector.beginExplicitIntent();
    const inspectorGeneration = request.generation;
    const variableDraftAtStart = variableDraftRevision;
    const isCurrentIntent = () => inspector.currentContext === initialContext
      && inspector.currentGeneration === inspectorGeneration
      && inspector.currentExplicitIntentGeneration === intentGeneration
      && document.version === request.documentVersion
      && vscode.workspace.textDocuments.some(item => item === document);
    const hasDraft = initialContext.kind === 'variables'
      ? variableDraftRevision > 0
      : initialContext.kind === 'settings'
        ? settingsController?.hasPendingDraft(initialContext.uri, initialContext.version) === true
        : false;
    if (hasDraft && !await askToDiscardInspectorDraft()) return;
    if (!isCurrentIntent() || variableDraftRevision !== variableDraftAtStart) return;
    if (initialContext.kind === 'progression' && audioLeaseCoordinator.activeLeaseId) {
      const stopped = await audioLeaseCoordinator.stop();
      if (!stopped || audioLeaseCoordinator.activeLeaseId) {
        vscode.window.showWarningMessage(msgs.inspectorProgressionStopFailed);
        return;
      }
    }
    if (!isCurrentIntent() || variableDraftRevision !== variableDraftAtStart) return;
    if (request.tab === 'progression' && !hasProgressionSession()) return;

    if (initialContext.kind === 'settings') {
      if (!settingsController?.cancelForTabSwitch(initialContext.uri, initialContext.version)) return;
    } else if (initialContext.kind === 'variables') {
      await inspector.handleWebviewMessage({
        command: 'variablesCancel',
        generation: inspectorGeneration,
        sessionUri: initialContext.uri,
        sessionVersion: initialContext.version,
        sessionGeneration: initialContext.sessionGeneration,
        revision: initialContext.revision
      });
    }

    if (document.version !== request.documentVersion) return;
    if (request.tab === 'document') {
      inspector.showDocument(document.uri.toString(), document.version, true);
    } else if (request.tab === 'variables') {
      variableSelectionName = undefined;
      setVariablesContext(document, true);
    } else if (request.tab === 'settings') {
      await settingsController?.open(document, 'capo');
    } else if (request.tab === 'progression') {
      const shown = await progressionAssistantController?.revealActiveSession(document.uri.toString(), document.version);
      if (!shown) return;
    }
  });

  const previewDisposable = vscode.commands.registerCommand('guitardsl.showPreview', async (
    uri?: vscode.Uri,
    progressionSessionIdentity?: ProgressionAssistantSessionIdentity,
    resolutionOptions?: { explicitUriOnly?: boolean }
  ) => {
    const sessionIdentityAtInvocation = progressionSessionIdentity ?? progressionAssistantController?.getActiveSessionIdentity();
    const sameSessionIdentity = (left: ProgressionAssistantSessionIdentity | undefined, right: ProgressionAssistantSessionIdentity | undefined) =>
      left === undefined && right === undefined || !!left && !!right && left.uri === right.uri
        && left.version === right.version && left.sessionGeneration === right.sessionGeneration;
    const isCurrentProgressionSession = () => progressionSessionIdentity
      ? progressionAssistantController?.isCurrentSessionIdentity(progressionSessionIdentity) === true
      : sameSessionIdentity(progressionAssistantController?.getActiveSessionIdentity(), sessionIdentityAtInvocation);
    const doc = await resolveGuitarDslDocument(uri, lastActiveGuitarDslDoc, resolutionOptions);
    if (!isCurrentProgressionSession()) return;
    if (!doc) {
      vscode.window.showWarningMessage(msgs.msgOpenGuitarDslFile);
      return;
    }
    if (progressionSessionIdentity && (doc.uri.toString() !== progressionSessionIdentity.uri
      || doc.version !== progressionSessionIdentity.version)) return;
    if (!progressionSessionIdentity) progressionAssistantController?.invalidateIfDifferent(doc.uri.toString());

    if (previewUiModeUri && previewUiModeUri !== doc.uri.toString()) {
      previewUiMode = 'normal';
      previewUiModeUri = undefined;
      visualEditingHost.cancel('preview');
    }
    lastActiveGuitarDslDoc = doc;

    if (currentPanel) {
      currentPanel.reveal(vscode.ViewColumn.Beside);
    } else {
      previewLifecycleProbe.lastPlaybackAction = undefined;
      const previewColumn = previewLifecycleProbe.nextPanelViewColumnForTests ?? vscode.ViewColumn.Beside;
      previewLifecycleProbe.nextPanelViewColumnForTests = undefined;
      currentPanel = vscode.window.createWebviewPanel(
        'guitardslPreview',
        msgs.previewTitle,
        previewColumn,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [fontsRoot]
        }
      );

      currentPanel.webview.onDidReceiveMessage(
        async (message) => {
          if (message.command === 'previewEditStopAcknowledged' && typeof message.requestId === 'string'
            && typeof message.stopped === 'boolean') {
            const pending = pendingPreviewEditStops.get(message.requestId);
            if (pending && message.documentUri === pending.identity.documentUri
              && message.documentVersion === pending.identity.documentVersion
              && message.previewGeneration === pending.identity.previewGeneration
              && previewLifecycleProbe.currentDocumentUri === pending.identity.documentUri
              && previewLifecycleProbe.generation === pending.identity.previewGeneration) {
              const testInterception = previewLifecycleProbe.nextStopAcknowledgementForTests;
              previewLifecycleProbe.nextStopAcknowledgementForTests = undefined;
              if (testInterception) {
                try { pending.resolve(await testInterception(message.stopped)); }
                catch { pending.resolve(false); }
              } else pending.resolve(message.stopped);
            }
            return;
          }
          if (message.command === 'previewModeDraftCheckAcknowledged' && typeof message.requestId === 'string'
            && typeof message.hasDraft === 'boolean' && typeof message.documentUri === 'string'
            && typeof message.documentVersion === 'number' && Number.isSafeInteger(message.documentVersion)
            && typeof message.previewGeneration === 'number' && Number.isSafeInteger(message.previewGeneration)) {
            const pending = pendingPreviewModeDraftChecks.get(message.requestId);
            if (pending && pending.identity.documentUri === message.documentUri
              && pending.identity.documentVersion === message.documentVersion
              && pending.identity.previewGeneration === message.previewGeneration
              && previewLifecycleProbe.currentDocumentUri === message.documentUri
              && previewLifecycleProbe.generation === message.previewGeneration) {
              pendingPreviewModeDraftChecks.delete(message.requestId);
              pending.resolve(message.hasDraft);
            }
            return;
          }
          if (message.command === 'previewUiModeRequest'
            && (message.mode === 'normal' || message.mode === 'edit' || message.mode === 'practice')
            && typeof message.documentUri === 'string' && typeof message.documentVersion === 'number'
            && Number.isSafeInteger(message.documentVersion) && typeof message.previewGeneration === 'number'
            && Number.isSafeInteger(message.previewGeneration)) {
            await transitionPreviewUiMode(message.mode, {
              documentUri: message.documentUri,
              documentVersion: message.documentVersion,
              previewGeneration: message.previewGeneration
            }, isPreviewFocusControl(message.focusedControlId) ? message.focusedControlId : undefined);
            return;
          }
          if (message.command === 'previewEditReference') {
            const activeDocument = lastActiveGuitarDslDoc;
            const identity = visualEditingHost.current('preview');
            if (!activeDocument || previewUiModeForUri(activeDocument.uri.toString()) !== 'edit' || typeof message.visualElementId !== 'string'
              || message.documentUri !== activeDocument.uri.toString() || message.documentVersion !== activeDocument.version
              || message.previewGeneration !== previewLifecycleProbe.generation
              || previewLifecycleProbe.currentDocumentUri !== message.documentUri || !identity
              || identity.uri !== message.documentUri || identity.documentVersion !== message.documentVersion
              || identity.renderGeneration !== message.previewGeneration) return;
            const score = parseGuitarDsl(activeDocument.getText());
            const binding = score.visualSourceBindings?.find(item => item.id === message.visualElementId);
            if (!binding || binding.kind !== 'letReference' || !binding.expected.startsWith('$')) return;
            const definition = score.letDefinitions?.find(item => item.name === binding.expected.slice(1));
            const reference = definition?.directReferences.find(item => item.kind === 'score'
              && item.line === binding.line && item.startCol === binding.startCol && item.endCol === binding.endCol);
            if (!definition?.valid || !reference) return;
            setVariablesContext(activeDocument, true, undefined, reference);
            return;
          }
          if (message.command === 'previewOpenVisualSource') {
            const activeDocument = lastActiveGuitarDslDoc;
            const identity = visualEditingHost.current('preview');
            if (!activeDocument || previewUiModeForUri(activeDocument.uri.toString()) !== 'edit' || typeof message.visualElementId !== 'string'
              || message.documentUri !== activeDocument.uri.toString() || message.documentVersion !== activeDocument.version
              || message.previewGeneration !== previewLifecycleProbe.generation
              || previewLifecycleProbe.currentDocumentUri !== message.documentUri || !identity
              || identity.uri !== message.documentUri || identity.documentVersion !== message.documentVersion
              || identity.renderGeneration !== message.previewGeneration) return;
            const binding = parseGuitarDsl(activeDocument.getText()).visualSourceBindings
              ?.find(item => item.id === message.visualElementId);
            if (!binding) return;
            const selection = new vscode.Range(binding.line, binding.startCol, binding.line, binding.endCol);
            const editor = await vscode.window.showTextDocument(activeDocument, { preview: true });
            editor.selection = new vscode.Selection(selection.start, selection.end);
            editor.revealRange(selection, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
            return;
          }
          if (message.command === 'previewVisualEdit') {
            const activeDocument = lastActiveGuitarDslDoc;
            const payload = typeof message.payload === 'object' && message.payload !== null
              ? message.payload as Record<string, unknown> : undefined;
            const identity = visualEditingHost.current('preview');
            if (!activeDocument || previewUiModeForUri(activeDocument.uri.toString()) !== 'edit'
              || typeof message.documentUri !== 'string' || typeof message.visualElementId !== 'string'
              || message.visualElementId.length > 256 || !payload || message.documentUri !== activeDocument.uri.toString()
              || message.documentVersion !== activeDocument.version || message.previewGeneration !== previewLifecycleProbe.generation
              || previewLifecycleProbe.currentDocumentUri !== message.documentUri || !identity
              || identity.uri !== message.documentUri || identity.documentVersion !== message.documentVersion
              || identity.renderGeneration !== message.previewGeneration) return;
            const sourceBinding = parseGuitarDsl(activeDocument.getText()).visualSourceBindings
              ?.find(binding => binding.id === message.visualElementId);
            if (!sourceBinding) return;
            let visualOperation: VisualEditOperation | undefined;
            const text = typeof payload.text === 'string' && payload.text.length <= 256 && !/[\r\n\0]/.test(payload.text)
              ? payload.text : undefined;
            if (sourceBinding.kind === 'chord' && message.operation === 'replaceChord'
              && typeof payload.name === 'string' && payload.name.length <= 64 && !/[\r\n\0]/.test(payload.name)) {
              visualOperation = { kind: 'replaceChord', bindingId: sourceBinding.id, name: payload.name };
            } else if (message.operation === 'insertToken' && text !== undefined) {
              visualOperation = { kind: 'insertToken', bindingId: sourceBinding.id, text };
            } else if (message.operation === 'deleteToken') {
              visualOperation = { kind: 'deleteToken', bindingId: sourceBinding.id };
            } else if (['melodyNote', 'melodyGroup', 'melodyRest', 'noteGroup', 'inlineNote'].includes(sourceBinding.kind)
              && message.operation === 'replaceMelodyToken' && text !== undefined) {
              visualOperation = { kind: 'replaceMelodyToken', bindingId: sourceBinding.id, text };
            } else if (sourceBinding.kind === 'melodyNote' && message.operation === 'transposeMelody'
              && Number.isSafeInteger(payload.semitones) && payload.semitones !== 0 && Math.abs(payload.semitones as number) <= 11) {
              visualOperation = { kind: 'transposeMelody', bindingId: sourceBinding.id, semitones: payload.semitones as number };
            } else if (['melodyNote', 'melodyGroup', 'melodyRest', 'rhythm', 'noteGroup', 'inlineNote'].includes(sourceBinding.kind)
              && message.operation === 'changeDuration' && (payload.direction === 'longer' || payload.direction === 'shorter')) {
              visualOperation = { kind: 'changeDuration', bindingId: sourceBinding.id, direction: payload.direction };
            } else if (['rhythm', 'noteGroup', 'inlineNote'].includes(sourceBinding.kind)
              && message.operation === 'replaceRhythmToken' && text !== undefined) {
              visualOperation = { kind: 'replaceRhythmToken', bindingId: sourceBinding.id, text };
            } else if (sourceBinding.kind === 'tab' && message.operation === 'replaceTabToken' && text !== undefined) {
              visualOperation = { kind: 'replaceTabToken', bindingId: sourceBinding.id, text };
            } else if (sourceBinding.kind === 'tab' && message.operation === 'addTabChordNote'
              && typeof payload.note === 'string' && payload.note.length <= 64 && !/[\r\n\0]/.test(payload.note)) {
              visualOperation = { kind: 'addTabChordNote', bindingId: sourceBinding.id, note: payload.note };
            } else if (sourceBinding.kind === 'tab' && message.operation === 'deleteTabChordNote'
              && typeof payload.note === 'string' && payload.note.length <= 64 && !/[\r\n\0]/.test(payload.note)) {
              visualOperation = { kind: 'deleteTabChordNote', bindingId: sourceBinding.id, note: payload.note };
            } else if (sourceBinding.kind === 'lyric' && message.operation === 'replaceLyric' && text !== undefined) {
              visualOperation = { kind: 'replaceLyric', bindingId: sourceBinding.id, text };
            }
            if (!visualOperation) return;
            if (!await stopAudioForEdit(identity.uri)) {
              await currentPanel?.webview.postMessage({ command: 'previewVisualEditResult', success: false,
                reason: 'stopFailed', documentUri: identity.uri, documentVersion: identity.documentVersion, previewGeneration: identity.renderGeneration });
              return;
            }
            if (typeof message.scoreScrollTop === 'number' && Number.isFinite(message.scoreScrollTop)
              && message.scoreScrollTop >= 0 && message.scoreScrollTop <= 1_000_000
              && message.selectedVisualElementId === sourceBinding.id) {
              const focusControlId = typeof message.focusedVisualEditControlId === 'string'
                && ['preview-edit-target', 'preview-edit-value', 'preview-edit-apply', 'preview-edit-insert',
                  'preview-edit-delete', 'preview-edit-add-tab-note', 'preview-edit-delete-tab-note',
                  'preview-edit-pitch-down', 'preview-edit-pitch-up', 'preview-edit-duration-longer',
                  'preview-edit-duration-shorter', 'preview-edit-open-source'].includes(message.focusedVisualEditControlId)
                ? message.focusedVisualEditControlId : undefined;
              pendingPreviewEditRestore = {
                uri: identity.uri,
                sourceVersion: identity.documentVersion,
                previewGeneration: identity.renderGeneration,
                visualElementId: sourceBinding.id,
                scrollTop: message.scoreScrollTop,
                ...(focusControlId ? { focusControlId } : {})
              };
            }
            let failureReason = 'staleSource';
            const applied = await visualEditingHost.applyOnce(identity, () => {
              const current = lastActiveGuitarDslDoc;
              if (!current || !currentPanel || current.uri.toString() !== identity.uri
                || previewLifecycleProbe.currentDocumentUri !== identity.uri) return undefined;
              return { uri: identity.uri, documentVersion: current.version, renderGeneration: previewLifecycleProbe.generation };
            }, async () => {
              const current = lastActiveGuitarDslDoc;
              if (!current || current.version !== identity.documentVersion) return false;
              const currentSource = current.getText();
              const parsed = parseGuitarDsl(currentSource);
              const plan = planVisualEdit(currentSource, parsed, visualOperation!);
              if (!plan.ok) {
                failureReason = plan.code;
                return false;
              }
              const edit = new vscode.WorkspaceEdit();
              for (const item of plan.edits) {
                edit.replace(current.uri, new vscode.Range(current.positionAt(item.start), current.positionAt(item.end)), item.text);
              }
              return vscode.workspace.applyEdit(edit);
            });
            if (!applied.ok || !applied.value) {
              pendingPreviewEditRestore = undefined;
              await currentPanel?.webview.postMessage({ command: 'previewVisualEditResult', success: false,
                reason: failureReason,
                documentUri: identity.uri, documentVersion: identity.documentVersion, previewGeneration: identity.renderGeneration });
            } else {
              const updatedDocument = vscode.workspace.textDocuments.find(item => item.uri.toString() === identity.uri);
              if (pendingPreviewEditRestore?.uri === identity.uri && pendingPreviewEditRestore.sourceVersion === identity.documentVersion
                && updatedDocument?.version === identity.documentVersion) pendingPreviewEditRestore = undefined;
              await currentPanel?.webview.postMessage({ command: 'previewVisualEditResult', success: true,
                documentUri: identity.uri, documentVersion: identity.documentVersion, previewGeneration: identity.renderGeneration });
            }
            return;
          }
          if (message.command === 'progressionAudioPreviewStopped' && typeof message.leaseId === 'string') {
            audioLeaseCoordinator.acknowledgePreviewStopped(message.leaseId);
            return;
          }
          if (message.command === 'temporarySettingsChanged' || message.command === 'openScoreSettingsFromPreview') {
            const activeDoc = lastActiveGuitarDslDoc;
            if (!activeDoc) return;
            const expectedIdentity = {
              documentUri: activeDoc.uri.toString(),
              documentVersion: activeDoc.version,
              previewGeneration: previewLifecycleProbe.generation
            };
            if (previewLifecycleProbe.currentDocumentUri !== expectedIdentity.documentUri) return;

            const openSettingsIntent = parsePreviewOpenSettingsIntent(message);
            if (openSettingsIntent) {
              if (isCurrentPreviewMessageIdentity(openSettingsIntent, expectedIdentity)) {
                pendingPreviewFocusRestore = undefined;
                await vscode.commands.executeCommand(EDIT_SCORE_SETTINGS_COMMAND, activeDoc.uri, openSettingsIntent.section);
              }
              return;
            }

            const intent = parsePreviewTemporarySettingsIntent(message);
            if (!intent || !isCurrentPreviewMessageIdentity(intent, expectedIdentity)) return;
            const effective = resolvePreviewEffectiveDsl(activeDoc, previewBeginner, previewCapo);
            let legacyIntent: Record<string, unknown>;
            let requestedCapo: number | undefined;
            if (intent.action === 'capoChanged') {
              if (effective.beginner.active && effective.beginner.autoCapo) return;
              requestedCapo = intent.capo;
              legacyIntent = { command: 'capoChanged', capo: intent.capo };
            } else if (intent.action === 'beginnerToggled') {
              legacyIntent = { command: 'beginnerToggled', enabled: intent.enabled };
            } else if (intent.action === 'barrePolicyChanged') {
              if (!effective.beginner.active) return;
              legacyIntent = { command: 'barrePolicyChanged', policy: intent.policy };
            } else if (intent.mode === 'auto') {
              if (!effective.beginner.active) return;
              legacyIntent = { command: 'beginnerAutoCapo' };
            } else {
              if (!effective.beginner.active) return;
              requestedCapo = intent.capo;
              legacyIntent = { command: 'capoChanged', capo: intent.capo };
            }

            if (requestedCapo !== undefined) {
              const candidate = effective.capo.candidates.find(item => item.capo === requestedCapo);
              if (!candidate?.supported) return;
            }

            const previousFocusRestore = pendingPreviewFocusRestore;
            pendingPreviewFocusRestore = { uri: expectedIdentity.documentUri, version: expectedIdentity.documentVersion, control: intent.focusControl };
            const accepted = dispatchPreviewLegacyMessage(legacyIntent, activeDoc, {
              previewCapo,
              previewBeginner,
              externalPreviewChanged: uri => settingsController?.externalPreviewChanged(uri),
              applyCapo: applyPreviewCapo,
              applyBeginner: applyPreviewBeginner,
              editCapo: async doc => { await vscode.commands.executeCommand(EDIT_CAPO_COMMAND, doc.uri); }
            });
            const handled = accepted instanceof Promise ? await accepted : accepted;
            if (!handled) pendingPreviewFocusRestore = previousFocusRestore;
            return;
          }
          const legacyMessage = dispatchPreviewLegacyMessage(message, lastActiveGuitarDslDoc, {
            previewCapo,
            previewBeginner,
            externalPreviewChanged: uri => settingsController?.externalPreviewChanged(uri),
            applyCapo: applyPreviewCapo,
            applyBeginner: applyPreviewBeginner,
            editCapo: async doc => { await vscode.commands.executeCommand(EDIT_CAPO_COMMAND, doc.uri); }
          });
          if (legacyMessage instanceof Promise ? await legacyMessage : legacyMessage) {
            if (message.command !== 'layoutChanged') pendingPreviewFocusRestore = undefined;
            return;
          }
          const pageSize: PageSize = isPageSize(message.pageSize) ? message.pageSize : previewPageSize;
          const orientation: PageOrientation = isPageOrientation(message.orientation) ? message.orientation : previewOrientation;
          if (message.command === 'savePdf') {
            const activeDoc = lastActiveGuitarDslDoc || (await resolveGuitarDslDocument(undefined, undefined));
            if (activeDoc) {
              pendingPreviewFocusRestore = undefined;
              await exportScoreToPdf(activeDoc, context.extensionPath, pageSize, orientation, currentLocale, {
                dslContentOverride: effectiveText(activeDoc)
              });
            } else {
              vscode.window.showWarningMessage(msgs.msgDocNotFound);
            }
          } else if (message.command === 'editChord') {
            if (lastActiveGuitarDslDoc && typeof message.key === 'string') {
              pendingPreviewFocusRestore = undefined;
              await vscode.commands.executeCommand(EDIT_CHORD_COMMAND, lastActiveGuitarDslDoc.uri, message.key);
            }
          } else if (message.command === 'openHelp') {
            pendingPreviewFocusRestore = undefined;
            await vscode.commands.executeCommand(OPEN_HELP_COMMAND);
          } else if (message.command === 'layoutChanged') {
            const activeDoc = lastActiveGuitarDslDoc;
            if (!activeDoc
              || message.documentUri !== activeDoc.uri.toString()
              || message.documentVersion !== activeDoc.version
              || message.previewGeneration !== previewLifecycleProbe.generation
              || previewLifecycleProbe.currentDocumentUri !== activeDoc.uri.toString()) {
              return;
            }
            pendingPreviewFocusRestore = isPreviewLayoutFocusControl(message.focusControl)
              ? { uri: activeDoc.uri.toString(), version: activeDoc.version, control: message.focusControl }
              : undefined;
            previewPageSize = pageSize;
            previewOrientation = orientation;
            if (lastActiveGuitarDslDoc) {
              updateWebview(lastActiveGuitarDslDoc);
            }
          }
        },
        null,
        context.subscriptions
      );

      currentPanel.onDidDispose(() => {
        const disposedPreviewUri = previewLifecycleProbe.currentDocumentUri;
        pendingPreviewFocusRestore = undefined;
        pendingPreviewEditRestore = undefined;
        previewLifecycleProbe.disposedGeneration = previewLifecycleProbe.generation;
        previewLifecycleProbe.lastPlaybackAction = undefined;
        audioLeaseCoordinator.previewDisposed();
        if (disposedPreviewUri) settingsController?.externalPreviewChanged(disposedPreviewUri);
        progressionAssistantController?.invalidateActive();
        previewUiMode = 'normal';
        previewUiModeUri = undefined;
        for (const pending of pendingPreviewModeDraftChecks.values()) pending.resolve(undefined);
        pendingPreviewModeDraftChecks.clear();
        visualEditingHost.cancel('preview');
        previewLifecycleProbe.currentDocumentUri = undefined;
        currentPanel = undefined;
        previewCapo.clear();
        previewBeginner.clear();
      }, null, context.subscriptions);
    }

    updateWebview(doc);
    settingsController?.previewOpened(doc);
  });

  const togglePreviewEditModeDisposable = vscode.commands.registerCommand('guitardsl.togglePreviewEditMode', async () => {
    if (!currentPanel) {
      await vscode.commands.executeCommand('guitardsl.showPreview');
      if (!currentPanel) return; // showPreview already reports that no GuitarDSL document is available.
    }
    const document = lastActiveGuitarDslDoc;
    if (!currentPanel || !document) {
      vscode.window.showWarningMessage(msgs.msgOpenGuitarDslFile);
      return;
    }
    const identity = currentPreviewModeIdentity(document);
    if (!identity) return;
    const mode = previewUiModeForUri(identity.documentUri);
    await transitionPreviewUiMode(mode === 'edit' ? 'normal' : 'edit', identity);
  });

  const togglePracticeModeDisposable = vscode.commands.registerCommand('guitardsl.practice.toggle', async () => {
    if (!currentPanel) {
      await vscode.commands.executeCommand('guitardsl.showPreview');
      if (!currentPanel) return; // showPreview already reports that no GuitarDSL document is available.
    }
    const document = lastActiveGuitarDslDoc;
    if (!currentPanel || !document) {
      vscode.window.showWarningMessage(msgs.msgOpenGuitarDslFile);
      return;
    }
    const identity = currentPreviewModeIdentity(document);
    if (!identity) return;
    const mode = previewUiModeForUri(identity.documentUri);
    await transitionPreviewUiMode(mode === 'practice' ? 'normal' : 'practice', identity);
  });

  progressionAssistantController = registerProgressionAssistant(context, currentLocale, {
    async render(session, renderOptions: ProgressionAssistantRenderOptions = {}) {
      const renderGeneration = ++progressionRenderGeneration;
      const isCurrentRender = () => renderGeneration === progressionRenderGeneration
        && progressionAssistantController?.isCurrentSession(session) === true;
      const uri = vscode.Uri.parse(session.uri);
      const doc = vscode.workspace.textDocuments.find(item => item.uri.toString() === session.uri)
        ?? await vscode.workspace.openTextDocument(uri);
      if (!isCurrentRender()) return;
      if (doc.version !== session.version || doc.getText() !== session.source) {
        vscode.window.showWarningMessage(msgs.progressionApplyFailed);
        progressionAssistantController?.invalidate(session.uri);
        return;
      }
      const candidate = session.candidates.find(item => item.id === session.activeCandidateId);
      if (!candidate) {
        if (isCurrentRender() && currentPanel && previewLifecycleProbe.currentDocumentUri === session.uri) updateWebview(doc);
        return;
      }
      const score = parseGuitarDsl(session.source);
      const plan = planProgressionEdit(session.source, score, session.target, candidate);
      if (!plan.ok) {
        vscode.window.showWarningMessage(msgs.progressionApplyFailed);
        progressionAssistantController?.invalidate(session.uri);
        return;
      }

      const panelShowsSession = !!currentPanel && previewLifecycleProbe.currentDocumentUri === session.uri;
      if (!panelShowsSession && renderOptions.openIfNeeded) {
        const sessionIdentity: ProgressionAssistantSessionIdentity = {
          uri: session.uri,
          version: session.version,
          sessionGeneration: session.sessionGeneration
        };
        await vscode.commands.executeCommand('guitardsl.showPreview', doc.uri, sessionIdentity);
      }
      if (!isCurrentRender()) return;
      if (!currentPanel || previewLifecycleProbe.currentDocumentUri !== session.uri) {
        if (!renderOptions.openIfNeeded) return;
        vscode.window.showWarningMessage(msgs.progressionPreviewUnavailable);
        return;
      }
      if (renderOptions.openIfNeeded) currentPanel.reveal(vscode.ViewColumn.Beside);
      currentPanel.webview.postMessage({ command: 'playbackAction', action: 'stop' });
      const config = vscode.workspace.getConfiguration('guitardsl');
      const expandPageBreakRepeats = config.get<boolean>('expandPageBreakRepeats', true);
      const webview = currentPanel.webview;
      const displaySource = session.side === 'A' ? session.source : plan.previewSource;
      effectiveDslProbe.previewInput = displaySource;
      webview.html = compileGuitarDslToHtml(displaySource, {
        locale: currentLocale,
        cspSource: webview.cspSource,
        nonce: randomBytes(16).toString('base64'),
        pageSize: previewPageSize,
        orientation: previewOrientation,
        documentUri: session.uri,
        documentVersion: session.version,
        previewGeneration: previewLifecycleProbe.generation + 1,
        expandPageBreakRepeats,
        ...(audioLeaseCoordinator.activeLeaseId ? { progressionAudioLeaseId: audioLeaseCoordinator.activeLeaseId } : {}),
        fontUris: {
          regular: webview.asWebviewUri(vscode.Uri.joinPath(fontsRoot, 'NotoSansJP-Regular.ttf')).toString(),
          bold: webview.asWebviewUri(vscode.Uri.joinPath(fontsRoot, 'NotoSansJP-Bold.ttf')).toString()
        }
      });
      previewLifecycleProbe.generation++;
      previewLifecycleProbe.currentDocumentUri = session.uri;
    },
    async playAudition(session, request) {
      const candidate = session.candidates.find(item => item.id === request.candidateId);
      if (!candidate) {
        void inspector.postProgressionAudioMessage({ command: 'progressionAudioError', requestId: request.requestId, message: msgs.uiProgressionAudioUnavailable });
        return;
      }
      const score = parseGuitarDsl(session.source);
      const plan = planProgressionEdit(session.source, score, session.target, candidate);
      if (!plan.ok) {
        void inspector.postProgressionAudioMessage({ command: 'progressionAudioError', requestId: request.requestId, message: msgs.uiProgressionAudioUnavailable });
        return;
      }
      const source = request.side === 'A' ? session.source : plan.previewSource;
      const config = vscode.workspace.getConfiguration('guitardsl');
      const playback = buildProgressionAuditionPlaybackData(source, {
        startMeasure: session.target.startMeasure,
        bars: session.target.bars,
        mode: request.mode,
        locale: currentLocale,
        expandPageBreakRepeats: config.get<boolean>('expandPageBreakRepeats', true)
      });
      if (!playback.ok) {
        void inspector.postProgressionAudioMessage({ command: 'progressionAudioError', requestId: request.requestId, message: playback.message });
        return;
      }
      const isCurrent = () => progressionAssistantController?.isCurrentSession(session) === true
        && inspector.currentGeneration === request.generation
        && session.activeCandidateId === request.candidateId && session.side === request.side
        && session.auditionMode === request.mode && session.auditionSpeed === request.speed
        && request.sessionUri === session.uri && request.sessionVersion === session.version
        && request.sessionGeneration === session.sessionGeneration;
      await audioLeaseCoordinator.start(request, playback.data, isCurrent, msgs.uiProgressionAudioUnavailable);
    },
    stop(uri) {
      progressionRenderGeneration++;
      void audioLeaseCoordinator.stopForSession(uri);
      if (currentPanel && previewLifecycleProbe.currentDocumentUri === uri) {
        currentPanel.webview.postMessage({ command: 'playbackAction', action: 'stop' });
      }
    },
    async restore(uri) {
      const renderGeneration = ++progressionRenderGeneration;
      if (!currentPanel || previewLifecycleProbe.currentDocumentUri !== uri) return;
      const doc = vscode.workspace.textDocuments.find(item => item.uri.toString() === uri)
        ?? await vscode.workspace.openTextDocument(vscode.Uri.parse(uri));
      if (renderGeneration !== progressionRenderGeneration || progressionAssistantController?.hasActiveSession(uri)) return;
      updateWebview(doc);
    }
  }, inspector);

  const sendPlaybackAction = (action: string) => {
    if (previewLifecycleProbe.currentDocumentUri) settingsController?.externalPreviewChanged(previewLifecycleProbe.currentDocumentUri);
    if (audioLeaseCoordinator.activeLeaseId) {
      if (action === 'stop') void audioLeaseCoordinator.stop();
      else vscode.window.showWarningMessage(msgs.uiProgressionAudioUnavailable);
      return;
    }
    if (!currentPanel) {
      vscode.window.showWarningMessage(msgs.msgPlaybackNoPreview);
      return;
    }
    previewLifecycleProbe.lastPlaybackAction = action;
    currentPanel.webview.postMessage({ command: 'playbackAction', action });
  };
  context.subscriptions.push(
    vscode.commands.registerCommand('guitardsl.playback.togglePlayPause', () => sendPlaybackAction('togglePlayPause')),
    vscode.commands.registerCommand('guitardsl.playback.stop', () => sendPlaybackAction('stop')),
    vscode.commands.registerCommand('guitardsl.practice.setLoopStart', () => sendPlaybackAction('practiceSetLoopStart')),
    vscode.commands.registerCommand('guitardsl.practice.setLoopEnd', () => sendPlaybackAction('practiceSetLoopEnd')),
    vscode.commands.registerCommand('guitardsl.practice.clearLoop', () => sendPlaybackAction('practiceClearLoop')),
    vscode.commands.registerCommand('guitardsl.practice.slower', () => sendPlaybackAction('practiceSlower')),
    vscode.commands.registerCommand('guitardsl.practice.faster', () => sendPlaybackAction('practiceFaster'))
  );

  vscode.workspace.onDidChangeTextDocument((e) => {
    progressionAssistantController?.invalidate(e.document.uri.toString());
    if (currentPanel && isGuitarDslDocument(e.document)) {
      if (lastActiveGuitarDslDoc && e.document.uri.toString() === lastActiveGuitarDslDoc.uri.toString()) {
        updateWebview(e.document);
      }
    }
  }, null, context.subscriptions);

  previewCapo.onDidChange = doc => updateWebview(doc);
  previewBeginner.onDidChange = doc => updateWebview(doc);

  vscode.workspace.onDidCloseTextDocument((doc) => {
    settingsController?.invalidate(doc.uri.toString());
    progressionAssistantController?.invalidate(doc.uri.toString());
    if (previewUiModeUri === doc.uri.toString()) {
      previewUiMode = 'normal';
      previewUiModeUri = undefined;
      pendingPreviewEditRestore = undefined;
      visualEditingHost.cancel('preview');
    }
    if (currentPanel && lastActiveGuitarDslDoc?.uri.toString() === doc.uri.toString()) {
      updateWebview(doc);
    }
    if (previewCapo.getState()?.documentUri === doc.uri.toString()) {
      previewCapo.clear();
    }
    if (previewBeginner.getState()?.documentUri === doc.uri.toString()) {
      previewBeginner.clear();
    }
  }, null, context.subscriptions);

  /** Legacy Preview message compatibility; the duplicate visible controls remain retired. */
  const applyPreviewCapo = async (doc: vscode.TextDocument, capo: number) => {
    const result = await applyCapoTransform(doc.uri, capo);
    if (result.ok) {
      previewCapo.clear();
      vscode.window.showInformationMessage(msgs.msgCapoApplied(capo));
      if (result.unusedDefinitions.length > 0) {
        vscode.window.showWarningMessage(msgs.msgCapoUnusedDefinitions(result.unusedDefinitions.join(', ')));
      }
    } else {
      const reason = result.code === 'editRejected' ? msgs.msgCapoEditRejected
        : result.code === 'staleDocument' ? msgs.msgDocumentChanged : msgs.capoFailures[result.code];
      vscode.window.showWarningMessage(msgs.msgCapoApplyFailed(reason));
    }
    const fresh = vscode.workspace.textDocuments.find(d => d.uri.toString() === doc.uri.toString()) ?? doc;
    updateWebview(fresh);
  };

  /** Legacy Preview Beginner message compatibility; no duplicate Beginner UI is rendered. */
  const applyPreviewBeginner = async (doc: vscode.TextDocument) => {
    const state = previewBeginner.getState();
    if (!state) return;
    const result = await applyBeginnerTransform(doc.uri, { barrePolicy: state.barrePolicy, targetCapo: state.targetCapo });
    if (result.ok) {
      previewBeginner.clear();
      vscode.window.showInformationMessage(msgs.msgBeginnerApplied(result.targetCapo, result.substitutions));
      if (result.unusedDefinitions.length > 0) {
        vscode.window.showWarningMessage(msgs.msgCapoUnusedDefinitions(result.unusedDefinitions.join(', ')));
      }
    } else {
      const reason = result.code === 'editRejected' ? msgs.msgCapoEditRejected
        : result.code === 'staleDocument' ? msgs.msgDocumentChanged : msgs.beginnerFailure(result.code, result.detail);
      vscode.window.showWarningMessage(msgs.msgBeginnerApplyFailed(reason));
    }
    const fresh = vscode.workspace.textDocuments.find(d => d.uri.toString() === doc.uri.toString()) ?? doc;
    updateWebview(fresh);
  };

  vscode.window.onDidChangeActiveTextEditor((editor) => {
    if (editor && isGuitarDslDocument(editor.document)) {
      const keepProgressionPreview = progressionAssistantController?.hasActiveSession(editor.document.uri.toString()) ?? false;
      progressionAssistantController?.invalidateIfDifferent(editor.document.uri.toString(), true);
      lastActiveGuitarDslDoc = editor.document;
      if (currentPanel && !keepProgressionPreview) {
        updateWebview(editor.document);
      }
    } else if (editor) {
      progressionAssistantController?.invalidateActive(true);
    }
  }, null, context.subscriptions);

  // `targetUri` (optional) exports without the save dialog, e.g. for automation.
  const printDisposable = vscode.commands.registerCommand('guitardsl.exportPdf', async (
    uri?: vscode.Uri,
    targetUri?: vscode.Uri,
    resolutionOptions?: { explicitUriOnly?: boolean }
  ) => {
    const doc = await resolveGuitarDslDocument(uri, lastActiveGuitarDslDoc, resolutionOptions);
    if (!doc) {
      vscode.window.showWarningMessage(msgs.msgOpenGuitarDslFile);
      return;
    }
    // The same effective DSL as the Preview: the override applies only to the previewed document.
    await exportScoreToPdf(doc, context.extensionPath, previewPageSize, previewOrientation, currentLocale, {
      dslContentOverride: effectiveText(doc),
      targetUri: targetUri instanceof vscode.Uri ? targetUri : undefined
    });
  });

  // The existing commands share the Inspector and resolve their URI before revealing it.
  const openScoreSettings = async (uri: vscode.Uri | undefined, section: string) => {
    const requestGeneration = inspector.beginExplicitIntent();
    const isCurrentRequest = () => requestGeneration === inspector.currentExplicitIntentGeneration;
    const doc = await resolveGuitarDslDocument(uri, lastActiveGuitarDslDoc);
    if (!isCurrentRequest()) return;
    if (!doc) {
      vscode.window.showWarningMessage(msgs.msgOpenGuitarDslFile);
      return;
    }
    const progressionIdentity = progressionAssistantController?.getActiveSessionIdentity();
    const audioUri = audioLeaseCoordinator.activeSessionUri;
    const audioLeaseId = audioLeaseCoordinator.activeLeaseId;
    const isSameProgressionSession = () => {
      const current = progressionAssistantController?.getActiveSessionIdentity();
      return progressionIdentity === undefined
        ? current === undefined
        : current?.uri === progressionIdentity.uri && current.version === progressionIdentity.version
          && current.sessionGeneration === progressionIdentity.sessionGeneration;
    };
    if ((audioUri === undefined) !== (audioLeaseId === undefined)) return;
    if (audioUri && audioLeaseId) {
      const stopped = await audioLeaseCoordinator.stopForSession(audioUri);
      if (!isCurrentRequest() || !isSameProgressionSession()) return;
      if (!stopped) {
        vscode.window.showWarningMessage(msgs.uiProgressionAudioUnavailable);
        return;
      }
      if (audioLeaseCoordinator.activeLeaseId !== undefined || audioLeaseCoordinator.activeSessionUri !== undefined) return;
    }
    if (!isCurrentRequest() || !isSameProgressionSession()) return;
    if (progressionIdentity) {
      if (audioLeaseCoordinator.activeLeaseId !== undefined || audioLeaseCoordinator.activeSessionUri !== undefined) return;
      progressionAssistantController?.invalidateActive(false);
      if (progressionAssistantController?.getActiveSessionIdentity() !== undefined) return;
      await progressionAssistantController?.restoreAfterExternalStop(progressionIdentity.uri);
      if (!isCurrentRequest()
        || progressionAssistantController?.getActiveSessionIdentity() !== undefined
        || audioLeaseCoordinator.activeLeaseId !== undefined
        || audioLeaseCoordinator.activeSessionUri !== undefined) return;
    }
    await settingsController?.open(doc, section === 'beginner' || section === 'transpose' ? section : 'capo');
  };
  context.subscriptions.push(
    vscode.commands.registerCommand(EDIT_SCORE_SETTINGS_COMMAND, (uri?: vscode.Uri, section?: string) => openScoreSettings(uri, section ?? 'capo')),
    vscode.commands.registerCommand(EDIT_CAPO_COMMAND, (uri?: vscode.Uri) => openScoreSettings(uri, 'capo'))
  );

  const symbolDisposable = vscode.languages.registerDocumentSymbolProvider(
    { language: 'guitardsl' },
    new GuitarDslDocumentSymbolProvider()
  );

  // Chord diagram editor: command palette (quick pick), CodeLens on `chord` lines, preview diagram click.
  const chordMsgs = getChordEditorMessages(currentLocale);
  const editChordDisposable = vscode.commands.registerCommand(EDIT_CHORD_COMMAND, async (uri?: vscode.Uri, key?: string) => {
    const doc = await resolveGuitarDslDocument(uri, lastActiveGuitarDslDoc);
    if (!doc) {
      vscode.window.showWarningMessage(msgs.msgOpenGuitarDslFile);
      return;
    }
    const target = typeof key === 'string' && isValidChordKey(key) ? key : await pickChordKey(doc, chordMsgs);
    if (target) {
      ChordEditorPanel.show(context.extensionUri, doc, target, currentLocale);
    }
  });
  const codeLensDisposable = vscode.languages.registerCodeLensProvider(
    { language: 'guitardsl' },
    new ChordDefinitionCodeLensProvider(chordMsgs)
  );

  const setApiKeyDisposable = vscode.commands.registerCommand('guitardsl.setGeminiApiKey', async () => {
    const key = await vscode.window.showInputBox({
      password: true,
      prompt: msgs.msgPromptApiKey,
      ignoreFocusOut: true
    });
    if (key !== undefined && key.trim() !== '') {
      await context.secrets.store(GEMINI_API_KEY_SECRET, key.trim());
      vscode.window.showInformationMessage(msgs.msgApiKeySaved);
    }
  });

  const clearApiKeyDisposable = vscode.commands.registerCommand('guitardsl.clearGeminiApiKey', async () => {
    await context.secrets.delete(GEMINI_API_KEY_SECRET);
    vscode.window.showInformationMessage(msgs.msgApiKeyCleared);
  });

  const transcribeYouTubeDisposable = vscode.commands.registerCommand('guitardsl.transcribeYouTube', async () => {
    const { TranscribePanel } = await import('./transcription/transcribePanel');
    TranscribePanel.createOrShow(context.extensionUri, context.secrets, currentLocale);
  });

  // Local Audio MIR (experimental): the controller, worker and WASM are loaded on first use.
  // The controller is disposed with the extension, which terminates any active worker.
  let audioMirController: Promise<import('./audioMir/controller').AudioMirController> | undefined;
  const transcribeAudioDisposable = vscode.commands.registerCommand('guitardsl.transcribeAudio', async () => {
    if (!audioMirController) {
      audioMirController = import('./audioMir/controller').then(({ createAudioMirController }) => {
        const controller = createAudioMirController(context.extensionUri, msgs);
        context.subscriptions.push(controller);
        return controller;
      });
    }
    await (await audioMirController).run();
  });

  const strummingCodeLensDisposable = vscode.languages.registerCodeLensProvider(
    { language: 'guitardsl' },
    new StrummingCodeLensProvider(currentLocale)
  );

  const applyStrummingDisposable = vscode.commands.registerCommand(
    APPLY_STRUMMING_PATTERN_COMMAND,
    async (uri?: vscode.Uri, section?: string | number | StrummingCodeLensTarget) => {
      const doc = await resolveGuitarDslDocument(uri, lastActiveGuitarDslDoc);
      if (!doc) {
        vscode.window.showWarningMessage(msgs.msgOpenGuitarDslFile);
        return;
      }
      await promptAndApplyStrummingPattern(doc, section, currentLocale);
    }
  );

  // Help needs no GuitarDSL document; the locale is resolved at invocation.
  const openHelpDisposable = vscode.commands.registerCommand(OPEN_HELP_COMMAND, () =>
    openGuitarDslHelp(context.extensionUri, vscode.env.language)
  );

  // Onboarding: new document from a starter template / from a curated sample (untitled, editable).
  const newFromTemplateDisposable = vscode.commands.registerCommand(NEW_FROM_TEMPLATE_COMMAND, () =>
    newDocumentFromTemplate(currentLocale)
  );
  const openSampleDisposable = vscode.commands.registerCommand(OPEN_SAMPLE_COMMAND, () =>
    openSample(context.extensionUri, currentLocale)
  );

  // Activity Bar sidebar. `Current File` follows the active editor only (no fallback to other open documents).
  const sidebar = registerGuitarDslSidebar(msgs, () => {
    const doc = vscode.window.activeTextEditor?.document;
    return isGuitarDslDocument(doc) ? doc : undefined;
  });
  context.subscriptions.push(...sidebar.disposables);
  registerGuitarDslSidebarNavigation(context, msgs);
  const refreshSidebar = () => sidebar.provider.refresh();
  vscode.window.onDidChangeActiveTextEditor(refreshSidebar, null, context.subscriptions);
  vscode.workspace.onDidOpenTextDocument(refreshSidebar, null, context.subscriptions);
  vscode.workspace.onDidCloseTextDocument(refreshSidebar, null, context.subscriptions);

  // Language model tools for VS Code Agent / Chat (spec extension §8). Registration never calls a model.
  registerGuitarDslAiTools(context, currentLocale, () => lastActiveGuitarDslDoc);

  context.subscriptions.push(
    previewDisposable,
    togglePreviewEditModeDisposable,
    togglePracticeModeDisposable,
    printDisposable,
    symbolDisposable,
    editChordDisposable,
    codeLensDisposable,
    setApiKeyDisposable,
    clearApiKeyDisposable,
    transcribeYouTubeDisposable,
    transcribeAudioDisposable,
    strummingCodeLensDisposable,
    applyStrummingDisposable,
    openHelpDisposable,
    newFromTemplateDisposable,
    openSampleDisposable
  );
}

export function deactivate() {}
