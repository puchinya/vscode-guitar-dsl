// Shared GuitarDSL document resolution used by extension commands and the AI language model tools
// (spec extension.md §3.1, §8.4). Moved unchanged from extension.ts.

import * as vscode from 'vscode';

export interface GuitarDslDocumentResolutionOptions {
  /** Do not switch documents if the supplied URI cannot be opened as GuitarDSL. */
  explicitUriOnly?: boolean;
}

/** Used by internal Sidebar routes that must remain bound to their captured active URI. */
export const EXPLICIT_URI_ONLY_RESOLUTION: GuitarDslDocumentResolutionOptions = Object.freeze({
  explicitUriOnly: true
});

export function isGuitarDslDocument(doc: vscode.TextDocument | undefined): doc is vscode.TextDocument {
  if (!doc) {
    return false;
  }
  if (doc.languageId === 'guitardsl') {
    return true;
  }
  const fileName = doc.fileName.toLowerCase();
  return fileName.endsWith('.guitardsl') || fileName.endsWith('.gdsl');
}

export async function resolveGuitarDslDocument(
  uri?: vscode.Uri,
  lastDoc?: vscode.TextDocument,
  options: GuitarDslDocumentResolutionOptions = {}
): Promise<vscode.TextDocument | undefined> {
  // 1. Uri passed explicitly
  if (uri) {
    try {
      const doc = await vscode.workspace.openTextDocument(uri);
      if (isGuitarDslDocument(doc)) {
        return doc;
      }
    } catch {
      if (options.explicitUriOnly) return undefined;
    }
  }

  if (options.explicitUriOnly) return undefined;

  // 2. Active text editor document
  const activeDoc = vscode.window.activeTextEditor?.document;
  if (isGuitarDslDocument(activeDoc)) {
    return activeDoc;
  }

  // 3. Visible text editors
  for (const editor of vscode.window.visibleTextEditors) {
    if (isGuitarDslDocument(editor.document)) {
      return editor.document;
    }
  }

  // 4. Last active guitar DSL document (if still open)
  if (lastDoc && !lastDoc.isClosed && isGuitarDslDocument(lastDoc)) {
    return lastDoc;
  }

  // 5. Any open text document in workspace
  for (const doc of vscode.workspace.textDocuments) {
    if (!doc.isClosed && isGuitarDslDocument(doc)) {
      return doc;
    }
  }

  return undefined;
}
