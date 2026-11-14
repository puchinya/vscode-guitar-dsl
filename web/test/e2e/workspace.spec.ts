import { expect, test, type Page } from '@playwright/test';
import { planBeginnerTransform } from '@guitardsl/core/beginnerMode';
import { planCapoTransform } from '@guitardsl/core/capo';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
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

async function readEditorSource(page: Page): Promise<string> {
  return page.evaluate(() => (window as Window & { __guitarDslReadSource?: () => string }).__guitarDslReadSource?.() ?? '');
}

async function expectEditorSource(page: Page, expected: string | RegExp): Promise<void> {
  if (typeof expected === 'string') await expect.poll(() => readEditorSource(page)).toBe(expected);
  else await expect.poll(() => readEditorSource(page)).toMatch(expected);
}

async function performAccountAction(page: Page): Promise<void> {
  const control = page.locator('#connect-drive');
  const action = (await control.textContent())?.trim();
  if (!action) throw new Error('Google Account control did not expose its current action.');
  await control.click();
  await page.getByRole('menuitem', { name: action, exact: true }).click();
  await expect(control).toHaveText(action === 'Disconnect' ? 'Connect Drive' : 'Disconnect');
}

interface DriveBrowserMockOptions {
  pickerSelection?: { id: string; name: string };
  holdPickerSelection?: boolean;
  holdFileReadId?: string;
  remoteFiles?: Record<string, { name: string; source: string; version: string }>;
  unauthorizedList?: boolean;
}

async function installDriveBrowserMock(page: Page, accountSequence: string[], options: DriveBrowserMockOptions = {}): Promise<{
  patchCalls: { fileId: string; source: string }[];
  mediaAccountIds: string[];
  fileReadStarted: Promise<void>;
  releaseFileRead(): void;
  get fileReadCount(): number;
}> {
  await page.addInitScript((config: {
    accounts: string[]; pickerSelection?: { id: string; name: string }; holdPickerSelection?: boolean;
  }) => {
    const tokens = [...config.accounts];
    const google: Record<string, unknown> = {
      accounts: {
        oauth2: {
          initTokenClient: (tokenOptions: { callback: (result: { access_token: string; expires_in: number }) => void }) => ({
            requestAccessToken: () => tokenOptions.callback({
              access_token: `test-token-${tokens.shift() ?? config.accounts.at(-1) ?? 'account-a'}`,
              expires_in: 3600
            })
          }),
          revoke: (_token: string, callback?: () => void) => callback?.()
        }
      }
    };
    if (config.pickerSelection) {
      const actionKey = 'action';
      const documentsKey = 'documents';
      class DocsView {
        constructor(_view?: string) {}
        setIncludeFolders(_value: boolean): void {}
        setSelectFolderEnabled(_value: boolean): void {}
        setMimeTypes(_value: string): void {}
      }
      class PickerBuilder {
        private callback?: (data: Record<string, unknown>) => void;
        addView(_view: unknown): this { return this; }
        setDeveloperKey(_value: string): this { return this; }
        setAppId(_value: string): this { return this; }
        setOAuthToken(_value: string): this { return this; }
        setOrigin(_value: string): this { return this; }
        enableFeature(_value: string): this { return this; }
        setCallback(callback: (data: Record<string, unknown>) => void): this { this.callback = callback; return this; }
        build(): { setVisible(value: boolean): void } {
          const callback = this.callback;
          return { setVisible: visible => {
            if (!visible) return;
            const complete = () => callback?.({ [actionKey]: 'picked', [documentsKey]: [config.pickerSelection] });
            const target = window as unknown as { __pickerOpened?: boolean; __releasePickerSelection?: () => void };
            target.__pickerOpened = true;
            if (config.holdPickerSelection) target.__releasePickerSelection = complete;
            else complete();
          } };
        }
      }
      google.picker = {
        ViewId: { FOLDERS: 'folders', DOCS: 'docs' }, DocsView,
        Feature: { NAV_HIDDEN: 'nav-hidden', MULTISELECT_ENABLED: 'multi-select' },
        Action: { PICKED: 'picked', CANCEL: 'cancel' },
        Response: { ACTION: actionKey, DOCUMENTS: documentsKey }, PickerBuilder
      };
      (window as unknown as { gapi: unknown }).gapi = { load: (_name: string, callbacks: { callback(): void }) => callbacks.callback() };
    }
    (window as unknown as { google: unknown }).google = google;
  }, {
    accounts: accountSequence, pickerSelection: options.pickerSelection,
    holdPickerSelection: options.holdPickerSelection
  });
  const patchCalls: { fileId: string; source: string }[] = [];
  const mediaAccountIds: string[] = [];
  let startFileRead!: () => void;
  const fileReadStarted = new Promise<void>(resolve => { startFileRead = resolve; });
  let releaseFileRead!: () => void;
  const fileReadGate = new Promise<void>(resolve => { releaseFileRead = resolve; });
  let fileReadCount = 0;
  let heldFileRead = false;
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
    if (url.pathname === '/drive/v3/files') {
      if (options.unauthorizedList) return route.fulfill({ status: 401, headers, json: { error: 'expired test token' } });
      return route.fulfill({ headers, json: { files: [] } });
    }
    if (/^\/drive\/v3\/files\/folder-[^/]+$/u.test(url.pathname)) {
      return route.fulfill({ headers, json: { id: url.pathname.split('/').at(-1), name: 'GuitarDSL', mimeType: 'application/vnd.google-apps.folder' } });
    }
    if (url.pathname.startsWith('/drive/v3/files/')) {
      const fileId = decodeURIComponent(url.pathname.split('/').at(-1) ?? '');
      const remote = options.remoteFiles?.[fileId];
      const version = remote?.version ?? '1';
      if (url.searchParams.get('alt') !== 'media') {
        fileReadCount += 1;
        if (fileId === options.holdFileReadId && !heldFileRead) {
          heldFileRead = true;
          startFileRead();
          await fileReadGate;
        }
      }
      if (url.searchParams.get('alt') === 'media') {
        mediaAccountIds.push(accountId);
        return route.fulfill({ headers, body: remote?.source ?? `title: ${fileId}\n` });
      }
      return route.fulfill({ headers, json: {
        id: fileId, name: remote?.name ?? `${fileId}.guitardsl`, version, modifiedTime: `t${version}`, headRevisionId: `r${version}`, parents: [`folder-${accountId}`]
      } });
    }
    if (url.pathname.startsWith('/upload/drive/v3/files')) {
      if (request.method() === 'PATCH') {
        patchCalls.push({ fileId: url.pathname.split('/').at(-1) ?? '', source: request.postData() ?? '' });
      }
      return route.fulfill({ headers, json: {
        id: 'created-drive-copy', name: 'Song (local copy).guitardsl', version: '1', modifiedTime: 't-copy',
        headRevisionId: 'r-copy', parents: [`folder-${accountId}`]
      } });
    }
    return route.fulfill({ status: 404, headers, json: { error: 'unhandled test Drive request' } });
  });
  return { patchCalls, mediaAccountIds, fileReadStarted, releaseFileRead, get fileReadCount() { return fileReadCount; } };
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

async function holdDraftSave(page: Page, fail = false): Promise<void> {
  await page.evaluate(async (shouldFail: boolean) => {
    const { indexedDb } = await import('/src/storage/indexedDb.ts');
    const original = indexedDb.saveDraft.bind(indexedDb);
    const target = window as unknown as { __draftSaveStarted?: boolean; __releaseDraftSave?: () => void };
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    target.__releaseDraftSave = release;
    indexedDb.saveDraft = async (...args) => {
      target.__draftSaveStarted = true;
      if (shouldFail) throw new DOMException('Injected quota failure', 'QuotaExceededError');
      await gate;
      return original(...args);
    };
  }, fail);
}

