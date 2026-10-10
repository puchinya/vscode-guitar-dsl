import { randomBytes } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { guitarDslToInterchange, hasBlockingLoss, interchangeToGuitarDsl, mergeLossReports } from './interchange';
import { parseGuitarDsl } from './compiler';
import { isGuitarDslDocument, resolveGuitarDslDocument } from './documentResolver';
import { getMessages, type SupportedLocale } from './i18n';
import { exportGp78, importGp78, inspectGp78, planGp78ChordStrum } from './gp78';

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
  return loss.entries.map(entry => `• ${entry.category} ${entry.path}: ${entry.detail}`).join('\n');
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
    const modeItems = [
      {
        label: msgs.gp78ImportFaithful,
        description: msgs.gp78ImportFaithfulDescription,
        mode: 'faithful' as const,
      },
      {
        label: msgs.gp78ImportOptimize,
        description: msgs.gp78ImportOptimizeDescription,
        mode: 'optimize' as const,
      },
    ];
    const selectedMode = await vscode.window.showQuickPick(modeItems, {
      placeHolder: msgs.gp78ImportModePrompt,
      ignoreFocusOut: true,
    });
    if (!selectedMode) return;

    const imported = importGp78(bytes, selectedTrack.id);
    if (!imported.ok) {
      void vscode.window.showErrorMessage(msgs.gp78Failed(resultError(imported)));
      return;
    }
    if (hasBlockingLoss(imported.loss)) {
      void vscode.window.showErrorMessage(msgs.gp78Failed('Unsupported musical semantics cannot be approved away.'));
      return;
    }

    let score = imported.value;
    let baseLoss = imported.loss;
    if (selectedMode.mode === 'optimize') {
      const plan = planGp78ChordStrum(imported.value);
      if (!plan.ok) {
        const fallback = await vscode.window.showWarningMessage(
          msgs.gp78ImportOptimizeUnavailable(plan.reason, `${plan.path}: ${plan.detail}`),
          { modal: true },
          msgs.gp78ImportUseFaithful,
          msgs.gp78Cancel,
        );
        if (fallback !== msgs.gp78ImportUseFaithful) return;
      } else {
        score = plan.score;
        baseLoss = mergeLossReports(imported.loss, plan.loss);
      }
    }

    const serializeImport = (candidateScore: typeof imported.value, candidateLoss: typeof imported.loss) => {
      try {
        const candidate = interchangeToGuitarDsl(candidateScore, candidateLoss);
        if (!candidate.ok) return { ok: false as const, detail: resultError(candidate) };
        const parsed = parseGuitarDsl(candidate.value);
        const parseErrors = parsed.diagnostics.filter(diagnostic => diagnostic.severity === 'error');
        if (parseErrors.length > 0) {
          const codes = parseErrors.map(diagnostic => diagnostic.code).join(', ');
          return { ok: false as const, detail: `Generated GuitarDSL has ${parseErrors.length} parse error(s)${codes ? `: ${codes}` : ''}.` };
        }
        return { ok: true as const, converted: candidate };
      } catch (error) {
        return { ok: false as const, detail: error instanceof Error ? error.message : String(error) };
      }
    };
    let output = serializeImport(score, baseLoss);
    if (!output.ok && selectedMode.mode === 'optimize') {
      const fallback = await vscode.window.showWarningMessage(
        msgs.gp78ImportOptimizeOutputUnavailable(output.detail),
        { modal: true },
        msgs.gp78ImportUseFaithful,
        msgs.gp78Cancel,
      );
      if (fallback !== msgs.gp78ImportUseFaithful) return;
      score = imported.value;
      baseLoss = imported.loss;
      output = serializeImport(score, baseLoss);
    }
    if (!output.ok) {
      void vscode.window.showErrorMessage(msgs.gp78Failed(output.detail));
      return;
    }
    const converted = output.converted;
    const loss = mergeLossReports(baseLoss, converted.loss);
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

function isExportableDocument(document: vscode.TextDocument): boolean {
  return isGuitarDslDocument(document) && (document.uri.scheme === 'file' || document.isUntitled);
}

function defaultExportPath(document: vscode.TextDocument): string {
  if (document.uri.scheme === 'file') return document.uri.fsPath.replace(/\.(guitardsl|gdsl)$/i, '.gp');
  const basename = path.basename(document.fileName).replace(/\.(guitardsl|gdsl)$/i, '') || 'Untitled';
  const workspacePath = vscode.workspace.workspaceFolders?.find(folder => folder.uri.scheme === 'file')?.uri.fsPath;
  return path.join(workspacePath ?? process.cwd(), `${basename}.gp`);
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
      if (!document || !isExportableDocument(document)) {
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
      const defaultName = defaultExportPath(document);
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
