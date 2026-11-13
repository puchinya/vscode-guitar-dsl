import { expect, test, type Page } from '@playwright/test';
import { planBeginnerTransform } from '@guitardsl/core/beginnerMode';
import { planCapoTransform } from '@guitardsl/core/capo';
import { mkdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

interface DriveSeed {
  accountId: string;
  fileId: string;
  name: string;
  source: string;
  draftSource?: string;
  version?: string;
  folderId?: string;
}

async function installDriveBrowserMock(page: Page, accountSequence: string[]): Promise<void> {
  await page.addInitScript((accounts: string[]) => {
    const tokens = [...accounts];
    (window as unknown as { google: unknown }).google = {
      accounts: {
        oauth2: {
          initTokenClient: (options: { callback: (result: { access_token: string; expires_in: number }) => void }) => ({
            requestAccessToken: () => options.callback({
              access_token: `test-token-${tokens.shift() ?? accounts.at(-1) ?? 'account-a'}`,
              expires_in: 3600
            })
          }),
          revoke: (_token: string, callback?: () => void) => callback?.()
        }
      }
    };
  }, accountSequence);
  await page.route('https://www.googleapis.com/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const headers = {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, POST, PATCH, OPTIONS',
      'access-control-allow-headers': 'Authorization, Content-Type, If-Match'
    };
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    const token = request.headers().authorization?.replace(/^Bearer test-token-/u, '');
    const accountId = token || 'account-a';
    if (url.pathname === '/drive/v3/about') {
      return route.fulfill({ headers, json: { user: { permissionId: accountId, emailAddress: `${accountId}@example.test` } } });
    }
    if (url.pathname === '/drive/v3/files') return route.fulfill({ headers, json: { files: [] } });
    if (/^\/drive\/v3\/files\/folder-[^/]+$/u.test(url.pathname)) {
      return route.fulfill({ headers, json: { id: url.pathname.split('/').at(-1), name: 'GuitarDSL', mimeType: 'application/vnd.google-apps.folder' } });
    }
    if (url.pathname.startsWith('/drive/v3/files/')) {
      const fileId = decodeURIComponent(url.pathname.split('/').at(-1) ?? '');
      if (url.searchParams.get('alt') === 'media') {
        return route.fulfill({ headers, body: `title: ${fileId}\n` });
      }
      return route.fulfill({ headers, json: {
        id: fileId, name: `${fileId}.guitardsl`, version: '1', modifiedTime: 't1', headRevisionId: 'r1', parents: [`folder-${accountId}`]
      } });
    }
    if (url.pathname.startsWith('/upload/drive/v3/files')) {
      return route.fulfill({ headers, json: {
        id: 'created-drive-copy', name: 'Song (local copy).guitardsl', version: '1', modifiedTime: 't-copy',
        headRevisionId: 'r-copy', parents: [`folder-${accountId}`]
      } });
    }
    return route.fulfill({ status: 404, headers, json: { error: 'unhandled test Drive request' } });
  });
}

async function installStatefulDriveSaveMock(
  page: Page,
  options: { holdPatch?: boolean; patchStatus?: number; readbackMismatch?: boolean } = {}
): Promise<{
  patchCalls: { fileId: string; source: string }[];
  patchStarted: Promise<void>;
  releasePatch(): void;
  get createCount(): number;
}> {
  await page.addInitScript(() => {
    (window as unknown as { google: unknown }).google = {
      accounts: { oauth2: { initTokenClient: (value: { callback(result: { access_token: string; expires_in: number }): void }) => ({
        requestAccessToken: () => value.callback({ access_token: 'test-token-account-a', expires_in: 3600 }),
        revoke: (_token: string, callback?: () => void) => callback?.()
      }) } }
    };
  });
  let remoteSource = 'title: Drive saved\n';
  let version = 1;
  let createCount = 0;
  const patchCalls: { fileId: string; source: string }[] = [];
  let startPatch!: () => void;
  const patchStarted = new Promise<void>(resolve => { startPatch = resolve; });
  let releasePatch!: () => void;
  const patchGate = new Promise<void>(resolve => { releasePatch = resolve; });
  const headers = {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, POST, PATCH, OPTIONS',
    'access-control-allow-headers': 'Authorization, Content-Type, If-Match'
  };
  await page.route('https://www.googleapis.com/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    if (url.pathname === '/drive/v3/about') {
      return route.fulfill({ headers, json: { user: { permissionId: 'account-a', emailAddress: 'account-a@example.test' } } });
    }
    if (url.pathname === '/drive/v3/files') {
      if (request.method() === 'POST') createCount += 1;
      return route.fulfill({ headers, json: { files: [] } });
    }
    if (url.pathname === '/drive/v3/files/folder-account-a') {
      return route.fulfill({ headers, json: { id: 'folder-account-a', name: 'GuitarDSL', mimeType: 'application/vnd.google-apps.folder' } });
    }
    if (url.pathname === '/drive/v3/files/drive-save') {
      const metadata = {
        id: 'drive-save', name: 'Song.guitardsl', mimeType: 'text/plain', version: String(version),
        modifiedTime: `t${version}`, headRevisionId: `r${version}`, parents: ['folder-account-a']
      };
      return url.searchParams.get('alt') === 'media'
        ? route.fulfill({ headers, body: remoteSource })
        : route.fulfill({ headers, json: metadata });
    }
    if (url.pathname.startsWith('/upload/drive/v3/files')) {
      if (request.method() === 'POST') {
        createCount += 1;
        return route.fulfill({ headers, json: { id: 'unexpected-create', name: 'copy.guitardsl', version: '1', modifiedTime: 'tc' } });
      }
      if (request.method() === 'PATCH') {
        patchCalls.push({ fileId: url.pathname.split('/').at(-1) ?? '', source: request.postData() ?? '' });
        startPatch();
        if (options.holdPatch) await patchGate;
        if (options.patchStatus) return route.fulfill({ status: options.patchStatus, headers, body: 'Drive save error' });
        if (!options.readbackMismatch) remoteSource = request.postData() ?? remoteSource;
        version += 1;
        return route.fulfill({ headers, json: {
          id: 'drive-save', name: 'Song.guitardsl', mimeType: 'text/plain', version: String(version),
          modifiedTime: `t${version}`, headRevisionId: `r${version}`, parents: ['folder-account-a']
        } });
      }
    }
    return route.fulfill({ status: 404, headers, json: { error: 'unhandled test Drive request' } });
  });
  return {
    patchCalls, patchStarted, releasePatch,
    get createCount() { return createCount; }
  };
}

