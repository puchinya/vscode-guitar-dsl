// Transient Preview capo override (spec extension §4.4). The extension host owns the state; the
// effective DSL returned here is the single input for both the Preview and PDF export.

import * as vscode from 'vscode';
import { CapoPreviewUiModel, buildCapoPreviewUiModel, isValidCapo, parseCapoValue, resolveEffectiveDsl } from './capo';
import { parseGuitarDsl } from './compiler';
import { Messages } from './i18n';

export interface PreviewCapoState {
  documentUri: string;
  targetCapo: number;
}

export interface PreviewCapoSnapshot {
  readonly state?: PreviewCapoState;
  readonly notice?: string;
}

export interface EffectiveDsl {
  text: string;
  /** Capo UI model for the Preview toolbar. */
  capo: CapoPreviewUiModel;
}

/** Last Preview / PDF render inputs, recorded for the effective-DSL identity tests. */
export const effectiveDslProbe: { previewInput?: string; pdfInput?: string } = {};

/** Host-side observation only; E2E tests use this to verify Preview HTML generations and disposal. */
export const previewLifecycleProbe = {
  generation: 0,
  currentDocumentUri: undefined as string | undefined,
  disposedGeneration: undefined as number | undefined,
  lastPlaybackAction: undefined as string | undefined,
  /** Test-only one-shot target for recreating the Preview in its captured editor group. */
  nextPanelViewColumnForTests: undefined as vscode.ViewColumn | undefined,
  /** Test-only one-shot interception after a valid Stop ACK arrives from the real Preview Webview. */
  nextStopAcknowledgementForTests: undefined as ((stopped: boolean) => Promise<boolean>) | undefined
};

export class PreviewCapoController {
  private state: PreviewCapoState | undefined;
  private notice: string | undefined;
  /** Re-renders the Preview after the target changed (set by the extension). */
  onDidChange: ((doc: vscode.TextDocument) => void) | undefined;

  constructor(private readonly messages: () => Messages) {}

  getState(): PreviewCapoState | undefined {
    return this.state ? { ...this.state } : undefined;
  }

  captureSettingsSnapshot(documentUri: string): PreviewCapoSnapshot {
    return {
      ...(this.state?.documentUri === documentUri ? { state: { ...this.state } } : {}),
      ...(this.notice !== undefined ? { notice: this.notice } : {})
    };
  }

  restoreSettingsSnapshot(doc: vscode.TextDocument, snapshot: PreviewCapoSnapshot, notify = true): void {
    this.state = snapshot.state ? { ...snapshot.state } : undefined;
    this.notice = snapshot.notice;
    if (notify) this.onDidChange?.(doc);
  }

  /** Sets the Preview capo for `doc`; returns false when the target is not valid for its source. */
  setTarget(doc: vscode.TextDocument, targetCapo: number, notify = true): boolean {
    if (!isValidCapo(targetCapo)) return false;
    const text = doc.getText();
    const result = resolveEffectiveDsl(text, targetCapo);
    if (!result.ok) {
      this.clear();
      this.notify(this.messages().capoFailures[result.code]);
      if (notify) this.onDidChange?.(doc);
      return false;
    }
    const sourceCapo = parseCapoValue(parseGuitarDsl(text).capo);
    this.notice = undefined;
    this.state = sourceCapo === targetCapo ? undefined : { documentUri: doc.uri.toString(), targetCapo };
    if (notify) this.onDidChange?.(doc);
    return true;
  }

  clear(): void {
    this.state = undefined;
    this.notice = undefined;
  }

  /** Called when the previewed document changes to `doc`: state never leaks across documents. */
  switchDocument(doc: vscode.TextDocument | undefined): void {
    if (this.state && (!doc || this.state.documentUri !== doc.uri.toString())) this.clear();
  }

  /**
   * Effective DSL for `doc`, computed from its current source. A transform that is no longer
   * valid clears the override (with a notice), so no stale transformed text can be exported.
   */
  resolve(doc: vscode.TextDocument): EffectiveDsl {
    const source = doc.getText();
    const target = this.state && this.state.documentUri === doc.uri.toString() ? this.state.targetCapo : undefined;
    const result = resolveEffectiveDsl(source, target);
    if (!result.ok) {
      this.state = undefined;
      this.notify(this.messages().capoFailures[result.code]);
      return { text: source, capo: buildCapoPreviewUiModel(source, undefined, this.notice) };
    }
    return { text: result.text, capo: buildCapoPreviewUiModel(source, target, this.notice) };
  }

  /** Effective DSL text for PDF export (same computation as the Preview). */
  effectiveText(doc: vscode.TextDocument): string {
    return this.resolve(doc).text;
  }

  private notify(reason: string): void {
    this.notice = this.messages().msgCapoOverrideReset(reason);
    void vscode.window.showWarningMessage(this.notice);
  }
}

let activeController: PreviewCapoController | undefined;

export function setPreviewCapoController(controller: PreviewCapoController | undefined): void {
  activeController = controller;
}

/** The controller of the running extension (for tests). */
export function getPreviewCapoController(): PreviewCapoController | undefined {
  return activeController;
}
