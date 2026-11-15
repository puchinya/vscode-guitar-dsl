import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('production PWA precaches offline authoring and gates updates on draft, IME, Drive, and appData safety', async ({ page }) => {
  let driveVersion = 1;
  let appDataVersion = 1;
  let driveSource = 'title: Drive saved\n';
  let appDataState = {
    schemaVersion: 1, selectedFolderId: 'folder-account-a', folderPrompt: 'completed',
    openDriveFileIds: ['drive-song'], activeDriveFileId: 'drive-song', recentDriveFileIds: ['drive-song']
  };
  let holdDrivePatch = false;
  let holdAppDataPatch = false;
  let drivePatchCount = 0;
  let startDrivePatch!: () => void;
  let releaseDrivePatch!: () => void;
  let startAppDataPatch!: () => void;
  let releaseAppDataPatch!: () => void;
  const drivePatchStarted = new Promise<void>(resolve => { startDrivePatch = resolve; });
  const appDataPatchStarted = new Promise<void>(resolve => { startAppDataPatch = resolve; });
  const drivePatchGate = new Promise<void>(resolve => { releaseDrivePatch = resolve; });
  const appDataPatchGate = new Promise<void>(resolve => { releaseAppDataPatch = resolve; });
  const apiHeaders = {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, POST, PATCH, OPTIONS',
    'access-control-allow-headers': 'Authorization, Content-Type, If-Match'
  };
  await page.addInitScript(() => {
    (window as unknown as { google: unknown }).google = {
      accounts: { oauth2: {
        initTokenClient: (options: { callback(result: { access_token: string; expires_in: number; scope: string }): void }) => ({
          requestAccessToken: () => options.callback({
            access_token: 'pwa-test-token', expires_in: 3600,
            scope: 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.appdata'
          })
        }),
        hasGrantedAllScopes: (_response: unknown, ..._scopes: string[]) => true,
        revoke: (_token: string, callback?: () => void) => callback?.()
      } }
    };
  });
  await page.addInitScript(() => {
    const originalPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args: Parameters<IDBObjectStore['put']>) {
      if (this.name === 'drafts' && localStorage.getItem('__guitardslFailDraftWrites') === 'true') {
        throw new DOMException('Simulated draft quota failure', 'QuotaExceededError');
      }
      return originalPut.apply(this, args);
    };
  });
  await page.route('https://www.googleapis.com/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const json = (value: unknown) => route.fulfill({ headers: apiHeaders, json: value });
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: apiHeaders });
    if (url.pathname === '/drive/v3/about') {
      return json({ user: { permissionId: 'account-a', emailAddress: 'account-a@example.test' } });
    }
    if (url.pathname === '/drive/v3/files' && url.searchParams.get('spaces') === 'appDataFolder') {
      return json({ files: [{ id: 'app-state-account-a', name: 'guitardsl-state-v1.json', mimeType: 'application/json',
        createdTime: '2026-01-01T00:00:00.000Z', version: String(appDataVersion), modifiedTime: `app-${appDataVersion}` }] });
    }
    if (url.pathname === '/drive/v3/files') {
      return json({ files: [{ id: 'drive-song', name: 'Drive Song.guitardsl', mimeType: 'text/plain',
        version: String(driveVersion), modifiedTime: `t${driveVersion}`, headRevisionId: `r${driveVersion}`, parents: ['folder-account-a'] }] });
    }
    if (url.pathname === '/drive/v3/files/app-state-account-a') {
      if (url.searchParams.get('alt') === 'media') return route.fulfill({ headers: apiHeaders, body: JSON.stringify(appDataState) });
      return json({ id: 'app-state-account-a', name: 'guitardsl-state-v1.json', mimeType: 'application/json',
        createdTime: '2026-01-01T00:00:00.000Z', version: String(appDataVersion), modifiedTime: `app-${appDataVersion}` });
    }
    if (url.pathname === '/drive/v3/files/folder-account-a') {
      return json({ id: 'folder-account-a', name: 'GuitarDSL', mimeType: 'application/vnd.google-apps.folder' });
    }
    if (url.pathname === '/drive/v3/files/drive-song') {
      if (url.searchParams.get('alt') === 'media') return route.fulfill({ headers: apiHeaders, body: driveSource });
      return json({ id: 'drive-song', name: 'Drive Song.guitardsl', mimeType: 'text/plain',
        version: String(driveVersion), modifiedTime: `t${driveVersion}`, headRevisionId: `r${driveVersion}`, parents: ['folder-account-a'] });
    }
    if (url.pathname === '/upload/drive/v3/files/drive-song' && request.method() === 'PATCH') {
      drivePatchCount += 1;
      if (holdDrivePatch) {
        startDrivePatch();
        await drivePatchGate;
      }
      driveSource = request.postData() ?? '';
      driveVersion += 1;
      return json({ id: 'drive-song', name: 'Drive Song.guitardsl', mimeType: 'text/plain',
        version: String(driveVersion), modifiedTime: `t${driveVersion}`, headRevisionId: `r${driveVersion}`, parents: ['folder-account-a'] });
    }
    if (url.pathname === '/upload/drive/v3/files/app-state-account-a' && request.method() === 'PATCH') {
      if (holdAppDataPatch) {
        startAppDataPatch();
        await appDataPatchGate;
      }
      appDataState = JSON.parse(request.postData() ?? '{}') as typeof appDataState;
      appDataVersion += 1;
      return json({ id: 'app-state-account-a', name: 'guitardsl-state-v1.json', mimeType: 'application/json',
        createdTime: '2026-01-01T00:00:00.000Z', version: String(appDataVersion), modifiedTime: `app-${appDataVersion}` });
    }
    return route.fulfill({ status: 404, headers: apiHeaders, json: { error: 'unhandled test Drive request' } });
  });
  await page.goto('/');
  await expect(page.getByRole('main', { name: 'GuitarDSL' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'GuitarDSL source editor' })).toBeVisible();

  const manifest = await page.evaluate(async () => {
    const response = await fetch('/manifest.webmanifest');
    return response.json() as Promise<{ id: string; start_url: string; scope: string; display: string; icons: Array<{ src: string; sizes: string }> }>;
  });
  expect(manifest).toMatchObject({ id: '/', start_url: '/', scope: '/', display: 'standalone' });
  expect(manifest.icons.map(icon => `${icon.sizes}:${icon.src}`)).toEqual(expect.arrayContaining([
    '192x192:/pwa-192x192.png', '512x512:/pwa-512x512.png', '512x512:/pwa-512x512-maskable.png'
  ]));

  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload();
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);

  const cachedUrls = await page.evaluate(async () => {
    const keys = await caches.keys();
    const entries = await Promise.all(keys.map(async key => (await caches.open(key)).keys()));
    return entries.flat().map(request => request.url);
  });
  const origin = new URL(page.url()).origin;
  expect(cachedUrls.every(url => new URL(url).origin === origin)).toBe(true);
  expect(cachedUrls.some(url => /NotoSansJP-Regular.*\.ttf$/u.test(url))).toBe(true);
  expect(cachedUrls.some(url => /NotoSansJP-Bold.*\.ttf$/u.test(url))).toBe(true);
  expect(cachedUrls.some(url => /\/assets\/src-[^/]+\.js$/u.test(new URL(url).pathname))).toBe(true);
  expect(cachedUrls.some(url => /googleapis|accounts\.google|oauth2|Authorization/iu.test(url))).toBe(false);

  const editor = page.getByRole('textbox', { name: 'GuitarDSL source editor' });
  await page.context().setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('main', { name: 'GuitarDSL' })).toBeVisible();
  await expect(page.locator('#connect-drive')).toBeDisabled();
  await expect(page.locator('#drive-connect-inline')).toBeDisabled();
  await expect(page.locator('#drive-state-label')).toHaveText('Offline');

  const newLocalDocument = page.waitForEvent('dialog').then(dialog => dialog.accept('Offline recovery.guitardsl'));
  await page.getByRole('button', { name: 'New score' }).click();
  await newLocalDocument;
  await expect(page.locator('#open-tabs [role="tab"]')).toHaveCount(2);
  const offlineSource = 'title: Offline PDF\n\n[Verse]\nAm | F | C | G |\n';
  await editor.fill(offlineSource);
  await expect(page.frameLocator('#score-frame').locator('.spread-sheet svg').first()).toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download PDF' }).click();
  const download = await downloadPromise;
  const pdfPath = await download.path();
  expect(pdfPath).toBeTruthy();
  const pdf = (await readFile(pdfPath!)).toString('latin1');
  expect(pdf.slice(0, 5)).toBe('%PDF-');
  expect(Number(pdf.match(/\/Count\s+(\d+)/u)?.[1] ?? 0)).toBeGreaterThan(0);

  await page.context().setOffline(false);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('.cm-content')).toContainText('Offline PDF');

  await page.evaluate(async () => {
    await fetch('/__test/enable-update', { method: 'POST' });
    await (await navigator.serviceWorker.ready).update();
  });
  await expect(page.locator('.pwa-update-prompt')).toBeVisible();

  const updatedSource = 'title: Offline draft after update\n\n[Verse]\nC | G | Am | F |\n';
  await page.evaluate(() => localStorage.setItem('__guitardslFailDraftWrites', 'true'));
  await editor.fill(updatedSource);
  await expect(page.locator('.cm-content')).toContainText('Offline draft after update');
  const activeWorkerBeforeGate = await page.evaluate(async () => (await navigator.serviceWorker.ready).active?.scriptURL);
  await page.getByRole('button', { name: 'Update', exact: true }).click();
  await expect(page.locator('.pwa-update-blocked')).toContainText('draft could not be saved locally');
  expect(await page.evaluate(async () => Boolean((await navigator.serviceWorker.ready).waiting))).toBe(true);
  expect(await page.evaluate(async () => (await navigator.serviceWorker.ready).active?.scriptURL)).toBe(activeWorkerBeforeGate);

  await page.evaluate(() => localStorage.removeItem('__guitardslFailDraftWrites'));
  await page.locator('.cm-editor').evaluate(element => element.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '編集中' })));
  await expect(page.locator('.pwa-update-prompt')).toContainText('undo history');
  await page.getByRole('button', { name: 'Update', exact: true }).click();
  await expect(page.locator('.pwa-update-blocked')).toContainText('composition');
  const waitingBeforeSafeUpdate = await page.evaluate(async () => Boolean((await navigator.serviceWorker.ready).waiting));
  expect(waitingBeforeSafeUpdate).toBe(true);
  expect(await page.evaluate(async () => (await navigator.serviceWorker.ready).active?.scriptURL)).toBe(activeWorkerBeforeGate);

  await page.locator('.cm-editor').evaluate(element => element.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '編集中' })));

  await page.locator('#connect-drive').click();
  await page.getByRole('menuitem', { name: 'Connect to Google Drive', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Drive Song.guitardsl' })).toBeVisible();
  await editor.fill('title: Drive update gate\n');
  holdDrivePatch = true;
  await page.locator('#save-document').click();
  await drivePatchStarted;
  await page.getByRole('button', { name: 'Update', exact: true }).click();
  await expect(page.locator('.pwa-update-blocked')).toContainText('current Google Drive operations to finish');
  expect(await page.evaluate(async () => (await navigator.serviceWorker.ready).active?.scriptURL)).toBe(activeWorkerBeforeGate);
  expect(await page.evaluate(async () => Boolean((await navigator.serviceWorker.ready).waiting))).toBe(true);
  releaseDrivePatch();
  holdDrivePatch = false;
  await expect(page.locator('#saved-state')).toHaveText('Saved to Drive');

  holdAppDataPatch = true;
  const localTab = page.locator('#open-tabs [role="tab"]').filter({ hasText: 'Offline recovery.guitardsl' });
  const driveTab = page.locator('#open-tabs [role="tab"]').filter({ hasText: 'Drive Song.guitardsl' });
  const driveDraftDuringGate = 'title: Drive draft during appData wait\n';
  await editor.fill(driveDraftDuringGate);
  await expect(page.locator('#saved-state')).toHaveText('Local draft saved');
  await localTab.click();
  await appDataPatchStarted;
  await driveTab.click();
  await expect(page.locator('.cm-content')).toContainText('Drive draft during appData wait');
  const drivePatchesBeforeGate = drivePatchCount;
  const reload = page.waitForNavigation({ waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Update', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Checking…' })).toBeDisabled();
  await expect(page.locator('.app-shell')).toHaveJSProperty('inert', true);
  const sourceBeforeRejectedInput = await page.locator('.cm-content').innerText();
  const editorAcceptedFocus = await page.locator('.cm-content').evaluate(element => {
    (element as HTMLElement).focus();
    return document.activeElement === element;
  });
  expect(editorAcceptedFocus).toBe(false);
  await page.keyboard.insertText('must stay blocked');
  expect(await page.locator('.cm-content').innerText()).toBe(sourceBeforeRejectedInput);
  await page.locator('#save-document').evaluate(element => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  expect(drivePatchCount).toBe(drivePatchesBeforeGate);
  expect(await page.evaluate(async () => (await navigator.serviceWorker.ready).active?.scriptURL)).toBe(activeWorkerBeforeGate);
  releaseAppDataPatch();
  holdAppDataPatch = false;
  await reload;
  const driveDraftPersisted = await page.evaluate(() => new Promise<boolean>(resolve => {
    const request = indexedDB.open('guitardsl-workspace');
    request.onerror = () => resolve(false);
    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction('drafts', 'readonly');
      const read = transaction.objectStore('drafts').getAll() as IDBRequest<Array<{ source: string }>>;
      read.onsuccess = () => {
        resolve(read.result.some(draft => draft.source.includes('Drive draft during appData wait')));
        db.close();
      };
      read.onerror = () => { resolve(false); db.close(); };
    };
  }));
  expect(driveDraftPersisted).toBe(true);
  expect(drivePatchCount).toBe(drivePatchesBeforeGate);
  await page.locator('#open-tabs').getByRole('tab', { name: 'Offline recovery.guitardsl' }).click();
  await expect(page.locator('.cm-content')).toContainText('Offline draft after update');
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
});