async function seedDriveSessions(page: Page, documents: DriveSeed[]): Promise<void> {
  await page.evaluate(async (seeds: DriveSeed[]) => {
    const { indexedDb } = await import('/src/storage/indexedDb.ts');
    const byAccount = new Map<string, string[]>();
    for (const seed of seeds) {
      const identity = { storage: 'drive' as const, fileId: seed.fileId };
      const row = {
        identity, accountId: seed.accountId, name: seed.name, source: seed.source, revision: 0,
        createdAt: 1, updatedAt: 1, driveVersion: seed.version ?? '1',
        driveModifiedTime: 't1', driveRevisionId: 'r1', driveFolderId: seed.folderId ?? `folder-${seed.accountId}`
      };
      await indexedDb.upsertDriveDocument(row);
      if (seed.draftSource !== undefined) {
        await indexedDb.saveDraft({ identity, revision: 1, source: seed.draftSource }, seed.accountId, { revision: 0, source: seed.source });
      }
      const tabs = byAccount.get(seed.accountId) ?? [];
      tabs.push(seed.fileId);
      byAccount.set(seed.accountId, tabs);
      await indexedDb.setValue('settings', `drive-folder:${seed.accountId}`, seed.folderId ?? `folder-${seed.accountId}`);
    }
    for (const [accountId, tabs] of byAccount) {
      await indexedDb.setValue('sessions', `workspace-drive:${accountId}`, { tabs, active: tabs[0] ?? null });
    }
  }, documents);
}

async function installFakeAudio(page: Page): Promise<void> {
  await page.addInitScript(() => {
    class FakeParam {
      value = 0;
      setValueAtTime(value: number, _when?: number): void { this.value = value; }
      linearRampToValueAtTime(value: number, _when?: number): void { this.value = value; }
      cancelScheduledValues(_when?: number): void {}
    }
    class FakeGain {
      gain = new FakeParam();
      connect(_destination?: unknown): void {}
      disconnect(): void {}
    }
    class FakeOscillator {
      type = 'sine';
      frequency = new FakeParam();
      onended: (() => void) | null = null;
      constructor(private context: FakeAudioContext) {}
      connect(_destination?: unknown): void {}
      disconnect(): void {}
      start(_when?: number): void {}
      stop(when = 0): void {
        window.setTimeout(() => this.onended?.(), Math.max(0, when - this.context.currentTime) * 1000);
      }
    }
    class FakeAudioContext {
      currentTime = 0;
      state: AudioContextState = 'running';
      destination = {};
      createGain(): FakeGain { return new FakeGain(); }
      createOscillator(): FakeOscillator { return new FakeOscillator(this); }
      resume(): Promise<void> { return Promise.resolve(); }
      close(): Promise<void> { this.state = 'closed'; return Promise.resolve(); }
    }
    Object.defineProperty(window, 'AudioContext', { configurable: true, value: FakeAudioContext });
  });
}

test('opens a local-first GuitarDSL workspace', async ({ page }) => {
  if (process.env.GUITARDSL_CAPTURE_ISSUE166 === '1'
    && page.context().browser()?.browserType().name() === 'chromium') {
    await page.setViewportSize({ width: 1600, height: 1000 });
  }
  await page.goto('/');
  await expect(page.getByRole('tab', { name: 'Untitled.guitardsl' })).toBeVisible();
  await expect(page.getByRole('main', { name: 'GuitarDSL' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'GuitarDSL source editor' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Untitled.guitardsl' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Document' })).toBeVisible();
  const inspectorTabs = page.locator('.shared-inspector-tabs');
  await expect(inspectorTabs.getByRole('tab')).toHaveCount(4);
  expect(await inspectorTabs.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await expect(page.getByRole('button', { name: 'New score' })).toBeVisible();
  await expect(page.locator('#file-items').getByRole('button', { name: 'Untitled.guitardsl' })).toHaveCount(1);
  await expect(page.frameLocator('#score-frame').locator('.spread-sheet svg').first()).toBeVisible();
  if (process.env.GUITARDSL_CAPTURE_ISSUE166 === '1'
    && page.context().browser()?.browserType().name() === 'chromium') {
    await page.getByRole('textbox', { name: 'GuitarDSL source editor' }).fill('key: C\n\n[Verse]\nC | G | Am | F |\n');
    await page.getByRole('tab', { name: 'Progression' }).click();
    await expect(page.locator('#candidate-list li').first()).toBeVisible();
    const evidencePath = resolve(process.cwd(), '../docs/status/evidence/issue-166/web-spa-en-desktop.png');
    await mkdir(dirname(evidencePath), { recursive: true });
    await page.screenshot({ path: evidencePath, fullPage: false });
  }
});

test('shows syntax highlighting while keeping the native textarea as the source buffer', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('tab', { name: 'Untitled.guitardsl' })).toBeVisible();
  const editor = page.getByRole('textbox', { name: 'GuitarDSL source editor' });
  const source = 'title: Song\n\n[Verse]\nC | G | Am | F | # comment\n';
  await editor.fill(source);

  const layer = page.locator('.editor-highlight');
  await expect(layer.locator('.gds-key')).toHaveText('title');
  await expect(layer.locator('.gds-section')).toHaveText('[Verse]');
  await expect(layer.locator('.gds-chord')).toHaveText(['C', 'G', 'Am', 'F']);
  await expect(layer.locator('.gds-comment')).toHaveText('# comment');
  expect(await layer.evaluate(element => element.textContent)).toBe(source);
  await expect(editor).toHaveValue(source);

  await page.getByLabel('Theme').selectOption('light');
  await expect(page.locator('.app-shell')).toHaveAttribute('data-theme', 'light');
  const lightChordColor = await layer.locator('.gds-chord').first().evaluate(element => getComputedStyle(element).color);
  await page.getByLabel('Theme').selectOption('dark');
  await expect(page.locator('.app-shell')).toHaveAttribute('data-theme', 'dark');
  const darkChordColor = await layer.locator('.gds-chord').first().evaluate(element => getComputedStyle(element).color);
  expect(darkChordColor).not.toBe(lightChordColor);
  await editor.fill(Array.from({ length: 80 }, (_, index) => `[Verse${index}]\nC | G |\n`).join(''));
  await editor.evaluate(element => { (element as HTMLTextAreaElement).scrollTop = 200; });
  await expect.poll(() => layer.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
});

