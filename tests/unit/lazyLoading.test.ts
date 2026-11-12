import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

describe('lazyLoading - heavy dependencies isolation', () => {
  it('keeps PDF and local Audio MIR controllers out of the extension entry bundle', () => {
    const extensionSrc = fs.readFileSync(path.resolve(__dirname, '../../src/extension.ts'), 'utf-8');
    assert.strictEqual(/from\s+['"]\.\/pdf['"]/.test(extensionSrc), false, 'PDF remains lazy loaded');
    assert.strictEqual(/from\s+['"]\.\/audioMir\/controller['"]/.test(extensionSrc), false, 'Audio MIR remains lazy loaded');
    assert.ok(extensionSrc.includes("import('./audioMir/controller')"), 'the WAV controller loads on first command use');
  });

  it('best-effort deletes the retired Gemini secret without reading or logging it', () => {
    const extensionSrc = fs.readFileSync(path.resolve(__dirname, '../../src/extension.ts'), 'utf-8');
    const keyUses = extensionSrc.match(/context\.secrets\.[a-z]+\(['"]guitardsl\.geminiApiKey['"]\)/g) ?? [];
    assert.deepStrictEqual(keyUses, ["context.secrets.delete('guitardsl.geminiApiKey')"],
      'activation deletes the old key exactly once without reading or replacing its value');
    assert.match(extensionSrc,
      /try\s*\{\s*void Promise\.resolve\(context\.secrets\.delete\('guitardsl\.geminiApiKey'\)\)\.catch\(\(\)\s*=>\s*undefined\);\s*\}\s*catch\s*\{/,
      'both synchronous throws and rejected SecretStorage promises are ignored during activation');
  });
});
