import assert from 'node:assert/strict';
import test from 'node:test';
import type { GoogleOAuth } from '../../src/auth/googleOAuth';
import { DriveApiError, GoogleDriveApi, type DriveFile } from '../../src/storage/googleDrive';

function createApi() {
  const auth = { tokenForRequest: () => 'test-token' } as unknown as GoogleOAuth;
  return new GoogleDriveApi(auth);
}

test('one Drive file read keeps the account token it started with across its metadata and media requests', async () => {
  let token = 'account-a-token';
  let releaseMetadata!: () => void;
  let markMetadataStarted!: () => void;
  const metadataStarted = new Promise<void>(resolve => { markMetadataStarted = resolve; });
  const metadataGate = new Promise<void>(resolve => { releaseMetadata = resolve; });
  const auth = { tokenForRequest: () => token } as unknown as GoogleOAuth;
  const api = new GoogleDriveApi(auth);
  const originalFetch = globalThis.fetch;
  const authorizationHeaders: string[] = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    authorizationHeaders.push(new Headers(init?.headers).get('Authorization') ?? '');
    if (url.searchParams.get('alt') === 'media') return new Response('account A source', { status: 200 });
    markMetadataStarted();
    await metadataGate;
    return new Response(JSON.stringify({ id: 'drive-a', name: 'A.guitardsl', version: '1', modifiedTime: 't1' }), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    });
  };
  try {
    const opening = api.getFile('drive-a');
    await metadataStarted;
    token = 'account-b-token';
    releaseMetadata();
    const result = await opening;
    assert.equal(result.source, 'account A source');
    assert.deepEqual(authorizationHeaders, ['Bearer account-a-token', 'Bearer account-a-token']);
  } finally { globalThis.fetch = originalFetch; }
});

test('Drive listing paginates, scopes to the selected folder, and filters unsupported names', async () => {
  const api = createApi();
  const originalFetch = globalThis.fetch;
  const calls: URL[] = [];
  globalThis.fetch = async (input, init) => {
    calls.push(new URL(String(input)));
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer test-token');
    const page = calls.length === 1
      ? { nextPageToken: 'page-2', files: [{ id: '1', name: 'one.guitardsl', mimeType: 'text/plain', version: '1', modifiedTime: 'a' }] }
      : { files: [
        { id: '2', name: 'two.gdsl', mimeType: 'text/plain', version: '1', modifiedTime: 'b' },
        { id: '3', name: 'ignore.txt', mimeType: 'text/plain', version: '1', modifiedTime: 'c' },
        { id: '4', name: 'folder.guitardsl', mimeType: 'application/vnd.google-apps.folder', version: '1', modifiedTime: 'd' }
      ] };
    return new Response(JSON.stringify(page), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    const files = await api.listFiles('folder-id');
    assert.deepEqual(files.map(file => file.id), ['1', '2']);
    assert.equal(calls.length, 2);
    assert.match(calls[0].searchParams.get('q')!, /'folder-id' in parents and trashed=false/);
    assert.equal(calls[1].searchParams.get('pageToken'), 'page-2');
    assert.doesNotMatch(calls[0].href, /test-token/);
  } finally { globalThis.fetch = originalFetch; }
});

test('Drive list surfaces authorization and access-scope errors without hiding their status', async () => {
  const api = createApi();
  const originalFetch = globalThis.fetch;
  try {
    for (const status of [401, 403]) {
      globalThis.fetch = async () => new Response('', { status });
      await assert.rejects(api.listFiles('folder-id'), error => error instanceof DriveApiError && error.status === status);
    }
  } finally { globalThis.fetch = originalFetch; }
});

test('Drive save reports a newer remote version without uploading', async () => {
  const api = createApi();
  const originalFetch = globalThis.fetch;
  let uploads = 0;
  globalThis.fetch = async (input, init) => {
    if (init?.method === 'PATCH') uploads += 1;
    return new Response(JSON.stringify({ id: 'drive-1', name: 'Song.guitardsl', version: '8', modifiedTime: 'new', headRevisionId: 'rev-8' }), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    });
  };
  try {
    const result = await api.updateFile({
      id: 'drive-1', name: 'Song.guitardsl', version: '7', modifiedTime: 'old', headRevisionId: 'rev-7'
    }, 'local source');
    assert.deepEqual(result, { kind: 'conflict', latest: { id: 'drive-1', name: 'Song.guitardsl', version: '8', modifiedTime: 'new', headRevisionId: 'rev-8' } });
    assert.equal(uploads, 0);
  } finally { globalThis.fetch = originalFetch; }
});

test('Drive save uses the media update endpoint after version checks', async () => {
  const api = createApi();
  const originalFetch = globalThis.fetch;
  const calls: { url: string; method: string; headers: Headers }[] = [];
  const current: DriveFile = { id: 'drive-1', name: 'Song.guitardsl', version: '7', modifiedTime: 'same', headRevisionId: 'rev-7' };
  globalThis.fetch = async (input, init) => {
    calls.push({ url: String(input), method: init?.method ?? 'GET', headers: new Headers(init?.headers) });
    return new Response(JSON.stringify({ ...current, version: calls.length > 1 ? '8' : current.version }), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    });
  };
  try {
    const result = await api.updateFile(current, 'next source');
    assert.equal(result.kind, 'saved');
    assert.equal(calls[1].method, 'PATCH');
    assert.match(calls[1].url, /upload\/drive\/v3\/files\/drive-1\?uploadType=media/);
    assert.equal(calls[1].headers.get('Authorization'), 'Bearer test-token');
  } finally { globalThis.fetch = originalFetch; }
});

