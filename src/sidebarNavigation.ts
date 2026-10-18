import * as vscode from 'vscode';
import { isGuitarDslDocument } from './documentResolver';
import { Messages } from './i18n';

export const SIDEBAR_OPEN_GUITAR_DSL_FILE_COMMAND = 'guitardsl.navigation.openGuitarDslFile';
export const SIDEBAR_CHOOSE_TRANSCRIPTION_SOURCE_COMMAND = 'guitardsl.navigation.chooseTranscriptionSource';
export const SIDEBAR_SHOW_PREVIEW_ACTIVE_COMMAND = 'guitardsl.navigation.showPreviewActive';
export const SIDEBAR_EXPORT_PDF_ACTIVE_COMMAND = 'guitardsl.navigation.exportPdfActive';
export const SIDEBAR_EXPORT_GUITAR_PRO_ACTIVE_COMMAND = 'guitardsl.navigation.exportGuitarProActive';

function isSupportedGuitarDslUri(uri: vscode.Uri): boolean {
  const filePath = uri.path || uri.fsPath || '';
  return /\.(guitardsl|gdsl)$/i.test(filePath);
}

async function runForActiveGuitarDslDocument(
  api: typeof vscode,
  msgs: Messages,
  command: 'guitardsl.showPreview' | 'guitardsl.exportPdf' | 'guitardsl.exportGuitarPro'
): Promise<void> {
  const doc = api.window.activeTextEditor?.document;
  if (!isGuitarDslDocument(doc)) {
    api.window.showWarningMessage(msgs.msgOpenGuitarDslFile);
    return;
  }
  await api.commands.executeCommand(command, doc.uri);
}

/** Builds the internal command registrations; the API parameter keeps command behavior testable. */
export function createSidebarNavigationCommands(
  api: typeof vscode,
  msgs: Messages
): vscode.Disposable[] {
  const registrations: vscode.Disposable[] = [
    api.commands.registerCommand(SIDEBAR_OPEN_GUITAR_DSL_FILE_COMMAND, async () => {
      const selection = await api.window.showOpenDialog({
        canSelectFiles: true,
        canSelectFolders: false,
        canSelectMany: false,
        filters: { [msgs.sidebarGuitarDslFileFilter]: ['guitardsl', 'gdsl'] }
      });
      const uri = selection?.[0];
      if (!uri) return;
      if (!isSupportedGuitarDslUri(uri)) {
        api.window.showErrorMessage(msgs.msgUnsupportedGuitarDslFile);
        return;
      }
      try {
        const doc = await api.workspace.openTextDocument(uri);
        await api.window.showTextDocument(doc);
      } catch {
        api.window.showErrorMessage(msgs.msgGuitarDslFileOpenFailed);
      }
    }),
    api.commands.registerCommand(SIDEBAR_CHOOSE_TRANSCRIPTION_SOURCE_COMMAND, async () => {
      const options = [
        { label: msgs.sidebarTranscriptionSourceYouTube, command: 'guitardsl.transcribeYouTube' },
        { label: msgs.sidebarTranscriptionSourceAudio, command: 'guitardsl.transcribeAudio' }
      ];
      const selected = await api.window.showQuickPick(options, {
        placeHolder: msgs.sidebarTranscriptionSourcePrompt
      });
      if (selected) await api.commands.executeCommand(selected.command);
    }),
    api.commands.registerCommand(SIDEBAR_SHOW_PREVIEW_ACTIVE_COMMAND, () =>
      runForActiveGuitarDslDocument(api, msgs, 'guitardsl.showPreview')),
    api.commands.registerCommand(SIDEBAR_EXPORT_PDF_ACTIVE_COMMAND, () =>
      runForActiveGuitarDslDocument(api, msgs, 'guitardsl.exportPdf')),
    api.commands.registerCommand(SIDEBAR_EXPORT_GUITAR_PRO_ACTIVE_COMMAND, () =>
      runForActiveGuitarDslDocument(api, msgs, 'guitardsl.exportGuitarPro'))
  ];
  return registrations;
}

/** Registers and owns internal Sidebar commands without adding public package contributions. */
export function registerGuitarDslSidebarNavigation(
  context: vscode.ExtensionContext,
  msgs: Messages
): vscode.Disposable {
  const registrations = createSidebarNavigationCommands(vscode, msgs);
  const disposable: vscode.Disposable = {
    dispose: () => registrations.splice(0).reverse().forEach(registration => registration.dispose())
  };
  context.subscriptions.push(disposable);
  return disposable;
}
