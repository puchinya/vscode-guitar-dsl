import type * as vscode from 'vscode';
import type { LetDefinitionSummary } from '../compiler';
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

export type InspectorSettingsSection = 'capo' | 'beginner' | 'transpose';

export interface InspectorSettingsContext {
  readonly kind: 'settings';
  readonly uri: string;
  readonly version: number;
  readonly sessionGeneration: number;
  readonly revision: number;
  readonly section: InspectorSettingsSection;
  readonly sections: readonly { readonly id: InspectorSettingsSection; readonly title: string }[];
  readonly model: unknown;
  readonly status: string;
  readonly description: string;
}

export interface InspectorVariablesContext {
  readonly kind: 'variables';
  readonly uri: string;
  readonly version: number;
  readonly sessionGeneration: number;
  readonly revision: number;
  readonly draftRevision: number;
  readonly definitions: readonly LetDefinitionSummary[];
  readonly selectedName?: string;
  readonly error?: string;
  readonly requiresReferenceChoice?: boolean;
  readonly referenceSelection?: string;
}

export type InspectorContext =
  | { readonly kind: 'empty' }
  | { readonly kind: 'document'; readonly uri: string; readonly version: number }
  | InspectorSettingsContext
  | InspectorVariablesContext
  | InspectorProgressionContext;

export interface InspectorProgressionMessage extends Record<string, unknown> {
  readonly command: string;
  readonly generation: number;
  readonly sessionUri: string;
  readonly sessionVersion: number;
  readonly sessionGeneration: number;
}

export type InspectorProgressionMessageHandler = (message: InspectorProgressionMessage) => void | Promise<void>;
export type InspectorProgressionIntentPredicate = (message: InspectorProgressionMessage) => boolean;

export interface InspectorSettingsMessage extends Record<string, unknown> {
  readonly command: string;
  readonly generation: number;
  readonly sessionUri: string;
  readonly sessionVersion: number;
  readonly sessionGeneration: number;
  readonly revision: number;
  readonly section: InspectorSettingsSection;
}

export type InspectorSettingsMessageHandler = (message: InspectorSettingsMessage) => void | Promise<void>;

export interface InspectorVariablesMessage extends Record<string, unknown> {
  readonly command: string;
  readonly generation: number;
  readonly sessionUri: string;
  readonly sessionVersion: number;
  readonly sessionGeneration: number;
  readonly revision: number;
  readonly draftRevision?: number;
}