async function attemptReloadAndAcceptBeforeUnload(page: Page): Promise<string> {
  const dialogPromise = page.waitForEvent('dialog');
  const reloadPromise = page.reload({ waitUntil: 'domcontentloaded' }).catch(() => null);
  const dialog = await dialogPromise;
  const type = dialog.type();
  await dialog.accept();
  await reloadPromise;
  return type;
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
  if (process.env.GUITARDSL_CAPTURE_ISSUE172 === '1'
    && page.context().browser()?.browserType().name() === 'chromium') {
    const evidenceDir = resolve(process.cwd(), '../docs/status/evidence/issue-172');
    await mkdir(evidenceDir, { recursive: true });
    await page.setViewportSize({ width: 1600, height: 900 });
    const layouts: Record<string, unknown> = {};
    const capture = async (name: string): Promise<void> => {
      await page.screenshot({ path: resolve(evidenceDir, name), fullPage: false });
      layouts[name] = await page.evaluate(() => {
        const selectors = {
          header: '.topbar', accountAction: '#connect-drive', helpAction: '#help-button', settingsAction: '#settings-button',
          activityBar: '.activity-bar', explorer: '.file-list', explorerSplitter: '#explorer-splitter',
          localRoot: '[data-storage-section="local"] .storage-root-row', localRootLabel: '#storage-local',
          localActions: '#file-actions', localFile: '#file-items .file-item',
          driveRoot: '[data-storage-section="drive"] .storage-root-row', driveRootLabel: '#storage-drive',
          driveActions: '#drive-file-actions', driveFile: '#drive-file-items .file-item',
          tabs: '.tabs', tabViewControls: '.view-mode-controls', viewSource: '#view-source',
          viewSplit: '#view-split', viewScore: '#view-score', source: '#source-pane', centerSplitter: '#center-splitter', score: '#score-pane',
          inspectorSplitter: '#inspector-splitter', inspector: '.inspector', problemsSplitter: '#problems-splitter',
          problems: '#problems-panel', toolWindowBar: '.tool-window-bar', status: '.statusbar'
        };
        const rects = Object.fromEntries(Object.entries(selectors).map(([name, selector]) => {
          const element = document.querySelector(selector);
          if (!element) return [name, null];
          const { x, y, width, height } = element.getBoundingClientRect();
          return [name, Object.fromEntries(Object.entries({ x, y, width, height }).map(([key, value]) => [key, Math.round(value * 100) / 100]))];
        }));
        const problemsColumns = Array.from(document.querySelector('.problem-row')?.children ?? []).map(element => {
          const { x, y, width, height } = element.getBoundingClientRect();
          return { className: (element as HTMLElement).className, x, y, width, height };
        });
        const topActions = ['#save-document', '#download-pdf', '#connect-drive', '#help-button', '#settings-button'].map(selector => {
          const element = document.querySelector(selector)!;
          const { x, y, width, height } = element.getBoundingClientRect();
          return { id: element.id, x, y, width, height };
        });
        const fileEntries = (selector: string) => Array.from(document.querySelectorAll<HTMLElement>(selector)).map(element => {
          const { x, y, width, height } = element.getBoundingClientRect();
          return { name: element.textContent?.trim(), x, y, width, height };
        });
        const splitters = Array.from(document.querySelectorAll<HTMLElement>('[role="separator"]')).map(element => ({
          name: element.getAttribute('aria-label'), orientation: element.getAttribute('aria-orientation'),
          min: element.getAttribute('aria-valuemin'), max: element.getAttribute('aria-valuemax'), now: element.getAttribute('aria-valuenow')
        }));
        const modes = Array.from(document.querySelectorAll<HTMLButtonElement>('.view-mode-button')).map(button => ({
          label: button.getAttribute('aria-label'), pressed: button.getAttribute('aria-pressed')
        }));
        const menu = document.querySelector<HTMLElement>('#context-menu:not([hidden]), #settings-menu:not([hidden])');
        const menuItems = menu ? Array.from(menu.querySelectorAll<HTMLButtonElement>('button')).map(button => ({
          label: button.textContent, disabled: button.disabled,
          rect: (() => { const { x, y, width, height } = button.getBoundingClientRect(); return { x, y, width, height }; })()
        })) : [];
        return { viewport: { width: innerWidth, height: innerHeight }, rects, problemsColumns, topActions,
          localFileEntries: fileEntries('#file-items .file-item'), driveFileEntries: fileEntries('#drive-file-items .file-item'),
          splitters, modes, menu: menu ? (() => { const { x, y, width, height } = menu.getBoundingClientRect(); return { x, y, width, height }; })() : null,
          menuItems,
          horizontalOverflow: document.documentElement.scrollWidth > innerWidth };
      });
    };
    const chooseSetting = async (locale: 'en' | 'ja', item: string): Promise<void> => {
      await page.getByRole('button', { name: locale === 'ja' ? '設定' : 'Settings' }).click();
      await page.getByRole('menuitemradio', { name: item }).click();
    };
    for (const locale of ['en', 'ja'] as const) {
      if (locale === 'ja') await chooseSetting('en', 'Language: 日本語');
      for (const theme of ['light', 'dark'] as const) {
        const setting = locale === 'ja' ? `テーマ: ${theme === 'light' ? 'ライト' : 'ダーク'}` : `Theme: ${theme === 'light' ? 'Light' : 'Dark'}`;
        await chooseSetting(locale, setting);
        await expect(page.locator('.app-shell')).toHaveAttribute('data-theme', theme);
        await capture(`desktop-1600x900-${locale}-${theme}.png`);
      }
    }
    await page.setViewportSize({ width: 1280, height: 800 });
    await capture('desktop-1280x800-ja-dark.png');

    await page.getByRole('button', { name: '設定' }).click();
    await expect(page.getByRole('menu')).toBeVisible();
    await capture('menu-settings-ja.png');
    await page.keyboard.press('Escape');

    await page.locator('#storage-local').click({ button: 'right' });
    await expect(page.getByRole('menuitem', { name: '新しい楽譜' })).toBeVisible();
    await capture('menu-local-root-ja.png');
    await page.keyboard.press('Escape');

    await page.locator('#storage-drive').click({ button: 'right' });
    await expect(page.getByRole('menuitem', { name: 'Drive に接続' })).toBeVisible();
    await capture('menu-drive-root-ja.png');
    await page.keyboard.press('Escape');

    const file = page.locator('#file-items .file-item').first();
    await expect(file).toBeVisible();
    await file.click({ button: 'right' });
    await expect(page.getByRole('menu')).toBeVisible();
    await capture('menu-explorer-ja.png');
    await page.keyboard.press('Escape');

    await page.getByRole('tab', { name: 'Untitled.guitardsl' }).click({ button: 'right' });
    await expect(page.getByRole('menuitem', { name: 'このタブを開く' })).toBeVisible();
    await capture('menu-tab-ja.png');
    await page.keyboard.press('Escape');

    const editorName = 'GuitarDSL ソースエディター';
    await page.getByRole('textbox', { name: editorName }).fill('time: 3/4\n\n[Verse]\nC |\n@time: 7/x\n');
    const problem = page.locator('#diagnostics .problem-row').first();
    await expect(problem).toBeVisible();
    await capture('problems-ja.png');
    await problem.click({ button: 'right' });
    await expect(page.getByRole('menu')).toBeVisible();
    await capture('menu-problems-ja.png');
    await page.keyboard.press('Escape');

    const score = page.frameLocator('#score-frame').locator('.spread-sheet svg').first();
    await score.click({ button: 'right' });
    await expect(page.getByRole('menuitem', { name: 'PDF をダウンロード' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'ソース位置へ移動' })).toBeDisabled();
    await capture('menu-preview-ja.png');
    await page.keyboard.press('Escape');

    await page.getByRole('textbox', { name: editorName }).fill('title: Preview context\n\n[Verse]\nC | G | Am | F |\n');
    await expect.poll(async () => {
      const revision = await page.evaluate(() => (window as Window & {
        __guitarDslReadTabs?: () => Array<{ revision: number }>;
      }).__guitarDslReadTabs?.()[0]?.revision);
      return await page.frameLocator('#score-frame').locator('body').getAttribute('data-preview-document-version') === String(revision);
    }).toBe(true);
    const bound = page.frameLocator('#score-frame').locator('.spread-sheet [data-visual-binding]').first();
    await expect(bound).toBeVisible();
    await bound.click({ button: 'right' });
    await expect(page.getByRole('menuitem', { name: 'ソース位置へ移動' })).toBeEnabled();
    await capture('menu-preview-binding-ja.png');
    await page.keyboard.press('Escape');

    await page.getByRole('button', { name: 'ソース表示' }).click();
    await capture('source-only-ja-dark.png');
    await page.getByRole('button', { name: '譜面表示' }).click();
    await capture('score-only-ja-dark.png');
    await writeFile(resolve(evidenceDir, 'layout-domrect.json'), `${JSON.stringify(layouts, null, 2)}\n`, 'utf8');
  }
});

