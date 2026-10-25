import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import { getMessages, type SupportedLocale } from '../i18n';
import { renderInspectorHtml } from '../render/inspectorHtml';
import type { InspectorContext, InspectorPresentation } from './inspectorController';

/** Internal E2E probe for the resolved production view; not used by runtime behavior. */
export const inspectorViewTestProbe: {
  resolvedView?: vscode.WebviewView;
  ready?: boolean;
  transformHtml?: (html: string) => string;
  getContext?: () => InspectorContext;
} = {};

export class GuitarDslInspectorView implements vscode.WebviewViewProvider, InspectorPresentation {
  private view: vscode.WebviewView | undefined;
  private viewReady = false;
  private viewSubscriptions: vscode.Disposable[] = [];
  private getContext: () => InspectorContext = () => ({ kind: 'empty' });
  private getProgressionTabAvailable: () => boolean = () => false;
  private disposed = false;
  private generation = 0;
  private handleMessage: (message: unknown) => boolean | Promise<boolean> = () => false;
  private noteGeneration: (generation: number) => void = () => {};
  private onViewDisposed: () => void = () => {};

  constructor(private readonly locale: SupportedLocale, private readonly extensionUri: vscode.Uri) {}

  setContextProvider(
    getContext: () => InspectorContext,
    handleMessage: (message: unknown) => boolean | Promise<boolean> = () => false,
    noteGeneration: (generation: number) => void = () => {},
    onViewDisposed: () => void = () => {},
    getProgressionTabAvailable: () => boolean = () => false
  ): void {
    this.getContext = getContext;
    inspectorViewTestProbe.getContext = getContext;
    this.handleMessage = handleMessage;
    this.noteGeneration = noteGeneration;
    this.onViewDisposed = onViewDisposed;
    this.getProgressionTabAvailable = getProgressionTabAvailable;
    this.noteGeneration(this.generation);
    this.render();
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    if (this.disposed) return;
    if (this.view) this.releaseView(this.view);
    this.view = webviewView;
    this.viewReady = false;
    inspectorViewTestProbe.resolvedView = webviewView;
    inspectorViewTestProbe.ready = false;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media')]
    };
    this.viewSubscriptions = [
      webviewView.onDidChangeVisibility(() => {
        if (webviewView.visible) this.render();
      }),
      webviewView.webview.onDidReceiveMessage(message => {
        if (isReadyMessage(message)) {
          this.viewReady = true;
          inspectorViewTestProbe.ready = true;
          this.replayCurrentContext();
        }
        else void this.handleMessage(message);
      }),
      webviewView.onDidDispose(() => this.releaseView(webviewView))
    ];
    this.render();
  }

  contextChanged(): void {
    if (this.disposed) return;
    this.generation++;
    this.noteGeneration(this.generation);
    if (this.view?.visible) this.postCurrentContext();
  }

  show(preserveFocus: boolean): boolean {
    if (!this.view) return false;
    this.view.show(preserveFocus);
    if (!this.viewReady) this.render();
    return true;
  }

  async postMessage(message: unknown): Promise<boolean> {
    if (!this.view || this.disposed) return false;
    return this.view.webview.postMessage(message);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.view) this.releaseView(this.view);
  }

  private render(): void {
    if (!this.view || this.disposed) return;
    const nonce = randomBytes(16).toString('base64');
    const settingsScriptUri = this.view.webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'inspectorSettings.js')
    ).toString();
    const html = renderInspectorHtml(
      this.locale,
      this.getContext(),
      this.view.webview.cspSource,
      nonce,
      this.generation,
      settingsScriptUri,
      this.getProgressionTabAvailable()
    );
    this.view.webview.html = inspectorViewTestProbe.transformHtml?.(html) ?? html;
  }

  private replayCurrentContext(): void {
    if (!this.view || this.disposed) return;
    this.generation++;
    this.noteGeneration(this.generation);
    this.postCurrentContext();
  }

  private postCurrentContext(): void {
    if (!this.view || this.disposed) return;
    const context = this.getContext();
    const webviewContext = context.kind === 'document' ? { kind: 'document' } : context;
    const messages = getMessages(this.locale);
    const documentUri = context.kind === 'empty' ? '' : context.uri;
    const documentVersion = context.kind === 'empty' ? -1 : context.version;
    const sessionGeneration = context.kind === 'empty' || context.kind === 'document' ? undefined : context.sessionGeneration;
    void this.view.webview.postMessage({
      command: 'setContext',
      generation: this.generation,
      kind: context.kind,
      context: webviewContext,
      documentUri,
      documentVersion,
      sessionGeneration,
      progressionTabAvailable: this.getProgressionTabAvailable(),
      status: context.kind === 'document' ? messages.inspectorDocumentStatus
        : context.kind === 'progression' ? messages.uiProgressionTitle
          : context.kind === 'settings' ? context.status : messages.inspectorEmptyStatus,
      description: context.kind === 'document'
        ? messages.inspectorDocumentDescription
        : context.kind === 'progression' ? messages.uiProgressionDescription
          : context.kind === 'settings' ? context.description : messages.inspectorEmptyDescription
    });
  }

  private releaseView(view: vscode.WebviewView): void {
    if (this.view !== view) return;
    this.view = undefined;
    this.viewReady = false;
    this.onViewDisposed();
    if (inspectorViewTestProbe.resolvedView === view) {
      inspectorViewTestProbe.resolvedView = undefined;
      inspectorViewTestProbe.ready = false;
    }
    const subscriptions = this.viewSubscriptions;
    this.viewSubscriptions = [];
    for (const subscription of subscriptions) subscription.dispose();
  }
}

function isReadyMessage(message: unknown): message is { command: 'ready' } {
  return typeof message === 'object'
    && message !== null
    && 'command' in message
    && message.command === 'ready';
}
