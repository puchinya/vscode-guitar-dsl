// VS Code UI, concurrency, cancellation and document creation for local Audio MIR.
// One job at a time; the analysis itself runs in a worker thread.

import * as path from 'path';
import * as vscode from 'vscode';
import type { Messages } from '../i18n';
import { convertAudioMirToGuitarDsl } from './adapter';
import { AUDIO_MIR_MAX_FILE_BYTES, AudioMirErrorCode, AudioMirResultV1, isAudioMirErrorCode } from './model';
import { validateAudioMirResult } from './validate';
import { AudioMirJob, AudioMirJobOutcome } from './workerClient';

export const AUDIO_MIR_OUTPUT_CHANNEL = 'GuitarDSL Audio MIR';

export interface AudioMirCancellation {
  onCancellationRequested(listener: () => void): { dispose(): void };
}

export interface AudioMirPickedFile {
  scheme: string;
  fsPath: string;
}

/** UI surface; implemented with the VS Code API in production and mocked in tests. */
export interface AudioMirUi {
  pickWav(): Promise<AudioMirPickedFile | undefined>;
  withProgress<T>(task: (token: AudioMirCancellation) => Promise<T>): Promise<T>;
  showWarning(message: string): void;
  showError(message: string): void;
  openUntitledDocument(content: string): Promise<void>;
}

export interface AudioMirControllerDeps {
  ui: AudioMirUi;
  messages: Messages;
  log(line: string): void;
  disposeLog(): void;
  fileSize(fsPath: string): Promise<number>;
  startJob(fsPath: string): AudioMirJob;
  now(): number;
}

type State = { kind: 'idle' } | { kind: 'running'; job?: AudioMirJob } | { kind: 'disposed' };

function describeResult(fileName: string, result: AudioMirResultV1, elapsedMs: number): string[] {
  const r = (v: number, d = 2) => v.toFixed(d);
  const lines = [
    `[${fileName}] ${result.source.sampleRate} Hz / ${result.source.channels} ch / ${result.source.bitsPerSample}-bit, ${r(result.source.durationSeconds)} s, analysis ${elapsedMs} ms`,
    `  tempo ${r(result.tempo.bpm)} BPM (confidence ${r(result.tempo.confidence)}), key ${result.key.name} (confidence ${r(result.key.confidence)})`,
    `  trimmed start ${r(result.trim.startSeconds)} s, end ${r(result.trim.endSeconds)} s, ${result.measures.length} measure(s)`
  ];
  for (const m of result.measures) {
    const chords = m.chords.map(c => `${c.name}@${c.tick16}(${r(c.confidence)})`).join(' ');
    lines.push(`  #${m.index + 1} grid ${m.subdivision}: ${chords}`);
  }
  return lines;
}

export class AudioMirController implements vscode.Disposable {
  private state: State = { kind: 'idle' };

  constructor(private readonly deps: AudioMirControllerDeps) {}

  get isBusy(): boolean {
    return this.state.kind === 'running';
  }

  async run(): Promise<void> {
    const { ui, messages } = this.deps;
    if (this.state.kind === 'disposed') {
      return;
    }
    if (this.state.kind === 'running') {
      ui.showWarning(messages.audioMirBusy);
      return;
    }
    const state: State = { kind: 'running' };
    this.state = state;
    try {
      await this.runJob(state);
    } finally {
      if (this.state === state) {
        this.state = { kind: 'idle' };
      }
    }
  }