test('uses CodeMirror for source editing and GuitarDSL syntax highlighting', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('tab', { name: 'Untitled.guitardsl' })).toBeVisible();
  const editor = page.getByRole('textbox', { name: 'GuitarDSL source editor' });
  const source = 'title: Song\n\n[Verse]\nC | G | Am | F | # comment\n';
  await editor.fill(source);

  const layer = page.locator('.cm-content');
  await expect(layer.locator('.gds-key')).toHaveText('title');
  await expect(layer.locator('.gds-section')).toHaveText('[Verse]');
  await expect(layer.locator('.gds-chord')).toHaveText(['C', 'G', 'Am', 'F']);
  await expect.poll(() => layer.locator('.gds-comment').allTextContents().then(parts => parts.join(''))).toBe('# comment');
  await expectEditorSource(page, source);

  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('menuitemradio', { name: 'Theme: Light' }).click();
  await expect(page.locator('.app-shell')).toHaveAttribute('data-theme', 'light');
  const lightChordColor = await layer.locator('.gds-chord').first().evaluate(element => getComputedStyle(element).color);
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('menuitemradio', { name: 'Theme: Dark' }).click();
  await expect(page.locator('.app-shell')).toHaveAttribute('data-theme', 'dark');
  const darkChordColor = await layer.locator('.gds-chord').first().evaluate(element => getComputedStyle(element).color);
  expect(darkChordColor).not.toBe(lightChordColor);
  await editor.fill(Array.from({ length: 80 }, (_, index) => `[Verse${index}]\nC | G |\n`).join(''));
  await page.locator('.cm-scroller').evaluate(element => { element.scrollTop = 200; });
  await expect.poll(() => page.locator('.cm-scroller').evaluate(element => element.scrollTop)).toBeGreaterThan(0);
});

test('supports line numbers, search and replace, deterministic completion, and compiler lint', async ({ page }) => {
  await page.goto('/');
  const editor = page.getByRole('textbox', { name: 'GuitarDSL source editor' });
  const source = 'let riff = e4/8 g a g\n\ntitle: Song\n\n[Verse]\nC | G | Am | F |\n';
  await editor.fill(source);
  await expect(page.locator('.cm-lineNumbers .cm-gutterElement:visible').first()).toBeVisible();

  await editor.press('ControlOrMeta+f');
  const find = page.getByRole('textbox', { name: 'Find' });
  const replace = page.getByRole('textbox', { name: 'Replace' });
  await expect(find).toBeVisible();
  await find.fill('Song');
  await replace.fill('Track');
  await page.locator('.cm-search button[name="replaceAll"]').click();
  await expectEditorSource(page, source.replace('Song', 'Track'));
  await editor.press('ControlOrMeta+z');
  await expectEditorSource(page, source);
  await editor.press('ControlOrMeta+Shift+z');
  await expectEditorSource(page, source.replace('Song', 'Track'));
  await page.keyboard.press('Escape');

  await editor.fill('let riff = C | G |\n\n');
  await editor.press('ControlOrMeta+End');
  await editor.pressSequentially('$');
  const completion = page.locator('.cm-tooltip-autocomplete [role="option"]').filter({ hasText: '$riff' });
  await expect(completion).toBeVisible();
  await completion.click();
  await expectEditorSource(page, 'let riff = C | G |\n\n$riff');

  await editor.fill('time: 3/4\n\n[Verse]\nC |\n@time: 7/x\n');
  await expect(page.locator('#diagnostics .problem-row').first()).toBeVisible();
  await expect(page.locator('.cm-lintRange-error').first()).toBeVisible();
});

test('renders the compact workspace geometry and preserves the Preview across view modes', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto('/');
  await expect(page.getByRole('tab', { name: 'Untitled.guitardsl' })).toBeVisible();
  const geometry = await page.evaluate(() => {
    const rect = (selector: string) => {
      const bounds = document.querySelector(selector)!.getBoundingClientRect();
      return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
    };
    return {
      header: rect('.topbar'), activity: rect('.activity-bar'), explorer: rect('.file-list'),
      explorerSplitter: rect('#explorer-splitter'), tabs: rect('.tabs'), inspector: rect('.inspector'),
      source: rect('#source-pane'), viewControls: rect('.view-mode-controls'),
      localRoot: rect('[data-storage-section="local"] .storage-root-row'),
      driveRoot: rect('[data-storage-section="drive"] .storage-root-row'),
      problems: rect('#problems-panel'), toolWindow: rect('.tool-window-bar'), status: rect('.statusbar'),
      account: rect('#connect-drive'), help: rect('#help-button'), settings: rect('#settings-button')
    };
  });
  expect(geometry.header.height).toBe(40);
  expect(geometry.activity.width).toBe(40);
  expect(geometry.explorer.width).toBe(220);
  expect(geometry.explorerSplitter.width).toBe(6);
  expect(geometry.tabs.height).toBe(36);
  expect(geometry.tabs.y).toBe(40);
  expect(geometry.source.y).toBe(76);
  expect(geometry.viewControls.y).toBe(40);
  expect(geometry.viewControls.height).toBe(35); // 36 px tab row minus the 1 px bottom border.
  expect(geometry.viewControls.x + geometry.viewControls.width).toBe(geometry.tabs.x + geometry.tabs.width);
  expect(geometry.localRoot.y).toBeLessThan(geometry.driveRoot.y);
  expect(geometry.account.x).toBeLessThan(geometry.help.x);
  expect(geometry.help.x).toBeLessThan(geometry.settings.x);
  await expect(page.locator('[data-storage-section]')).toHaveCount(2);
  await expect(page.locator('[data-storage-section="local"]')).toBeVisible();
  await expect(page.locator('[data-storage-section="drive"]')).toBeVisible();
  await expect(page.locator('.editor-workspace > .toolbar')).toHaveCount(0);
  expect(geometry.inspector.width).toBe(300);
  expect(geometry.problems.height).toBe(200);
  expect(geometry.toolWindow.width).toBe(36);
  expect(geometry.toolWindow.x).toBe(1564);
  expect(geometry.status.height).toBe(24);
  await expect(page.locator('.top-actions .web-icon')).toHaveCount(5);
  await expect(page.locator('.view-mode-button .web-icon')).toHaveCount(3);
  await expect(page.locator('#status-cursor')).toHaveText('Ln 1, Col 1');
  await expect(page.locator('#status-problems')).toContainText('Errors 0 / Warnings 0');
  await expect(page.locator('#locale-select, #theme-select')).toHaveCount(0);
  const frame = page.locator('#score-frame');
  await page.evaluate(() => {
    (window as Window & { __previewWindow?: Window | null }).__previewWindow = document.querySelector<HTMLIFrameElement>('#score-frame')!.contentWindow;
  });
  const editor = page.getByRole('textbox', { name: 'GuitarDSL source editor' });
  await editor.fill('time: 3/4\n\n[Verse]\nC |\n@time: 7/x\n');
  const problemColumns = await page.locator('.problem-row').first().evaluate(element =>
    Array.from(element.children).map(child => {
      const bounds = child.getBoundingClientRect();
      return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
    }));
  expect(problemColumns).toHaveLength(4);
  expect(problemColumns[0].x).toBeLessThan(problemColumns[1].x);
  expect(problemColumns[1].x).toBeLessThan(problemColumns[2].x);
  expect(problemColumns[2].x).toBeLessThan(problemColumns[3].x);
  await page.getByRole('button', { name: 'Source view' }).click();
  await expect(page.locator('#workspace')).toHaveClass(/view-source/);
  await expect(page.locator('#score-pane')).toBeHidden();
  await page.getByRole('button', { name: 'Score view' }).click();
  await expect(page.locator('#workspace')).toHaveClass(/view-score/);
  await page.getByRole('button', { name: 'Split view' }).click();
  await expect(page.locator('#workspace')).toHaveClass(/view-split/);
  expect(await frame.evaluate(element => (window.parent as Window & { __previewWindow?: Window | null }).__previewWindow === element.contentWindow)).toBe(true);
});

