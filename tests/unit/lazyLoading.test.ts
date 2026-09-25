import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

describe('lazyLoading - heavy dependencies isolation', () => {
  it('src/extension.ts should not contain top-level static imports for @google/genai or pdfkit', () => {
    const extensionSrc = fs.readFileSync(path.resolve(__dirname, '../../src/extension.ts'), 'utf-8');

    // Should not import from pdf or @google/genai directly at top-level
    assert.strictEqual(
      /from\s+['"]\.\/pdf['"]/.test(extensionSrc),
      false,
      'src/extension.ts must not have static import from ./pdf'
    );
    assert.strictEqual(
      /from\s+['"]@google\/genai['"]/.test(extensionSrc),
      false,
      'src/extension.ts must not have static import from @google/genai'
    );
    assert.strictEqual(
      /from\s+['"]\.\/transcription\/transcribePanel['"]/.test(extensionSrc),
      false,
      'src/extension.ts must not have static import from transcribePanel'
    );
  });

  it('src/transcription/gemini.ts should use type-only import for GoogleGenAI', () => {
    const geminiSrc = fs.readFileSync(path.resolve(__dirname, '../../src/transcription/gemini.ts'), 'utf-8');

    // import type { GoogleGenAI } from '@google/genai'; is allowed, value import is not
    assert.ok(
      /import\s+type\s+\{[^}]*GoogleGenAI[^}]*\}\s+from\s+['"]@google\/genai['"]/.test(geminiSrc),
      'src/transcription/gemini.ts must use type-only import for GoogleGenAI'
    );
    assert.strictEqual(
      /import\s+\{[^}]*GoogleGenAI[^}]*\}\s+from\s+['"]@google\/genai['"]/.test(geminiSrc),
      false,
      'src/transcription/gemini.ts must not use value import for GoogleGenAI'
    );
  });
});
