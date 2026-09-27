// GuitarDSL Help: opens the packaged, generated Help Markdown in VS Code's built-in Markdown preview.
// There is no extension-owned Help panel; repeated calls rely on the built-in preview's lifecycle.
import * as vscode from 'vscode';
import { getMessages, resolveLocale, SupportedLocale } from './i18n';

export const OPEN_HELP_COMMAND = 'guitardsl.openHelp';

/** Packaged Help file (relative to the extension root) for a resolved locale. */
export function helpFilePath(locale: SupportedLocale): string[] {
  return ['media', 'help', `guitardsl-help.${locale}.md`];
}

/**
 * Open the packaged Help for `locale` (a raw VS Code language id) to the side.
 * Failures are reported as one localized error message; nothing is thrown and no document is changed.
 */
export async function openGuitarDslHelp(extensionUri: vscode.Uri, locale: string): Promise<void> {
  const resolved = resolveLocale(locale);
  const helpUri = vscode.Uri.joinPath(extensionUri, ...helpFilePath(resolved));
  try {
    await vscode.workspace.fs.stat(helpUri);
    await vscode.commands.executeCommand('markdown.showPreviewToSide', helpUri);
  } catch {
    void vscode.window.showErrorMessage(getMessages(resolved).msgHelpOpenFailed);
  }
}