test('resizes all panes with keyboard and pointer and restores layout without editing source', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await expect(page.getByRole('tab', { name: 'Untitled.guitardsl' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'GuitarDSL source editor' })).toBeVisible();
  const initialSource = await readEditorSource(page);
  const explorer = page.getByRole('separator', { name: 'Resize Explorer' });
  await explorer.focus();
  await page.keyboard.press('ArrowRight');
  await expect(explorer).toHaveAttribute('aria-valuenow', '230');
  await page.keyboard.press('Shift+ArrowRight');
  await expect(explorer).toHaveAttribute('aria-valuenow', '280');
  await page.keyboard.press('Home');
  await expect(explorer).toHaveAttribute('aria-valuenow', '180');
  await page.keyboard.press('End');
  await expect(explorer).toHaveAttribute('aria-valuenow', '420');

  const inspector = page.getByRole('separator', { name: 'Resize Inspector' });
  await inspector.focus();
  await page.keyboard.press('ArrowLeft');
  await expect(inspector).toHaveAttribute('aria-valuenow', '310');
  const center = page.getByRole('separator', { name: 'Resize source and score panes' });
  await center.focus();
  await page.keyboard.press('ArrowRight');
  expect(Number(await center.getAttribute('aria-valuenow'))).toBeGreaterThan(40);
  const problems = page.getByRole('separator', { name: 'Resize Problems' });
  await problems.focus();
  await page.keyboard.press('ArrowUp');
  await expect(problems).toHaveAttribute('aria-valuenow', '210');

  const explorerSplitter = page.locator('#explorer-splitter');
  await explorer.dblclick();
  await expect(explorer).toHaveAttribute('aria-valuenow', '220');
  const box = await explorerSplitter.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + 2, box!.y + 10);
  await page.mouse.down();
  await page.mouse.move(box!.x + 22, box!.y + 10);
  await page.mouse.up();
  await expect(explorer).toHaveAttribute('aria-valuenow', '240');
  await page.waitForTimeout(300);
  await page.reload();
  await expect(page.getByRole('separator', { name: 'Resize Explorer' })).toHaveAttribute('aria-valuenow', '240');
  await expect(page.getByRole('separator', { name: 'Resize Inspector' })).toHaveAttribute('aria-valuenow', '310');
  await expect(page.getByRole('separator', { name: 'Resize Problems' })).toHaveAttribute('aria-valuenow', '210');
  await expectEditorSource(page, initialSource);
});

test('temporarily collapses side panels on narrow viewports without changing manual preferences', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await page.setViewportSize({ width: 500, height: 800 });
  await expect(page.locator('#workspace')).toHaveClass(/inspector-auto-hidden/);
  await expect(page.locator('#workspace')).toHaveClass(/explorer-auto-hidden/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(page.locator('#activity-explorer')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#activity-inspector')).toHaveAttribute('aria-pressed', 'true');
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(page.locator('#workspace')).not.toHaveClass(/inspector-auto-hidden/);
  await expect(page.locator('#workspace')).not.toHaveClass(/explorer-auto-hidden/);
});

test('opens Help, Settings, and host-owned context menus from workspace surfaces', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Help' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.locator('#help-toc button')).toHaveCount(5);
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Help' })).toBeFocused();

  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByRole('menu')).toBeVisible();
  await page.getByRole('menuitemradio', { name: 'Theme: Dark' }).click();
  await expect(page.locator('.app-shell')).toHaveAttribute('data-theme', 'dark');

  const file = page.locator('#file-items .file-item').first();
  await expect(file).toBeVisible();
  await file.click({ button: 'right' });
  await expect(page.getByRole('menu')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(file).toBeFocused();

  const sourceBody = page.locator('.cm-content');
  await sourceBody.click({ button: 'right' });
  await expect(page.locator('#context-menu')).toBeHidden();
  await page.locator('.cm-gutters').click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: /Line \d+/ })).toBeVisible();
  await page.keyboard.press('Escape');

  const previewScore = page.frameLocator('#score-frame').locator('.spread-sheet svg').first();
  await previewScore.click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: 'Go to source position' })).toBeDisabled();
  await expect(page.getByRole('menuitem', { name: 'Download PDF' })).toBeVisible();
});

