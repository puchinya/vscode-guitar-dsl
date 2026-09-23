import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as cp from 'child_process';
import * as vscode from 'vscode';
import { compileGuitarDslToHtml, compileGuitarDslToPrintHtml, PageSize, PageOrientation } from './compiler';
import { GuitarDslDocumentSymbolProvider } from './symbols';
import { resolveLocale, getMessages } from './i18n';

export function findHeadlessBrowser(): string | undefined {
  const platform = process.platform;
  const candidates: string[] = [];

  if (platform === 'darwin') {
    candidates.push(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
      '/Applications/Chromium.app/Contents/MacOS/Chromium'
    );
  } else if (platform === 'win32') {
    const programFiles = process.env['ProgramFiles'] || 'C:\\Program Files';
    const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const localAppData = process.env['LocalAppData'] || '';

    candidates.push(
      path.join(programFiles, 'Google\\Chrome\\Application\\chrome.exe'),
      path.join(programFilesX86, 'Google\\Chrome\\Application\\chrome.exe'),
      path.join(localAppData, 'Google\\Chrome\\Application\\chrome.exe'),
      path.join(programFiles, 'Microsoft\\Edge\\Application\\msedge.exe'),
      path.join(programFilesX86, 'Microsoft\\Edge\\Application\\msedge.exe')
    );
  } else {
    // Linux and others
    candidates.push(
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium-browser',
      '/usr/bin/chromium',
      '/snap/bin/chromium'
    );
  }

  for (const p of candidates) {
    if (fs.existsSync(p)) {
      return p;
    }
  }

  // Fallback: check PATH
  const whichCmd = platform === 'win32' ? 'where' : 'which';
  for (const bin of ['google-chrome', 'chromium', 'chrome', 'google-chrome-stable', 'msedge']) {
    try {
      const out = cp.execSync(`${whichCmd} ${bin}`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
      const firstLine = out.split(/\r?\n/)[0];
      if (firstLine && fs.existsSync(firstLine)) {
        return firstLine;
      }
    } catch {
      // not found in PATH
    }
  }

  return undefined;
}

export async function exportScoreToPdf(
  doc: vscode.TextDocument,
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

  const browserPath = findHeadlessBrowser();
  if (!browserPath) {
    vscode.window.showErrorMessage(msgs.msgNeedBrowser);
    return;
  }

  const tmpHtmlPath = path.join(os.tmpdir(), `guitardsl_export_${Date.now()}.html`);
  const tmpUserDataDir = path.join(os.tmpdir(), `guitardsl_chrome_${Date.now()}`);
  const htmlContent = compileGuitarDslToPrintHtml(doc.getText(), pageSize, orientation);

  try {
    fs.writeFileSync(tmpHtmlPath, htmlContent, 'utf8');

    await new Promise<void>((resolve, reject) => {
      const args = [
        '--headless=new',
        '--disable-gpu',
        '--no-sandbox',
        '--no-pdf-header-footer',
        `--user-data-dir=${tmpUserDataDir}`,
        `--print-to-pdf=${targetUri.fsPath}`,
        tmpHtmlPath
      ];

      cp.execFile(browserPath, args, (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
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
  } finally {
    try {
      if (fs.existsSync(tmpHtmlPath)) {
        fs.unlinkSync(tmpHtmlPath);
      }
      if (fs.existsSync(tmpUserDataDir)) {
        fs.rmSync(tmpUserDataDir, { recursive: true, force: true });
      }
    } catch {
      // ignore tmp cleanup error
    }
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

export function activate(context: vscode.ExtensionContext) {
  let currentPanel: vscode.WebviewPanel | undefined = undefined;
  let lastActiveGuitarDslDoc: vscode.TextDocument | undefined = undefined;
  const currentLocale = resolveLocale(vscode.env.language);
  const msgs = getMessages(currentLocale);

  const updateWebview = (doc: vscode.TextDocument) => {
    if (currentPanel && isGuitarDslDocument(doc)) {
      lastActiveGuitarDslDoc = doc;
      const text = doc.getText();
      const htmlContent = compileGuitarDslToHtml(text, { locale: currentLocale });
      currentPanel.webview.html = htmlContent;
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
          retainContextWhenHidden: true
        }
      );

      currentPanel.webview.onDidReceiveMessage(
        async (message) => {
          if (message.command === 'savePdf') {
            const activeDoc = lastActiveGuitarDslDoc || (await resolveGuitarDslDocument(undefined, undefined));
            if (activeDoc) {
              await exportScoreToPdf(activeDoc, message.pageSize, message.orientation, currentLocale);
            } else {
              vscode.window.showWarningMessage(msgs.msgDocNotFound);
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
    await exportScoreToPdf(doc, 'A4', 'portrait', currentLocale);
  });

  const symbolDisposable = vscode.languages.registerDocumentSymbolProvider(
    { language: 'guitardsl' },
    new GuitarDslDocumentSymbolProvider()
  );

  context.subscriptions.push(previewDisposable, printDisposable, symbolDisposable);
}

export function deactivate() {}
