import * as assert from 'assert';
import type * as vscode from 'vscode';
import { PreviewBeginnerController } from '../../src/previewBeginner';
import { PreviewCapoController } from '../../src/previewCapo';
import { dispatchPreviewLegacyMessage } from '../../src/previewLegacyCommands';

describe('Preview Extension Host compatibility messages', () => {
  const document = { uri: { toString: () => 'file:///compat.guitardsl' } } as vscode.TextDocument;
  let beginnerActive: boolean;
  let calls: string[];

  const dependencies = () => ({
    previewCapo: {
      setTarget: (_doc: vscode.TextDocument, capo: number) => calls.push(`capo:${capo}`)
    } as unknown as PreviewCapoController,
    previewBeginner: {
      isActive: () => beginnerActive,
      setTargetCapo: (_doc: vscode.TextDocument, capo: number) => calls.push(`beginnerCapo:${capo}`),
      clear: () => { calls.push('beginnerClear'); beginnerActive = false; },
      enable: () => { calls.push('beginnerEnable'); beginnerActive = true; },
      disable: () => { calls.push('beginnerDisable'); beginnerActive = false; },
      setBarrePolicy: (_doc: vscode.TextDocument, policy: string) => calls.push(`barre:${policy}`)
    } as unknown as PreviewBeginnerController,
    externalPreviewChanged: (uri: string) => calls.push(`external:${uri}`),
    applyCapo: async (_doc: vscode.TextDocument, capo: number) => { calls.push(`applyCapo:${capo}`); },
    applyBeginner: async () => { calls.push('applyBeginner'); },
    editCapo: async (_doc: vscode.TextDocument) => { calls.push('editCapo'); }
  });

  beforeEach(() => {
    beginnerActive = false;
    calls = [];
  });

  it('routes capo changes to the active compatibility controller and clears the competing state', async () => {
    assert.strictEqual(await dispatchPreviewLegacyMessage({ command: 'capoChanged', capo: 3 }, document, dependencies()), true);
    assert.deepStrictEqual(calls, ['external:file:///compat.guitardsl', 'beginnerClear', 'capo:3']);

    calls = [];
    beginnerActive = true;
    await dispatchPreviewLegacyMessage({ command: 'capoChanged', capo: 5 }, document, dependencies());
    assert.deepStrictEqual(calls, ['external:file:///compat.guitardsl', 'beginnerCapo:5']);
  });

  it('routes Beginner toggle, barre policy, apply, and edit messages', async () => {
    const deps = dependencies();
    await dispatchPreviewLegacyMessage({ command: 'beginnerToggled', enabled: true }, document, deps);
    await dispatchPreviewLegacyMessage({ command: 'barrePolicyChanged', policy: 'allow' }, document, deps);
    await dispatchPreviewLegacyMessage({ command: 'applyCapo', capo: 2 }, document, deps);
    await dispatchPreviewLegacyMessage({ command: 'editCapo' }, document, deps);
    assert.deepStrictEqual(calls, [
      'external:file:///compat.guitardsl', 'beginnerEnable',
      'external:file:///compat.guitardsl', 'barre:allow',
      'external:file:///compat.guitardsl', 'applyBeginner', 'editCapo'
    ]);

    calls = [];
    beginnerActive = false;
    await dispatchPreviewLegacyMessage({ command: 'beginnerToggled', enabled: false }, document, deps);
    await dispatchPreviewLegacyMessage({ command: 'applyCapo', capo: 4 }, document, deps);
    assert.deepStrictEqual(calls, [
      'external:file:///compat.guitardsl', 'beginnerDisable',
      'external:file:///compat.guitardsl', 'applyCapo:4'
    ]);
  });

  it('consumes known messages with invalid payloads without changing state', async () => {
    assert.strictEqual(await dispatchPreviewLegacyMessage({ command: 'barrePolicyChanged', policy: 'invalid' }, document, dependencies()), true);
    assert.strictEqual(await dispatchPreviewLegacyMessage({ command: 'beginnerToggled', enabled: 'yes' }, document, dependencies()), true);
    assert.deepStrictEqual(calls, []);
    assert.strictEqual(await dispatchPreviewLegacyMessage({ command: 'other' }, document, dependencies()), false);
  });
});
