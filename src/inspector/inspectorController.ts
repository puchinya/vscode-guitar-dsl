import type * as vscode from 'vscode';
import type { SupportedLocale } from '../i18n';

export const INSPECTOR_VIEW_ID = 'guitardsl.inspector';
export const INSPECTOR_VIEW_FOCUS_COMMAND = 'guitardsl.inspector.focus';
export const OPEN_INSPECTOR_COMMAND = 'guitardsl.openInspector';

export type InspectorProgressionBars = 4 | 8 | 16;
export type InspectorProgressionOperation = 'replace' | 'append';
export type InspectorProgressionAuditionMode = 'chord' | 'bars' | 'melody' | 'song';

export interface InspectorProgressionCandidate {
  readonly id: string;
  readonly chords: readonly string[];
  readonly score: number;
  readonly scoreText: string;
  readonly rationale: string;
}

export interface InspectorProgressionContext {
  readonly kind: 'progression';
  readonly uri: string;
  readonly version: number;
  readonly sessionGeneration: number;
  readonly target: {
    readonly startMeasure: number;
    readonly bars: InspectorProgressionBars;
    readonly operation: InspectorProgressionOperation;
  };
  readonly availableBars: readonly InspectorProgressionBars[];
  readonly availableOperations: readonly InspectorProgressionOperation[];
  readonly candidates: readonly InspectorProgressionCandidate[];
  readonly selectedCandidateId: string;
  readonly side: 'A' | 'B';
  readonly auditionMode: InspectorProgressionAuditionMode;
  readonly auditionSpeed: 50 | 75 | 100 | 125 | 150;
  readonly loading: boolean;
  readonly error?: string;
}

export type InspectorContext =
  | { readonly kind: 'empty' }
  | { readonly kind: 'document'; readonly uri: string; readonly version: number }
  | InspectorProgressionContext;

export interface InspectorProgressionMessage extends Record<string, unknown> {
  readonly command: string;
  readonly generation: number;
  readonly sessionUri: string;
  readonly sessionVersion: number;
  readonly sessionGeneration: number;
}

export type InspectorProgressionMessageHandler = (message: InspectorProgressionMessage) => void | Promise<void>;

export interface InspectorProgressionAudioAcknowledgement extends Record<string, unknown> {
  readonly command: 'progressionAudioStarted' | 'progressionAudioStopped' | 'progressionAudioFailed';
  readonly leaseId: string;
  readonly requestId: string;
}

export type InspectorProgressionAudioAcknowledgementHandler =
  (message: InspectorProgressionAudioAcknowledgement) => void | Promise<void>;

export interface InspectorActiveDocument {
  readonly uri: string;
  readonly version: number;
}

export interface InspectorPresentation extends vscode.Disposable {
  contextChanged(): void;
  show(preserveFocus: boolean): boolean;
  postMessage(message: unknown): Promise<boolean>;
}

const EMPTY_CONTEXT: InspectorContext = Object.freeze({ kind: 'empty' });

/** Owns the one active Inspector document snapshot and explicit view visibility. */
export class GuitarDslInspectorController implements vscode.Disposable {
  private context: InspectorContext = EMPTY_CONTEXT;
  private disposed = false;
  private generation = 0;
  private progressionMessageHandler: InspectorProgressionMessageHandler | undefined;
  private progressionAudioAcknowledgementHandler: InspectorProgressionAudioAcknowledgementHandler | undefined;

  constructor(
    private readonly presentation: InspectorPresentation,
    private readonly getActiveDocument: () => InspectorActiveDocument | undefined,
    private readonly focusView: () => PromiseLike<unknown>
  ) {}

  get currentContext(): InspectorContext {
    return this.context;
  }

  async openForActiveEditor(preserveFocus = false): Promise<void> {
    if (this.disposed) return;
    const document = this.getActiveDocument();
    if (document) this.showDocument(document.uri, document.version);
    else if (this.context.kind !== 'progression') this.setContext(EMPTY_CONTEXT);

    if (!this.presentation.show(preserveFocus)) {
      await this.focusView();
    }
  }

  showDocument(uri: string, version: number): void {
    if (!uri || !Number.isSafeInteger(version) || version < 0) {
      this.setContext(EMPTY_CONTEXT);
      return;
    }
    if (this.context.kind === 'document' && this.context.uri === uri && this.context.version === version) return;
    if (this.context.kind === 'progression' && this.context.uri === uri && this.context.version === version) return;
    this.setContext({ kind: 'document', uri, version });
  }

  async showProgression(context: InspectorProgressionContext): Promise<void> {
    if (this.disposed || !isValidProgressionContext(context)) return;
    this.setContext(context);
    if (!this.presentation.show(false)) await this.focusView();
  }

  updateProgression(context: InspectorProgressionContext): void {
    if (this.disposed || !isValidProgressionContext(context)) return;
    if (this.context.kind !== 'progression' || this.context.uri !== context.uri
      || this.context.version !== context.version || this.context.sessionGeneration !== context.sessionGeneration) return;
    this.setContext(context);
  }

  restoreDocumentAfterProgression(uri: string): void {
    if (this.context.kind !== 'progression' || this.context.uri !== uri) return;
    const document = this.getActiveDocument();
    if (document) this.setContext({ kind: 'document', uri: document.uri, version: document.version });
    else this.setContext(EMPTY_CONTEXT);
  }

  setProgressionMessageHandler(handler: InspectorProgressionMessageHandler | undefined): void {
    this.progressionMessageHandler = handler;
  }

  setProgressionAudioAcknowledgementHandler(handler: InspectorProgressionAudioAcknowledgementHandler | undefined): void {
    this.progressionAudioAcknowledgementHandler = handler;
  }

