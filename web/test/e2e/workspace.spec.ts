import { expect, test, type Page, type Request } from '@playwright/test';
import { planBeginnerTransform } from '@guitardsl/core/beginnerMode';
import { planCapoTransform } from '@guitardsl/core/capo';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const DEFAULT_CAPTURE_SOURCE = 'title: Cloud song\n\n[Verse]\nC | G | Am | F |\n';
const REQUIRED_DRIVE_SCOPES = 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.appdata';

interface DriveSeed {
  accountId: string;
  fileId: string;
  name: string;
  source: string;
  draftSource?: string;
  version?: string;
  folderId?: string;
}

interface TestAppDataState {
  schemaVersion: 1;
  selectedFolderId: string | null;
  folderPrompt: 'unasked' | 'deferred' | 'completed';
  openDriveFileIds: string[];
  activeDriveFileId: string | null;
  recentDriveFileIds: string[];
}
const mockedDriveAppData = new WeakMap<Page, Map<string, TestAppDataState | null>>();
const mockedDriveSeeds = new WeakMap<Page, Map<string, DriveSeed>>();

async function readEditorSource(page: Page): Promise<string> {
  return page.evaluate(() => (window as Window & { __guitarDslReadSource?: () => string }).__guitarDslReadSource?.() ?? '');
}

async function expectEditorSource(page: Page, expected: string | RegExp): Promise<void> {
  if (typeof expected === 'string') await expect.poll(() => readEditorSource(page)).toBe(expected);
  else await expect.poll(() => readEditorSource(page)).toMatch(expected);
}

async function installDeferredClipboard(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const target = window as Window & {
      __clipboardHoldRead?: boolean; __clipboardHoldWrite?: boolean;
      __clipboardReadStarted?: boolean; __clipboardWriteStarted?: boolean;
      __clipboardValue?: string; __clipboardWritten?: string;
      __releaseClipboardRead?: () => void; __releaseClipboardWrite?: () => void;
    };
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      writeText: async (text: string) => {
        target.__clipboardWritten = text;
        if (!target.__clipboardHoldWrite) return;
        target.__clipboardWriteStarted = true;
        await new Promise<void>(resolve => { target.__releaseClipboardWrite = resolve; });
        target.__clipboardWriteStarted = false;
      },
      readText: async () => {
        if (target.__clipboardHoldRead) {
          target.__clipboardReadStarted = true;
          await new Promise<void>(resolve => { target.__releaseClipboardRead = resolve; });
          target.__clipboardReadStarted = false;
        }
        return target.__clipboardValue ?? 'pasted text';
      }
    } });
  });
}

async function performAccountAction(page: Page): Promise<void> {
  const control = page.locator('#connect-drive');
  const state = await control.getAttribute('data-state');
  await control.click();
  const action = state === 'connected' ? 'Disconnect' : state === 'reauth' ? 'Reconnect Drive' : 'Connect to Google Drive';
  await page.getByRole('menuitem', { name: action, exact: true }).click();
  await expect(control).toHaveAttribute('data-connected', String(state !== 'connected'));
}

async function acceptPendingDisconnect(page: Page): Promise<string> {
  const dialogPromise = page.waitForEvent('dialog').then(async dialog => {
    const message = dialog.message();
    await dialog.accept();
    return message;
  });
  await page.locator('#connect-drive').click();
  await page.getByRole('menuitem', { name: 'Disconnect', exact: true }).click();
  return dialogPromise;
}

function parseMockedAppData(body: string): TestAppDataState | undefined {
  return [...body.matchAll(/\{[^{}]*\}/gu)].map(match => match[0]).map(value => {
    try { return JSON.parse(value) as TestAppDataState; } catch { return undefined; }
  }).find(value => value?.schemaVersion === 1 && Array.isArray(value.openDriveFileIds));
}

function mockedRequestBody(request: Request): string {
  return request.postData() ?? request.postDataBuffer()?.toString('utf8') ?? '';
}

interface DriveBrowserMockOptions {
  pickerSelection?: { id: string; name: string };
  holdPickerSelection?: boolean;
  holdFileReadId?: string;
  missingFileIds?: string[];
  remoteFiles?: Record<string, { name: string; source: string; version: string }>;
  folders?: Record<string, string>;
  driveFiles?: Array<{ id: string; name: string; version: string; modifiedTime: string; mimeType?: string; parents?: string[] }>;
  unauthorizedList?: boolean;
  unauthorizedListAccountId?: string;
  holdDriveListAccountId?: string;
  appDataState?: TestAppDataState | null;
  appDataStates?: Record<string, TestAppDataState | null>;
  grantedScopes?: string;
  failAppDataListCount?: number;
  failAppDataPatchCount?: number;
}

