const state = {
  tokenRequests: 0,
  pickerOpened: false,
  driveRequests: [],
  pdfBlob: undefined,
  download: undefined,
  downloadInvocationCount: 0,
  localScoreCreationCount: 0,
  localScoreName: 'Safari recovery.guitardsl'
};
window.__guitardslSafariSmoke = state;
Object.defineProperty(navigator, 'language', { configurable: true, value: 'en-US' });
Object.defineProperty(navigator, 'languages', { configurable: true, value: ['en-US'] });
window.prompt = () => {
  state.localScoreCreationCount += 1;
  return state.localScoreName;
};

class FakeParam {
  value = 0;
  setValueAtTime(value) { this.value = value; }
  linearRampToValueAtTime(value) { this.value = value; }
  cancelScheduledValues() {}
}
class FakeGain {
  gain = new FakeParam();
  connect() {}
  disconnect() {}
}
class FakeOscillator {
  type = 'sine';
  frequency = new FakeParam();
  onended = null;
  constructor(context) { this.context = context; }
  connect() {}
  disconnect() {}
  start() {}
  stop(when = 0) {
    window.setTimeout(() => this.onended?.(), Math.max(0, when - this.context.currentTime) * 1000);
  }
}
class FakeAudioContext {
  currentTime = 0;
  state = 'running';
  destination = {};
  createGain() { return new FakeGain(); }
  createOscillator() { return new FakeOscillator(this); }
  resume() { return Promise.resolve(); }
  close() { this.state = 'closed'; return Promise.resolve(); }
}
Object.defineProperty(window, 'AudioContext', { configurable: true, value: FakeAudioContext });

const originalCreateObjectURL = URL.createObjectURL.bind(URL);
URL.createObjectURL = blob => {
  state.pdfBlob = blob;
  return originalCreateObjectURL(blob);
};
HTMLAnchorElement.prototype.click = function () {
  state.downloadInvocationCount += 1;
  state.download = { filename: this.download, href: this.href, invocation: state.downloadInvocationCount };
};

window.google = {
  accounts: {
    oauth2: {
      initTokenClient(options) {
        return {
          requestAccessToken() {
            state.tokenRequests += 1;
            options.callback({
              access_token: 'safari-smoke-token', expires_in: 3600,
              scope: 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.appdata'
            });
          }
        };
      },
      hasGrantedAllScopes(response, ...scopes) {
        return scopes.every(scope => response.scope.split(/\s+/u).includes(scope));
      },
      revoke(_token, callback) { callback?.(); }
    }
  },
  picker: {
    ViewId: { FOLDERS: 'folders', DOCS: 'docs' },
    Feature: { NAV_HIDDEN: 'nav-hidden', MULTISELECT_ENABLED: 'multi-select' },
    Action: { PICKED: 'picked', CANCEL: 'cancel' },
    Response: { ACTION: 'action', DOCUMENTS: 'documents' },
    DocsView: class { setIncludeFolders() {} setSelectFolderEnabled() {} setMimeTypes() {} },
    PickerBuilder: class {
      setCallback(callback) { this.callback = callback; return this; }
      addView() { return this; }
      setDeveloperKey() { return this; }
      setAppId() { return this; }
      setOAuthToken() { return this; }
      setOrigin() { return this; }
      enableFeature() { return this; }
      build() {
        return { setVisible: visible => {
          if (!visible) return;
          state.pickerOpened = true;
          this.callback?.({ action: 'picked', documents: [{ id: 'safari-file', name: 'Safari Smoke.guitardsl' }] });
        } };
      }
    }
  }
};
window.gapi = { load: (_name, callbacks) => callbacks.callback() };

