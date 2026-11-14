const state = {
  tokenRequests: 0,
  pickerOpened: false,
  driveRequests: [],
  pdfBlob: undefined,
  download: undefined
};
window.__guitardslSafariSmoke = state;
Object.defineProperty(navigator, 'language', { configurable: true, value: 'en-US' });
Object.defineProperty(navigator, 'languages', { configurable: true, value: ['en-US'] });

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
  state.download = { filename: this.download, href: this.href };
  // Do not write a test download into the user's Downloads folder.
};

window.google = {
  accounts: {
    oauth2: {
      initTokenClient(options) {
        return {
          requestAccessToken() {
            state.tokenRequests += 1;
            options.callback({ access_token: 'safari-smoke-token', expires_in: 3600 });
          }
        };
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
  modifiedTime: '2026-11-14T00:00:00.000Z', headRevisionId: 'safari-revision-1', parents: ['safari-folder']
};
const driveSource = 'title: Safari Drive mock\n\n[Verse]\nAm | F | C | G |\n';
const json = value => new Response(JSON.stringify(value), { status: 200, headers: { 'Content-Type': 'application/json' } });
const originalFetch = window.fetch.bind(window);
window.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url, location.href);
  if (url.origin !== 'https://www.googleapis.com') return originalFetch(input, init);
  const method = (init.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
  state.driveRequests.push({ method, path: url.pathname, query: url.search });
  if (url.pathname === '/drive/v3/about') return json({ user: { permissionId: 'safari-smoke', emailAddress: 'safari-smoke@example.test' } });
  if (url.pathname === '/drive/v3/files' && method === 'GET') return json({ files: [driveFile] });
  if (url.pathname === '/drive/v3/files/safari-folder') {
    return json({ id: 'safari-folder', name: 'GuitarDSL', mimeType: 'application/vnd.google-apps.folder' });
  }
  if (url.pathname === '/drive/v3/files/safari-file') {
    return url.searchParams.get('alt') === 'media'
      ? new Response(driveSource, { status: 200, headers: { ETag: '"safari-etag"' } })
      : json(driveFile);
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
