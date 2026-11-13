// Host-owned models and transforms for score-wide settings. The shared Inspector reports typed
// intents; ScoreSettingsInspectorController owns confirmation and document edits.

import * as vscode from 'vscode';
import { BeginnerFailureCode, BeginnerModeOptions, planBeginnerTransform } from './beginnerMode';
import { planCapoTransform } from './capo';
import { CapoMode, TransposeFailureCode, planTransposeWithCapo } from './transpose';
import type { TransposeRequest } from '@guitardsl/core/scoreSettingsSections';

export type { TransposeRequest } from '@guitardsl/core/scoreSettingsSections';

export const EDIT_SCORE_SETTINGS_COMMAND = 'guitardsl.editScoreSettings';
export const EDIT_CAPO_COMMAND = 'guitardsl.editCapo';

export type CapoApplyResult =
  | { ok: true; changed: boolean; targetCapo: number; unusedDefinitions: string[] }
  | { ok: false; code: import('./capo').CapoTransformFailureCode | 'editRejected' | 'staleDocument'; detail?: string };

export interface ExpectedDocumentState {
  readonly version: number;
  readonly source: string;
}

function matchesExpectedDocument(doc: vscode.TextDocument, expected: ExpectedDocumentState | undefined, isSessionCurrent: () => boolean): boolean {
  return isSessionCurrent() && (!expected || (doc.version === expected.version && doc.getText() === expected.source));
}

/**
 * Applies a capo change to the document at `uri`: re-reads the current source, recomputes the
 * transform from it (never from webview-provided text) and applies one undoable WorkspaceEdit.
 */
export async function applyCapoTransform(uri: vscode.Uri, targetCapo: number, expected?: ExpectedDocumentState): Promise<CapoApplyResult> {
  return applyCapoTransformForSettings(uri, targetCapo, expected, () => true);
}

export async function applyCapoTransformForSettings(
  uri: vscode.Uri,
  targetCapo: number,
  expected?: ExpectedDocumentState,
  isSessionCurrent: () => boolean = () => true
): Promise<CapoApplyResult> {
  const doc = await vscode.workspace.openTextDocument(uri);
  const text = doc.getText();
  if (!matchesExpectedDocument(doc, expected, isSessionCurrent)) return { ok: false, code: 'staleDocument' };
  const plan = planCapoTransform(text, targetCapo);
  if (!plan.ok) return plan;
  if (plan.text === text) {
    return { ok: true, changed: false, targetCapo, unusedDefinitions: plan.unusedDefinitions };
  }
  const applied = await replaceDocumentText(doc, text, plan.text, expected, isSessionCurrent);
  if (applied === undefined) return { ok: false, code: 'staleDocument' };
  return applied
    ? { ok: true, changed: true, targetCapo, unusedDefinitions: plan.unusedDefinitions }
    : { ok: false, code: 'editRejected' };
}

/** Replaces only the changed middle so cursors / folding elsewhere are kept; still one edit. */
async function replaceDocumentText(
  doc: vscode.TextDocument,
  text: string,
  next: string,
  expected: ExpectedDocumentState | undefined,
  isSessionCurrent: () => boolean
): Promise<boolean | undefined> {
  let start = 0;
  while (start < text.length && start < next.length && text[start] === next[start]) start++;
  let endOld = text.length;
  let endNew = next.length;
  while (endOld > start && endNew > start && text[endOld - 1] === next[endNew - 1]) {
    endOld--;
    endNew--;
  }
  const edit = new vscode.WorkspaceEdit();
  edit.replace(doc.uri, new vscode.Range(doc.positionAt(start), doc.positionAt(endOld)), next.slice(start, endNew));
  if (!matchesExpectedDocument(doc, expected, isSessionCurrent)) return undefined;
  return vscode.workspace.applyEdit(edit);
}

export type BeginnerApplyResult =
  | { ok: true; changed: boolean; targetCapo: number; substitutions: number; unusedDefinitions: string[] }
  | { ok: false; code: BeginnerFailureCode | 'editRejected' | 'staleDocument'; detail?: string };

