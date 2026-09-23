import * as vscode from 'vscode';
import { compileGuitarDslToHtml } from './compiler';

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
  // 1. Uri passed explicitly (e.g. from editor/title menu, explorer context, or command args)
  if (uri) {
    try {
      const doc = await vscode.workspace.openTextDocument(uri);
      if (isGuitarDslDocument(doc)) {
        return doc;
      }
    } catch {
      // Continue fallback on error
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

export function activate(context: vscode.ExtensionContext) {
  let currentPanel: vscode.WebviewPanel | undefined = undefined;
  let lastActiveGuitarDslDoc: vscode.TextDocument | undefined = undefined;

  const updateWebview = (doc: vscode.TextDocument) => {
    if (currentPanel && isGuitarDslDocument(doc)) {
      lastActiveGuitarDslDoc = doc;
      const text = doc.getText();
      const htmlContent = compileGuitarDslToHtml(text);
      currentPanel.webview.html = htmlContent;
    }
  };

  const previewDisposable = vscode.commands.registerCommand('guitardsl.showPreview', async (uri?: vscode.Uri) => {
    const doc = await resolveGuitarDslDocument(uri, lastActiveGuitarDslDoc);
    if (!doc) {
      vscode.window.showWarningMessage('GuitarDSL (.guitardsl) ファイルを開いてください。');
      return;
    }

    lastActiveGuitarDslDoc = doc;

    if (currentPanel) {
      currentPanel.reveal(vscode.ViewColumn.Beside);
    } else {
      currentPanel = vscode.window.createWebviewPanel(
        'guitardslPreview',
        'GuitarDSL Score Preview',
        vscode.ViewColumn.Beside,
        {
          enableScripts: true,
          retainContextWhenHidden: true
        }
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

  const printDisposable = vscode.commands.registerCommand('guitardsl.exportPdf', () => {
    if (!currentPanel) {
      vscode.commands.executeCommand('guitardsl.showPreview');
    }
    setTimeout(() => {
      currentPanel?.webview.postMessage({ command: 'print' });
    }, 200);
  });

  context.subscriptions.push(previewDisposable, printDisposable);
}

export function deactivate() {}
