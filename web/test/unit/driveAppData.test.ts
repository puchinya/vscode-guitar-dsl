import assert from 'node:assert/strict';
import test from 'node:test';
import type { GoogleOAuth } from '../../src/auth/googleOAuth';
import {
  DEFAULT_DRIVE_APPDATA_STATE, DRIVE_APPDATA_FILE_NAME, DRIVE_APPDATA_MIME_TYPE,
  DriveAppDataError, DriveAppDataStore, validateDriveAppDataState, validatePendingDriveAppData,
  type DriveAppDataFile, type DriveAppDataState
} from '../../src/storage/driveAppData';

const file = (id: string, version = '1', createdTime = '2026-01-01T00:00:00Z'): DriveAppDataFile => ({
  id, name: DRIVE_APPDATA_FILE_NAME, mimeType: DRIVE_APPDATA_MIME_TYPE, createdTime, version, modifiedTime: `time-${version}`
});
const state: DriveAppDataState = {
  ...DEFAULT_DRIVE_APPDATA_STATE,
  selectedFolderId: 'folder-1', folderPrompt: 'completed', openDriveFileIds: ['score-1'],
  activeDriveFileId: 'score-1', recentDriveFileIds: ['score-1']
};
const auth = { tokenForRequest: () => 'test-token' } as unknown as GoogleOAuth;
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });

test('appData state validates the exact schema and bounds unique file references', () => {
  const normalized = validateDriveAppDataState({
    ...state,
    openDriveFileIds: [...Array.from({ length: 35 }, (_, index) => `id-${index}`), 'id-1'],
    recentDriveFileIds: [...Array.from({ length: 55 }, (_, index) => `recent-${index}`)]
  });
  assert.equal(normalized.openDriveFileIds.length, 30);
  assert.equal(normalized.openDriveFileIds.filter(id => id === 'id-1').length, 1);
  assert.equal(normalized.recentDriveFileIds.length, 50);
  assert.throws(() => validateDriveAppDataState({ ...state, accessToken: 'never-allowed' }), error =>
    error instanceof DriveAppDataError && error.code === 'invalid-state');
  assert.throws(() => validateDriveAppDataState({ ...state, schemaVersion: 2 }), error =>
    error instanceof DriveAppDataError && error.code === 'unsupported-version');
  assert.throws(() => validateDriveAppDataState({ ...state, openDriveFileIds: [3] }), error =>
    error instanceof DriveAppDataError && error.code === 'invalid-state');
});

test('pending Drive metadata is account-bound and rejects source, credentials, and unknown fields', () => {
  const pending = { schemaVersion: 1, accountId: 'account-a', state, updatedAt: 1 };
  assert.deepEqual(validatePendingDriveAppData(pending, 'account-a'), pending);
  for (const value of [
    { ...pending, accountId: 'account-b' },
    { ...pending, accessToken: 'secret' },
    { ...pending, source: 'title: secret' },
    { ...pending, state: { ...state, draft: 'title: secret' } },
    { ...pending, updatedAt: Number.NaN }
  ]) {
    assert.throws(() => validatePendingDriveAppData(value, 'account-a'), error =>
      error instanceof DriveAppDataError && error.code === 'invalid-state');
  }
});

test('appData discovery paginates exact appDataFolder and trashed=false filters and picks the oldest duplicate', async () => {
  const originalFetch = globalThis.fetch;
  const calls: URL[] = [];
  globalThis.fetch = async input => {
    const url = new URL(String(input)); calls.push(url);
    if (url.pathname.endsWith('/files') && url.searchParams.get('alt') !== 'media') {
      assert.equal(url.searchParams.get('spaces'), 'appDataFolder');
      assert.match(url.searchParams.get('q') ?? '', /name='guitardsl-state-v1\.json' and trashed=false/);
      return calls.filter(item => item.pathname.endsWith('/files') && !item.searchParams.has('alt')).length === 1
        ? json({ nextPageToken: 'next', files: [file('newer', '2', '2026-02-01T00:00:00Z')] })
        : json({ files: [file('older', '1', '2026-01-01T00:00:00Z'), { ...file('wrong-mime'), mimeType: 'text/plain' }] });
    }
    if (url.searchParams.get('alt') === 'media') return new Response(JSON.stringify(state));
    return json(file('older'));
  };
  try {
    const snapshot = await new DriveAppDataStore(auth).load();
    assert.equal(snapshot?.file.id, 'older');
    assert.equal(snapshot?.duplicateCount, 2);
    assert.equal(calls[0].searchParams.get('pageToken'), null);
    assert.equal(calls[1].searchParams.get('pageToken'), 'next');
  } finally { globalThis.fetch = originalFetch; }
});