test('applies a selected progression through the shared source-preserving planner', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('tab', { name: 'Untitled.guitardsl' })).toBeVisible();
  const editor = page.getByRole('textbox', { name: 'GuitarDSL source editor' });
  await editor.fill('key: C\n\n[Verse]\nC | G | Am | F |\n');
  await page.getByRole('tab', { name: 'Progression' }).click();
  await page.getByRole('button', { name: 'Replace target measures' }).click();
  const candidate = page.locator('#candidate-list li').first();
  await expect(candidate).toBeVisible();
  const candidateLabel = await candidate.locator('.candidate-chords').textContent();
  const proposedChords = candidateLabel?.split(' — ').at(-1)?.trim();
  expect(proposedChords).toBeTruthy();
  await page.getByRole('button', { name: 'Apply candidate…' }).click();
  await expect(editor).toHaveValue(new RegExp(`\\[Verse\\][\\s\\S]*${proposedChords?.split(' | ').at(0)}`));
  await expect(editor).toHaveValue(/key: C/);
});

test('uses the shared score-settings model to apply one transposition edit', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('tab', { name: 'Untitled.guitardsl' })).toBeVisible();
  const editor = page.getByRole('textbox', { name: 'GuitarDSL source editor' });
  await editor.fill('key: C\n\n[Verse]\nC | G | Am | F |\n');
  await page.getByRole('tab', { name: 'Settings' }).click();
  await page.getByRole('tab', { name: 'Transpose' }).click();
  await page.getByRole('combobox', { name: 'Shift (semitones)' }).selectOption('2');
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Apply to DSL' }).click();
  await expect(editor).toHaveValue(/key: D/);
  await expect(editor).toHaveValue(/D \| A \| Bm \| G \|/);
});

test('applies the shared Capo section through the common settings renderer', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('tab', { name: 'Untitled.guitardsl' })).toBeVisible();
  const editor = page.getByRole('textbox', { name: 'GuitarDSL source editor' });
  const source = 'key: C\ncapo: 0\n\n[Verse]\nC | F | G | C |\n';
  await editor.fill(source);
  await page.getByRole('tab', { name: 'Settings' }).click();
  const candidate = page.locator('#settings-content .settings-candidate[data-inspector-key="2"]');
  await expect(candidate).toBeVisible();
  await candidate.click();
  await expect(page.getByRole('button', { name: 'Apply to DSL' })).toBeEnabled();

  const planned = planCapoTransform(source, 2);
  expect(planned.ok).toBe(true);
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Apply to DSL' }).click();
  await expect(editor).toHaveValue(planned.ok ? planned.text : source);
});

test('applies the shared Beginner section through the common settings renderer', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('tab', { name: 'Untitled.guitardsl' })).toBeVisible();
  const editor = page.getByRole('textbox', { name: 'GuitarDSL source editor' });
  const source = 'key: C\ncapo: 0\n\n[Verse]\nC | F |\n';
  await editor.fill(source);
  await page.getByRole('tab', { name: 'Settings' }).click();
  await page.locator('#settings-tabs [data-inspector-key="beginner"]').click();
  await expect(page.locator('#settings-content .settings-candidates')).toBeVisible();
  await expect(page.locator('#settings-content .settings-table tbody tr')).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Apply to DSL' })).toBeEnabled();

  const planned = planBeginnerTransform(source, { barrePolicy: 'forbid' });
  expect(planned.ok).toBe(true);
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Apply to DSL' }).click();
  await expect(editor).toHaveValue(planned.ok ? planned.text : source);
});

test('restores the latest local draft and commits it on Save', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('tab', { name: 'Untitled.guitardsl' })).toBeVisible();
  const editor = page.getByRole('textbox', { name: 'GuitarDSL source editor' });
  const source = 'title: Draft restored\n\ntempo: 104\n\n[Verse]\nAm | F | C | G |\n';
  await editor.fill(source);
  await expect(page.locator('#saved-state')).toHaveText('Local draft saved');
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'GuitarDSL source editor' })).toHaveValue(source);
  await expect(page.locator('#saved-state')).toHaveText('Local draft saved');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('#saved-state')).toHaveText('Saved locally');
  await expect(page.getByRole('button', { name: 'Draft restored.guitardsl' })).toHaveCount(0);
});

test('restores a Drive draft as a local draft, not as remotely saved', async ({ page }) => {
  await installDriveBrowserMock(page, ['account-a']);
  await page.goto('/');
  await seedDriveSessions(page, [{
    accountId: 'account-a', fileId: 'drive-draft', name: 'Drive draft.guitardsl',
    source: 'title: Remote saved\n', draftSource: 'title: Local draft\n'
  }]);
  await page.locator('#connect-drive').click();
  const editor = page.getByRole('textbox', { name: 'GuitarDSL source editor' });
  await expect(page.getByRole('tab', { name: 'Drive draft.guitardsl' })).toBeVisible();
  await expect(editor).toHaveValue('title: Local draft\n');
  await expect(page.locator('#saved-state')).toHaveText('Local draft saved');
  await page.reload();
  await page.locator('#connect-drive').click();
  await expect(page.getByRole('tab', { name: 'Drive draft.guitardsl' })).toBeVisible();
  await expect(editor).toHaveValue('title: Local draft\n');
  await expect(page.locator('#saved-state')).toHaveText('Local draft saved');
});

