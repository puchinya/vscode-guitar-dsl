import assert from 'node:assert/strict';
import test from 'node:test';
import type { GoogleOAuth } from '../../src/auth/googleOAuth';
import { GoogleDriveApi, type DriveFile } from '../../src/storage/googleDrive';

function createApi() {
  const auth = { tokenForRequest: () => 'test-token' } as unknown as GoogleOAuth;
  return new GoogleDriveApi(auth);
}

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
