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

  if (message.command === 'editCapo') {
    if (document) return dependencies.editCapo(document).then(() => true);
    return true;
  }

  return false;
}