async function installDriveBrowserMock(page: Page, accountSequence: string[], options: DriveBrowserMockOptions = {}): Promise<{
  patchCalls: { fileId: string; source: string }[];
  appDataPatchCalls: TestAppDataState[];
  mediaAccountIds: string[];
  get appDataState(): TestAppDataState | null;
  getAppDataState(accountId: string): TestAppDataState | null;
  setAppDataState(accountId: string, value: TestAppDataState): void;
  get appDataCreateCount(): number;
  get visibleFolderCreateCount(): number;
  fileReadStarted: Promise<void>;
  releaseFileRead(): void;
  get fileReadCount(): number;
  driveListStarted: Promise<void>;
  releaseDriveList(): void;
  get driveFileListCount(): number;
  get driveFileListPendingCount(): number;
}> {
  const initialStates = Object.fromEntries(accountSequence.map(accountId => [accountId,
    options.appDataStates && Object.hasOwn(options.appDataStates, accountId) ? options.appDataStates[accountId]
      : options.appDataState === undefined ? {
        schemaVersion: 1 as const, selectedFolderId: `folder-${accountId}`, folderPrompt: 'completed' as const,
        openDriveFileIds: [], activeDriveFileId: null, recentDriveFileIds: []
      } : options.appDataState]));
  const appDataStates = new Map<string, TestAppDataState | null>(Object.entries(initialStates));
  mockedDriveAppData.set(page, appDataStates);
  mockedDriveSeeds.set(page, new Map());
  await page.addInitScript((config: {
    accounts: string[]; pickerSelection?: { id: string; name: string }; holdPickerSelection?: boolean; grantedScopes: string;
  }) => {
    let accounts = config.accounts;
    try {
      const override = sessionStorage.getItem('__guitarDslAccountSequence');
      if (override) {
        const parsed = JSON.parse(override) as unknown;
        if (Array.isArray(parsed) && parsed.every(item => typeof item === 'string')) accounts = parsed;
      }
    } catch { /* use the configured account sequence */ }
    const tokens = [...accounts];
    const google: Record<string, unknown> = {
      accounts: {
        oauth2: {
          initTokenClient: (tokenOptions: { callback: (result: { access_token: string; expires_in: number; scope: string }) => void }) => ({
            requestAccessToken: () => tokenOptions.callback({
              access_token: `test-token-${tokens.shift() ?? accounts.at(-1) ?? 'account-a'}`,
              expires_in: 3600,
              scope: config.grantedScopes
            })
          }),
          hasGrantedAllScopes: (response: { scope: string }, ...scopes: string[]) => {
            const granted = new Set(response.scope.split(/\s+/u));
            return scopes.every(scope => granted.has(scope));
          },
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
    holdPickerSelection: options.holdPickerSelection, grantedScopes: options.grantedScopes ?? REQUIRED_DRIVE_SCOPES
  });
  const patchCalls: { fileId: string; source: string }[] = [];
  const appDataPatchCalls: TestAppDataState[] = [];
  const mediaAccountIds: string[] = [];
  let appDataState = initialStates[accountSequence[0] ?? 'account-a'] ?? null;
  let appDataVersion = 1;
  let appDataCreateCount = 0;
  let appDataListFailureCount = options.failAppDataListCount ?? 0;
  let appDataPatchFailureCount = options.failAppDataPatchCount ?? 0;
  let visibleFolderCreateCount = 0;
  let startFileRead!: () => void;
  const fileReadStarted = new Promise<void>(resolve => { startFileRead = resolve; });
  let releaseFileRead!: () => void;
  const fileReadGate = new Promise<void>(resolve => { releaseFileRead = resolve; });
  let fileReadCount = 0;
  let driveFileListCount = 0;
  let driveFileListPendingCount = 0;
  let heldFileRead = false;
  let startDriveList!: () => void;
  const driveListStarted = new Promise<void>(resolve => { startDriveList = resolve; });
  let releaseDriveList!: () => void;
  const driveListGate = new Promise<void>(resolve => { releaseDriveList = resolve; });
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
      const isDriveFileList = request.method() === 'GET' && url.searchParams.get('spaces') !== 'appDataFolder';
      if (isDriveFileList) {
        driveFileListCount += 1;
        driveFileListPendingCount += 1;
      }
      try {
        const query = url.searchParams.get('q') ?? '';
        if (url.searchParams.get('spaces') === 'appDataFolder') {
          if (appDataListFailureCount > 0) {
            appDataListFailureCount -= 1;
            return await route.fulfill({ status: 403, headers, json: { error: 'simulated appData permission failure' } });
          }
          appDataState = mockedDriveAppData.get(page)?.get(accountId) ?? null;
          const files = appDataState ? [{ id: `app-state-${accountId}`, name: 'guitardsl-state-v1.json', mimeType: 'application/json',
            createdTime: '2026-01-01T00:00:00.000Z', version: String(appDataVersion), modifiedTime: `app-${appDataVersion}` }] : [];
          return await route.fulfill({ headers, json: { files } });
        }
        if (options.holdDriveListAccountId === accountId) {
          startDriveList();
          await driveListGate;
        }
        if (options.unauthorizedList || options.unauthorizedListAccountId === accountId) {
          return await route.fulfill({ status: 401, headers, json: { error: 'expired test token' } });
        }
        if (request.method() === 'POST') {
          visibleFolderCreateCount += 1;
          return await route.fulfill({ headers, json: { id: `folder-${accountId}`, name: 'GuitarDSL', mimeType: 'application/vnd.google-apps.folder', parents: ['root'] } });
        }
        const parent = query.match(/^'([^']+)' in parents/u)?.[1];
        const files = (options.driveFiles ?? []).filter(file => !parent || file.parents?.includes(parent));
        return await route.fulfill({ headers, json: { files } });
      } finally {
        if (isDriveFileList) driveFileListPendingCount -= 1;
      }
    }
    if (/^\/drive\/v3\/files\/folder-[^/]+$/u.test(url.pathname)) {
      const id = url.pathname.split('/').at(-1)!;
      return route.fulfill({ headers, json: { id, name: options.folders?.[id] ?? options.pickerSelection?.name ?? 'GuitarDSL', mimeType: 'application/vnd.google-apps.folder' } });
    }
    if (/^\/drive\/v3\/files\/app-state-[^/]+$/u.test(url.pathname)) {
      appDataState = mockedDriveAppData.get(page)?.get(accountId) ?? null;
      const metadata = { id: url.pathname.split('/').at(-1), name: 'guitardsl-state-v1.json', mimeType: 'application/json',
        createdTime: '2026-01-01T00:00:00.000Z', version: String(appDataVersion), modifiedTime: `app-${appDataVersion}` };
      return url.searchParams.get('alt') === 'media'
        ? route.fulfill({ headers, body: JSON.stringify(appDataState) })
        : route.fulfill({ headers, json: metadata });
    }
    if (url.pathname.startsWith('/drive/v3/files/')) {
      const fileId = decodeURIComponent(url.pathname.split('/').at(-1) ?? '');
      const remote = options.remoteFiles?.[fileId];
      const seeded = mockedDriveSeeds.get(page)?.get(fileId);
      if (url.searchParams.get('alt') !== 'media' && options.missingFileIds?.includes(fileId)) {
        return route.fulfill({ status: 404, headers, json: { error: 'simulated missing Drive file' } });
      }
      const version = remote?.version ?? seeded?.version ?? '1';
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
        return route.fulfill({ headers, body: remote?.source ?? seeded?.source ?? `title: ${fileId}\n` });
      }
      return route.fulfill({ headers, json: {
        id: fileId, name: remote?.name ?? seeded?.name ?? `${fileId}.guitardsl`, version, modifiedTime: `t${version}`, headRevisionId: `r${version}`, parents: [seeded?.folderId ?? `folder-${accountId}`]
      } });
    }
    if (url.pathname.startsWith('/upload/drive/v3/files')) {
      if (request.method() === 'PATCH') {
        const fileId = url.pathname.split('/').at(-1) ?? '';
        if (fileId.startsWith('app-state-')) {
          const candidate = parseMockedAppData(request.postData() ?? '');
          if (candidate) {
            appDataPatchCalls.push(candidate);
            if (appDataPatchFailureCount > 0) {
              appDataPatchFailureCount -= 1;
              return route.fulfill({ status: 400, headers, json: { error: 'simulated appData PATCH failure' } });
            }
            appDataState = candidate;
            mockedDriveAppData.get(page)?.set(accountId, appDataState);
          }
          appDataVersion += 1;
          return route.fulfill({ headers, json: { id: fileId, name: 'guitardsl-state-v1.json', mimeType: 'application/json',
            createdTime: '2026-01-01T00:00:00.000Z', version: String(appDataVersion), modifiedTime: `app-${appDataVersion}` } });
        }
        patchCalls.push({ fileId, source: request.postData() ?? '' });
      }
      if (request.method() === 'POST' && url.searchParams.get('uploadType') === 'multipart') {
        const body = mockedRequestBody(request);
        const candidate = parseMockedAppData(body);
        const requestedFields = url.searchParams.get('fields') ?? '';
        if (candidate || body.includes('guitardsl-state-v1.json') || !requestedFields.includes('parents')) {
          appDataCreateCount += 1;
          const appDataCandidate = candidate ?? (options.appDataState === null ? {
              schemaVersion: 1, selectedFolderId: null, folderPrompt: 'unasked', openDriveFileIds: [], activeDriveFileId: null, recentDriveFileIds: []
            } satisfies TestAppDataState : undefined);
          if (!appDataCandidate) throw new Error('The appData create request did not include a valid state JSON part.');
          appDataState = appDataCandidate;
          mockedDriveAppData.get(page)?.set(accountId, appDataState);
          const fileId = `app-state-${accountId}`;
          return route.fulfill({ headers, json: { id: fileId, name: 'guitardsl-state-v1.json', mimeType: 'application/json',
            createdTime: '2026-01-01T00:00:00.000Z', version: String(appDataVersion), modifiedTime: `app-${appDataVersion}` } });
        }
        const remote = options.remoteFiles?.['created-drive-copy'];
        const fileList = options.driveFiles ?? (options.driveFiles = []);
        if (!fileList.some(file => file.id === 'created-drive-copy')) fileList.push({
          id: 'created-drive-copy', name: remote?.name ?? 'Song (local copy).guitardsl', version: remote?.version ?? '1',
          modifiedTime: '2026-11-17T00:00:00.000Z', mimeType: 'text/plain', parents: [`folder-${accountId}`]
        });
        return route.fulfill({ headers, json: {
          id: 'created-drive-copy', name: remote?.name ?? 'Song (local copy).guitardsl', version: remote?.version ?? '1',
          modifiedTime: 't-copy', headRevisionId: 'r-copy', parents: [`folder-${accountId}`]
        } });
      }
      return route.fulfill({ headers, json: {
        id: 'created-drive-copy', name: 'Song (local copy).guitardsl', version: '1', modifiedTime: 't-copy',
        headRevisionId: 'r-copy', parents: [`folder-${accountId}`]
      } });
    }
    return route.fulfill({ status: 404, headers, json: { error: 'unhandled test Drive request' } });
  });
  return { patchCalls, appDataPatchCalls, mediaAccountIds,
    get appDataState() { return mockedDriveAppData.get(page)?.get(accountSequence[0] ?? 'account-a') ?? null; },
    getAppDataState: accountId => mockedDriveAppData.get(page)?.get(accountId) ?? null,
    setAppDataState: (accountId, value) => {
      mockedDriveAppData.get(page)?.set(accountId, value);
      appDataVersion += 1;
    },
    get appDataCreateCount() { return appDataCreateCount; },
    get visibleFolderCreateCount() { return visibleFolderCreateCount; }, fileReadStarted, releaseFileRead, get fileReadCount() { return fileReadCount; },
    driveListStarted, releaseDriveList, get driveFileListCount() { return driveFileListCount; },
    get driveFileListPendingCount() { return driveFileListPendingCount; } };
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
  mockedDriveAppData.set(page, new Map([['account-a', {
    schemaVersion: 1, selectedFolderId: 'folder-account-a', folderPrompt: 'completed',
    openDriveFileIds: [], activeDriveFileId: null, recentDriveFileIds: []
  }]]));
  await page.addInitScript(() => {
    (window as unknown as { google: unknown }).google = {
      accounts: { oauth2: { initTokenClient: (value: { callback(result: { access_token: string; expires_in: number; scope: string }): void }) => ({
        requestAccessToken: () => value.callback({ access_token: 'test-token-account-a', expires_in: 3600, scope: 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.appdata' }),
        revoke: (_token: string, callback?: () => void) => callback?.()
      }), hasGrantedAllScopes: (response: { scope: string }, ...scopes: string[]) => scopes.every(scope => response.scope.split(/\s+/u).includes(scope)) } }
    };
  });
  let remoteSource = 'title: Drive saved\n';
  let version = 1;
  let appDataVersion = 1;
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
      if (url.searchParams.get('spaces') === 'appDataFolder') {
        return route.fulfill({ headers, json: { files: [{ id: 'app-state-account-a', name: 'guitardsl-state-v1.json', mimeType: 'application/json',
          createdTime: '2026-01-01T00:00:00.000Z', version: String(appDataVersion), modifiedTime: `app-${appDataVersion}` }] } });
      }
      if (request.method() === 'POST') createCount += 1;
      return route.fulfill({ headers, json: { files: [] } });
    }
    if (url.pathname === '/drive/v3/files/app-state-account-a') {
      const metadata = { id: 'app-state-account-a', name: 'guitardsl-state-v1.json', mimeType: 'application/json',
        createdTime: '2026-01-01T00:00:00.000Z', version: String(appDataVersion), modifiedTime: `app-${appDataVersion}` };
      const appData = mockedDriveAppData.get(page)?.get('account-a');
      return url.searchParams.get('alt') === 'media'
        ? route.fulfill({ headers, body: JSON.stringify(appData) })
        : route.fulfill({ headers, json: metadata });
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
        const fileId = url.pathname.split('/').at(-1) ?? '';
        if (fileId === 'app-state-account-a') {
          const body = request.postData() ?? '';
          const candidate = [...body.matchAll(/\{[^{}]*\}/gu)].map(match => match[0]).map(value => {
            try { return JSON.parse(value) as TestAppDataState; } catch { return undefined; }
          }).find(value => value?.schemaVersion === 1 && Array.isArray(value.openDriveFileIds));
          if (candidate) mockedDriveAppData.get(page)?.set('account-a', candidate);
          appDataVersion += 1;
          return route.fulfill({ headers, json: { id: fileId, name: 'guitardsl-state-v1.json', mimeType: 'application/json',
            createdTime: '2026-01-01T00:00:00.000Z', version: String(appDataVersion), modifiedTime: `app-${appDataVersion}` } });
        }
        patchCalls.push({ fileId, source: request.postData() ?? '' });
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

async function seedDriveSessions(page: Page, documents: DriveSeed[], options: {
  appDataState?: TestAppDataState | null;
  appDataStates?: Record<string, TestAppDataState | null>;
} = {}): Promise<void> {
  const driveSeeds = mockedDriveSeeds.get(page) ?? new Map<string, DriveSeed>();
  for (const seed of documents) driveSeeds.set(seed.fileId, seed);
  mockedDriveSeeds.set(page, driveSeeds);
  const appDataStates = new Map<string, TestAppDataState | null>();
  const driveTabs = new Map<string, string[]>();
  for (const seed of documents) {
    const tabs = driveTabs.get(seed.accountId) ?? [];
    tabs.push(seed.fileId);
    driveTabs.set(seed.accountId, tabs);
  }
  for (const [accountId, tabs] of driveTabs) {
    appDataStates.set(accountId, { schemaVersion: 1, selectedFolderId: `folder-${accountId}`, folderPrompt: 'completed',
      openDriveFileIds: tabs, activeDriveFileId: tabs[0] ?? null, recentDriveFileIds: tabs });
  }
  for (const [accountId, state] of Object.entries(options.appDataStates ?? {})) appDataStates.set(accountId, state);
  if (options.appDataState !== undefined) appDataStates.set(documents[0]?.accountId ?? 'account-a', options.appDataState);
  mockedDriveAppData.set(page, appDataStates);
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

type WorkspaceTestTab = {
  identity: { storage: 'local' | 'drive'; fileId: string };
  accountId?: string;
  source: string;
  revision: number;
  persistedBase: { revision: number; source: string };
  saveStatus: string;
};

async function readFirstWorkspaceTab(page: Page): Promise<WorkspaceTestTab | undefined> {
  return page.evaluate(() => (window as Window & {
    __guitarDslReadTabs?: () => WorkspaceTestTab[]
  }).__guitarDslReadTabs?.()[0]);
}

async function readFirstWorkspaceDocument(page: Page): Promise<{ source: string; revision: number } | undefined> {
  return page.evaluate(async () => {
    const tab = (window as Window & { __guitarDslReadTabs?: () => WorkspaceTestTab[] }).__guitarDslReadTabs?.()[0];
    if (!tab) return undefined;
    const { indexedDb } = await import('/src/storage/indexedDb.ts');
    const document = await indexedDb.getDocument(tab.identity, tab.accountId);
    return document && { source: document.source, revision: document.revision };
  });
}

async function installOneShotDraftSaveGate(page: Page, mode: 'fail-now' | 'commit-then-hold' | 'fail-then-hold'): Promise<void> {
  await page.evaluate(async (gateMode: typeof mode) => {
    const { indexedDb } = await import('/src/storage/indexedDb.ts');
    const target = window as Window & {
      __draftGateStarted?: boolean;
      __draftGateCommitted?: boolean;
      __draftGateSettled?: boolean;
      __releaseDraftGate?: () => void;
    };
    const original = indexedDb.saveDraft.bind(indexedDb);
    let intercepted = false;
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    target.__draftGateStarted = false;
    target.__draftGateCommitted = false;
    target.__draftGateSettled = false;
    target.__releaseDraftGate = release;
    indexedDb.saveDraft = async (...args) => {
      if (intercepted) return original(...args);
      intercepted = true;
      target.__draftGateStarted = true;
      if (gateMode === 'fail-now') {
        target.__draftGateSettled = true;
        throw new DOMException('Initial simulated draft failure', 'QuotaExceededError');
      }
      if (gateMode === 'commit-then-hold') {
        const saved = await original(...args);
        target.__draftGateCommitted = saved;
        await gate;
        target.__draftGateSettled = true;
        return saved;
      }
      await gate;
      target.__draftGateSettled = true;
      throw new DOMException('Stale scheduled write failed', 'QuotaExceededError');
    };
  }, mode);
}

async function roundTripBfCache(page: Page): Promise<void> {
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
  await expect(page.locator('.app-shell')).toHaveJSProperty('inert', true);
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
  await expect(page.locator('.app-shell')).toHaveJSProperty('inert', false);
}

async function releaseDraftSaveGate(page: Page): Promise<void> {
  await page.evaluate(() => (window as Window & { __releaseDraftGate?: () => void }).__releaseDraftGate?.());
}

async function deferNextDraftBaselineRead(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const { indexedDb } = await import('/src/storage/indexedDb.ts');
    const target = window as Window & {
      __draftBaselineReadStarted?: boolean;
      __draftBaselineReadSettled?: boolean;
      __releaseDraftBaselineRead?: () => void;
      __localListReads?: number;
    };
    const readBaseline = indexedDb.getDraftBaseline.bind(indexedDb);
    const listDocuments = indexedDb.listDocuments.bind(indexedDb);
    let deferred = false;
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    target.__draftBaselineReadStarted = false;
    target.__draftBaselineReadSettled = false;
    target.__releaseDraftBaselineRead = release;
    target.__localListReads = 0;
    indexedDb.getDraftBaseline = async (...args) => {
      const baseline = await readBaseline(...args);
      if (deferred) return baseline;
      deferred = true;
      target.__draftBaselineReadStarted = true;
      await gate;
      target.__draftBaselineReadSettled = true;
      return baseline;
    };
    indexedDb.listDocuments = async (...args) => {
      target.__localListReads = (target.__localListReads ?? 0) + 1;
      return listDocuments(...args);
    };
  });
}

async function releaseDraftBaselineRead(page: Page): Promise<void> {
  await page.evaluate(() => (window as Window & { __releaseDraftBaselineRead?: () => void }).__releaseDraftBaselineRead?.());
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
  const captureIssue172 = process.env.GUITARDSL_CAPTURE_ISSUE172 === '1'
    && page.context().browser()?.browserType().name() === 'chromium';
  if (captureIssue172) await installDriveBrowserMock(page, ['account-a'], {
    appDataState: null,
    pickerSelection: { id: 'folder-account-a', name: 'GuitarDSL Songs' },
    remoteFiles: { 'drive-song': { name: 'Cloud Song.guitardsl', source: DEFAULT_CAPTURE_SOURCE, version: '1' } },
    driveFiles: [{ id: 'drive-song', name: 'Cloud Song.guitardsl', version: '1', modifiedTime: '2026-11-15T00:00:00.000Z', mimeType: 'text/plain', parents: ['folder-account-a'] }]
  });
  if (process.env.GUITARDSL_CAPTURE_ISSUE166 === '1'
    && page.context().browser()?.browserType().name() === 'chromium') {
    await page.setViewportSize({ width: 1600, height: 1000 });
  }
  await page.goto('/');
  await expect(page.getByRole('tab', { name: 'Untitled.guitardsl' })).toBeVisible();
  await expect(page.getByRole('main', { name: 'GuitarDSL' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'GuitarDSL source editor' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Untitled.guitardsl' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Variables' })).toBeVisible();
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
  if (captureIssue172) {
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
          explorerHeading: '.explorer-heading', explorerNewScore: '#new-score', explorerOptions: '#explorer-more',
          localRoot: '[data-storage-section="local"] .storage-root-row', localRootLabel: '#storage-local',
          localRootIcon: '[data-storage-section="local"] .root-icon',
          localActions: '#file-actions', localFile: '#file-items .file-item', activeLocalFile: '#file-items .file-item[aria-current="page"]',
          driveRoot: '[data-storage-section="drive"] .storage-root-row', driveRootLabel: '#storage-drive',
          driveRootIcon: '[data-storage-section="drive"] .root-icon', driveStatus: '#drive-status', driveConnect: '#drive-connect-inline',
          driveFolder: '#drive-file-items .drive-folder-row', driveActions: '#drive-file-actions', driveFile: '#drive-file-items .file-item',
          tabs: '.tabs', tabViewControls: '.view-mode-controls', viewSource: '#view-source',
          viewSplit: '#view-split', viewScore: '#view-score', source: '#source-pane', centerSplitter: '#center-splitter', score: '#score-pane',
          inspectorSplitter: '#inspector-splitter', inspector: '.inspector', inspectorOptions: '#inspector-more', problemsSplitter: '#problems-splitter',
          problems: '#problems-panel', problemsHeading: '.problems-heading', problemCounts: '#problem-counts', errorCount: '#error-count', warningCount: '#warning-count',
          problemColumns: '.problem-columns', closeProblems: '#close-problems',
          toolWindowBar: '.tool-window-bar', toolWindowInspector: '#toggle-inspector',
          toolWindowProblems: '#toggle-problems', status: '.statusbar'
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
        const problemHeadings = Array.from(document.querySelector('#problem-columns')?.children ?? []).map(element => {
          const { x, y, width, height } = element.getBoundingClientRect();
          return { label: element.textContent, x, y, width, height };
        });
        const topActions = ['#save-document', '#download-pdf', '#connect-drive', '#help-button', '#settings-button'].map(selector => {
          const element = document.querySelector(selector)!;
          const { x, y, width, height } = element.getBoundingClientRect();
          return { id: element.id, x, y, width, height };
        });
        const fileEntries = (selector: string) => Array.from(document.querySelectorAll<HTMLElement>(selector)).map(element => {
          const { x, y, width, height } = element.getBoundingClientRect();
          const icon = element.querySelector<SVGSVGElement>('.web-icon');
          const iconRect = icon?.getBoundingClientRect();
          return { name: element.textContent?.trim(), x, y, width, height,
            icon: iconRect ? { x: iconRect.x, y: iconRect.y, width: iconRect.width, height: iconRect.height } : null,
            symbol: element.querySelector('use')?.getAttribute('href'), selected: element.getAttribute('aria-current') === 'page' };
        });
        const symbols = Object.fromEntries(['[data-storage-section="local"] .root-icon use', '[data-storage-section="drive"] .root-icon use', '#new-score use', '#explorer-more use',
          '#inspector-more use', '#close-problems use', '.problem-severity .web-icon use'].map(selector => [selector,
          Array.from(document.querySelectorAll(selector)).map(element => element.getAttribute('href'))]));
        const splitters = Array.from(document.querySelectorAll<HTMLElement>('[role="separator"]')).map(element => ({
          name: element.getAttribute('aria-label'), orientation: element.getAttribute('aria-orientation'),
          min: element.getAttribute('aria-valuemin'), max: element.getAttribute('aria-valuemax'), now: element.getAttribute('aria-valuenow')
        }));
        const modes = Array.from(document.querySelectorAll<HTMLButtonElement>('.view-mode-button')).map(button => ({
          label: button.getAttribute('aria-label'), pressed: button.getAttribute('aria-pressed')
        }));
        const headerControlStyles = Object.fromEntries(Array.from(document.querySelectorAll<HTMLButtonElement>('.top-actions .quiet-button')).map(button => {
          const style = getComputedStyle(button);
          return [button.id, { backgroundColor: style.backgroundColor, borderWidth: style.borderWidth }];
        }));
        const menu = document.querySelector<HTMLElement>('#context-menu:not([hidden]), #settings-menu:not([hidden]), #panel-menu:not([hidden]), #file-menu:not([hidden]), #edit-menu:not([hidden]), #view-menu:not([hidden])');
        const menuItems = menu ? Array.from(menu.querySelectorAll<HTMLButtonElement>('button')).map(button => ({
          label: button.textContent, disabled: button.disabled,
          rect: (() => { const { x, y, width, height } = button.getBoundingClientRect(); return { x, y, width, height }; })()
        })) : [];
        return { viewport: { width: innerWidth, height: innerHeight }, rects, problemsColumns, problemHeadings, symbols, topActions,
          headerControlStyles, topbarPaddingRight: getComputedStyle(document.querySelector('.topbar')!).paddingRight,
          brandMarkFilter: getComputedStyle(document.querySelector('.brand-mark')!).filter,
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
        const normalStyles = await page.locator('.top-actions .quiet-button').evaluateAll(buttons => buttons.map(button => {
          const style = getComputedStyle(button);
          return { backgroundColor: style.backgroundColor, borderWidth: style.borderWidth };
        }));
        expect(normalStyles.length).toBeGreaterThan(0);
        expect(normalStyles.every(style => style.backgroundColor === 'rgba(0, 0, 0, 0)' && style.borderWidth === '0px')).toBe(true);
        expect(await page.locator('.topbar').evaluate(element => getComputedStyle(element).paddingRight)).toBe('12px');
        expect(await page.locator('.brand-mark').evaluate(element => getComputedStyle(element).filter))
          .toBe(theme === 'dark' ? 'brightness(0) invert(1)' : 'none');
        await capture(`desktop-1600x900-${locale}-${theme}.png`);
        const settings = page.locator('#settings-button');
        await settings.hover();
        await expect.poll(() => settings.evaluate(element => getComputedStyle(element).backgroundColor))
          .toBe(theme === 'dark' ? 'rgb(48, 54, 65)' : 'rgb(239, 241, 245)');
        await capture(`header-hover-${locale}-${theme}.png`);
        await settings.focus();
        await page.keyboard.press('Tab');
        await page.keyboard.press('Shift+Tab');
        await expect(settings).toBeFocused();
        await expect.poll(() => settings.evaluate(element => getComputedStyle(element).backgroundColor))
          .toBe(theme === 'dark' ? 'rgb(48, 54, 65)' : 'rgb(239, 241, 245)');
        await capture(`header-focus-${locale}-${theme}.png`);
        await page.mouse.move(8, 880);
      }
    }
    await page.setViewportSize({ width: 1280, height: 800 });
    await capture('desktop-1280x800-ja-dark.png');
    await page.setViewportSize({ width: 1600, height: 900 });
    const namePrompt = page.waitForEvent('dialog').then(dialog => dialog.accept('Reference.guitardsl'));
    await page.locator('#new-score').click();
    await namePrompt;
    await expect(page.locator('#file-items .file-item')).toHaveCount(2);
    const editor = page.getByRole('textbox', { name: 'GuitarDSL ソースエディター' });
    await editor.fill('time: 3/4\n\n[Verse]\nC |\n@time: 7/x\n');
    await page.keyboard.press('Escape');
    await expect(page.locator('#diagnostics .problem-row').first()).toBeVisible();
    await page.locator('#connect-drive').click();
    await page.getByRole('menuitem', { name: 'Google Drive に接続', exact: true }).click();
    const folderPrompt = page.getByRole('dialog');
    await expect(folderPrompt).toBeVisible();
    await capture('drive-first-connect-ja.png');
    await folderPrompt.getByRole('button', { name: '既存フォルダーを選択…' }).click();
    await expect(page.locator('#drive-status')).toBeVisible();
    await page.locator('#storage-drive').click({ button: 'right' });
    await expect(page.getByRole('menuitem', { name: '保存先フォルダーを選択…' })).toBeVisible();
    await expect(page.locator('#drive-file-items .drive-folder-row')).toContainText('GuitarDSL Songs');
    await expect(page.locator('#drive-file-items .file-item')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await page.locator('#app-message').evaluate(element => { (element as HTMLElement).hidden = true; });
    await expect(page.locator('#file-items .file-item[aria-current="page"]')).toHaveText('Reference.guitardsl');
    await expect(page.getByRole('tab', { name: '変数' })).toHaveAttribute('aria-selected', 'true');
    await capture('reference-state-1600x900-ja-dark.png');

    await page.setViewportSize({ width: 1280, height: 800 });

    await page.locator('#menu-file-trigger').click();
    await expect(page.locator('#file-menu')).toBeVisible();
    await capture('menu-file-ja.png');
    await page.keyboard.press('Escape');
    await page.locator('#menu-edit-trigger').click();
    await expect(page.locator('#edit-menu')).toBeVisible();
    await capture('menu-edit-ja.png');
    await page.keyboard.press('Escape');
    await page.locator('#menu-view-trigger').click();
    await expect(page.locator('#view-menu')).toBeVisible();
    await capture('menu-view-ja.png');
    await page.keyboard.press('Escape');

    await page.getByRole('button', { name: '設定' }).click();
    await expect(page.getByRole('menu')).toBeVisible();
    await capture('menu-settings-ja.png');
    await page.keyboard.press('Escape');

    await page.locator('#explorer-more').click();
    await expect(page.locator('#panel-menu').getByRole('menuitem')).toHaveText(['ファイルを読み込む', 'Explorer を閉じる', 'Explorer の幅を初期値へ戻す（220px）']);
    await capture('menu-explorer-options-ja.png');
    await page.keyboard.press('Escape');
    await page.locator('#inspector-more').click();
    await expect(page.locator('#panel-menu').getByRole('menuitem')).toHaveText(['Inspector を閉じる', '幅を初期値へ戻す']);
    await capture('menu-inspector-options-ja.png');
    await page.keyboard.press('Escape');

    await page.locator('#storage-local').click({ button: 'right' });
    await expect(page.getByRole('menuitem', { name: '新しい楽譜' })).toBeVisible();
    await capture('menu-local-root-ja.png');
    await page.keyboard.press('Escape');

    await page.locator('#storage-drive').click({ button: 'right' });
    await expect(page.getByRole('menuitem', { name: '保存先フォルダーを選択…' })).toBeVisible();
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
    await page.getByRole('tab', { name: 'Untitled.guitardsl' }).click();

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
    await page.frameLocator('#score-frame').locator('#preview-mode-select').selectOption('edit');
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
  await expect(page.locator('#app')).not.toHaveAttribute('aria-busy', 'true');
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

test('resolves system theme and keeps Problems and document tabs readable', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  const shell = page.locator('.app-shell');
  const problems = page.locator('#problems-panel');
  const activeTab = page.getByRole('tab', { name: 'Untitled.guitardsl' });

  await expect(shell).toHaveAttribute('data-theme', 'dark');
  await expect(activeTab).toBeVisible();
  expect(await problems.evaluate(element => getComputedStyle(element).backgroundColor)).toBe('rgb(34, 37, 44)');
  expect(await activeTab.evaluate(element => getComputedStyle(element).color)).toBe('rgb(228, 231, 238)');

  const chooseTheme = async (label: string): Promise<void> => {
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByRole('menuitemradio', { name: label }).click();
  };

  await chooseTheme('Theme: Light');
  await expect(shell).toHaveAttribute('data-theme', 'light');
  expect(await problems.evaluate(element => getComputedStyle(element).backgroundColor)).toBe('rgb(255, 255, 255)');
  expect(await activeTab.evaluate(element => getComputedStyle(element).color)).toBe('rgb(37, 42, 51)');

  await chooseTheme('Theme: System');
  await expect(shell).toHaveAttribute('data-theme', 'dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(shell).toHaveAttribute('data-theme', 'light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(shell).toHaveAttribute('data-theme', 'dark');

  await chooseTheme('Theme: Dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(shell).toHaveAttribute('data-theme', 'dark');

  await page.emulateMedia({ colorScheme: 'dark' });
  await chooseTheme('Theme: System');
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('menuitemradio', { name: 'Language: 日本語' }).click();
  await expect(shell).toHaveAttribute('data-theme', 'dark');
  if (process.env.GUITARDSL_CAPTURE_ISSUE172 === '1'
    && page.context().browser()?.browserType().name() === 'chromium') {
    await page.setViewportSize({ width: 1600, height: 900 });
    const evidenceDir = resolve(process.cwd(), '../docs/status/evidence/issue-172');
    await mkdir(evidenceDir, { recursive: true });
    await page.screenshot({ path: resolve(evidenceDir, 'system-theme-dark-1600x900-ja.png'), fullPage: false });
  }
});

test('Header and Problems render the latest Controller view through the workspace store', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#app')).not.toHaveAttribute('aria-busy', 'true');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('#drive-state-label')).toHaveText('Not connected');
  await expect(page.locator('#status-problems')).toHaveText('Errors 0 / Warnings 0');

  const editor = page.getByRole('textbox', { name: 'GuitarDSL source editor' });
  await editor.fill('time: 3/4\n\n[Verse]\nC |\n@time: 7/x\n');
  const errors = page.locator('#error-count');
  const warnings = page.locator('#warning-count');
  await expect(errors).not.toHaveText('0');
  await expect(page.locator('#diagnostics .problem-row').first()).toBeVisible();
  await expect(page.locator('.problem-severity[data-severity="error"]').first()).toHaveText('error');
  await expect.poll(() => page.locator('#status-problems').textContent()).toMatch(/^Errors \d+ \/ Warnings \d+$/u);

  await page.locator('#settings-button').click();
  await page.getByRole('menuitemradio', { name: 'Language: 日本語' }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'ja');
  await expect(page.locator('#drive-state-label')).toHaveText('未接続');
  await expect(page.locator('#problems-title')).toHaveText('問題');
  await expect(page.locator('.problem-severity[data-severity="error"]').first()).toHaveText('error');
  await expect(page.locator('#status-problems')).toHaveText(`エラー ${await errors.textContent()} / 警告 ${await warnings.textContent()}`);

  await page.locator('#close-problems').click();
  await expect(page.locator('#problems-panel')).toBeHidden();
  await page.locator('#toggle-problems').click();
  await expect(page.locator('#problems-panel')).toBeVisible();
});

test('renders info diagnostics from a workspace snapshot with accessible severity in English and Japanese', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#app')).not.toHaveAttribute('aria-busy', 'true');

  const installSeveritySnapshot = () => page.evaluate(async () => {
    const { useWorkspaceStore } = await import('/src/stores/workspaceStore.ts');
    const store = useWorkspaceStore();
    const current = store.view;
    if (!current) throw new Error('The workspace snapshot is unavailable.');
    store.view = {
      ...current,
      diagnostics: [
        { severity: 'error', message: 'Error snapshot diagnostic', file: 'snapshot.guitardsl', line: 1, column: 1, from: 0, to: 1 },
        { severity: 'warning', message: 'Warning snapshot diagnostic', file: 'snapshot.guitardsl', line: 2, column: 1, from: 2, to: 3 },
        { severity: 'info', message: 'Informational snapshot diagnostic', file: 'snapshot.guitardsl', line: 3, column: 1, from: 4, to: 5 }
      ]
    };
  });
  const assertSeverityRows = async () => {
    await expect(page.locator('#diagnostics .problem-severity')).toHaveText(['error', 'warning', 'info']);
    const infoRow = page.getByRole('listitem').filter({
      has: page.locator('.problem-severity[data-severity="info"]')
    });
    await expect(infoRow).toHaveAttribute('role', 'listitem');
    await expect(infoRow.getByRole('button', { name: 'Informational snapshot diagnostic' })).toBeVisible();
    await expect(page.locator('#diagnostics')).toHaveAttribute('aria-live', 'polite');
  };

  await installSeveritySnapshot();
  await assertSeverityRows();
  await page.locator('#settings-button').click();
  await page.getByRole('menuitemradio', { name: 'Language: 日本語' }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'ja');
  await installSeveritySnapshot();
  await assertSeverityRows();
});

test('projects Controller locale into Vue I18n without disturbing source or undo history', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto('/');
  await expect(page.locator('#app')).not.toHaveAttribute('aria-busy', 'true');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  const captureScreenshots = process.env.GUITARDSL_CAPTURE_ISSUE181 === '1'
    && page.context().browser()?.browserType().name() === 'chromium';
  const evidenceDir = resolve(process.cwd(), '../docs/status/evidence/issue-181');
  const capture = async (name: string): Promise<void> => {
    if (!captureScreenshots) return;
    await mkdir(evidenceDir, { recursive: true });
    await page.screenshot({ path: resolve(evidenceDir, name), fullPage: false });
  };

  const editor = page.getByRole('textbox', { name: 'GuitarDSL source editor' });
  const initialSource = await readEditorSource(page);
  const source = 'title: Locale test\n\n[Verse]\nC | G |\n';
  await editor.fill(source);
  await expectEditorSource(page, source);
  await expect(page.frameLocator('#score-frame').locator('.spread-sheet svg').first()).toBeVisible();
  await capture('vue-i18n-en-1600x900.png');

  await page.locator('#settings-button').click();
  await page.getByRole('menuitemradio', { name: 'Language: 日本語' }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'ja');
  await expect(page.locator('#menu-file-trigger')).toHaveText('ファイル');
  await expect(page.locator('#save-document')).toHaveAttribute('aria-label', '保存');
  await expect(page.locator('#explorer-more')).toHaveAttribute('aria-label', 'エクスプローラーのオプション');
  await expect(page.locator('#problems-title')).toHaveText('問題');
  await expect(page.locator('#inspector-heading')).toHaveText('インスペクタ');
  await expect(page.locator('#toggle-inspector')).toHaveAttribute('title', 'Inspector の表示切替');
  await expect(page.locator('#status-cursor')).toHaveText(/^行 \d+, 列 \d+$/u);
  await capture('vue-i18n-ja-1600x900.png');
  await expectEditorSource(page, source);

  await page.locator('.cm-content').press('ControlOrMeta+z');
  await expectEditorSource(page, initialSource);

  await page.locator('#settings-button').click();
  await page.getByRole('menuitemradio', { name: 'Language: English' }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('#menu-file-trigger')).toHaveText('File');

  await page.locator('#settings-button').click();
  await page.getByRole('menuitemradio', { name: 'Language: 日本語' }).click();
  await expect.poll(() => page.evaluate(async () => {
    const { indexedDb } = await import('/src/storage/indexedDb.ts');
    return (await indexedDb.getValue<{ locale?: string }>('settings', 'web-preferences'))?.locale;
  })).toBe('ja');
  await page.reload();
  await expect(page.locator('#app')).not.toHaveAttribute('aria-busy', 'true');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ja');
  await expect(page.locator('#menu-file-trigger')).toHaveText('ファイル');
});

test('preserves source, revision, selection, and undo in two tabs through locale changes', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#app')).not.toHaveAttribute('aria-busy', 'true');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');

  const readTabs = () => page.evaluate(() => (window as Window & {
    __guitarDslReadTabs?: () => Array<{ key: string; source: string; revision: number }>;
  }).__guitarDslReadTabs?.() ?? []);
  const replaceSource = async (source: string) => {
    const changed = await page.evaluate(value => (window as Window & {
      __guitarDslReplaceSource?: (next: string) => boolean;
    }).__guitarDslReplaceSource?.(value) ?? false, source);
    expect(changed).toBe(true);
    await expectEditorSource(page, source);
  };
  const readSelection = () => page.evaluate(() => (window as Window & {
    __guitarDslReadSelection?: () => { from: number; to: number; head: number };
  }).__guitarDslReadSelection?.());
  const selectOneCharacter = async (offset: number) => {
    await page.evaluate(position => (window as Window & {
      __guitarDslSetCursor?: (cursor: number) => void;
    }).__guitarDslSetCursor?.(position), offset);
    await page.keyboard.press('Shift+ArrowRight');
    return readSelection();
  };
  const setLocale = async (locale: 'en' | 'ja') => {
    await page.locator('#settings-button').click();
    await page.getByRole('menuitemradio', {
      name: locale === 'ja' ? 'Language: 日本語' : 'Language: English'
    }).click();
    await expect(page.locator('html')).toHaveAttribute('lang', locale);
  };

  const initialTabs = await readTabs();
  const firstKey = initialTabs[0]?.key;
  expect(firstKey).toBeTruthy();
  const firstBase = 'title: First base\n\n[Verse]\nC | G |\n';
  const firstEdited = 'title: First edited\n\n[Verse]\nC | G |\n';
  await replaceSource(firstBase);
  await page.waitForTimeout(600);
  await replaceSource(firstEdited);
  const firstSelection = await selectOneCharacter(firstEdited.indexOf('First'));
  expect(firstSelection?.to).toBeGreaterThan(firstSelection?.from ?? Number.MAX_SAFE_INTEGER);
  const firstState = (await readTabs()).find(tab => tab.key === firstKey);
  expect(firstState).toMatchObject({ source: firstEdited, revision: (initialTabs[0]?.revision ?? 0) + 2 });

  const createSecond = page.waitForEvent('dialog').then(dialog => dialog.accept('Second.guitardsl'));
  await page.locator('#new-score').click();
  await createSecond;
  const secondTab = page.getByRole('tab', { name: 'Second.guitardsl' });
  await expect(secondTab).toHaveAttribute('aria-selected', 'true');
  const secondKey = (await readTabs()).find(tab => tab.key !== firstKey)?.key;
  expect(secondKey).toBeTruthy();

  const secondBase = 'title: Second base\n\n[Chorus]\nF | C |\n';
  const secondEdited = 'title: Second edited\n\n[Chorus]\nF | C |\n';
  await replaceSource(secondBase);
  await page.waitForTimeout(600);
  await replaceSource(secondEdited);
  const secondSelection = await selectOneCharacter(secondEdited.indexOf('Second') + 1);
  expect(secondSelection?.to).toBeGreaterThan(secondSelection?.from ?? Number.MAX_SAFE_INTEGER);
  const secondState = (await readTabs()).find(tab => tab.key === secondKey);
  expect(secondState?.source).toBe(secondEdited);

  await page.evaluate(() => {
    const editor = document.querySelector('.editor-surface .cm-editor');
    if (!editor) throw new Error('The CodeMirror EditorView is unavailable.');
    (window as Window & { __issue181EditorRoot?: Element }).__issue181EditorRoot = editor;
  });
  const assertEditorViewRetained = async () => {
    expect(await page.evaluate(() => {
      const target = window as Window & { __issue181EditorRoot?: Element };
      return target.__issue181EditorRoot === document.querySelector('.editor-surface .cm-editor');
    })).toBe(true);
  };
  const assertTabStatesRetained = async () => {
    const currentTabs = await readTabs();
    expect(currentTabs.find(tab => tab.key === firstKey)).toMatchObject({
      source: firstEdited, revision: firstState!.revision
    });
    expect(currentTabs.find(tab => tab.key === secondKey)).toMatchObject({
      source: secondEdited, revision: secondState!.revision
    });
  };

  await setLocale('ja');
  await assertEditorViewRetained();
  await assertTabStatesRetained();
  expect(await readSelection()).toEqual(secondSelection);
  await setLocale('en');
  await assertEditorViewRetained();
  await assertTabStatesRetained();
  expect(await readSelection()).toEqual(secondSelection);

  const firstTab = page.getByRole('tab', { name: 'Untitled.guitardsl' });
  await firstTab.click();
  await expectEditorSource(page, firstEdited);
  expect(await readSelection()).toEqual(firstSelection);
  await secondTab.click();
  await expectEditorSource(page, secondEdited);
  expect(await readSelection()).toEqual(secondSelection);

  const editor = page.getByRole('textbox', { name: 'GuitarDSL source editor' });
  await editor.press('ControlOrMeta+z');
  await expectEditorSource(page, secondBase);
  await expect.poll(async () => (await readTabs()).find(tab => tab.key === secondKey)?.source).toBe(secondBase);
  expect((await readTabs()).find(tab => tab.key === firstKey)?.source).toBe(firstEdited);
  await editor.press('ControlOrMeta+Shift+z');
  await expectEditorSource(page, secondEdited);

  await firstTab.click();
  await expectEditorSource(page, firstEdited);
  await editor.press('ControlOrMeta+z');
  await expectEditorSource(page, firstBase);
  await expect.poll(async () => (await readTabs()).find(tab => tab.key === firstKey)?.source).toBe(firstBase);
  expect((await readTabs()).find(tab => tab.key === secondKey)?.source).toBe(secondEdited);
  await editor.press('ControlOrMeta+Shift+z');
  await expectEditorSource(page, firstEdited);
});

