// Transient Preview Beginner Mode (spec extension §4.5). The extension host owns the state; while it
// is active it takes precedence over the Preview capo override, and the effective DSL returned by
// resolvePreviewEffectiveDsl() is the single input for both the Preview and PDF export.

import * as vscode from 'vscode';
import {
  BarrePolicy,
  BeginnerFailureCode,
  BeginnerPreviewUiModel,
  INACTIVE_BEGINNER_UI,
  buildBeginnerPreviewUiModel,
  inferBeginnerModeForDsl,
  planBeginnerTransform
} from './beginnerMode';
import { isValidCapo } from './capo';
import { Messages } from './i18n';
import { EffectiveDsl, PreviewCapoController } from './previewCapo';

export interface PreviewBeginnerState {
  documentUri: string;
  barrePolicy: BarrePolicy;
  /** Undefined = auto (recommended capo recomputed from the current source). */
  targetCapo?: number;
}

export interface PreviewEffectiveDsl extends EffectiveDsl {
  beginner: BeginnerPreviewUiModel;
}

export class PreviewBeginnerController {
  private state: PreviewBeginnerState | undefined;
  private notice: string | undefined;
  /** Re-renders the Preview after the state changed (set by the extension). */
  onDidChange: ((doc: vscode.TextDocument) => void) | undefined;

  constructor(private readonly messages: () => Messages, private readonly capo: PreviewCapoController) {}

  getState(): PreviewBeginnerState | undefined {
    return this.state ? { ...this.state } : undefined;
  }

  isActive(doc: vscode.TextDocument): boolean {
    return this.state !== undefined && this.state.documentUri === doc.uri.toString();
  }

  /** Turns Beginner Mode on for `doc` (barre chords forbidden, auto capo); clears the capo override. */
  enable(doc: vscode.TextDocument): boolean {
    this.capo.clear();
    return this.update(doc, { documentUri: doc.uri.toString(), barrePolicy: 'forbid' });
  }

  /** Turns Beginner Mode off; the Preview shows the source (a previous capo override is not restored). */
  disable(doc: vscode.TextDocument): void {
    this.clear();
    this.onDidChange?.(doc);
  }

  /** New barre policy; the capo returns to auto. */
  setBarrePolicy(doc: vscode.TextDocument, barrePolicy: BarrePolicy): boolean {
    if (!this.isActive(doc)) return false;
    return this.update(doc, { documentUri: doc.uri.toString(), barrePolicy });
  }

  /** Fixes the capo (manual); substitutions are recomputed for it. */
  setTargetCapo(doc: vscode.TextDocument, targetCapo: number): boolean {
    if (!this.isActive(doc) || !this.state || !isValidCapo(targetCapo)) return false;
    return this.update(doc, { ...this.state, targetCapo });
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
   * Effective DSL for `doc` while active, computed from its current source; undefined when inactive.
   * A transform that is no longer possible clears the state (with a notice), so no stale transformed
   * text can be rendered or exported.
   */
  resolve(doc: vscode.TextDocument): PreviewEffectiveDsl | undefined {
    if (!this.state || !this.isActive(doc)) return undefined;
    const source = doc.getText();
    const inference = inferBeginnerModeForDsl(source, this.state.barrePolicy);
    const plan = planBeginnerTransform(source, { barrePolicy: this.state.barrePolicy, targetCapo: this.state.targetCapo }, inference);
    if (!plan.ok) {
      this.state = undefined;
      this.notify(plan.code, plan.detail);
      return undefined;
    }
    const models = buildBeginnerPreviewUiModel(source, plan, inference, this.notice);
    return { text: plan.text, ...models };
  }

  /** Notice of the last automatic reset (shown while Beginner Mode is off). */
  currentNotice(): string | undefined {
    return this.notice;
  }

  private update(doc: vscode.TextDocument, next: PreviewBeginnerState): boolean {
    this.state = next;
    this.notice = undefined;
    const ok = this.resolve(doc) !== undefined;
    this.onDidChange?.(doc);
    return ok;
  }

  private notify(code: BeginnerFailureCode, detail?: string): void {
    this.notice = this.messages().msgBeginnerReset(this.messages().beginnerFailure(code, detail));
    void vscode.window.showWarningMessage(this.notice);
  }
}

/**
 * The single effective DSL for Preview and PDF: Beginner Mode when active, else the capo override.
 * Called by both paths so their input is byte-for-byte identical.
 */
export function resolvePreviewEffectiveDsl(
  doc: vscode.TextDocument,
  beginner: PreviewBeginnerController,
  capo: PreviewCapoController
): PreviewEffectiveDsl {
  const active = beginner.resolve(doc);
  if (active) return active;
  const effective = capo.resolve(doc);
  const notice = beginner.currentNotice();
  return {
    ...effective,
    capo: notice && !effective.capo.warning ? { ...effective.capo, warning: notice } : effective.capo,
    beginner: INACTIVE_BEGINNER_UI
  };
}

let activeController: PreviewBeginnerController | undefined;

export function setPreviewBeginnerController(controller: PreviewBeginnerController | undefined): void {
  activeController = controller;
}

/** The controller of the running extension (for tests). */
export function getPreviewBeginnerController(): PreviewBeginnerController | undefined {
  return activeController;
}