test('Drive saves keep the same file, retain edits made during a save, and do not create save copies', async ({ page }) => {
  const drive = await installStatefulDriveSaveMock(page, { holdPatch: true });
  await page.goto('/');
  await seedDriveSessions(page, [{
    accountId: 'account-a', fileId: 'drive-save', name: 'Song.guitardsl', source: 'title: Drive saved\n'
  }]);
  await page.locator('#connect-drive').click();
  await expect(page.getByRole('tab', { name: 'Song.guitardsl' })).toBeVisible();
  const editor = page.getByRole('textbox', { name: 'GuitarDSL source editor' });
  await expect(page.locator('#drive-overwrite-note')).toBeVisible();
  if (process.env.GUITARDSL_CAPTURE_ISSUE166 === '1'
    && page.context().browser()?.browserType().name() === 'chromium') {
    await page.setViewportSize({ width: 1600, height: 1000 });
    const evidencePath = resolve(process.cwd(), '../docs/status/evidence/issue-166/drive-save-warning.png');
    await mkdir(dirname(evidencePath), { recursive: true });
    await page.screenshot({ path: evidencePath, fullPage: false });
  }

  await editor.fill('title: Submitted version\n');
  await expect(page.locator('#saved-state')).toHaveText('Local draft saved');
  await page.locator('#save-document').click();
  await drive.patchStarted;
  await editor.fill('title: Newer local draft\n');
  await expect(page.locator('#saved-state')).toHaveText('Local draft saved');
  drive.releasePatch();
  await expect(editor).toHaveValue('title: Newer local draft\n');
  await expect(page.locator('#saved-state')).toHaveText('Local draft saved');

  await editor.press(process.platform === 'darwin' ? 'Meta+s' : 'Control+s');
  await expect(page.locator('#saved-state')).toHaveText('Saved to Drive');
  expect(drive.patchCalls.map(call => call.fileId)).toEqual(['drive-save', 'drive-save']);
  expect(drive.patchCalls.map(call => call.source)).toEqual(['title: Submitted version\n', 'title: Newer local draft\n']);
  expect(drive.createCount).toBe(0);
});

test('an unconfirmed Drive save keeps its draft and never sends an automatic retry', async ({ page }) => {
  const drive = await installStatefulDriveSaveMock(page, { patchStatus: 500 });
  await page.goto('/');
  await seedDriveSessions(page, [{
    accountId: 'account-a', fileId: 'drive-save', name: 'Song.guitardsl', source: 'title: Drive saved\n'
  }]);
  await page.locator('#connect-drive').click();
  await expect(page.getByRole('tab', { name: 'Song.guitardsl' })).toBeVisible();
  const editor = page.getByRole('textbox', { name: 'GuitarDSL source editor' });
  const draft = 'title: Keep this draft\n';
  await editor.fill(draft);
  await expect(page.locator('#saved-state')).toHaveText('Local draft saved');
  await page.locator('#save-document').click();
  await expect(editor).toHaveValue(draft);
  await expect(page.locator('#saved-state')).toHaveText('Local draft saved');
  await expect(page.locator('#app-message')).toContainText('no automatic retry');
  expect(drive.patchCalls).toHaveLength(1);
  expect(drive.createCount).toBe(0);
});

test('a Drive readback mismatch keeps the local draft and reports the save as unconfirmed', async ({ page }) => {
  const drive = await installStatefulDriveSaveMock(page, { readbackMismatch: true });
  await page.goto('/');
  await seedDriveSessions(page, [{
    accountId: 'account-a', fileId: 'drive-save', name: 'Song.guitardsl', source: 'title: Drive saved\n'
  }]);
  await page.locator('#connect-drive').click();
  await expect(page.getByRole('tab', { name: 'Song.guitardsl' })).toBeVisible();
  const editor = page.getByRole('textbox', { name: 'GuitarDSL source editor' });
  const draft = 'title: Keep after readback mismatch\n';
  await editor.fill(draft);
  await expect(page.locator('#saved-state')).toHaveText('Local draft saved');
  await page.locator('#save-document').click();
  await expect(editor).toHaveValue(draft);
  await expect(page.locator('#saved-state')).toHaveText('Local draft saved');
  await expect(page.locator('#app-message')).toContainText('Drive did not return the saved source');
  expect(drive.patchCalls).toHaveLength(1);
  expect(drive.createCount).toBe(0);
});