test('uses the browser language by default and a saved locale after reload', async ({ page }) => {
  await page.goto('/');
  const appUrl = page.url();
  const browser = page.context().browser();
  if (!browser) throw new Error('The browser fixture is unavailable.');
  const context = await browser.newContext({ locale: 'ja-JP' });
  try {
    const localizedPage = await context.newPage();
    await localizedPage.goto(appUrl);
    await expect(localizedPage.locator('#app')).not.toHaveAttribute('aria-busy', 'true');
    await expect(localizedPage.locator('html')).toHaveAttribute('lang', 'ja');
    await expect(localizedPage.locator('#menu-file-trigger')).toHaveText('ファイル');

    await localizedPage.locator('#settings-button').click();
    await localizedPage.getByRole('menuitemradio', { name: 'Language: English' }).click();
    await expect(localizedPage.locator('html')).toHaveAttribute('lang', 'en');
    await expect.poll(() => localizedPage.evaluate(async () => {
      const { indexedDb } = await import('/src/storage/indexedDb.ts');
      return (await indexedDb.getValue<{ locale?: string }>('settings', 'web-preferences'))?.locale;
    })).toBe('en');
    await localizedPage.reload();
    await expect(localizedPage.locator('#app')).not.toHaveAttribute('aria-busy', 'true');
    await expect(localizedPage.locator('html')).toHaveAttribute('lang', 'en');
    await expect(localizedPage.locator('#menu-file-trigger')).toHaveText('File');
  } finally {
    await context.close();
  }
});

