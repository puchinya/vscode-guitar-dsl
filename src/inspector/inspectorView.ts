import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import { getMessages, type SupportedLocale } from '../i18n';
import { renderInspectorHtml } from '../render/inspectorHtml';
import type { InspectorContext, InspectorPresentation } from './inspectorController';

export class GuitarDslInspectorView implements vscode.WebviewViewProvider, InspectorPresentation {
  private view: vscode.WebviewView | undefined;
  private viewSubscriptions: vscode.Disposable[] = [];
  private getContext: () => InspectorContext = () => ({ kind: 'empty' });
  private disposed = false;
  private generation = 0;

  constructor(private readonly locale: SupportedLocale) {}

  setContextProvider(getContext: () => InspectorContext): void {
    this.getContext = getContext;
    this.render();
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    if (this.disposed) return;
    if (this.view) this.releaseView(this.view);
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: []
    };
    this.viewSubscriptions = [
      webviewView.onDidChangeVisibility(() => this.sendContextUpdate()),
      webviewView.onDidDispose(() => this.releaseView(webviewView))
    ];
    this.render();
  }

  contextChanged(): void {
    this.sendContextUpdate();
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
    this.view.webview.html = renderInspectorHtml(
      this.locale,
      this.getContext(),
      this.view.webview.cspSource,
      nonce,
      this.generation
    );
  }

  private sendContextUpdate(): void {
    if (!this.view || this.disposed) return;
    const context = this.getContext();
    const messages = getMessages(this.locale);
    this.generation++;
    void this.view.webview.postMessage({
      command: 'setContext',
      generation: this.generation,
      kind: context.kind,
      status: context.kind === 'document' ? messages.inspectorDocumentStatus : messages.inspectorEmptyStatus,
      description: context.kind === 'document'
        ? messages.inspectorDocumentDescription
        : messages.inspectorEmptyDescription
    });
  }

  private releaseView(view: vscode.WebviewView): void {
    if (this.view !== view) return;
    this.view = undefined;
    const subscriptions = this.viewSubscriptions;
    this.viewSubscriptions = [];
    for (const subscription of subscriptions) subscription.dispose();
  }
}