test('keeps account-scoped Drive tabs and drafts when switching accounts', async ({ page }) => {
  await installDriveBrowserMock(page, ['account-a', 'account-b', 'account-a']);
  let accountASource = 'title: Account A\n';
  let accountAVersion = '1';
  const headers = {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, POST, PATCH, OPTIONS',
    'access-control-allow-headers': 'Authorization, Content-Type, If-Match'
  };
  await page.route('**/upload/drive/v3/files/drive-a*', async route => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    accountASource = route.request().postData() ?? accountASource;
    accountAVersion = '2';
    return route.fulfill({ headers, json: {
      id: 'drive-a', name: 'Account A.guitardsl', version: accountAVersion, modifiedTime: 't2',
      headRevisionId: 'r2', parents: ['folder-account-a']
    } });
  });
  await page.route('https://www.googleapis.com/drive/v3/files/drive-a*', async route => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    const url = new URL(route.request().url());
    if (url.searchParams.get('alt') === 'media') return route.fulfill({ headers, body: accountASource });
    return route.fulfill({ headers, json: {
      id: 'drive-a', name: 'Account A.guitardsl', version: accountAVersion,
      modifiedTime: accountAVersion === '1' ? 't1' : 't2', headRevisionId: accountAVersion === '1' ? 'r1' : 'r2',
      parents: ['folder-account-a']
    } });
  });
  await page.goto('/');
  await seedDriveSessions(page, [
    { accountId: 'account-a', fileId: 'drive-a', name: 'Account A.guitardsl', source: 'title: Account A\n' },
    { accountId: 'account-b', fileId: 'drive-b', name: 'Account B.guitardsl', source: 'title: Account B\n' }
  ]);
  const connect = page.locator('#connect-drive');
  await connect.click();
  await expect(page.getByRole('tab', { name: 'Account A.guitardsl' })).toBeVisible();
  await connect.click();
  await connect.click();
  await expect(page.getByRole('tab', { name: 'Account A.guitardsl' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Account B.guitardsl' })).toBeVisible();
  await page.getByRole('tab', { name: 'Account A.guitardsl' }).click();
  const editor = page.getByRole('textbox', { name: 'GuitarDSL source editor' });
  await expect(editor).toHaveValue('title: Account A\n');
  await expect(page.locator('#save-document')).toBeDisabled();
  await editor.fill('title: Account A draft\n');
  await expect(page.locator('#saved-state')).toHaveText('Local draft saved');

  await connect.click();
  await connect.click();
  await expect(page.getByRole('tab', { name: 'Account A.guitardsl' })).toBeVisible();
  await page.getByRole('tab', { name: 'Account A.guitardsl' }).click();
  await expect(editor).toHaveValue('title: Account A draft\n');
  await expect(page.locator('#saved-state')).toHaveText('Local draft saved');
  await expect(page.locator('#save-document')).toBeEnabled();
  await page.locator('#save-document').click();
  await expect(page.locator('#saved-state')).toHaveText('Saved to Drive');
  expect(accountASource).toBe('title: Account A draft\n');
});

test('re-prompts on Drive conflict reload if the tab changes while the remote read is pending', async ({ page }) => {
  await installDriveBrowserMock(page, ['account-a']);
  let releaseMedia!: () => void;
  let markMediaStarted!: () => void;
  const mediaStarted = new Promise<void>(resolve => { markMediaStarted = resolve; });
  const mediaGate = new Promise<void>(resolve => { releaseMedia = resolve; });
  const headers = {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, POST, PATCH, OPTIONS',
    'access-control-allow-headers': 'Authorization, Content-Type, If-Match'
  };
  await page.route('**/drive/v3/files/drive-conflict*', async route => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    const url = new URL(route.request().url());
    if (url.searchParams.get('alt') === 'media') {
      markMediaStarted();
      await mediaGate;
      return route.fulfill({ headers, body: 'title: Remote latest\n' });
    }
    return route.fulfill({ headers, json: {
      id: 'drive-conflict', name: 'Conflict.guitardsl', version: '2', modifiedTime: 't2',
      headRevisionId: 'r2', parents: ['folder-account-a']
    } });
  });
  await page.goto('/');
  await seedDriveSessions(page, [{
    accountId: 'account-a', fileId: 'drive-conflict', name: 'Conflict.guitardsl', source: 'title: Base\n'
  }]);
  await page.locator('#connect-drive').click();
  const editor = page.getByRole('textbox', { name: 'GuitarDSL source editor' });
  await expect(page.getByRole('tab', { name: 'Conflict.guitardsl' })).toBeVisible();
  await editor.fill('title: Before reload\n');
  await expect(page.locator('#saved-state')).toHaveText('Local draft saved');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('button', { name: 'Reload latest' }).click();
  await mediaStarted;

  const newSource = 'title: Typed during remote reload\n';
  await editor.fill(newSource);
  await expect(page.locator('#saved-state')).toHaveText('Local draft saved');
  releaseMedia();
  await expect(editor).toHaveValue(newSource);
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();
  const stored = await page.evaluate(async () => {
    const { indexedDb } = await import('/src/storage/indexedDb.ts');
    return {
      current: await indexedDb.getDocument({ storage: 'drive', fileId: 'drive-conflict' }, 'account-a'),
      saved: await indexedDb.getSavedDocument({ storage: 'drive', fileId: 'drive-conflict' }, 'account-a')
    };
  });
  expect(stored.current?.source).toBe(newSource);
  expect(stored.saved?.source).toBe('title: Base\n');
});

test('keeps edits made during Save as upload in the original tab', async ({ page }) => {
  await installDriveBrowserMock(page, ['account-a']);
  let releaseUpload!: () => void;
  let markUploadStarted!: () => void;
  const uploadStarted = new Promise<void>(resolve => { markUploadStarted = resolve; });
  const uploadGate = new Promise<void>(resolve => { releaseUpload = resolve; });
  const headers = {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, POST, PATCH, OPTIONS',
    'access-control-allow-headers': 'Authorization, Content-Type, If-Match'
  };
  const uploadedSource = 'title: Local version\n';
  await page.route('**/drive/v3/files/drive-conflict*', async route => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    return route.fulfill({ headers, json: {
      id: 'drive-conflict', name: 'Song.guitardsl', version: '2', modifiedTime: 't2',
      headRevisionId: 'r2', parents: ['folder-account-a']
    } });
  });
  await page.route('**/upload/drive/v3/files*', async route => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    markUploadStarted();
    await uploadGate;
    return route.fulfill({ headers, json: {
      id: 'created-drive-copy', name: 'Song (local copy).guitardsl', version: '1', modifiedTime: 't-copy',
      headRevisionId: 'r-copy', parents: ['folder-account-a']
    } });
  });
  await page.route('**/drive/v3/files/created-drive-copy*', async route => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    const url = new URL(route.request().url());
    if (url.searchParams.get('alt') === 'media') return route.fulfill({ headers, body: uploadedSource });
    return route.fulfill({ headers, json: {
      id: 'created-drive-copy', name: 'Song (local copy).guitardsl', version: '1', modifiedTime: 't-copy',
      headRevisionId: 'r-copy', parents: ['folder-account-a']
    } });
  });
  await page.goto('/');
  await seedDriveSessions(page, [{
    accountId: 'account-a', fileId: 'drive-conflict', name: 'Song.guitardsl', source: 'title: Remote base\n'
  }]);
  await page.locator('#connect-drive').click();
  const editor = page.getByRole('textbox', { name: 'GuitarDSL source editor' });
  await expect(page.getByRole('tab', { name: 'Song.guitardsl' })).toBeVisible();
  await editor.fill(uploadedSource);
  await expect(page.locator('#saved-state')).toHaveText('Local draft saved');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('button', { name: 'Save local version as a new Drive file' }).click();
  await uploadStarted;

  const newerSource = 'title: Newer local changes\n';
  await editor.fill(newerSource);
  await expect(page.locator('#saved-state')).toHaveText('Local draft saved');
  releaseUpload();
  await expect(page.getByRole('tab', { name: 'Song (local copy).guitardsl' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Song.guitardsl' })).toHaveAttribute('aria-selected', 'true');
  await expect(editor).toHaveValue(newerSource);
  await expect(page.locator('#saved-state')).toHaveText('Local draft saved');
  const stored = await page.evaluate(async () => {
    const { indexedDb } = await import('/src/storage/indexedDb.ts');
    return {
      original: await indexedDb.getDocument({ storage: 'drive', fileId: 'drive-conflict' }, 'account-a'),
      copy: await indexedDb.getDocument({ storage: 'drive', fileId: 'created-drive-copy' }, 'account-a')
    };
  });
  expect(stored.original?.source).toBe(newerSource);
  expect(stored.copy?.source).toBe(uploadedSource);
});

test('finalizes a local-to-Drive move atomically only when no newer IndexedDB draft exists', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('tab', { name: 'Untitled.guitardsl' })).toBeVisible();
  const result = await page.evaluate(async () => {
    const { indexedDb } = await import('/src/storage/indexedDb.ts');
    const local = await indexedDb.createLocal('Atomic move.guitardsl', 'title: Original\n');
    const stale = { identity: local.identity, revision: 0, source: local.source };
    const latest = { identity: local.identity, revision: 1, source: 'title: Newer draft\n' };
    await indexedDb.saveDraft(latest);
    const remote = {
      identity: { storage: 'drive' as const, fileId: 'drive-atomic-move' }, accountId: 'account-atomic-move',
      name: local.name, source: stale.source, revision: 0, createdAt: local.createdAt, updatedAt: Date.now()
    };

    const staleMoveCompleted = await indexedDb.completeLocalMove(stale, local.name, remote);
    const preserved = await indexedDb.getDocument(local.identity);
    const driveCountAfterStale = (await indexedDb.listDocuments('drive', 'account-atomic-move')).length;
    const current = await indexedDb.commitLocal(latest, local.name);
    const completed = current
      ? await indexedDb.completeLocalMove(latest, local.name, { ...remote, source: latest.source })
      : false;
    const localAfterCompletion = await indexedDb.getDocument(local.identity);
    const driveDocuments = await indexedDb.listDocuments('drive', 'account-atomic-move');
    return {
      staleMoveCompleted, preservedSource: preserved?.source, driveCountAfterStale,
      completed, localAfterCompletion, driveSource: driveDocuments[0]?.source
    };
  });

  expect(result.staleMoveCompleted).toBe(false);
  expect(result.preservedSource).toBe('title: Newer draft\n');
  expect(result.driveCountAfterStale).toBe(0);
  expect(result.completed).toBe(true);
  expect(result.localAfterCompletion).toBeUndefined();
  expect(result.driveSource).toBe('title: Newer draft\n');
});