test('Issue #178 workspace polish: panels, splitters, menus, Explorer localization, notices, and cancel', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto('/');
  await expect(page.locator('#app')).not.toHaveAttribute('aria-busy', 'true');
  const captureScreenshots = process.env.GUITARDSL_CAPTURE_ISSUE178 === '1'
    && page.context().browser()?.browserType().name() === 'chromium';
  const evidenceDir = '/private/tmp/vscode-guitar-dsl-issue-178';
  const capture = async (name: string): Promise<void> => {
    if (!captureScreenshots) return;
    await mkdir(evidenceDir, { recursive: true });
    await page.screenshot({ path: resolve(evidenceDir, name), fullPage: false });
  };

  await expect(page.locator('#account-button')).toHaveCount(0);
  await expect(page.locator('#account-menu')).toHaveCount(0);
  await expect(page.locator('.grid-splitter')).toHaveCount(4);
  await expect(page.locator('#problems-panel')).toBeVisible();
  await expect(page.locator('#problems-splitter')).toBeVisible();
  await expect(page.locator('#tool-window-count')).toBeHidden();
  expect(await page.locator('#problems-panel').evaluate(element => getComputedStyle(element).borderTopWidth)).toBe('0px');
  expect(await page.locator('#activity-explorer').evaluate(element => getComputedStyle(element).boxShadow)).toBe('none');
  expect(await page.locator('#file-items .file-item[aria-current="page"]').evaluate(element => getComputedStyle(element).boxShadow)).toBe('none');
  expect(await page.locator('#toggle-problems').getAttribute('aria-expanded')).toBe('true');
  expect(await page.locator('#toggle-problems').evaluate(element => getComputedStyle(element).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)');
  expect(await page.locator('#toggle-inspector').getAttribute('aria-pressed')).toBe('true');
  expect(await page.locator('#toggle-inspector').evaluate(element => getComputedStyle(element).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)');
  await capture('problems-open-zero-light.png');

  const center = page.locator('#center-splitter');
  const centerBefore = await center.getAttribute('aria-valuenow');
  const centerBox = await center.boundingBox();
  expect(centerBox).not.toBeNull();
  await page.mouse.move(centerBox!.x + centerBox!.width / 2, centerBox!.y + 48);
  await page.mouse.down();
  await page.mouse.move(centerBox!.x + centerBox!.width / 2 + 88, centerBox!.y + 48, { steps: 6 });
  await page.mouse.up();
  await expect(center).not.toHaveAttribute('aria-valuenow', centerBefore ?? '40');
  const centerAfter = await center.getAttribute('aria-valuenow');
  const sourceWidth = await page.locator('#source-pane').evaluate(element => element.getBoundingClientRect().width);
  const scoreWidth = await page.locator('#score-pane').evaluate(element => element.getBoundingClientRect().width);
  expect(sourceWidth).toBeGreaterThan(0);
  expect(scoreWidth).toBeGreaterThan(0);
  await page.waitForTimeout(350);
  await capture('center-splitter-dragged-light.png');
  await page.reload();
  await expect(page.locator('#app')).not.toHaveAttribute('aria-busy', 'true');
  await expect(page.locator('#center-splitter')).toHaveAttribute('aria-valuenow', centerAfter ?? '40');

  await page.locator('#close-problems').click();
  await expect(page.locator('#problems-panel')).toBeHidden();
  await expect(page.locator('#problems-splitter')).toBeHidden();
  await expect(page.locator('#toggle-problems')).toHaveAttribute('aria-expanded', 'false');
  await capture('problems-closed-light.png');

  const editor = page.getByRole('textbox', { name: 'GuitarDSL source editor' });
  await editor.fill('time: 3/4\n\n[Verse]\nC |\n@time: 7/x\n');
  await expect(page.locator('#tool-window-count')).toBeVisible();
  const errorTotal = Number(await page.locator('#error-count').textContent());
  const warningTotal = Number(await page.locator('#warning-count').textContent());
  await expect(page.locator('#tool-window-count')).toHaveText(String(errorTotal + warningTotal));
  await page.locator('#toggle-problems').click();
  await expect(page.locator('#problems-panel')).toBeVisible();
  await capture('problems-open-positive-light.png');

  expect(await page.locator('.main-menu-bar').evaluate(element => getComputedStyle(element).columnGap)).toBe('4px');
  await page.locator('#menu-view-trigger').focus();
  await page.keyboard.press('ArrowDown');
  const viewMenu = page.locator('#view-menu');
  await expect(viewMenu).toBeVisible();
  await viewMenu.locator('button').first().hover();
  const menuRows = await viewMenu.locator('button').evaluateAll(buttons => buttons.map(button => ({
    height: button.getBoundingClientRect().height,
    highlighted: getComputedStyle(button).backgroundColor === 'rgb(238, 240, 255)',
    checked: button.getAttribute('aria-checked') === 'true'
  })));
  expect(menuRows.every(row => row.height === 32)).toBe(true);
  expect(menuRows.filter(row => row.highlighted)).toHaveLength(1);
  expect(menuRows.some(row => row.checked && row.highlighted)).toBe(false);
  await page.keyboard.press('Escape');

  await page.locator('#settings-button').click();
  await page.getByRole('menuitemradio', { name: 'Theme: Dark' }).click();
  await page.locator('#menu-file-trigger').click();
  const fileMenu = page.locator('#file-menu');
  await expect(fileMenu).toBeVisible();
  await expect(fileMenu.locator('button').first()).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  const saveItem = fileMenu.getByRole('menuitem', { name: /Save/u });
  await expect(saveItem).toBeFocused();
  expect(await saveItem.evaluate(element => getComputedStyle(element).backgroundColor)).toBe('rgb(238, 240, 255)');
  expect(await saveItem.evaluate(element => getComputedStyle(element).color)).toBe('rgb(32, 36, 43)');
  expect(await saveItem.locator('kbd').evaluate(element => getComputedStyle(element).color)).toBe('rgb(77, 86, 100)');
  await capture('dark-menu-focused.png');
  await page.keyboard.press('Escape');

  const selectedFile = page.locator('#file-items .file-item[aria-current="page"]');
  await selectedFile.click({ button: 'right' });
  const contextMenu = page.locator('#context-menu');
  await expect(contextMenu).toBeVisible();
  await capture('context-menu-file.png');
  await page.keyboard.press('Escape');
  await selectedFile.focus();
  await page.keyboard.press('Shift+F10');
  await expect(contextMenu).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(selectedFile).toBeFocused();

  await page.locator('#settings-button').click();
  await page.getByRole('menuitemradio', { name: 'Language: 日本語' }).click();
  await expect(page.locator('#files-heading')).toHaveText('エクスプローラー');
  await expect(page.locator('#activity-explorer')).toHaveAttribute('aria-label', 'エクスプローラーの表示切替');
  await page.locator('#explorer-more').click();
  await expect(page.locator('#panel-menu')).toHaveAttribute('aria-label', 'エクスプローラーのオプション');
  await page.keyboard.press('Escape');
  await capture('explorer-japanese.png');

  const filesBeforeCancel = await page.locator('#file-items .file-item').count();
  const tabsBeforeCancel = await page.locator('.tabs [role="tab"]').count();
  const cancelPrompt = page.waitForEvent('dialog').then(dialog => dialog.dismiss());
  await page.locator('#new-score').click();
  await cancelPrompt;
  await expect(page.locator('#file-items .file-item')).toHaveCount(filesBeforeCancel);
  await expect(page.locator('.tabs [role="tab"]')).toHaveCount(tabsBeforeCancel);
  await expect(page.locator('#app-message')).toHaveCount(0);

  const createPrompt = page.waitForEvent('dialog').then(dialog => {
    expect(dialog.message()).toBe('ファイル名（拡張子なし）');
    expect(dialog.defaultValue()).toBe('Untitled');
    return dialog.accept('Issue 178 demo');
  });
  await page.locator('#new-score').click();
  await createPrompt;
  await expect(page.getByRole('tab', { name: 'Issue 178 demo.guitardsl' })).toBeVisible();
  const snackbar = page.locator('#app-message');
  await expect(snackbar).toHaveText('ローカル楽譜を作成しました。');
  await expect(snackbar).toHaveAttribute('role', 'status');
  expect(await snackbar.evaluate(element => getComputedStyle(element).position)).toBe('fixed');
  expect(await snackbar.locator('button').count()).toBe(0);
  await capture('snackbar-ja.png');
  await page.waitForTimeout(2_000);
  const replacementPrompt = page.waitForEvent('dialog').then(dialog => dialog.accept('Issue 178 replacement.gdsl'));
  await page.locator('#new-score').click();
  await replacementPrompt;
  await expect(page.getByRole('tab', { name: 'Issue 178 replacement.guitardsl' })).toBeVisible();
  await expect(page.locator('#file-items')).toContainText('Issue 178 replacement.guitardsl');
  await expect(page.locator('#file-items')).not.toContainText('Issue 178 replacement.gdsl');
  await expect(snackbar).toHaveText('ローカル楽譜を作成しました。');
  await page.waitForTimeout(3_500);
  await expect(snackbar).toBeVisible();
  await expect(snackbar).toHaveCount(0, { timeout: 5_000 });
});

test('center splitter hover matches the other splitters and the dark view separator is gray', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto('/');
  await expect(page.locator('#app')).not.toHaveAttribute('aria-busy', 'true');
  const captureScreenshots = process.env.GUITARDSL_CAPTURE_ISSUE178 === '1'
    && page.context().browser()?.browserType().name() === 'chromium';
  const evidenceDir = '/private/tmp/vscode-guitar-dsl-issue-178';

  for (const theme of ['Light', 'Dark'] as const) {
    await page.locator('#settings-button').click();
    await page.getByRole('menuitemradio', { name: `Theme: ${theme}` }).click();
    const center = page.locator('#center-splitter');
    const explorer = page.locator('#explorer-splitter');
    await center.hover();
    const centerStyle = await center.evaluate(element => {
      const style = getComputedStyle(element);
      return { background: style.backgroundColor, outline: style.outline, outlineOffset: style.outlineOffset };
    });
    if (captureScreenshots) {
      await mkdir(evidenceDir, { recursive: true });
      await page.screenshot({ path: resolve(evidenceDir, `center-splitter-hover-${theme.toLowerCase()}.png`) });
    }
    await explorer.hover();
    const explorerStyle = await explorer.evaluate(element => {
      const style = getComputedStyle(element);
      return { background: style.backgroundColor, outline: style.outline, outlineOffset: style.outlineOffset };
    });
    expect(centerStyle).toEqual(explorerStyle);
    if (theme === 'Dark') {
      const separator = await page.locator('.view-mode-controls').evaluate(element => getComputedStyle(element).borderLeftColor);
      expect(separator).toBe('rgb(66, 70, 82)');
      if (captureScreenshots) {
        await page.locator('#center-splitter').hover();
        await page.screenshot({ path: resolve(evidenceDir, 'view-controls-divider-dark.png') });
      }
    }
  }
});

test('an empty editor workspace shows only its theme background and restores the selected mode', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto('/');
  await expect(page.getByRole('tab', { name: 'Untitled.guitardsl' })).toBeVisible();
  await page.locator('#view-score').click();
  await expect(page.locator('#view-score')).toHaveAttribute('aria-pressed', 'true');
  for (const theme of ['Light', 'Dark'] as const) {
    await page.locator('#settings-button').click();
    await page.getByRole('menuitemradio', { name: `Theme: ${theme}` }).click();
    if (theme === 'Light') {
      await page.getByRole('button', { name: 'Close Untitled.guitardsl' }).click();
    }
    await expect(page.locator('.tabs')).toBeVisible();
    await expect(page.locator('.tabs').locator('*')).toHaveCount(0);
    await expect(page.locator('.tabs')).toHaveText('');
    const bottomBorderWidth = await page.locator('.tabs').evaluate(element => getComputedStyle(element).borderBottomWidth);
    expect(bottomBorderWidth).toBe('0px');
    const background = await page.locator('.tabs').evaluate(element => getComputedStyle(element).backgroundColor);
    expect(background).toBe('rgba(0, 0, 0, 0)');
    const workspaceBackground = await page.locator('.app-shell').evaluate(element => getComputedStyle(element).backgroundColor);
    expect(workspaceBackground).toBe(theme === 'Light' ? 'rgb(247, 248, 250)' : 'rgb(31, 34, 40)');
    await expect(page.locator('.split-view')).toBeHidden();
    await expect(page.locator('#source-pane')).toBeHidden();
    await expect(page.locator('#score-pane')).toBeHidden();
    if (process.env.GUITARDSL_CAPTURE_ISSUE178 === '1'
      && page.context().browser()?.browserType().name() === 'chromium') {
      const evidenceDir = '/private/tmp/vscode-guitar-dsl-issue-178';
      await mkdir(evidenceDir, { recursive: true });
      await page.screenshot({ path: resolve(evidenceDir, `empty-workspace-${theme.toLowerCase()}.png`) });
    }
  }

  await page.locator('#file-items .file-item').click();
  await expect(page.getByRole('tab', { name: 'Untitled.guitardsl' })).toBeVisible();
  await expect(page.locator('#view-score')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#source-pane')).toBeHidden();
  await expect(page.locator('#score-pane')).toBeVisible();
  await expect(page.locator('#inspector-heading')).toHaveText('Inspector');
  await expect(page.locator('.inspector')).toHaveAttribute('aria-label', 'Inspector');
  await page.locator('#settings-button').click();
  await page.getByRole('menuitemradio', { name: 'Language: 日本語' }).click();
  await expect(page.locator('#inspector-heading')).toHaveText('インスペクタ');
  await expect(page.locator('.inspector')).toHaveAttribute('aria-label', 'インスペクタ');
  if (process.env.GUITARDSL_CAPTURE_ISSUE178 === '1'
    && page.context().browser()?.browserType().name() === 'chromium') {
    const evidenceDir = '/private/tmp/vscode-guitar-dsl-issue-178';
    await mkdir(evidenceDir, { recursive: true });
    await page.screenshot({ path: resolve(evidenceDir, 'inspector-title-japanese.png') });
  }
});

