import * as vscode from 'vscode';
import { compileGuitarDslToHtml } from './compiler';

export function activate(context: vscode.ExtensionContext) {
  let currentPanel: vscode.WebviewPanel | undefined = undefined;

  const updateWebview = (editor: vscode.TextEditor) => {
    if (currentPanel && editor.document.languageId === 'guitardsl') {
      const text = editor.document.getText();
      const htmlContent = compileGuitarDslToHtml(text);
      currentPanel.webview.html = htmlContent;
    }
  };

  const previewDisposable = vscode.commands.registerCommand('guitardsl.showPreview', () => {
    const activeEditor = vscode.window.activeTextEditor;
    if (!activeEditor) {
      vscode.window.showWarningMessage('GuitarDSL (.guitardsl) ファイルを開いてください。');
      return;
    }

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

    updateWebview(activeEditor);
  });

  vscode.workspace.onDidChangeTextDocument((e) => {
    const activeEditor = vscode.window.activeTextEditor;
    if (activeEditor && e.document === activeEditor.document && currentPanel) {
      updateWebview(activeEditor);
    }
  }, null, context.subscriptions);

  vscode.window.onDidChangeActiveTextEditor((editor) => {
    if (editor && currentPanel && editor.document.languageId === 'guitardsl') {
      updateWebview(editor);
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