test('preserves a committed document against another tab with a stale same-revision or higher-revision snapshot', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('tab', { name: 'Untitled.guitardsl' })).toBeVisible();
  const result = await page.evaluate(async () => {
    const { indexedDb } = await import('/src/storage/indexedDb.ts');
    const local = await indexedDb.createLocal('Concurrent edits.guitardsl', 'title: Original\n');
    const base = { revision: local.revision, source: local.source };
    // Both editors have the same base. Local revision is not a CAS token.
    const writerA = { identity: local.identity, revision: 1, source: 'title: Writer A\n' };
    const writerB = { identity: local.identity, revision: 1, source: 'title: Writer B\n' };
    const firstDraft = await indexedDb.saveDraft(writerA, undefined, base);
    const staleDraft = await indexedDb.saveDraft(writerB, undefined, base);
    const committedA = await indexedDb.commitLocal(writerA, undefined, { revision: 1, source: writerA.source });
    const staleCommit = await indexedDb.commitLocal(writerB, undefined, base);
    const staleHigher = await indexedDb.saveDraft(
      { ...writerB, revision: 3 }, undefined, base
    );
    const after = await indexedDb.getDocument(local.identity);
    return { firstDraft, staleDraft, committed: !!committedA, staleCommit: !!staleCommit, staleHigher, source: after?.source };
  });
  expect(result).toEqual({
    firstDraft: true, staleDraft: false, committed: true,
    staleCommit: false, staleHigher: false, source: 'title: Writer A\n'
  });
});

test('keeps source export available when browser storage is blocked', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: undefined });
  });
  await page.goto('/');
  await expect(page.getByRole('tab', { name: 'Untitled.guitardsl' })).toBeVisible();
  const editor = page.getByRole('textbox', { name: 'GuitarDSL source editor' });
  await expect(page.locator('#saved-state')).toContainText('Local storage is unavailable');
  const source = 'title: Keep this source\n\n[Verse]\nC | G | Am | F |\n';
  await editor.fill(source);
  await expect(editor).toHaveValue(source);
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export .guitardsl' }).click();
  expect((await downloadPromise).suggestedFilename()).toBe('Untitled.guitardsl');
});

test('preserves original CRLF line endings when editing and exporting an imported score', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('tab', { name: 'Untitled.guitardsl' })).toBeVisible();
  const source = 'title: Song\r\n[Verse]\r\nC | G | Am | F |\r\n';
  await page.locator('#file-input').setInputFiles({
    name: 'Line endings.guitardsl', mimeType: 'text/plain', buffer: Buffer.from(source, 'utf8')
  });
  const editor = page.getByRole('textbox', { name: 'GuitarDSL source editor' });
  await expect(editor).toHaveValue(source.replace(/\r\n/gu, '\n'));
  await editor.fill(source.replace(/\r\n/gu, '\n').replace('Song', 'Track'));

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export .guitardsl' }).click();
  const download = await downloadPromise;
  const path = await download.path();
  expect(path).not.toBeNull();
  expect(await readFile(path!, 'utf8')).toBe('title: Track\r\n[Verse]\r\nC | G | Am | F |\r\n');
});