test('Google Drive menu owns the connected account identity and disconnect action', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await installDriveBrowserMock(page, ['ui18-account']);
  await page.goto('/');
  await expect(page.locator('#app')).not.toHaveAttribute('aria-busy', 'true');
  await expect(page.locator('#account-button')).toHaveCount(0);
  await expect(page.locator('#account-menu')).toHaveCount(0);

  const driveButton = page.locator('#connect-drive');
  const driveMenu = page.locator('#drive-menu');
  await driveButton.click();
  await expect(driveMenu).toBeVisible();
  await expect(driveMenu.getByRole('menuitem', { name: 'Connect to Google Drive', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(driveButton).toBeFocused();

  await driveButton.click();
  await page.getByRole('menuitem', { name: 'Connect to Google Drive', exact: true }).click();
  await expect(driveButton).toHaveAttribute('data-state', 'connected');
  await driveButton.click();
  const accountItem = driveMenu.getByRole('menuitem', { name: 'Connected as ui18-account@example.test', exact: true });
  await expect(accountItem).toBeVisible();
  await expect(accountItem).toBeDisabled();
  await expect(driveMenu.getByRole('separator')).toHaveCount(1);
  await expect(driveMenu.getByRole('menuitem', { name: 'Disconnect', exact: true })).toBeEnabled();

  if (process.env.GUITARDSL_CAPTURE_ISSUE178 === '1'
    && page.context().browser()?.browserType().name() === 'chromium') {
    const evidenceDir = '/private/tmp/vscode-guitar-dsl-issue-178';
    await mkdir(evidenceDir, { recursive: true });
    await page.screenshot({ path: resolve(evidenceDir, 'drive-menu-account.png'), fullPage: false });
  }

  await page.keyboard.press('Escape');
  await expect(driveButton).toBeFocused();
  await performAccountAction(page);
  await expect(driveButton).toHaveAttribute('data-state', 'disconnected');
  await driveButton.click();
  await expect(driveMenu.getByRole('menuitem', { name: 'Connect to Google Drive', exact: true })).toBeVisible();
  await expect(driveMenu.getByRole('menuitem', { name: /Connected as/u })).toHaveCount(0);
  await expect(driveMenu.getByRole('menuitem', { name: 'Disconnect', exact: true })).toHaveCount(0);
});

test('supports line numbers, search and replace, deterministic completion, and compiler lint', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#app')).not.toHaveAttribute('aria-busy', 'true');
  await expect(page.getByRole('tab', { name: 'Untitled.guitardsl' })).toBeVisible();
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
  const redoShortcut = await page.evaluate(() => /Mac/u.test(navigator.platform) ? 'Meta+Shift+z' : 'Control+y');
  await editor.press(redoShortcut);
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
      problems: rect('#problems-panel'), toolWindow: rect('.tool-window-bar'),
      toolWindowInspector: rect('#toggle-inspector'), toolWindowProblems: rect('#toggle-problems'), status: rect('.statusbar'),
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
  expect(geometry.toolWindowInspector.x).toBeCloseTo(1568, 1);
  expect(geometry.toolWindowProblems.x).toBeLessThan(geometry.explorer.x);
  expect(geometry.toolWindowInspector.y).toBeLessThan(geometry.toolWindowProblems.y);
  await expect(page.locator('#toggle-inspector')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#toggle-inspector')).toHaveAttribute('title', 'Toggle Inspector');
  await expect(page.locator('#activity-bar #activity-inspector')).toHaveCount(0);
  expect(geometry.status.height).toBe(24);
  await expect(page.locator('.top-actions .web-icon')).toHaveCount(4);
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

test('toggles Inspector from the right tool-window rail and restores its manual state', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#app')).not.toHaveAttribute('aria-busy', 'true');
  const inspectorToggle = page.locator('#toggle-inspector');
  await expect(inspectorToggle).toBeVisible();
  await expect(inspectorToggle).toHaveAttribute('aria-pressed', 'true');
  await expect(inspectorToggle).toHaveAttribute('title', 'Toggle Inspector');
  await inspectorToggle.focus();
  await page.keyboard.press('Space');
  await expect(inspectorToggle).toHaveAttribute('aria-pressed', 'false');
  await expect(inspectorToggle).toBeFocused();
  await expect(page.locator('#workspace')).toHaveClass(/inspector-closed/);
  await page.waitForFunction(async () => {
    const { indexedDb } = await import('/src/storage/indexedDb.ts');
    const preference = await indexedDb.getValue<{ inspectorOpen?: boolean }>('settings', 'web-layout-v1');
    return preference?.inspectorOpen === false;
  });

  await page.reload();
  await expect(page.locator('#app')).not.toHaveAttribute('aria-busy', 'true');
  await expect.poll(() => page.evaluate(async () => {
    const { indexedDb } = await import('/src/storage/indexedDb.ts');
    return (await indexedDb.getValue<{ inspectorOpen?: boolean }>('settings', 'web-layout-v1'))?.inspectorOpen;
  })).toBe(false);
  await expect(inspectorToggle).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#workspace')).toHaveClass(/inspector-closed/);
  await inspectorToggle.focus();
  await page.keyboard.press('Enter');
  await expect(inspectorToggle).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#workspace')).not.toHaveClass(/inspector-closed/);
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
  await expect(page.locator('#toggle-inspector')).toHaveAttribute('aria-pressed', 'true');
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(page.locator('#workspace')).not.toHaveClass(/inspector-auto-hidden/);
  await expect(page.locator('#workspace')).not.toHaveClass(/explorer-auto-hidden/);
});

test('opens Help, Settings, and host-owned context menus from workspace surfaces', async ({ page }) => {
  await page.goto('/');
  const popupPromise = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Help' }).click();
  const helpWindow = await popupPromise;
  await expect(helpWindow.locator('h1')).toContainText('GuitarDSL Help');
  await expect(helpWindow.locator('nav a')).toHaveCount(5);
  await helpWindow.close();

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

test('header menus keep their actions bound to the active editor and switch accessibly', async ({ page }) => {
  await page.goto('/');
  await expectEditorSource(page, /^title: My song/m);
  const triggers = page.locator('.main-menu-bar [role="menuitem"]');
  await expect(triggers).toHaveCount(3);
  await expect(triggers).toHaveText(['File', 'Edit', 'View']);
  await expect(page.getByRole('menuitem', { name: 'Window', exact: true })).toHaveCount(0);

  const editor = page.getByRole('textbox', { name: 'GuitarDSL source editor' });
  const source = await readEditorSource(page);
  await page.locator('#menu-file-trigger').click();
  await expect(page.locator('#file-menu')).toBeVisible();
  const copyDownload = page.locator('#file-menu').getByRole('menuitem', { name: 'Download a copy' });
  const download = page.waitForEvent('download');
  await copyDownload.click();
  expect((await download).suggestedFilename()).toBe('Untitled.guitardsl');
  await expect(page.getByRole('tab', { name: 'Untitled.guitardsl' })).toHaveAttribute('aria-selected', 'true');
  await expectEditorSource(page, source);

  await page.locator('#menu-file-trigger').click();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#edit-menu')).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#view-menu')).toBeVisible();
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('#edit-menu')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#menu-edit-trigger')).toBeFocused();

  await page.locator('#menu-edit-trigger').click();
  await page.locator('#edit-menu').getByRole('menuitem', { name: 'Replace…' }).click();
  await expect(page.locator('.cm-search input[name="replace"]')).toBeFocused();
  await expect(editor).toBeVisible();
  await expectEditorSource(page, source);
  await page.keyboard.press('Escape');

  await page.locator('#menu-view-trigger').click();
  await expect(page.locator('#view-menu').getByRole('menuitemradio', { name: 'Split view' })).toHaveAttribute('aria-checked', 'true');
  await page.locator('#view-menu').getByRole('menuitemradio', { name: 'Source view' }).click();
  await expect(page.locator('#view-source')).toHaveAttribute('aria-pressed', 'true');
  await expectEditorSource(page, source);
});

test('blocked Help popups expose a usable same-origin tab link', async ({ page }) => {
  await page.addInitScript(() => { Object.defineProperty(window, 'open', { configurable: true, value: () => null }); });
  await page.goto('/');
  await page.getByRole('button', { name: 'Help' }).click();
  await expect(page.locator('#help-dialog')).toBeVisible();
  await expect(page.locator('#help-popup-note')).toBeVisible();
  const link = page.getByRole('link', { name: 'Open Help in a new tab' });
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute('href', /^blob:/u);
  await expect(page.locator('#help-toc button')).toHaveCount(5);

  await page.locator('#close-help').click();
  await expect(page.locator('#help-dialog')).toBeHidden();
  await page.locator('#settings-button').click();
  await page.getByRole('menuitemradio', { name: 'Language: 日本語' }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'ja');
  await page.locator('#help-button').click();
  await expect(page.locator('#help-dialog')).toBeVisible();
  await expect(page.locator('#help-title')).toHaveText('ヘルプ');
  await expect(page.locator('#help-direct-link')).toHaveText('ヘルプを新しいタブで開く');
});

test('keeps a partial Google consent disconnected when account lookup would succeed and appData would be forbidden', async ({ page }) => {
  await installDriveBrowserMock(page, ['account-partial'], {
    grantedScopes: 'https://www.googleapis.com/auth/drive.file', failAppDataListCount: 1
  });
  await page.goto('/');
  const connect = page.locator('#connect-drive');
  await connect.click();
  await page.getByRole('menuitem', { name: 'Connect to Google Drive' }).click();
  await expect(connect).toHaveAttribute('data-connected', 'false');
  await expect(page.locator('#app-message')).toContainText('Both Google Drive permissions are required');
});

test('ignores a delayed Drive list failure from the previous account and keeps the current account state', async ({ page }) => {
  const accountAState: TestAppDataState = {
    schemaVersion: 1, selectedFolderId: 'folder-account-a', folderPrompt: 'completed',
    openDriveFileIds: [], activeDriveFileId: null, recentDriveFileIds: []
  };
  const accountBState: TestAppDataState = {
    schemaVersion: 1, selectedFolderId: 'folder-account-b', folderPrompt: 'completed',
    openDriveFileIds: ['drive-b'], activeDriveFileId: 'drive-b', recentDriveFileIds: ['drive-b']
  };
  const bSavedSource = 'title: Account B saved\n';
  const bDraftSource = 'title: Account B local draft\n';
  const drive = await installDriveBrowserMock(page, ['account-a', 'account-b'], {
    appDataStates: { 'account-a': accountAState, 'account-b': accountBState },
    holdDriveListAccountId: 'account-a', unauthorizedListAccountId: 'account-a',
    driveFiles: [{ id: 'drive-b', name: 'Account B song.guitardsl', version: '1', modifiedTime: 't1', mimeType: 'text/plain', parents: ['folder-account-b'] }],
    remoteFiles: { 'drive-b': { name: 'Account B song.guitardsl', source: bSavedSource, version: '1' } }
  });
  await page.goto('/');
  await seedDriveSessions(page, [{
    accountId: 'account-b', fileId: 'drive-b', name: 'Account B song.guitardsl', source: bSavedSource, draftSource: bDraftSource
  }], { appDataStates: { 'account-a': accountAState, 'account-b': accountBState } });
  await performAccountAction(page);
  await drive.driveListStarted;
  await performAccountAction(page);
  await performAccountAction(page);

  const accountBFile = page.locator('#drive-file-items .file-item[data-file-id="drive-b"]');
  await expect(accountBFile).toBeVisible();
  await expect(page.locator('#connect-drive')).toHaveAttribute('data-connected', 'true');
  await expect(page.locator('#drive-scope-note')).toBeVisible();
  await expect(page.locator('#drive-scope-note')).toContainText('files you open with this app or create here');
  await expect(page.locator('#drive-overwrite-note')).toBeVisible();
  await expect(page.locator('#drive-overwrite-note')).toContainText('may overwrite its changes');
  await expectEditorSource(page, bDraftSource);
  if (page.context().browser()?.browserType().name() === 'chromium') {
    await page.setViewportSize({ width: 1600, height: 900 });
    const evidencePath = resolve(process.cwd(), '../docs/status/evidence/issue-174/drive-connection-notices.png');
    await mkdir(dirname(evidencePath), { recursive: true });
    await page.screenshot({ path: evidencePath, fullPage: false });
  }

  const readAccountBDraft = () => page.evaluate(async () => {
    const { indexedDb } = await import('/src/storage/indexedDb.ts');
    return indexedDb.getDraft({ storage: 'drive', fileId: 'drive-b' }, 'account-b');
  });
  await expect.poll(readAccountBDraft).toMatchObject({ source: bDraftSource, revision: 1 });

  const oldAccountListResponse = page.waitForResponse(response => {
    const request = response.request();
    const url = new URL(request.url());
    return url.pathname === '/drive/v3/files'
      && url.searchParams.get('spaces') !== 'appDataFolder'
      && request.headers().authorization === 'Bearer test-token-account-a';
  });
  drive.releaseDriveList();
  expect((await oldAccountListResponse).status()).toBe(401);
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));

  await expect(accountBFile).toBeVisible();
  await expect(page.locator('#connect-drive')).toHaveAttribute('data-connected', 'true');
  await expect(page.locator('#drive-scope-note')).toBeVisible();
  await expect(page.locator('#drive-overwrite-note')).toBeVisible();
  await expectEditorSource(page, bDraftSource);
  await expect.poll(readAccountBDraft).toMatchObject({ source: bDraftSource, revision: 1 });
});

test('rejects a delayed Drive open command from the previous account when file IDs overlap', async ({ page }) => {
  const accountAState: TestAppDataState = {
    schemaVersion: 1, selectedFolderId: 'folder-account-a', folderPrompt: 'completed',
    openDriveFileIds: [], activeDriveFileId: null, recentDriveFileIds: []
  };
  const accountBState: TestAppDataState = {
    schemaVersion: 1, selectedFolderId: 'folder-account-b', folderPrompt: 'completed',
    openDriveFileIds: [], activeDriveFileId: null, recentDriveFileIds: []
  };
  const drive = await installDriveBrowserMock(page, ['account-a', 'account-b'], {
    appDataStates: { 'account-a': accountAState, 'account-b': accountBState },
    driveFiles: [{ id: 'shared-file', name: 'Shared song.guitardsl', version: '1', modifiedTime: 't1',
      mimeType: 'text/plain', parents: ['folder-account-a', 'folder-account-b'] }],
    remoteFiles: { 'shared-file': { name: 'Shared song.guitardsl', source: 'title: Account owned song\n', version: '1' } }
  });
  await page.goto('/');
  const editor = page.getByRole('textbox', { name: 'GuitarDSL source editor' });
  const localSource = 'title: Keep local source active\n';
  await editor.fill(localSource);
  await expect(page.locator('#saved-state')).toHaveText('Local draft saved');

  await performAccountAction(page);
  const accountAFile = page.locator('#drive-file-items .file-item[data-file-id="shared-file"]');
  await expect(accountAFile).toBeVisible();
  await expect(accountAFile).toHaveAttribute('data-account-id', 'account-a');
  const generationA = await page.evaluate(async () => {
    const { workspaceRuntimeController } = await import('/src/workspaceRuntime.ts');
    return workspaceRuntimeController.snapshot().driveGeneration;
  });

  await performAccountAction(page);
  await performAccountAction(page);
  const accountBFile = page.locator('#drive-file-items .file-item[data-file-id="shared-file"]');
  await expect(accountBFile).toBeVisible();
  await expect(accountBFile).toHaveAttribute('data-account-id', 'account-b');
  const generationB = await page.evaluate(async () => {
    const { workspaceRuntimeController } = await import('/src/workspaceRuntime.ts');
    return workspaceRuntimeController.snapshot().driveGeneration;
  });
  expect(generationB).toBeGreaterThan(generationA);
  const readsBeforeStaleCommand = drive.fileReadCount;

  await page.evaluate(async staleGeneration => {
    const { workspaceRuntimeController } = await import('/src/workspaceRuntime.ts');
    await workspaceRuntimeController.dispatch({
      type: 'document.open-drive', identity: { storage: 'drive', fileId: 'shared-file' },
      accountId: 'account-a', driveGeneration: staleGeneration
    });
  }, generationA);

  await expectEditorSource(page, localSource);
  await expect(page.getByRole('tab', { name: 'Shared song.guitardsl' })).toHaveCount(0);
  expect(drive.fileReadCount).toBe(readsBeforeStaleCommand);
});

test('allows leaving an account when its initial appData list is forbidden', async ({ page }) => {
  await installDriveBrowserMock(page, ['account-a', 'account-b'], { failAppDataListCount: 1 });
  await page.goto('/');
  await performAccountAction(page);
  await expect(page.locator('#connect-drive')).toHaveAttribute('data-connected', 'true');
  expect(await acceptPendingDisconnect(page)).toContain('not synchronized');
  await expect(page.locator('#connect-drive')).toHaveAttribute('data-connected', 'false');
  await performAccountAction(page);
  await expect(page.locator('#connect-drive')).toHaveAttribute('data-connected', 'true');
});

test('first Drive sign-in offers folder setup once and remembers Later without creating a folder', async ({ page }) => {
  const drive = await installDriveBrowserMock(page, ['account-a'], { appDataState: null });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  await expect(page.locator('#app')).not.toHaveAttribute('aria-busy', 'true');
  await page.locator('#connect-drive').click();
  await page.getByRole('menuitem', { name: 'Connect to Google Drive' }).click();
  const setup = page.getByRole('dialog');
  await expect(setup.getByRole('heading', { name: 'Set up a Google Drive folder?' })).toBeVisible();
  await expect(setup.getByRole('button')).toHaveText(['Create folder', 'Choose existing folder…', 'Later']);
  const dialogTheme = () => setup.evaluate(element => {
    const style = getComputedStyle(element);
    const createButton = getComputedStyle(element.querySelector('button')!);
    return { colorScheme: style.colorScheme, backgroundColor: style.backgroundColor, color: style.color, createBackground: createButton.backgroundColor };
  });
  await expect.poll(dialogTheme).toEqual({
    colorScheme: 'dark', backgroundColor: 'rgb(36, 40, 48)', color: 'rgb(228, 231, 238)', createBackground: 'rgb(83, 100, 217)'
  });
  await page.emulateMedia({ colorScheme: 'light' });
  await expect.poll(dialogTheme).toEqual({
    colorScheme: 'light', backgroundColor: 'rgb(255, 255, 255)', color: 'rgb(32, 36, 43)', createBackground: 'rgb(83, 100, 217)'
  });
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect.poll(dialogTheme).toEqual({
    colorScheme: 'dark', backgroundColor: 'rgb(36, 40, 48)', color: 'rgb(228, 231, 238)', createBackground: 'rgb(83, 100, 217)'
  });
  await setup.getByRole('button', { name: 'Later' }).click();
  await expect(setup).toBeHidden();
  await expect.poll(() => drive.appDataState?.folderPrompt).toBe('deferred');
  await expect(page.locator('#connect-drive')).toHaveAttribute('data-state', 'connected');
  expect(drive.appDataCreateCount).toBe(1);
  expect(drive.visibleFolderCreateCount).toBe(0);

  await performAccountAction(page);
  await performAccountAction(page);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(drive.appDataCreateCount).toBe(1);
  expect(drive.visibleFolderCreateCount).toBe(0);
});

test('keeps a failed folder change pending across reload and waits for an explicit sync choice', async ({ page }) => {
  const remoteState: TestAppDataState = {
    schemaVersion: 1, selectedFolderId: 'folder-account-a', folderPrompt: 'completed',
    openDriveFileIds: [], activeDriveFileId: null, recentDriveFileIds: []
  };
  const otherAccountState: TestAppDataState = {
    schemaVersion: 1, selectedFolderId: 'folder-account-b', folderPrompt: 'deferred',
    openDriveFileIds: [], activeDriveFileId: null, recentDriveFileIds: []
  };
  const drive = await installDriveBrowserMock(page, ['account-a', 'account-b'], {
    appDataStates: { 'account-a': remoteState, 'account-b': otherAccountState },
    pickerSelection: { id: 'folder-account-a-next', name: 'Next destination' }, failAppDataPatchCount: 1
  });
  await page.goto('/');
  await performAccountAction(page);
  await expect(page.locator('#connect-drive')).toHaveAttribute('data-state', 'connected');

  await page.locator('#storage-drive').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Choose destination folder…' }).click();
  await expect.poll(() => drive.appDataPatchCalls.length).toBe(1);
  await expect.poll(() => drive.appDataState?.selectedFolderId).toBe('folder-account-a');
  await expect(page.locator('#saved-state')).toContainText('could not be synchronized');

  await page.evaluate(() => sessionStorage.setItem('__guitarDslAccountSequence', JSON.stringify(['account-b'])));
  expect(await attemptReloadAndAcceptBeforeUnload(page)).toBe('beforeunload');
  await expect(page.getByRole('tab', { name: 'Untitled.guitardsl' })).toBeVisible();
  expect(drive.appDataPatchCalls).toHaveLength(1);
  expect(drive.getAppDataState('account-a')?.selectedFolderId).toBe('folder-account-a');

  await performAccountAction(page);
  await expect(page.locator('#connect-drive')).toHaveAttribute('data-state', 'connected');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(drive.appDataPatchCalls).toHaveLength(1);
  expect(drive.getAppDataState('account-b')?.selectedFolderId).toBe('folder-account-b');

  await performAccountAction(page);
  await page.evaluate(() => sessionStorage.setItem('__guitarDslAccountSequence', JSON.stringify(['account-a'])));
  await page.reload();
  await expect(page.getByRole('tab', { name: 'Untitled.guitardsl' })).toBeVisible();
  await page.locator('#connect-drive').click();
  await page.getByRole('menuitem', { name: 'Connect to Google Drive' }).click();
  const conflict = page.getByRole('dialog');
  await expect(conflict.getByRole('heading', { name: 'Google Drive settings changed elsewhere' })).toBeVisible();
  expect(drive.appDataPatchCalls).toHaveLength(1);
  expect(drive.getAppDataState('account-a')?.selectedFolderId).toBe('folder-account-a');
  await conflict.getByRole('button', { name: 'Keep this device’s settings' }).click();
  await expect.poll(() => drive.appDataPatchCalls.length).toBe(2);
  await expect.poll(() => drive.appDataState?.selectedFolderId).toBe('folder-account-a-next');
  await expect(page.locator('#saved-state')).not.toContainText('could not be synchronized');
});

test('disconnects after an appData PATCH failure and keeps account-scoped pending state and local drafts', async ({ page }) => {
  const accountAState: TestAppDataState = {
    schemaVersion: 1, selectedFolderId: 'folder-account-a', folderPrompt: 'completed',
    openDriveFileIds: [], activeDriveFileId: null, recentDriveFileIds: []
  };
  const accountBState: TestAppDataState = {
    schemaVersion: 1, selectedFolderId: 'folder-account-b', folderPrompt: 'deferred',
    openDriveFileIds: [], activeDriveFileId: null, recentDriveFileIds: []
  };
  const drive = await installDriveBrowserMock(page, ['account-a', 'account-b'], {
    appDataStates: { 'account-a': accountAState, 'account-b': accountBState },
    pickerSelection: { id: 'folder-account-a-next', name: 'Next destination' }, failAppDataPatchCount: 1
  });
  await page.goto('/');
  await performAccountAction(page);
  const localDraft = 'title: Keep this draft across disconnect\n\n[Verse]\nC | G |\n';
  await page.getByRole('textbox', { name: 'GuitarDSL source editor' }).fill(localDraft);
  await expect(page.locator('#saved-state')).toHaveText('Local draft saved');

  await page.locator('#storage-drive').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Choose destination folder…' }).click();
  await expect.poll(() => drive.appDataPatchCalls.length).toBe(1);
  await expect(page.locator('#saved-state')).toContainText('could not be synchronized');

  expect(await acceptPendingDisconnect(page)).toContain('not synchronized');
  await expect(page.locator('#connect-drive')).toHaveAttribute('data-connected', 'false');
  const pending = await page.evaluate(async () => {
    const { indexedDb } = await import('/src/storage/indexedDb.ts');
    return indexedDb.getValue<{ accountId: string }>('settings', 'pending-drive-state:account-a');
  });
  expect(pending?.accountId).toBe('account-a');

  await performAccountAction(page);
  await expect(page.locator('#connect-drive')).toHaveAttribute('data-connected', 'true');
  await expect(page.locator('#saved-state')).toContainText('Local draft saved');
  expect(drive.getAppDataState('account-b')?.selectedFolderId).toBe('folder-account-b');
  await performAccountAction(page);

  await page.evaluate(() => sessionStorage.setItem('__guitarDslAccountSequence', JSON.stringify(['account-a'])));
  await page.reload();
  await expectEditorSource(page, localDraft);
  await page.locator('#connect-drive').click();
  await page.getByRole('menuitem', { name: 'Connect to Google Drive' }).click();
  const conflict = page.getByRole('dialog');
  await expect(conflict.getByRole('heading', { name: 'Google Drive settings changed elsewhere' })).toBeVisible();
  await conflict.getByRole('button', { name: 'Keep this device’s settings' }).click();
  await expect.poll(() => drive.appDataPatchCalls.length).toBe(2);
  await expect.poll(() => drive.getAppDataState('account-a')?.selectedFolderId).toBe('folder-account-a-next');
  await expectEditorSource(page, localDraft);
  expect(drive.getAppDataState('account-b')?.selectedFolderId).toBe('folder-account-b');
});

test('restores the selected remote folder and Drive tabs without resubmitting the rejected local choice', async ({ page }) => {
  const initial: TestAppDataState = {
    schemaVersion: 1, selectedFolderId: 'folder-account-a', folderPrompt: 'completed',
    openDriveFileIds: [], activeDriveFileId: null, recentDriveFileIds: []
  };
  const latest: TestAppDataState = {
    schemaVersion: 1, selectedFolderId: 'folder-account-a-f2', folderPrompt: 'completed',
    openDriveFileIds: ['drive-f2'], activeDriveFileId: 'drive-f2', recentDriveFileIds: ['drive-f2']
  };
  const drive = await installDriveBrowserMock(page, ['account-a'], {
    appDataState: initial,
    pickerSelection: { id: 'folder-account-a-f3', name: 'Folder F3' },
    folders: { 'folder-account-a': 'Folder F1', 'folder-account-a-f2': 'Folder F2', 'folder-account-a-f3': 'Folder F3' },
    driveFiles: [{ id: 'drive-f2', name: 'Remote F2.guitardsl', version: '1', modifiedTime: 't1', mimeType: 'text/plain', parents: ['folder-account-a-f2'] }],
    remoteFiles: { 'drive-f2': { name: 'Remote F2.guitardsl', source: 'title: Remote F2\n', version: '1' } }
  });
  await page.goto('/');
  const localDraft = 'title: Keep this local draft\n\n[Verse]\nC | G |\n';
  await page.getByRole('textbox', { name: 'GuitarDSL source editor' }).fill(localDraft);
  await expect(page.locator('#saved-state')).toHaveText('Local draft saved');
  await performAccountAction(page);
  drive.setAppDataState('account-a', latest);

  await page.locator('#storage-drive').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Choose destination folder…' }).click();
  const conflict = page.getByRole('dialog');
  await expect(conflict.getByRole('heading', { name: 'Google Drive settings changed elsewhere' })).toBeVisible();
  expect(drive.appDataPatchCalls).toHaveLength(0);
  await conflict.getByRole('button', { name: 'Reload remote' }).click();

  await expect(page.locator('#drive-file-items .drive-folder-row')).toContainText('Folder F2');
  await expect(page.getByRole('tab', { name: 'Remote F2.guitardsl' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Remote F3.guitardsl' })).toHaveCount(0);
  expect(drive.getAppDataState('account-a')?.selectedFolderId).toBe('folder-account-a-f2');
  expect(drive.appDataPatchCalls).toHaveLength(0);
  await page.getByRole('tab', { name: 'Untitled.guitardsl' }).click();
  await expectEditorSource(page, localDraft);
});

test('keeps pending metadata when an explicit remote choice cannot restore its Drive tabs', async ({ page }) => {
  const initial: TestAppDataState = {
    schemaVersion: 1, selectedFolderId: 'folder-account-a', folderPrompt: 'completed',
    openDriveFileIds: [], activeDriveFileId: null, recentDriveFileIds: []
  };
  const latest: TestAppDataState = {
    schemaVersion: 1, selectedFolderId: 'folder-account-a-f2', folderPrompt: 'completed',
    openDriveFileIds: ['drive-missing'], activeDriveFileId: 'drive-missing', recentDriveFileIds: ['drive-missing']
  };
  const drive = await installDriveBrowserMock(page, ['account-a'], {
    appDataState: initial,
    pickerSelection: { id: 'folder-account-a-f3', name: 'Folder F3' },
    folders: { 'folder-account-a': 'Folder F1', 'folder-account-a-f2': 'Folder F2', 'folder-account-a-f3': 'Folder F3' },
    failAppDataPatchCount: 1,
    missingFileIds: ['drive-missing']
  });
  await page.goto('/');
  await performAccountAction(page);
  await page.locator('#storage-drive').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Choose destination folder…' }).click();
  await expect.poll(() => drive.appDataPatchCalls.length).toBe(1);
  await expect(page.locator('#saved-state')).toContainText('could not be synchronized');

  drive.setAppDataState('account-a', latest);
  expect(await attemptReloadAndAcceptBeforeUnload(page)).toBe('beforeunload');
  await expect(page.getByRole('tab', { name: 'Untitled.guitardsl' })).toBeVisible();
  await page.locator('#connect-drive').click();
  await page.getByRole('menuitem', { name: 'Connect to Google Drive' }).click();
  const conflict = page.getByRole('dialog');
  await expect(conflict.getByRole('heading', { name: 'Google Drive settings changed elsewhere' })).toBeVisible();
  const retryPrompt = page.waitForEvent('dialog');
  await conflict.getByRole('button', { name: 'Reload remote' }).click();
  await (await retryPrompt).dismiss();

  const pending = await page.evaluate(async () => {
    const { indexedDb } = await import('/src/storage/indexedDb.ts');
    return indexedDb.getValue<unknown>('settings', 'pending-drive-state:account-a');
  });
  expect(pending).toMatchObject({ accountId: 'account-a', state: { selectedFolderId: 'folder-account-a-f3' } });
  expect(drive.getAppDataState('account-a')?.selectedFolderId).toBe('folder-account-a-f2');
  expect(drive.appDataPatchCalls).toHaveLength(1);
  await expect(page.locator('#saved-state')).toContainText('Pending settings have been kept.');
});

test('cancels delayed Cut and Paste after tab changes or BFCache suspension and keeps Cut as one undo step', async ({ page }) => {
  await installDeferredClipboard(page);
  await page.goto('/');
  const editor = page.getByRole('textbox', { name: 'GuitarDSL source editor' });
  const firstSource = 'title: First tab\n\n[Verse]\nC | G | Am | F |\n';
  const secondSource = 'title: Second tab\n\n[Chorus]\nF | C | G | Am |\n';
  const selectAllShortcut = await page.evaluate(() => /Mac|iPhone|iPad/u.test(navigator.platform) ? 'Meta+A' : 'Control+A');
  await editor.fill(firstSource);
  await page.keyboard.press('Escape');
  await expectEditorSource(page, firstSource);
  const newName = page.waitForEvent('dialog').then(dialog => dialog.accept('Second.guitardsl'));
  await page.getByRole('button', { name: 'New score' }).click();
  await newName;
  await expect(page.getByRole('tab', { name: 'Second.guitardsl' })).toHaveAttribute('aria-selected', 'true');
  await editor.fill(secondSource);
  await page.keyboard.press('Escape');
  await expectEditorSource(page, secondSource);
  await expect.poll(() => page.evaluate(() => (window as Window & {
    __guitarDslReadTabs?: () => Array<{ source: string }>
  }).__guitarDslReadTabs?.().at(-1)?.source)).toBe(secondSource);

  await page.getByRole('tab', { name: 'Untitled.guitardsl' }).click();
  await expectEditorSource(page, firstSource);
  await editor.press(selectAllShortcut);
  await page.evaluate(() => {
    const target = window as Window & { __clipboardHoldWrite?: boolean; __clipboardWriteStarted?: boolean };
    target.__clipboardHoldWrite = true; target.__clipboardWriteStarted = false;
  });
  await page.locator('#menu-edit-trigger').click();
  await page.locator('#edit-menu').getByRole('menuitem', { name: 'Cut' }).click();
  await expect.poll(() => page.evaluate(() => (window as Window & { __clipboardWriteStarted?: boolean }).__clipboardWriteStarted)).toBe(true);
  await page.getByRole('tab', { name: 'Second.guitardsl' }).click();
  await expect(page.getByRole('tab', { name: 'Second.guitardsl' })).toHaveAttribute('aria-selected', 'true');
  await page.evaluate(() => (window as Window & { __releaseClipboardWrite?: () => void }).__releaseClipboardWrite?.());
  await expectEditorSource(page, secondSource);
  await page.getByRole('tab', { name: 'Untitled.guitardsl' }).click();
  await expectEditorSource(page, firstSource);

  await editor.press(selectAllShortcut);
  await page.evaluate(() => {
    const target = window as Window & { __clipboardHoldRead?: boolean; __clipboardReadStarted?: boolean };
    target.__clipboardHoldRead = true; target.__clipboardReadStarted = false;
  });
  await page.locator('#menu-edit-trigger').click();
  await page.locator('#edit-menu').getByRole('menuitem', { name: 'Paste' }).click();
  await expect.poll(() => page.evaluate(() => (window as Window & { __clipboardReadStarted?: boolean }).__clipboardReadStarted)).toBe(true);
  const firstRevisionBeforeBfCache = await page.evaluate(() => (window as Window & {
    __guitarDslReadTabs?: () => Array<{ source: string; revision: number }>
  }).__guitarDslReadTabs?.().find(tab => tab.source.includes('title: First tab'))?.revision);
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
  await expect(page.locator('.app-shell')).toHaveJSProperty('inert', true);
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
  await expect(page.locator('.app-shell')).toHaveJSProperty('inert', false);
  await page.evaluate(() => (window as Window & { __releaseClipboardRead?: () => void }).__releaseClipboardRead?.());
  await expect(page.getByText(/clipboard edit was deferred/i)).toBeVisible();
  await expectEditorSource(page, firstSource);
  expect(await page.evaluate(() => (window as Window & {
    __guitarDslReadTabs?: () => Array<{ source: string; revision: number }>
  }).__guitarDslReadTabs?.().find(tab => tab.source.includes('title: First tab'))?.revision)).toBe(firstRevisionBeforeBfCache);

  await editor.press(selectAllShortcut);
  await page.evaluate(() => {
    const target = window as Window & { __clipboardHoldRead?: boolean; __clipboardReadStarted?: boolean };
    target.__clipboardHoldRead = true; target.__clipboardReadStarted = false;
  });
  await page.locator('#menu-edit-trigger').click();
  await page.locator('#edit-menu').getByRole('menuitem', { name: 'Paste' }).click();
  await expect.poll(() => page.evaluate(() => (window as Window & { __clipboardReadStarted?: boolean }).__clipboardReadStarted)).toBe(true);
  await page.getByRole('tab', { name: 'Second.guitardsl' }).click();
  await expect(page.getByRole('tab', { name: 'Second.guitardsl' })).toHaveAttribute('aria-selected', 'true');
  await page.evaluate(() => (window as Window & { __releaseClipboardRead?: () => void }).__releaseClipboardRead?.());
  await expectEditorSource(page, secondSource);
  await page.getByRole('tab', { name: 'Untitled.guitardsl' }).click();
  await expectEditorSource(page, firstSource);

  await editor.press(selectAllShortcut);
  await page.evaluate(() => { (window as Window & { __clipboardHoldWrite?: boolean }).__clipboardHoldWrite = false; });
  await page.locator('#menu-edit-trigger').click();
  await page.locator('#edit-menu').getByRole('menuitem', { name: 'Cut' }).click();
  await expectEditorSource(page, '');
  await page.locator('#menu-edit-trigger').click();
  await page.locator('#edit-menu').getByRole('menuitem', { name: 'Undo' }).click();
  await expectEditorSource(page, firstSource);
  await page.getByRole('tab', { name: 'Second.guitardsl' }).click();
  await expectEditorSource(page, secondSource);
});

test('reconciles committed local draft baselines and ignores stale write results after BFCache restore', async ({ page }) => {
  await page.goto('/');
  const editor = page.getByRole('textbox', { name: 'GuitarDSL source editor' });
  await expect.poll(() => readFirstWorkspaceTab(page)).toBeDefined();

  const source1 = 'title: BFCache draft one\n\n[Verse]\nC | G | Am | F |\n';
  await installOneShotDraftSaveGate(page, 'fail-now');
  await editor.fill(source1);
  await expect.poll(async () => (await readFirstWorkspaceTab(page))?.saveStatus).toBe('error');
  const beforeSave = await readFirstWorkspaceTab(page);
  expect(beforeSave).toBeDefined();
  expect(beforeSave?.persistedBase.source).not.toBe(source1);

  await installOneShotDraftSaveGate(page, 'commit-then-hold');
  await page.locator('#save-document').click();
  await expect.poll(() => page.evaluate(() => (window as Window & { __draftGateCommitted?: boolean }).__draftGateCommitted)).toBe(true);
  expect(await readFirstWorkspaceDocument(page)).toMatchObject({ source: source1, revision: beforeSave?.revision });
  await roundTripBfCache(page);
  const resumedAfterSave = await readFirstWorkspaceTab(page);
  expect(resumedAfterSave).toMatchObject({ source: source1, revision: beforeSave?.revision, persistedBase: { source: source1 }, saveStatus: 'draft' });
  await releaseDraftSaveGate(page);
  await expect.poll(() => page.evaluate(() => (window as Window & { __draftGateSettled?: boolean }).__draftGateSettled)).toBe(true);

  const source2 = 'title: BFCache draft two\n\n[Verse]\nD | A | Bm | G |\n';
  await editor.fill(source2);
  await expect.poll(async () => (await readFirstWorkspaceDocument(page))?.source).toBe(source2);
  await expect.poll(async () => (await readFirstWorkspaceTab(page))?.saveStatus).toBe('draft');

  const source3 = 'title: BFCache scheduled success\n\n[Verse]\nE | B | C#m | A |\n';
  await installOneShotDraftSaveGate(page, 'commit-then-hold');
  await editor.fill(source3);
  await expect.poll(() => page.evaluate(() => (window as Window & { __draftGateCommitted?: boolean }).__draftGateCommitted)).toBe(true);
  await roundTripBfCache(page);
  expect(await readFirstWorkspaceTab(page)).toMatchObject({ source: source3, persistedBase: { source: source3 }, saveStatus: 'draft' });
  await releaseDraftSaveGate(page);
  await expect.poll(() => page.evaluate(() => (window as Window & { __draftGateSettled?: boolean }).__draftGateSettled)).toBe(true);
  await expect.poll(async () => (await readFirstWorkspaceTab(page))?.saveStatus).toBe('draft');

  const source4 = 'title: BFCache scheduled retry\n\n[Verse]\nF | C | Dm | Bb |\n';
  await installOneShotDraftSaveGate(page, 'fail-then-hold');
  await editor.fill(source4);
  await expect.poll(() => page.evaluate(() => (window as Window & { __draftGateStarted?: boolean }).__draftGateStarted)).toBe(true);
  await roundTripBfCache(page);
  await releaseDraftSaveGate(page);
  await expect.poll(() => page.evaluate(() => (window as Window & { __draftGateSettled?: boolean }).__draftGateSettled)).toBe(true);
  await expect.poll(async () => (await readFirstWorkspaceDocument(page))?.source).toBe(source4);
  await expect.poll(async () => (await readFirstWorkspaceTab(page))?.saveStatus).toBe('draft');
  await expect(page.getByText('Stale scheduled write failed')).toHaveCount(0);

  await page.reload();
  await expectEditorSource(page, source4);
});

test('keeps the BFCache lock when another persisted pagehide interrupts draft reconciliation', async ({ page }) => {
  const drive = await installDriveBrowserMock(page, ['account-a']);
  await installFakeAudio(page);
  await page.goto('/');
  await expect(page.getByRole('tab', { name: 'Untitled.guitardsl' })).toBeVisible();
  await performAccountAction(page);
  await expect.poll(() => drive.driveFileListCount).toBeGreaterThan(0);
  await expect.poll(() => drive.driveFileListPendingCount).toBe(0);
  await page.waitForTimeout(100);
  await expect.poll(() => drive.driveFileListPendingCount).toBe(0);
  const driveListsBeforeSuspension = drive.driveFileListCount;
  await deferNextDraftBaselineRead(page);
  const preview = page.frameLocator('#score-frame');

  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
  await expect(page.locator('.app-shell')).toHaveJSProperty('inert', true);
  await expect(preview.locator('body')).toHaveAttribute('data-progression-audio-locked', 'true');
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
  await expect.poll(() => page.evaluate(() => (window as Window & { __draftBaselineReadStarted?: boolean }).__draftBaselineReadStarted)).toBe(true);

  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
  await expect(page.locator('.app-shell')).toHaveJSProperty('inert', true);
  await expect(preview.locator('body')).toHaveAttribute('data-progression-audio-locked', 'true');
  await releaseDraftBaselineRead(page);
  await expect.poll(() => page.evaluate(() => (window as Window & { __draftBaselineReadSettled?: boolean }).__draftBaselineReadSettled)).toBe(true);
  await expect(page.locator('.app-shell')).toHaveJSProperty('inert', true);
  expect(await page.evaluate(() => (window as Window & { __localListReads?: number }).__localListReads)).toBe(0);
  expect(drive.driveFileListCount).toBe(driveListsBeforeSuspension);
  await expect(preview.locator('body')).toHaveAttribute('data-progression-audio-locked', 'true');

  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
  await expect(page.locator('.app-shell')).toHaveJSProperty('inert', false);
  await expect(preview.locator('body')).toHaveAttribute('data-progression-audio-locked', 'false');
  await expect.poll(() => page.evaluate(() => (window as Window & { __localListReads?: number }).__localListReads ?? 0)).toBeGreaterThan(0);
  await expect.poll(() => drive.driveFileListCount).toBeGreaterThan(driveListsBeforeSuspension);

  const editor = page.getByRole('textbox', { name: 'GuitarDSL source editor' });
  const source = 'title: BFCache final resume\n\n[Verse]\nC | G | Am | F |\n';
  await editor.fill(source);
  await expect.poll(async () => (await readFirstWorkspaceDocument(page))?.source).toBe(source);
});

test('a non-persisted pagehide invalidates a pending BFCache draft reconciliation', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('tab', { name: 'Untitled.guitardsl' })).toBeVisible();
  await expect(page.locator('#app')).not.toHaveAttribute('aria-busy', 'true');
  await deferNextDraftBaselineRead(page);

  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
  await expect(page.locator('.app-shell')).toHaveJSProperty('inert', true);
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
  await expect.poll(() => page.evaluate(() => (window as Window & { __draftBaselineReadStarted?: boolean }).__draftBaselineReadStarted)).toBe(true);
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false })));

  await releaseDraftBaselineRead(page);
  await expect.poll(() => page.evaluate(() => (window as Window & { __draftBaselineReadSettled?: boolean }).__draftBaselineReadSettled)).toBe(true);
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
  await expect(page.locator('.app-shell')).toHaveJSProperty('inert', true);
  expect(await page.evaluate(() => (window as Window & { __localListReads?: number }).__localListReads)).toBe(0);
});

