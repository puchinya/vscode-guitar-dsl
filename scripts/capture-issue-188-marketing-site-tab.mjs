import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const distRoot = resolve(repoRoot, 'marketing/dist');
const outputPath = resolve(repoRoot, 'docs/status/evidence/issue-188/marketing-site/marketing-site-review-ja-tab-1600x900-2026-11-23.png');
const mimeTypes = { '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.svg': 'image/svg+xml', '.webp': 'image/webp' };

const server = createServer(async (request, response) => {
  const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://127.0.0.1').pathname);
  const relative = pathname === '/' ? 'index.html' : pathname === '/en/' ? 'en/index.html' : pathname.replace(/^\//u, '');
  const filePath = resolve(distRoot, relative);
  if (filePath !== distRoot && !filePath.startsWith(`${distRoot}${sep}`)) {
    response.writeHead(404).end();
    return;
  }
  try {
    const body = await readFile(filePath);
    response.writeHead(200, { 'Content-Type': mimeTypes[extname(filePath)] ?? 'application/octet-stream', 'Content-Length': body.byteLength });
    response.end(request.method === 'HEAD' ? undefined : body);
  } catch {
    response.writeHead(404).end();
  }
});

await new Promise((resolveListen, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolveListen);
});
const address = server.address();
assert.ok(address && typeof address !== 'string');
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1, locale: 'ja-JP', colorScheme: 'light' });
  await page.goto(`http://127.0.0.1:${address.port}/#guitar-tab`);
  await page.locator('#guitar-tab').scrollIntoViewIfNeeded();
  const image = page.locator('img[src="/images/solo-guitar-tab.webp"]');
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate(element => element.complete && element.naturalWidth === 1600)).toBe(true);
  await page.screenshot({ path: outputPath, fullPage: false });
  console.log(`Captured ${outputPath} from the built Japanese marketing page at 1600x900.`);
} finally {
  await browser.close();
  await new Promise((resolveClose, reject) => server.close(error => error ? reject(error) : resolveClose()));
}
