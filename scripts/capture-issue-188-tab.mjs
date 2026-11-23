import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const sourcePath = resolve(repoRoot, 'marketing/examples/C_guitar_tab.guitardsl');
const outputPath = resolve(repoRoot, 'docs/status/evidence/issue-188/marketing-solo-guitar-tab-1600x900.png');
const origin = 'http://127.0.0.1:4179';

const source = await readFile(sourcePath, 'utf8');
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1, locale: 'en-US', colorScheme: 'light' });
  const page = await context.newPage();
  await page.addInitScript(() => {
    const nativeOpen = IDBFactory.prototype.open;
    IDBFactory.prototype.open = function(name, version) {
      const request = nativeOpen.call(this, name, version);
      if (name === 'guitardsl-workspace') request.addEventListener('success', () => {
        try {
          const db = request.result;
          if (!db.objectStoreNames.contains('settings')) return;
          const transaction = db.transaction('settings', 'readwrite');
          transaction.objectStore('settings').put({ key: 'web-welcome-v1', value: { suppressOnStartup: true } });
        } catch { /* The capture remains read-only when storage is unavailable. */ }
      }, { once: true });
      return request;
    };
  });
  await page.goto(origin);
  await expect(page.locator('#app')).not.toHaveAttribute('aria-busy', 'true');
  await page.evaluate(async () => {
    const { indexedDb } = await import('/src/storage/indexedDb.ts');
    const layout = await indexedDb.getValue('settings', 'web-layout-v1') ?? {};
    await indexedDb.setValue('settings', 'web-layout-v1', {
      ...layout,
      viewMode: 'split',
      splitRatio: 0.4,
      explorerOpen: false,
      inspectorOpen: false,
      problemsOpen: false
    });
  });
  await page.reload();
  await expect(page.locator('#app')).not.toHaveAttribute('aria-busy', 'true');
  await expect(page.getByRole('tab', { name: 'Untitled.guitardsl' })).toBeVisible();
  await page.getByRole('textbox', { name: 'GuitarDSL source editor' }).fill(source);
  await expect.poll(() => page.evaluate(() => window.__guitarDslReadSource?.() ?? '')).toBe(source);
  await page.keyboard.press('Escape');
  const score = page.frameLocator('#score-frame').locator('.spread-sheet svg').first();
  await expect(score).toContainText('空色の合図');
  await expect(page.getByText('Errors 0 / Warnings 0')).toBeVisible();
  await page.screenshot({ path: outputPath, fullPage: false });
  assert.equal(await page.evaluate(() => `${innerWidth}x${innerHeight}`), '1600x900');
  console.log(`Captured ${outputPath} from ${origin} with Chromium at 1600x900, English, light theme.`);
  await context.close();
} finally {
  await browser.close();
}