test('repeated saves update the same Drive file and never create another file', async () => {
  const api = createApi();
  const originalFetch = globalThis.fetch;
  let version = 7;
  let source = 'original';
  let creates = 0;
  const patchIds: string[] = [];
  const metadata = () => ({
    id: 'drive-1', name: 'Song.guitardsl', version: String(version), modifiedTime: `t${version}`, headRevisionId: `r${version}`
  });
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname.startsWith('/upload/drive/v3/files')) {
      if (init?.method === 'POST') { creates += 1; }
      if (init?.method === 'PATCH') {
        patchIds.push(url.pathname.split('/').at(-1)!);
        source = String(init.body);
        version += 1;
      }
      return new Response(JSON.stringify(metadata()), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify(metadata()), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    const first = await api.updateFile({ ...metadata(), version: '7', modifiedTime: 't7', headRevisionId: 'r7' }, 'first save');
    assert.equal(first.kind, 'saved');
    const second = await api.updateFile(first.file, 'second save');
    assert.equal(second.kind, 'saved');
    assert.deepEqual(patchIds, ['drive-1', 'drive-1']);
    assert.equal(creates, 0);
    assert.equal(source, 'second save');
  } finally { globalThis.fetch = originalFetch; }
});

test('an ambiguous network result is read back once and is never automatically patched again', async () => {
  const api = createApi();
  const originalFetch = globalThis.fetch;
  let patchCalls = 0;
  let mediaReads = 0;
  let metadataReads = 0;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname.startsWith('/upload/drive/v3/files')) {
      patchCalls += 1;
      throw new TypeError('connection closed after request dispatch');
    }
    if (url.searchParams.get('alt') === 'media') {
      mediaReads += 1;
      return new Response('submitted source', { status: 200 });
    }
    metadataReads += 1;
    return new Response(JSON.stringify({
      id: 'drive-1', name: 'Song.guitardsl', version: metadataReads === 1 ? '7' : '8',
      modifiedTime: metadataReads === 1 ? 't7' : 't8', headRevisionId: metadataReads === 1 ? 'r7' : 'r8'
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    const result = await api.updateFile({
      id: 'drive-1', name: 'Song.guitardsl', version: '7', modifiedTime: 't7', headRevisionId: 'r7'
    }, 'submitted source');
    assert.equal(result.kind, 'saved');
    if (result.kind === 'saved') assert.equal(result.readback?.source, 'submitted source');
    assert.equal(patchCalls, 1);
    assert.equal(mediaReads, 1);
  } finally { globalThis.fetch = originalFetch; }
});

test('a Drive server error keeps an unknown result after one readback and does not retry the PATCH', async () => {
  const api = createApi();
  const originalFetch = globalThis.fetch;
  let patchCalls = 0;
  let mediaReads = 0;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname.startsWith('/upload/drive/v3/files')) {
      patchCalls += 1;
      return new Response('', { status: 500 });
    }
    if (url.searchParams.get('alt') === 'media') {
      mediaReads += 1;
      return new Response('old remote source', { status: 200 });
    }
    return new Response(JSON.stringify({
      id: 'drive-1', name: 'Song.guitardsl', version: '7', modifiedTime: 't7', headRevisionId: 'r7'
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    const result = await api.updateFile({
      id: 'drive-1', name: 'Song.guitardsl', version: '7', modifiedTime: 't7', headRevisionId: 'r7'
    }, 'submitted source');
    assert.equal(result.kind, 'unknown');
    if (result.kind === 'unknown') {
      assert.equal(result.status, 500);
      assert.equal(result.latest?.source, 'old remote source');
    }
    assert.equal(patchCalls, 1);
    assert.equal(mediaReads, 1);
  } finally { globalThis.fetch = originalFetch; }
});

test('a Drive 401 remains an unknown save result with its status after one readback and no retry', async () => {
  const api = createApi();
  const originalFetch = globalThis.fetch;
  let patchCalls = 0;
  let metadataReads = 0;
  let mediaReads = 0;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname.startsWith('/upload/drive/v3/files')) {
      patchCalls += 1;
      return new Response('', { status: 401 });
    }
    if (url.searchParams.get('alt') === 'media') {
      mediaReads += 1;
      return new Response('', { status: 401 });
    }
    metadataReads += 1;
    return new Response(JSON.stringify({
      id: 'drive-1', name: 'Song.guitardsl', version: '7', modifiedTime: 't7', headRevisionId: 'r7'
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    const result = await api.updateFile({
      id: 'drive-1', name: 'Song.guitardsl', version: '7', modifiedTime: 't7', headRevisionId: 'r7'
    }, 'submitted source');
    assert.deepEqual(result, { kind: 'unknown', status: 401 });
    assert.equal(patchCalls, 1);
    assert.equal(metadataReads, 2);
    assert.equal(mediaReads, 1);
  } finally { globalThis.fetch = originalFetch; }
});