export type InspectorVariablesMessageHandler = (message: InspectorVariablesMessage) => void | Promise<void>;

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
  private explicitIntentGeneration = 0;
  private progressionMessageHandler: InspectorProgressionMessageHandler | undefined;
  private progressionIntentPredicate: InspectorProgressionIntentPredicate | undefined;
  private settingsMessageHandler: InspectorSettingsMessageHandler | undefined;
  private variablesMessageHandler: InspectorVariablesMessageHandler | undefined;
  private progressionAudioAcknowledgementHandler: InspectorProgressionAudioAcknowledgementHandler | undefined;
  private settingsSessionEndHandler: ((uri: string) => void) | undefined;
  private endingSettingsForContextChange = false;
  private endingVariablesForContextChange = false;

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
    // The public open command is an explicit user action even when the active
    // document is already the current context and showDocument is a no-op.
    this.beginExplicitIntent();
    const document = this.getActiveDocument();
    if (document) this.showDocument(document.uri, document.version);
    else if (this.context.kind !== 'progression') this.setContext(EMPTY_CONTEXT);

    if (!this.presentation.show(preserveFocus)) {
      await this.focusView();
    }
  }

  showDocument(uri: string, version: number): void {
    if (!uri || !Number.isSafeInteger(version) || version < 0) {
      if (this.context.kind !== 'empty') this.beginExplicitIntent();
      this.setContext(EMPTY_CONTEXT);
      return;
    }
    if (this.context.kind === 'document' && this.context.uri === uri && this.context.version === version) return;
    if (this.context.kind === 'progression' && this.context.uri === uri && this.context.version === version) return;
    this.beginExplicitIntent();
    this.setContext({ kind: 'document', uri, version });
  }

  async showProgression(context: InspectorProgressionContext): Promise<void> {
    if (this.disposed || !isValidProgressionContext(context)) return;
    this.beginExplicitIntent();
    this.setContext(context);
    if (!this.presentation.show(false)) await this.focusView();
  }

  async showSettings(context: InspectorSettingsContext): Promise<void> {
    if (this.disposed || !isValidSettingsContext(context)) return;
    this.beginExplicitIntent();
    this.setContext(context);
    if (!this.presentation.show(false)) await this.focusView();
  }

  async showVariables(context: InspectorVariablesContext): Promise<void> {
    if (this.disposed || !isValidVariablesContext(context)) return;
    this.beginExplicitIntent();
    this.setContext(context);
    if (!this.presentation.show(false)) await this.focusView();
  }

  updateVariables(context: InspectorVariablesContext): void {
    if (this.disposed || !isValidVariablesContext(context) || this.context.kind !== 'variables'
      || this.context.uri !== context.uri || this.context.sessionGeneration !== context.sessionGeneration
      || context.revision < this.context.revision) return;
    this.setContext(context);
  }

  updateSettings(context: InspectorSettingsContext): void {
    if (this.disposed || !isValidSettingsContext(context) || this.context.kind !== 'settings'
      || this.context.uri !== context.uri || this.context.sessionGeneration !== context.sessionGeneration
      || context.revision < this.context.revision) return;
    this.setContext(context);
  }

  restoreDocumentAfterSettings(uri: string): void {
    if (this.endingSettingsForContextChange) return;
    if (this.context.kind !== 'settings' || this.context.uri !== uri) return;
    const document = this.getActiveDocument();
    if (document) this.setContext({ kind: 'document', uri: document.uri, version: document.version });
    else this.setContext(EMPTY_CONTEXT);
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

  setProgressionMessageHandler(
    handler: InspectorProgressionMessageHandler | undefined,
    intentPredicate?: InspectorProgressionIntentPredicate
  ): void {
    this.progressionMessageHandler = handler;
    this.progressionIntentPredicate = handler ? intentPredicate : undefined;
  }

  setSettingsMessageHandler(handler: InspectorSettingsMessageHandler | undefined): void {
    this.settingsMessageHandler = handler;
  }

  setVariablesMessageHandler(handler: InspectorVariablesMessageHandler | undefined): void {
    this.variablesMessageHandler = handler;
  }

  setSettingsSessionEndHandler(handler: ((uri: string) => void) | undefined): void {
    this.settingsSessionEndHandler = handler;
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

  get currentExplicitIntentGeneration(): number {
    return this.explicitIntentGeneration;
  }

  /** Starts a user-directed Inspector intent that supersedes pending context requests. */
  beginExplicitIntent(): number {
    this.explicitIntentGeneration++;
    return this.explicitIntentGeneration;
  }

  async handleWebviewMessage(message: unknown): Promise<boolean> {
    if (isProgressionAudioAcknowledgement(message)) {
      await this.progressionAudioAcknowledgementHandler?.(message);
      return true;
    }
    if (isSettingsMessage(message)) {
      if (this.context.kind !== 'settings') return true;
      const context = this.context;
      if (message.generation !== this.generation || message.sessionUri !== context.uri
        || message.sessionVersion !== context.version || message.sessionGeneration !== context.sessionGeneration
        || message.revision !== context.revision || message.section !== context.section) return true;
      await this.settingsMessageHandler?.(message);
      return true;
    }
    if (isVariablesMessage(message)) {
      if (this.context.kind !== 'variables') return true;
      const context = this.context;
      if (message.generation !== this.generation || message.sessionUri !== context.uri
        || message.sessionVersion !== context.version || message.sessionGeneration !== context.sessionGeneration
        || message.revision !== context.revision) return true;
      if (message.command === 'variablesCancel') this.endingVariablesForContextChange = true;
      try {
        await this.variablesMessageHandler?.(message);
      } finally {
        this.endingVariablesForContextChange = false;
      }
      return true;
    }
    if (!isProgressionMessage(message) || this.context.kind !== 'progression') return false;
    const context = this.context;
    if (message.generation !== this.generation
      || message.sessionUri !== context.uri
      || message.sessionVersion !== context.version
      || message.sessionGeneration !== context.sessionGeneration) return true;
    if (this.progressionIntentPredicate?.(message)) this.beginExplicitIntent();
    await this.progressionMessageHandler?.(message);
    return true;
  }

  handleViewDisposed(): void {
    if (this.disposed) return;
    if (this.context.kind === 'settings') {
      const context = this.context;
      void this.settingsMessageHandler?.({
        command: 'settingsCancel',
        generation: this.generation,
        sessionUri: context.uri,
        sessionVersion: context.version,
        sessionGeneration: context.sessionGeneration,
        revision: context.revision,
        section: context.section
      });
      return;
    }
    if (this.context.kind === 'variables') {
      const context = this.context;
      void this.variablesMessageHandler?.({
        command: 'variablesCancel',
        generation: this.generation,
        sessionUri: context.uri,
        sessionVersion: context.version,
        sessionGeneration: context.sessionGeneration,
        revision: context.revision
      });
      return;
    }
    if (this.context.kind !== 'progression') return;
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
    if ((this.context.kind === 'document' || this.context.kind === 'settings' || this.context.kind === 'variables'
      || this.context.kind === 'progression') && this.context.uri === uri) {
      this.beginExplicitIntent();
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
    if (this.context.kind === 'settings' && context.kind !== 'settings') {
      const uri = this.context.uri;
      this.endingSettingsForContextChange = true;
      try {
        this.settingsSessionEndHandler?.(uri);
      } finally {
        this.endingSettingsForContextChange = false;
      }
      if (this.disposed) return;
    }
    if (this.context.kind === 'variables' && context.kind !== 'variables' && !this.endingVariablesForContextChange) {
      const variables = this.context;
      this.endingVariablesForContextChange = true;
      try {
        void this.variablesMessageHandler?.({
          command: 'variablesCancel',
          generation: this.generation,
          sessionUri: variables.uri,
          sessionVersion: variables.version,
          sessionGeneration: variables.sessionGeneration,
          revision: variables.revision
        });
      } finally {
        this.endingVariablesForContextChange = false;
      }
      if (this.disposed) return;
    }
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

function isValidSettingsContext(context: InspectorSettingsContext): boolean {
  return context.kind === 'settings' && typeof context.uri === 'string' && context.uri.length > 0
    && Number.isSafeInteger(context.version) && context.version >= 0
    && Number.isSafeInteger(context.sessionGeneration) && context.sessionGeneration > 0
    && Number.isSafeInteger(context.revision) && context.revision >= 0
    && ['capo', 'beginner', 'transpose'].includes(context.section)
    && Array.isArray(context.sections) && context.sections.length === 3
    && typeof context.status === 'string' && typeof context.description === 'string'
    && typeof context.model === 'object' && context.model !== null;
}

function isValidVariablesContext(context: InspectorVariablesContext): boolean {
  return context.kind === 'variables' && typeof context.uri === 'string' && context.uri.length > 0
    && Number.isSafeInteger(context.version) && context.version >= 0
    && Number.isSafeInteger(context.sessionGeneration) && context.sessionGeneration > 0
    && Number.isSafeInteger(context.revision) && context.revision >= 0
    && Number.isSafeInteger(context.draftRevision) && context.draftRevision >= 0
    && Array.isArray(context.definitions) && context.definitions.length <= 1000
    && (context.selectedName === undefined || typeof context.selectedName === 'string')
    && (context.error === undefined || typeof context.error === 'string')
    && (context.requiresReferenceChoice === undefined || typeof context.requiresReferenceChoice === 'boolean')
    && (context.referenceSelection === undefined || typeof context.referenceSelection === 'string');
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

function isSettingsMessage(message: unknown): message is InspectorSettingsMessage {
  if (typeof message !== 'object' || message === null || !('command' in message)) return false;
  const value = message as Record<string, unknown>;
  return typeof value.command === 'string' && value.command.startsWith('settings')
    && Number.isSafeInteger(value.generation)
    && typeof value.sessionUri === 'string'
    && Number.isSafeInteger(value.sessionVersion)
    && Number.isSafeInteger(value.sessionGeneration)
    && Number.isSafeInteger(value.revision)
    && (value.section === 'capo' || value.section === 'beginner' || value.section === 'transpose');
}

function isVariablesMessage(message: unknown): message is InspectorVariablesMessage {
  if (typeof message !== 'object' || message === null || !('command' in message)) return false;
  const value = message as Record<string, unknown>;
  return typeof value.command === 'string' && value.command.startsWith('variables')
    && Number.isSafeInteger(value.generation)
    && typeof value.sessionUri === 'string'
    && Number.isSafeInteger(value.sessionVersion)
    && Number.isSafeInteger(value.sessionGeneration)
    && Number.isSafeInteger(value.revision)
    && (value.command !== 'variablesDraft' && value.command !== 'variablesApply'
      || Number.isSafeInteger(value.draftRevision));
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

  const view = new GuitarDslInspectorView(locale, context.extensionUri);
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