test('localizes the Inspector, honors its theme, and supports keyboard tabs', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('tab', { name: 'Untitled.guitardsl' })).toBeVisible();
  await page.getByLabel('Language').selectOption('ja');
  await page.getByLabel('テーマ').selectOption('dark');
  await expect(page.locator('#app')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByRole('button', { name: '新しい楽譜' })).toBeVisible();

  await page.getByRole('tab', { name: '文書' }).focus();
  await page.keyboard.press('ArrowRight');
  const variablesTab = page.getByRole('tab', { name: '変数' });
  await expect(variablesTab).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(variablesTab).toHaveAttribute('aria-selected', 'true');

  await page.getByRole('textbox', { name: 'GuitarDSL ソースエディター' }).fill('key: C\n\n[Verse]\nC | G | Am | F |\n');
  await page.getByRole('tab', { name: 'コード進行' }).click();
  const candidate = page.locator('#candidate-list li').first();
  await expect(candidate).toBeVisible();
  await expect(page.getByRole('button', { name: '試聴' })).toBeVisible();
});

test('accepts browser IME composition events in the native source editor', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('tab', { name: 'Untitled.guitardsl' })).toBeVisible();
  const editor = page.getByRole('textbox', { name: 'GuitarDSL source editor' });
  await editor.evaluate(element => {
    const input = element as HTMLTextAreaElement;
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
    input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '' }));
    input.value += '日本語';
    input.dispatchEvent(new InputEvent('input', {
      bubbles: true, data: '日本語', inputType: 'insertCompositionText', isComposing: true
    }));
    input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '日本語' }));
    input.dispatchEvent(new InputEvent('input', {
      bubbles: true, data: '日本語', inputType: 'insertText', isComposing: false
    }));
  });
  await expect(editor).toHaveValue(/日本語$/);
  await expect(page.locator('#saved-state')).toHaveText('Local draft saved');
});

test('keeps native text editing undoable', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('tab', { name: 'Untitled.guitardsl' })).toBeVisible();
  const editor = page.getByRole('textbox', { name: 'GuitarDSL source editor' });
  await expect(editor).toHaveValue(/^title: My song/m);
  const initial = await editor.inputValue();
  await editor.focus();
  await editor.press('ControlOrMeta+End');
  await editor.pressSequentially('!');
  await expect(editor).toHaveValue(`${initial}!`);
  await editor.press('ControlOrMeta+z');
  await expect(editor).toHaveValue(initial);
});

test('shows compiler diagnostics and moves the source selection to one', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('tab', { name: 'Untitled.guitardsl' })).toBeVisible();
  const editor = page.getByRole('textbox', { name: 'GuitarDSL source editor' });
  await editor.fill('time: 3/4\n\n[Verse]\nC |\n@time: 7/x\n');
  const diagnostic = page.locator('#diagnostics button').filter({ hasText: 'L5:' });
  await expect(diagnostic).toBeVisible();
  await diagnostic.click();
  const selection = await editor.evaluate(element => ({
    start: (element as HTMLTextAreaElement).selectionStart,
    end: (element as HTMLTextAreaElement).selectionEnd
  }));
  expect(selection.start).toBeGreaterThan(0);
  expect(selection.end).toBeGreaterThan(selection.start);
});

test('applies Preview edits to source and rerenders the edited score', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('tab', { name: 'Untitled.guitardsl' })).toBeVisible();
  const editor = page.getByRole('textbox', { name: 'GuitarDSL source editor' });
  const source = '[Verse]\nD | G | Am | F |\n';
  await editor.fill(source);
  const preview = page.frameLocator('#score-frame');
  const target = preview.locator('#preview-edit-target');
  await expect(target.locator('option').filter({ hasText: 'chord · D' })).toHaveCount(1);
  await expect(preview.locator('#preview-mode-select')).toBeVisible();
  const initialGeneration = await preview.locator('body').getAttribute('data-preview-generation');
  await preview.locator('#preview-mode-select').selectOption('edit');
  await expect(preview.locator('body')).toHaveAttribute('data-preview-ui-mode', 'edit');
  await expect.poll(() => preview.locator('body').getAttribute('data-preview-generation'))
    .not.toBe(initialGeneration);
  await expect(target).toBeVisible();
  const chordOption = target.locator('option').filter({ hasText: 'chord · D' });
  await expect(chordOption).toHaveCount(1);
  await target.selectOption(await chordOption.getAttribute('value') ?? '');
  await preview.locator('#preview-edit-value').fill('E');
  await preview.locator('#preview-edit-apply').click();
  await expect(preview.locator('#preview-edit-status')).toHaveText('The change was applied.');
  await expect(editor).toHaveValue('[Verse]\nE | G | Am | F |\n');
  await expect(preview.locator('#preview-edit-target option').filter({ hasText: 'chord · E' })).toHaveCount(1);
});

test('edits and renames let variables through the same shared Inspector controls and planner', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('tab', { name: 'Untitled.guitardsl' })).toBeVisible();
  const editor = page.getByRole('textbox', { name: 'GuitarDSL source editor' });
  await editor.fill('let riff = 4.d 4.d\nkey: C\n| C $riff |\n');
  await page.getByRole('tab', { name: 'Variables' }).click();
  await expect(page.locator('#variables-list button')).toHaveText('riff');
  await page.locator('#variables-operation').selectOption('rename');
  await page.locator('#variables-name').fill('pulse');
  await page.locator('#variables-apply').click();
  await expect(editor).toHaveValue('let pulse = 4.d 4.d\nkey: C\n| C $pulse |\n');

  await page.locator('#variables-operation').selectOption('add');
  await page.locator('#variables-name').fill('unused');
  await page.locator('#variables-value').fill('4.d');
  await page.locator('#variables-apply').click();
  await expect(editor).toHaveValue(/let unused = 4\.d/);
  await page.locator('#variables-list button').filter({ hasText: 'unused' }).click();
  await page.locator('#variables-operation').selectOption('deleteUnused');
  await page.locator('#variables-apply').click();
  await expect(editor).not.toHaveValue(/let unused = 4\.d/);
});