  postProgressionAudioMessage(message: unknown): Promise<boolean> {
    if (this.disposed) return Promise.resolve(false);
    return this.presentation.postMessage(message);
  }

  noteWebviewGeneration(generation: number): void {
    if (Number.isSafeInteger(generation) && generation >= this.generation) this.generation = generation;
  }

  get currentGeneration(): number {
    return this.generation;
  }

  async handleWebviewMessage(message: unknown): Promise<boolean> {
    if (isProgressionAudioAcknowledgement(message)) {
      await this.progressionAudioAcknowledgementHandler?.(message);
      return true;
    }
    if (!isProgressionMessage(message) || this.context.kind !== 'progression') return false;
    const context = this.context;
    if (message.generation !== this.generation
      || message.sessionUri !== context.uri
      || message.sessionVersion !== context.version
      || message.sessionGeneration !== context.sessionGeneration) return true;
    await this.progressionMessageHandler?.(message);
    return true;
  }

  handleViewDisposed(): void {
    if (this.disposed || this.context.kind !== 'progression') return;
    const context = this.context;
    void this.progressionMessageHandler?.({
      command: 'progressionDismiss',
      generation: this.generation,
      sessionUri: context.uri,
      sessionVersion: context.version,
      sessionGeneration: context.sessionGeneration,
      selectedCandidateId: context.selectedCandidateId
    });
  }

  invalidate(uri: string): void {
    if ((this.context.kind === 'document' || this.context.kind === 'progression') && this.context.uri === uri) {
      this.setContext(EMPTY_CONTEXT);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.presentation.dispose();
  }

  private setContext(context: InspectorContext): void {
    if (this.disposed) return;
    this.context = context;
    this.generation++;
    this.presentation.contextChanged();
  }
}

function isValidProgressionContext(context: InspectorProgressionContext): boolean {
  return context.kind === 'progression' && typeof context.uri === 'string' && context.uri.length > 0
    && Number.isSafeInteger(context.version) && context.version >= 0
    && Number.isSafeInteger(context.sessionGeneration) && context.sessionGeneration > 0
    && Number.isSafeInteger(context.target.startMeasure) && context.target.startMeasure >= 0
    && [4, 8, 16].includes(context.target.bars)
    && (context.target.operation === 'replace' || context.target.operation === 'append')
    && ['chord', 'bars', 'melody', 'song'].includes(context.auditionMode)
    && Array.isArray(context.candidates) && context.candidates.length <= 5
    && (context.selectedCandidateId === '' || context.candidates.some(item => item.id === context.selectedCandidateId));
}

function isProgressionMessage(message: unknown): message is InspectorProgressionMessage {
  if (typeof message !== 'object' || message === null || !('command' in message)) return false;
  const command = (message as { command?: unknown }).command;
  return typeof command === 'string' && command.startsWith('progression')
    && 'generation' in message && Number.isSafeInteger((message as { generation?: unknown }).generation)
    && 'sessionUri' in message && typeof (message as { sessionUri?: unknown }).sessionUri === 'string'
    && 'sessionVersion' in message && Number.isSafeInteger((message as { sessionVersion?: unknown }).sessionVersion)
    && 'sessionGeneration' in message && Number.isSafeInteger((message as { sessionGeneration?: unknown }).sessionGeneration);
}

function isProgressionAudioAcknowledgement(message: unknown): message is InspectorProgressionAudioAcknowledgement {
  if (typeof message !== 'object' || message === null || !('command' in message)) return false;
  const value = message as { command?: unknown; leaseId?: unknown; requestId?: unknown };
  return (value.command === 'progressionAudioStarted' || value.command === 'progressionAudioStopped'
    || value.command === 'progressionAudioFailed')
    && typeof value.leaseId === 'string' && value.leaseId.length > 0
    && typeof value.requestId === 'string' && value.requestId.length > 0;
}

/**
 * Registers the single Secondary Sidebar view and its explicit open command.
 * The active editor is the only document source; this deliberately does not use
 * the extension's fallback document resolver.
 */
export function registerGuitarDslInspector(
  context: vscode.ExtensionContext,
  locale: SupportedLocale
): GuitarDslInspectorController {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const vscodeApi = require('vscode') as typeof import('vscode');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { isGuitarDslDocument } = require('../documentResolver') as typeof import('../documentResolver');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { GuitarDslInspectorView } = require('./inspectorView') as typeof import('./inspectorView');

  const view = new GuitarDslInspectorView(locale);
  const controller = new GuitarDslInspectorController(
    view,
    () => {
      const document = vscodeApi.window.activeTextEditor?.document;
      return isGuitarDslDocument(document)
        ? { uri: document.uri.toString(), version: document.version }
        : undefined;
    },
    () => vscodeApi.commands.executeCommand(INSPECTOR_VIEW_FOCUS_COMMAND)
  );
  view.setContextProvider(
    () => controller.currentContext,
    message => controller.handleWebviewMessage(message),
    generation => controller.noteWebviewGeneration(generation),
    () => controller.handleViewDisposed()
  );

  const registration = vscodeApi.window.registerWebviewViewProvider(INSPECTOR_VIEW_ID, view, {
    webviewOptions: { retainContextWhenHidden: false }
  });
  const openCommand = vscodeApi.commands.registerCommand(
    OPEN_INSPECTOR_COMMAND,
    (preserveFocus?: boolean) => controller.openForActiveEditor(preserveFocus === true)
  );
  context.subscriptions.push(controller, registration, openCommand);
  return controller;
}