test('coalesces a user close with remote tab restoration while the Drive draft save is pending', async ({ page }) => {
  const initial: TestAppDataState = {
    schemaVersion: 1, selectedFolderId: 'folder-account-a', folderPrompt: 'completed',
    openDriveFileIds: ['drive-shared'], activeDriveFileId: 'drive-shared', recentDriveFileIds: ['drive-shared']
  };
  const drive = await installDriveBrowserMock(page, ['account-a'], {
    appDataState: initial,
    pickerSelection: { id: 'folder-account-a-next', name: 'Next destination' },
    driveFiles: [{ id: 'drive-shared', name: 'Shared.guitardsl', version: '1', modifiedTime: 't1', mimeType: 'text/plain', parents: ['folder-account-a'] }],
    remoteFiles: { 'drive-shared': { name: 'Shared.guitardsl', source: 'title: Shared\n', version: '1' } }
  });
  await page.goto('/');
  await performAccountAction(page);
  await expect(page.getByRole('tab', { name: 'Shared.guitardsl' })).toBeVisible();
  const driveDraft = 'title: Preserve this Drive draft\n\n[Verse]\nAm | F |\n';
  await page.getByRole('textbox', { name: 'GuitarDSL source editor' }).fill(driveDraft);
  await expect(page.locator('#saved-state')).toHaveText('Local draft saved');

  await holdDraftSave(page);
  await page.locator('.tab-close[aria-label="Close Shared.guitardsl"]').click();
  await page.waitForFunction(() => (window as Window & { __draftSaveStarted?: boolean }).__draftSaveStarted === true);
  drive.setAppDataState('account-a', { ...initial, openDriveFileIds: [], activeDriveFileId: null });

  await page.locator('#storage-drive').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Choose destination folder…' }).click();
  const conflict = page.getByRole('dialog');
  await expect(conflict.getByRole('heading', { name: 'Google Drive settings changed elsewhere' })).toBeVisible();
  await conflict.getByRole('button', { name: 'Reload remote' }).click();
  await expect(page.getByRole('tab', { name: 'Shared.guitardsl' })).toBeVisible();
  await expect(page.locator('#saved-state')).not.toContainText('Drive tabs could not be restored');
  await expect(page.locator('#app-message')).not.toContainText('Could not preserve the draft while restoring Drive tabs');

  await page.evaluate(() => (window as Window & { __releaseDraftSave?: () => void }).__releaseDraftSave?.());
  await expect(page.getByRole('tab', { name: 'Shared.guitardsl' })).toHaveCount(0);
  await expect(page.getByRole('tab', { name: 'Untitled.guitardsl' })).toBeVisible();
  const recovered = await page.evaluate(async () => {
    const { indexedDb } = await import('/src/storage/indexedDb.ts');
    const row = await indexedDb.getDocument({ storage: 'drive', fileId: 'drive-shared' }, 'account-a');
    return row?.source;
  });
  expect(recovered).toBe(driveDraft);
});