test('shows both Explorer roots and opens root and tab menus from Shift+F10', async ({ page }) => {
  await page.goto('/');
  const localSection = page.locator('[data-storage-section="local"]');
  const driveSection = page.locator('[data-storage-section="drive"]');
  await expect(localSection).toBeVisible();
  await expect(driveSection).toBeVisible();
  await page.getByRole('button', { name: 'Collapse On this device' }).click();
  await expect(page.locator('#local-storage-content')).toBeHidden();
  await expect(driveSection).toBeVisible();
  await page.getByRole('button', { name: 'Expand On this device' }).click();
  await expect(page.locator('#local-storage-content')).toBeVisible();

  const localRoot = page.locator('#storage-local');
  await localRoot.focus();
  await page.keyboard.press('Shift+F10');
  await expect(page.getByRole('menuitem', { name: 'New score' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Import file' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(localRoot).toBeFocused();

  const driveRoot = page.locator('#storage-drive');
  await driveRoot.focus();
  await page.keyboard.press('Shift+F10');
  await expect(page.getByRole('menuitem', { name: 'Connect Drive' })).toBeEnabled();
  await page.keyboard.press('Escape');
  await expect(driveRoot).toBeFocused();

  const file = page.locator('#file-items .file-item').first();
  await file.click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: 'Export source' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Copy name' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Delete' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Move to Drive' })).toHaveCount(0);
  await page.keyboard.press('Escape');

  const tab = page.getByRole('tab', { name: 'Untitled.guitardsl' });
  await tab.focus();
  await page.keyboard.press('Shift+F10');
  await expect(page.getByRole('menuitem', { name: 'Open this tab' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Close', exact: true })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Close other tabs' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Export source' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(tab).toBeFocused();
});

test('connects and reconnects from the Google Drive root menu', async ({ page }) => {
  await installDriveBrowserMock(page, ['account-a'], {
    pickerSelection: { id: 'folder-account-a', name: 'GuitarDSL' }, unauthorizedList: true
  });
  await page.goto('/');
  const driveRoot = page.locator('#storage-drive');
  await driveRoot.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Connect Drive' }).click();
  await expect(page.locator('#drive-file-actions').getByRole('button', { name: 'Choose folder' })).toBeVisible();

  await driveRoot.click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: 'Choose folder' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Create GuitarDSL folder' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Open from Drive' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.locator('#drive-file-actions').getByRole('button', { name: 'Choose folder' }).click();
  await expect(page.locator('#drive-file-actions').getByRole('button', { name: 'Reconnect Drive' })).toBeVisible();
  await driveRoot.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Reconnect Drive' }).click();
  await expect(page.locator('#drive-file-actions').getByRole('button', { name: 'Reconnect Drive' })).toBeVisible();
});

test('exports and deletes a local file from its Explorer menu after confirmation', async ({ page }) => {
  await page.goto('/');
  const namePrompt = page.waitForEvent('dialog').then(async dialog => {
    const type = dialog.type();
    await dialog.accept('Delete me.guitardsl');
    return type;
  });
  await page.getByRole('button', { name: 'New score' }).click();
  expect(await namePrompt).toBe('prompt');
  const file = page.locator('#file-items .file-item').filter({ hasText: 'Delete me.guitardsl' });
  await expect(file).toBeVisible();

  await file.click({ button: 'right' });
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: 'Export source' }).click();
  expect((await downloadPromise).suggestedFilename()).toBe('Delete me.guitardsl');

  await file.click({ button: 'right' });
  const firstConfirmation = page.waitForEvent('dialog').then(async dialog => {
    const type = dialog.type();
    await dialog.dismiss();
    return type;
  });
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  expect(await firstConfirmation).toBe('confirm');
  await expect(file).toBeVisible();

  await file.click({ button: 'right' });
  const secondConfirmation = page.waitForEvent('dialog').then(async dialog => {
    const type = dialog.type();
    await dialog.accept();
    return type;
  });
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  expect(await secondConfirmation).toBe('confirm');
  await expect(file).toHaveCount(0);
  await expect(page.getByRole('tab', { name: 'Delete me.guitardsl' })).toHaveCount(0);
});

test('uses Preview bindings for source navigation and rejects a stale menu target', async ({ page }) => {
  await page.goto('/');
  const editor = page.getByRole('textbox', { name: 'GuitarDSL source editor' });
  await editor.fill('title: Preview menu\n\n[Verse]\nC | G | Am | F |\n');
  const preview = page.frameLocator('#score-frame');
  await expect.poll(async () => {
    const revision = await page.evaluate(() => (window as Window & {
      __guitarDslReadTabs?: () => Array<{ revision: number }>;
    }).__guitarDslReadTabs?.()[0]?.revision);
    return await preview.locator('body').getAttribute('data-preview-document-version') === String(revision);
  }).toBe(true);
  const boundElement = preview.locator('.spread-sheet [data-visual-binding]').first();
  await expect(boundElement).toBeVisible();

  await boundElement.click({ button: 'right' });
  const goToSource = page.getByRole('menuitem', { name: 'Go to source position' });
  await expect(goToSource).toBeEnabled();
  await goToSource.click();
  await expect(page.locator('#workspace')).toHaveClass(/view-source/);
  const selectedRange = await page.evaluate(() => (window as Window & {
    __guitarDslReadSelection?: () => { from: number; to: number; head: number }
  }).__guitarDslReadSelection?.());
  expect(selectedRange).toBeTruthy();
  expect(selectedRange!.to).toBeGreaterThan(selectedRange!.from);

  await page.getByRole('button', { name: 'Split view' }).click();
  await preview.locator('body').click({ button: 'right', position: { x: 2, y: 110 } });
  await expect(page.getByRole('menuitem', { name: 'Go to source position' })).toBeDisabled();
  await expect(page.getByRole('menuitem', { name: 'Download PDF' })).toBeVisible();
  await page.keyboard.press('Escape');

  await boundElement.click();
  await page.keyboard.press('Shift+F10');
  await expect(page.getByRole('menuitem', { name: 'Go to source position' })).toBeEnabled();
  const pdfDownload = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: 'Download PDF' }).click();
  expect((await pdfDownload).suggestedFilename()).toBe('Untitled.pdf');

  await boundElement.click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: 'Go to source position' })).toBeEnabled();
  const staleSelection = await page.evaluate(() => (window as Window & {
    __guitarDslReadSelection?: () => { from: number; to: number; head: number }
  }).__guitarDslReadSelection?.());
  await page.evaluate(() => {
    const testWindow = window as Window & {
      __guitarDslReadSource?: () => string;
      __guitarDslDispatchSourceEdit?: (source: string, userEvent?: string) => boolean;
    };
    const source = testWindow.__guitarDslReadSource?.() ?? '';
    testWindow.__guitarDslDispatchSourceEdit?.(source.replace('C | G', 'D | G'), 'input.replace');
    Array.from(document.querySelectorAll<HTMLButtonElement>('#context-menu button'))
      .find(button => button.textContent === 'Go to source position')?.click();
  });
  await expect(page.locator('#app-message')).toContainText('target changed');
  const selectionAfterStaleAction = await page.evaluate(() => (window as Window & {
    __guitarDslReadSelection?: () => { from: number; to: number; head: number }
  }).__guitarDslReadSelection?.());
  expect(selectionAfterStaleAction).toEqual(staleSelection);
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
  await expectEditorSource(page, new RegExp(`\\[Verse\\][\\s\\S]*${proposedChords?.split(' | ').at(0)}`));
  await expectEditorSource(page, /key: C/);
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
  await expectEditorSource(page, /key: D/);
  await expectEditorSource(page, /D \| A \| Bm \| G \|/);
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
  await expectEditorSource(page, planned.ok ? planned.text : source);
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
  await expectEditorSource(page, planned.ok ? planned.text : source);
});

test('restores the latest local draft and commits it on Save', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('tab', { name: 'Untitled.guitardsl' })).toBeVisible();
  const editor = page.getByRole('textbox', { name: 'GuitarDSL source editor' });
  const source = 'title: Draft restored\n\ntempo: 104\n\n[Verse]\nAm | F | C | G |\n';
  await editor.fill(source);
  await expect(page.locator('#saved-state')).toHaveText('Local draft saved');
  let promptedBeforeUnload = false;
  page.on('dialog', async dialog => {
    if (dialog.type() === 'beforeunload') promptedBeforeUnload = true;
    await dialog.accept();
  });
  await page.reload();
  expect(promptedBeforeUnload).toBe(false);
  await expectEditorSource(page, source);
  await expect(page.locator('#saved-state')).toHaveText('Local draft saved');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('#saved-state')).toHaveText('Saved locally');
  await expect(page.getByRole('button', { name: 'Draft restored.guitardsl' })).toHaveCount(0);
});

test('shows a browser confirmation before leaving while a local draft write is pending', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('tab', { name: 'Untitled.guitardsl' })).toBeVisible();
  await holdDraftSave(page);
  const editor = page.getByRole('textbox', { name: 'GuitarDSL source editor' });
  const source = 'title: Persist before leaving\n\n[Verse]\nAm | F |\n';
  await editor.fill(source);
  await page.waitForFunction(() => (window as unknown as { __draftSaveStarted?: boolean }).__draftSaveStarted === true);

  expect(await attemptReloadAndAcceptBeforeUnload(page)).toBe('beforeunload');
  const stayedOnPage = await page.evaluate(() => (window as unknown as { __draftSaveStarted?: boolean }).__draftSaveStarted === true);
  if (stayedOnPage) {
    await page.evaluate(() => (window as unknown as { __releaseDraftSave?: () => void }).__releaseDraftSave?.());
    await expect(page.locator('#saved-state')).toHaveText('Local draft saved');
    await page.reload();
    await expectEditorSource(page, source);
  }
});

test('warns before leaving when IndexedDB draft persistence fails', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('tab', { name: 'Untitled.guitardsl' })).toBeVisible();
  await holdDraftSave(page, true);
  const editor = page.getByRole('textbox', { name: 'GuitarDSL source editor' });
  const source = 'title: Keep after storage failure\n';
  await editor.fill(source);
  await page.waitForFunction(() => (window as unknown as { __draftSaveStarted?: boolean }).__draftSaveStarted === true);
  await expect(page.locator('#saved-state')).toHaveText('Unsaved changes');

  expect(await attemptReloadAndAcceptBeforeUnload(page)).toBe('beforeunload');
  const stayedOnPage = await page.evaluate(() => (window as unknown as { __draftSaveStarted?: boolean }).__draftSaveStarted === true);
  if (stayedOnPage) {
    await expectEditorSource(page, source);
    await expect(page.locator('#saved-state')).toHaveText('Unsaved changes');
  }
});

