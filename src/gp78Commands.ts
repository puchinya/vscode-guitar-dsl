import { randomBytes } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { guitarDslToInterchange, hasBlockingLoss, interchangeToGuitarDsl, mergeLossReports } from './interchange';
import { parseGuitarDsl } from './compiler';
import { isGuitarDslDocument, resolveGuitarDslDocument } from './documentResolver';
import { getMessages, type SupportedLocale } from './i18n';
import { exportGp78, importGp78, inspectGp78 } from './gp78';

const IMPORT_COMMAND = 'guitardsl.importGuitarPro';
const EXPORT_COMMAND = 'guitardsl.exportGuitarPro';
const MAX_IMPORT_BYTES = 64 * 1024 * 1024;

export interface Gp78CommandOptions {
  readonly locale?: SupportedLocale;
  readonly getLastActiveDocument: () => vscode.TextDocument | undefined;
}

function resultError(result: { readonly errors: readonly { readonly code: string; readonly path: string; readonly detail: string }[] }): string {
  return result.errors.map(error => `${error.code} ${error.path}: ${error.detail}`).join('\n');
}

function lossDetails(loss: import('./interchange').InterchangeLossReport): string {
  return loss.entries.map(entry => `• ${entry.category}: ${entry.detail}`).join('\n');
}

async function confirmLoss(message: string, detail: string, continueLabel: string, cancelLabel: string): Promise<boolean> {
  const selected = await vscode.window.showWarningMessage(`${message}\n\n${detail}`, { modal: true }, continueLabel, cancelLabel);
  return selected === continueLabel;
}

async function importCommand(locale: SupportedLocale, requestedUri?: vscode.Uri): Promise<void> {
  const msgs = getMessages(locale);
  const sourceUri = requestedUri ?? (await vscode.window.showOpenDialog({
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: false,
    filters: { 'Guitar Pro 7/8': ['gp'] },
    title: msgs.dialogOpenGp78Title,
  }))?.[0];
  if (!sourceUri) return;
  if (path.extname(sourceUri.path).toLowerCase() !== '.gp') {
    void vscode.window.showErrorMessage(msgs.gp78Failed('Only .gp Guitar Pro 7/8 files are supported.'));
    return;
  }
  try {
    const stat = await vscode.workspace.fs.stat(sourceUri);
    if (stat.size > MAX_IMPORT_BYTES) {
      void vscode.window.showErrorMessage(msgs.gp78Failed(`File exceeds ${MAX_IMPORT_BYTES} bytes.`));
      return;
    }
    const bytes = await vscode.workspace.fs.readFile(sourceUri);
    const inspection = inspectGp78(bytes);
    if (!inspection.ok) {
      void vscode.window.showErrorMessage(msgs.gp78Failed(resultError(inspection)));
      return;
    }
    const eligible = inspection.value.tracks.filter(track => track.eligible);
    if (eligible.length === 0) {
      const reasons = inspection.value.tracks.map(track => `${track.name}: ${track.reasonCode ?? 'unsupported'}`).join('\n');
      void vscode.window.showErrorMessage(`${msgs.gp78ImportNoEligibleTracks}${reasons ? `\n${reasons}` : ''}`);
      return;
    }
    let selectedTrack = eligible[0];
    if (eligible.length > 1) {
      const choice = await vscode.window.showQuickPick(eligible.map(track => ({
        label: track.name,
        description: `${track.stringCount}-string guitar · ${track.staffCount} staff · ID ${track.id}`,
        track,
      })), { placeHolder: msgs.gp78ImportTrackPrompt, ignoreFocusOut: true });
      if (!choice) return;
      selectedTrack = choice.track;
    }
    const imported = importGp78(bytes, selectedTrack.id);
    if (!imported.ok) {
      void vscode.window.showErrorMessage(msgs.gp78Failed(resultError(imported)));
      return;
    }
    if (hasBlockingLoss(imported.loss)) {
      void vscode.window.showErrorMessage(msgs.gp78Failed('Unsupported musical semantics cannot be approved away.'));
      return;
    }
    const converted = interchangeToGuitarDsl(imported.value, imported.loss);
    if (!converted.ok) {
      void vscode.window.showErrorMessage(msgs.gp78Failed(converted.errors.map(error => `${error.code} ${error.path}: ${error.detail}`).join('\n')));
      return;
    }
    const parsed = parseGuitarDsl(converted.value);
    const parseErrors = parsed.diagnostics.filter(diagnostic => diagnostic.severity === 'error');
    if (parseErrors.length > 0) {
      void vscode.window.showErrorMessage(msgs.gp78Failed(`Generated GuitarDSL has ${parseErrors.length} parse error(s).`));
      return;
    }
    const loss = mergeLossReports(imported.loss, converted.loss);
    if (loss.entries.length > 0 && !await confirmLoss(msgs.gp78ImportLossConfirm(loss.entries.length), lossDetails(loss), msgs.gp78Continue, msgs.gp78Cancel)) return;
    const document = await vscode.workspace.openTextDocument({ language: 'guitardsl', content: converted.value });
    await vscode.window.showTextDocument(document, { preview: false });
  } catch (error) {
    void vscode.window.showErrorMessage(msgs.gp78Failed(error instanceof Error ? error.message : String(error)));
  }
}