/**
 * Applies the Beginner Mode transform to the document at `uri`: re-reads the current source,
 * recomputes the plan from it with `options` (never from webview-provided text) and applies one
 * undoable WorkspaceEdit (capo value and chord names together).
 */
export async function applyBeginnerTransform(uri: vscode.Uri, options: BeginnerModeOptions, expected?: ExpectedDocumentState): Promise<BeginnerApplyResult> {
  return applyBeginnerTransformForSettings(uri, options, expected, () => true);
}

export async function applyBeginnerTransformForSettings(
  uri: vscode.Uri,
  options: BeginnerModeOptions,
  expected?: ExpectedDocumentState,
  isSessionCurrent: () => boolean = () => true
): Promise<BeginnerApplyResult> {
  const doc = await vscode.workspace.openTextDocument(uri);
  const text = doc.getText();
  if (!matchesExpectedDocument(doc, expected, isSessionCurrent)) return { ok: false, code: 'staleDocument' };
  const plan = planBeginnerTransform(text, options);
  if (!plan.ok) return plan;
  const done = { targetCapo: plan.targetCapo, substitutions: plan.candidate.uniqueSubstitutions, unusedDefinitions: plan.unusedDefinitions };
  if (plan.text === text) return { ok: true, changed: false, ...done };
  const applied = await replaceDocumentText(doc, text, plan.text, expected, isSessionCurrent);
  if (applied === undefined) return { ok: false, code: 'staleDocument' };
  return applied ? { ok: true, changed: true, ...done } : { ok: false, code: 'editRejected' };
}

export type TransposeApplyResult =
  | { ok: true; changed: boolean; targetKey: string; targetCapo: number | null; warnings: string[]; unusedDefinitions: string[] }
  | { ok: false; code: TransposeFailureCode | 'editRejected' | 'staleDocument'; detail?: string };

/**
 * Applies a sounding transposition (+ capo choice) to the document at `uri`: re-reads the current source,
 * recomputes the whole plan from it (never from webview-provided text or a previous model) and applies one
 * undoable WorkspaceEdit. Nothing is edited when any stage fails.
 */
export async function applyTransposeTransform(uri: vscode.Uri, request: TransposeRequest, expected?: ExpectedDocumentState): Promise<TransposeApplyResult> {
  return applyTransposeTransformForSettings(uri, request, expected, () => true);
}

export async function applyTransposeTransformForSettings(
  uri: vscode.Uri,
  request: TransposeRequest,
  expected?: ExpectedDocumentState,
  isSessionCurrent: () => boolean = () => true
): Promise<TransposeApplyResult> {
  const doc = await vscode.workspace.openTextDocument(uri);
  const text = doc.getText();
  if (!matchesExpectedDocument(doc, expected, isSessionCurrent)) return { ok: false, code: 'staleDocument' };
  const plan = planTransposeWithCapo(text, request.semitones, request.capoMode);
  if (!plan.ok) return { ok: false, code: plan.code, detail: plan.detail };
  const done = { targetKey: plan.targetKey, targetCapo: plan.targetCapo, warnings: plan.warnings, unusedDefinitions: plan.unusedDefinitions };
  if (plan.text === text) return { ok: true, changed: false, ...done };
  const applied = await replaceDocumentText(doc, text, plan.text, expected, isSessionCurrent);
  if (applied === undefined) return { ok: false, code: 'staleDocument' };
  return applied ? { ok: true, changed: true, ...done } : { ok: false, code: 'editRejected' };
}

export {
  BeginnerSection, CapoSection, TransposeSection
} from '@guitardsl/core/scoreSettingsSections';
export type {
  BeginnerSectionModel, CapoSectionModel, ScoreSettingsSection, ScoreSettingsSectionContext,
  TransposeSectionModel
} from '@guitardsl/core/scoreSettingsSections';