test('drops a Drive read that finishes after switching accounts', async ({ page }) => {
  const drive = await installDriveBrowserMock(page, ['account-a', 'account-b'], {
    pickerSelection: { id: 'account-a-private', name: 'Account A private.guitardsl' },
    holdFileReadId: 'account-a-private',
    remoteFiles: { 'account-a-private': { name: 'Account A private.guitardsl', source: 'title: Account A private source\n', version: '1' } }
  });
  await page.goto('/');
  await expect(page.getByRole('tab', { name: 'Untitled.guitardsl' })).toBeVisible();
  const initialSource = await readEditorSource(page);
  const connect = page.locator('#connect-drive');
  await performAccountAction(page);
  await expect(connect).toHaveText('Disconnect');
  await page.locator('#storage-drive').click();
  await page.getByRole('button', { name: 'Open from Drive' }).click();
  await drive.fileReadStarted;

  await performAccountAction(page);
  await expect(connect).toHaveText('Connect Drive');
  await performAccountAction(page);
  await expect(connect).toHaveText('Disconnect');
  drive.releaseFileRead();

  await expect(page.getByRole('tab', { name: 'Account A private.guitardsl' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Account A private.guitardsl' })).toHaveCount(0);
  await expectEditorSource(page, initialSource);
  expect(drive.mediaAccountIds).toEqual(['account-a']);
  const cached = await page.evaluate(async () => {
    const { indexedDb } = await import('/src/storage/indexedDb.ts');
    return {
      accountA: await indexedDb.getSavedDocument({ storage: 'drive', fileId: 'account-a-private' }, 'account-a'),
      accountADraft: await indexedDb.getDraft({ storage: 'drive', fileId: 'account-a-private' }, 'account-a'),
      accountB: await indexedDb.getSavedDocument({ storage: 'drive', fileId: 'account-a-private' }, 'account-b'),
      accountBDraft: await indexedDb.getDraft({ storage: 'drive', fileId: 'account-a-private' }, 'account-b'),
      accountBFiles: await indexedDb.listDocuments('drive', 'account-b')
    };
  });
  expect(cached.accountA).toBeUndefined();
  expect(cached.accountADraft).toBeUndefined();
  expect(cached.accountB).toBeUndefined();
  expect(cached.accountBDraft).toBeUndefined();
  expect(cached.accountBFiles).toEqual([]);
});

test('drops a Picker result returned after switching accounts without reading or caching it', async ({ page }) => {
  const drive = await installDriveBrowserMock(page, ['account-a', 'account-b'], {
    pickerSelection: { id: 'picker-account-a-private', name: 'Picker account A private.guitardsl' },
    holdPickerSelection: true
  });
  await page.goto('/');
  const connect = page.locator('#connect-drive');
  await performAccountAction(page);
  await expect(connect).toHaveText('Disconnect');
  await page.locator('#storage-drive').click();
  await page.getByRole('button', { name: 'Open from Drive' }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __pickerOpened?: boolean }).__pickerOpened)).toBe(true);

  await performAccountAction(page);
  await expect(connect).toHaveText('Connect Drive');
  await performAccountAction(page);
  await expect(connect).toHaveText('Disconnect');
  await page.evaluate(() => (window as unknown as { __releasePickerSelection?: () => void }).__releasePickerSelection?.());

  await expect(page.getByRole('tab', { name: 'Picker account A private.guitardsl' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Picker account A private.guitardsl' })).toHaveCount(0);
  await expect.poll(() => drive.fileReadCount).toBe(0);
  const cached = await page.evaluate(async () => {
    const { indexedDb } = await import('/src/storage/indexedDb.ts');
    return {
      accountA: await indexedDb.getSavedDocument({ storage: 'drive', fileId: 'picker-account-a-private' }, 'account-a'),
      accountB: await indexedDb.getSavedDocument({ storage: 'drive', fileId: 'picker-account-a-private' }, 'account-b')
    };
  });
  expect(cached.accountA).toBeUndefined();
  expect(cached.accountB).toBeUndefined();
});

test('restores a Drive draft as a local draft, not as remotely saved', async ({ page }) => {
  await installDriveBrowserMock(page, ['account-a']);
  await page.goto('/');
  await seedDriveSessions(page, [{
    accountId: 'account-a', fileId: 'drive-draft', name: 'Drive draft.guitardsl',
    source: 'title: Remote saved\n', draftSource: 'title: Local draft\n'
  }]);
  await performAccountAction(page);
  const editor = page.getByRole('textbox', { name: 'GuitarDSL source editor' });
  await expect(page.getByRole('tab', { name: 'Drive draft.guitardsl' })).toBeVisible();
  await expectEditorSource(page, 'title: Local draft\n');
  await expect(page.locator('#saved-state')).toHaveText('Local draft saved');
  await page.reload();
  await performAccountAction(page);
  await expect(page.getByRole('tab', { name: 'Drive draft.guitardsl' })).toBeVisible();
  await expectEditorSource(page, 'title: Local draft\n');
  await expect(page.locator('#saved-state')).toHaveText('Local draft saved');
});

test('Picker re-opening detects a known Drive conflict and preserves the saved baseline and draft', async ({ page }) => {
  const drive = await installDriveBrowserMock(page, ['account-a'], {
    pickerSelection: { id: 'picker-conflict', name: 'Picker conflict.guitardsl' },
    remoteFiles: { 'picker-conflict': { name: 'Picker conflict.guitardsl', source: 'title: Remote v2\n', version: '2' } }
  });
  await page.goto('/');
  await seedDriveSessions(page, [{
    accountId: 'account-a', fileId: 'picker-conflict', name: 'Picker conflict.guitardsl',
    source: 'title: Remote v1\n', draftSource: 'title: Local draft from v1\n', version: '1'
  }]);
  await page.evaluate(async () => {
    const { indexedDb } = await import('/src/storage/indexedDb.ts');
    await indexedDb.setValue('sessions', 'workspace-drive:account-a', { tabs: [], active: null });
  });
  await performAccountAction(page);
  await expect(page.locator('#connect-drive')).toHaveText('Disconnect');
  await page.locator('#storage-drive').click();
  await page.getByRole('button', { name: 'Open from Drive' }).click();

  const conflict = page.getByRole('dialog');
  await expect(conflict).toBeVisible();
  await expect(conflict.getByRole('heading', { name: 'Drive version conflict' })).toBeVisible();
  const state = await page.evaluate(async () => {
    const { indexedDb } = await import('/src/storage/indexedDb.ts');
    const identity = { storage: 'drive' as const, fileId: 'picker-conflict' };
    return {
      saved: await indexedDb.getSavedDocument(identity, 'account-a'),
      draft: await indexedDb.getDraft(identity, 'account-a')
    };
  });
  expect(state.saved?.driveVersion).toBe('1');
  expect(state.saved?.source).toBe('title: Remote v1\n');
  expect(state.draft?.source).toBe('title: Local draft from v1\n');
  expect(drive.patchCalls).toHaveLength(0);
  await conflict.getByRole('button', { name: 'Cancel' }).click();
  await expect(conflict).toHaveCount(0);
});

test('Drive saves keep the same file, retain edits made during a save, and do not create save copies', async ({ page }) => {
  const drive = await installStatefulDriveSaveMock(page, { holdPatch: true });
  await page.goto('/');
  await seedDriveSessions(page, [{
    accountId: 'account-a', fileId: 'drive-save', name: 'Song.guitardsl', source: 'title: Drive saved\n'
  }]);
  await performAccountAction(page);
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
  await expectEditorSource(page, 'title: Newer local draft\n');
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
  await performAccountAction(page);
  await expect(page.getByRole('tab', { name: 'Song.guitardsl' })).toBeVisible();
  const editor = page.getByRole('textbox', { name: 'GuitarDSL source editor' });
  const draft = 'title: Keep this draft\n';
  await editor.fill(draft);
  await expect(page.locator('#saved-state')).toHaveText('Local draft saved');
  await page.locator('#save-document').click();
  await expectEditorSource(page, draft);
  await expect(page.locator('#saved-state')).toHaveText('Local draft saved');
  await expect(page.locator('#app-message')).toContainText('no automatic retry');
  expect(drive.patchCalls).toHaveLength(1);
  expect(drive.createCount).toBe(0);
});

test('a Drive 401 keeps the draft and offers explicit reconnection without retrying the PATCH', async ({ page }) => {
  const drive = await installStatefulDriveSaveMock(page, { patchStatus: 401 });
  await page.goto('/');
  await seedDriveSessions(page, [{
    accountId: 'account-a', fileId: 'drive-save', name: 'Song.guitardsl', source: 'title: Drive saved\n'
  }]);
  await performAccountAction(page);
  await expect(page.getByRole('tab', { name: 'Song.guitardsl' })).toBeVisible();
  const editor = page.getByRole('textbox', { name: 'GuitarDSL source editor' });
  const draft = 'title: Preserve after unauthorized save\n';
  await editor.fill(draft);
  await page.locator('#save-document').click();

  await expect(page.locator('#saved-state')).toHaveText('Local draft saved');
  await expect(page.locator('#app-message')).toContainText('Reconnect Drive');
  await expect(page.locator('#connect-drive')).toHaveText('Reconnect Drive');
  expect(drive.patchCalls).toHaveLength(1);
  expect(drive.createCount).toBe(0);

  await performAccountAction(page);
  await expect(page.locator('#connect-drive')).toHaveText('Disconnect');
  await expectEditorSource(page, draft);
  await expect(page.locator('#saved-state')).toHaveText('Local draft saved');
  expect(drive.patchCalls).toHaveLength(1);
});

test('a Drive 403 keeps the draft and reports a permission problem without an auth reconnect loop', async ({ page }) => {
  const drive = await installStatefulDriveSaveMock(page, { patchStatus: 403 });
  await page.goto('/');
  await seedDriveSessions(page, [{
    accountId: 'account-a', fileId: 'drive-save', name: 'Song.guitardsl', source: 'title: Drive saved\n'
  }]);
  await performAccountAction(page);
  await expect(page.getByRole('tab', { name: 'Song.guitardsl' })).toBeVisible();
  const editor = page.getByRole('textbox', { name: 'GuitarDSL source editor' });
  const draft = 'title: Preserve after permission denial\n';
  await editor.fill(draft);
  await page.locator('#save-document').click();

  await expect(page.locator('#saved-state')).toHaveText('Local draft saved');
  await expect(page.locator('#app-message')).toContainText('access permissions');
  await expect(page.locator('#connect-drive')).toHaveText('Disconnect');
  expect(drive.patchCalls).toHaveLength(1);
  expect(drive.createCount).toBe(0);
});

test('a Drive readback mismatch keeps the local draft and reports the save as unconfirmed', async ({ page }) => {
  const drive = await installStatefulDriveSaveMock(page, { readbackMismatch: true });
  await page.goto('/');
  await seedDriveSessions(page, [{
    accountId: 'account-a', fileId: 'drive-save', name: 'Song.guitardsl', source: 'title: Drive saved\n'
  }]);
  await performAccountAction(page);
  await expect(page.getByRole('tab', { name: 'Song.guitardsl' })).toBeVisible();
  const editor = page.getByRole('textbox', { name: 'GuitarDSL source editor' });
  const draft = 'title: Keep after readback mismatch\n';
  await editor.fill(draft);
  await expect(page.locator('#saved-state')).toHaveText('Local draft saved');
  await page.locator('#save-document').click();
  await expectEditorSource(page, draft);
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
  await performAccountAction(page);
  await expect(page.getByRole('tab', { name: 'Account A.guitardsl' })).toBeVisible();
  await performAccountAction(page);
  await performAccountAction(page);
  await expect(page.getByRole('tab', { name: 'Account A.guitardsl' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Account B.guitardsl' })).toBeVisible();
  await page.getByRole('tab', { name: 'Account A.guitardsl' }).click();
  const editor = page.getByRole('textbox', { name: 'GuitarDSL source editor' });
  await expectEditorSource(page, 'title: Account A\n');
  await expect(page.locator('#save-document')).toBeDisabled();
  await editor.fill('title: Account A draft\n');
  await expect(page.locator('#saved-state')).toHaveText('Local draft saved');

  await performAccountAction(page);
  await performAccountAction(page);
  await expect(page.getByRole('tab', { name: 'Account A.guitardsl' })).toBeVisible();
  await page.getByRole('tab', { name: 'Account A.guitardsl' }).click();
  await expectEditorSource(page, 'title: Account A draft\n');
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
  await performAccountAction(page);
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
  await expectEditorSource(page, newSource);
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
  await performAccountAction(page);
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
  await expectEditorSource(page, newerSource);
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
  await expectEditorSource(page, source);
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('tab', { name: 'Untitled.guitardsl' }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Export source' }).click();
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
  await expectEditorSource(page, source);
  await editor.fill(source.replace(/\r\n/gu, '\n').replace('Song', 'Track'));

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('tab', { name: 'Line endings.guitardsl' }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Export source' }).click();
  const download = await downloadPromise;
  const path = await download.path();
  expect(path).not.toBeNull();
  expect(await readFile(path!, 'utf8')).toBe('title: Track\r\n[Verse]\r\nC | G | Am | F |\r\n');
});

test('localizes the Inspector, honors its theme, and supports keyboard tabs', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('tab', { name: 'Untitled.guitardsl' })).toBeVisible();
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('menuitemradio', { name: 'Language: 日本語' }).click();
  await page.getByRole('button', { name: '設定' }).click();
  await page.getByRole('menuitemradio', { name: 'テーマ: ダーク' }).click();
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

test('holds a composing source edit until the IME commits it', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('tab', { name: 'Untitled.guitardsl' })).toBeVisible();
  const editor = page.getByRole('textbox', { name: 'GuitarDSL source editor' });
  const initial = await readEditorSource(page);
  await expect(page.locator('#saved-state')).toHaveText('Saved locally');
  const savedBeforeComposition = await page.evaluate(async () => {
    const { indexedDb } = await import('/src/storage/indexedDb.ts');
    return (await indexedDb.getDocument({ storage: 'local', fileId: (await indexedDb.listDocuments('local'))[0].identity.fileId }))?.source;
  });
  await editor.evaluate(element => {
    element.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '' }));
  });
  await editor.press('ControlOrMeta+End');
  await editor.pressSequentially('日本語');
  await expect.poll(() => readEditorSource(page)).toBe(initial + '日本語');
  const savedDuringComposition = await page.evaluate(async () => {
    const { indexedDb } = await import('/src/storage/indexedDb.ts');
    return (await indexedDb.listDocuments('local'))[0].identity.fileId;
  });
  expect(savedDuringComposition).toBeTruthy();
  const draftDuringComposition = await page.evaluate(async fileId => {
    const { indexedDb } = await import('/src/storage/indexedDb.ts');
    return (await indexedDb.getDocument({ storage: 'local', fileId }))?.source;
  }, savedDuringComposition);
  expect(draftDuringComposition).toBe(savedBeforeComposition);
  await editor.evaluate(element => element.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '日本語' })));
  await expectEditorSource(page, initial + '日本語');
  await expect(page.locator('#saved-state')).toHaveText('Local draft saved');
  const savedAfterComposition = await page.evaluate(async fileId => {
    const { indexedDb } = await import('/src/storage/indexedDb.ts');
    return (await indexedDb.getDocument({ storage: 'local', fileId }))?.source;
  }, savedDuringComposition);
  expect(savedAfterComposition).toBe(initial + '日本語');
});

