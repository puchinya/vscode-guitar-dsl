import * as assert from 'assert';
import type * as vscode from 'vscode';
import { PreviewBeginnerController } from '../../src/previewBeginner';
import { PreviewCapoController } from '../../src/previewCapo';
import {
  dispatchPreviewLegacyMessage,
  isCurrentPreviewMessageIdentity,
  parsePreviewOpenSettingsIntent,
  parsePreviewTemporarySettingsIntent
} from '../../src/previewLegacyCommands';

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
      setBarrePolicy: (_doc: vscode.TextDocument, policy: string) => calls.push(`barre:${policy}`),
      setAutoCapo: () => calls.push('beginnerAutoCapo')
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

  it('routes automatic Beginner capo selection through the existing controller', async () => {
    beginnerActive = true;
    assert.strictEqual(await dispatchPreviewLegacyMessage({ command: 'beginnerAutoCapo' }, document, dependencies()), true);
    assert.deepStrictEqual(calls, ['external:file:///compat.guitardsl', 'beginnerAutoCapo']);
  });

  it('parses only typed settings messages with an allowlisted focus target and current identity shape', () => {
    const identity = { documentUri: 'file:///song.guitardsl', documentVersion: 4, previewGeneration: 8 };
    const valid = {
      command: 'temporarySettingsChanged', action: 'capoChanged', value: { capo: 5, focusControl: 'preview-capo-select' }, ...identity
    };
    const parsed = parsePreviewTemporarySettingsIntent(valid);
    assert.ok(parsed);
    assert.strictEqual(parsed.action, 'capoChanged');
    assert.ok(isCurrentPreviewMessageIdentity(parsed, identity));
    assert.strictEqual(parsePreviewTemporarySettingsIntent({ ...valid, value: { capo: 13, focusControl: 'preview-capo-select' } }), undefined);
    assert.strictEqual(parsePreviewTemporarySettingsIntent({ ...valid, value: { capo: 5, focusControl: 'orientation-landscape' } }), undefined);
    assert.strictEqual(parsePreviewTemporarySettingsIntent({ ...valid, previewGeneration: Number.MAX_SAFE_INTEGER + 1 }), undefined);
    assert.strictEqual(isCurrentPreviewMessageIdentity(parsed, { ...identity, previewGeneration: 9 }), false);
  });

  it('parses only an allowlisted Inspector section from current Preview identity data', () => {
    const valid = {
      command: 'openScoreSettingsFromPreview', section: 'beginner',
      documentUri: 'file:///song.guitardsl', documentVersion: 4, previewGeneration: 8
    };
    assert.strictEqual(parsePreviewOpenSettingsIntent(valid)?.section, 'beginner');
    assert.strictEqual(parsePreviewOpenSettingsIntent({ ...valid, section: 'arbitrary-command' }), undefined);
  });
});
