import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import { getMessages, type SupportedLocale } from '../i18n';
import { renderInspectorHtml } from '../render/inspectorHtml';
import type { InspectorContext, InspectorPresentation } from './inspectorController';

/** Internal E2E probe for the resolved production view; not used by runtime behavior. */
export const inspectorViewTestProbe: {
  resolvedView?: vscode.WebviewView;
  transformHtml?: (html: string) => string;
} = {};

export class GuitarDslInspectorView implements vscode.WebviewViewProvider, InspectorPresentation {
  private view: vscode.WebviewView | undefined;
  private viewSubscriptions: vscode.Disposable[] = [];
  private getContext: () => InspectorContext = () => ({ kind: 'empty' });
  private disposed = false;
  private generation = 0;
  private handleMessage: (message: unknown) => boolean | Promise<boolean> = () => false;
  private noteGeneration: (generation: number) => void = () => {};
  private onViewDisposed: () => void = () => {};

  constructor(private readonly locale: SupportedLocale) {}

  setContextProvider(
    getContext: () => InspectorContext,
    handleMessage: (message: unknown) => boolean | Promise<boolean> = () => false,
    noteGeneration: (generation: number) => void = () => {},
    onViewDisposed: () => void = () => {}
  ): void {
    this.getContext = getContext;
    this.handleMessage = handleMessage;
    this.noteGeneration = noteGeneration;
    this.onViewDisposed = onViewDisposed;
    this.noteGeneration(this.generation);
    this.render();
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    if (this.disposed) return;
    if (this.view) this.releaseView(this.view);
    this.view = webviewView;
    inspectorViewTestProbe.resolvedView = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: []
    };
    this.viewSubscriptions = [
      webviewView.onDidChangeVisibility(() => {
        if (webviewView.visible) this.render();
      }),
      webviewView.webview.onDidReceiveMessage(message => {
        if (isReadyMessage(message)) this.replayCurrentContext();
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
    return true;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.view) this.releaseView(this.view);
  }

  private render(): void {
    if (!this.view || this.disposed) return;
    const nonce = randomBytes(16).toString('base64');
    const html = renderInspectorHtml(
      this.locale,
      this.getContext(),
      this.view.webview.cspSource,
      nonce,
      this.generation
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
    void this.view.webview.postMessage({
      command: 'setContext',
      generation: this.generation,
      kind: context.kind,
      context: webviewContext,
      status: context.kind === 'document' ? messages.inspectorDocumentStatus
        : context.kind === 'progression' ? messages.uiProgressionTitle : messages.inspectorEmptyStatus,
      description: context.kind === 'document'
        ? messages.inspectorDocumentDescription
        : context.kind === 'progression' ? messages.uiProgressionDescription : messages.inspectorEmptyDescription
    });
  }

  private releaseView(view: vscode.WebviewView): void {
    if (this.view !== view) return;
    this.view = undefined;
    this.onViewDisposed();
    if (inspectorViewTestProbe.resolvedView === view) inspectorViewTestProbe.resolvedView = undefined;
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