  private async runJob(state: { kind: 'running'; job?: AudioMirJob }): Promise<void> {
    const { ui, messages, log } = this.deps;
    const picked = await ui.pickWav();
    if (!picked || this.state !== state) {
      return;
    }
    if (picked.scheme !== 'file') {
      log(`[${path.basename(picked.fsPath)}] failure: UNSUPPORTED_ENVIRONMENT`);
      ui.showError(messages.audioMirUnsupportedEnvironment);
      return;
    }
    const fileName = path.basename(picked.fsPath);
    let size: number;
    try {
      size = await this.deps.fileSize(picked.fsPath);
    } catch {
      this.fail(fileName, 'INVALID_WAV');
      return;
    }
    if (size > AUDIO_MIR_MAX_FILE_BYTES) {
      log(`[${fileName}] failure: FILE_TOO_LARGE`);
      ui.showError(messages.audioMirFileTooLarge);
      return;
    }
    if (this.state !== state) {
      return;
    }

    const started = this.deps.now();
    const outcome = await ui.withProgress<AudioMirJobOutcome>(async token => {
      const job = this.deps.startJob(picked.fsPath);
      state.job = job;
      const subscription = token.onCancellationRequested(() => job.terminate());
      try {
        return await job.promise;
      } finally {
        subscription.dispose();
      }
    });
    state.job = undefined;
    const elapsed = Math.round(this.deps.now() - started);
    if (this.state !== state) {
      // Disposed while running: never touch UI or documents.
      return;
    }
    // The job is finished; release the busy state before any document is opened.
    this.state = { kind: 'idle' };

    if (outcome.type === 'cancelled') {
      log(`[${fileName}] cancelled after ${elapsed} ms`);
      return;
    }
    if (outcome.type === 'error') {
      this.fail(fileName, isAudioMirErrorCode(outcome.code) ? outcome.code : 'ANALYSIS_FAILED', elapsed);
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(outcome.resultJson);
    } catch {
      this.fail(fileName, 'ANALYSIS_FAILED', elapsed);
      return;
    }
    const validation = validateAudioMirResult(parsed);
    if (!validation.valid) {
      log(`[${fileName}] failure: INVALID_RESULT (${validation.error})`);
      ui.showError(messages.audioMirInvalidResult);
      return;
    }
    for (const line of describeResult(fileName, validation.result, elapsed)) {
      log(line);
    }
    const conversion = convertAudioMirToGuitarDsl(validation.result, path.parse(fileName).name);
    if (!conversion.ok) {
      log(`[${fileName}] failure: INVALID_RESULT (${conversion.error})`);
      ui.showError(messages.audioMirInvalidResult);
      return;
    }
    await ui.openUntitledDocument(conversion.content);
  }

  private fail(fileName: string, code: AudioMirErrorCode, elapsedMs?: number): void {
    const suffix = elapsedMs === undefined ? '' : ` after ${elapsedMs} ms`;
    this.deps.log(`[${fileName}] failure: ${code}${suffix}`);
    this.deps.ui.showError(this.deps.messages.audioMirErrors[code]);
  }

  dispose(): void {
    const previous = this.state;
    this.state = { kind: 'disposed' };
    if (previous.kind === 'running') {
      previous.job?.terminate();
    }
    this.deps.disposeLog();
  }
}

/** Production wiring: VS Code UI, OutputChannel and a `worker_threads` worker. */
export function createAudioMirController(extensionUri: vscode.Uri, messages: Messages): AudioMirController {
  const output = vscode.window.createOutputChannel(AUDIO_MIR_OUTPUT_CHANNEL);
  const workerScript = vscode.Uri.joinPath(extensionUri, 'out', 'audioMir', 'worker.js').fsPath;
  const wasmModulePath = vscode.Uri.joinPath(extensionUri, 'media', 'audio-mir-wasm', 'guitardsl_audio_mir.js').fsPath;

  const ui: AudioMirUi = {
    async pickWav() {
      const picked = await vscode.window.showOpenDialog({
        canSelectFiles: true,
        canSelectFolders: false,
        canSelectMany: false,
        title: messages.audioMirDialogTitle,
        filters: { [messages.audioMirWavFilter]: ['wav', 'wave'] }
      });
      const uri = picked?.[0];
      return uri ? { scheme: uri.scheme, fsPath: uri.fsPath || uri.path } : undefined;
    },
    withProgress(task) {
      return Promise.resolve(
        vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: messages.audioMirProgress, cancellable: true },
          (_progress, token) => task(token)
        )
      );
    },
    showWarning: message => void vscode.window.showWarningMessage(message),
    showError: message => void vscode.window.showErrorMessage(message),
    async openUntitledDocument(content) {
      const doc = await vscode.workspace.openTextDocument({ language: 'guitardsl', content });
      await vscode.window.showTextDocument(doc);
    }
  };

  return new AudioMirController({
    ui,
    messages,
    log: line => output.appendLine(line),
    disposeLog: () => output.dispose(),
    fileSize: async fsPath => (await vscode.workspace.fs.stat(vscode.Uri.file(fsPath))).size,
    startJob: fsPath => {
      // Loaded lazily so activation does not pay for worker_threads.
      const { Worker } = require('worker_threads') as typeof import('worker_threads');
      const { startAudioMirJob } = require('./workerClient') as typeof import('./workerClient');
      return startAudioMirJob(request => new Worker(workerScript, { workerData: request }), {
        filePath: fsPath,
        wasmModulePath
      });
    },
    now: () => Date.now()
  });
}