test('opens the shared chord diagram editor from a Preview diagram', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('tab', { name: 'Untitled.guitardsl' })).toBeVisible();
  const editor = page.getByRole('textbox', { name: 'GuitarDSL source editor' });
  const preview = page.frameLocator('#score-frame');
  const priorRevision = Number(await preview.locator('body').getAttribute('data-preview-document-version'));
  await editor.fill('title: Chord editor\n\n[Verse]\n| C | G |\n');
  // Wait for the new document revision rather than a stale visible Preview.
  await expect.poll(async () => Number(await preview.locator('body').getAttribute('data-preview-document-version')))
    .toBeGreaterThan(priorRevision);
  await expect(preview.locator('body')).toHaveAttribute('data-preview-interactions-ready', 'true');
  await expect(preview.locator('.chord-diagram').first()).toBeVisible();
  await preview.locator('.chord-diagram').first().click();
  const dialog = page.locator('dialog.web-chord-editor');
  await expect(dialog).toBeVisible();
  const chordFrame = page.frameLocator('dialog.web-chord-editor iframe');
  await expect(chordFrame.locator('#btn-save')).toBeVisible();
  await chordFrame.locator('#btn-save').click();
  await expect(editor).toHaveValue(/chord C\s*=/);
  await expect(dialog).toHaveCount(0);
});

test('serializes Inspector audition with Preview playback', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('tab', { name: 'Untitled.guitardsl' })).toBeVisible();
  const readyPreview = page.frameLocator('#score-frame');
  const priorRevision = Number(await readyPreview.locator('body').getAttribute('data-preview-document-version'));
  await page.getByRole('textbox', { name: 'GuitarDSL source editor' }).fill('key: C\n\n[Verse]\nC | G | Am | F |\n');
  await expect.poll(async () => Number(await readyPreview.locator('body').getAttribute('data-preview-document-version')))
    .toBeGreaterThan(priorRevision);
  await expect(readyPreview.locator('body')).toHaveAttribute('data-preview-interactions-ready', 'true');
  await page.getByRole('tab', { name: 'Progression' }).click();
  const candidate = page.locator('#candidate-list li').first();
  await expect(candidate).toBeVisible();
  await page.getByRole('button', { name: 'Audition' }).click();

  const preview = page.frameLocator('#score-frame');
  const previewBody = preview.locator('body');
  const audioStatus = page.locator('#progression-audio-status');
  // In CI a browser may lack an audio output device. In that case the lease
  // must fail closed and unlock Preview rather than hanging in "Starting".
  await expect.poll(() => audioStatus.textContent(), { timeout: 10000 })
    .toMatch(/^(Audition playing\.|Audio audition is unavailable\.)$/);
  if (await audioStatus.textContent() === 'Audition playing.') {
    await expect(previewBody).toHaveAttribute('data-progression-audio-locked', 'true');
    await expect(preview.locator('#btn-play')).toBeDisabled();
    await page.locator('#progression-stop').click();
    await expect(audioStatus).toHaveText('Audition stopped.');
  }
  await expect(previewBody).toHaveAttribute('data-progression-audio-locked', 'false');
  await expect(preview.locator('#btn-play')).toBeEnabled();
});

test('naturally ends a short Inspector audition and unlocks Preview without pressing Stop', async ({ page }) => {
  await installFakeAudio(page);
  await page.clock.install();
  await page.goto('/');
  await expect(page.getByRole('tab', { name: 'Untitled.guitardsl' })).toBeVisible();
  const preview = page.frameLocator('#score-frame');
  const initialVersion = Number(await preview.locator('body').getAttribute('data-preview-document-version'));
  await page.getByRole('textbox', { name: 'GuitarDSL source editor' }).fill('key: C\n\n[Verse]\nC | G | Am | F |\n');
  await expect.poll(async () => Number(await preview.locator('body').getAttribute('data-preview-document-version')))
    .toBeGreaterThan(initialVersion);
  await expect(preview.locator('body')).toHaveAttribute('data-preview-interactions-ready', 'true');
  await page.getByRole('tab', { name: 'Progression' }).click();
  await expect(page.locator('#candidate-list li').first()).toBeVisible();
  await page.getByRole('button', { name: 'Audition' }).click();
  const audioStatus = page.locator('#progression-audio-status');
  await expect(audioStatus).toHaveText('Audition playing.');
  await expect(preview.locator('body')).toHaveAttribute('data-progression-audio-locked', 'true');

  await page.clock.runFor(30_000);
  await expect(audioStatus).toHaveText('Audition stopped.');
  await expect(preview.locator('body')).toHaveAttribute('data-progression-audio-locked', 'false');
  await expect(preview.locator('#btn-play')).toBeEnabled();
});

test('keeps separate local documents in tabs and supports file export', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('tab', { name: 'Untitled.guitardsl' })).toBeVisible();
  page.once('dialog', dialog => dialog.accept('Second.guitardsl'));
  await page.getByRole('button', { name: 'New score' }).click();
  await expect(page.getByRole('tab', { name: 'Second.guitardsl' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Untitled.guitardsl' })).toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export .guitardsl' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('Second.guitardsl');
});

test('downloads a PDF from the shared score SVG renderer', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('tab', { name: 'Untitled.guitardsl' })).toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download PDF' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('Untitled.pdf');
});

test('preserves a pending Preview edit when changing modes', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('tab', { name: 'Untitled.guitardsl' })).toBeVisible();
  const preview = page.frameLocator('#score-frame');
  const initialGeneration = await preview.locator('body').getAttribute('data-preview-generation');
  await preview.locator('#preview-mode-select').selectOption('edit');
  await expect.poll(() => preview.locator('body').getAttribute('data-preview-generation'))
    .not.toBe(initialGeneration);
  await preview.locator('#preview-edit-target').selectOption({ index: 0 });
  const editValue = preview.locator('#preview-edit-value');
  await expect(editValue).toBeEnabled();
  const pendingValue = `${await editValue.inputValue()}m`;
  await editValue.fill(pendingValue);
  await preview.locator('#preview-mode-select').selectOption('normal');
  await expect(preview.locator('#preview-edit-status')).toHaveText('Apply the pending Preview edit before changing modes.');
  await expect(editValue).toHaveValue(pendingValue);
  await expect(preview.locator('#preview-mode-select')).toHaveValue('edit');
});

test('keeps a narrow workspace usable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('tab', { name: 'Untitled.guitardsl' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'GuitarDSL source editor' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Download PDF' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.getByRole('button', { name: 'Score', exact: true }).click();
  await expect(page.locator('#source-pane')).toBeHidden();
  await expect(page.frameLocator('#score-frame').locator('.spread-sheet svg').first()).toBeVisible();
});