export async function publishGp78Exclusive(targetPath: string, bytes: Uint8Array, source: vscode.TextDocument, sourceVersion: number): Promise<void> {
  const directory = path.dirname(targetPath);
  const temporaryPath = path.join(directory, `.${path.basename(targetPath)}.${randomBytes(8).toString('hex')}.tmp`);
  let handle: fs.FileHandle | undefined;
  let temporaryExists = false;
  try {
    if (source.version !== sourceVersion) throw new Error('The GuitarDSL document changed while export was waiting. Run export again.');
    try {
      await fs.lstat(targetPath);
      throw new Error('The destination already exists. Choose a new file name; Guitar Pro export never overwrites.');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    handle = await fs.open(temporaryPath, 'wx', 0o600);
    temporaryExists = true;
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = undefined;
    if (source.version !== sourceVersion) throw new Error('The GuitarDSL document changed while export was waiting. Run export again.');
    await fs.link(temporaryPath, targetPath);
    await fs.unlink(temporaryPath);
    temporaryExists = false;
    try {
      const directoryHandle = await fs.open(directory, 'r');
      try { await directoryHandle.sync(); } finally { await directoryHandle.close(); }
    } catch {
      // Directory fsync is not available on every supported filesystem; exclusive publication already succeeded.
    }
  } finally {
    if (handle) await handle.close().catch(() => undefined);
    if (temporaryExists) await fs.unlink(temporaryPath).catch(() => undefined);
  }
}

function isLocalFileDocument(document: vscode.TextDocument): boolean {
  return document.uri.scheme === 'file' && isGuitarDslDocument(document);
}

export function registerGp78Commands(context: vscode.ExtensionContext, options: Gp78CommandOptions): vscode.Disposable {
  const locale = options.locale ?? 'en';
  const msgs = getMessages(locale);
  let busy = false;
  const importDisposable = vscode.commands.registerCommand(IMPORT_COMMAND, async (uri?: vscode.Uri) => {
    if (busy) {
      void vscode.window.showWarningMessage(msgs.gp78Busy);
      return;
    }
    busy = true;
    try { await importCommand(locale, uri instanceof vscode.Uri ? uri : undefined); }
    finally { busy = false; }
  });
  const exportDisposable = vscode.commands.registerCommand(EXPORT_COMMAND, async (uri?: vscode.Uri) => {
    if (busy) {
      void vscode.window.showWarningMessage(msgs.gp78Busy);
      return;
    }
    busy = true;
    try {
      const document = await resolveGuitarDslDocument(uri, options.getLastActiveDocument());
      if (!document || !isLocalFileDocument(document)) {
        void vscode.window.showWarningMessage(msgs.msgOpenGuitarDslFile);
        return;
      }
      const sourceVersion = document.version;
      const source = document.getText();
      const converted = guitarDslToInterchange(source);
      if (!converted.ok) {
        void vscode.window.showErrorMessage(msgs.gp78Failed(converted.errors.map(error => `${error.code} ${error.path}: ${error.detail}`).join('\n')));
        return;
      }
      if (hasBlockingLoss(converted.loss)) {
        void vscode.window.showErrorMessage(msgs.gp78Failed('Unsupported musical semantics cannot be approved away.'));
        return;
      }
      const exported = exportGp78(converted.value);
      if (!exported.ok) {
        void vscode.window.showErrorMessage(msgs.gp78Failed(resultError(exported)));
        return;
      }
      const loss = mergeLossReports(converted.loss, exported.loss);
      if (hasBlockingLoss(loss)) {
        void vscode.window.showErrorMessage(msgs.gp78Failed('Unsupported musical semantics cannot be approved away.'));
        return;
      }
      if (loss.entries.length > 0 && !await confirmLoss(msgs.gp78ExportLossConfirm(loss.entries.length), lossDetails(loss), msgs.gp78Continue, msgs.gp78Cancel)) return;
      const defaultName = `${document.uri.fsPath.replace(/\.(guitardsl|gdsl)$/i, '')}.gp`;
      const target = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(defaultName),
        filters: { 'Guitar Pro 7': ['gp'] },
        title: msgs.dialogSaveGp78Title,
      });
      if (!target) return;
      if (target.scheme !== 'file') {
        void vscode.window.showErrorMessage(msgs.gp78Failed('Remote and non-file destinations are not supported.'));
        return;
      }
      if (path.extname(target.fsPath).toLowerCase() !== '.gp') {
        void vscode.window.showErrorMessage(msgs.gp78Failed('The destination must use the .gp extension.'));
        return;
      }
      await publishGp78Exclusive(target.fsPath, exported.value, document, sourceVersion);
      void vscode.window.showInformationMessage(msgs.gp78Saved(path.basename(target.fsPath)));
    } catch (error) {
      void vscode.window.showErrorMessage(msgs.gp78Failed(error instanceof Error ? error.message : String(error)));
    } finally {
      busy = false;
    }
  });
  const disposable = vscode.Disposable.from(importDisposable, exportDisposable);
  context.subscriptions.push(disposable);
  return disposable;
}