test('keeps native text editing undoable', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('tab', { name: 'Untitled.guitardsl' })).toBeVisible();
  const editor = page.getByRole('textbox', { name: 'GuitarDSL source editor' });
  await expectEditorSource(page, /^title: My song/m);
  const initial = await readEditorSource(page);
  await editor.focus();
  await editor.press('ControlOrMeta+End');
  await editor.pressSequentially('!');
  await expectEditorSource(page, `${initial}!`);
  await editor.press('ControlOrMeta+z');
  await expectEditorSource(page, initial);
  await editor.press('ControlOrMeta+Shift+z');
  await expectEditorSource(page, `${initial}!`);
});

test('shows compiler diagnostics and moves the source selection to one', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('tab', { name: 'Untitled.guitardsl' })).toBeVisible();
  const editor = page.getByRole('textbox', { name: 'GuitarDSL source editor' });
  await editor.fill('time: 3/4\n\n[Verse]\nC |\n@time: 7/x\n');
  const diagnostic = page.locator('#diagnostics .problem-row').first();
  await expect(diagnostic).toBeVisible();
  await diagnostic.locator('.problem-message').click();
  await expect(page.locator('#workspace')).toHaveClass(/view-source/);
  const selectedText = await page.evaluate(() => window.getSelection()?.toString() ?? '');
  expect(selectedText.length).toBeGreaterThan(0);
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
  await expectEditorSource(page, '[Verse]\nE | G | Am | F |\n');
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
  await expectEditorSource(page, 'let pulse = 4.d 4.d\nkey: C\n| C $pulse |\n');

  await page.locator('#variables-operation').selectOption('add');
  await page.locator('#variables-name').fill('unused');
  await page.locator('#variables-value').fill('4.d');
  await page.locator('#variables-apply').click();
  await expectEditorSource(page, /let unused = 4\.d/);
  await page.locator('#variables-list button').filter({ hasText: 'unused' }).click();
  await page.locator('#variables-operation').selectOption('deleteUnused');
  await page.locator('#variables-apply').click();
  await expect.poll(() => readEditorSource(page)).not.toContain('let unused = 4.d');
  await expectEditorSource(page, /let pulse = 4\.d 4\.d/);
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
  await expectEditorSource(page, /chord C\s*=/);
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
  await page.getByRole('tab', { name: 'Second.guitardsl' }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Export source' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('Second.guitardsl');
});

