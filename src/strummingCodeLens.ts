// CodeLens and command provider for applying strumming and arpeggio patterns.
import * as vscode from 'vscode';
import { SupportedLocale } from './i18n';
import { STRUMMING_PATTERN_PRESETS, StrummingPatternPreset, replaceRhythmInDsl } from './strummingPatterns';

export const APPLY_STRUMMING_PATTERN_COMMAND = 'guitardsl.applyStrummingPattern';

export class StrummingCodeLensProvider implements vscode.CodeLensProvider {
  private readonly isJa: boolean;

  constructor(locale: SupportedLocale) {
    this.isJa = locale === 'ja';
  }

  public provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    const codeLenses: vscode.CodeLens[] = [];
    const text = document.getText();
    const lines = text.split(/\r?\n/);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      const match = line.match(/^\[(.*)\]$/);
      if (match) {
        const sectionName = match[1].trim();
        const range = new vscode.Range(i, 0, i, lines[i].length);
        const title = this.isJa
          ? `$(symbol-event) 伴奏パターンを変更 [${sectionName}]`
          : `$(symbol-event) Change Pattern [${sectionName}]`;

        codeLenses.push(
          new vscode.CodeLens(range, {
            title,
            command: APPLY_STRUMMING_PATTERN_COMMAND,
            arguments: [document.uri, sectionName]
          })
        );
      }
    }

    return codeLenses;
  }
}

interface StrummingQuickPickItem extends vscode.QuickPickItem {
  preset: StrummingPatternPreset;
}

export async function promptAndApplyStrummingPattern(
  document: vscode.TextDocument,
  sectionName?: string,
  locale?: SupportedLocale
): Promise<void> {
  const isJa = locale === 'ja';

  // 1. If sectionName is not given, ask user whether to change entire song or specific section
  let targetSection: string | undefined = sectionName;

  if (!targetSection) {
    // Extract sections from document
    const text = document.getText();
    const lines = text.split(/\r?\n/);
    const sections: string[] = [];
    for (const line of lines) {
      const m = line.trim().match(/^\[(.*)\]$/);
      if (m && !sections.includes(m[1].trim())) {
        sections.push(m[1].trim());
      }
    }

    const scopeItems: (vscode.QuickPickItem & { scope?: string })[] = [
      {
        label: isJa ? '$(globe) 楽譜全体に適用' : '$(globe) Apply to Entire Score',
        description: isJa ? 'すべての小節の伴奏パターンを変更' : 'Change accompaniment pattern for all measures',
        scope: undefined
      },
      ...sections.map(s => ({
        label: `$(symbol-class) [${s}]`,
        description: isJa ? `このセクションのみ変更` : `Change only this section`,
        scope: s
      }))
    ];

    const chosenScope = await vscode.window.showQuickPick(scopeItems, {
      placeHolder: isJa ? '変更を適用する範囲を選択してください' : 'Select target scope for accompaniment pattern'
    });

    if (!chosenScope) return;
    targetSection = chosenScope.scope;
  }

  // 2. Select Strumming / Arpeggio pattern
  const items: StrummingQuickPickItem[] = STRUMMING_PATTERN_PRESETS.map(preset => ({
    label: `$(music) ${isJa ? preset.nameJa : preset.nameEn}`,
    description: `[${preset.pattern}]`,
    detail: isJa ? preset.descriptionJa : preset.descriptionEn,
    preset
  }));

  const targetLabel = targetSection ? `[${targetSection}]` : (isJa ? '楽譜全体' : 'Entire Score');
  const chosen = await vscode.window.showQuickPick(items, {
    placeHolder: isJa
      ? `${targetLabel} に適用する伴奏パターンを選択してください`
      : `Select accompaniment pattern to apply to ${targetLabel}`,
    matchOnDescription: true,
    matchOnDetail: true
  });

  if (!chosen) return;

  // 3. Apply edit to document
  const currentText = document.getText();
  const updatedText = replaceRhythmInDsl(currentText, chosen.preset.pattern, {
    sectionName: targetSection
  });

  if (currentText === updatedText) {
    vscode.window.showInformationMessage(
      isJa ? '変更対象の小節が見つかりませんでした。' : 'No matching measures found to update.'
    );
    return;
  }

  const edit = new vscode.WorkspaceEdit();
  const fullRange = new vscode.Range(
    document.positionAt(0),
    document.positionAt(currentText.length)
  );
  edit.replace(document.uri, fullRange, updatedText);

  const success = await vscode.workspace.applyEdit(edit);
  if (success) {
    const successMsg = isJa
      ? `${targetLabel} の伴奏パターンを「${chosen.preset.nameJa}」に変更しました。`
      : `Changed accompaniment pattern of ${targetLabel} to "${chosen.preset.nameEn}".`;
    vscode.window.showInformationMessage(successMsg);
  }
}