test('handles concurrent tab closes without dropping drafts while concurrent Drive opens share one tab', async ({ page }) => {
  await installDriveBrowserMock(page, ['account-a'], {
    driveFiles: [{ id: 'drive-shared', name: 'Shared.guitardsl', version: '1', modifiedTime: 't1', mimeType: 'text/plain', parents: ['folder-account-a'] }],
    remoteFiles: { 'drive-shared': { name: 'Shared.guitardsl', source: 'title: Shared\n', version: '1' } }
  });
  await page.goto('/');
  const editor = page.getByRole('textbox', { name: 'GuitarDSL source editor' });
  const sources = [
    'title: First draft\n\n[Verse]\nC | G |\n',
    'title: Second draft\n\n[Verse]\nAm | F |\n',
    'title: Third draft\n\n[Verse]\nG | C |\n'
  ];
  await editor.fill(sources[0]!);
  await expectEditorSource(page, sources[0]!);
  const secondPrompt = page.waitForEvent('dialog').then(dialog => dialog.accept('Second.guitardsl'));
  await page.getByRole('button', { name: 'New score' }).click(); await secondPrompt;
  await expect(page.getByRole('tab', { name: 'Second.guitardsl' })).toHaveAttribute('aria-selected', 'true');
  await editor.fill(sources[1]!);
  await expectEditorSource(page, sources[1]!);
  const thirdPrompt = page.waitForEvent('dialog').then(dialog => dialog.accept('Third.guitardsl'));
  await page.getByRole('button', { name: 'New score' }).click(); await thirdPrompt;
  await expect(page.getByRole('tab', { name: 'Third.guitardsl' })).toHaveAttribute('aria-selected', 'true');
  await editor.fill(sources[2]!);
  await expectEditorSource(page, sources[2]!);

  await holdDraftSave(page);
  await page.evaluate(() => {
    document.querySelector<HTMLButtonElement>('.tab-close[aria-label="Close Untitled.guitardsl"]')?.click();
    document.querySelector<HTMLButtonElement>('.tab-close[aria-label="Close Second.guitardsl"]')?.click();
  });
  await page.waitForFunction(() => (window as Window & { __draftSaveStarted?: boolean }).__draftSaveStarted === true);
  await page.evaluate(() => (window as Window & { __releaseDraftSave?: () => void }).__releaseDraftSave?.());
  await expect(page.locator('#open-tabs').getByRole('tab')).toHaveCount(1);
  await expect(page.getByRole('tab', { name: 'Third.guitardsl' })).toBeVisible();
  const recoveredDrafts = await page.evaluate(async () => {
    const { indexedDb } = await import('/src/storage/indexedDb.ts');
    return Promise.all((await indexedDb.listDocuments('local')).map(async row => ({
      name: row.name, source: (await indexedDb.getDocument(row.identity))?.source
    })));
  });
  expect(recoveredDrafts.find(row => row.name === 'Untitled.guitardsl')?.source).toBe(sources[0]);
  expect(recoveredDrafts.find(row => row.name === 'Second.guitardsl')?.source).toBe(sources[1]);
  expect(recoveredDrafts.find(row => row.name === 'Third.guitardsl')?.source).toBe(sources[2]);

  await performAccountAction(page);
  await expect(page.locator('#drive-file-items .file-item').filter({ hasText: 'Shared.guitardsl' })).toBeVisible();
  await page.evaluate(async () => {
    const { indexedDb } = await import('/src/storage/indexedDb.ts');
    const original = indexedDb.getSavedDocument.bind(indexedDb);
    const target = window as Window & { __savedDocumentReads?: number; __releaseSavedDocumentReads?: () => void };
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    target.__savedDocumentReads = 0;
    target.__releaseSavedDocumentReads = release;
    indexedDb.getSavedDocument = async (...args) => {
      target.__savedDocumentReads = (target.__savedDocumentReads ?? 0) + 1;
      await gate;
      return original(...args);
    };
  });
  await page.locator('#drive-file-items .file-item').filter({ hasText: 'Shared.guitardsl' }).evaluate(element => {
    (element as HTMLElement).click(); (element as HTMLElement).click();
  });
  await page.waitForFunction(() => (window as Window & { __savedDocumentReads?: number }).__savedDocumentReads !== undefined
    && (window as Window & { __savedDocumentReads?: number }).__savedDocumentReads! >= 2);
  await page.evaluate(() => (window as Window & { __releaseSavedDocumentReads?: () => void }).__releaseSavedDocumentReads?.());
  await expect(page.getByRole('tab', { name: 'Shared.guitardsl' })).toHaveCount(1);
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
  await expect(page.getByRole('menuitem', { name: 'Connect to Google Drive' })).toBeEnabled();
  await page.keyboard.press('Escape');
  await expect(driveRoot).toBeFocused();

  const file = page.locator('#file-items .file-item').first();
  await file.click({ button: 'right' });
  await expect(page.locator('#context-menu').getByRole('menuitem')).toHaveText([
    'Open', 'Rename', 'Duplicate', 'Download', 'Download as PDF', 'Delete'
  ]);
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

test('opens Explorer and Inspector option menus with Shift+F10 and the Context Menu key', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#app')).not.toHaveAttribute('aria-busy', 'true');
  const workspace = page.locator('#workspace');
  const explorerOptions = page.locator('#explorer-more');
  const inspectorOptions = page.locator('#inspector-more');
  const menuItems = page.locator('#panel-menu').getByRole('menuitem');

  await page.locator('#explorer-splitter').focus();
  await page.keyboard.press('End');
  await expect(workspace).toHaveCSS('--explorer-width', '420px');
  await explorerOptions.focus();
  await page.keyboard.press('Shift+F10');
  await expect(menuItems).toHaveText(['Import file', 'Close Explorer', 'Reset Explorer Width (220px)']);
  await expect(menuItems.first()).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(menuItems.nth(1)).toBeFocused();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await expect(workspace).toHaveCSS('--explorer-width', '220px');

  await explorerOptions.focus();
  await page.keyboard.press('ContextMenu');
  await expect(menuItems.first()).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(explorerOptions).toBeFocused();

  await explorerOptions.focus();
  await page.keyboard.press('Shift+F10');
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(workspace).toHaveClass(/explorer-closed/u);
  await expect(page.locator('#activity-explorer')).toBeFocused();
  await page.locator('#activity-explorer').click();
  await expect(workspace).not.toHaveClass(/explorer-closed/u);

  await page.locator('#inspector-splitter').focus();
  await page.keyboard.press('End');
  await expect(workspace).not.toHaveCSS('--inspector-width', '300px');
  await inspectorOptions.focus();
  await page.keyboard.press('ContextMenu');
  await expect(menuItems).toHaveText(['Close Inspector', 'Reset width to default']);
  await expect(menuItems.first()).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(menuItems.nth(1)).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(workspace).toHaveCSS('--inspector-width', '300px');

  await inspectorOptions.focus();
  await page.keyboard.press('Shift+F10');
  await page.keyboard.press('Home');
  await page.keyboard.press('Enter');
  await expect(workspace).toHaveClass(/inspector-closed/u);
  await expect(page.locator('#toggle-inspector')).toBeFocused();
  await page.locator('#toggle-inspector').click();
  await expect(workspace).not.toHaveClass(/inspector-closed/u);

  await inspectorOptions.focus();
  await page.keyboard.press('Shift+F10');
  await page.keyboard.press('Escape');
  await expect(inspectorOptions).toBeFocused();
});

test('uses compact Explorer, Inspector, and Problems panel controls', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto('/');
  await expect(page.locator('#files-heading')).toHaveText('EXPLORER');
  await expect(page.locator('[data-storage-section="local"] .root-icon use')).toHaveAttribute('href', '#ic-folder');
  await expect(page.locator('[data-storage-section="drive"] .drive-root-icon')).toHaveAttribute('src', /google-drive-2026-color/u);
  await expect(page.locator('.storage-root-label.selected')).toHaveCount(0);
  await expect(page.locator('#storage-local')).not.toHaveAttribute('aria-pressed', /.*/u);
  await expect(page.locator('#file-items .file-item[aria-current="page"]')).toHaveCount(1);
  await expect(page.locator('#file-items .file-item .web-icon use').first()).toHaveAttribute('href', '#ic-file');

  await page.locator('[data-storage-expander="local"]').click();
  await expect(page.locator('#local-storage-content')).toBeHidden();
  await expect(page.locator('[data-storage-expander="local"] .web-icon use')).toHaveAttribute('href', '#ic-right');
  await page.locator('[data-storage-expander="local"]').click();

  await page.locator('#explorer-splitter').focus();
  await page.keyboard.press('End');
  await page.locator('#explorer-more').click();
  const explorerItems = page.locator('#panel-menu').getByRole('menuitem');
  await expect(explorerItems).toHaveText(['Import file', 'Close Explorer', 'Reset Explorer Width (220px)']);
  await page.getByRole('menuitem', { name: 'Reset Explorer Width (220px)' }).click();
  await expect(page.locator('#workspace')).toHaveCSS('--explorer-width', '220px');
  await page.locator('#explorer-more').click();
  await page.getByRole('menuitem', { name: 'Close Explorer' }).click();
  await expect(page.locator('#workspace')).toHaveClass(/explorer-closed/u);
  await page.locator('#activity-explorer').click();
  await expect(page.locator('#workspace')).not.toHaveClass(/explorer-closed/u);

  await page.locator('#inspector-splitter').focus();
  await page.keyboard.press('End');
  await page.locator('#inspector-more').click();
  await expect(page.locator('#panel-menu').getByRole('menuitem')).toHaveText(['Close Inspector', 'Reset width to default']);
  await page.getByRole('menuitem', { name: 'Reset width to default' }).click();
  await expect(page.locator('#workspace')).toHaveCSS('--inspector-width', '300px');
  await page.locator('#inspector-more').click();
  await page.getByRole('menuitem', { name: 'Close Inspector' }).click();
  await expect(page.locator('#workspace')).toHaveClass(/inspector-closed/u);
  await page.locator('#toggle-inspector').click();
  await expect(page.locator('#workspace')).not.toHaveClass(/inspector-closed/u);

  await page.getByRole('textbox', { name: 'GuitarDSL source editor' }).fill('time: 3/4\n\n[Verse]\nC |\n@time: 7/x\n');
  await expect(page.locator('#error-count')).not.toHaveText('0');
  await expect(page.locator('#warning-count')).toHaveText('0');
  await expect(page.locator('#problems-panel')).toHaveCSS('grid-row', '3');
  await expect(page.locator('#problem-columns')).toHaveText('SeverityFileLine:ColMessage');
  await expect(page.locator('.problem-severity .web-icon use').first()).toHaveAttribute('href', '#ic-error');
  expect(await page.locator('.problem-row').evaluate(element => getComputedStyle(element).gridTemplateColumns))
    .toBe(await page.locator('.problem-columns').evaluate(element => getComputedStyle(element).gridTemplateColumns));
  await expect(page.locator('.problem-row')).toHaveCSS('grid-template-columns', /^74px \d+(?:\.\d+)?px 72px \d+(?:\.\d+)?px$/u);
  await page.locator('#problems-splitter').focus();
  await page.keyboard.press('ArrowUp');
  await expect(page.locator('#workspace')).toHaveCSS('--problems-height', '210px');
  await page.locator('#close-problems').click();
  await expect(page.locator('#workspace')).toHaveClass(/problems-collapsed/u);
  await page.locator('#toggle-problems').click();
  await expect(page.locator('#workspace')).not.toHaveClass(/problems-collapsed/u);
  await expect(page.locator('#workspace')).toHaveCSS('--problems-height', '210px');
});

for (const locale of ['en', 'ja'] as const) {
  test(`keeps the Drive root 32px tall across auth states (${locale})`, async ({ page }) => {
    await installDriveBrowserMock(page, ['account-a'], {
      appDataState: { schemaVersion: 1, selectedFolderId: null, folderPrompt: 'deferred', openDriveFileIds: [], activeDriveFileId: null, recentDriveFileIds: [] },
      pickerSelection: { id: 'folder-account-a', name: 'GuitarDSL' }, unauthorizedList: true
    });
    await page.goto('/');
    const copy = locale === 'ja'
      ? { language: 'Language: 日本語', settings: 'Settings', connectMenu: 'Google Drive に接続', connect: '接続', connecting: '接続中…', folder: '保存先フォルダーを選択…', reconnect: 'Drive に再接続' }
      : { language: '', settings: '', connectMenu: 'Connect to Google Drive', connect: 'Connect', connecting: 'Connecting…', folder: 'Choose destination folder…', reconnect: 'Reconnect Drive' };
    if (locale === 'ja') {
      await page.getByRole('button', { name: copy.settings }).click();
      await page.getByRole('menuitemradio', { name: copy.language }).click();
    }
    const driveRoot = page.locator('[data-storage-section="drive"] .storage-root-row');
    const connect = page.locator('#drive-connect-inline');
    const expectRootHeight = async (): Promise<void> => { await expect(driveRoot).toHaveCSS('height', '32px'); };
    const expectTextOnlyConnect = async (label: string): Promise<void> => {
      await expect(connect).toHaveText(label);
      await expect(connect.locator('.web-icon')).toHaveCount(0);
      await expect(connect).toHaveCSS('white-space', 'nowrap');
      await expect(connect).toHaveCSS('height', '26px');
    };

    await expectRootHeight();
    await expectTextOnlyConnect(copy.connect);
    await page.evaluate((connectingLabel: string) => {
      const target = window as Window & { __driveConnectingRootHeights?: number[] };
      const button = document.querySelector<HTMLButtonElement>('#drive-connect-inline')!;
      const root = button.closest<HTMLElement>('.storage-root-row')!;
      const heights = target.__driveConnectingRootHeights = [];
      new MutationObserver(() => {
        if (button.getAttribute('aria-label') === connectingLabel) {
          heights.push(root.getBoundingClientRect().height);
        }
      }).observe(button, { attributes: true, attributeFilter: ['aria-label'] });
    }, copy.connecting);
    await page.locator('#connect-drive').click();
    await page.getByRole('menuitem', { name: copy.connectMenu }).click();
    await expect(page.locator('#drive-status')).toBeVisible();
    await expect(connect).toBeHidden();
    await expectRootHeight();
    const connectingHeights = await page.evaluate(() => (window as Window & { __driveConnectingRootHeights?: number[] }).__driveConnectingRootHeights ?? []);
    expect(connectingHeights.length).toBeGreaterThan(0);
    expect(connectingHeights.every(height => Math.abs(height - 32) <= 1)).toBe(true);

    await page.locator('#storage-drive').click({ button: 'right' });
    await page.getByRole('menuitem', { name: copy.folder }).click();
    await expect(connect).toBeVisible();
    await expectTextOnlyConnect(copy.reconnect);
    await expectRootHeight();
    expect((await connect.getAttribute('title'))?.startsWith(copy.reconnect)).toBe(true);
  });
}

test('connects and reconnects from the Google Drive root menu', async ({ page }) => {
  const mockOptions: DriveBrowserMockOptions = {
    appDataState: { schemaVersion: 1, selectedFolderId: null, folderPrompt: 'deferred', openDriveFileIds: [], activeDriveFileId: null, recentDriveFileIds: [] },
    pickerSelection: { id: 'folder-account-a', name: 'GuitarDSL' }, unauthorizedList: true
  };
  await installDriveBrowserMock(page, ['account-a'], mockOptions);
  await page.goto('/');
  await expect(page.locator('#app')).not.toHaveAttribute('aria-busy', 'true');
  const driveRoot = page.locator('#storage-drive');
  await driveRoot.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Connect to Google Drive' }).click();
  await expect(page.locator('#drive-status')).toBeVisible();

  await driveRoot.click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: 'Choose destination folder…' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Create GuitarDSL folder…' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Open from Google Drive…' })).toBeVisible();
  await page.keyboard.press('Escape');
  await driveRoot.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Choose destination folder…' }).click();
  await expect(page.locator('#connect-drive')).toHaveAttribute('data-state', 'reauth');
  await driveRoot.click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: 'Reconnect Drive' })).toBeVisible();
  mockOptions.unauthorizedList = false;
  await page.getByRole('menuitem', { name: 'Reconnect Drive' }).click();
  await expect(page.locator('#connect-drive')).toHaveAttribute('data-connected', 'true');
});

test('selects only the active Explorer file across local and Drive identities', async ({ page }) => {
  await installDriveBrowserMock(page, ['account-a'], {
    pickerSelection: { id: 'folder-account-a', name: 'GuitarDSL Songs' },
    remoteFiles: {
      'drive-one': { name: 'Cloud One.guitardsl', source: 'title: Cloud One\n', version: '1' },
      'drive-two': { name: 'Cloud Two.guitardsl', source: 'title: Cloud Two\n', version: '1' }
    },
    driveFiles: [
      { id: 'drive-one', name: 'Cloud One.guitardsl', version: '1', modifiedTime: '2026-11-15T00:00:00.000Z', mimeType: 'text/plain', parents: ['folder-account-a'] },
      { id: 'drive-two', name: 'Cloud Two.guitardsl', version: '1', modifiedTime: '2026-11-15T00:00:00.000Z', mimeType: 'text/plain', parents: ['folder-account-a'] }
    ]
  });
  await page.goto('/');
  await expect(page.locator('#drive-status')).toBeHidden();
  await expect(page.locator('#drive-connect-inline')).toHaveText('Connect');
  const prompt = page.waitForEvent('dialog').then(dialog => dialog.accept('Second Local.guitardsl'));
  await page.locator('#new-score').click();
  await prompt;
  await expect(page.locator('#file-items .file-item[aria-current="page"]')).toHaveCount(1);
  await expect(page.locator('#drive-file-items .file-item[aria-current="page"]')).toHaveCount(0);

  await performAccountAction(page);
  await expect(page.locator('#drive-status')).toBeVisible();
  await expect(page.locator('#drive-connect-inline')).toBeHidden();
  await page.locator('#storage-drive').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Choose destination folder…' }).click();
  await expect(page.locator('#drive-file-items .file-item')).toHaveCount(2);
  await expect(page.locator('#drive-file-items .file-item[aria-current="page"]')).toHaveCount(0);

  await page.locator('#drive-file-items .file-item').filter({ hasText: 'Cloud Two.guitardsl' }).click();
  await expect(page.getByRole('tab', { name: 'Cloud Two.guitardsl' })).toBeVisible();
  await expect(page.locator('#drive-file-items .file-item[aria-current="page"]')).toHaveCount(1);
  await expect(page.locator('#drive-file-items .file-item[aria-current="page"]')).toHaveAttribute('data-file-id', 'drive-two');
  await expect(page.locator('#file-items .file-item[aria-current="page"]')).toHaveCount(0);

  const localFile = page.locator('#file-items .file-item').filter({ hasText: 'Second Local.guitardsl' });
  await localFile.click();
  await expect(localFile).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('#drive-file-items .file-item[aria-current="page"]')).toHaveCount(0);
});