test('flushes same-task CodeMirror edits before redraw and tab switches without sharing undo history', async ({ page }) => {
  await page.goto('/');
  const firstTab = page.getByRole('tab', { name: 'Untitled.guitardsl' });
  await expect(firstTab).toBeVisible();
  const readTabs = () => page.evaluate(() => (window as Window & {
    __guitarDslReadTabs?: () => Array<{ key: string; source: string; revision: number; saveStatus: string }>;
  }).__guitarDslReadTabs?.() ?? []);
  const initialFirst = (await readTabs())[0];
  const initialFirstSource = await readEditorSource(page);
  const redrawEdit = `${initialFirstSource}\n# same-task renderAll\n`;
  const afterRedraw = await page.evaluate(source => {
    const testWindow = window as Window & {
      __guitarDslDispatchSourceEdit?: (value: string, userEvent?: string) => boolean;
      __guitarDslRenderAll?: () => void;
      __guitarDslReadTabs?: () => Array<{ key: string; source: string; revision: number; saveStatus: string }>;
    };
    testWindow.__guitarDslDispatchSourceEdit?.(source, 'input.replace');
    testWindow.__guitarDslRenderAll?.();
    return testWindow.__guitarDslReadTabs?.();
  }, redrawEdit);
  expect(afterRedraw?.find(tab => tab.key === initialFirst.key)).toMatchObject({
    source: redrawEdit, revision: initialFirst.revision + 1
  });
  await expect(page.locator('#saved-state')).toHaveText('Local draft saved');
  const firstDraft = await page.evaluate(async () => {
    const { indexedDb } = await import('/src/storage/indexedDb.ts');
    const row = (await indexedDb.listDocuments('local')).find(document => document.name === 'Untitled.guitardsl');
    return row ? (await indexedDb.getDraft(row.identity))?.source : undefined;
  });
  expect(firstDraft).toBe(redrawEdit);

  const secondSource = 'title: Second tab\n\n[Verse]\nD | G |\n';
  await page.locator('#file-input').setInputFiles({
    name: 'Second.guitardsl', mimeType: 'text/plain', buffer: Buffer.from(secondSource, 'utf8')
  });
  const secondTab = page.getByRole('tab', { name: 'Second.guitardsl' });
  await expect(secondTab).toBeVisible();
  const originalSecond = (await readTabs()).find(tab => tab.key !== initialFirst.key)!;
  await firstTab.click();
  await expectEditorSource(page, redrawEdit);

  const switchEdit = `${redrawEdit}\n# same-task tab switch\n`;
  const afterSwitch = await page.evaluate(({ source, tabName }) => {
    const testWindow = window as Window & {
      __guitarDslDispatchSourceEdit?: (value: string, userEvent?: string) => boolean;
      __guitarDslReadTabs?: () => Array<{ key: string; source: string; revision: number; saveStatus: string }>;
    };
    testWindow.__guitarDslDispatchSourceEdit?.(source, 'input.replace');
    Array.from(document.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
      .find(tab => tab.textContent === tabName)?.click();
    return testWindow.__guitarDslReadTabs?.();
  }, { source: switchEdit, tabName: 'Second.guitardsl' });
  expect(afterSwitch?.find(tab => tab.key === initialFirst.key)).toMatchObject({
    source: switchEdit, revision: initialFirst.revision + 2
  });
  await expectEditorSource(page, secondSource);

  const secondEdit = `${secondSource}\n# same-task second redraw\n`;
  const afterSecondRedraw = await page.evaluate(source => {
    const testWindow = window as Window & {
      __guitarDslDispatchSourceEdit?: (value: string, userEvent?: string) => boolean;
      __guitarDslRenderAll?: () => void;
      __guitarDslReadTabs?: () => Array<{ key: string; source: string; revision: number; saveStatus: string }>;
    };
    testWindow.__guitarDslDispatchSourceEdit?.(source, 'input.replace');
    testWindow.__guitarDslRenderAll?.();
    return testWindow.__guitarDslReadTabs?.();
  }, secondEdit);
  expect(afterSecondRedraw?.find(tab => tab.key === originalSecond.key)).toMatchObject({
    source: secondEdit, revision: originalSecond.revision + 1
  });
  await expect(page.locator('#saved-state')).toHaveText('Local draft saved');
  const secondDraft = await page.evaluate(async () => {
    const { indexedDb } = await import('/src/storage/indexedDb.ts');
    const row = (await indexedDb.listDocuments('local')).find(document => document.name === 'Second.guitardsl');
    return row ? (await indexedDb.getDraft(row.identity))?.source : undefined;
  });
  expect(secondDraft).toBe(secondEdit);

  await firstTab.click();
  const editor = page.getByRole('textbox', { name: 'GuitarDSL source editor' });
  await editor.press('ControlOrMeta+z');
  await expectEditorSource(page, redrawEdit);
  await expect.poll(async () => (await readTabs()).find(tab => tab.key === initialFirst.key)?.source).toBe(redrawEdit);
  expect((await readTabs()).find(tab => tab.key === originalSecond.key)?.source).toBe(secondEdit);

  await secondTab.click();
  await editor.press('ControlOrMeta+z');
  await expectEditorSource(page, secondSource);
  await expect.poll(async () => (await readTabs()).find(tab => tab.key === originalSecond.key)?.source).toBe(secondSource);
  expect((await readTabs()).find(tab => tab.key === initialFirst.key)?.source).toBe(redrawEdit);
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
  const sourceBeforePendingEdit = await readEditorSource(page);
  const pendingValue = 'pending edit';
  await editValue.fill(pendingValue);
  await preview.locator('#preview-mode-select').selectOption('normal');
  await expect(preview.locator('#preview-edit-status')).toHaveText('Apply the pending Preview edit before changing modes.');
  await expect(editValue).toHaveValue(pendingValue);
  await expectEditorSource(page, sourceBeforePendingEdit);
});

test('keeps a narrow workspace usable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('tab', { name: 'Untitled.guitardsl' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'GuitarDSL source editor' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Download PDF' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.getByRole('button', { name: 'Score view' }).click();
  await expect(page.locator('#source-pane')).toBeHidden();
  await expect(page.frameLocator('#score-frame').locator('.spread-sheet svg').first()).toBeVisible();
});
