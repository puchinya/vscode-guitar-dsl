import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { deleteRetiredGeminiApiKeyBestEffort } from '../../src/retiredGeminiSecret';

describe('lazyLoading - heavy dependencies isolation', () => {
  it('keeps PDF and local Audio MIR controllers out of the extension entry bundle', () => {
    const extensionSrc = fs.readFileSync(path.resolve(__dirname, '../../src/extension.ts'), 'utf-8');
    assert.strictEqual(/from\s+['"]\.\/pdf['"]/.test(extensionSrc), false, 'PDF remains lazy loaded');
    assert.strictEqual(/from\s+['"]\.\/audioMir\/controller['"]/.test(extensionSrc), false, 'Audio MIR remains lazy loaded');
    assert.ok(extensionSrc.includes("import('./audioMir/controller')"), 'the WAV controller loads on first command use');
  });

  it('wires activation to the retired-secret cleanup exactly once', () => {
    const extensionSrc = fs.readFileSync(path.resolve(__dirname, '../../src/extension.ts'), 'utf-8');
    const calls = extensionSrc.match(/deleteRetiredGeminiApiKeyBestEffort\(context\.secrets\)/g) ?? [];
    assert.strictEqual(calls.length, 1, 'activation delegates cleanup exactly once');
    assert.doesNotMatch(extensionSrc, /guitardsl\.geminiApiKey/,
      'activation does not inspect the retired key or its value');
  });

  it('deletes the retired key when it exists and safely accepts an absent key', async () => {
    for (const result of [true, false]) {
      const calls: string[] = [];
      deleteRetiredGeminiApiKeyBestEffort({
        delete: async key => {
          calls.push(key);
          return result;
        }
      });
      await new Promise<void>(resolve => setImmediate(resolve));
      assert.deepStrictEqual(calls, ['guitardsl.geminiApiKey'],
        `SecretStorage.delete is called once when its result is ${result}`);
    }
  });

  it('swallows a synchronous SecretStorage.delete exception', () => {
    const calls: string[] = [];
    assert.doesNotThrow(() => deleteRetiredGeminiApiKeyBestEffort({
      delete: key => {
        calls.push(key);
        throw new Error('mock storage failure');
      }
    }));
    assert.deepStrictEqual(calls, ['guitardsl.geminiApiKey']);
  });

  it('handles a rejected SecretStorage.delete promise without an unhandled rejection', async () => {
    const calls: string[] = [];
    const unhandled: unknown[] = [];
    const captureUnhandled = (reason: unknown): void => { unhandled.push(reason); };
    process.on('unhandledRejection', captureUnhandled);
    try {
      deleteRetiredGeminiApiKeyBestEffort({
        delete: key => {
          calls.push(key);
          return Promise.reject(new Error('mock rejected deletion'));
        }
      });
      await new Promise<void>(resolve => setImmediate(resolve));
      assert.deepStrictEqual(calls, ['guitardsl.geminiApiKey']);
      assert.deepStrictEqual(unhandled, [], 'the rejection is consumed without logging its contents');
    } finally {
      process.off('unhandledRejection', captureUnhandled);
    }
  });
});
