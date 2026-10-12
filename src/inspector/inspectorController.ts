import type * as vscode from 'vscode';
import type { SupportedLocale } from '../i18n';

export const INSPECTOR_VIEW_ID = 'guitardsl.inspector';
export const INSPECTOR_VIEW_FOCUS_COMMAND = 'guitardsl.inspector.focus';
export const OPEN_INSPECTOR_COMMAND = 'guitardsl.openInspector';

export type InspectorContext =
  | { readonly kind: 'empty' }
  | { readonly kind: 'document'; readonly uri: string; readonly version: number };

export interface InspectorActiveDocument {
  readonly uri: string;
  readonly version: number;
}

export interface InspectorPresentation extends vscode.Disposable {
  contextChanged(): void;
  show(preserveFocus: boolean): boolean;
}

const EMPTY_CONTEXT: InspectorContext = Object.freeze({ kind: 'empty' });

/** Owns the one active Inspector document snapshot and explicit view visibility. */
export class GuitarDslInspectorController implements vscode.Disposable {
  private context: InspectorContext = EMPTY_CONTEXT;
  private disposed = false;

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
    else this.setContext(EMPTY_CONTEXT);

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
    this.setContext({ kind: 'document', uri, version });
  }

  invalidate(uri: string): void {
    if (this.context.kind === 'document' && this.context.uri === uri) {
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
    this.presentation.contextChanged();
  }
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
  view.setContextProvider(() => controller.currentContext);

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