test('performs local file Explorer menu actions against the clicked file', async ({ page }) => {
  await page.goto('/');
  const initialSource = 'title: Menu target\n\n[Verse]\nC | G | Am | F |\n';
  await page.evaluate(async source => {
    const { indexedDb } = await import('/src/storage/indexedDb.ts');
    await indexedDb.createLocal('Menu target.guitardsl', source);
    await indexedDb.createLocal('Menu target(1).guitardsl', 'title: Existing collision\n');
    (window as Window & { __guitarDslRenderAll?: () => void }).__guitarDslRenderAll?.();
  }, initialSource);
  const target = page.locator('#file-items .file-item').filter({ hasText: 'Menu target.guitardsl' });
  await expect(target).toBeVisible();

  await target.click({ button: 'right' });
  await expect(page.locator('#context-menu').getByRole('menuitem')).toHaveText([
    'Open', 'Rename', 'Duplicate', 'Download', 'Download as PDF', 'Delete'
  ]);
  await page.getByRole('menuitem', { name: 'Open', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Menu target.guitardsl' })).toHaveAttribute('aria-selected', 'true');
  await expectEditorSource(page, initialSource);

  const targetSource = 'title: Updated target source\n\n[Verse]\nAm | F | C | G |\n';
  await page.getByRole('textbox', { name: 'GuitarDSL source editor' }).fill(targetSource);
  await expectEditorSource(page, targetSource);
  await expect(page.locator('#saved-state')).toHaveText('Local draft saved');

  const otherPrompt = page.waitForEvent('dialog').then(dialog => dialog.accept('Other.guitardsl'));
  await page.getByRole('button', { name: 'New score' }).click();
  await otherPrompt;
  const otherTab = page.getByRole('tab', { name: 'Other.guitardsl' });
  await expect(otherTab).toBeVisible();
  await expect(otherTab).toHaveAttribute('aria-selected', 'true');
  const otherSource = 'title: Other active tab\n\n[Verse]\nG | C | F | Am |\n';
  await page.getByRole('textbox', { name: 'GuitarDSL source editor' }).fill(otherSource);
  await expectEditorSource(page, otherSource);
  await page.getByRole('tab', { name: 'Menu target.guitardsl' }).click();
  await expectEditorSource(page, targetSource);
  await page.getByRole('tab', { name: 'Other.guitardsl' }).click();
  await expectEditorSource(page, otherSource);

  await target.click({ button: 'right' });
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: 'Download', exact: true }).click();
  const sourceDownload = await downloadPromise;
  expect(sourceDownload.suggestedFilename()).toBe('Menu target.guitardsl');
  expect(await readFile((await sourceDownload.path())!, 'utf8')).toBe(targetSource);

  await target.click({ button: 'right' });
  const pdfDownloadPromise = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: 'Download as PDF', exact: true }).click();
  const pdfDownload = await pdfDownloadPromise;
  expect(pdfDownload.suggestedFilename()).toBe('Menu target.pdf');
  expect((await readFile((await pdfDownload.path())!)).subarray(0, 4).toString('ascii')).toBe('%PDF');
  expect(await page.evaluate(() => (window as Window & { __guitarDslReadLastPdfInput?: () => string }).__guitarDslReadLastPdfInput?.()))
    .toBe(targetSource);

  await target.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Duplicate', exact: true }).click();
  const duplicate = page.locator('#file-items .file-item').filter({ hasText: 'Menu target(2).guitardsl' });
  await expect(duplicate).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Menu target(2).guitardsl' })).toHaveAttribute('aria-selected', 'true');
  await expectEditorSource(page, targetSource);
  const duplicateData = await page.evaluate(async () => {
    const { indexedDb } = await import('/src/storage/indexedDb.ts');
    const row = (await indexedDb.listDocuments('local')).find(item => item.name === 'Menu target(2).guitardsl');
    return row ? (await indexedDb.getDocument(row.identity))?.source : undefined;
  });
  expect(duplicateData).toBe(targetSource);

  await page.getByRole('tab', { name: 'Menu target.guitardsl' }).click();
  await target.click({ button: 'right' });
  const cancelledRename = page.waitForEvent('dialog').then(dialog => dialog.dismiss());
  await page.getByRole('menuitem', { name: 'Rename', exact: true }).click();
  await cancelledRename;
  await expect(target).toBeVisible();

  await target.click({ button: 'right' });
  const emptyRename = page.waitForEvent('dialog').then(dialog => dialog.accept('   '));
  await page.getByRole('menuitem', { name: 'Rename', exact: true }).click();
  await emptyRename;
  await expect(target).toBeVisible();

  await target.click({ button: 'right' });
  const renamePrompt = page.waitForEvent('dialog').then(async dialog => {
    expect(dialog.defaultValue()).toBe('Menu target');
    await dialog.accept('Renamed target.gdsl');
  });
  await page.getByRole('menuitem', { name: 'Rename', exact: true }).click();
  await renamePrompt;
  const renamed = page.locator('#file-items .file-item').filter({ hasText: 'Renamed target.guitardsl' });
  await expect(renamed).toBeVisible();
  await expect(page.locator('#file-items .file-item').filter({ hasText: 'Renamed target.gdsl' })).toHaveCount(0);
  await expect(page.getByRole('tab', { name: 'Renamed target.guitardsl' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Menu target.guitardsl' })).toHaveCount(0);
  if (process.env.GUITARDSL_CAPTURE_ISSUE178 === '1'
    && page.context().browser()?.browserType().name() === 'chromium') {
    const evidenceDir = '/private/tmp/vscode-guitar-dsl-issue-178';
    await page.getByRole('button', { name: 'Score view' }).click();
    await expect(page.locator('#workspace')).toHaveClass(/view-score/);
    await expect(page.locator('.cm-tooltip-autocomplete')).toBeHidden();
    await expect(page.locator('#app-message')).toHaveCount(0, { timeout: 5_000 });
    await mkdir(evidenceDir, { recursive: true });
    await page.screenshot({ path: resolve(evidenceDir, 'rename-preserved-extension.png'), fullPage: true });
  }

  await renamed.click({ button: 'right' });
  const firstConfirmation = page.waitForEvent('dialog').then(async dialog => {
    const type = dialog.type();
    await dialog.dismiss();
    return type;
  });
  await page.getByRole('menuitem', { name: 'Delete', exact: true }).click();
  expect(await firstConfirmation).toBe('confirm');
  await expect(renamed).toBeVisible();

  await renamed.click({ button: 'right' });
  const secondConfirmation = page.waitForEvent('dialog').then(async dialog => {
    const type = dialog.type();
    await dialog.accept();
    return type;
  });
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  expect(await secondConfirmation).toBe('confirm');
  await expect(renamed).toHaveCount(0);
  await expect(page.getByRole('tab', { name: 'Renamed target.guitardsl' })).toHaveCount(0);
});

test('moves a local file to Google Drive only after verified upload', async ({ page }) => {
  const mockOptions: DriveBrowserMockOptions = { remoteFiles: {}, driveFiles: [] };
  await installDriveBrowserMock(page, ['move-menu-account'], mockOptions);
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto('/');
  const source = 'title: Move from local\n\n[Verse]\nC | G | Am | F |\n';
  const local = await page.evaluate(async sourceText => {
    const { indexedDb } = await import('/src/storage/indexedDb.ts');
    const document = await indexedDb.createLocal('Move me.guitardsl', sourceText);
    (window as Window & { __guitarDslRenderAll?: () => void }).__guitarDslRenderAll?.();
    return document.identity;
  }, source);
  const localFile = page.locator('#file-items .file-item').filter({ hasText: 'Move me.guitardsl' });
  await expect(localFile).toBeVisible();
  await localFile.click({ button: 'right' });
  await expect(page.locator('#context-menu').getByRole('menuitem')).toHaveText([
    'Open', 'Rename', 'Duplicate', 'Download', 'Download as PDF', 'Delete'
  ]);
  await page.keyboard.press('Escape');

  await performAccountAction(page);
  mockOptions.remoteFiles!['created-drive-copy'] = { name: 'Move me.guitardsl', source, version: '1' };
  await localFile.click({ button: 'right' });
  await expect(page.locator('#context-menu').getByRole('menuitem')).toHaveText([
    'Open', 'Rename', 'Duplicate', 'Download', 'Download as PDF', 'Move to Google Drive', 'Delete'
  ]);
  if (test.info().project.name === 'chromium') {
    const screenshotPath = test.info().outputPath('local-file-context-menu.png');
    await expect(page.locator('#app-message')).toHaveCount(0, { timeout: 7000 });
    await mkdir(dirname(screenshotPath), { recursive: true });
    await page.screenshot({ path: screenshotPath, fullPage: true });
  }
  await page.getByRole('menuitem', { name: 'Move to Google Drive', exact: true }).click();
  await expect(localFile).toHaveCount(0);
  const driveFile = page.locator('#drive-file-items .file-item').filter({ hasText: 'Move me.guitardsl' });
  await expect(driveFile).toBeVisible();
  const result = await page.evaluate(async identity => {
    const { indexedDb } = await import('/src/storage/indexedDb.ts');
    const docs = await indexedDb.listDocuments('drive', 'move-menu-account');
    return { local: await indexedDb.getDocument(identity), drive: docs.map(row => ({ name: row.name, source: row.source })) };
  }, local);
  expect(result.local).toBeUndefined();
  expect(result.drive).toContainEqual({ name: 'Move me.guitardsl', source });
});

test('uses Preview bindings only in Edit mode for source navigation and rejects a stale menu target', async ({ page }) => {
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
  await expect(preview.locator('.spread-sheet [data-visual-binding]')).toHaveCount(0);
  await preview.locator('#preview-mode-select').selectOption('edit');
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
  await preview.locator('#preview-mode-select').selectOption('normal');
  await expect(preview.locator('.spread-sheet [data-visual-binding]')).toHaveCount(0);
  await preview.locator('body').click({ button: 'right', position: { x: 2, y: 110 } });
  await expect(page.getByRole('menuitem', { name: 'Go to source position' })).toBeDisabled();
  await expect(page.getByRole('menuitem', { name: 'Download PDF' })).toBeVisible();
  await page.keyboard.press('Escape');

  await preview.locator('#preview-mode-select').selectOption('edit');
  await expect(boundElement).toBeVisible();
  await boundElement.click({ button: 'right' });
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
  await expect(connect).toHaveAttribute('data-connected', 'true');
  await page.locator('#storage-drive').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Open from Google Drive…' }).click();
  await drive.fileReadStarted;

  await performAccountAction(page);
  await expect(connect).toHaveAttribute('data-connected', 'false');
  await performAccountAction(page);
  await expect(connect).toHaveAttribute('data-connected', 'true');
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
  await expect(connect).toHaveAttribute('data-connected', 'true');
  await page.locator('#storage-drive').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Open from Google Drive…' }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __pickerOpened?: boolean }).__pickerOpened)).toBe(true);

  await performAccountAction(page);
  await expect(connect).toHaveAttribute('data-connected', 'false');
  await performAccountAction(page);
  await expect(connect).toHaveAttribute('data-connected', 'true');
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
  }], { appDataState: {
    schemaVersion: 1, selectedFolderId: 'folder-account-a', folderPrompt: 'completed',
    openDriveFileIds: [], activeDriveFileId: null, recentDriveFileIds: []
  } });
  await page.evaluate(async () => {
    const { indexedDb } = await import('/src/storage/indexedDb.ts');
    await indexedDb.setValue('sessions', 'workspace-drive:account-a', { tabs: [], active: null });
  });
  await performAccountAction(page);
  await expect(page.locator('#connect-drive')).toHaveAttribute('data-connected', 'true');
  await page.locator('#storage-drive').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Open from Google Drive…' }).click();

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
  await expect(page.locator('#connect-drive')).toHaveAttribute('data-state', 'reauth');
  expect(drive.patchCalls).toHaveLength(1);
  expect(drive.createCount).toBe(0);

  await performAccountAction(page);
  await expect(page.locator('#connect-drive')).toHaveAttribute('data-connected', 'true');
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
  await expect(page.locator('#connect-drive')).toHaveAttribute('data-connected', 'true');
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
  let remoteVersion = 1;
  let holdRemoteRead = false;
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
      if (holdRemoteRead) {
        markMediaStarted();
        await mediaGate;
        return route.fulfill({ headers, body: 'title: Remote latest\n' });
      }
      return route.fulfill({ headers, body: 'title: Base\n' });
    }
    return route.fulfill({ headers, json: {
      id: 'drive-conflict', name: 'Conflict.guitardsl', version: String(remoteVersion), modifiedTime: `t${remoteVersion}`,
      headRevisionId: `r${remoteVersion}`, parents: ['folder-account-a']
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
  remoteVersion = 2;
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  holdRemoteRead = true;
  await page.getByRole('button', { name: 'Reload latest' }).click();
  await mediaStarted;

  const newSource = 'title: Typed during remote reload\n';
  await editor.fill(newSource);
  await expect(page.locator('#saved-state')).toHaveText('Local draft saved');
  releaseMedia();
  await expectEditorSource(page, newSource);
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
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
  let remoteVersion = 1;
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
      id: 'drive-conflict', name: 'Song.guitardsl', version: String(remoteVersion), modifiedTime: `t${remoteVersion}`,
      headRevisionId: `r${remoteVersion}`, parents: ['folder-account-a']
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
  remoteVersion = 2;
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
  await expect(page.locator('#new-score')).toBeVisible();

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
  const leaveGuarded = await page.evaluate(() => {
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(leaveGuarded).toBe(true);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('button', { name: 'Download PDF' }).click();
  expect(await page.evaluate(() => (window as unknown as { __guitarDslReadLastPdfInput?: () => string | undefined }).__guitarDslReadLastPdfInput?.())).toBeUndefined();
  const savedWhileComposing = await page.evaluate(async fileId => {
    const { indexedDb } = await import('/src/storage/indexedDb.ts');
    return (await indexedDb.getDocument({ storage: 'local', fileId }))?.source;
  }, savedDuringComposition);
  expect(savedWhileComposing).toBe(savedBeforeComposition);
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

test('flushes same-task source edits before Save and PDF snapshots', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#app')).not.toHaveAttribute('aria-busy', 'true');

  await page.evaluate(async () => {
    const { indexedDb } = await import('/src/storage/indexedDb.ts');
    const commitLocal = indexedDb.commitLocal.bind(indexedDb);
    const target = window as unknown as {
      __localCommitStarted?: boolean;
      __localCommitSnapshot?: { source: string; revision: number };
      __releaseLocalCommit?: () => void;
    };
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    target.__releaseLocalCommit = release;
    indexedDb.commitLocal = async (...args) => {
      target.__localCommitSnapshot = { source: args[0].source, revision: args[0].revision };
      target.__localCommitStarted = true;
      await gate;
      return commitLocal(...args);
    };
  });

  const saveSource = 'title: Same-task Save snapshot\n\n[Verse]\nAm | F | C | G |\n';
  const dispatchedSave = await page.evaluate(source => {
    const target = window as unknown as {
      __guitarDslDispatchSourceEdit?: (value: string) => boolean;
    };
    const dispatched = target.__guitarDslDispatchSourceEdit?.(source) ?? false;
    const leave = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(leave);
    document.querySelector<HTMLButtonElement>('#save-document')!.click();
    return { dispatched, leaveGuarded: leave.defaultPrevented };
  }, saveSource);
  expect(dispatchedSave).toEqual({ dispatched: true, leaveGuarded: true });
  await page.waitForFunction(() => (window as unknown as { __localCommitStarted?: boolean }).__localCommitStarted === true);

  const draftState = await page.evaluate(async () => {
    const { indexedDb } = await import('/src/storage/indexedDb.ts');
    const target = window as unknown as {
      __guitarDslReadTabs?: () => Array<{ source: string; revision: number }>;
      __localCommitSnapshot?: { source: string; revision: number };
    };
    const saved = (await indexedDb.listDocuments('local'))[0];
    return {
      tab: target.__guitarDslReadTabs?.()[0],
      commit: target.__localCommitSnapshot,
      saved: await indexedDb.getSavedDocument(saved.identity),
      draft: await indexedDb.getDraft(saved.identity)
    };
  });
  expect(draftState.tab).toMatchObject({ source: saveSource, revision: 1 });
  expect(draftState.commit).toEqual({ source: saveSource, revision: 1 });
  expect(draftState.saved?.revision).toBe(0);
  expect(draftState.draft).toMatchObject({ source: saveSource, revision: 1 });

  await page.evaluate(() => (window as unknown as { __releaseLocalCommit?: () => void }).__releaseLocalCommit?.());
  await expect(page.locator('#saved-state')).toHaveText('Saved locally');
  const committed = await page.evaluate(async () => {
    const { indexedDb } = await import('/src/storage/indexedDb.ts');
    const saved = (await indexedDb.listDocuments('local'))[0];
    return { row: await indexedDb.getSavedDocument(saved.identity), draft: await indexedDb.getDraft(saved.identity) };
  });
  expect(committed.row).toMatchObject({ source: saveSource, revision: 1 });
  expect(committed.draft).toBeUndefined();

  const pdfSource = 'title: Same-task PDF snapshot\n\n[Verse]\nF | Dm | G | C |\n';
  const downloadPromise = page.waitForEvent('download');
  const dispatchedPdf = await page.evaluate(source => {
    const target = window as unknown as {
      __guitarDslDispatchSourceEdit?: (value: string) => boolean;
    };
    const dispatched = target.__guitarDslDispatchSourceEdit?.(source) ?? false;
    document.querySelector<HTMLButtonElement>('#download-pdf')!.click();
    return dispatched;
  }, pdfSource);
  expect(dispatchedPdf).toBe(true);
  expect(await page.evaluate(() => (window as unknown as { __guitarDslReadLastPdfInput?: () => string | undefined }).__guitarDslReadLastPdfInput?.())).toBe(pdfSource);
  const pdf = await downloadPromise;
  expect(pdf.suggestedFilename()).toBe('Untitled.pdf');
  const pdfPath = await pdf.path();
  expect(pdfPath).not.toBeNull();
  expect((await readFile(pdfPath!)).subarray(0, 5).toString('latin1')).toBe('%PDF-');
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

test('preserves the mounted workspace and locale across persisted page transitions while stopping audio', async ({ page }) => {
  await installFakeAudio(page);
  await page.goto('/');
  await expect(page.getByRole('tab', { name: 'Untitled.guitardsl' })).toBeVisible();
  const editor = page.getByRole('textbox', { name: 'GuitarDSL source editor' });
  const preview = page.frameLocator('#score-frame');
  const priorRevision = Number(await preview.locator('body').getAttribute('data-preview-document-version'));
  await editor.fill('key: C\n\n[Verse]\nC | G | Am | F |\n');
  await expect.poll(async () => Number(await preview.locator('body').getAttribute('data-preview-document-version')))
    .toBeGreaterThan(priorRevision);
  await expect(preview.locator('body')).toHaveAttribute('data-preview-interactions-ready', 'true');
  await preview.locator('#btn-play').click();
  await expect(preview.locator('#btn-pause')).toBeEnabled();
  await expect(page.locator('.app-shell')).toHaveJSProperty('inert', false);
  const originalEditor = await editor.evaluateHandle(element => element);

  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
  await expect(page.locator('.app-shell')).toHaveJSProperty('inert', true);
  await expect(preview.locator('body')).toHaveAttribute('data-progression-audio-locked', 'true');
  await expect(preview.locator('#btn-pause')).toBeDisabled();

  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
  await expect(page.locator('.app-shell')).toHaveJSProperty('inert', false);
  await expect(preview.locator('body')).toHaveAttribute('data-progression-audio-locked', 'false');
  await expect(preview.locator('#btn-play')).toBeEnabled();
  await expect(preview.locator('#btn-pause')).toBeDisabled();
  expect(await editor.evaluate((element, original) => element === original, originalEditor)).toBe(true);

  await page.getByRole('tab', { name: 'Progression' }).click();
  await expect(page.locator('#candidate-list li').first()).toBeVisible();
  await page.getByRole('button', { name: 'Audition' }).click();
  const audioStatus = page.locator('#progression-audio-status');
  await expect(audioStatus).toHaveText('Audition playing.');
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
  await expect(page.locator('.app-shell')).toHaveJSProperty('inert', true);
  await expect(audioStatus).toHaveText('Audition stopped.');
  await expect(preview.locator('body')).toHaveAttribute('data-progression-audio-locked', 'true');
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
  await expect(page.locator('.app-shell')).toHaveJSProperty('inert', false);
  await expect(preview.locator('body')).toHaveAttribute('data-progression-audio-locked', 'false');
  await expect(audioStatus).toHaveText('Audition stopped.');
  await expect(preview.locator('#btn-play')).toBeEnabled();
  await expect(preview.locator('#btn-pause')).toBeDisabled();
  expect(await editor.evaluate((element, original) => element === original, originalEditor)).toBe(true);
  await editor.fill('title: Workspace resumed\n');
  await expect(page.locator('.cm-content')).toContainText('Workspace resumed');

  await page.locator('#settings-button').click();
  await page.getByRole('menuitemradio', { name: 'Language: 日本語' }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'ja');
  const sourceBeforeLocaleResume = await readEditorSource(page);
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
  await expect(page.locator('.app-shell')).toHaveJSProperty('inert', true);
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
  await expect(page.locator('.app-shell')).toHaveJSProperty('inert', false);
  await expect(page.locator('html')).toHaveAttribute('lang', 'ja');
  await expectEditorSource(page, sourceBeforeLocaleResume);
  expect(await page.locator('.cm-content').evaluate((element, original) => element === original, originalEditor)).toBe(true);
});

