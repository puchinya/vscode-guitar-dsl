import type * as vscode from 'vscode';
import { isBarrePolicy } from './beginnerMode';
import type { PreviewBeginnerController } from './previewBeginner';
import type { PreviewCapoController } from './previewCapo';

export interface PreviewLegacyMessage {
  command?: unknown;
  capo?: unknown;
  enabled?: unknown;
  policy?: unknown;
}

export interface PreviewLegacyCommandDependencies {
  previewCapo: PreviewCapoController;
  previewBeginner: PreviewBeginnerController;
  externalPreviewChanged(documentUri: string): void;
  applyCapo(document: vscode.TextDocument, capo: number): Promise<void>;
  applyBeginner(document: vscode.TextDocument): Promise<void>;
  editCapo(document: vscode.TextDocument): Promise<unknown>;
}

export type PreviewTemporarySettingsFocusControl =
  | 'preview-capo-select'
  | 'toggle-preview-beginner'
  | 'select-preview-barre-policy'
  | 'select-preview-beginner-capo-mode';

export interface PreviewMessageIdentity {
  documentUri: string;
  documentVersion: number;
  previewGeneration: number;
}

export type PreviewTemporarySettingsIntent = PreviewMessageIdentity & {
  focusControl: PreviewTemporarySettingsFocusControl;
} & (
  | { action: 'capoChanged'; capo: number }
  | { action: 'beginnerToggled'; enabled: boolean }
  | { action: 'barrePolicyChanged'; policy: 'allow' | 'forbid' }
  | { action: 'beginnerCapoModeChanged'; mode: 'auto' }
  | { action: 'beginnerCapoModeChanged'; mode: 'fixed'; capo: number }
);

export interface PreviewOpenSettingsIntent extends PreviewMessageIdentity {
  section: 'capo' | 'beginner' | 'transpose';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isCapo(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 12;
}

function parseIdentity(message: Record<string, unknown>): PreviewMessageIdentity | undefined {
  if (typeof message.documentUri !== 'string' || message.documentUri.length === 0
    || !Number.isSafeInteger(message.documentVersion) || !Number.isSafeInteger(message.previewGeneration)) return undefined;
  return {
    documentUri: message.documentUri,
    documentVersion: message.documentVersion as number,
    previewGeneration: message.previewGeneration as number
  };
}

/** Parse the narrow, typed message protocol emitted by the temporary Preview settings controls. */
export function parsePreviewTemporarySettingsIntent(message: unknown): PreviewTemporarySettingsIntent | undefined {
  if (!isRecord(message) || message.command !== 'temporarySettingsChanged') return undefined;
  const identity = parseIdentity(message);
  const value = isRecord(message.value) ? message.value : undefined;
  if (!identity || !value) return undefined;

  if (message.action === 'capoChanged' && value.focusControl === 'preview-capo-select' && isCapo(value.capo)) {
    return { ...identity, action: 'capoChanged', capo: value.capo, focusControl: value.focusControl };
  }
  if (message.action === 'beginnerToggled' && value.focusControl === 'toggle-preview-beginner' && typeof value.enabled === 'boolean') {
    return { ...identity, action: 'beginnerToggled', enabled: value.enabled, focusControl: value.focusControl };
  }
  if (message.action === 'barrePolicyChanged' && value.focusControl === 'select-preview-barre-policy' && isBarrePolicy(value.policy)) {
    return { ...identity, action: 'barrePolicyChanged', policy: value.policy, focusControl: value.focusControl };
  }
  if (message.action === 'beginnerCapoModeChanged' && value.focusControl === 'select-preview-beginner-capo-mode') {
    if (value.mode === 'auto') {
      return { ...identity, action: 'beginnerCapoModeChanged', mode: 'auto', focusControl: value.focusControl };
    }
    if (value.mode === 'fixed' && isCapo(value.capo)) {
      return { ...identity, action: 'beginnerCapoModeChanged', mode: 'fixed', capo: value.capo, focusControl: value.focusControl };
    }
  }
  return undefined;
}

/** Parse the narrowly scoped link to an existing Inspector section. */
export function parsePreviewOpenSettingsIntent(message: unknown): PreviewOpenSettingsIntent | undefined {
  if (!isRecord(message) || message.command !== 'openScoreSettingsFromPreview') return undefined;
  const identity = parseIdentity(message);
  if (!identity || (message.section !== 'capo' && message.section !== 'beginner' && message.section !== 'transpose')) return undefined;
  return { ...identity, section: message.section };
}

export function isCurrentPreviewMessageIdentity(
  identity: PreviewMessageIdentity,
  expected: PreviewMessageIdentity
): boolean {
  return identity.documentUri === expected.documentUri
    && identity.documentVersion === expected.documentVersion
    && identity.previewGeneration === expected.previewGeneration;
}

/** Retains host behavior for older Preview webviews while current markup omits those controls. */
export function dispatchPreviewLegacyMessage(
  message: PreviewLegacyMessage,
  document: vscode.TextDocument | undefined,
  dependencies: PreviewLegacyCommandDependencies
): boolean | Promise<boolean> {
  if (message.command === 'capoChanged') {
    if (document && typeof message.capo === 'number') {
      dependencies.externalPreviewChanged(document.uri.toString());
      if (dependencies.previewBeginner.isActive(document)) {
        dependencies.previewBeginner.setTargetCapo(document, message.capo);
      } else {
        dependencies.previewBeginner.clear();
        dependencies.previewCapo.setTarget(document, message.capo);
      }
    }
    return true;
  }

  if (message.command === 'applyCapo') {
    if (document) dependencies.externalPreviewChanged(document.uri.toString());
    if (document && dependencies.previewBeginner.isActive(document)) {
      return dependencies.applyBeginner(document).then(() => true);
    } else if (document && typeof message.capo === 'number') {
      return dependencies.applyCapo(document, message.capo).then(() => true);
    }
    return true;
  }

  if (message.command === 'beginnerToggled') {
    if (document && typeof message.enabled === 'boolean') {
      dependencies.externalPreviewChanged(document.uri.toString());
      if (message.enabled) dependencies.previewBeginner.enable(document);
      else dependencies.previewBeginner.disable(document);
    }
    return true;
  }

  if (message.command === 'barrePolicyChanged') {
    if (document && isBarrePolicy(message.policy)) {
      dependencies.externalPreviewChanged(document.uri.toString());
      dependencies.previewBeginner.setBarrePolicy(document, message.policy);
    }
    return true;
  }

  if (message.command === 'beginnerAutoCapo') {
    if (document) {
      dependencies.externalPreviewChanged(document.uri.toString());
      dependencies.previewBeginner.setAutoCapo(document);
    }
    return true;
  }

  if (message.command === 'editCapo') {
    if (document) return dependencies.editCapo(document).then(() => true);
    return true;
  }

  return false;
}