const driveFile = {
  id: 'safari-file', name: 'Safari Smoke.guitardsl', mimeType: 'text/plain', version: '1',
  modifiedTime: '2026-11-14T00:00:00.000Z', headRevisionId: 'safari-revision-1', parents: ['safari-source-folder']
};
const myDriveRootId = 'safari-my-drive-root';
const driveFolder = {
  id: 'safari-folder', name: 'GuitarDSL', mimeType: 'application/vnd.google-apps.folder', parents: [myDriveRootId],
  trashed: false, appProperties: { guitardslLibraryRoot: '1' }
};
const driveSource = 'title: Safari Drive mock\n\n[Verse]\nAm | F | C | G |\n';
const appDataFileId = 'safari-app-state';
let appDataVersion = 1;
let appDataState;
let importedDriveFile;
const appDataMetadata = () => ({
  id: appDataFileId, name: 'guitardsl-state-v1.json', mimeType: 'application/json',
  createdTime: '2026-11-15T00:00:00.000Z', version: String(appDataVersion), modifiedTime: `app-${appDataVersion}`
});
const json = value => new Response(JSON.stringify(value), { status: 200, headers: { 'Content-Type': 'application/json' } });
const originalFetch = window.fetch.bind(window);
window.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url, location.href);
  if (url.origin !== 'https://www.googleapis.com') return originalFetch(input, init);
  const method = (init.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
  state.driveRequests.push({ method, path: url.pathname, query: url.search });
  const requestBody = async () => {
    if (typeof init.body === 'string') return init.body;
    if (init.body instanceof Blob) return init.body.text();
    if (input instanceof Request) return input.clone().text();
    return '';
  };
  const parseAppData = body => [...body.matchAll(/\{[^{}]*\}/gu)].map(match => match[0]).map(value => {
    try { return JSON.parse(value); } catch { return undefined; }
  }).find(value => value?.schemaVersion === 1 && Array.isArray(value.openDriveFileIds));
  if (url.pathname === '/drive/v3/about') return json({ user: { permissionId: 'safari-smoke', emailAddress: 'safari-smoke@example.test' } });
  if (url.pathname === '/drive/v3/files/root') return route.fulfill({ status: 404, headers, json: { error: 'My Drive root metadata is unavailable under drive.file' } });
  if (url.pathname === '/drive/v3/files' && method === 'GET') {
    if (url.searchParams.get('spaces') === 'appDataFolder') return json({ files: appDataState ? [appDataMetadata()] : [] });
    const query = url.searchParams.get('q') ?? '';
    if (query.includes("name='GuitarDSL'")) return json({ files: [driveFolder] });
    if (query.includes("'safari-folder' in parents")) return json({ files: importedDriveFile ? [importedDriveFile] : [] });
    return json({ files: [driveFile] });
  }
  if (url.pathname === `/drive/v3/files/${appDataFileId}`) {
    if (!appDataState) return new Response('', { status: 404 });
    return url.searchParams.get('alt') === 'media' ? json(appDataState) : json(appDataMetadata());
  }
  if (url.pathname === '/drive/v3/files/safari-folder') {
    return json(driveFolder);
  }
  if (url.pathname === '/drive/v3/files/safari-file') {
    return url.searchParams.get('alt') === 'media'
      ? new Response(driveSource, { status: 200, headers: { ETag: '"safari-etag"' } })
      : json(driveFile);
  }
  if (url.pathname === '/drive/v3/files/safari-file/copy' && method === 'POST') {
    const request = JSON.parse(await requestBody());
    importedDriveFile = {
      id: 'safari-copy', name: request.name, mimeType: 'text/plain', version: '1',
      modifiedTime: '2026-11-15T00:00:00.000Z', headRevisionId: 'safari-copy-revision', parents: ['safari-folder'],
      appProperties: request.appProperties
    };
    return json(importedDriveFile);
  }
  if (url.pathname === '/drive/v3/files/safari-copy') {
    return url.searchParams.get('alt') === 'media'
      ? new Response(driveSource, { status: 200, headers: { ETag: '"safari-copy-etag"' } })
      : json(importedDriveFile ?? { id: 'safari-copy', name: 'Safari Smoke.guitardsl', mimeType: 'text/plain', parents: ['safari-folder'] });
  }
  if (url.pathname === '/upload/drive/v3/files' && method === 'POST' && url.searchParams.get('uploadType') === 'multipart') {
    appDataState = parseAppData(await requestBody());
    if (!appDataState) return new Response(JSON.stringify({ error: 'Missing appData state JSON' }), { status: 400 });
    return json(appDataMetadata());
  }
  if (url.pathname === `/upload/drive/v3/files/${appDataFileId}` && method === 'PATCH') {
    const candidate = parseAppData(await requestBody());
    if (!candidate) return new Response(JSON.stringify({ error: 'Invalid appData state JSON' }), { status: 400 });
    appDataState = candidate;
    appDataVersion += 1;
    return json(appDataMetadata());
  }
  if (url.pathname.startsWith('/upload/drive/v3/files')) return json({ ...driveFile, version: '2' });
  return new Response(JSON.stringify({ error: `Unhandled Safari mock request: ${method} ${url.pathname}` }), {
    status: 404, headers: { 'Content-Type': 'application/json' }
  });
};

window.__failLocalDraftWrites = async () => {
  const { indexedDb } = await import('/src/storage/indexedDb.ts');
  indexedDb.saveDraft = async () => { throw new DOMException('Injected Safari smoke storage failure', 'QuotaExceededError'); };
};