test('first missing appData state is created once in appDataFolder and read back', async () => {
  const originalFetch = globalThis.fetch;
  const calls: { url: URL; method: string; body?: BodyInit | null }[] = [];
  let created = false;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input)); const method = init?.method ?? 'GET';
    calls.push({ url, method, body: init?.body });
    if (url.pathname.endsWith('/files') && method === 'GET') return json({ files: created ? [file('state-1')] : [] });
    if (url.pathname.endsWith('/files') && method === 'POST') {
      created = true;
      const body = String(await new Response(init?.body).text());
      assert.match(body, /"parents":\["appDataFolder"\]/);
      assert.match(body, /guitardsl-state-v1\.json/);
      assert.match(body, /application\/json/);
      return json({ id: 'state-1' });
    }
    if (url.searchParams.get('alt') === 'media') return new Response(JSON.stringify(state));
    return json(file('state-1'));
  };
  try {
    const snapshot = await new DriveAppDataStore(auth).loadOrCreate(state);
    assert.equal(snapshot.file.id, 'state-1');
    assert.equal(calls.filter(call => call.method === 'POST').length, 1);
    assert.equal(calls.filter(call => call.method === 'PATCH').length, 0);
  } finally { globalThis.fetch = originalFetch; }
});

test('uncertain initial create reconciles with one list and never repeats POST', async () => {
  const originalFetch = globalThis.fetch;
  let posts = 0; let lists = 0;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/files') && init?.method === 'POST') { posts += 1; throw new TypeError('network lost'); }
    if (url.pathname.endsWith('/files')) { lists += 1; return json({ files: lists > 1 ? [file('created-before-timeout')] : [] }); }
    if (url.searchParams.get('alt') === 'media') return new Response(JSON.stringify(state));
    return json(file('created-before-timeout'));
  };
  try {
    const snapshot = await new DriveAppDataStore(auth).loadOrCreate(state);
    assert.equal(snapshot.file.id, 'created-before-timeout');
    assert.equal(posts, 1);
    assert.equal(lists, 2);
  } finally { globalThis.fetch = originalFetch; }
});

test('normal appData updates PATCH the same file and require matching readback', async () => {
  const originalFetch = globalThis.fetch;
  const calls: { url: URL; method: string }[] = [];
  let version = '1'; let remoteState = state;
  const next = { ...state, openDriveFileIds: ['score-1', 'score-2'], recentDriveFileIds: ['score-2', 'score-1'] };
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input)); const method = init?.method ?? 'GET'; calls.push({ url, method });
    if (method === 'PATCH') { remoteState = JSON.parse(String(init?.body)) as DriveAppDataState; version = '2'; return json(file('state-1', version)); }
    if (url.searchParams.get('alt') === 'media') return new Response(JSON.stringify(remoteState));
    return json(file('state-1', version));
  };
  try {
    const baseline = { file: file('state-1'), state, duplicateCount: 1 };
    const result = await new DriveAppDataStore(auth).update(baseline, next);
    assert.equal(result.kind, 'saved');
    assert.equal(result.snapshot.file.id, 'state-1');
    assert.equal(calls.filter(call => call.method === 'PATCH').length, 1);
    assert.match(calls.find(call => call.method === 'PATCH')!.url.href, /upload\/drive\/v3\/files\/state-1\?uploadType=media/);
    assert.equal(calls.filter(call => call.method === 'POST').length, 0);
  } finally { globalThis.fetch = originalFetch; }
});

test('a version conflict is returned before PATCH and includes the current state', async () => {
  const originalFetch = globalThis.fetch;
  let patches = 0;
  const latest = { ...state, folderPrompt: 'deferred' as const };
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (init?.method === 'PATCH') patches += 1;
    if (url.searchParams.get('alt') === 'media') return new Response(JSON.stringify(latest));
    return json(file('state-1', '2'));
  };
  try {
    const result = await new DriveAppDataStore(auth).update({ file: file('state-1'), state, duplicateCount: 1 }, { ...state, folderPrompt: 'completed' });
    assert.equal(result.kind, 'conflict');
    assert.equal(result.latest.state.folderPrompt, 'deferred');
    assert.equal(patches, 0);
  } finally { globalThis.fetch = originalFetch; }
});

test('a lost PATCH response is reconciled once and is never automatically resent', async () => {
  const originalFetch = globalThis.fetch;
  let patches = 0; let remoteState = state;
  const next = { ...state, openDriveFileIds: ['score-1', 'score-2'] };
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (init?.method === 'PATCH') { patches += 1; remoteState = JSON.parse(String(init.body)) as DriveAppDataState; return json({}, 500); }
    if (url.searchParams.get('alt') === 'media') return new Response(JSON.stringify(remoteState));
    return json(file('state-1', patches ? '2' : '1'));
  };
  try {
    const result = await new DriveAppDataStore(auth).update({ file: file('state-1'), state, duplicateCount: 1 }, next);
    assert.equal(result.kind, 'saved');
    assert.equal(patches, 1);
  } finally { globalThis.fetch = originalFetch; }
});

test('malformed and unknown remote state is not replaced with a new file', async () => {
  const originalFetch = globalThis.fetch;
  let posts = 0;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/files') && init?.method === 'POST') { posts += 1; return json({ id: 'unexpected' }); }
    if (url.pathname.endsWith('/files')) return json({ files: [file('existing')] });
    if (url.searchParams.get('alt') === 'media') return new Response('{broken');
    return json(file('existing'));
  };
  try {
    await assert.rejects(new DriveAppDataStore(auth).loadOrCreate(state), error =>
      error instanceof DriveAppDataError && error.code === 'invalid-json');
    assert.equal(posts, 0);
  } finally { globalThis.fetch = originalFetch; }
});
