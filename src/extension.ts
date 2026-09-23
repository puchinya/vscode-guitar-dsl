import * as path from 'path';
import * as vscode from 'vscode';
import { compileGuitarDslToHtml } from './render/previewHtml';
import { PageSize, PageOrientation, isPageSize, isPageOrientation } from './render/layout';
import { getBundledFontFiles, writeScorePdf } from './pdf';
import { GuitarDslDocumentSymbolProvider } from './symbols';
import { resolveLocale, getMessages, formatDiagnostic, SupportedLocale, getChordEditorMessages } from './i18n';
import { ChordDefinitionCodeLensProvider, ChordEditorPanel, EDIT_CHORD_COMMAND, isValidChordKey, pickChordKey } from './chordEditor';
import { parseGuitarDsl } from './compiler';
import { transcribeWithGemini } from './transcription/gemini';
import { serializeSongToGuitarDsl } from './transcription/serializer';
import { isValidYouTubeUrl } from './transcription/youtube';
import { TranscribePanel } from './transcription/transcribePanel';
import { StrummingCodeLensProvider, promptAndApplyStrummingPattern, APPLY_STRUMMING_PATTERN_COMMAND } from './strummingCodeLens';

export const GEMINI_API_KEY_SECRET = 'guitardsl.geminiApiKey';

export async function exportScoreToPdf(
  doc: vscode.TextDocument,
  extensionRoot: string,
  pageSize: PageSize = 'A4',
  orientation: PageOrientation = 'portrait',
  locale?: string
): Promise<void> {
  const currentLocale = resolveLocale(locale ?? vscode.env.language);
  const msgs = getMessages(currentLocale);

  const defaultFileName = doc.fileName.replace(/\.(guitardsl|gdsl)$/i, '') + '.pdf';
  const targetUri = await vscode.window.showSaveDialog({
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
    const config = vscode.workspace.getConfiguration('guitardsl');
    const expandPageBreakRepeats = config.get<boolean>('expandPageBreakRepeats', true);
    await writeScorePdf(targetUri.fsPath, doc.getText(), pageSize, orientation, getBundledFontFiles(extensionRoot), {
      expandPageBreakRepeats
    });

    const action = await vscode.window.showInformationMessage(
      msgs.msgPdfSaved(path.basename(targetUri.fsPath)),
      msgs.msgOpenFile
    );
    if (action === msgs.msgOpenFile) {
      vscode.env.openExternal(targetUri);
    }
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

  const updateWebview = (doc: vscode.TextDocument) => {
    if (currentPanel && isGuitarDslDocument(doc)) {
      lastActiveGuitarDslDoc = doc;
      const webview = currentPanel.webview;
      const config = vscode.workspace.getConfiguration('guitardsl');
      const expandPageBreakRepeats = config.get<boolean>('expandPageBreakRepeats', true);
      const htmlContent = compileGuitarDslToHtml(doc.getText(), {
        locale: currentLocale,
        pageSize: previewPageSize,
        orientation: previewOrientation,
        expandPageBreakRepeats,
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
              await exportScoreToPdf(activeDoc, context.extensionPath, pageSize, orientation, currentLocale);
            } else {
              vscode.window.showWarningMessage(msgs.msgDocNotFound);
            }
          } else if (message.command === 'editChord') {
            if (lastActiveGuitarDslDoc && typeof message.key === 'string') {
              await vscode.commands.executeCommand(EDIT_CHORD_COMMAND, lastActiveGuitarDslDoc.uri, message.key);
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

  vscode.window.onDidChangeActiveTextEditor((editor) => {
    if (editor && isGuitarDslDocument(editor.document)) {
      lastActiveGuitarDslDoc = editor.document;
      if (currentPanel) {
        updateWebview(editor.document);
      }
    }
  }, null, context.subscriptions);

  const printDisposable = vscode.commands.registerCommand('guitardsl.exportPdf', async (uri?: vscode.Uri) => {
    const doc = await resolveGuitarDslDocument(uri, lastActiveGuitarDslDoc);
    if (!doc) {
      vscode.window.showWarningMessage(msgs.msgOpenGuitarDslFile);
      return;
    }
    await exportScoreToPdf(doc, context.extensionPath, previewPageSize, previewOrientation, currentLocale);
  });

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
    TranscribePanel.createOrShow(context.extensionUri, context.secrets, currentLocale);
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
    strummingCodeLensDisposable,
    applyStrummingDisposable
  );
}

export function deactivate() {}
