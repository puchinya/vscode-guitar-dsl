import * as path from 'path';
import * as vscode from 'vscode';
import { compileGuitarDslToHtml } from './render/previewHtml';
import { PageSize, PageOrientation, isPageSize, isPageOrientation } from './render/layout';
import { GuitarDslDocumentSymbolProvider } from './symbols';
import { resolveLocale, getMessages, formatDiagnostic, SupportedLocale, getChordEditorMessages } from './i18n';
import { ChordDefinitionCodeLensProvider, ChordEditorPanel, EDIT_CHORD_COMMAND, isValidChordKey, pickChordKey } from './chordEditor';
import { parseGuitarDsl } from './compiler';
import { StrummingCodeLensProvider, promptAndApplyStrummingPattern, APPLY_STRUMMING_PATTERN_COMMAND } from './strummingCodeLens';
import { PreviewCapoController, effectiveDslProbe, setPreviewCapoController } from './previewCapo';
import { EDIT_CAPO_COMMAND, EDIT_SCORE_SETTINGS_COMMAND, ScoreSettingsEditorPanel, applyCapoTransform } from './scoreSettingsEditor';

export const GEMINI_API_KEY_SECRET = 'guitardsl.geminiApiKey';

export interface ExportPdfOptions {
  /** Effective DSL to render instead of `doc.getText()` (the Preview capo override, spec extension §4.4). */
  dslContentOverride?: string;
  /** Output file; when given, the save dialog is skipped. */
  targetUri?: vscode.Uri;
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

export function isGuitarDslDocument(doc: vscode.TextDocument | undefined): doc is vscode.TextDocument {
  if (!doc) {
    return false;
  }
  if (doc.languageId === 'guitardsl') {
    return true;
  }
  const fileName = doc.fileName.toLowerCase();
  return fileName.endsWith('.guitardsl') || fileName.endsWith('.gdsl');
}

export async function resolveGuitarDslDocument(
  uri?: vscode.Uri,
  lastDoc?: vscode.TextDocument
): Promise<vscode.TextDocument | undefined> {
  // 1. Uri passed explicitly
  if (uri) {
    try {
      const doc = await vscode.workspace.openTextDocument(uri);
      if (isGuitarDslDocument(doc)) {
        return doc;
      }
    } catch {
      // Continue fallback
    }
  }

  // 2. Active text editor document
  const activeDoc = vscode.window.activeTextEditor?.document;
  if (isGuitarDslDocument(activeDoc)) {
    return activeDoc;
  }

  // 3. Visible text editors
  for (const editor of vscode.window.visibleTextEditors) {
    if (isGuitarDslDocument(editor.document)) {
      return editor.document;
    }
  }

  // 4. Last active guitar DSL document (if still open)
  if (lastDoc && !lastDoc.isClosed && isGuitarDslDocument(lastDoc)) {
    return lastDoc;
  }

  // 5. Any open text document in workspace
  for (const doc of vscode.workspace.textDocuments) {
    if (!doc.isClosed && isGuitarDslDocument(doc)) {
      return doc;
    }
  }

  return undefined;
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
  const currentLocale = resolveLocale(vscode.env.language);
  const msgs = getMessages(currentLocale);

  const diagnosticCollection = vscode.languages.createDiagnosticCollection('guitardsl');
  context.subscriptions.push(diagnosticCollection);
  const refreshDiagnostics = (doc: vscode.TextDocument) => {
    if (isGuitarDslDocument(doc)) {
      diagnosticCollection.set(doc.uri, computeDocumentDiagnostics(doc, currentLocale));
    }
  };
  vscode.workspace.textDocuments.forEach(refreshDiagnostics);
  vscode.workspace.onDidOpenTextDocument(refreshDiagnostics, null, context.subscriptions);
  vscode.workspace.onDidChangeTextDocument(e => refreshDiagnostics(e.document), null, context.subscriptions);
  vscode.workspace.onDidCloseTextDocument(doc => diagnosticCollection.delete(doc.uri), null, context.subscriptions);

  const fontsRoot = vscode.Uri.joinPath(context.extensionUri, 'media', 'fonts');
  // Paper size / orientation of the preview; the webview requests changes via 'layoutChanged'.
  let previewPageSize: PageSize = 'A4';
  let previewOrientation: PageOrientation = 'portrait';
  // Transient Preview capo override; its effective DSL feeds both the Preview and PDF export.
  const previewCapo = new PreviewCapoController(() => msgs);
  setPreviewCapoController(previewCapo);
  context.subscriptions.push({ dispose: () => setPreviewCapoController(undefined) });

  const updateWebview = (doc: vscode.TextDocument) => {
    if (currentPanel && isGuitarDslDocument(doc)) {
      previewCapo.switchDocument(doc);
      lastActiveGuitarDslDoc = doc;
      const webview = currentPanel.webview;
      const config = vscode.workspace.getConfiguration('guitardsl');
      const expandPageBreakRepeats = config.get<boolean>('expandPageBreakRepeats', true);
      const effective = previewCapo.resolve(doc);
      effectiveDslProbe.previewInput = effective.text;
      const htmlContent = compileGuitarDslToHtml(effective.text, {
        locale: currentLocale,
        pageSize: previewPageSize,
        orientation: previewOrientation,
        expandPageBreakRepeats,
        capo: effective.capo,
        fontUris: {
          regular: webview.asWebviewUri(vscode.Uri.joinPath(fontsRoot, 'NotoSansJP-Regular.ttf')).toString(),
          bold: webview.asWebviewUri(vscode.Uri.joinPath(fontsRoot, 'NotoSansJP-Bold.ttf')).toString()
        }
      });
      webview.html = htmlContent;
    }
  };

  const previewDisposable = vscode.commands.registerCommand('guitardsl.showPreview', async (uri?: vscode.Uri) => {
    const doc = await resolveGuitarDslDocument(uri, lastActiveGuitarDslDoc);
    if (!doc) {
      vscode.window.showWarningMessage(msgs.msgOpenGuitarDslFile);
      return;
    }

    lastActiveGuitarDslDoc = doc;

    if (currentPanel) {
      currentPanel.reveal(vscode.ViewColumn.Beside);
    } else {
      currentPanel = vscode.window.createWebviewPanel(
        'guitardslPreview',
        msgs.previewTitle,
        vscode.ViewColumn.Beside,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [fontsRoot]
        }
      );

      currentPanel.webview.onDidReceiveMessage(
        async (message) => {
          const pageSize: PageSize = isPageSize(message.pageSize) ? message.pageSize : previewPageSize;
          const orientation: PageOrientation = isPageOrientation(message.orientation) ? message.orientation : previewOrientation;
          if (message.command === 'savePdf') {
            const activeDoc = lastActiveGuitarDslDoc || (await resolveGuitarDslDocument(undefined, undefined));
            if (activeDoc) {
              await exportScoreToPdf(activeDoc, context.extensionPath, pageSize, orientation, currentLocale, {
                dslContentOverride: previewCapo.effectiveText(activeDoc)
              });
            } else {
              vscode.window.showWarningMessage(msgs.msgDocNotFound);
            }
          } else if (message.command === 'editChord') {
            if (lastActiveGuitarDslDoc && typeof message.key === 'string') {
              await vscode.commands.executeCommand(EDIT_CHORD_COMMAND, lastActiveGuitarDslDoc.uri, message.key);
            }
          } else if (message.command === 'capoChanged') {
            if (lastActiveGuitarDslDoc && typeof message.capo === 'number') {
              previewCapo.setTarget(lastActiveGuitarDslDoc, message.capo);
            }
          } else if (message.command === 'applyCapo') {
            if (lastActiveGuitarDslDoc && typeof message.capo === 'number') {
              await applyPreviewCapo(lastActiveGuitarDslDoc, message.capo);
            }
          } else if (message.command === 'editCapo') {
            if (lastActiveGuitarDslDoc) {
              await vscode.commands.executeCommand(EDIT_CAPO_COMMAND, lastActiveGuitarDslDoc.uri);
            }
          } else if (message.command === 'layoutChanged') {
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
        currentPanel = undefined;
        previewCapo.clear();
      }, null, context.subscriptions);
    }

    updateWebview(doc);
  });

  vscode.workspace.onDidChangeTextDocument((e) => {
    if (currentPanel && isGuitarDslDocument(e.document)) {
      if (lastActiveGuitarDslDoc && e.document.uri.toString() === lastActiveGuitarDslDoc.uri.toString()) {
        updateWebview(e.document);
      }
    }
  }, null, context.subscriptions);

  previewCapo.onDidChange = doc => updateWebview(doc);

  vscode.workspace.onDidCloseTextDocument((doc) => {
    if (previewCapo.getState()?.documentUri === doc.uri.toString()) {
      previewCapo.clear();
    }
  }, null, context.subscriptions);

  /** Preview "Apply to DSL": fresh transform of the current source, one WorkspaceEdit, then no override. */
  const applyPreviewCapo = async (doc: vscode.TextDocument, capo: number) => {
    const result = await applyCapoTransform(doc.uri, capo);
    if (result.ok) {
      previewCapo.clear();
      vscode.window.showInformationMessage(msgs.msgCapoApplied(capo));
      if (result.unusedDefinitions.length > 0) {
        vscode.window.showWarningMessage(msgs.msgCapoUnusedDefinitions(result.unusedDefinitions.join(', ')));
      }
    } else {
      const reason = result.code === 'editRejected' ? msgs.msgCapoEditRejected : msgs.capoFailures[result.code];
      vscode.window.showWarningMessage(msgs.msgCapoApplyFailed(reason));
    }
    const fresh = vscode.workspace.textDocuments.find(d => d.uri.toString() === doc.uri.toString()) ?? doc;
    updateWebview(fresh);
  };

  vscode.window.onDidChangeActiveTextEditor((editor) => {
    if (editor && isGuitarDslDocument(editor.document)) {
      lastActiveGuitarDslDoc = editor.document;
      if (currentPanel) {
        updateWebview(editor.document);
      }
    }
  }, null, context.subscriptions);

  // `targetUri` (optional) exports without the save dialog, e.g. for automation.
  const printDisposable = vscode.commands.registerCommand('guitardsl.exportPdf', async (uri?: vscode.Uri, targetUri?: vscode.Uri) => {
    const doc = await resolveGuitarDslDocument(uri, lastActiveGuitarDslDoc);
    if (!doc) {
      vscode.window.showWarningMessage(msgs.msgOpenGuitarDslFile);
      return;
    }
    // The same effective DSL as the Preview: the override applies only to the previewed document.
    await exportScoreToPdf(doc, context.extensionPath, previewPageSize, previewOrientation, currentLocale, {
      dslContentOverride: previewCapo.effectiveText(doc),
      targetUri: targetUri instanceof vscode.Uri ? targetUri : undefined
    });
  });

  // Score settings editor (generic); `editCapo` opens it on the capo / playability section.
  const openScoreSettings = async (uri: vscode.Uri | undefined, section: string) => {
    const doc = await resolveGuitarDslDocument(uri, lastActiveGuitarDslDoc);
    if (!doc) {
      vscode.window.showWarningMessage(msgs.msgOpenGuitarDslFile);
      return;
    }
    ScoreSettingsEditorPanel.show(context.extensionUri, doc, currentLocale, section);
  };
  context.subscriptions.push(
    vscode.commands.registerCommand(EDIT_SCORE_SETTINGS_COMMAND, (uri?: vscode.Uri) => openScoreSettings(uri, 'capo')),
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
    async (uri?: vscode.Uri, sectionName?: string) => {
      const doc = await resolveGuitarDslDocument(uri, lastActiveGuitarDslDoc);
      if (!doc) {
        vscode.window.showWarningMessage(msgs.msgOpenGuitarDslFile);
        return;
      }
      await promptAndApplyStrummingPattern(doc, sectionName, currentLocale);
    }
  );

  context.subscriptions.push(
    previewDisposable,
    printDisposable,
    symbolDisposable,
    editChordDisposable,
    codeLensDisposable,
    setApiKeyDisposable,
    clearApiKeyDisposable,
    transcribeYouTubeDisposable,
    transcribeAudioDisposable,
    strummingCodeLensDisposable,
    applyStrummingDisposable
  );
}

export function deactivate() {}
