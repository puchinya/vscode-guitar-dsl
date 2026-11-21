import assert from 'node:assert/strict';
import test from 'node:test';
import type { GoogleOAuth } from '../../src/auth/googleOAuth';
import { DriveApiError, GoogleDriveApi, type DriveFile } from '../../src/storage/googleDrive';

function createApi() {
  const auth = { tokenForRequest: () => 'test-token' } as unknown as GoogleOAuth;
  return new GoogleDriveApi(auth);
}

test('creates the visible library at the My Drive root and verifies the marker by readback', async () => {
  const api = createApi();
  const originalFetch = globalThis.fetch;
  const calls: { method: string; url: URL; body?: Record<string, unknown> }[] = [];
  let root: DriveFile = { id: 'library-root', name: 'GuitarDSL', mimeType: 'application/vnd.google-apps.folder', parents: ['my-drive-root'], appProperties: { guitardslLibraryRoot: '1' } };
  globalThis.fetch = async (input, init) => {
    const call = { method: init?.method ?? 'GET', url: new URL(String(input)), body: init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined };
    calls.push(call);
    if (call.url.pathname.endsWith('/files/root')) return new Response('', { status: 404 });
    if (call.method === 'POST') {
      assert.equal(call.body?.parents, undefined);
      return new Response(JSON.stringify({ id: 'library-root' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (call.url.pathname.endsWith('/files')) return new Response(JSON.stringify({ files: [root] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    return new Response(JSON.stringify(root), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    const created = await api.createLibraryRoot();
    assert.equal(created.id, 'library-root');
    assert.equal(calls[0]?.method, 'POST');
    assert.deepEqual(calls[0]?.body, {
      name: 'GuitarDSL', mimeType: 'application/vnd.google-apps.folder',
      appProperties: { guitardslLibraryRoot: '1' }
    });
    assert.equal(calls[1]?.method, 'GET');
    assert.match(calls[1]?.url.pathname ?? '', /\/files\/library-root$/u);
    assert.equal(calls[2]?.method, 'GET');
    assert.match(calls[2]?.url.pathname ?? '', /\/files$/u);
    assert.match(calls[2]?.url.searchParams.get('q') ?? '', /'root' in parents/u);
    assert.equal(calls.some(call => call.url.pathname.endsWith('/files/root')), false);
  } finally { globalThis.fetch = originalFetch; }
});

test('reuses an existing unmarked canonical root by adding and verifying its marker on the same ID', async () => {
  const api = createApi();
  const originalFetch = globalThis.fetch;
  const calls: { method: string; body?: Record<string, unknown> }[] = [];
  let root: DriveFile = { id: 'existing-root', name: 'GuitarDSL', mimeType: 'application/vnd.google-apps.folder', parents: ['my-drive-root'], appProperties: { owner: 'test' } };
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined;
    calls.push({ method, body });
    if (url.pathname.endsWith('/files/root')) return new Response('', { status: 404 });
    if (url.pathname.endsWith('/files') && method === 'GET') return new Response(JSON.stringify({ files: [root] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (method === 'PATCH') root = { ...root, appProperties: body?.appProperties as Record<string, string> };
    return new Response(JSON.stringify(root), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    const verified = await api.markLibraryRoot(root);
    assert.equal(verified.id, 'existing-root');
    assert.deepEqual(verified.appProperties, { owner: 'test', guitardslLibraryRoot: '1' });
    assert.deepEqual(calls.map(call => call.method), ['GET', 'PATCH', 'GET', 'GET']);
  } finally { globalThis.fetch = originalFetch; }
});

test('verifies an already marked canonical root through its ID and the root query without reading files/root', async () => {
  const api = createApi();
  const originalFetch = globalThis.fetch;
  const calls: { method: string; pathname: string }[] = [];
  const root: DriveFile = {
    id: 'marked-root', name: 'GuitarDSL', mimeType: 'application/vnd.google-apps.folder',
    parents: ['my-drive-root'], appProperties: { guitardslLibraryRoot: '1' }
  };
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    calls.push({ method, pathname: url.pathname });
    if (url.pathname.endsWith('/files/root')) return new Response('', { status: 404 });
    if (url.pathname === '/drive/v3/files') {
      return new Response(JSON.stringify({ files: [root] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify(root), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    const verified = await api.markLibraryRoot(root);
    assert.equal(verified.id, 'marked-root');
    assert.equal(verified.appProperties?.guitardslLibraryRoot, '1');
    assert.deepEqual(calls.map(call => call.method), ['GET', 'GET', 'GET']);
    assert.equal(calls.some(call => call.pathname === '/drive/v3/files/root'), false);
  } finally { globalThis.fetch = originalFetch; }
});

test('lists physical folders and supported scores as direct children only', async () => {
  const api = createApi();
  const originalFetch = globalThis.fetch;
  let callUrl: URL | undefined;
  globalThis.fetch = async input => {
    callUrl = new URL(String(input));
    return new Response(JSON.stringify({ files: [
      { id: 'subfolder', name: 'Band', mimeType: 'application/vnd.google-apps.folder', parents: ['root-id'] },
      { id: 'score', name: 'Song.guitardsl', mimeType: 'text/plain', parents: ['root-id'] },
      { id: 'unsupported', name: 'notes.txt', mimeType: 'text/plain', parents: ['root-id'] },
      { id: 'google-doc', name: 'Song.gdsl', mimeType: 'application/vnd.google-apps.document', parents: ['root-id'] },
      { id: 'trashed', name: 'Old.gdsl', mimeType: 'text/plain', parents: ['root-id'], trashed: true }
    ] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    const children = await api.listChildren('root-id');
    assert.deepEqual(children.map(file => file.id), ['subfolder', 'score']);
    assert.match(callUrl?.searchParams.get('q') ?? '', /'root-id' in parents and trashed=false/u);
  } finally { globalThis.fetch = originalFetch; }
});

test('copies an import into its library parent and finds it by the operation marker', async () => {
  const api = createApi();
  const originalFetch = globalThis.fetch;
  const calls: { url: URL; method: string; body?: Record<string, unknown> }[] = [];
  const copy: DriveFile = { id: 'copy-id', name: 'Song.guitardsl', mimeType: 'text/plain', parents: ['library'], appProperties: { guitardslImportOperation: 'op-1' } };
  globalThis.fetch = async (input, init) => {
    const call = { url: new URL(String(input)), method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined };
    calls.push(call);
    if (call.method === 'POST') return new Response(JSON.stringify(copy), { status: 200, headers: { 'Content-Type': 'application/json' } });
    return new Response(JSON.stringify({ files: [copy] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    const copied = await api.copyFile('source-id', 'library', 'Song.guitardsl', 'op-1');
    const recovered = await api.findImportByOperation('library', 'op-1');
    assert.equal(copied.id, 'copy-id');
    assert.equal(recovered?.id, 'copy-id');
    assert.match(calls[0]?.url.pathname ?? '', /\/files\/source-id\/copy$/u);
    assert.deepEqual(calls[0]?.body, {
      name: 'Song.guitardsl', parents: ['library'], appProperties: { guitardslImportOperation: 'op-1' }
    });
    assert.match(calls[1]?.url.searchParams.get('q') ?? '', /'library' in parents and trashed=false/u);
    assert.match(calls[1]?.url.searchParams.get('q') ?? '', /guitardslImportOperation/u);
  } finally { globalThis.fetch = originalFetch; }
});

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

test('accessible GuitarDSL folder discovery searches only the exact untrashed My Drive root folder', async () => {
  const api = createApi();
  const originalFetch = globalThis.fetch;
  const calls: URL[] = [];
  globalThis.fetch = async input => {
    const url = new URL(String(input));
    calls.push(url);
    if (url.pathname.endsWith('/files/root')) return new Response('', { status: 404 });
    return new Response(JSON.stringify({ files: [
      { id: 'folder-1', name: 'GuitarDSL', mimeType: 'application/vnd.google-apps.folder', parents: ['my-drive-root-id'] },
      { id: 'folder-2', name: 'GuitarDSL Archive', mimeType: 'application/vnd.google-apps.folder', parents: ['my-drive-root-id'] },
      { id: 'file-1', name: 'GuitarDSL', mimeType: 'text/plain', parents: ['my-drive-root-id'] }
    ] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    const folders = await api.findAccessibleFolders();
    assert.deepEqual(folders.map(folder => folder.id), ['folder-1']);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].pathname, '/drive/v3/files');
    assert.match(calls[0].searchParams.get('q')!, /name='GuitarDSL'.*mimeType='application\/vnd\.google-apps\.folder'.*'root' in parents and trashed=false/);
    assert.deepEqual(folders[0]?.parents, ['my-drive-root-id']);
    assert.equal(calls.some(url => url.pathname.endsWith('/files/root')), false);
  } finally { globalThis.fetch = originalFetch; }
});

test('operation recovery scans later pages and rejects repeated page tokens', async () => {
  const api = createApi();
  const originalFetch = globalThis.fetch;
  const marker: DriveFile = { id: 'later-result', name: 'Move.guitardsl', version: '1', modifiedTime: 't1', parents: ['library'], appProperties: { guitardslLocalId: 'local-id' } };
  try {
    let page = 0;
    globalThis.fetch = async input => {
      const url = new URL(String(input));
      page += 1;
      if (page === 1) return new Response(JSON.stringify({ nextPageToken: 'page-2', files: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      assert.equal(url.searchParams.get('pageToken'), 'page-2');
      return new Response(JSON.stringify({ files: [marker] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    assert.equal((await api.findMoveUpload('library', 'local-id'))?.id, 'later-result');
    assert.equal(page, 2);

    page = 0;
    globalThis.fetch = async () => {
      page += 1;
      return new Response(JSON.stringify({ nextPageToken: 'repeat', files: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    await assert.rejects(api.findMoveUpload('library', 'local-id'), /repeated pagination token/u);
  } finally { globalThis.fetch = originalFetch; }
});

test('folder ancestry accepts managed library children and rejects other Drive folders', async () => {
  const api = createApi();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async input => {
    const id = new URL(String(input)).pathname.split('/').at(-1);
    const folder = id === 'nested' ? { id, mimeType: 'application/vnd.google-apps.folder', parents: ['library'] }
      : { id, mimeType: 'application/vnd.google-apps.folder', parents: ['outside'] };
    return new Response(JSON.stringify(folder), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    assert.equal(await api.isWithinFolder({ id: 'inside', name: 'Inside.guitardsl', version: '1', modifiedTime: 't1', parents: ['nested'] }, 'library'), true);
    assert.equal(await api.isWithinFolder({ id: 'outside-file', name: 'Outside.guitardsl', version: '1', modifiedTime: 't1', parents: ['other'] }, 'library'), false);
    assert.equal(await api.isWithinFolder({ id: 'direct', name: 'Direct.guitardsl', version: '1', modifiedTime: 't1', parents: ['library'] }, 'library'), true);
  } finally { globalThis.fetch = originalFetch; }
});

test('folder and import operation markers are recovered from later result pages', async () => {
  const api = createApi();
  const originalFetch = globalThis.fetch;
  const calls: URL[] = [];
  globalThis.fetch = async input => {
    const url = new URL(String(input));
    calls.push(url);
    const query = url.searchParams.get('q') ?? '';
    const isFolder = query.includes('guitardslFolderOperation');
    const marker = isFolder
      ? { id: 'folder-later', name: 'Band', mimeType: 'application/vnd.google-apps.folder', parents: ['library'], appProperties: { guitardslFolderOperation: 'folder-op' } }
      : { id: 'import-later', name: 'Song.guitardsl', mimeType: 'text/plain', parents: ['library'], appProperties: { guitardslImportOperation: 'import-op' } };
    return new Response(JSON.stringify(url.searchParams.has('pageToken')
      ? { files: [marker] } : { nextPageToken: 'page-2', files: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    assert.equal((await api.findFolderByOperation('library', 'folder-op'))?.id, 'folder-later');
    assert.equal((await api.findImportByOperation('library', 'import-op'))?.id, 'import-later');
    assert.deepEqual(calls.map(url => url.searchParams.get('pageToken')), [null, 'page-2', null, 'page-2']);
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
